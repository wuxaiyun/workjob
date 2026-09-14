@echo off
setlocal
title Equipment Ledger - Dev Launcher
cd /d "%~dp0"

echo ============================================
echo  Equipment Ledger - local dev environment
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [init] First run, installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
) else (
  echo [init] node_modules found, skip install.
)

echo [init] Applying D1 local migrations (safe if already applied)...
npx wrangler d1 migrations apply DB --local >nul 2>nul

echo [start] Launching backend worker on http://127.0.0.1:8787 ...
start "ledger-worker" cmd /k "npm run dev:worker"

echo [start] Launching frontend vite on http://localhost:5173 ...
start "ledger-web" cmd /k "npm run dev:web"

echo.
echo Backend:  http://127.0.0.1:8787
echo Frontend: http://localhost:5173
echo.
echo Opening browser in a moment...
timeout /t 8 /nobreak >nul
start http://localhost:5173

endlocal