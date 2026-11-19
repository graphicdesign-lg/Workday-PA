@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 22 or later before starting the personal PA.
  pause
  exit /b 1
)
node.exe personal-pa.mjs --open
if errorlevel 1 pause
