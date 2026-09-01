# test-target-arn.ps1
# Testa varias hipoteses de Target.Arn aceitas pelo EventBridge Scheduler.
# Retorna o JSON skeleton para sabermos a estrutura EXATA esperada.

$env:PROFILE = if ($env:PROFILE) { $env:PROFILE } else { "renthus" }
$env:REGION = if ($env:REGION) { $env:REGION } else { "sa-east-1" }
$env:ACCOUNT_ID = if ($env:ACCOUNT_ID) { $env:ACCOUNT_ID } else { "696457893414" }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " GERANDO JSON SKELETON OFICIAL - aws scheduler create-schedule" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$skel = cmd /c "aws --profile $env:PROFILE --region $env:REGION scheduler create-schedule --generate-cli-skeleton input --output json 2>&1"
Write-Host $skel
Write-Host ""

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " HIPOTESES DE ARN - Teste cada uma manualmente" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Hipotese A (invoke API Destination via SDK):" -ForegroundColor Yellow
Write-Host "  arn:aws:scheduler:::aws-sdk:eventbridge:invokeApiDestination" -ForegroundColor White
Write-Host ""
Write-Host "Hipotese B (invoke generico SDK):" -ForegroundColor Yellow
Write-Host "  arn:aws:scheduler:::aws-sdk:lambda:invoke" -ForegroundColor White
Write-Host ""

# Tentar Hipotese A com create-schedule (mas antes pegar ConnectionName e ApiDestinationName)
$connArn = aws --profile $env:PROFILE --region $env:REGION events describe-connection --name renthus-cron-connection --query "ConnectionArn" --output text 2>&1
Write-Host "ConnectionArn atual: $connArn" -ForegroundColor Gray
Write-Host ""

# Pegar ApiDestination ARN/name
$destArn = aws --profile $env:PROFILE --region $env:REGION events describe-api-destination --name renthus-dest-reactivate --query "ApiDestinationArn" --output text 2>&1
Write-Host "ApiDestinationArn atual: $destArn" -ForegroundColor Gray
Write-Host ""

# Tentar Hipotese A
Write-Host "TESTANDO HIPOTESE A: arn:aws:scheduler:::aws-sdk:eventbridge:invokeApiDestination" -ForegroundColor Yellow
$inputA = @{
    "ApiDestinationArn" = $destArn
} | ConvertTo-Json -Compress
$payloadA = @{
    "Name"               = "renthus-test-target-a"
    "ScheduleExpression" = "at(2099-12-31T23:59:00)"
    "FlexibleTimeWindow" = @{ "Mode" = "OFF" }
    "Target" = @{
        "Arn"     = "arn:aws:scheduler:::aws-sdk:eventbridge:invokeApiDestination"
        "RoleArn" = "arn:aws:iam::$env:ACCOUNT_ID`:role/renthus-eventbridge-scheduler-role"
        "Input"   = $inputA
    }
} | ConvertTo-Json -Depth 10
$tmpFile = Join-Path $env:TEMP "test-target-a.json"
[System.IO.File]::WriteAllText($tmpFile, $payloadA, [System.Text.UTF8Encoding]::new($false))

cmd /c "aws --profile $env:PROFILE --region $env:REGION scheduler create-schedule --cli-input-json file://$tmpFile --output json"
$exit = $LASTEXITCODE
Write-Host ""
Write-Host "Hipotese A exit: $exit" -ForegroundColor $(if ($exit -eq 0) { "Green" } else { "Red" })
Write-Host ""

# Cleanup se deu certo
if ($exit -eq 0) {
    Write-Host "DELETE teste:" -ForegroundColor Gray
    cmd /c "aws --profile $env:PROFILE --region $env:REGION scheduler delete-schedule --name renthus-test-target-a"
}

Write-Host ""
Write-Host "Cole aqui o JSON skeleton e o resultado do teste A." -ForegroundColor Cyan