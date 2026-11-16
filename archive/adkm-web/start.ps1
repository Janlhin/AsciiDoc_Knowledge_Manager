# ============================================================
# ADKM 启动脚本
# 用法：
#   1) 右键本文件 →「使用 PowerShell 运行」
#   2) 或在终端执行：.\start.ps1 "D:\你的文件夹"
# ============================================================
param(
    [string]$Vault = "$env:USERPROFILE\Desktop\Blueprint"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$port = 8787
$url  = "http://127.0.0.1:$port"

Write-Host ""
Write-Host "  ADKM" -ForegroundColor Magenta
Write-Host "  工作区：$Vault" -ForegroundColor DarkGray
Write-Host ""

# ---------- 1. 环境检查 ----------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "未找到 Node.js，请先安装 Node 22 或更高版本。" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

$nodeVer = (& node --version).TrimStart("v")
$nodeMajor = [int]($nodeVer.Split(".")[0])
if ($nodeMajor -lt 22) {
    Write-Host "Node.js 版本过低（当前 $nodeVer），需要 22 或更高。" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

if (-not (Test-Path $Vault)) {
    Write-Host "工作区不存在：$Vault" -ForegroundColor Red
    Read-Host "按回车退出"
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "首次运行，正在安装依赖（可能需要几分钟）…" -ForegroundColor Yellow
    & npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Host "依赖安装失败。" -ForegroundColor Red
        Read-Host "按回车退出"
        exit 1
    }
}

if (-not (Test-Path "web\dist\index.html")) {
    Write-Host "正在构建前端…" -ForegroundColor Yellow
    & npm run build:web
    if ($LASTEXITCODE -ne 0) {
        Write-Host "前端构建失败。" -ForegroundColor Red
        Read-Host "按回车退出"
        exit 1
    }
}

# ---------- 2. 是否已有服务在跑 ----------
function Test-Adkm {
    try {
        $r = Invoke-WebRequest -Uri "$url/api/info" -UseBasicParsing -TimeoutSec 2
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

if (Test-Adkm) {
    Write-Host "检测到 ADKM 已在运行，直接打开浏览器。" -ForegroundColor Green
    Start-Process $url
    Start-Sleep -Seconds 1
    exit 0
}

# ---------- 3. 启动服务 ----------
Write-Host "正在索引并启动服务…" -ForegroundColor Cyan
$proc = Start-Process -FilePath "node" `
    -ArgumentList @("server/index.ts", $Vault) `
    -WorkingDirectory $here `
    -PassThru -WindowStyle Minimized

Write-Host "服务进程 PID：$($proc.Id)" -ForegroundColor DarkGray

# 轮询直到就绪（最多 30 秒）
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) { break }
    if (Test-Adkm) { $ready = $true; break }
}

if ($ready) {
    Write-Host ""
    Write-Host "  已启动：$url" -ForegroundColor Green
    Write-Host "  服务窗口已最小化到任务栏，关闭它即停止服务。" -ForegroundColor DarkGray
    Write-Host ""
    Start-Process $url
    Start-Sleep -Seconds 2
} else {
    Write-Host ""
    Write-Host "启动失败或超时。请查看最小化的服务窗口中的错误信息。" -ForegroundColor Red
    Read-Host "按回车退出"
}
