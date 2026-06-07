@echo off
REM ============================================================
REM   HSNT WMS - Start All Services
REM   เปิด Backend + Frontend + Browser
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

REM --- ตรวจสอบ Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] ไม่พบ Node.js ที่ %NODE_DIR%
  echo         กรุณาตรวจสอบการติดตั้ง Node.js
  pause
  exit /b 1
)

echo [1/3] เปิด Backend  (http://localhost:3001) ...
start "WMS Backend" cmd /k "set PATH=%NODE_DIR%;%PATH% && cd /d "%ROOT%backend" && npm run start:dev"

echo [2/3] รอ Backend เริ่มทำงาน (8 วินาที) ...
timeout /t 8 /nobreak >nul

echo [3/3] เปิด Frontend (http://localhost:3000) ...
start "WMS Frontend" cmd /k "set PATH=%NODE_DIR%;%PATH% && cd /d "%ROOT%frontend" && npm run dev"

echo.
echo รอ Frontend เริ่มทำงาน (10 วินาที) แล้วเปิดเบราว์เซอร์ ...
timeout /t 10 /nobreak >nul
start "" http://localhost:3000

echo.
echo ============================================
echo    เปิดบริการเรียบร้อย!
echo ============================================
echo    Frontend : http://localhost:3000
echo    Backend  : http://localhost:3001/api
echo    API Docs : http://localhost:3001/api/docs
echo.
echo    Login: admin / Admin@123
echo.
echo    *** อย่าปิดหน้าต่าง Backend และ Frontend ***
echo    ถ้าจะหยุดทั้งหมด ให้รัน  stop.bat
echo ============================================
echo.
pause
