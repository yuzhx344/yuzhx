@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先在打开的官网安装 Node.js 24 或以上版本，然后重新双击本文件。
  start "" "https://nodejs.org/zh-cn/download"
  pause
  exit /b 1
)
node scripts\open-local.mjs
pause
