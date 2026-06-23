@echo off
REM ============================================================================
REM  pcfwb.cmd — one-shot launcher for PCF Workbench
REM
REM  Drop this file at the root of any PCF project (the folder that contains
REM  pcfproj/package.json with the `npm run build` script). Double-click to
REM  build the control and open it in PCF Workbench.
REM
REM  Optional first arg overrides the control path (defaults to current dir):
REM    pcfwb.cmd                       (build CWD, launch CWD)
REM    pcfwb.cmd .\MyControl            (build CWD, launch ./MyControl)
REM    pcfwb.cmd --skip-build .\MyCtrl  (skip build, just launch)
REM ============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "SKIP_BUILD="
set "TARGET=."

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="--skip-build" (
  set "SKIP_BUILD=1"
  shift
  goto parse_args
)
set "TARGET=%~1"
shift
goto parse_args
:args_done

if not defined SKIP_BUILD (
  echo.
  echo [pcfwb] building control...
  call npm run build
  if errorlevel 1 (
    echo.
    echo [pcfwb] build failed — aborting launch.
    pause
    exit /b 1
  )
)

echo.
echo [pcfwb] launching PCF Workbench against: %TARGET%
echo         (Ctrl+C to stop)
echo.
call npx @pcfworkbench/cli@latest start --path "%TARGET%"

endlocal
