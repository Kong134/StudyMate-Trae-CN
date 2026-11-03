param(
  [string]$PluginDir = (Join-Path $env:USERPROFILE ".trae-cn\plugins\local"),
  [string]$ExtensionDir = (Join-Path $env:USERPROFILE ".trae-cn\extensions"),
  [switch]$SkipDemo
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $root "study-mate"

if (-not (Test-Path (Join-Path $src ".trae-plugin\plugin.json"))) {
  throw "找不到插件清单：$src\.trae-plugin\plugin.json"
}

# 1) 安装 AI 插件（技能）
$target = Join-Path $PluginDir "study-mate\0.1.0"
New-Item -ItemType Directory -Force -Path $PluginDir | Out-Null
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $src "*") $target -Recurse -Force
Write-Host "AI 插件已复制到：$target" -ForegroundColor Green

# 2) 安装 VS Code 扩展（左侧工具栏入口）
$extTarget = Join-Path $ExtensionDir "studymate.study-mate-view-0.1.0"
New-Item -ItemType Directory -Force -Path $ExtensionDir | Out-Null
if (Test-Path $extTarget) { Remove-Item $extTarget -Recurse -Force }
New-Item -ItemType Directory -Force -Path $extTarget | Out-Null
Copy-Item (Join-Path $src "extension\*") $extTarget -Recurse -Force
Copy-Item (Join-Path $src "app") (Join-Path $extTarget "app") -Recurse -Force
Write-Host "VS Code 扩展已安装到：$extTarget" -ForegroundColor Green

# 3) 示例工作区（首次）
if (-not $SkipDemo) {
  $ws = Join-Path $env:USERPROFILE "StudyMate"
  if (-not (Test-Path $ws)) {
    Copy-Item (Join-Path $root "StudyMate") $ws -Recurse -Force
    Write-Host "示例工作区已创建：$ws" -ForegroundColor Green
  } else {
    Write-Host "检测到已有工作区，保持不动：$ws"
  }
}

Write-Host ""
Write-Host "接下来：" -ForegroundColor Cyan
Write-Host "1. 完全退出 Trae CN 再重新打开（扩展只在启动时加载）。"
Write-Host "2. 左侧活动栏会出现「学习搭档」图标，点开即进入学习界面。"
Write-Host "3. 若图标没出现：命令面板（Ctrl+Shift+P）搜索 'Developer: Reload Window' 重载一次。"
Write-Host "4. 也可以直接跑：node ""$extTarget\app\server.mjs"" --workspace ""$env:USERPROFILE\StudyMate"" --open"
