# ============================================================
# ADKM 桌面版启动脚本
# 用法：
#   右键本文件 → 使用 PowerShell 运行（默认打开 Blueprint）
#   或： .\run-adkm.ps1 "D:\另一个文件夹"
# ============================================================
param(
    [string]$Vault = "C:\Users\Janlhin\Desktop\Blueprint"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $here "src-tauri\target\release\geode.exe"

Write-Host ""
Write-Host "  ADKM" -ForegroundColor Magenta
Write-Host "  工作区：$Vault" -ForegroundColor DarkGray
Write-Host ""

if (-not (Test-Path $exe)) {
    Write-Host "未找到可执行文件：$exe" -ForegroundColor Red
    Write-Host "请先运行：npx tauri build --no-bundle" -ForegroundColor Yellow
    Write-Host "注意：只跑 cargo build 会得到界面全白的 exe。" -ForegroundColor Yellow
    Read-Host "按回车退出"
    exit 1
}

if (-not (Test-Path $Vault)) {
    Write-Host "工作区不存在：$Vault" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

$running = Get-Process geode -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "检测到已有 ADKM 在运行（PID $($running[0].Id)）。" -ForegroundColor Yellow
    Write-Host "请先关闭旧窗口再启动新工作区，或直接切到那个窗口。" -ForegroundColor DarkGray
    Read-Host "按回车退出"
    exit 0
}

$p = Start-Process -FilePath $exe -ArgumentList ('"' + $Vault + '"') -PassThru
Write-Host "已启动 PID $($p.Id)" -ForegroundColor Green
Write-Host "若首屏出现设置弹窗，点右上角 × 关掉即可看到关系图谱。" -ForegroundColor DarkGray
Write-Host ""
Start-Sleep -Seconds 2
