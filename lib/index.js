/**
 * dsh-session-manager 宿主半身。
 *
 * 本体在浏览器侧（`./client`）。这里承担两件浏览器做不到的事：
 *   1) 让 profile 层栈里有一行可加载的插件（否则浏览器半侧不会被送到 /plugins）；
 *   2) 提供「会话跨工作区转移」的宿主侧实现——DSH 本体没有这个 RPC，
 *      只有 `workspace.attachSession()`，而它硬校验「会话头 cwd 必须等于
 *      工作区路径」，所以真正转移必须同时改三处：
 *          · 会话文件首帧头部里的 cwd
 *          · 会话目录在 sessions/<projectKey>/ 下的归属
 *          · storages/workspace.json 里两个工作区的 sessionIds
 *
 * 为什么必须重启：工作区注册表在启动时把会话头索引进内存
 * （`sessionPaths`），运行期不重读；`workspace.json` 也是内存态权威。
 * 所以转移完成后必须重启 DSH 才生效——面板会明确提示。
 *
 * 安全边界（对齐工作区禁令：禁止盲跑、禁止物理硬删除）：
 *   · 运行中的会话一律拒绝转移；
 *   · 动手前把会话目录与 workspace.json 完整备份到插件数据目录；
 *   · 只重写首帧（该帧只含头部），其余 zstd 帧逐字节原样保留；
 *   · 落地后逐帧校验，任何一步失败立即回滚备份。
 *
 * 自检：GET /dsh-session-manager/ping
 *   404 → 宿主行没加载；200 但 client 为 null → 浏览器还没重新加载。
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

/** 稳定的 cordis 插件名，与 package.json 的 name 一致。 */
export const name = 'dsh-session-manager'

/** webServer 走可选注入，避免启动顺序问题。 */
export const inject = []

/** 自检路由。 */
const PING_PATH = '/dsh-session-manager/ping'
/** 转移路由。 */
const TRANSFER_PATH = '/dsh-session-manager/transfer'
/** 彻底删除路由。 */
const PURGE_PATH = '/dsh-session-manager/purge'
/** 请求体上限（防御性截断）。 */
const MAX_BODY_BYTES = 64 * 1024
/** zstd 帧魔数。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * 读取请求体。
 * @param req - Node 请求对象。
 * @returns 请求体文本。
 */
function readBody(req) {
  return new Promise((resolve) => {
    let text = ''
    req.setEncoding?.('utf8')
    req.on('data', (chunk) => {
      if (text.length >= MAX_BODY_BYTES) return
      text += String(chunk)
    })
    req.on('end', () => resolve(text.slice(0, MAX_BODY_BYTES)))
    req.on('error', () => resolve(text.slice(0, MAX_BODY_BYTES)))
  })
}

/**
 * 解析 DSH 主目录。
 * @param ctx - 宿主插件上下文。
 * @returns 主目录绝对路径。
 */
function dshHome(ctx) {
  const fromService = ctx.get?.('homePaths')
  const candidate = fromService?.home ?? process.env.DSH_HOME
  if (typeof candidate === 'string' && candidate !== '') return candidate
  return path.join(os.homedir(), '.dsh')
}

/**
 * 复刻会话持久化层的项目目录键算法。
 * 分隔符（/ \ :）压成单个 `-`；安全字符原样保留；其余按 `~XXXX` 转义。
 * @param cwd - 项目目录。
 * @returns 单层目录名。
 */
function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * 在 sessions 根下定位某个会话所属的实际目录。
 * 目录名可能与其头部 cwd 不一致（历史数据），所以按会话 id 目录名扫描。
 * @param sessionsRoot - sessions 根目录。
 * @param sessionId - 会话 id。
 * @returns 会话目录绝对路径，或 undefined。
 */
function findSessionDir(sessionsRoot, sessionId) {
  let projects
  try {
    projects = fs.readdirSync(sessionsRoot, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const candidate = path.join(sessionsRoot, project.name, sessionId)
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate
    } catch {
      /* 下一个 */
    }
  }
  return undefined
}

/**
 * 读取会话文件，拆出首帧与其余字节。
 * @param file - 会话文件路径。
 * @returns `{ first, rest, raw }`，`first` 为首帧解压后的文本。
 */
function splitSessionFile(file) {
  const raw = fs.readFileSync(file)
  const firstFrame = zlib.zstdDecompressSync(raw)
  const candidates = []
  let p = 0
  while ((p = raw.indexOf(ZSTD_MAGIC, p)) !== -1) {
    candidates.push(p)
    p += 4
  }
  let boundary = -1
  for (const c of candidates) {
    if (c === 0) continue
    try {
      const out = zlib.zstdDecompressSync(raw.subarray(0, c))
      if (out.length === firstFrame.length && out.equals(firstFrame)) {
        boundary = c
        break
      }
    } catch {
      /* 不是帧边界 */
    }
  }
  if (boundary < 0) throw new Error('无法定位会话文件的首帧边界，已中止（未做任何写入）')
  return { first: firstFrame.toString('utf8'), rest: raw.subarray(boundary), raw }
}

/**
 * 逐帧解压统计，用于落地后校验。
 * @param buf - 会话文件字节。
 * @returns `{ frames, ok, fail, total }`。
 */
function decodeStats(buf) {
  const hits = []
  let q = 0
  while ((q = buf.indexOf(ZSTD_MAGIC, q)) !== -1) {
    hits.push(q)
    q += 4
  }
  let ok = 0
  let fail = 0
  let total = 0
  for (let i = 0; i < hits.length; i++) {
    const s = hits[i]
    const e = i + 1 < hits.length ? hits[i + 1] : buf.length
    try {
      total += zlib.zstdDecompressSync(buf.subarray(s, e)).length
      ok++
    } catch {
      fail++
    }
  }
  return { frames: hits.length, ok, fail, total }
}

/**
 * 把首帧头部里的 cwd 换成目标路径，其余帧原样拼回。
 * @param file - 会话文件路径。
 * @param nextCwd - 目标工作区路径。
 * @returns 新文件字节。
 */
function rewriteHeaderCwd(file, nextCwd) {
  const { first, rest } = splitSessionFile(file)
  const headerText = first.replace(/\n+$/, '')
  const header = JSON.parse(headerText)
  const previousCwd = header.cwd
  header.cwd = nextCwd
  const recompressed = zlib.zstdCompressSync(Buffer.from(JSON.stringify(header), 'utf8'))
  return { buffer: Buffer.concat([recompressed, rest]), previousCwd }
}

/**
 * 读取并解析 workspace.json。
 * @param file - 文件路径。
 * @returns 解析后的对象。
 */
function readWorkspaceJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/**
 * 在 workspace.json 里把会话从一个工作区挪到另一个。
 * @param data - 已解析的 workspace.json。
 * @param sessionId - 会话 id。
 * @param fromId - 源工作区 id。
 * @param toId - 目标工作区 id。
 * @returns 是否发生了变化。
 */
function moveSessionAccounting(data, sessionId, fromId, toId) {
  const table = data?.tables?.workspaces
  if (table === undefined) throw new Error('workspace.json 结构异常：缺少 tables.workspaces')
  const from = table[fromId]
  const to = table[toId]
  if (from === undefined || to === undefined) throw new Error('workspace.json 里找不到源或目标工作区记录')
  let changed = false
  if (Array.isArray(from.sessionIds)) {
    const next = from.sessionIds.filter((id) => id !== sessionId)
    if (next.length !== from.sessionIds.length) {
      from.sessionIds = next
      from.updatedAt = new Date().toISOString()
      changed = true
    }
  }
  if (!Array.isArray(to.sessionIds)) to.sessionIds = []
  if (!to.sessionIds.includes(sessionId)) {
    to.sessionIds = [sessionId, ...to.sessionIds]
    to.updatedAt = new Date().toISOString()
    changed = true
  }
  return changed
}

/**
 * 原子写文件。
 * @param file - 目标路径。
 * @param content - 内容。
 */
function writeAtomic(file, content) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, content)
  fs.renameSync(tmp, file)
}

/**
 * 判断某个会话是否**真正在运行**。
 *
 * 宿主语义：`agents.get(id)` 返回的是「已加载进内存的 Agent」，
 * 空闲会话同样会返回实例；唯一可靠的运行判据是 `agent.status === 'running'`
 * （宿主自己的 sessions 列表摘要就是用它算 `running` 字段）。
 * @param ctx - 宿主插件上下文。
 * @param sessionId - 会话 id。
 * @returns 是否正在运行。
 */
function isAgentRunning(ctx, sessionId) {
  try {
    const agents = ctx.get?.('agents')
    if (agents === undefined || typeof agents.get !== 'function') return false
    const agent = agents.get(sessionId)
    return agent !== undefined && agent.status === 'running'
  } catch {
    return false
  }
}

/**
 * 执行一次会话跨工作区转移。
 * @param ctx - 宿主插件上下文。
 * @param options - `{ sessionId, sourceWorkspaceId, targetWorkspaceId }`。
 * @returns 结果对象。
 */
function transfer(ctx, options) {
  const { sessionId, sourceWorkspaceId, targetWorkspaceId } = options
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('sessionId 缺失')
  if (typeof targetWorkspaceId !== 'string' || targetWorkspaceId === '') throw new Error('targetWorkspaceId 缺失')
  if (sourceWorkspaceId === targetWorkspaceId) throw new Error('源工作区与目标工作区相同')

  // 运行中的会话拒绝转移：宿主持有写句柄，改写会损坏日志。
  // 注意：agents.get(id) 只代表「会话已加载进内存」，空闲会话同样会返回，
  // 真正的运行判据是 agent.status === 'running'（见宿主 sessions 列表实现）。
  if (isAgentRunning(ctx, sessionId)) {
    throw new Error('该会话正在运行，请先停止后再转移')
  }

  const home = dshHome(ctx)
  const sessionsRoot = path.join(home, 'sessions')
  const workspaceJsonPath = path.join(home, 'storages', 'workspace.json')

  const data = readWorkspaceJson(workspaceJsonPath)
  const table = data?.tables?.workspaces ?? {}
  const source = table[sourceWorkspaceId]
  const target = table[targetWorkspaceId]
  if (source === undefined || target === undefined) throw new Error('找不到源或目标工作区')
  if (!Array.isArray(target.sessionIds)) target.sessionIds = []

  const sourceDir = findSessionDir(sessionsRoot, sessionId)
  if (sourceDir === undefined) throw new Error('找不到该会话的存储目录')

  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.jsonl.zstd'))
  if (files.length === 0) throw new Error('会话目录里没有可识别的主日志文件')

  const targetDir = path.join(sessionsRoot, projectKey(target.path), sessionId)

  // 备份：会话目录 + workspace.json
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupRoot = path.join(home, 'session-manager-backups', stamp)
  fs.mkdirSync(backupRoot, { recursive: true })
  fs.cpSync(sourceDir, path.join(backupRoot, sessionId), { recursive: true })
  fs.copyFileSync(workspaceJsonPath, path.join(backupRoot, 'workspace.json'))

  const steps = []
  try {
    // 1) 改写每个日志文件的首帧 cwd
    for (const fileName of files) {
      const file = path.join(sourceDir, fileName)
      const { buffer, previousCwd } = rewriteHeaderCwd(file, target.path)
      const stats = decodeStats(buffer)
      if (stats.fail !== 0) throw new Error(`${fileName} 改写后出现 ${stats.fail} 个无法解压的帧，已中止`)
      writeAtomic(file, buffer)
      steps.push({ fileName, from: previousCwd, to: target.path, frames: stats.frames })
    }

    // 2) 把会话目录挪到目标工作区的项目目录下
    fs.mkdirSync(path.dirname(targetDir), { recursive: true })
    if (fs.existsSync(targetDir)) throw new Error(`目标目录已存在同名会话：${targetDir}`)
    fs.renameSync(sourceDir, targetDir)

    // 3) 更新工作区账本
    const changed = moveSessionAccounting(data, sessionId, sourceWorkspaceId, targetWorkspaceId)
    if (changed) writeAtomic(workspaceJsonPath, JSON.stringify(data, null, 2) + '\n')

    return {
      ok: true,
      sessionId,
      from: { workspaceId: sourceWorkspaceId, path: source.path },
      to: { workspaceId: targetWorkspaceId, path: target.path },
      movedTo: targetDir,
      backup: backupRoot,
      steps,
      restartRequired: true,
    }
  } catch (error) {
    // 回滚
    try {
      for (const step of steps) {
        const file = path.join(targetDir, step.fileName)
        if (fs.existsSync(file)) {
          const restored = rewriteHeaderCwd(file, step.from)
          writeAtomic(file, restored.buffer)
        }
      }
      if (fs.existsSync(targetDir) && !fs.existsSync(sourceDir)) fs.renameSync(targetDir, sourceDir)
      fs.copyFileSync(path.join(backupRoot, 'workspace.json'), workspaceJsonPath)
    } catch {
      /* 回滚尽力而为；备份仍在 */
    }
    throw error
  }
}

/**
 * 彻底清除（彻底删除）一个或多个会话。
 * 对齐规约：禁止硬粉碎，将原始数据移入 ~/.dsh/_回收站/ 缓冲。
 * 并从 workspace.json 与缓存中彻底清除其所有账本记录。
 * @param ctx - 宿主插件上下文。
 * @param options - `{ sessionIds: string[] }`。
 * @returns 结果对象。
 */
function purge(ctx, options) {
  const sessionIds = Array.isArray(options?.sessionIds)
    ? options.sessionIds.filter((id) => typeof id === 'string' && id !== '')
    : []
  if (sessionIds.length === 0) throw new Error('缺少要彻底删除的 sessionIds')

  // 1. 过滤出真正在运行的会话：不再因「已加载但空闲」而整批失败
  const runningIds = sessionIds.filter((id) => isAgentRunning(ctx, id))
  const targets = sessionIds.filter((id) => !runningIds.includes(id))
  if (targets.length === 0) {
    throw new Error(`选中的会话正在运行，无法彻底删除，请先停止：${runningIds.join('、')}`)
  }

  const home = dshHome(ctx)
  const sessionsRoot = path.join(home, 'sessions')
  const workspaceJsonPath = path.join(home, 'storages', 'workspace.json')
  const projCacheDir = path.join(home, 'storages', 'session_projcache', 'sessions')

  // 缓冲回收站根目录（带时间戳，严格对齐禁止物理硬删除底线）
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const trashRoot = path.join(home, '_回收站', `sessions-purged-${stamp}`)
  fs.mkdirSync(trashRoot, { recursive: true })

  // 备份 workspace.json
  if (fs.existsSync(workspaceJsonPath)) {
    fs.copyFileSync(workspaceJsonPath, path.join(trashRoot, 'workspace.json.bak'))
  }

  const purged = []
  const missing = []

  // 2. 迁移物理目录
  for (const sessionId of targets) {
    const dir = findSessionDir(sessionsRoot, sessionId)
    if (dir && fs.existsSync(dir)) {
      const dest = path.join(trashRoot, sessionId)
      fs.renameSync(dir, dest)
      purged.push(sessionId)
    } else {
      missing.push(sessionId)
    }

    // 清理 projcache 文件
    try {
      const cacheFile = path.join(projCacheDir, `${sessionId}.json`)
      if (fs.existsSync(cacheFile)) {
        const destCache = path.join(trashRoot, `${sessionId}.projcache.json`)
        fs.renameSync(cacheFile, destCache)
      }
    } catch {}
  }

  // 3. 从 workspace.json 账本中彻底清除
  let changed = false
  if (fs.existsSync(workspaceJsonPath)) {
    try {
      const data = readWorkspaceJson(workspaceJsonPath)
      const purgeSet = new Set(targets)

      // 3.1 清除 global.archivedSessionIds
      if (Array.isArray(data?.global?.archivedSessionIds)) {
        const nextArchived = data.global.archivedSessionIds.filter((id) => !purgeSet.has(id))
        if (nextArchived.length !== data.global.archivedSessionIds.length) {
          data.global.archivedSessionIds = nextArchived
          changed = true
        }
      }

      // 3.2 清除 global.pinnedSessionIds
      if (Array.isArray(data?.global?.pinnedSessionIds)) {
        const nextPinned = data.global.pinnedSessionIds.filter((id) => !purgeSet.has(id))
        if (nextPinned.length !== data.global.pinnedSessionIds.length) {
          data.global.pinnedSessionIds = nextPinned
          changed = true
        }
      }

      // 3.3 清除各个工作区的 sessionIds
      const table = data?.tables?.workspaces ?? {}
      for (const ws of Object.values(table)) {
        if (Array.isArray(ws?.sessionIds)) {
          const nextWsSessions = ws.sessionIds.filter((id) => !purgeSet.has(id))
          if (nextWsSessions.length !== ws.sessionIds.length) {
            ws.sessionIds = nextWsSessions
            ws.updatedAt = new Date().toISOString()
            changed = true
          }
        }
      }

      if (changed) {
        writeAtomic(workspaceJsonPath, JSON.stringify(data, null, 2) + '\n')
      }
    } catch (e) {
      // 容错记录
    }
  }

  return {
    ok: true,
    purgedCount: purged.length,
    purgedSessionIds: purged,
    missingSessionIds: missing,
    skippedRunning: runningIds,
    trashDir: trashRoot,
  }
}

/**
 * 挂载自检与转移路由。
 * @param ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  if (typeof ctx.inject !== 'function') return
  /** 浏览器半侧最近一次自报（进程内，重启即清空）。 */
  let lastClientReport = null

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: PING_PATH,
          handler: async (req, res) => {
            const send = (status, payload) => {
              res.statusCode = status
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.setHeader('cache-control', 'no-store')
              res.end(JSON.stringify(payload))
            }
            if (req.method === 'POST') {
              const raw = await readBody(req)
              try {
                lastClientReport = { at: new Date().toISOString(), ...JSON.parse(raw) }
              } catch {
                return send(400, { error: 'invalid json' })
              }
              return send(200, { ok: true })
            }
            if (req.method !== 'GET') return send(405, { error: 'method not allowed' })
            send(200, { ok: true, plugin: name, panel: 'session-manager', client: lastClientReport })
          },
        }),
      'dsh-session-manager: ping route',
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: TRANSFER_PATH,
          handler: async (req, res) => {
            const send = (status, payload) => {
              res.statusCode = status
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.setHeader('cache-control', 'no-store')
              res.end(JSON.stringify(payload))
            }
            if (req.method !== 'POST') return send(405, { error: 'method not allowed' })
            const raw = await readBody(req)
            let parsed
            try {
              parsed = JSON.parse(raw)
            } catch {
              return send(400, { ok: false, error: 'invalid json' })
            }
            try {
              const result = transfer(ctx, parsed)
              webCtx.logger?.info?.(`dsh-session-manager: 已转移 ${parsed.sessionId} -> ${parsed.targetWorkspaceId}`)
              return send(200, result)
            } catch (error) {
              const message = String((error && error.message) || error)
              webCtx.logger?.warn?.(`dsh-session-manager: 转移失败 ${parsed?.sessionId}: ${message}`)
              return send(400, { ok: false, error: message })
            }
          },
        }),
      'dsh-session-manager: transfer route',
    )

    webCtx.effect(
      () =>
        webCtx.webServer.register({
          kind: 'exact',
          path: PURGE_PATH,
          handler: async (req, res) => {
            const send = (status, payload) => {
              res.statusCode = status
              res.setHeader('content-type', 'application/json; charset=utf-8')
              res.setHeader('cache-control', 'no-store')
              res.end(JSON.stringify(payload))
            }
            if (req.method !== 'POST') return send(405, { error: 'method not allowed' })
            const raw = await readBody(req)
            let parsed
            try {
              parsed = JSON.parse(raw)
            } catch {
              return send(400, { ok: false, error: 'invalid json' })
            }
            try {
              const result = purge(ctx, parsed)
              webCtx.logger?.info?.(`dsh-session-manager: 已彻底删除 ${result.purgedCount} 个会话`)
              return send(200, result)
            } catch (error) {
              const message = String((error && error.message) || error)
              webCtx.logger?.warn?.(`dsh-session-manager: 彻底删除失败: ${message}`)
              return send(400, { ok: false, error: message })
            }
          },
        }),
      'dsh-session-manager: purge route',
    )
  })
}
