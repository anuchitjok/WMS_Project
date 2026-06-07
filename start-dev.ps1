# WMS Local Development Startup Script
# Usage: .\start-dev.ps1

$nodeDir = "$env:LOCALAPPDATA\Programs\nodejs"
$env:PATH = "$nodeDir;$env:PATH"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  HSNT WMS - Local Development" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting services..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Backend  → http://localhost:3001" -ForegroundColor Green
Write-Host "  Frontend → http://localhost:3000" -ForegroundColor Green
Write-Host "  API Docs → http://localhost:3001/api/docs" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop all services" -ForegroundColor Gray
Write-Host ""

# Start backend in new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
`$env:PATH = '$nodeDir;' + `$env:PATH
Set-Location '$PSScriptRoot\backend'
Write-Host 'Starting NestJS backend...' -ForegroundColor Yellow
npm run start:dev
"@ -WindowStyle Normal

Start-Sleep -Seconds 3

# Start frontend in new window
Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
`$env:PATH = '$nodeDir;' + `$env:PATH
Set-Location '$PSScriptRoot\frontend'
Write-Host 'Starting Next.js frontend...' -ForegroundColor Yellow
npm run dev
"@ -WindowStyle Normal

Write-Host "Services launched in separate windows." -ForegroundColor Green
Write-Host ""
Write-Host "FIRST TIME SETUP:" -ForegroundColor Yellow
Write-Host "  1. Edit backend\.env with your PostgreSQL DATABASE_URL"
Write-Host "  2. cd backend && npm run db:push"
Write-Host "  3. npm run db:seed"
Write-Host ""
