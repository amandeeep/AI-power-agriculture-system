@echo off
rem Starts all Agri-DSS services (ML service, API server, web client) in this window.
rem Usage: double-click, or run "start.bat" / "start.bat --restart" from a terminal. Ctrl+C stops everything.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed or not on PATH. & pause & exit /b 1)
node scripts\start-all.js %*
if errorlevel 1 pause
