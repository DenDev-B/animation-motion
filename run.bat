@echo off
cd /d "%~dp0"
if exist ".run\dev.pid" (
  echo Already running. Run stop.bat first.
  pause
  exit /b 1
)
if not exist node_modules call npm install
if not exist ".run" mkdir ".run"
powershell -NoProfile -Command "$p = Start-Process cmd.exe -ArgumentList '/c','npm run dev -- --strictPort' -WorkingDirectory '%CD%' -WindowStyle Minimized -PassThru; $p.Id | Set-Content -Path '.run\dev.pid'"
timeout /t 4 >nul
start "" http://localhost:5173/