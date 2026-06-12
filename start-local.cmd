@echo off
setlocal EnableExtensions
title RepoCouncil local startup
cd /d "%~dp0"

set "API_PORT=4000"
set "WEB_PORT=3100"
set "POSTGRES_SERVICE=postgresql-x64-16"
set "ENABLE_NGROK=0"

if /I "%~1"=="ngrok" set "ENABLE_NGROK=1"
if /I "%~1"=="--ngrok" set "ENABLE_NGROK=1"

echo RepoCouncil local startup
echo Root: %CD%
echo.

call :start_postgres
if errorlevel 1 goto :fail

echo Cleaning old RepoCouncil API/Web/ngrok listeners...
set "OLD_NO_PAUSE=%NO_PAUSE%"
set "NO_PAUSE=1"
call "%~dp0stop-local.cmd"
set "NO_PAUSE=%OLD_NO_PAUSE%"
timeout /t 2 /nobreak >nul

echo.
echo ==^> Prisma generate
call npm.cmd run db:generate
if errorlevel 1 goto :fail

echo.
echo ==^> Prisma migrate
call npm.cmd run db:migrate
if errorlevel 1 goto :fail

start "RepoCouncil api" cmd /k "cd /d ""%CD%"" && npm.cmd run dev:api"
start "RepoCouncil web" cmd /k "cd /d ""%CD%\apps\web"" && set API_BASE_URL=http://127.0.0.1:%API_PORT%&& npm.cmd run dev -- --hostname 127.0.0.1 --port %WEB_PORT%"

if "%ENABLE_NGROK%"=="1" (
  call :start_ngrok
  if errorlevel 1 goto :fail
)

echo.
echo RepoCouncil local startup command finished.
echo API health: http://127.0.0.1:%API_PORT%/health
echo Dashboard:  http://127.0.0.1:%WEB_PORT%
if "%ENABLE_NGROK%"=="1" (
  timeout /t 5 /nobreak >nul
  call :print_ngrok_url
)
echo.
echo Stop services with stop-local.cmd
goto :done

:start_postgres
sc query "%POSTGRES_SERVICE%" >nul 2>nul
if errorlevel 1 (
  echo PostgreSQL service "%POSTGRES_SERVICE%" was not found. Start PostgreSQL manually if needed.
  exit /b 0
)

sc query "%POSTGRES_SERVICE%" | findstr /I "RUNNING" >nul
if not errorlevel 1 (
  echo PostgreSQL service "%POSTGRES_SERVICE%" is already running.
  exit /b 0
)

echo Starting PostgreSQL service "%POSTGRES_SERVICE%"...
net start "%POSTGRES_SERVICE%"
exit /b %errorlevel%

:start_ngrok
set "NGROK_EXE=ngrok.exe"
where ngrok.exe >nul 2>nul
if errorlevel 1 (
  if exist "D:\ngrok\ngrok.exe" (
    set "NGROK_EXE=D:\ngrok\ngrok.exe"
  ) else (
    echo ngrok.exe was not found on PATH or at D:\ngrok\ngrok.exe
    exit /b 1
  )
)

start "RepoCouncil ngrok" cmd /k ""%NGROK_EXE%" http "http://127.0.0.1:%API_PORT%" --log=stdout"
exit /b 0

:print_ngrok_url
powershell -NoProfile -Command "try { $t=(Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3).tunnels | Where-Object proto -eq 'https' | Select-Object -First 1; if (-not $t) { $t=(Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 3).tunnels | Select-Object -First 1 }; if ($t) { Write-Host ('Webhook:    ' + $t.public_url + '/webhooks/github') } else { Write-Host 'Webhook:    ngrok tunnel URL not available yet. Check the RepoCouncil ngrok window.' } } catch { Write-Host 'Webhook:    ngrok tunnel URL not available yet. Check the RepoCouncil ngrok window.' }"
exit /b 0

:fail
echo.
echo RepoCouncil startup failed. Check the message above.
if not "%NO_PAUSE%"=="1" pause
exit /b 1

:done
if not "%NO_PAUSE%"=="1" pause
exit /b 0
