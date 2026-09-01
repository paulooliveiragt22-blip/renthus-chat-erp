# scripts/fase7-fixo-sqs-visibility.ps1
#
# FASE 7 (PR 7) — Correção do gargalo crítico pós-cutover
# ADR-0003 Fase 7 — aprovado 2026-09-01
#
# OBJETIVO: Cortar latência de 6min para <8s no inbound do chatbot.
#
# O QUE MUDA:
# 1. SQS inbound VisibilityTimeout: 720s → 60s
#    (mensagens que falham no visibility timeout voltam à fila em 1min
#     em vez de 12min — alinhado com Lambda timeout 60s)
# 2. SQS inbound ReceiveMessageWaitTimeSeconds: 0 → 20
#    (ativa long polling — reduz custo + latência de poll vazio)
# 3. NÃO recria a fila, NÃO muda DLQ, NÃO muda IAM
# 4. NÃO muda Lambda config (memória, timeout, ESM)
#
# REVERSÍVEL: re-executar com valores antigos via set-queue-attributes.
#
# PRÉ-REQUISITOS:
# - AWS CLI configurado com profile "renthus" (`aws configure --profile renthus`)
# - Região sa-east-1
#
# USO:
#   .\scripts\fase7-fixo-sqs-visibility.ps1           # aplica
#   .\scripts\fase7-fixo-sqs-visibility.ps1 -DryRun   # só mostra o que faria

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$QueueName = "renthus-inbound.fifo"

Write-Host "=== Fase 7 — Fix SQS Visibility + Long Polling ===" -ForegroundColor Cyan
Write-Host "Profile: $Profile | Region: $Region | Queue: $QueueName"
Write-Host "DryRun:  $DryRun"
Write-Host ""

# 1. Obter URL da fila
$queueUrl = aws --profile $Profile --region $Region sqs get-queue-url --queue-name $QueueName --query QueueUrl --output text 2>&1
if ($LASTEXITCODE -ne 0 -or -not $queueUrl) {
    throw "Falha ao obter URL da fila $QueueName. Verifique se ela existe."
}
Write-Host "QueueUrl: $queueUrl" -ForegroundColor Gray
Write-Host ""

# 2. Mostrar config atual (audit)
Write-Host "=== Config ANTES ===" -ForegroundColor Yellow
aws --profile $Profile --region $Region sqs get-queue-attributes `
    --queue-url $queueUrl `
    --attribute-names VisibilityTimeout ReceiveMessageWaitTimeSeconds MessageRetentionPeriod `
    --query 'Attributes.{VisibilityTimeout:VisibilityTimeout, WaitTime:ReceiveMessageWaitTimeSeconds, Retention:MessageRetentionPeriod}'
Write-Host ""

# 3. Aplicar mudança (VisibilityTimeout=60, WaitTime=20)
$attrs = @{
    VisibilityTimeout              = "60"
    ReceiveMessageWaitTimeSeconds  = "20"
} | ConvertTo-Json -Compress

$attrsFile = Join-Path $env:TEMP "renthus-fase7-attrs.json"
[System.IO.File]::WriteAllText($attrsFile, $attrs, [System.Text.UTF8Encoding]::new($false))

if ($DryRun) {
    Write-Host "DRY RUN: executaria:" -ForegroundColor Yellow
    Write-Host "  aws sqs set-queue-attributes --queue-url $queueUrl --attributes file://$attrsFile"
} else {
    Write-Host "Aplicando..." -ForegroundColor Green
    aws --profile $Profile --region $Region sqs set-queue-attributes `
        --queue-url $queueUrl `
        --attributes "file://$attrsFile"
    if ($LASTEXITCODE -ne 0) { throw "set-queue-attributes falhou" }
    Write-Host "  OK" -ForegroundColor Green
}
Write-Host ""

# 4. Mostrar config DEPOIS
Write-Host "=== Config DEPOIS ===" -ForegroundColor Yellow
aws --profile $Profile --region $Region sqs get-queue-attributes `
    --queue-url $queueUrl `
    --attribute-names VisibilityTimeout ReceiveMessageWaitTimeSeconds MessageRetentionPeriod `
    --query 'Attributes.{VisibilityTimeout:VisibilityTimeout, WaitTime:ReceiveMessageWaitTimeSeconds, Retention:MessageRetentionPeriod}'
Write-Host ""

# 5. Validar DLQ — garantir que não estávamos acumulando mensagens
$dlqName = "renthus-inbound-dlq.fifo"
$dlqUrl = aws --profile $Profile --region $Region sqs get-queue-url --queue-name $dlqName --query QueueUrl --output text 2>$null
if ($dlqUrl) {
    $dlqDepth = aws --profile $Profile --region $Region sqs get-queue-attributes `
        --queue-url $dlqUrl `
        --attribute-names ApproximateNumberOfMessagesVisible `
        --query 'Attributes.ApproximateNumberOfMessagesVisible' `
        --output text 2>$null
    Write-Host "DLQ inbound depth: $dlqDepth" -ForegroundColor Gray
    if ($dlqDepth -ne "0") {
        Write-Host "  ATENÇÃO: DLQ tem mensagens — investigar antes de continuar (runbook DR_RUNBOOK_SQS.md)" -ForegroundColor Red
    }
}
Write-Host ""

# 6. Rollback instructions
Write-Host "=== ROLLBACK (se necessário) ===" -ForegroundColor Yellow
$rollbackAttrs = @{
    VisibilityTimeout              = "720"
    ReceiveMessageWaitTimeSeconds  = "0"
} | ConvertTo-Json -Compress
$rollbackFile = Join-Path $env:TEMP "renthus-fase7-rollback.json"
[System.IO.File]::WriteAllText($rollbackFile, $rollbackAttrs, [System.Text.UTF8Encoding]::new($false))
Write-Host "  aws sqs set-queue-attributes --queue-url $queueUrl --attributes file://$rollbackFile"
Write-Host ""

# 7. Próximos passos
Write-Host "=== PRÓXIMOS PASSOS (PR 7 — código) ===" -ForegroundColor Cyan
Write-Host "Após este script rodar com sucesso:"
Write-Host "  1. Monitorar CloudWatch: ApproximateAgeOfOldestMessage < 10s (alvo)"
Write-Host "  2. Monitorar CloudWatch: ConcurrentExecutions avg > 0.5 (vs ~0.07 atual)"
Write-Host "  3. Validar chatbot_queue.created_at → processing_started_at p95 < 30s"
Write-Host "  4. PR código: scripts/deploy-workers.ps1 + lib/chatbot/aiCapabilityProfile.ts"
Write-Host "     (não requer mudança AWS adicional — só saneamento do script)"
Write-Host ""
Write-Host "Sucesso." -ForegroundColor Green