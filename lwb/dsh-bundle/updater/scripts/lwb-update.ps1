# Replace the running Laofu Workbench portable executable with a verified release.
#
# Entered through lwb-update.cmd. Every path arrives as an environment variable
# so no non-ASCII character has to survive a batch-file expansion:
# LWB_UPDATE_TARGET, LWB_UPDATE_ARTIFACT, LWB_UPDATE_VERSION, LWB_UPDATE_LOG,
# LWB_UPDATE_RESULT, LWB_UPDATE_WAIT_PID, LWB_UPDATE_HOST_PID.
#
# The portable shell keeps its own process alive while the app runs, so the
# executable stays locked for a moment after the app exits. Both the wait for
# the app and the rename are therefore retried rather than attempted once.

$ErrorActionPreference = 'Continue'

$target = $env:LWB_UPDATE_TARGET
$artifact = $env:LWB_UPDATE_ARTIFACT
$version = if ($env:LWB_UPDATE_VERSION) { $env:LWB_UPDATE_VERSION } else { 'unknown' }
$logPath = $env:LWB_UPDATE_LOG
$resultPath = $env:LWB_UPDATE_RESULT
$waitPid = 0
$hostPid = 0
[void][int]::TryParse($env:LWB_UPDATE_WAIT_PID, [ref]$waitPid)
[void][int]::TryParse($env:LWB_UPDATE_HOST_PID, [ref]$hostPid)

function Write-Log([string]$message) {
  if (-not $logPath) { return }
  try {
    Add-Content -LiteralPath $logPath -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $message) -Encoding UTF8
  } catch {}
}

function Write-Result([string]$text) {
  if (-not $resultPath) { return }
  try { Set-Content -LiteralPath $resultPath -Value $text -Encoding UTF8 } catch {}
}

function Stop-Tree([int]$processId) {
  if ($processId -le 1) { return }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($null -eq $process) { return }
  Write-Log "stopping process $processId"
  try { Stop-Process -Id $processId -ErrorAction Stop } catch { Write-Log "stop failed: $($_.Exception.Message)" }
  $deadline = (Get-Date).AddSeconds(15)
  while ($null -ne (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
    if ((Get-Date) -gt $deadline) {
      try { Stop-Process -Id $processId -Force -ErrorAction Stop } catch {}
      break
    }
    Start-Sleep -Milliseconds 300
  }
}

function Fail([string]$message) {
  Write-Log "FAILED: $message"
  Write-Result "fail $message"
  exit 1
}

if (-not $target) { Fail '未指定要替换的应用路径。' }
if (-not $artifact) { Fail '未指定更新包路径。' }
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { Fail "更新包已不存在：$artifact" }
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { Fail "当前应用不在预期位置：$target" }

Write-Log "applying $version to $target"

Stop-Tree $waitPid
if ($hostPid -ne $waitPid) { Stop-Tree $hostPid }

$backup = "$target.lwb-old"
$movedAside = $false
$attempts = 120
for ($index = 0; $index -lt $attempts; $index += 1) {
  try {
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force -ErrorAction Stop }
    Move-Item -LiteralPath $target -Destination $backup -Force -ErrorAction Stop
    $movedAside = $true
    break
  } catch {
    if ($index -eq 0) { Write-Log 'old executable is still locked; retrying' }
    Start-Sleep -Milliseconds 500
  }
}

if (-not $movedAside) { Fail '无法替换旧版本，更新包可能仍在被占用。' }

try {
  Copy-Item -LiteralPath $artifact -Destination $target -Force -ErrorAction Stop
  $source = (Get-Item -LiteralPath $artifact).Length
  $copied = (Get-Item -LiteralPath $target).Length
  if ($source -ne $copied) { throw "复制后大小不一致（$copied / $source）" }
} catch {
  Write-Log "installing the new executable failed: $($_.Exception.Message)"
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
  try { Move-Item -LiteralPath $backup -Destination $target -Force -ErrorAction Stop } catch { Write-Log "restore failed; the old executable is at $backup" }
  Fail '替换新版本失败，已尝试恢复旧版本。'
}

Write-Log "relaunching $target"
try { Start-Process -FilePath $target -ErrorAction Stop } catch { Write-Log "relaunch failed: $($_.Exception.Message)" }

Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
Write-Result "ok $version"
Write-Log 'done'
exit 0
