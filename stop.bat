@echo off
cd /d "%~dp0"
if not exist ".run\dev.pid" (
  echo Not running.
  exit /b 0
)
set /p DEVPID=<".run\dev.pid"
taskkill /PID %DEVPID% /T /F
del ".run\dev.pid"
echo Stopped.