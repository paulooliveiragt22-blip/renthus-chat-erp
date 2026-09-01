# Verify renthus-cron-bridge + migrate SQS workers to Node 22.x
# Execute apos o deploy-cron-bridge.ps1.
#
# 1. Invoca a Lambda manualmente (gera log group + log lines)
# 2. Aguarda 3s, faz tail dos logs do CloudWatch
# 3. Migra renthus-inbound-worker, renthus-outbound-worker, renthus-outbox-reconcile
#    de nodejs20.x para nodejs22.x (idem ao deploy-workers.ps1, mas so runtime)
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\verify-and-migrate-cron-bridge.ps1

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1"
)

$ErrorActionPreference = "Stop"

function Invoke-AwsRaw {
    param([string[]]$CommandArgs)
    $cli = @("--profile", $Profile, "--region", $Region, "--no-cli-pager") + $CommandArgs
    & aws @cli
    if ($LASTEXITCODE -ne 0) {
        throw "aws failed (exit $LASTEXITCODE): $($CommandArgs -join ' ')"
    }
}

function Invoke-AwsJson {
    param([string[]]$CommandArgs)
    $out = Invoke-AwsRaw ($CommandArgs + @("--output", "json"))
    return ($out | ConvertFrom-Json)
}

function Invoke-AwsText {
    param([string[]]$CommandArgs)
    $out = Invoke-AwsRaw ($CommandArgs + @("--output", "text"))
    return ($out | Out-String).Trim()
}

Write-Host "=== Verify renthus-cron-bridge + migrate workers ===" -ForegroundColor Cyan
Write-Host "Profile=$Profile  Region=$Region"
Write-Host ""

# --- 1. Invocar Lambda manualmente (best-effort; pode falhar por IAM) ---
Write-Host "[1] Tentando invocar renthus-cron-bridge manualmente (best-effort)..." -ForegroundColor Cyan
$responseFile = Join-Path $env:TEMP "renthus-cron-bridge-response.json"
if (Test-Path $responseFile) { Remove-Item -Force $responseFile }

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$invokeErr = aws --profile $Profile --region $Region --no-cli-pager lambda invoke `
    --function-name renthus-cron-bridge `
    --payload '{"targetUrl":"https://app.renthus.com.br/api/chatbot/reactivate"}' `
    --cli-binary-format raw-in-base64-out `
    $responseFile 2>&1
$invokeExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap

if ($invokeExit -ne 0) {
    Write-Host "  Invoke manual falhou (exit $invokeExit) - provavelmente falta IAM." -ForegroundColor Yellow
    Write-Host "  Isso NAO impede o deploy. EventBridge vai disparar normalmente." -ForegroundColor Yellow
    Write-Host "  Erro (primeiros 200 chars): $($invokeErr.ToString().Substring(0, [Math]::Min(200, $invokeErr.ToString().Length)))" -ForegroundColor DarkGray
} else {
    $statusLine = ($invokeErr | Select-String -Pattern "StatusCode:\s+(\d+)").Matches[0].Groups[1].Value
    Write-Host "  Invoke OK (StatusCode=$statusLine)" -ForegroundColor Green
    if (Test-Path $responseFile) {
        $body = Get-Content $responseFile -Raw
        Write-Host "  Lambda response body: $body" -ForegroundColor DarkGray
    }
}

# --- 1b. Conferir metricas CloudWatch (nao precisa de IAM especial) ---
Write-Host ""
Write-Host "[1b] Metricas CloudWatch da Lambda (ultimas 24h)..." -ForegroundColor Cyan
try {
    $end = [DateTimeOffset]::UtcNow
    $start = $end.AddHours(-24)
    $metrics = Invoke-AwsJson @(
        "cloudwatch", "get-metric-statistics",
        "--namespace", "AWS/Lambda",
        "--metric-name", "Invocations",
        "--dimensions", "Name=FunctionName,Value=renthus-cron-bridge",
        "--start-time", $start.ToString("yyyy-MM-ddTHH:mm:ssZ"),
        "--end-time", $end.ToString("yyyy-MM-ddTHH:mm:ssZ"),
        "--period", "300",
        "--statistics", "Sum"
    )
    $totalInv = 0
    foreach ($d in $metrics.Datapoints) { $totalInv += $d.Sum }
    Write-Host "  Total de invocacoes (ultimas 24h): $totalInv" -ForegroundColor $(if ($totalInv -gt 0) { "Green" } else { "Yellow" })
    if ($totalInv -eq 0) {
        Write-Host "  Lambda ainda NAO foi invocada. EventBridge rate(5min) deve disparar em breve." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  Erro ao consultar metricas: $_" -ForegroundColor DarkGray
}

Start-Sleep -Seconds 3

# --- 2. Tail logs ---
Write-Host ""
Write-Host "[2] Tail dos logs (ultimas 10 linhas)..." -ForegroundColor Cyan
$logEvents = Invoke-AwsJson @("logs", "describe-log-groups", "--log-group-name-prefix", "/aws/lambda/renthus-cron-bridge")
if (-not $logEvents.logGroups -or $logEvents.logGroups.Count -eq 0) {
    Write-Host "  Log group ainda nao existe." -ForegroundColor Yellow
    Write-Host "  Isso significa que a Lambda NUNCA foi invocada ainda." -ForegroundColor Yellow
    Write-Host "  O EventBridge rate(5 minutes) precisa de ate 5 min para disparar." -ForegroundColor Yellow
    Write-Host "  Aguarde e rode o comando de tail em outro terminal:" -ForegroundColor Yellow
    Write-Host "    aws --profile $Profile --region $Region logs tail /aws/lambda/renthus-cron-bridge --follow --no-cli-pager" -ForegroundColor DarkGray
} else {
    Write-Host "  Log group: $($logEvents.logGroups[0].logGroupName)" -ForegroundColor Green
    Write-Host "  Retention: $($logEvents.logGroups[0].retentionInDays) dias" -ForegroundColor DarkGray
    Write-Host "  Stored bytes: $($logEvents.logGroups[0].storedBytes)" -ForegroundColor DarkGray

    $streams = Invoke-AwsJson @("logs", "describe-log-streams", "--log-group-name", "/aws/lambda/renthus-cron-bridge", "--order-by", "LastEventTime", "--descending", "--max-items", "3")
    if ($streams.logStreams.Count -gt 0) {
        foreach ($s in $streams.logStreams) {
            Write-Host ""
            Write-Host "  Stream: $($s.logStreamName) (last: $($s.lastEventTimestamp))" -ForegroundColor Cyan
            $events = Invoke-AwsJson @(
                "logs", "get-log-events",
                "--log-group-name", "/aws/lambda/renthus-cron-bridge",
                "--log-stream-name", $s.logStreamName,
                "--limit", "10"
            )
            foreach ($e in $events.events) {
                Write-Host "    $($e.message.Trim())" -ForegroundColor DarkGray
            }
        }
    }
}

# --- 3. Migrar 3 Lambdas SQS para nodejs22.x ---
Write-Host ""
Write-Host "[3] Migrando 3 Lambdas SQS para nodejs22.x..." -ForegroundColor Cyan

function Migrate-LambdaRuntime {
    param([string]$FunctionName)
    Write-Host "  $FunctionName..." -ForegroundColor Cyan -NoNewline
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $exists = aws --profile $Profile --region $Region --no-cli-pager lambda get-function --function-name $FunctionName --output json 2>$null
    $ErrorActionPreference = $prevEap
    if (-not $exists) {
        Write-Host " nao existe, skip" -ForegroundColor Yellow
        return
    }
    $cfg = ($exists | ConvertFrom-Json).Configuration
    if ($cfg.Runtime -eq "nodejs22.x") {
        Write-Host " ja esta em nodejs22.x, skip" -ForegroundColor DarkGray
        return
    }
    if ($cfg.Runtime -ne "nodejs20.x") {
        Write-Host " runtime e $($cfg.Runtime), nao migro automaticamente" -ForegroundColor Yellow
        return
    }
    Invoke-AwsRaw @(
        "lambda", "update-function-configuration",
        "--function-name", $FunctionName,
        "--runtime", "nodejs22.x"
    )
    Write-Host " migrado para nodejs22.x" -ForegroundColor Green
}

Migrate-LambdaRuntime -FunctionName "renthus-inbound-worker"
Migrate-LambdaRuntime -FunctionName "renthus-outbound-worker"
Migrate-LambdaRuntime -FunctionName "renthus-outbox-reconcile"

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Green
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Cyan
Write-Host "  1. Verifique os logs ao vivo (deixe em outro terminal):"
Write-Host "     aws --profile $Profile --region $Region logs tail /aws/lambda/renthus-cron-bridge --follow --no-cli-pager"
Write-Host "  2. Confirme runtime das 3 workers migradas:"
Write-Host "     aws --profile $Profile --region $Region lambda list-functions --query 'Functions[?starts_with(FunctionName,`'renthus-`')].{Name:FunctionName,Runtime:Runtime}' --output table --no-cli-pager"