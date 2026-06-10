@echo off
rem Change to the directory of this script
cd /d "%~dp0"

rem Ensure required npm packages are installed
if not exist node_modules (
    echo Installing npm dependencies…
    npm install
) else (
    echo npm dependencies already installed.
)

rem Start the server (development mode). Uses PORT from .env (default 5001).
echo Starting Interactive WebGIS Platform...
npm run dev
