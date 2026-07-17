@echo off
REM Double-clickable launcher for AIS Ticket Concierge (Windows).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Please install Node.js 20+ LTS from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies. This may take a few minutes on first run...
  call npm install
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

echo Running one-time setup (database + demo data)...
call npm run setup
if errorlevel 1 ( echo Setup failed. & pause & exit /b 1 )

echo Starting the app. The dashboard will open at http://localhost:5173
start "" http://localhost:5173
call npm run dev
pause
