@echo off
setlocal EnableExtensions
title RepoCouncil stop local services
cd /d "%~dp0"

echo Stopping RepoCouncil API/Web/ngrok listeners...
echo PostgreSQL will not be stopped.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = @(4000, 3100, 4040); foreach ($port in $ports) { $rows = netstat -ano | Select-String 'LISTENING' | Where-Object { $_.Line -match (':' + $port + '\s') }; $pids = @($rows | ForEach-Object { if ($_.Line -match '\s+(\d+)$') { [int]$Matches[1] } } | Sort-Object -Unique); if ($pids.Count -eq 0) { Write-Host ('No listener found on port ' + $port + '.'); continue }; foreach ($processId in $pids) { if ($port -eq 5432) { continue }; $process = Get-Process -Id $processId -ErrorAction SilentlyContinue; $name = if ($process) { $process.ProcessName } else { 'unknown' }; Write-Host ('Stopping listener on port ' + $port + ' PID ' + $processId + ' (' + $name + ')'); Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue } }"

if errorlevel 1 (
  echo.
  echo Stop command failed. You may need to close API/Web/ngrok windows manually.
  if not "%NO_PAUSE%"=="1" pause
  exit /b 1
)

echo.
echo Stop command finished.
if not "%NO_PAUSE%"=="1" pause
exit /b 0
