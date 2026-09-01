@echo off
REM =============================================================================
REM Renthus Chat + ERP - Setup de Alarmes CloudWatch + SNS
REM Wrapper .bat para evitar problemas de encoding PowerShell/Windows
REM
REM USO:
REM   setup-cloudwatch-alarms.bat              (aplicar de verdade)
REM   setup-cloudwatch-alarms.bat -DryRun     (somente simular)
REM =============================================================================

setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%setup-cloudwatch-alarms.ps1"

if not exist "%PS_SCRIPT%" (
    echo [ERR] Arquivo nao encontrado: %PS_SCRIPT%
    exit /b 1
)

REM Forcar chcp 65001 (UTF-8) no console
chcp 65001 > nul

REM Chamar PowerShell com encoding limpo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*

endlocal
