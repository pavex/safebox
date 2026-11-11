@echo off
cls
echo [1/4] Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 goto :fail

echo [2/4] Building dist/safebox.js...
call npm run build
if errorlevel 1 goto :fail

echo [3/4] Running tests...
call npm run test:run
if errorlevel 1 goto :fail

echo [4/4] Cleaning up node_modules...
if exist node_modules rd /s /q node_modules
if exist package-lock.json del /f /q package-lock.json

echo.
echo Done! dist/ is self-contained:
echo   dist/safebox.js - bundled CLI, run with: node dist/safebox.js --help
powershell -c "[console]::beep(1000,200)"
exit /b 0

:fail
echo.
echo BUILD FAILED
powershell -c "[console]::beep(400,500)"
exit /b 1
