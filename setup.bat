@echo off
rem One-time setup on a new PC: Python venv + packages (pinned versions), Node packages, .env files.
rem Usage: double-click, or run "setup.bat" (add --no-tf to skip TensorFlow / disease detection).
rem Needs Node.js 20+ and Python 3.11 (3.12/3.13 also work) installed. Safe to run again.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed or not on PATH. Install the LTS version from https://nodejs.org & pause & exit /b 1)
node scripts\setup.js %*
pause
