# debug-scheduler.ps1
# Diagnostico direto do erro de scheduler create-schedule
# Sem tratamento de erro, sem redirecionamento - mostra o erro RAW

$env:PROFILE = "renthus"
$env:REGION = "sa-east-1"

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " Teste 1: list-schedules" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
aws --profile $env:PROFILE --region $env:REGION scheduler list-schedules

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " Teste 2: get-schedule (nao existe)" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
aws --profile $env:PROFILE --region $env:REGION scheduler get-schedule --name "renthus-reactivate"

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " Teste 3: create-schedule (sem headers CRON_SECRET)" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
$json = @{
    Url = "https://app.renthus.com.br/api/chatbot/reactivate"
    Method = "GET"
} | ConvertTo-Json -Compress
$target = "Arn=arn:aws:scheduler:::aws-sdk:universal,RoleArn=arn:aws:iam::696457893414:role/renthus-eventbridge-scheduler-role,Input=$json"

aws --profile $env:PROFILE --region $env:REGION scheduler create-schedule `
    --name "renthus-debug-test" `
    --schedule-expression "rate(1 hour)" `
    --schedule-expression-timezone "America/Sao_Paulo" `
    --state "ENABLED" `
    --description "Debug" `
    --flexible-time-window "Mode=OFF" `
    --target "$target" `
    --action-after-completion "NONE"

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " Teste 4: cleanup (deletar schedule de teste)" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
aws --profile $env:PROFILE --region $env:REGION scheduler delete-schedule --name "renthus-debug-test"

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " Fim do debug" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
