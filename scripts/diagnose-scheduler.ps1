# diagnose-scheduler.ps1
# Diagnostica por que o create-schedule falha com exit=254.
# Le o JSON gerado pelo setup-eventbridge-scheduler.ps1 e roda o aws CLI sem
# redirecionamento, mostrando o erro REAL.

$env:PROFILE = if ($env:PROFILE) { $env:PROFILE } else { "renthus" }
$env:REGION  = if ($env:REGION)  { $env:REGION }  else { "sa-east-1" }

$tmpDir = Join-Path $env:TEMP "renthus-scheduler"
$inputFile = Join-Path $tmpDir "input-reactivate.json"

if (-not (Test-Path $inputFile)) {
    Write-Host "[ERR] Arquivo nao encontrado: $inputFile" -ForegroundColor Red
    Write-Host "      Rode o setup-eventbridge-scheduler.ps1 primeiro para gerar o JSON."
    exit 1
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " DIAGNOSTICO: create-schedule com input do primeiro job" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Input JSON ($inputFile):" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------" -ForegroundColor Gray
Get-Content $inputFile -Raw
Write-Host ""
Write-Host "------------------------------------------------------------" -ForegroundColor Gray
Write-Host ""

Write-Host "Rodando create-schedule (saida REAL, sem redirecionamento)..." -ForegroundColor Cyan
Write-Host ""

# cmd /c para que o PowerShell NAO esconda o stderr em RemoteException
cmd /c "aws --profile $env:PROFILE --region $env:REGION scheduler create-schedule --cli-input-json file://$inputFile --output json"
$exit = $LASTEXITCODE

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " AWS CLI exit code: $exit" -ForegroundColor $(if ($exit -eq 0) { "Green" } else { "Red" })
Write-Host "============================================================" -ForegroundColor Cyan

if ($exit -ne 0) {
    Write-Host ""
    Write-Host "Hipoteses provaveis (com base no exit=$exit):" -ForegroundColor Yellow
    Write-Host "  1. RetryPolicy nao e aceito em Target - remova esse bloco" -ForegroundColor White
    Write-Host "  2. Input = '{}' pode nao ser valido - tente Input = '' (vazio)" -ForegroundColor White
    Write-Host "  3. Arn do API Destination invalido - confira se ARN tem /<uuid>" -ForegroundColor White
    Write-Host "  4. Permissao scheduler:CreateSchedule faltando no IAM user" -ForegroundColor White
    exit 1
}

exit 0