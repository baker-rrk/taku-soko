@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)
echo Starting Takukobo Web (http://localhost)...
node local_server.js
if errorlevel 1 (
  echo.
  echo [ERROR] Failed to start server.
  pause
)
