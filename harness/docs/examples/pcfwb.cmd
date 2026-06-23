@echo off
REM ============================================================================
REM  pcfwb.cmd — one-shot launcher for PCF Workbench
REM
REM  Drop this file at the root of any PCF project (the folder that contains
REM  the .pcfproj / package.json with the `npm run build` script). Double-click
REM  to build the control and open it in PCF Workbench.
REM
REM  Behaviour:
REM    - No args: build CWD, then auto-discover ControlManifest.Input.xml
REM      (CWD itself or any sub-folder, excluding node_modules / out / obj).
REM      Uses the first match. If you have multiple controls, pass the path
REM      explicitly.
REM    - Explicit path: skips auto-discovery, uses what you provided.
REM    - --skip-build skips `npm run build` (fast re-launch).
REM
REM  Examples:
REM    pcfwb                              auto-discover, build + launch
REM    pcfwb --skip-build                 auto-discover, skip build
REM    pcfwb .\MyControl                  build + launch ./MyControl
REM    pcfwb --skip-build .\MyControl     skip build, launch ./MyControl
REM ============================================================================

setlocal enabledelayedexpansion
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

REM --- Auto-discover ControlManifest.Input.xml when no explicit path given ---
if not defined TARGET (
  if exist "ControlManifest.Input.xml" (
    set "TARGET=."
  ) else (
    echo.
    echo [pcfwb] no --path arg; scanning for ControlManifest.Input.xml...
    for /r %%f in (ControlManifest.Input.xml) do (
      if not defined TARGET if exist "%%f" (
        echo %%f | findstr /v /i "\\node_modules\\ \\out\\ \\obj\\ \\bin\\ \\generated\\" >nul && set "TARGET=%%~dpf"
      )
    )
    if not defined TARGET (
      echo.
      echo [pcfwb] No ControlManifest.Input.xml found under "%CD%".
      echo Pass the control directory explicitly:  pcfwb .\YourControl
      echo Press any key to close this window...
      pause >nul
      exit /b 1
    )
    REM strip trailing backslash for cleaner display
    if "!TARGET:~-1!"=="\" set "TARGET=!TARGET:~0,-1!"
    echo [pcfwb] found: !TARGET!
  )
)

echo.
echo [pcfwb] launching PCF Workbench against: %TARGET%
echo         URL: http://127.0.0.1:8181
echo         (Ctrl+C to stop)
echo.
call npx @pcfworkbench/cli@latest start --path "%TARGET%" --host 127.0.0.1
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
