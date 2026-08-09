@echo off
setlocal EnableExtensions
title ProvaE2E Phase 4 Stability Check
color 0B

set "VALIDATION_REPO=C:\Users\ajjuk\Documents\Cowork\Provae2e-phase4-final-validation"
set "FINAL_EXIT=1"
set "AUTOMATED_MODE=0"

if not exist "%VALIDATION_REPO%\package.json" (
  color 0C
  echo ERROR: Phase 4 validation repository was not found:
  echo %VALIDATION_REPO%
  goto :finish
)

cd /d "%VALIDATION_REPO%"

if not "%~1"=="" set "AUTOMATED_MODE=1"
if "%~1"=="1" goto :fast
if "%~1"=="2" goto :full
if "%~1"=="3" goto :security
if "%~1"=="4" goto :performance
if "%~1"=="5" goto :release
if "%~1"=="6" exit /b 0

:menu
cls
echo ============================================================
echo              ProvaE2E Phase 4 Stability Check
echo ============================================================
echo.
echo   1. Fast check              - after every code change
echo   2. Full stability check    - recommended daily
echo   3. Security check          - security policy and npm audit
echo   4. Performance check       - complete performance validation
echo   5. Release readiness       - all high-priority checks
echo   6. Exit
echo.
set /p "SELECTION=Choose 1-6: "

if "%SELECTION%"=="1" goto :fast
if "%SELECTION%"=="2" goto :full
if "%SELECTION%"=="3" goto :security
if "%SELECTION%"=="4" goto :performance
if "%SELECTION%"=="5" goto :release
if "%SELECTION%"=="6" exit /b 0
echo Invalid choice.
timeout /t 2 /nobreak >nul
goto :menu

:fast
call :run "Fast Phase 4 check" "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-beta.ps1 -FocusedOnly"
goto :result

:full
call :run "Full Phase 4 stability check" "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-beta.ps1"
goto :result

:security
call :run "Phase 4 security validation" "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-security.ps1"
if errorlevel 1 goto :result
call :run "Dependency security audit" "npm audit"
goto :result

:performance
call :run "Full performance validation" "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-performance.ps1 -Full"
goto :result

:release
call :run "Complete Phase 4 stability validation" "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-beta.ps1"
if errorlevel 1 goto :result
call :run "Dependency security audit" "npm audit"
if errorlevel 1 goto :result
call :run "Full performance validation" "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-phase4-performance.ps1 -Full"
if errorlevel 1 goto :result
call :run "Full credential-free integration validation" "npm run validate:integrations -- --full"
if errorlevel 1 goto :result
call :run "Package publication dry run" "npm pack --dry-run"
goto :result

:run
echo.
echo ------------------------------------------------------------
echo RUNNING: %~1
echo ------------------------------------------------------------
set "RUN_COMMAND=%~2"
call %RUN_COMMAND%
set "STEP_EXIT=%ERRORLEVEL%"
if not "%STEP_EXIT%"=="0" (
  color 0C
  echo.
  echo FAILED with exit code %STEP_EXIT%.
) else (
  color 0A
  echo.
  echo PASSED.
)
exit /b %STEP_EXIT%

:result
set "FINAL_EXIT=%ERRORLEVEL%"
echo.
echo ============================================================
if "%FINAL_EXIT%"=="0" (
  color 0A
  echo RESULT: ALL SELECTED CHECKS PASSED
) else (
  color 0C
  echo RESULT: VALIDATION FAILED - review the output above
)
echo ============================================================

:finish
echo.
if "%AUTOMATED_MODE%"=="0" pause
exit /b %FINAL_EXIT%
