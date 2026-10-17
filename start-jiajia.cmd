@echo off
cd /d "%~dp0"
start "" /b node "%~dp0tools\server.cjs"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:4181/"
