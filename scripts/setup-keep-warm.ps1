# scripts/setup-keep-warm.ps1
#
# ADR-0003 Fase 12 — Mecanismo de keep-warm
# EventBridge rule que invoca Lambda inbound-worker a cada 1min com payload
# sentinel. A Lambda reconhece e retorna 200 sem processar (apenas "aquece" o
# container). Mantém o poller SQS+ESM ativo em tráfego esporádico.
#
# Custo: ~43.830 invocations/mês × ~50ms × 1024MB = ~USD 0.15/mês
# (escala: 1 invocação/min, duração curtíssima)
#
# Quando desativar: quando tráfego for sustentado (>10 msg/hora) OU Provisioned
# Concurrency estiver ativo (provisioned já elimina cold-start sem precisar de ping).
#
# USO:
#   .\scripts\setup-keep-warm.ps1            # aplica
#   .\scripts\setup-keep-warm.ps1 -Disable  # remove regra

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1",
    [switch]$Disable
)

$ErrorActionPreference = "Stop"

$RuleName = "renthus-inbound-keep-warm-1m"
$TargetId = "renthus-inbound-keep-warm"
$LambdaAliasArn = "arn:aws:lambda:${Region}:696457893414:function:renthus-inbound-worker:live"

function Invoke-AwsRaw([string[]]$CommandArgs) {
    $cli = @("--profile", $Profile, "--region", $Region) + $CommandArgs
    & aws @cli
    if ($LASTEXITCODE -ne 0) {
        throw "aws failed (exit $LASTEXITCODE): $($CommandArgs -join ' ')"
    }
}

if ($Disable) {
    Write-Host "=== Removendo keep-warm rule ===" -ForegroundColor Cyan
    $targetsFile = Join-Path $env:TEMP "renthus-kw-rm.json"
    '[{"Id":"' + $TargetId + '"}]' | Out-File -Encoding ascii -NoNewline $targetsFile
    try {
        Invoke-AwsRaw @("events", "remove-targets", "--rule", $RuleName, "--targets", ("file://" + ($targetsFile -replace '\\','/')))
    } catch {}
    try {
        Invoke-AwsRaw @("events", "delete-rule", "--name", $RuleName)
        Write-Host "  Rule $RuleName removida." -ForegroundColor Green
    } catch {
        Write-Host "  (rule já não existia)" -ForegroundColor Yellow
    }
    try {
        aws --profile $Profile --region $Region lambda remove-permission --function-name renthus-inbound-worker --statement-id eventbridge-inbound-keep-warm 2>$null
    } catch {}
    Write-Host "OK." -ForegroundColor Green
    return
}

Write-Host "=== Setup keep-warm (EventBridge 1min → Lambda inbound-worker:live) ===" -ForegroundColor Cyan

# 1. Criar/atualizar rule
Write-Host "1. Rule EventBridge..." -ForegroundColor Yellow
Invoke-AwsRaw @(
    "events", "put-rule",
    "--name", $RuleName,
    "--schedule-expression", "rate(1 minute)",
    "--state", "ENABLED",
    "--description", "ADR-0003 keep-warm ping (Fase 12): evita ESM poller cold-start"
)

# 2. Vincular target
Write-Host "2. Target (Lambda alias live)..." -ForegroundColor Yellow
$targetsFile = Join-Path $env:TEMP "renthus-kw-targets.json"
('[{"Id":"' + $TargetId + '","Arn":"' + $LambdaAliasArn + '"}]') | Out-File -Encoding ascii -NoNewline $targetsFile
Invoke-AwsRaw @(
    "events", "put-targets",
    "--rule", $RuleName,
    "--targets", ("file://" + ($targetsFile -replace '\\','/'))
)

# 3. Permissão Lambda para EventBridge
Write-Host "3. Lambda permission..." -ForegroundColor Yellow
try {
    aws --profile $Profile --region $Region lambda add-permission `
        --function-name renthus-inbound-worker `
        --statement-id eventbridge-inbound-keep-warm `
        --action lambda:InvokeFunction `
        --principal events.amazonaws.com `
        --source-arn "arn:aws:events:${Region}:696457893414:rule/${RuleName}" 2>$null | Out-Null
} catch {}

Write-Host ""
Write-Host "OK. Keep-warm ativo." -ForegroundColor Green
Write-Host "  - Rule: $RuleName (rate 1min)"
Write-Host "  - Target: $LambdaAliasArn"
Write-Host "  - Custo estimado: USD ~0.15/mês (Lambda invocations)"
Write-Host ""
Write-Host "Para desativar: .\scripts\setup-keep-warm.ps1 -Disable"