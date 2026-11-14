/**
 * dsh-session-manager 浏览器半身。
 *
 * 在左侧面板栏「上下文洞察」（order=20）之后插入「会话管理」入口，
 * 中央面板按「仪表盘 + 卡片流」布局汇总**全部工作区**的会话。
 *
 * 接线要点（与 dsh-skills-sidebar 同源）：
 *   · 左侧条目注册到 `sidebar.panellist`，同一个 id 必须同时是中央栏
 *     root 作用域 `main` keyed 槽的 key，否则 ui-layout 会拒绝 selectPanel；
 *   · 会话数据来自 `ctx.get('sessions')`（SessionManager，含 getListSnapshot/subscribe）；
 *   · 工作区数据来自 `ctx.get('workspaces')`（WorkspaceController，`.list` 为快照模型）；
 *   · 打开会话走 `ctx.get('uiWorkspace').openSession(id)`；
 *   · 重命名走 Remote `ctx.remote.session.rename({ sessionId, title })`；
 *   · 删除 = 宿主语义的「归档」（`workspaces.archiveSession`），可恢复，不落物理删除；
 *   · 转移工作区由宿主半身 route `/dsh-session-manager/transfer` 完成（需重启生效）。
 *
 * 版本敏感点：sessions 快照条目字段（sessionId/title/cwd/updatedAt/running/blank）、
 * workspaces 快照字段（items/archivedSessionIds/pinnedSessionIds）、以及上述三个读取面。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-manager',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const react = require('react')

    /** 稳定的 cordis 插件名。 */
    const name = 'dsh-session-manager'
    /**
     * 只硬声明 slots 与 locale：这两个是插件注册的必要面。
     * sessions / workspaces / uiWorkspace / remote 一律走 `ctx.get()` 软取，
     * 任一缺席只会让对应动作降级，不会把整个插件挡在加载之外。
     */
    const inject = ['slots', 'locale']
    /** 空快照常量：useSyncExternalStore 要求 getSnapshot 返回稳定引用。 */
    const EMPTY_SESSIONS = { items: [] }
    const EMPTY_WORKSPACES = { items: [], archivedSessionIds: [], pinnedSessionIds: [] }
    /** 词典命名空间。 */
    const NS = 'dsh-session-manager'
    /** 左侧入口 id，同时是 `main` 槽的 key。 */
    const PANEL_ID = 'session-manager'
    /** 面板栏排序：上下文洞察是 20，紧接其后。 */
    const PANEL_ORDER = 21

    const zh = {
      panel: '会话管理',
      title: '会话管理',
      subtitle: '共 {n} 个会话，分布在 {w} 个工作区；已归档 {a} 个。',
      search: '搜索标题、会话 ID 或路径…',
      allWorkspaces: '全部工作区',
      allStates: '全部状态',
      state: '状态',
      stateActive: '在用',
      statTotal: '会话总数',
      statRun: '运行中',
      statArch: '已归档',
      statWs: '工作区',
      running: '运行中',
      archived: '已归档',
      blank: '空会话',
      pinned: '已置顶',
      ungrouped: '未归组',
      open: '打开',
      rename: '重命名',
      pin: '置顶',
      unpin: '取消置顶',
      remove: '删除',
      restore: '恢复',
      transfer: '转移',
      refresh: '刷新',
      selectAll: '全选',
      clearAll: '取消选择',
      selected: '已选 {n} 项',
      batchRemove: '批量删除',
      batchTransfer: '批量转移',
      empty: '还没有任何会话。',
      noMatch: '没有匹配的会话。',
      loading: '正在读取会话…',
      countUnit: '个',
      updatedAt: '更新于 {t}',
      confirmRemoveTitle: '删除会话',
      confirmRemoveBody: '将从各工作区列表中移除「{title}」并停止其后台活动。会话日志保留，可在「已归档」中恢复。',
      confirmBatchRemoveBody: '将移除选中的 {n} 个会话并停止其后台活动。会话日志保留，可在「已归档」中恢复。',
      confirmTransferTitle: '转移到其他工作区',
      confirmTransferBody: '把「{title}」转移到：',
      confirmBatchTransferBody: '把选中的 {n} 个会话转移到：',
      transferHint: '转移会同时改写会话头的工作目录并移动存储位置，完成后需重启 DSH 才会生效。',
      restartNeeded: '已转移 {n} 个会话。请重启 DSH 使工作区归属生效。',
      menuTransfer: '移动会话',
      menuDelete: '删除会话',
      confirmDeleteTitle: '删除会话',
      confirmDeleteBody: '确定要删除会话「{title}」吗？会话将从当前工作区列表中移除并停止后台活动（会话日志完整保留，可在「会话管理」中随时恢复）。',
      deletedNotice: '会话已删除（已转入归档，可在会话管理随时恢复）。',
      purge: '彻底删除',
      batchPurge: '批量彻底删除',
      purgeAll: '全部彻底删除',
      confirmPurgeAllTitle: '全部彻底删除',
      confirmPurgeAllBody: '确定要彻底删除当前全部 {n} 个已归档会话吗？文件将安全移入回收站缓冲并从系统中彻底抹除，不可恢复。',
      noArchived: '当前没有已归档会话。',
      statHint: '点击卡片快速筛选',
      confirmPurgeTitle: '彻底删除会话',
      confirmBatchPurgeTitle: '批量彻底删除会话',
      confirmPurgeBody: '确定要彻底删除已归档会话「{title}」吗？会话文件将安全移入回收站缓冲并从系统中彻底抹除，不可恢复。',
      confirmBatchPurgeBody: '确定要彻底删除选中的 {n} 个会话吗？会话文件将安全移入回收站缓冲并从系统中彻底抹除，不可恢复。',
      purgeDone: '已彻底删除 {n} 个会话。',
      skippedRunning: '已跳过 {n} 个正在运行的会话，请先停止后再删除。',
      cancel: '取消',
      confirm: '确定',
      working: '处理中…',
      done: '完成',
      failed: '失败：{msg}',
      renameTitle: '重命名会话',
      renameLabel: '新标题',
      noTarget: '没有其他工作区可供转移。',
      hint: '删除即归档，可随时恢复；转移需重启 DSH。',
    }
    const en = {
      panel: 'Sessions',
      title: 'Session Manager',
      subtitle: '{n} sessions across {w} workspaces; {a} archived.',
      search: 'Search title, session id, or path…',
      allWorkspaces: 'All workspaces',
      allStates: 'All states',
      state: 'State',
      stateActive: 'In use',
      statTotal: 'Total',
      statRun: 'Running',
      statArch: 'Archived',
      statWs: 'Workspaces',
      running: 'Running',
      archived: 'Archived',
      blank: 'Blank',
      pinned: 'Pinned',
      ungrouped: 'Ungrouped',
      open: 'Open',
      rename: 'Rename',
      pin: 'Pin',
      unpin: 'Unpin',
      remove: 'Delete',
      restore: 'Restore',
      transfer: 'Move',
      refresh: 'Refresh',
      selectAll: 'Select all',
      clearAll: 'Clear',
      selected: '{n} selected',
      batchRemove: 'Delete selected',
      batchTransfer: 'Move selected',
      empty: 'No sessions yet.',
      noMatch: 'No matching session.',
      loading: 'Loading sessions…',
      countUnit: 'session(s)',
      updatedAt: 'updated {t}',
      confirmRemoveTitle: 'Delete session',
      confirmRemoveBody: 'Remove “{title}” from its workspace and stop its background activity. The log is kept and can be restored from Archived.',
      confirmBatchRemoveBody: 'Remove the {n} selected sessions and stop their background activity. Logs are kept and can be restored.',
      confirmTransferTitle: 'Move to another workspace',
      confirmTransferBody: 'Move “{title}” to:',
      confirmBatchTransferBody: 'Move the {n} selected sessions to:',
      transferHint: 'Moving rewrites the session header cwd and relocates storage. Restart DSH for it to take effect.',
      restartNeeded: 'Moved {n} session(s). Restart DSH to apply workspace membership.',
      menuTransfer: 'Move session',
      menuDelete: 'Delete session',
      confirmDeleteTitle: 'Delete session',
      confirmDeleteBody: 'Are you sure you want to delete session “{title}”? It will be removed from the current workspace and stop running activity (log is kept in Archive).',
      deletedNotice: 'Session deleted (archived, can be restored in Session Manager).',
      purge: 'Purge permanently',
      batchPurge: 'Purge selected',
      purgeAll: 'Purge all archived',
      confirmPurgeAllTitle: 'Purge all archived',
      confirmPurgeAllBody: 'Permanently delete all {n} archived sessions? Files go to the trash buffer and are removed from the system.',
      noArchived: 'No archived sessions right now.',
      statHint: 'Click a card to filter',
      confirmPurgeTitle: 'Purge session',
      confirmBatchPurgeTitle: 'Purge selected sessions',
      confirmPurgeBody: 'Permanently delete archived session “{title}”? Files will be removed to trash buffer and purged completely.',
      confirmBatchPurgeBody: 'Permanently delete {n} selected sessions? Files will be removed to trash buffer and purged completely.',
      purgeDone: '{n} session(s) purged.',
      skippedRunning: 'Skipped {n} running session(s); stop them first.',
      cancel: 'Cancel',
      confirm: 'Confirm',
      working: 'Working…',
      done: 'Done',
      failed: 'Failed: {msg}',
      renameTitle: 'Rename session',
      renameLabel: 'New title',
      noTarget: 'No other workspace to move into.',
      hint: 'Delete archives (restorable); moving needs a DSH restart.',
    }

    /** 把 {placeholder} 换成字典值；缺值原样保留。 */
    function format(template, vars) {
      return String(template).replace(/\{(\w+)\}/g, (all, key) =>
        vars && vars[key] !== undefined ? String(vars[key]) : all,
      )
    }

    /** 左侧入口字形：一个带清单线条的「会话堆叠」图标。 */
    function SessionGlyph(props) {
      const size = props && props.size ? props.size : 18
      return react.createElement(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        react.createElement('rect', { key: 'a', x: '2.2', y: '3', width: '11.6', height: '8.2', rx: '1.6' }),
        react.createElement('path', { key: 'b', d: 'M4.6 5.9h6.8' }),
        react.createElement('path', { key: 'c', d: 'M4.6 8.2h4.4' }),
        react.createElement('path', { key: 'd', d: 'M4.2 13.2h7.6' }),
      )
    }

    /** 取当前时间戳，供相对时间显示。 */
    function nowMs() {
      return Date.now()
    }

    /** 把毫秒时间戳格式化成「刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期」。 */
    function relativeTime(ms, t) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—'
      const diff = nowMs() - ms
      if (diff < 0) return new Date(ms).toLocaleDateString()
      const min = Math.floor(diff / 60000)
      if (min < 1) return '刚刚'
      if (min < 60) return `${min} 分钟前`
      const hour = Math.floor(min / 60)
      if (hour < 24) return `${hour} 小时前`
      const day = Math.floor(hour / 24)
      if (day < 30) return `${day} 天前`
      const d = new Date(ms)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }

    /** 会话短 id（末段），用于卡片副标题。 */
    function shortId(id) {
      if (typeof id !== 'string') return ''
      const tail = id.replace(/^session-/, '')
      return tail.length > 8 ? `${tail.slice(0, 8)}…` : tail
    }

    /**
     * 计算面板所需的合并视图。
     * @param sessionSnap - sessions 快照。
     * @param wsSnap - workspaces 快照。
     * @returns `{ rows, workspaces, archived, pinned, stats }`。
     */
    function buildView(sessionSnap, wsSnap) {
      let items = []
      if (Array.isArray(sessionSnap?.items)) {
        items = sessionSnap.items
      } else if (sessionSnap?.byId && Array.isArray(sessionSnap?.ids)) {
        items = sessionSnap.ids.map((id) => sessionSnap.byId[id]).filter(Boolean)
      } else if (sessionSnap?.byId && typeof sessionSnap.byId === 'object') {
        items = Object.values(sessionSnap.byId)
      }
      const wsItems = Array.isArray(wsSnap?.items) ? wsSnap.items : []
      const archivedIds = Array.isArray(wsSnap?.archivedSessionIds) ? wsSnap.archivedSessionIds : []
      const pinnedIds = Array.isArray(wsSnap?.pinnedSessionIds) ? wsSnap.pinnedSessionIds : []
      const archived = new Set(archivedIds)
      const pinned = new Set(pinnedIds)

      const byPath = new Map()
      for (const ws of wsItems) byPath.set(ws.path, ws)

      const rows = items.map((item) => {
        const id = item.id || item.sessionId
        const ws = typeof item.cwd === 'string' ? byPath.get(item.cwd) : undefined
        return {
          id,
          title:
            typeof item.displayTitle === 'string' && item.displayTitle !== ''
              ? item.displayTitle
              : typeof item.title === 'string' && item.title !== ''
                ? item.title
                : '新会话',
          cwd: item.cwd,
          updatedAt: item.updatedAt,
          running: item.running === true,
          blank: item.blank === true,
          origin: item.origin,
          parentSessionId: item.parentId || item.parentSessionId,
          workspaceId: ws ? ws.workspaceId : undefined,
          workspaceTitle: ws ? ws.title : undefined,
          archived: archived.has(id),
          pinned: pinned.has(id),
        }
      })

      const stats = {
        total: rows.length,
        running: rows.filter((r) => r.running).length,
        archived: rows.filter((r) => r.archived).length,
        workspaces: wsItems.length,
        pinned: rows.filter((r) => r.pinned).length,
      }

      return { rows, workspaces: wsItems, archived, pinned, stats }
    }

    /**
     * 简易模态框：确认 / 重命名 / 选择目标工作区共用。
     * @param props - 渲染参数。
     * @returns 模态层。
     */
    function Modal(props) {
      const { title, children, onCancel, onConfirm, confirmText, confirmKind, busy, confirmDisabled } = props
      react.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && !busy && !confirmDisabled) onConfirm()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onCancel, onConfirm, busy, confirmDisabled])

      return react.createElement(
        'div',
        { className: 'dsm-mask', onClick: (e) => { if (e.target === e.currentTarget) onCancel() } },
        react.createElement(
          'div',
          { className: 'dsm-modal', role: 'dialog', 'aria-modal': 'true' },
          react.createElement('h3', { className: 'dsm-modalTitle' }, title),
          react.createElement('div', { className: 'dsm-modalBody' }, children),
          react.createElement(
            'div',
            { className: 'dsm-modalFoot' },
            react.createElement('button', { type: 'button', className: 'dsm-btn', onClick: onCancel, disabled: busy }, t_cancel()),
            react.createElement(
              'button',
              {
                type: 'button',
                className: confirmKind === 'danger' ? 'dsm-btn dsm-btnDanger' : 'dsm-btn dsm-btnPrimary',
                onClick: onConfirm,
                disabled: busy || confirmDisabled,
              },
              busy ? t_working() : confirmText,
            ),
          ),
        ),
      )
    }

    /** 模态框里的固定文案（避免把 t 传进 Modal 造成闭包依赖）。 */
    let dictRef = { cancel: '取消', working: '处理中…' }
    function t_cancel() { return dictRef.cancel }
    function t_working() { return dictRef.working }

    /**
     * 构造中央面板组件。
     * @param ctx - 客户端插件上下文。
     * @param t - 词典绑定函数。
     * @returns 面板组件。
     */
    function makePanel(ctx, t) {
      dictRef = { cancel: t('cancel'), working: t('working') }

      return function SessionManagerPanel() {
        const sessionsSvc = ctx.get('sessions')
        const wsSvc = ctx.get('workspaces')
        const wsModel = wsSvc && wsSvc.list ? wsSvc.list : wsSvc

        const sessionSnap = react.useSyncExternalStore(
          react.useCallback(
            (cb) => {
              if (sessionsSvc?.list && typeof sessionsSvc.list.subscribe === 'function') {
                return sessionsSvc.list.subscribe(cb)
              }
              if (sessionsSvc?.manager && typeof sessionsSvc.manager.subscribe === 'function') {
                return sessionsSvc.manager.subscribe(cb)
              }
              if (typeof sessionsSvc?.subscribe === 'function') {
                return sessionsSvc.subscribe(cb)
              }
              return () => {}
            },
            [sessionsSvc],
          ),
          react.useCallback(
            () => {
              if (sessionsSvc?.list && typeof sessionsSvc.list.getSnapshot === 'function') {
                return sessionsSvc.list.getSnapshot()
              }
              if (sessionsSvc?.manager && typeof sessionsSvc.manager.getListSnapshot === 'function') {
                return sessionsSvc.manager.getListSnapshot()
              }
              if (typeof sessionsSvc?.getListSnapshot === 'function') {
                return sessionsSvc.getListSnapshot()
              }
              return EMPTY_SESSIONS
            },
            [sessionsSvc],
          ),
          react.useCallback(() => EMPTY_SESSIONS, []),
        )

        const wsSnap = react.useSyncExternalStore(
          react.useCallback(
            (cb) => (wsModel && typeof wsModel.subscribe === 'function' ? wsModel.subscribe(cb) : () => {}),
            [wsModel],
          ),
          react.useCallback(
            () => (wsModel && typeof wsModel.getSnapshot === 'function' ? wsModel.getSnapshot() : EMPTY_WORKSPACES),
            [wsModel],
          ),
          react.useCallback(() => EMPTY_WORKSPACES, []),
        )

        const [query, setQuery] = react.useState('')
        const [wsFilter, setWsFilter] = react.useState('')
        const [stateFilter, setStateFilter] = react.useState('active')
        const [selected, setSelected] = react.useState(() => new Set())
        const [purgedIds, setPurgedIds] = react.useState(() => new Set())
        const [modal, setModal] = react.useState(null)
        const [notice, setNotice] = react.useState(null)
        const [busy, setBusy] = react.useState(false)
        const [tick, setTick] = react.useState(0)

        // 相对时间每分钟刷新一次
        react.useEffect(() => {
          const id = setInterval(() => setTick((n) => n + 1), 60000)
          return () => clearInterval(id)
        }, [])

        const view = react.useMemo(() => buildView(sessionSnap, wsSnap), [sessionSnap, wsSnap])

        const activeRows = react.useMemo(
          () => view.rows.filter((r) => !purgedIds.has(r.id)),
          [view.rows, purgedIds],
        )

        const visible = react.useMemo(() => {
          const q = query.trim().toLowerCase()
          return activeRows.filter((row) => {
            if (stateFilter === 'active' && row.archived) return false
            if (stateFilter === 'archived' && !row.archived) return false
            if (stateFilter === 'running' && !row.running) return false
            if (wsFilter === '__none__' && row.workspaceId !== undefined) return false
            if (wsFilter !== '' && wsFilter !== '__none__' && row.workspaceId !== wsFilter) return false
            if (q === '') return true
            const hay = `${row.title} ${row.id} ${row.cwd || ''}`.toLowerCase()
            return hay.includes(q)
          })
        }, [activeRows, query, wsFilter, stateFilter])

        const groups = react.useMemo(() => {
          const map = new Map()
          for (const row of visible) {
            const key = row.workspaceId || '__none__'
            if (!map.has(key)) {
              map.set(key, {
                key,
                title: row.workspaceTitle || t('ungrouped'),
                rows: [],
              })
            }
            map.get(key).rows.push(row)
          }
          const order = view.workspaces.map((w) => w.workspaceId)
          return [...map.values()].sort((a, b) => {
            const ai = order.indexOf(a.key)
            const bi = order.indexOf(b.key)
            return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi)
          })
        }, [visible, view.workspaces, t])

        const otherWorkspaces = view.workspaces

        /** 显示一条临时提示。 */
        const flash = (text, kind) => {
          setNotice({ text, kind: kind || 'info' })
          setTimeout(() => setNotice(null), 6000)
        }

        /** 打开会话。 */
        const openSession = (row) => {
          try {
            const ui = ctx.get('uiWorkspace')
            if (ui && typeof ui.openSession === 'function') {
              ui.openSession(row.id)
              return
            }
            flash(format(t('failed'), { msg: 'openSession 不可用' }), 'error')
          } catch (error) {
            flash(format(t('failed'), { msg: String(error?.message || error) }), 'error')
          }
        }

        /**
         * 批量归档（删除）。
         * @param rows - 目标行。
         * @returns `{ ok, errors }`。
         */
        const applyRemoval = async (rows) => {
          const errors = []
          if (!wsSvc || typeof wsSvc.archiveSession !== 'function') {
            return { ok: false, errors: ['工作区服务不可用，无法删除'] }
          }
          for (const row of rows) {
            try {
              await wsSvc.archiveSession(row.id, { stopActivity: true })
            } catch (error) {
              errors.push(`${row.title}: ${String(error?.message || error)}`)
            }
          }
          return { ok: errors.length === 0, errors }
        }

        /** 恢复归档。 */
        const restoreOne = async (row) => {
          try {
            if (!wsSvc || typeof wsSvc.unarchiveSession !== 'function') throw new Error('工作区服务不可用')
            await wsSvc.unarchiveSession(row.id)
          } catch (error) {
            flash(format(t('failed'), { msg: String(error?.message || error) }), 'error')
          }
        }

        /** 置顶 / 取消置顶。 */
        const togglePin = async (row) => {
          try {
            if (!wsSvc) throw new Error('工作区服务不可用')
            if (row.pinned) await wsSvc.unpinSession(row.id)
            else await wsSvc.pinSession(row.id)
          } catch (error) {
            flash(format(t('failed'), { msg: String(error?.message || error) }), 'error')
          }
        }

        /** 取会话 Remote 命名空间（软取，缺席时降级）。 */
        const sessionRemote = () => {
          const remote = ctx.remote ?? ctx.get('remote')
          return remote && remote.session ? remote.session : undefined
        }

        /** 重命名。 */
        const doRename = async (row, title) => {
          const next = String(title || '').trim()
          if (next === '') return
          setBusy(true)
          try {
            const api = sessionRemote()
            if (!api || typeof api.rename !== 'function') throw new Error('session.rename 不可用')
            const result = await api.rename({ sessionId: row.id, title: next })
            if (result && result.ok === false) throw new Error(result.error?.message || 'rename failed')
            flash(t('done'), 'ok')
          } catch (error) {
            flash(format(t('failed'), { msg: String(error?.message || error) }), 'error')
          } finally {
            setBusy(false)
            setModal(null)
          }
        }

        /** 请求宿主半身执行转移。 */
        const doTransfer = async (rows, targetWorkspaceId) => {
          setBusy(true)
          let moved = 0
          const failures = []
          try {
            for (const row of rows) {
              if (!row.workspaceId) {
                failures.push(`${row.title}: 当前未归入任何工作区，无法转移`)
                continue
              }
              try {
                const response = await fetch('/dsh-session-manager/transfer', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    sessionId: row.id,
                    sourceWorkspaceId: row.workspaceId,
                    targetWorkspaceId,
                  }),
                })
                const payload = await response.json().catch(() => ({}))
                if (!response.ok || payload.ok === false) {
                  failures.push(`${row.title}: ${payload.error || response.status}`)
                } else {
                  moved++
                }
              } catch (error) {
                failures.push(`${row.title}: ${String(error?.message || error)}`)
              }
            }
            if (moved > 0 && failures.length === 0) flash(format(t('restartNeeded'), { n: moved }), 'ok')
            else if (moved > 0) flash(`${format(t('restartNeeded'), { n: moved })}（${failures.length} 个失败）`, 'warn')
            else flash(format(t('failed'), { msg: failures.join('; ') }), 'error')
          } finally {
            setBusy(false)
            setModal(null)
            setSelected(new Set())
          }
        }

        /** 彻底删除已归档会话。 */
        const doPurge = async (rows) => {
          setBusy(true)
          try {
            const sessionIds = rows.map((r) => r.id)
            const response = await fetch('/dsh-session-manager/purge', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionIds }),
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok || payload.ok === false) {
              throw new Error(payload.error || '彻底删除失败')
            }

            // 宿主只会真正删除「非运行中」的会话，其余通过 skippedRunning 回报
            const purged = Array.isArray(payload.purgedSessionIds) && payload.purgedSessionIds.length > 0
              ? payload.purgedSessionIds
              : Array.isArray(payload.skippedRunning) && payload.skippedRunning.length > 0
                ? []
                : sessionIds
            const skipped = Array.isArray(payload.skippedRunning) ? payload.skippedRunning : []

            // 同步工作区内存态：从归档集合中移出已删除的会话
            for (const id of purged) {
              try {
                await wsSvc?.unarchiveSession?.(id)
              } catch {}
            }

            // 本地即时从可见列表剔除，界面瞬间刷新
            if (purged.length > 0) {
              setPurgedIds((prev) => {
                const next = new Set(prev)
                for (const id of purged) next.add(id)
                return next
              })
              setSelected((prev) => {
                const next = new Set(prev)
                for (const id of purged) next.delete(id)
                return next
              })
            }

            // 触发后台刷新
            try {
              sessionsSvc?.refresh?.()
            } catch {}

            if (purged.length > 0) flash(format(t('purgeDone'), { n: purged.length }), 'ok')
            if (skipped.length > 0) {
              setTimeout(() => flash(format(t('skippedRunning'), { n: skipped.length }), 'warn'), purged.length > 0 ? 400 : 0)
            }
          } catch (err) {
            flash(format(t('failed'), { msg: String(err?.message || err) }), 'error')
          } finally {
            setBusy(false)
            setModal(null)
          }
        }

        const selectedRows = visible.filter((row) => selected.has(row.id))
        const archivedRows = activeRows.filter((row) => row.archived)

        const toggleSelected = (id) => {
          setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }

        const stats = react.useMemo(
          () => ({
            total: activeRows.length,
            running: activeRows.filter((r) => r.running).length,
            archived: activeRows.filter((r) => r.archived).length,
            workspaces: view.workspaces.length,
            pinned: activeRows.filter((r) => r.pinned).length,
          }),
          [activeRows, view.workspaces.length],
        )

        const isArchivedBatch =
          stateFilter === 'archived' ||
          (selectedRows.length > 0 && selectedRows.every((r) => r.archived))

        return react.createElement(
          'div',
          { className: 'dsm-root' },
          // 头部
          react.createElement(
            'div',
            { className: 'dsm-head' },
            react.createElement('h1', { className: 'dsm-title' }, t('title')),
            react.createElement(
              'p',
              { className: 'dsm-sub' },
              format(t('subtitle'), { n: stats.total, w: stats.workspaces, a: stats.archived }),
            ),
          ),

          // 统计卡片（可点击，一键进入对应视图）
          react.createElement(
            'div',
            { className: 'dsm-stats' },
            statCard('dsm-statTotal', t('statTotal'), stats.total, 'total', stateFilter === 'all' && wsFilter === ''),
            statCard('dsm-statRun', t('statRun'), stats.running, 'running', stateFilter === 'running'),
            statCard('dsm-statArch', t('statArch'), stats.archived, 'archived', stateFilter === 'archived'),
            statCard('dsm-statWs', t('statWs'), stats.workspaces, 'workspace', stateFilter === 'active' && wsFilter === ''),
          ),

          // 工具栏
          react.createElement(
            'div',
            { className: 'dsm-toolbar' },
            react.createElement('input', {
              className: 'dsm-search',
              type: 'search',
              placeholder: t('search'),
              value: query,
              onChange: (e) => setQuery(e.target.value),
              'aria-label': t('search'),
            }),
            react.createElement(
              'select',
              {
                className: 'dsm-select',
                value: wsFilter,
                onChange: (e) => setWsFilter(e.target.value),
                'aria-label': t('allWorkspaces'),
              },
              react.createElement('option', { value: '' }, t('allWorkspaces')),
              view.workspaces.map((w) =>
                react.createElement('option', { key: w.workspaceId, value: w.workspaceId }, `${w.title}（${w.sessionIds?.length ?? 0}）`),
              ),
              react.createElement('option', { value: '__none__' }, t('ungrouped')),
            ),
            react.createElement(
              'select',
              {
                className: 'dsm-select',
                value: stateFilter,
                onChange: (e) => setStateFilter(e.target.value),
                'aria-label': t('state'),
              },
              react.createElement('option', { value: 'active' }, t('stateActive')),
              react.createElement('option', { value: 'archived' }, t('archived')),
              react.createElement('option', { value: 'running' }, t('running')),
              react.createElement('option', { value: 'all' }, t('allStates')),
            ),
            react.createElement(
              'button',
              { type: 'button', className: 'dsm-btn', onClick: () => setTick((n) => n + 1) },
              t('refresh'),
            ),
            // 归档视图专属：一键彻底删除全部已归档会话
            stateFilter === 'archived'
              ? react.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsm-btn dsm-btnDanger',
                    onClick: () => {
                      if (archivedRows.length === 0) {
                        flash(t('noArchived'), 'warn')
                        return
                      }
                      setModal({
                        kind: 'purgeAll',
                        rows: archivedRows,
                        title: t('confirmPurgeAllTitle'),
                        body: format(t('confirmPurgeAllBody'), { n: archivedRows.length }),
                      })
                    },
                  },
                  t('purgeAll'),
                )
              : null,
          ),

          // 批量操作条
          selected.size > 0
            ? react.createElement(
                'div',
                { className: 'dsm-batch' },
                react.createElement('span', { className: 'dsm-batchText' }, format(t('selected'), { n: selected.size })),
                isArchivedBatch
                  ? react.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dsm-btn dsm-btnDanger',
                        onClick: () =>
                          setModal({
                            kind: 'purge',
                            rows: selectedRows,
                            title: t('confirmBatchPurgeTitle'),
                            body: format(t('confirmBatchPurgeBody'), { n: selectedRows.length }),
                          }),
                      },
                      t('batchPurge'),
                    )
                  : react.createElement(
                      'button',
                      {
                        type: 'button',
                        className: 'dsm-btn dsm-btnDanger',
                        onClick: () =>
                          setModal({
                            kind: 'remove',
                            rows: selectedRows,
                            title: t('confirmRemoveTitle'),
                            body: format(t('confirmBatchRemoveBody'), { n: selectedRows.length }),
                          }),
                      },
                      t('batchRemove'),
                    ),
                react.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsm-btn',
                    onClick: () =>
                      setModal({
                        kind: 'transfer',
                        rows: selectedRows,
                        title: t('confirmTransferTitle'),
                        body: format(t('confirmBatchTransferBody'), { n: selectedRows.length }),
                      }),
                  },
                  t('batchTransfer'),
                ),
                react.createElement(
                  'button',
                  { type: 'button', className: 'dsm-btn', onClick: () => setSelected(new Set()) },
                  t('clearAll'),
                ),
              )
            : null,

          // 提示
          notice !== null
            ? react.createElement(
                'div',
                { className: `dsm-notice dsm-notice-${notice.kind}`, onClick: () => setNotice(null) },
                notice.text,
              )
            : null,

          // 列表
          view.rows.length === 0
            ? react.createElement('div', { className: 'dsm-empty' }, t('empty'))
            : visible.length === 0
              ? react.createElement('div', { className: 'dsm-empty' }, t('noMatch'))
              : groups.map((group) =>
                  react.createElement(
                    'section',
                    { key: group.key, className: 'dsm-group' },
                    react.createElement(
                      'div',
                      { className: 'dsm-groupHead' },
                      react.createElement('h2', { className: 'dsm-groupTitle' }, group.title),
                      react.createElement('span', { className: 'dsm-groupCount' }, `${group.rows.length}`),
                    ),
                    react.createElement(
                      'div',
                      { className: 'dsm-grid' },
                      group.rows.map((row) => sessionCard(row)),
                    ),
                  ),
                ),

          // 底部提示
          react.createElement('p', { className: 'dsm-hint' }, t('hint')),

          // 模态
          modal !== null ? renderModal() : null,
        )

        /** 统计卡片（可点击进入对应筛选视图）。 */
        function statCard(cls, label, value, kind, active) {
          return react.createElement(
            'button',
            {
              type: 'button',
              className: `dsm-stat ${cls}${active ? ' dsm-statActive' : ''}`,
              title: t('statHint'),
              onClick: () => goStat(kind),
            },
            react.createElement('div', { className: 'dsm-statValue' }, String(value)),
            react.createElement('div', { className: 'dsm-statLabel' }, label),
          )
        }

        /** 点击统计卡片时切换到对应视图。 */
        function goStat(kind) {
          if (kind === 'total') {
            setStateFilter('all')
            setWsFilter('')
            return
          }
          if (kind === 'running') {
            setStateFilter('running')
            return
          }
          if (kind === 'archived') {
            setStateFilter('archived')
            return
          }
          // workspace：回到「在用 + 全部工作区」的总览
          setStateFilter('active')
          setWsFilter('')
        }

        /** 单个会话卡片。 */
        function sessionCard(row) {
          const checked = selected.has(row.id)
          return react.createElement(
            'article',
            { key: row.id, className: `dsm-card${row.archived ? ' dsm-cardArchived' : ''}${row.running ? ' dsm-cardRunning' : ''}` },
            react.createElement(
              'div',
              { className: 'dsm-cardWsRow' },
              react.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsm-wsPill',
                  title: `筛选工作区：${row.workspaceTitle || t('ungrouped')}`,
                  onClick: (e) => {
                    e.stopPropagation()
                    setWsFilter(row.workspaceId || '__none__')
                  },
                },
                row.workspaceTitle || t('ungrouped'),
              ),
              react.createElement(
                'div',
                { className: 'dsm-badges' },
                row.running ? react.createElement('span', { className: 'dsm-badge dsm-badgeRun' }, t('running')) : null,
                row.pinned ? react.createElement('span', { className: 'dsm-badge dsm-badgePin' }, t('pinned')) : null,
                row.archived ? react.createElement('span', { className: 'dsm-badge dsm-badgeArch' }, t('archived')) : null,
                row.blank ? react.createElement('span', { className: 'dsm-badge' }, t('blank')) : null,
              ),
            ),
            react.createElement(
              'div',
              { className: 'dsm-cardHead' },
              react.createElement('input', {
                type: 'checkbox',
                className: 'dsm-check',
                checked,
                onChange: () => toggleSelected(row.id),
                'aria-label': row.title,
              }),
              react.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsm-cardTitle',
                  title: row.title,
                  onClick: () => openSession(row),
                },
                row.title,
              ),
            ),
            react.createElement('div', { className: 'dsm-meta' }, react.createElement('code', null, shortId(row.id))),
            react.createElement('div', { className: 'dsm-meta' }, format(t('updatedAt'), { t: relativeTime(row.updatedAt, t) })),
            react.createElement(
              'div',
              { className: 'dsm-actions' },
              react.createElement('button', { type: 'button', className: 'dsm-link', onClick: () => openSession(row) }, t('open')),
              react.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsm-link',
                  onClick: () => setModal({ kind: 'rename', row, title: t('renameTitle'), body: '' }),
                },
                t('rename'),
              ),
              row.archived
                ? react.createElement('button', { type: 'button', className: 'dsm-link', onClick: () => restoreOne(row) }, t('restore'))
                : react.createElement(
                    'button',
                    { type: 'button', className: 'dsm-link', onClick: () => togglePin(row) },
                    row.pinned ? t('unpin') : t('pin'),
                  ),
              row.archived
                ? react.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsm-link dsm-linkDanger',
                      onClick: () =>
                        setModal({
                          kind: 'purge',
                          rows: [row],
                          title: t('confirmPurgeTitle'),
                          body: format(t('confirmPurgeBody'), { title: row.title }),
                        }),
                    },
                    t('purge'),
                  )
                : react.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsm-link',
                      onClick: () =>
                        setModal({
                          kind: 'transfer',
                          rows: [row],
                          title: t('confirmTransferTitle'),
                          body: format(t('confirmTransferBody'), { title: row.title }),
                        }),
                    },
                    t('transfer'),
                  ),
              row.archived
                ? null
                : react.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsm-link dsm-linkDanger',
                      onClick: () =>
                        setModal({
                          kind: 'remove',
                          rows: [row],
                          title: t('confirmRemoveTitle'),
                          body: format(t('confirmRemoveBody'), { title: row.title }),
                        }),
                    },
                    t('remove'),
                  ),
            ),
          )
        }

        /** 渲染当前模态。 */
        function renderModal() {
          const m = modal
          if (m.kind === 'rename') {
            return react.createElement(RenameModal, {
              key: 'rename',
              modal: m,
              busy,
              t,
              onCancel: () => setModal(null),
              onConfirm: (value) => doRename(m.row, value),
            })
          }
          if (m.kind === 'purgeAll' || m.kind === 'purge') {
            return react.createElement(
              Modal,
              {
                key: m.kind,
                title: m.title,
                confirmText: m.kind === 'purgeAll' ? t('purgeAll') : t('purge'),
                confirmKind: 'danger',
                busy,
                onCancel: () => setModal(null),
                onConfirm: () => doPurge(m.rows),
              },
              react.createElement('p', { className: 'dsm-modalText' }, m.body),
            )
          }
          if (m.kind === 'remove') {
            return react.createElement(Modal, {
              key: 'remove',
              title: m.title,
              confirmText: t('confirm'),
              confirmKind: 'danger',
              busy,
              onCancel: () => setModal(null),
              onConfirm: async () => {
                setBusy(true)
                const result = await applyRemoval(m.rows)
                setBusy(false)
                setModal(null)
                setSelected(new Set())
                if (result.ok) flash(t('done'), 'ok')
                else flash(format(t('failed'), { msg: result.errors.join('; ') }), 'error')
              },
            }, react.createElement('p', { className: 'dsm-modalText' }, m.body))
          }
          // transfer
          return react.createElement(TransferModal, {
            key: 'transfer',
            modal: m,
            busy,
            t,
            workspaces: otherWorkspaces,
            currentId: m.rows.length === 1 ? m.rows[0].workspaceId : undefined,
            onCancel: () => setModal(null),
            onConfirm: (targetId) => doTransfer(m.rows, targetId),
          })
        }
      }
    }

    /** 重命名模态。 */
    function RenameModal(props) {
      const { modal, busy, t, onCancel, onConfirm } = props
      const [value, setValue] = react.useState(modal.row.title)
      return react.createElement(
        Modal,
        {
          title: modal.title,
          confirmText: t('confirm'),
          busy,
          onCancel,
          onConfirm: () => onConfirm(value),
          confirmDisabled: String(value).trim() === '',
        },
        react.createElement('label', { className: 'dsm-label' }, t('renameLabel')),
        react.createElement('input', {
          className: 'dsm-input',
          value,
          autoFocus: true,
          onChange: (e) => setValue(e.target.value),
        }),
      )
    }

    /** 转移目标选择模态。 */
    function TransferModal(props) {
      const { modal, busy, t, workspaces, currentId, onCancel, onConfirm } = props
      const options = workspaces.filter((w) => modal.rows.length > 1 || w.workspaceId !== currentId)
      const [target, setTarget] = react.useState(options.length > 0 ? options[0].workspaceId : '')
      return react.createElement(
        Modal,
        {
          title: modal.title,
          confirmText: t('confirm'),
          busy,
          onCancel,
          onConfirm: () => onConfirm(target),
          confirmDisabled: target === '' || options.length === 0,
        },
        react.createElement('p', { className: 'dsm-modalText' }, modal.body),
        options.length === 0
          ? react.createElement('p', { className: 'dsm-modalWarn' }, t('noTarget'))
          : react.createElement(
              'div',
              { className: 'dsm-radioList' },
              options.map((w) =>
                react.createElement(
                  'label',
                  { key: w.workspaceId, className: 'dsm-radio' },
                  react.createElement('input', {
                    type: 'radio',
                    name: 'dsm-target',
                    checked: target === w.workspaceId,
                    onChange: () => setTarget(w.workspaceId),
                  }),
                  react.createElement('span', { className: 'dsm-radioTitle' }, w.title),
                  react.createElement('span', { className: 'dsm-radioPath' }, w.path),
                ),
              ),
            ),
        react.createElement('p', { className: 'dsm-modalHint' }, t('transferHint')),
      )
    }

    /**
     * 注册侧栏入口、中央面板与样式。
     * @param ctx - 客户端插件上下文。
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-session-manager: dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = NS
        tag.dataset.pluginCss = `${NS}/panel.css`
        tag.textContent = [
          '.dsm-root{flex:1;min-height:0;overflow-y:auto;box-sizing:border-box;padding:20px 24px 28px;display:flex;flex-direction:column;gap:14px}',
          '.dsm-head{display:flex;flex-direction:column;gap:6px}',
          '.dsm-title{font-size:20px;font-weight:700;margin:0;color:var(--dsw-alias-label-primary,#111)}',
          '.dsm-sub{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#888)}',
          '.dsm-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}',
          '@media (max-width:900px){.dsm-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}',
          '.dsm-stat{border:1px solid var(--dsw-alias-border-l2,#e6e6e6);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-2,#fcfcfc);display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;font:inherit;cursor:pointer;transition:border-color .12s ease,box-shadow .12s ease,background .12s ease}',
          '.dsm-stat:hover{border-color:var(--dsw-alias-brand-primary,#3b82f6);box-shadow:0 2px 10px rgba(0,0,0,.06)}',
          '.dsm-statActive{border-color:var(--dsw-alias-brand-primary,#3b82f6);background:var(--dsw-alias-bg-layer-3,#eef4ff);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary,#3b82f6)}',
          '.dsm-statValue{font-size:22px;font-weight:700;line-height:1.2;color:var(--dsw-alias-label-primary,#111)}',
          '.dsm-statLabel{font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}',
          '.dsm-statRun .dsm-statValue{color:var(--dsw-alias-state-success-primary,#12864b)}',
          '.dsm-statArch .dsm-statValue{color:var(--dsw-alias-label-secondary,#666)}',
          '.dsm-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
          '.dsm-search{flex:1;min-width:180px;font:inherit;font-size:13px;padding:7px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d6d6d6);background:var(--dsw-alias-bg-layer-2,#fafafa);color:var(--dsw-alias-label-primary,#111)}',
          '.dsm-select{font:inherit;font-size:13px;padding:7px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d6d6d6);background:var(--dsw-alias-bg-layer-2,#fafafa);color:var(--dsw-alias-label-primary,#111)}',
          '.dsm-btn{font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2,#d6d6d6);background:var(--dsw-alias-bg-layer-2,#f5f5f5);color:var(--dsw-alias-label-primary,#111)}',
          '.dsm-btn:hover{border-color:var(--dsw-alias-brand-primary,#3b82f6)}',
          '.dsm-btn:disabled{opacity:.55;cursor:default}',
          '.dsm-btnPrimary{background:var(--dsw-alias-brand-primary,#3b82f6);border-color:transparent;color:#fff}',
          '.dsm-btnDanger{color:#c0281c;border-color:currentColor;background:transparent}',
          '.dsm-batch{display:flex;gap:8px;align-items:center;padding:8px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-3,#f0f0f0)}',
          '.dsm-batchText{font-size:13px;color:var(--dsw-alias-label-secondary,#555);margin-right:auto}',
          '.dsm-notice{font-size:12.5px;padding:9px 12px;border-radius:8px;cursor:pointer;background:var(--dsw-alias-bg-layer-3,#eef4ff);color:var(--dsw-alias-label-secondary,#445)}',
          '.dsm-notice-error{background:var(--dsw-alias-state-error-tertiary,#ffeceb);color:#a3221a}',
          '.dsm-notice-warn{background:var(--dsw-alias-state-warn-tertiary,#fff6e5);color:#8a5200}',
          '.dsm-notice-ok{background:var(--dsw-alias-state-success-tertiary,#e9f7ef);color:#14683c}',
          '.dsm-group{display:flex;flex-direction:column;gap:10px}',
          '.dsm-groupHead{display:flex;align-items:baseline;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l2,#eee);padding-bottom:6px}',
          '.dsm-groupTitle{font-size:14px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary,#222)}',
          '.dsm-groupCount{font-size:12px;color:var(--dsw-alias-label-tertiary,#999)}',
          '.dsm-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;align-items:stretch}',
          '@media (max-width:1500px){.dsm-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}',
          '@media (max-width:1100px){.dsm-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}',
          '@media (max-width:760px){.dsm-grid{grid-template-columns:minmax(0,1fr)}}',
          '.dsm-card{border:1px solid var(--dsw-alias-border-l2,#e6e6e6);border-radius:12px;padding:11px 13px;background:var(--dsw-alias-bg-layer-2,#fcfcfc);display:flex;flex-direction:column;gap:6px;min-width:0;transition:border-color .12s ease,box-shadow .12s ease}',
          '.dsm-card:hover{border-color:var(--dsw-alias-border-l1,#cfcfcf);box-shadow:0 1px 6px rgba(0,0,0,.05)}',
          '.dsm-cardArchived{opacity:.72;background:var(--dsw-alias-bg-layer-1,#f7f7f7)}',
          '.dsm-cardRunning{border-left:3px solid var(--dsw-alias-state-success-primary,#12864b)}',
          '.dsm-cardWsRow{display:flex;align-items:center;justify-content:space-between;gap:6px}',
          '.dsm-wsPill{font:inherit;font-size:11px;padding:2px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,#d8d8d8);background:var(--dsw-alias-bg-layer-3,#f0f4f8);color:var(--dsw-alias-brand-primary,#2563eb);cursor:pointer;white-space:nowrap;max-width:140px;overflow:hidden;text-overflow:ellipsis}',
          '.dsm-wsPill:hover{background:var(--dsw-alias-bg-layer-4,#e2e8f0);border-color:currentColor}',
          '.dsm-cardHead{display:flex;align-items:center;gap:8px;min-width:0}',
          '.dsm-check{flex:0 0 auto;cursor:pointer}',
          '.dsm-cardTitle{flex:1 1 auto;min-width:0;text-align:left;font:inherit;font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary,#111);background:none;border:none;padding:0;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
          '.dsm-cardTitle:hover{text-decoration:underline}',
          '.dsm-badges{display:flex;gap:5px;flex-wrap:wrap}',
          '.dsm-badge{font-size:10.5px;line-height:1;padding:3px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d6d6d6);color:var(--dsw-alias-label-secondary,#666);white-space:nowrap}',
          '.dsm-badgeRun{color:#12864b;border-color:currentColor}',
          '.dsm-badgePin{color:#a86a00;border-color:currentColor}',
          '.dsm-badgeArch{color:#888;border-color:currentColor}',
          '.dsm-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
          '.dsm-meta code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px}',
          '.dsm-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:auto;padding-top:4px}',
          '.dsm-link{font:inherit;font-size:12px;padding:0;border:none;background:none;color:var(--dsw-alias-brand-primary,#3b82f6);cursor:pointer;white-space:nowrap}',
          '.dsm-link:hover{text-decoration:underline}',
          '.dsm-linkDanger{color:#c0281c}',
          '.dsm-empty{padding:28px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#999)}',
          '.dsm-hint{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary,#999)}',
          '.dsm-mask{position:fixed;inset:0;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center;z-index:60}',
          '.dsm-modal{width:min(520px,92vw);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 12px 40px rgba(0,0,0,.22)}',
          '.dsm-modalTitle{margin:0;font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary,#111)}',
          '.dsm-modalBody{display:flex;flex-direction:column;gap:10px}',
          '.dsm-modalText{margin:0;font-size:13px;line-height:1.7;color:var(--dsw-alias-label-secondary,#444)}',
          '.dsm-modalWarn{margin:0;font-size:12.5px;color:#a86a00}',
          '.dsm-modalHint{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8a8a8a)}',
          '.dsm-modalFoot{display:flex;justify-content:flex-end;gap:8px}',
          '.dsm-label{font-size:12px;color:var(--dsw-alias-label-tertiary,#888)}',
          '.dsm-input{font:inherit;font-size:13px;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d6d6d6);background:var(--dsw-alias-bg-layer-2,#fafafa);color:var(--dsw-alias-label-primary,#111)}',
          '.dsm-radioList{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow:auto}',
          '.dsm-radio{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2,#e2e2e2);border-radius:9px;cursor:pointer}',
          '.dsm-radio:hover{border-color:var(--dsw-alias-brand-primary,#3b82f6)}',
          '.dsm-radioTitle{font-size:13px;color:var(--dsw-alias-label-primary,#111);white-space:nowrap}',
          '.dsm-radioPath{font-size:11px;color:var(--dsw-alias-label-tertiary,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto}',
          '.dsm-toast{position:fixed;top:24px;left:50%;transform:translateX(-50%);padding:10px 18px;border-radius:10px;font-size:13px;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,.18);display:none;pointer-events:none;transition:opacity .2s}',
          '.dsm-toast-info{background:var(--dsw-alias-bg-layer-3,#eef4ff);color:var(--dsw-alias-label-secondary,#223);border:1px solid #c7d9fc}',
          '.dsm-toast-ok{background:#e9f7ef;color:#14683c;border:1px solid #a3e0be}',
          '.dsm-toast-error{background:#ffeceb;color:#a3221a;border:1px solid #fca5a5}',
          '.dsm-toast-warn{background:#fff6e5;color:#8a5200;border:1px solid #fde68a}',
        ].join('\n')
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'dsh-session-manager: panel css')

      // 中央面板：main 是 keyed 槽（scope=root），key 必须等于左侧条目 id。
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({ t }) }, makePanel(ctx, t)),
      )

      // 左侧条目：order=21，紧接「上下文洞察」(20) 之后。
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, locale: NS, label: () => t('panel') },
          SessionGlyph,
        ),
      )

      /** 移动会话的线稿 SVG 图标。 */
      function TransferGlyph(props) {
        const size = props && props.size ? props.size : 16
        return react.createElement(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 16 16',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            focusable: 'false',
          },
          react.createElement('path', {
            d: 'M2 4.5A1.5 1.5 0 0 1 3.5 3h2.379a1.5 1.5 0 0 1 1.06.44l1.122 1.12a1.5 1.5 0 0 0 1.06.44H12.5A1.5 1.5 0 0 1 14 6.5V12a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5z',
          }),
          react.createElement('path', { d: 'M6 9.5h4m0 0-1.5-1.5m1.5 1.5-1.5 1.5' }),
        )
      }

      // 注册右键菜单专属图标
      ctx.slots.inject('contextMenu.icon', () =>
        ctx.slots.register(
          {
            name: 'contextMenu.icon',
            key: 'dsm.transfer',
          },
          TransferGlyph,
        ),
      )

      /** 全局轻量浮动 Toast 提示。 */
      function showGlobalToast(message, kind = 'info') {
        let toast = document.getElementById('dsm-global-toast')
        if (!toast) {
          toast = document.createElement('div')
          toast.id = 'dsm-global-toast'
          document.body.appendChild(toast)
        }
        toast.className = `dsm-toast dsm-toast-${kind}`
        toast.textContent = message
        toast.style.display = 'block'
        clearTimeout(toast._timer)
        toast._timer = setTimeout(() => {
          toast.style.display = 'none'
        }, 5000)
      }

      /** 全局操作模态框（原生 DOM，不受任何局部组件生命周期影响）。 */
      function showGlobalModal({ title, bodyNode, confirmText, confirmKind, onConfirm }) {
        const overlay = document.createElement('div')
        overlay.className = 'dsm-mask'

        const box = document.createElement('div')
        box.className = 'dsm-modal'
        box.setAttribute('role', 'dialog')
        box.setAttribute('aria-modal', 'true')

        const h3 = document.createElement('h3')
        h3.className = 'dsm-modalTitle'
        h3.textContent = title
        box.appendChild(h3)

        const body = document.createElement('div')
        body.className = 'dsm-modalBody'
        body.appendChild(bodyNode)
        box.appendChild(body)

        const foot = document.createElement('div')
        foot.className = 'dsm-modalFoot'

        const btnCancel = document.createElement('button')
        btnCancel.type = 'button'
        btnCancel.className = 'dsm-btn'
        btnCancel.textContent = t('cancel')
        btnCancel.onclick = () => cleanup()

        const btnConfirm = document.createElement('button')
        btnConfirm.type = 'button'
        btnConfirm.className = confirmKind === 'danger' ? 'dsm-btn dsm-btnDanger' : 'dsm-btn dsm-btnPrimary'
        btnConfirm.textContent = confirmText || t('confirm')

        let busy = false
        btnConfirm.onclick = async () => {
          if (busy) return
          busy = true
          btnConfirm.disabled = true
          btnConfirm.textContent = t('working')
          try {
            await onConfirm()
            cleanup()
          } catch (err) {
            busy = false
            btnConfirm.disabled = false
            btnConfirm.textContent = confirmText || t('confirm')
            showGlobalToast(String(err?.message || err), 'error')
          }
        }

        foot.appendChild(btnCancel)
        foot.appendChild(btnConfirm)
        box.appendChild(foot)
        overlay.appendChild(box)

        const onKey = (e) => {
          if (e.key === 'Escape') cleanup()
          if (e.key === 'Enter') btnConfirm.click()
        }
        window.addEventListener('keydown', onKey)

        function cleanup() {
          window.removeEventListener('keydown', onKey)
          overlay.remove()
        }

        overlay.onclick = (e) => {
          if (e.target === overlay) cleanup()
        }

        document.body.appendChild(overlay)
      }

      /** 会话上下文菜单：触发「移动会话」弹窗。 */
      function openSessionTransferModal(sessionId, displayTitle) {
        const wsSvc = ctx.get('workspaces')
        const wsModel = wsSvc && wsSvc.list ? wsSvc.list : wsSvc
        const snap = wsModel && typeof wsModel.getSnapshot === 'function' ? wsModel.getSnapshot() : { items: [] }
        const workspaces = Array.isArray(snap.items) ? snap.items : []

        let currentWsId = undefined
        for (const w of workspaces) {
          if (Array.isArray(w.sessionIds) && w.sessionIds.includes(sessionId)) {
            currentWsId = w.workspaceId
            break
          }
        }

        const options = workspaces.filter((w) => w.workspaceId !== currentWsId)
        if (options.length === 0) {
          showGlobalToast(t('noTarget'), 'warn')
          return
        }

        const container = document.createElement('div')
        const desc = document.createElement('p')
        desc.className = 'dsm-modalText'
        desc.textContent = format(t('confirmTransferBody'), { title: displayTitle || sessionId })
        container.appendChild(desc)

        const radioList = document.createElement('div')
        radioList.className = 'dsm-radioList'

        let selectedTargetId = options[0].workspaceId

        options.forEach((w, idx) => {
          const label = document.createElement('label')
          label.className = 'dsm-radio'

          const radio = document.createElement('input')
          radio.type = 'radio'
          radio.name = 'dsm-transfer-target'
          radio.value = w.workspaceId
          if (idx === 0) radio.checked = true
          radio.onchange = () => {
            selectedTargetId = w.workspaceId
          }

          const titleSpan = document.createElement('span')
          titleSpan.className = 'dsm-radioTitle'
          titleSpan.textContent = w.title

          const pathSpan = document.createElement('span')
          pathSpan.className = 'dsm-radioPath'
          pathSpan.textContent = w.path

          label.appendChild(radio)
          label.appendChild(titleSpan)
          label.appendChild(pathSpan)
          radioList.appendChild(label)
        })

        container.appendChild(radioList)

        const hint = document.createElement('p')
        hint.className = 'dsm-modalHint'
        hint.textContent = t('transferHint')
        container.appendChild(hint)

        showGlobalModal({
          title: t('confirmTransferTitle'),
          bodyNode: container,
          confirmText: t('confirm'),
          onConfirm: async () => {
            const resp = await fetch('/dsh-session-manager/transfer', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                sessionId,
                sourceWorkspaceId: currentWsId || options[0].workspaceId,
                targetWorkspaceId: selectedTargetId,
              }),
            })
            const data = await resp.json().catch(() => ({}))
            if (!resp.ok || data.ok === false) {
              throw new Error(data.error || '转移失败')
            }
            showGlobalToast(format(t('restartNeeded'), { n: 1 }), 'ok')
          },
        })
      }

      /** 会话上下文菜单：触发「删除会话」弹窗。 */
      function openSessionDeleteModal(sessionId, displayTitle) {
        const container = document.createElement('div')
        const desc = document.createElement('p')
        desc.className = 'dsm-modalText'
        desc.textContent = format(t('confirmDeleteBody'), { title: displayTitle || sessionId })
        container.appendChild(desc)

        showGlobalModal({
          title: t('confirmDeleteTitle'),
          bodyNode: container,
          confirmText: t('remove'),
          confirmKind: 'danger',
          onConfirm: async () => {
            const wsSvc = ctx.get('workspaces')
            if (!wsSvc || typeof wsSvc.archiveSession !== 'function') {
              throw new Error('工作区服务不可用')
            }
            await wsSvc.archiveSession(sessionId, { stopActivity: true })
            showGlobalToast(t('deletedNotice'), 'ok')
          },
        })
      }

      // 注册到会话右键菜单：移动会话 (order: 700) 与 删除会话 (order: 800)
      ctx.inject(['contextMenus'], (menuCtx) => {
        menuCtx.effect(
          () =>
            menuCtx.contextMenus.register({
              id: 'session.transfer',
              target: 'session',
              order: 700,
              resolve: (target) => [
                {
                  id: 'transfer',
                  label: t('menuTransfer'),
                  icon: { key: 'dsm.transfer' },
                  run: () => {
                    openSessionTransferModal(target.sessionId, target.displayTitle)
                  },
                },
              ],
            }),
          'dsh-session-manager: session transfer menu',
        )

        menuCtx.effect(
          () =>
            menuCtx.contextMenus.register({
              id: 'session.delete',
              target: 'session',
              order: 800,
              resolve: (target) => [
                {
                  id: 'delete',
                  label: t('menuDelete'),
                  icon: { key: 'workspace.delete' },
                  danger: true,
                  separatorBefore: true,
                  run: () => {
                    openSessionDeleteModal(target.sessionId, target.displayTitle)
                  },
                },
              ],
            }),
          'dsh-session-manager: session delete menu',
        )
      })

      // 自报：apply 跑起来即证明浏览器半侧已加载。
      try {
        fetch('/dsh-session-manager/ping', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event: 'client-applied', panel: PANEL_ID }),
          keepalive: true,
        }).catch(() => {})
      } catch {
        /* 自报失败不影响面板 */
      }
    }

    exports.name = name
    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
