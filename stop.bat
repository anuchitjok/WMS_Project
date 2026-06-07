@echo off
REM ============================================================
REM   HSNT WMS - Stop All Services
REM   หยุด Backend + Frontend (port 3000 / 3001)
REM ============================================================
title HSNT WMS - Stop

echo.
echo ============================================
echo    HSNT WMS - Stopping Services
echo ============================================
echo.

REM --- หา PID ที่ใช้ port 3001 (Backend) แล้ว kill ---
echo หยุด Backend (port 3001) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul && echo   - stopped PID %%a
)

REM --- หา PID ที่ใช้ port 3000 (Frontend) แล้ว kill ---
echo หยุด Frontend (port 3000) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul && echo   - stopped PID %%a
)

REM --- ปิดหน้าต่าง cmd ที่ตั้งชื่อไว้ ---
taskkill /F /FI "WINDOWTITLE eq WMS Backend*" >nul 2>nul
taskkill /F /FI "WINDOWTITLE eq WMS Frontend*" >nul 2>nul

echo.
echo เรียบร้อย - หยุดบริการทั้งหมดแล้ว
echo.
pause
