@echo off
REM ============================================================
REM   HSNT WMS - First-Time Setup
REM   Install dependencies + push schema + seed data
REM   *** Run once on first setup, or after moving to a new machine ***
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
  echo [ERROR] Node.js not found at %NODE_DIR%
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo Node.js %%v is ready
echo.

echo [1/5] Installing Backend dependencies ...
cd /d "%ROOT%backend"
call npm install
if errorlevel 1 ( echo [ERROR] npm install backend failed & pause & exit /b 1 )

echo.
echo [2/5] Generating Prisma Client ...
call npx prisma generate
if errorlevel 1 ( echo [ERROR] prisma generate failed & pause & exit /b 1 )

echo.
echo [3/5] Pushing schema to Supabase ...
call npx prisma db push
if errorlevel 1 ( echo [ERROR] prisma db push failed - check DATABASE_URL in backend\.env & pause & exit /b 1 )

echo.
echo [4/5] Seeding sample data ...
call npx ts-node -r tsconfig-paths/register prisma/seed.ts

echo.
echo [5/5] Installing Frontend dependencies ...
cd /d "%ROOT%frontend"
call npm install
if errorlevel 1 ( echo [ERROR] npm install frontend failed & pause & exit /b 1 )

echo.
echo ============================================
echo    Setup complete!
echo ============================================
echo    Next step: double-click  start.bat
echo.
echo    Login: admin / Admin@123
echo ============================================
echo.
pause
