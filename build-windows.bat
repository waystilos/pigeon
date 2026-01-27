@echo off
echo Building Pigeon for Windows...
echo.

REM Check if Rust is installed
where cargo >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Rust/Cargo not found. Please install Rust from https://rustup.rs/
    pause
    exit /b 1
)

REM Check if npm is installed  
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js/npm not found. Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Install npm dependencies
echo Installing dependencies...
call npm install

REM Build the app
echo Building Pigeon...
call npm run build

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo Build successful!
    echo.
    echo Your Windows executable is at:
    echo   src-tauri\target\release\pigeon.exe
    echo.
    echo MSI installer (if created) is at:
    echo   src-tauri\target\release\bundle\msi\
    echo ========================================
) else (
    echo.
    echo Build failed. Check the errors above.
)

pause
