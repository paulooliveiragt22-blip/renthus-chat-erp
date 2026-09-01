# fix-reconciler-1min.ps1
# Diminui o reconciler EventBridge de 5min para 1min (urgencia: agente de delivery).
# O reconciler roda a Lambda renthus-outbox-reconcile que reenvia mensagens
# que ficaram paradas (after() nao executou, SQS SendMessage falhou, etc).

$env:PROFILE = if ($env:PROFILE) { $env:PROFILE } else { "renthus" }
$env:REGION = if ($env:REGION) { $env:REGION } else { "sa-east-1" }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Reconciler: rate(5 minutes) -> rate(1 minute)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Descobrir o ARN do target (Lambda renthus-outbox-reconcile)
Write-Host "[1/3] Buscando target da reconciler..." -ForegroundColor Yellow
$targets = aws --profile $env:PROFILE --region $env:REGION events list-targets-by-rule --rule renthus-outbox-reconcile --output json 2>$null

if (-not $targets) {
    Write-Host "ERRO: rule 'renthus-outbox-reconcile' nao encontrada." -ForegroundColor Red
    Write-Host "Liste as rules existentes:" -ForegroundColor Yellow
    aws --profile $env:PROFILE --region $env:REGION events list-rules --output json
    exit 1
}

$targetArn = ($targets | ConvertFrom-Json).Targets[0].Arn
Write-Host "Target ARN: $targetArn" -ForegroundColor Gray
Write-Host ""

# 2. Atualizar a rule para rate(1 minute)
Write-Host "[2/3] Atualizando schedule..." -ForegroundColor Yellow
$rule = @{
    Name = "renthus-outbox-reconcile"
    ScheduleExpression = "rate(1 minute)"
    State = "ENABLED"
    Targets = @(
        @{
            Id = "reconcile-target"
            Arn = $targetArn
        }
    )
} | ConvertTo-Json -Depth 10

$tmp = "$env:TEMP\renthus-reconcile-fix.json"
[System.IO.File]::WriteAllText($tmp, $rule, [System.Text.UTF8Encoding]::new($false))

$result = aws --profile $env:PROFILE --region $env:REGION events put-rule `
 --name "renthus-outbox-reconcile" `
 --schedule-expression "rate(1 minute)" `
 --state "ENABLED" 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "OK: rule atualizada" -ForegroundColor Green
} else {
    Write-Host "ERRO: $result" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[3/3] Validando..." -ForegroundColor Yellow
aws --profile $env:PROFILE --region $env:REGION events describe-rule --name "renthus-outbox-reconcile" --output json | ConvertFrom-Json | ForEach-Object {
    Write-Host "  Name: $($_.Name)" -ForegroundColor Gray
    Write-Host "  ScheduleExpression: $($_.ScheduleExpression)" -ForegroundColor Gray
    Write-Host "  State: $($_.State)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " PRONTO!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Proxima execucao do reconciler: em ate 1 minuto." -ForegroundColor Yellow
Write-Host "Mensagens pendentes no outbox serao reprocessadas rapidamente." -ForegroundColor Yellow
Write-Host ""
Write-Host "IMPORTANTE (delivery):" -ForegroundColor Red
Write-Host "  - Resolucao de 1 min ainda e lento para delivery." -ForegroundColor Yellow
Write-Host "  - Recomendado: trocar after() por await sincrono no handler." -ForegroundColor Yellow
Write-Host "  - Veja a proxima mensagem do agente." -ForegroundColor Yellow