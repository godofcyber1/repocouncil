@echo off
setlocal
title RepoCouncil local startup with ngrok
cd /d "%~dp0"
call "%~dp0start-local.cmd" ngrok
