@echo off
REM ============================================================================
REM  pcfwb.cmd — one-shot launcher for PCF Workbench
REM
REM  Drop this file at the root of any PCF project (the folder that contains
REM  package.json with the `npm run build` script). Double-click to build the
REM  control and open it in PCF Workbench. The CLI auto-detects whether the
REM  current folder is a single control or a workspace of controls.
REM
REM  Behaviour:
REM    - No args: build, then launch against the current folder (CLI auto-
REM      detects control vs workspace mode by looking for ControlManifest.Input.xml).
REM    - Explicit path: passed through to the CLI as the positional [path] arg.
REM    - --skip-build skips `npm run build` (fast re-launch).
REM
REM  Examples:
REM    pcfwb                              build + launch (auto-detect)
REM    pcfwb --skip-build                 launch only
REM    pcfwb .\MyControl                  build + launch ./MyControl
REM    pcfwb --skip-build .\MyControl     launch ./MyControl
REM ============================================================================

setlocal
cd /d "%~dp0"

set "SKIP_BUILD="
set "TARGET="

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
    echo [pcfwb] build failed -- aborting launch.
    echo Press any key to close this window...
    pause >nul
    exit /b 1
  )
)

echo.
if defined TARGET (
  echo [pcfwb] launching PCF Workbench against: %TARGET%
) else (
  echo [pcfwb] launching PCF Workbench (auto-detecting from current folder)
)
echo         URL: http://127.0.0.1:8181
echo         (Ctrl+C to stop)
echo.

if defined TARGET (
  call npx @pcfworkbench/cli@latest start "%TARGET%" --host 127.0.0.1
) else (
  call npx @pcfworkbench/cli@latest start --host 127.0.0.1
)
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo [pcfwb] launcher exited with code %EXITCODE%.
) else (
  echo [pcfwb] launcher exited cleanly.
)
echo Press any key to close this window...
pause >nul

endlocal
