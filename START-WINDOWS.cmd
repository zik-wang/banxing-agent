@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Please install Node.js 24 first, then run this file again.
 pause
 exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<19))process.exit(1)"
if errorlevel 1 (
 echo Node.js 22.19 or newer is required. Tested with Node.js 24.
 pause
 exit /b 1
)
call npm ci --ignore-scripts
if errorlevel 1 (
 echo Dependency install failed. Check npm network access.
 pause
 exit /b 1
)
node scripts/start-mentor.mjs
pause
