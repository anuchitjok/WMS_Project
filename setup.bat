@echo off
REM ============================================================
REM   HSNT WMS - First-Time Setup
REM   ติดตั้ง dependencies + push schema + seed ข้อมูล
REM   *** รันครั้งเดียวตอนเริ่มต้น หรือเมื่อย้ายเครื่อง ***
REM ============================================================
title HSNT WMS - Setup

set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
set "PATH=%NODE_DIR%;%PATH%"
set "ROOT=%~dp0"

echo.
echo ============================================
echo    HSNT WMS - First-Time Setup
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] ไม่พบ Node.js ที่ %NODE_DIR%
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo Node.js %%v พร้อมใช้งาน
echo.

echo [1/5] ติดตั้ง Backend dependencies ...
cd /d "%ROOT%backend"
call npm install
if errorlevel 1 ( echo [ERROR] npm install backend ล้มเหลว & pause & exit /b 1 )

echo.
echo [2/5] สร้าง Prisma Client ...
call npx prisma generate
if errorlevel 1 ( echo [ERROR] prisma generate ล้มเหลว & pause & exit /b 1 )

echo.
echo [3/5] Push schema ไป Supabase ...
call npx prisma db push
if errorlevel 1 ( echo [ERROR] prisma db push ล้มเหลว - ตรวจสอบ DATABASE_URL ใน backend\.env & pause & exit /b 1 )

echo.
echo [4/5] Seed ข้อมูลตัวอย่าง ...
call npx ts-node -r tsconfig-paths/register prisma/seed.ts

echo.
echo [5/5] ติดตั้ง Frontend dependencies ...
cd /d "%ROOT%frontend"
call npm install
if errorlevel 1 ( echo [ERROR] npm install frontend ล้มเหลว & pause & exit /b 1 )

echo.
echo ============================================
echo    Setup เสร็จสมบูรณ์!
echo ============================================
echo    ขั้นต่อไป: ดับเบิลคลิก  start.bat
echo.
echo    Login: admin / Admin@123
echo ============================================
echo.
pause
