@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
echo ============================================================
echo   Busan Sangkwon Lab - LIVE dashboard
echo   Browser opens at http://localhost:8787/full
echo   KEEP THIS WINDOW OPEN. Close it to stop the server.
echo ============================================================
if not exist "%~dp0node_modules" ( echo installing... & call "%~dp0node\npm.cmd" install )
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:8787/full'"
"%NODE%" server.js
echo (server stopped)
pause
