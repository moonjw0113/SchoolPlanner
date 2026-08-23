@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if not errorlevel 1 (
  node server.js
  exit /b
)

set "EMBEDDED_NODE=C:\Users\MoonJunWoo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%EMBEDDED_NODE%" (
  "%EMBEDDED_NODE%" server.js
  exit /b
)

echo Node.js^가 필요합니다. Node.js 18 이상을 설치한 뒤 다시 실행해 주세요.
pause
