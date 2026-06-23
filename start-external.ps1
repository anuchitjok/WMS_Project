param([switch]$Stop)

$ROOT       = "D:\WMS_Project"
$FRONTEND   = "$ROOT\frontend"
$BACKEND    = "$ROOT\backend"
$FE_ENV     = "$FRONTEND\.env.local"
$BE_ENV     = "$BACKEND\.env"
$PID_FILE   = "$env:TEMP\wms-pids.txt"
$FE_ENV_BAK = "$env:TEMP\wms-fe-env.bak"
$BE_ENV_BAK = "$env:TEMP\wms-be-env.bak"
$CF_BE_LOG  = "$env:TEMP\wms-cf-be.log"
$CF_FE_LOG  = "$env:TEMP\wms-cf-fe.log"
$SSH_BE_LOG = "$env:TEMP\wms-ssh-be.log"
$SSH_FE_LOG = "$env:TEMP\wms-ssh-fe.log"

$env:PATH = "$env:LOCALAPPDATA\Programs\nodejs;$ROOT;$env:PATH"

# ---------- STOP ----------
if ($Stop) {
    Write-Host "[WMS] Stopping..." -ForegroundColor Yellow
    if (Test-Path $PID_FILE) {
        Get-Content $PID_FILE | ForEach-Object {
            try { Stop-Process -Id ([int]$_) -Force -ErrorAction Stop; Write-Host "  Killed PID $_" -ForegroundColor Gray }
            catch { Write-Host "  PID $_ already gone" -ForegroundColor DarkGray }
        }
        Remove-Item $PID_FILE -Force
    }
    Get-Process -Name "cloudflared","ssh" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if (Test-Path $FE_ENV_BAK) { Copy-Item $FE_ENV_BAK $FE_ENV -Force; Remove-Item $FE_ENV_BAK; Write-Host "  Restored frontend .env.local" -ForegroundColor Green }
    if (Test-Path $BE_ENV_BAK) { Copy-Item $BE_ENV_BAK $BE_ENV -Force; Remove-Item $BE_ENV_BAK; Write-Host "  Restored backend .env" -ForegroundColor Green }
    Write-Host "[WMS] Done. .env files restored to localhost." -ForegroundColor Green
    exit 0
}

# ---------- BANNER ----------
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  HSNT WMS -- External Access Launcher" -ForegroundColor Cyan
Write-Host "  Auto-detect: Cloudflare -> SSH Tunnel" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ---------- DETECT TUNNEL ----------
$METHOD = $null
$cfExe  = $null

if (Test-Path "$ROOT\cloudflared.exe") {
    $cfExe  = "$ROOT\cloudflared.exe"
    $METHOD = "cloudflare"
} elseif (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    $cfExe  = "cloudflared"
    $METHOD = "cloudflare"
} elseif (Get-Command ssh -ErrorAction SilentlyContinue) {
    $METHOD = "ssh"
}

if (-not $METHOD) {
    Write-Host "[ERROR] No tunnel method found." -ForegroundColor Red
    Write-Host "Download cloudflared.exe (no install needed):" -ForegroundColor Yellow
    Write-Host "  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -ForegroundColor Yellow
    Write-Host "Save it as: D:\WMS_Project\cloudflared.exe" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Tunnel method: $METHOD" -ForegroundColor Green

# ---------- NODE CHECK ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js not found in PATH." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js: $(node --version)" -ForegroundColor Green

# ---------- BACKUP .ENV ----------
Copy-Item $FE_ENV $FE_ENV_BAK -Force
Copy-Item $BE_ENV $BE_ENV_BAK -Force
Write-Host "[OK] .env files backed up" -ForegroundColor Green

$allPids = @()

# ---------- HELPER: wait for URL in log file ----------
function Wait-Url {
    param([string]$File, [string]$Pattern, [int]$Timeout = 50)
    $t = 0
    Write-Host "  Connecting" -NoNewline
    while ($t -lt $Timeout) {
        Start-Sleep 2
        $t += 2
        Write-Host "." -NoNewline
        if (Test-Path $File) {
            $txt = Get-Content $File -Raw -ErrorAction SilentlyContinue
            if ($txt -match $Pattern) {
                Write-Host " ready" -ForegroundColor Green
                return $Matches[0]
            }
        }
    }
    Write-Host " TIMEOUT" -ForegroundColor Red
    return $null
}

# ---------- HELPER: start cloudflare tunnel ----------
function Start-CfTunnel {
    param([int]$Port, [string]$LogFile)
    Remove-Item $LogFile -ErrorAction SilentlyContinue
    $proc = Start-Process "cmd.exe" `
        -ArgumentList "/c `"$cfExe`" tunnel --url http://localhost:$Port --no-autoupdate > `"$LogFile`" 2>&1" `
        -WindowStyle Hidden -PassThru
    $url = Wait-Url -File $LogFile -Pattern 'https://[a-z0-9\-]+\.trycloudflare\.com'
    return @{ proc = $proc; url = $url }
}

# ---------- HELPER: start SSH tunnel ----------
function Start-SshTunnel {
    param([int]$Port, [string]$LogFile)
    Remove-Item $LogFile -ErrorAction SilentlyContinue
    Remove-Item "$LogFile.err" -ErrorAction SilentlyContinue
    foreach ($sshPort in @(22, 443)) {
        Write-Host "  Trying SSH port $sshPort..." -ForegroundColor Gray
        $proc = Start-Process "ssh" `
            -ArgumentList "-o","StrictHostKeyChecking=no","-o","ServerAliveInterval=30","-o","ConnectTimeout=15","-p",$sshPort,"-R","80:localhost:$Port","nokey@localhost.run" `
            -RedirectStandardOutput $LogFile `
            -RedirectStandardError "$LogFile.err" `
            -WindowStyle Hidden -PassThru
        $url = Wait-Url -File $LogFile -Pattern 'https://[a-z0-9]+\.lhr\.life' -Timeout 30
        if (-not $url) {
            $url = Wait-Url -File "$LogFile.err" -Pattern 'https://[a-z0-9]+\.lhr\.life' -Timeout 5
        }
        if ($url) { return @{ proc = $proc; url = $url } }
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep 2
    }
    return @{ proc = $null; url = $null }
}

# ---------- STEP 1: Start Backend ----------
Write-Host ""
Write-Host "[Step 1/5] Starting NestJS backend (port 3001)..." -ForegroundColor Yellow
$beProc = Start-Process "cmd.exe" `
    -ArgumentList "/c cd /d `"$BACKEND`" && npm run start:dev" `
    -WindowStyle Minimized -PassThru
$allPids += $beProc.Id
Write-Host "  PID $($beProc.Id) -- waiting 12s for NestJS to boot..." -ForegroundColor Gray
Start-Sleep 12

# ---------- STEP 2: Tunnel Backend ----------
Write-Host ""
Write-Host "[Step 2/5] Opening tunnel for backend (port 3001)..." -ForegroundColor Yellow
if ($METHOD -eq "cloudflare") {
    $beTunnel = Start-CfTunnel -Port 3001 -LogFile $CF_BE_LOG
} else {
    $beTunnel = Start-SshTunnel -Port 3001 -LogFile $SSH_BE_LOG
}
if (-not $beTunnel.url) {
    Write-Host "[ERROR] Could not get backend tunnel URL." -ForegroundColor Red
    exit 1
}
if ($beTunnel.proc) { $allPids += $beTunnel.proc.Id }
$backendUrl = $beTunnel.url
Write-Host "  Backend URL: $backendUrl" -ForegroundColor Green

# ---------- STEP 3: Update .env + Start Frontend ----------
Write-Host ""
Write-Host "[Step 3/5] Updating frontend .env + starting Next.js (port 3000)..." -ForegroundColor Yellow

$feEnvContent = "NEXT_PUBLIC_API_URL=`"$backendUrl`"`nNEXT_PUBLIC_SOCKET_URL=`"$backendUrl`"`nNEXT_PUBLIC_APP_NAME=`"HSNT WMS`""
[System.IO.File]::WriteAllText($FE_ENV, $feEnvContent, [System.Text.Encoding]::UTF8)

Write-Host "  NEXT_PUBLIC_API_URL    = $backendUrl" -ForegroundColor Gray
Write-Host "  NEXT_PUBLIC_SOCKET_URL = $backendUrl" -ForegroundColor Gray

$feProc = Start-Process "cmd.exe" `
    -ArgumentList "/c cd /d `"$FRONTEND`" && npm run dev:lan" `
    -WindowStyle Minimized -PassThru
$allPids += $feProc.Id
Write-Host "  PID $($feProc.Id) -- waiting 18s for Next.js compile..." -ForegroundColor Gray
Start-Sleep 18

# ---------- STEP 4: Tunnel Frontend ----------
Write-Host ""
Write-Host "[Step 4/5] Opening tunnel for frontend (port 3000)..." -ForegroundColor Yellow
if ($METHOD -eq "cloudflare") {
    $feTunnel = Start-CfTunnel -Port 3000 -LogFile $CF_FE_LOG
} else {
    $feTunnel = Start-SshTunnel -Port 3000 -LogFile $SSH_FE_LOG
}
if (-not $feTunnel.url) {
    Write-Host "[ERROR] Could not get frontend tunnel URL." -ForegroundColor Red
    exit 1
}
if ($feTunnel.proc) { $allPids += $feTunnel.proc.Id }
$frontendUrl = $feTunnel.url
Write-Host "  Frontend URL: $frontendUrl" -ForegroundColor Green

# ---------- STEP 5: Update Backend CORS + Restart ----------
Write-Host ""
Write-Host "[Step 5/5] Updating backend CORS + restarting backend..." -ForegroundColor Yellow

$beEnvRaw = [System.IO.File]::ReadAllText($BE_ENV, [System.Text.Encoding]::UTF8)
$newFrontendUrlValue = "http://localhost:3000," + $frontendUrl
$beEnvRaw = [System.Text.RegularExpressions.Regex]::Replace($beEnvRaw, 'FRONTEND_URL="[^"]*"', ('FRONTEND_URL="' + $newFrontendUrlValue + '"'))
[System.IO.File]::WriteAllText($BE_ENV, $beEnvRaw, [System.Text.Encoding]::UTF8)
Write-Host "  FRONTEND_URL = $newFrontendUrlValue" -ForegroundColor Gray

Stop-Process -Id $beProc.Id -Force -ErrorAction SilentlyContinue
$allPids = $allPids | Where-Object { $_ -ne $beProc.Id }
Start-Sleep 3

$beProc2 = Start-Process "cmd.exe" `
    -ArgumentList "/c cd /d `"$BACKEND`" && npm run start:dev" `
    -WindowStyle Minimized -PassThru
$allPids += $beProc2.Id
Write-Host "  Backend restarted -- PID $($beProc2.Id)" -ForegroundColor Gray
Start-Sleep 10

# ---------- SAVE PIDS ----------
$allPids | Set-Content $PID_FILE

# ---------- RESULT ----------
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  WMS IS LIVE -- SHARE THIS LINK:" -ForegroundColor Green
Write-Host ""
Write-Host "  $frontendUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Login:" -ForegroundColor White
Write-Host "    admin        / Admin@123"
Write-Host "    wm_manager   / Manager@123"
Write-Host "    requester01  / Staff@123"
Write-Host ""
Write-Host "  Backend API : $backendUrl" -ForegroundColor Gray
Write-Host "  Tunnel via  : $METHOD" -ForegroundColor Gray
Write-Host ""
Write-Host "  Keep this window open while sharing." -ForegroundColor Yellow
Write-Host "  To stop: .\start-external.ps1 -Stop" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Green
