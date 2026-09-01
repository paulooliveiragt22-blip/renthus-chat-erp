# diag-w6min.ps1
# Diagnostica por que mensagem WhatsApp demora 6 min para ser respondida.
# Verifica: 1) config Lambda, 2) env Vercel via leitura de arquivos, 3) cold start

$env:PROFILE = if ($env:PROFILE) { $env:PROFILE } else { "renthus" }
$env:REGION = if ($env:REGION) { $env:REGION } else { "sa-east-1" }
$env:ACCOUNT_ID = if ($env:ACCOUNT_ID) { $env:ACCOUNT_ID } else { "696457893414" }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 1. Lambda renthus-inbound-worker" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# config da Lambda
$fnConfig = aws --profile $env:PROFILE --region $env:REGION lambda get-function-configuration --function-name renthus-inbound-worker --output json
if ($fnConfig) {
    $cfg = $fnConfig | ConvertFrom-Json
    Write-Host "Memory:        $($cfg.MemorySize) MB" -ForegroundColor Gray
    Write-Host "Timeout:       $($cfg.Timeout) s" -ForegroundColor Gray
    Write-Host "Runtime:       $($cfg.Runtime)" -ForegroundColor Gray
    Write-Host "Last modified: $($cfg.LastModified)" -ForegroundColor Gray
}

Write-Host ""
Write-Host " 2. Event Source Mapping (SQS -> Lambda)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$esmList = aws --profile $env:PROFILE --region $env:REGION lambda list-event-source-mappings --function-name renthus-inbound-worker --output json
if ($esmList) {
    $esmList | ConvertFrom-Json | ForEach-Object {
        Write-Host "ESM UUID:           $($_.UUID)" -ForegroundColor Gray
        Write-Host "State:              $($_.State)" -ForegroundColor Gray
        Write-Host "Batch size:         $($_.BatchSize)" -ForegroundColor Gray
        $maxConc = "unlimited"
        if ($_.ScalingConfig -and $_.ScalingConfig.MaximumConcurrency) { $maxConc = $_.ScalingConfig.MaximumConcurrency }
        Write-Host "Max concurrency:    $maxConc" -ForegroundColor Gray
        Write-Host "Event source ARN:   $($_.EventSourceArn)" -ForegroundColor Gray
        Write-Host ""
    }
} else {
    Write-Host "ERRO: nenhuma ESM encontrada para renthus-inbound-worker" -ForegroundColor Red
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 3. CloudWatch metrics das ultimas 1h" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:MM:ssZ")
$past = (Get-Date).AddHours(-1).ToUniversalTime().ToString("yyyy-MM-ddTHH:MM:00Z")

# Lambda invocations
$startTime = $past
$endTime = $now
Write-Host "[Invocations]" -ForegroundColor Yellow
aws --profile $env:PROFILE --region $env:REGION cloudwatch get-metric-statistics `
 --namespace AWS/Lambda --metric-name Invocations --dimensions Name=FunctionName,Value=renthus-inbound-worker `
 --start-time $startTime --end-time $endTime --period 300 --statistics Sum --output json 2>$null | Out-Null

Write-Host ""
Write-Host "[Duration (avg ms por periodo)]" -ForegroundColor Yellow
aws --profile $env:PROFILE --region $env:REGION cloudwatch get-metric-statistics `
 --namespace AWS/Lambda --metric-name Duration --dimensions Name=FunctionName,Value=renthus-inbound-worker `
 --start-time $startTime --end-time $endTime --period 300 --statistics Average --output json 2>$null | Out-Null

Write-Host ""
Write-Host "[ConcurrentExecutions (max)]" -ForegroundColor Yellow
aws --profile $env:PROFILE --region $env:REGION cloudwatch get-metric-statistics `
 --namespace AWS/Lambda --metric-name ConcurrentExecutions --dimensions Name=FunctionName,Value=renthus-inbound-worker `
 --start-time $startTime --end-time $endTime --period 300 --statistics Maximum --output json 2>$null | Out-Null

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 4. Vercel env vars (.env.production local, se existir)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$envFiles = @(".env.production", ".env.local", ".env")
$found = $false
foreach ($f in $envFiles) {
    if (Test-Path $f) {
        Write-Host "Arquivo: $f" -ForegroundColor Yellow
        Get-Content $f | Where-Object { $_ -match "^(AWS_REGION|AWS_DEFAULT_REGION|SQS_INBOUND|SQS_DISPATCH|CRON_SECRET|UPSTASH|LLM_GLOBAL)" } | ForEach-Object {
            if ($_ -match "SECRET") {
                Write-Host "  $_" -ForegroundColor DarkGray
            } else {
                Write-Host "  $_" -ForegroundColor Gray
            }
        }
        $found = $true
        Write-Host ""
    }
}

if (-not $found) {
    Write-Host "Nenhum .env encontrado localmente." -ForegroundColor Gray
    Write-Host "Verifique manualmente no painel da Vercel:" -ForegroundColor Yellow
    Write-Host "  https://vercel.com/renthus-chat-erp/settings/environment-variables" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 5. Worker logs (ultimos 30 min, se ha logs no CW)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$logGroup = "/aws/lambda/renthus-inbound-worker"
Write-Host "Log group esperado: $logGroup" -ForegroundColor Gray
Write-Host "Verifique diretamente:" -ForegroundColor Yellow
Write-Host "  https://sa-east-1.console.aws.amazon.com/cloudwatch/home?region=sa-east-1#logsV2:log-groups/log-group/\$252Faws\$252Flambda\$252Frenthus-inbound-worker" -ForegroundColor Cyan