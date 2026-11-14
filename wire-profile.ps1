# Wire dsh-session-manager into the desktop profile. Idempotent.
$ErrorActionPreference = 'Stop'

$pluginDir = $PSScriptRoot
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$pkgJson = Join-Path $profileDir 'package.json'
$linkPath = Join-Path $profileDir 'node_modules\dsh-session-manager'

if (-not (Test-Path $pluginDir)) { throw "plugin dir missing: $pluginDir" }
if (-not (Test-Path $pkgJson)) { throw "profile package.json missing: $pkgJson" }

# 1) 自动前置备份（带时间戳）
$backup = "$pkgJson.bak-session-manager-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $pkgJson $backup
Write-Output "backup -> $backup"

# 2) package.json: dependencies + dsh.profile.bundles
$raw = Get-Content $pkgJson -Raw -Encoding UTF8
$json = $raw | ConvertFrom-Json

$linkTarget = "link:" + $pluginDir.Replace('\', '/')
if ($json.dependencies.PSObject.Properties.Name -notcontains 'dsh-session-manager') {
  $json.dependencies | Add-Member -NotePropertyName 'dsh-session-manager' -NotePropertyValue $linkTarget
  Write-Output "dependencies += dsh-session-manager ($linkTarget)"
} else {
  $json.dependencies.'dsh-session-manager' = $linkTarget
  Write-Output "dependencies update -> $linkTarget"
}

$bundles = @($json.dsh.profile.bundles)
if ($bundles -notcontains 'dsh-session-manager') {
  $json.dsh.profile.bundles = @($bundles + 'dsh-session-manager')
  Write-Output "bundles += dsh-session-manager"
}

$out = ($json | ConvertTo-Json -Depth 20) -replace "`r`n", "`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($pkgJson, $out + "`n", $utf8NoBom)
Write-Output "written -> $pkgJson"

# 3) junction inside node_modules
if (Test-Path $linkPath) {
  # 如果已存在，先移除旧连接再重建
  Remove-Item $linkPath -Force -Recurse -ErrorAction SilentlyContinue
}
New-Item -ItemType Junction -Path $linkPath -Target $pluginDir | Out-Null
Write-Output "junction created -> $linkPath => $pluginDir"

Write-Output '=== dsh-session-manager wire-profile complete ==='
