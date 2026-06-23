@echo off
REM ============================================================
REM   HSNT WMS - Stop All Services
REM   Stop Backend + Frontend (port 3000 / 3001)
REM ============================================================
title HSNT WMS - Stop

echo.
echo ============================================
echo    HSNT WMS - Stopping Services
echo ============================================
echo.

REM --- Find PID using port 3001 (Backend) and kill it ---
echo Stopping Backend (port 3001) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul && echo   - stopped PID %%a
)

REM --- Find PID using port 3000 (Frontend) and kill it ---
echo Stopping Frontend (port 3000) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul && echo   - stopped PID %%a
)

REM --- Close named cmd windows ---
taskkill /F /FI "WINDOWTITLE eq WMS Backend*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq WMS Frontend*" >nul 2>nul

echo.
echo Done - all services stopped
echo.
pause
