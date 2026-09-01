# scripts/fase0-diag-aws.ps1
#
# FASE 0 — Diagnóstico destrutivo (read-only) do estado AWS + Lambda + SQS
# ADR-0003 Fase 0 — verificar antes de aplicar Fase 7
#
# O QUE FAZ: lê estado real de EventSourceMapping, DLQ, age alarmes
# O QUE NÃO FAZ: nada destrutivo. Seguro rodar a qualquer momento.
#
# USO:
#   .\scripts\fase0-diag-aws.ps1

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1"
)

$ErrorActionPreference = "Continue"

$InboundFn = "renthus-inbound-worker"
$OutboundFn = "renthus-outbound-worker"
$ReconcileFn = "renthus-outbox-reconcile"
$InboundQueue = "renthus-inbound.fifo"
$OutboundQueue = "renthus-outbound.fifo"

function Section($title) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " $title" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}

# ---------- 0.1 — Estado das Lambdas ----------
Section "0.1 — Lambda Configuration"

foreach ($fn in @($InboundFn, $OutboundFn, $ReconcileFn)) {
    Write-Host "--- $fn ---" -ForegroundColor Yellow
    $cfg = aws --profile $Profile --region $Region lambda get-function-configuration `
        --function-name $fn --output json 2>$null | ConvertFrom-Json
    if ($cfg) {
        Write-Host "  Memory:       $($cfg.MemorySize) MB"
        Write-Host "  Timeout:      $($cfg.Timeout) s"
        Write-Host "  Runtime:      $($cfg.Runtime)"
        Write-Host "  LastModified: $($cfg.LastModified)"
        Write-Host "  State:        $($cfg.State)"
    } else {
        Write-Host "  (função não encontrada)" -ForegroundColor Red
    }
}

# ---------- 0.2 — EventSourceMappings ----------
Section "0.2 — EventSourceMappings (SQS → Lambda)"

foreach ($fn in @($InboundFn, $OutboundFn)) {
    Write-Host "--- $fn ---" -ForegroundColor Yellow
    $esmList = aws --profile $Profile --region $Region lambda list-event-source-mappings `
        --function-name $fn --output json 2>$null | ConvertFrom-Json
    if ($esmList -and $esmList.EventSourceMappings) {
        $esmList.EventSourceMappings | ForEach-Object {
            $maxConc = if ($_.ScalingConfig -and $_.ScalingConfig.MaximumConcurrency) { $_.ScalingConfig.MaximumConcurrency } else { "unlimited" }
            Write-Host "  UUID:           $($_.UUID)"
            Write-Host "  State:          $($_.State)"
            Write-Host "  BatchSize:      $($_.BatchSize)"
            Write-Host "  MaxConc:        $maxConc"
            Write-Host "  FunctionResp:   $($_.FunctionResponseTypes -join ', ')"
            Write-Host "  EventSourceArn: $($_.EventSourceArn)"
            Write-Host "  LastModified:   $($_.LastModified)"
            Write-Host ""
        }
    } else {
        Write-Host "  (nenhum mapping)" -ForegroundColor Red
    }
}

# ---------- 0.3 — Estado das filas SQS ----------
Section "0.3 — SQS Queue Attributes"

foreach ($q in @($InboundQueue, $OutboundQueue)) {
    Write-Host "--- $q ---" -ForegroundColor Yellow
    $url = aws --profile $Profile --region $Region sqs get-queue-url --queue-name $q --query QueueUrl --output text 2>$null
    if ($url) {
        $attrs = aws --profile $Profile --region $Region sqs get-queue-attributes `
            --queue-url $url `
            --attribute-names All --output json 2>$null | ConvertFrom-Json
        if ($attrs) {
            $a = $attrs.Attributes
            Write-Host "  VisibilityTimeout:        $($a.VisibilityTimeout) s"
            Write-Host "  ReceiveMessageWaitTime:   $($a.ReceiveMessageWaitTimeSeconds) s (0=short, 20=long)"
            Write-Host "  MessageRetentionPeriod:   $($a.MessageRetentionPeriod) s"
            Write-Host "  ApproximateNumberOfMessages (visible):     $($a.ApproximateNumberOfMessagesVisible)"
            Write-Host "  ApproximateNumberOfMessages (not visible): $($a.ApproximateNumberOfMessagesNotVisible)"
            Write-Host "  ApproximateAgeOfOldest:   $($a.ApproximateAgeOfOldestMessage) s  ← ALVO <10s"
            Write-Host "  RedrivePolicy:            $($a.RedrivePolicy)"
        }
    } else {
        Write-Host "  (fila não encontrada)" -ForegroundColor Red
    }
    Write-Host ""
}

# ---------- 0.4 — DLQ inventory ----------
Section "0.4 — DLQ Depth (red flag se >0)"

foreach ($dlq in @("renthus-inbound-dlq.fifo", "renthus-outbound-dlq.fifo")) {
    Write-Host "--- $dlq ---" -ForegroundColor Yellow
    $url = aws --profile $Profile --region $Region sqs get-queue-url --queue-name $dlq --query QueueUrl --output text 2>$null
    if ($url) {
        $depth = aws --profile $Profile --region $Region sqs get-queue-attributes `
            --queue-url $url `
            --attribute-names ApproximateNumberOfMessagesVisible ApproximateNumberOfMessagesNotVisible `
            --query 'Attributes' --output json 2>$null | ConvertFrom-Json
        if ($depth) {
            $v1 = $depth.ApproximateNumberOfMessagesVisible
            $v2 = $depth.ApproximateNumberOfMessagesNotVisible
            $color = if ($v1 -gt 0) { "Red" } else { "Green" }
            Write-Host "  Visible:    $v1" -ForegroundColor $color
            Write-Host "  NotVisible: $v2"
            if ($v1 -gt 0) {
                Write-Host "  ⚠️  Há mensagens na DLQ. Investigar antes de qualquer mudança." -ForegroundColor Red
                Write-Host "     Ver: docs/DR_RUNBOOK_SQS.md (Seção 4)" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "  (DLQ não existe)" -ForegroundColor Red
    }
    Write-Host ""
}

# ---------- 0.5 — CloudWatch alarms (operacional) ----------
Section "0.5 — CloudWatch Alarms (chatbot)"

$alarms = aws --profile $Profile --region $Region cloudwatch describe-alarms `
    --alarm-name-prefix "renthus" --output json 2>$null | ConvertFrom-Json
if ($alarms -and $alarms.MetricAlarms) {
    $alarms.MetricAlarms | Where-Object { $_.AlarmName -like "*chatbot*" -or $_.AlarmName -like "*inbound*" -or $_.AlarmName -like "*outbound*" -or $_.AlarmName -like "*queue*" } | ForEach-Object {
        $color = switch ($_.StateValue) {
            "OK" { "Green" }
            "ALARM" { "Red" }
            "INSUFFICIENT_DATA" { "Yellow" }
            default { "Gray" }
        }
        Write-Host "  $($_.AlarmName): $($_.StateValue)" -ForegroundColor $color
    }
} else {
    Write-Host "  (nenhum alarme chatbot encontrado)" -ForegroundColor Yellow
    Write-Host "  Sugestão Fase 7: criar alarmes para SQS-Inbound-Age, SQS-Outbound-Age, DLQ-Depth"
}

Write-Host ""
Write-Host "=== Diagnóstico Fase 0 concluído ===" -ForegroundColor Green
Write-Host ""
Write-Host "Próximo passo: revisar saída. Se tudo OK (DLQ=0, age<120s), aplicar Fase 7:"
Write-Host "  .\scripts\fase7-fixo-sqs-visibility.ps1 -DryRun    # revisar"
Write-Host "  .\scripts\fase7-fixo-sqs-visibility.ps1            # aplicar"