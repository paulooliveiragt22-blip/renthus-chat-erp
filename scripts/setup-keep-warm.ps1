# scripts/setup-keep-warm.ps1
#
# ADR-0003 Fase 12 + Fase 15.3 #5 — keep-warm do poller ESM
# EventBridge rule que invoca Lambda inbound-worker:live a cada 1min com payload
# sentinel. A Lambda reconhece e retorna 200 sem processar jobs.
#
# Custo: ~43.830 invocations/mês × ~50ms × 1024MB = ~USD 0.15/mês
#
# Importante: Provisioned Concurrency elimina cold-start do *container*,
# NAO do poller SQS/ESM. Com PC=1 ainda precisamos de keep-warm em trafego
# esporadico (evidencia 2026-09-02: ~27-29s sqs→processing na 1a msg pos-idle).
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
$InboundFn = "renthus-inbound-worker"
$InboundAlias = "live"
$LambdaAliasArn = "arn:aws:lambda:${Region}:696457893414:function:${InboundFn}:${InboundAlias}"

function Invoke-AwsRaw([string[]]$CommandArgs) {
    $cli = @("--profile", $Profile, "--region", $Region) + $CommandArgs
    & aws @cli
    if ($LASTEXITCODE -ne 0) {
        throw "aws failed (exit $LASTEXITCODE): $($CommandArgs -join ' ')"
    }
}

if ($Disable) {
    Write-Host "=== Removendo keep-warm rule ===" -ForegroundColor Cyan
    try {
        Invoke-AwsRaw @("events", "remove-targets", "--rule", $RuleName, "--ids", $TargetId)
    } catch {}
    try {
        Invoke-AwsRaw @("events", "delete-rule", "--name", $RuleName)
        Write-Host "  Rule $RuleName removida." -ForegroundColor Green
    } catch {
        Write-Host "  (rule ja nao existia)" -ForegroundColor Yellow
    }
    try {
        aws --profile $Profile --region $Region lambda remove-permission `
            --function-name "${InboundFn}:${InboundAlias}" `
            --statement-id eventbridge-inbound-keep-warm 2>$null
    } catch {}
    Write-Host "OK." -ForegroundColor Green
    return
}

Write-Host "=== Setup keep-warm (EventBridge 1min -> Lambda inbound-worker:live) ===" -ForegroundColor Cyan

Write-Host "1. Rule EventBridge..." -ForegroundColor Yellow
Invoke-AwsRaw @(
    "events", "put-rule",
    "--name", $RuleName,
    "--schedule-expression", "rate(1 minute)",
    "--state", "ENABLED",
    "--description", "ADR-0003 Fase 15.3 #5 keep-warm: evita ESM poller cold-start"
)

Write-Host "2. Target (Lambda alias live + sentinel)..." -ForegroundColor Yellow
$targetsFile = Join-Path $env:TEMP "renthus-kw-targets.json"
$targetsJson = @(
    @{
        Id = $TargetId
        Arn = $LambdaAliasArn
        Input = '{"source":"renthus.keep-warm"}'
    }
) | ConvertTo-Json -Depth 4 -Compress
if (-not $targetsJson.StartsWith("[")) { $targetsJson = "[$targetsJson]" }
[System.IO.File]::WriteAllText($targetsFile, $targetsJson, [System.Text.UTF8Encoding]::new($false))
Invoke-AwsRaw @(
    "events", "put-targets",
    "--rule", $RuleName,
    "--targets", ("file://" + ($targetsFile -replace '\\','/'))
)

Write-Host "3. Lambda permission on :live ..." -ForegroundColor Yellow
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
aws --profile $Profile --region $Region lambda remove-permission `
    --function-name "${InboundFn}:${InboundAlias}" `
    --statement-id eventbridge-inbound-keep-warm 2>$null | Out-Null
aws --profile $Profile --region $Region lambda remove-permission `
    --function-name $InboundFn `
    --statement-id eventbridge-inbound-keep-warm 2>$null | Out-Null
$ErrorActionPreference = $prevEap

Invoke-AwsRaw @(
    "lambda", "add-permission",
    "--function-name", "${InboundFn}:${InboundAlias}",
    "--statement-id", "eventbridge-inbound-keep-warm",
    "--action", "lambda:InvokeFunction",
    "--principal", "events.amazonaws.com",
    "--source-arn", "arn:aws:events:${Region}:696457893414:rule/${RuleName}"
) | Out-Null

Write-Host ""
Write-Host "OK. Keep-warm ativo." -ForegroundColor Green
Write-Host "  - Rule: $RuleName (rate 1min)"
Write-Host "  - Target: $LambdaAliasArn"
Write-Host "  - Custo estimado: USD ~0.15/mes"
Write-Host ""
Write-Host "Para desativar: .\scripts\setup-keep-warm.ps1 -Disable"
