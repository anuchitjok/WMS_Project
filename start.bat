@echo off
REM ============================================================
REM   HSNT WMS - Start All Services
REM   Launch Backend + Frontend + Browser
REM ============================================================
title HSNT WMS Launcher

set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
set "PATH=%NODE_DIR%;%PATH%"
set "ROOT=%~dp0"

echo.
echo ============================================
echo    HSNT WMS - Starting Services
echo ============================================
echo.

REM --- Check Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found at %NODE_DIR%
  echo         Please check your Node.js installation
  pause
  exit /b 1
)

echo [1/3] Starting Backend  (http://localhost:3001) ...
start "WMS Backend" cmd /k "set PATH=%NODE_DIR%;%PATH% && cd /d "%ROOT%backend" && npm run start:dev"

echo [2/3] Waiting for Backend to start (8 seconds) ...
timeout /t 8 /nobreak >nul

echo [3/3] Starting Frontend (http://localhost:3000) ...
start "WMS Frontend" cmd /k "set PATH=%NODE_DIR%;%PATH% && cd /d "%ROOT%frontend" && npm run dev"

echo.
echo Waiting for Frontend to start (10 seconds), then opening browser ...
timeout /t 10 /nobreak >nul
start "" http://localhost:3000

echo.
echo ============================================
echo    All services started!
echo ============================================
echo    Frontend : http://localhost:3000
echo    Backend  : http://localhost:3001/api
echo    API Docs : http://localhost:3001/api/docs
echo.
echo    Login: admin / Admin@123
echo.
echo    *** Do NOT close the Backend and Frontend windows ***
echo    To stop everything, run  stop.bat
echo ============================================
echo.
pause
