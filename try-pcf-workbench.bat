@echo off
REM ============================================================================
REM  Try PCF Workbench — quick-start with the bundled sample controls.
REM  Boots the harness in gallery mode pointed at .\samples so first-time
REM  users see ConformanceTester + DatasetGrid and can click into either.
REM
REM  Usage:  double-click this file, OR run from a terminal:
REM    try-pcf-workbench.bat            # default port 8181
REM    try-pcf-workbench.bat 5151       # custom port
REM
REM  The first run pulls npm deps (~1-2 min). Subsequent runs are instant.
REM  Press Ctrl+C in this window to stop the harness.
REM ============================================================================

setlocal

set "ROOT=%~dp0"
set "HARNESS=%ROOT%harness"
set "SAMPLES=%ROOT%samples"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=8181"

echo.
echo  ================================================================
echo    PCF Workbench — Try-It-Out
echo  ================================================================
echo    Workspace : %SAMPLES%
echo    Controls  : ConformanceTester, DatasetGrid
echo    URL       : http://localhost:%PORT%/
echo    Stop      : Ctrl+C
echo  ================================================================
echo.

if not exist "%HARNESS%\node_modules" (
    echo  [setup] First run — installing harness dependencies...
    pushd "%HARNESS%" >nul
    call npm install --no-audit --no-fund --loglevel=error
    if errorlevel 1 (
        popd >nul
        echo.
        echo  [error] npm install failed. Make sure Node.js 18+ is installed.
        exit /b 1
    )
    popd >nul
    echo.
)

REM Make sure each sample has a bundle.js so the gallery can launch it.
REM The build is fast and only runs when the bundle is missing.
call :ensure_bundle "%SAMPLES%\ConformanceTester" "ConformanceTester"
if errorlevel 1 exit /b 1
call :ensure_bundle "%SAMPLES%\DatasetGrid" "DatasetGrid"
if errorlevel 1 exit /b 1

echo  [run] Launching harness...
echo.

pushd "%HARNESS%" >nul
set "PCF_WORKSPACE_ROOT=%SAMPLES%"
set "PCF_NO_WATCH=1"
call npx vite --port %PORT% --host 127.0.0.1
set "EXITCODE=%ERRORLEVEL%"
popd >nul

exit /b %EXITCODE%

:ensure_bundle
set "SAMPLE_DIR=%~1"
set "CTRL_NAME=%~2"
if exist "%SAMPLE_DIR%\out\controls\%CTRL_NAME%\bundle.js" (
    exit /b 0
)
echo  [build] %CTRL_NAME% — building bundle for first use...
pushd "%SAMPLE_DIR%" >nul
if not exist node_modules (
    call npm install --no-audit --no-fund --loglevel=error
    if errorlevel 1 (
        popd >nul
        echo.
        echo  [error] %CTRL_NAME%: npm install failed.
        exit /b 1
    )
)
call npm run build
if errorlevel 1 (
    popd >nul
    echo.
    echo  [error] %CTRL_NAME%: build failed.
    exit /b 1
)
popd >nul
echo.
exit /b 0
