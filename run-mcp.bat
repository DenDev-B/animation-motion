@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node 22 and run this file again.
  pause
  exit /b 1
)
if not exist node_modules call npm install
where ffmpeg >nul 2>nul
if errorlevel 1 echo WARNING: ffmpeg not found in PATH. render_frame works, export_video will not.
echo Checking the MCP server...
call npm run --silent mcp:ping
if errorlevel 1 (
  echo.
  echo MCP self-test FAILED. Send the text above to the architect.
  pause
  exit /b 1
)
where opencode >nul 2>nul
if errorlevel 1 (
  echo.
  echo Open Code is not installed or not in PATH. Install it: npm install -g opencode-ai
  echo Then run this file again, or start opencode in this folder.
  echo Test prompt: docs\MCP-TEST.md
  pause
  exit /b 0
)
echo.
echo Starting Open Code in this folder. Test prompt: docs\MCP-TEST.md
opencode
