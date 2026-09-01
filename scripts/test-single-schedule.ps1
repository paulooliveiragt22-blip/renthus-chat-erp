# test-single-schedule.ps1
# Testa criacao de UM schedule EventBridge com a correcao final.
# Se der certo, basta rodar o setup-eventbridge-scheduler.ps1 completo.

$env:PROFILE = if ($env:PROFILE) { $env:PROFILE } else { "renthus" }
$env:REGION = if ($env:REGION) { $env:REGION } else { "sa-east-1" }
$env:ACCOUNT_ID = if ($env:ACCOUNT_ID) { $env:ACCOUNT_ID } else { "696457893414" }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " TESTE: criar 1 schedule usando invokeApiDestination" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Pegar ARN da API Destination recem-criada
$destArn = cmd /c "aws --profile $env:PROFILE --region $env:REGION events describe-api-destination --name renthus-dest-reactivate --query ApiDestinationArn --output text"
Write-Host "ApiDestinationArn: $destArn" -ForegroundColor Gray
Write-Host ""

if ([string]::IsNullOrWhiteSpace($destArn) -or $destArn -eq "None") {
    Write-Host "ERRO: ApiDestination renthus-dest-reactivate nao encontrada." -ForegroundColor Red
    Write-Host "Rode o setup-eventbridge-scheduler.ps1 primeiro para cria-la." -ForegroundColor Yellow
    exit 1
}

# Montar payload com o ARN correto
$invokeInput = (@{
    "ApiDestinationArn" = $destArn
    "HttpMethod"        = "GET"
} | ConvertTo-Json -Compress)

$payload = @{
    "Name"                       = "renthus-test-invoke"
    "Description"                = "Teste de criacao com invokeApiDestination"
    "ScheduleExpression"         = "at(2099-12-31T23:59:00)"
    "ScheduleExpressionTimezone" = "America/Sao_Paulo"
    "State"                      = "ENABLED"
    "FlexibleTimeWindow"         = @{ "Mode" = "OFF" }
    "ActionAfterCompletion"      = "NONE"
    "Target"                     = @{
        "Arn"     = "arn:aws:scheduler:::aws-sdk:eventbridge:invokeApiDestination"
        "RoleArn" = "arn:aws:iam::$env:ACCOUNT_ID`:role/renthus-eventbridge-scheduler-role"
        "Input"   = $invokeInput
    }
} | ConvertTo-Json -Depth 10

$tmpFile = Join-Path $env:TEMP "test-invoke.json"
[System.IO.File]::WriteAllText($tmpFile, $payload, [System.Text.UTF8Encoding]::new($false))

Write-Host "Payload enviado:" -ForegroundColor Yellow
Write-Host "------------------------------------------------------------" -ForegroundColor Gray
Get-Content $tmpFile -Raw
Write-Host ""
Write-Host "------------------------------------------------------------" -ForegroundColor Gray
Write-Host ""

Write-Host "Executando create-schedule..." -ForegroundColor Cyan
cmd /c "aws --profile $env:PROFILE --region $env:REGION scheduler create-schedule --cli-input-json file://$tmpFile --output json"
$exit = $LASTEXITCODE
Write-Host ""
Write-Host "Exit code: $exit" -ForegroundColor $(if ($exit -eq 0) { "Green" } else { "Red" })

# Limpar teste
if ($exit -eq 0) {
    Write-Host ""
    Write-Host "SUCESSO! Limpando teste..." -ForegroundColor Green
    cmd /c "aws --profile $env:PROFILE --region $env:REGION scheduler delete-schedule --name renthus-test-invoke" | Out-Null
    Write-Host ""
    Write-Host "Agora rode o setup-eventbridge-scheduler.ps1 completo:" -ForegroundColor Green
    Write-Host "  cd C:\Users\Usuario\Documents\renthus-chat-erp" -ForegroundColor White
    Write-Host "  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-eventbridge-scheduler.ps1" -ForegroundColor White
}