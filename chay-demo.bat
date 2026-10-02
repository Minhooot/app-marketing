@echo off
chcp 65001 >nul
title Phone Farm Control - DEMO
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [LOI] Chua cai Node.js. Tai ban LTS tai https://nodejs.org roi chay lai file nay.
  start https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Dang cai thu vien lan dau, doi 1-2 phut...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [LOI] npm install that bai. Chup man hinh cua so nay gui cho Claude.
    pause
    exit /b 1
  )
)

echo.
echo Dang chay DEMO. Trinh duyet se tu mo sau vai giay.
echo DUNG TAT CUA SO NAY khi dang dung app. Muon tat app: dong cua so nay.
echo.
start "" cmd /c "timeout /t 3 >nul && start http://localhost:8080/social.html"
call npm run demo
pause
