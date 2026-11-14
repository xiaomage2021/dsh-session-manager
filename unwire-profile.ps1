# Unwire dsh-session-manager from desktop profile. Idempotent.
$ErrorActionPreference = 'Stop'

$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$pkgJson = Join-Path $profileDir 'package.json'
$linkPath = Join-Path $profileDir 'node_modules\dsh-session-manager'

if (-not (Test-Path $pkgJson)) { throw "profile package.json missing: $pkgJson" }

# 1) 备份
$backup = "$pkgJson.bak-unwire-session-manager-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item $pkgJson $backup
Write-Output "backup -> $backup"

# 2) package.json
$raw = Get-Content $pkgJson -Raw -Encoding UTF8
$json = $raw | ConvertFrom-Json

if ($json.dependencies.PSObject.Properties.Name -contains 'dsh-session-manager') {
  $json.dependencies.PSObject.Properties.Remove('dsh-session-manager')
  Write-Output "dependencies -= dsh-session-manager"
}

$bundles = @($json.dsh.profile.bundles) | Where-Object { $_ -ne 'dsh-session-manager' }
$json.dsh.profile.bundles = @($bundles)
Write-Output "bundles -= dsh-session-manager"

$out = ($json | ConvertTo-Json -Depth 20) -replace "`r`n", "`n"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($pkgJson, $out + "`n", $utf8NoBom)
Write-Output "written -> $pkgJson"

# 3) 移除 junction
if (Test-Path $linkPath) {
  Remove-Item $linkPath -Force -Recurse -ErrorAction SilentlyContinue
  Write-Output "junction removed -> $linkPath"
}

Write-Output '=== dsh-session-manager unwire-profile complete ==='
