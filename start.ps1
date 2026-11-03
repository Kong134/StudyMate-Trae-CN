$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "没有找到 Node.js。请先安装 Node 18+（https://nodejs.org），再重新运行。" -ForegroundColor Red
  Read-Host "按回车退出"
  exit 1
}

Write-Host "启动学习搭档阅读端…" -ForegroundColor Green
node "study-mate/app/server.mjs" --workspace "StudyMate" --open
