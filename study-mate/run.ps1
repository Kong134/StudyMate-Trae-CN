param(
  [int]$Port = 4310,
  [string]$Workspace = (Join-Path $env:USERPROFILE "StudyMate")
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $here "app\server.mjs"

if (-not (Test-Path $server)) {
  Write-Host "server.mjs not found: $server" -ForegroundColor Red
  Start-Sleep -Seconds 3
  exit 1
}

$alive = $false
try {
  $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/status" -TimeoutSec 3
  if ($r.StatusCode -eq 200) { $alive = $true }
} catch { }

if (-not $alive) {
  Start-Process -FilePath "node" -ArgumentList @(
    "`"$server`"", "--workspace", "`"$Workspace`"", "--no-open", "--port", "$Port"
  ) -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

Start-Process "http://127.0.0.1:$Port/"
