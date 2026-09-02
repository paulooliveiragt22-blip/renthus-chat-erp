# Bootstrap SQS FIFO + DLQ - Renthus (ADR-0003)
#   .\scripts\aws-bootstrap.ps1
# Requires: aws CLI + profile "renthus"

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1"
)

$ErrorActionPreference = "Stop"

$cred = Join-Path $env:USERPROFILE ".aws\credentials"
$cfg = Join-Path $env:USERPROFILE ".aws\config"
if (-not (Test-Path $cred)) {
    throw "Missing $cred - run: aws configure --profile $Profile"
}
if (-not (Test-Path $cfg)) {
    throw "Missing $cfg"
}

Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SHARED_CREDENTIALS_FILE -ErrorAction SilentlyContinue
Remove-Item Env:AWS_CONFIG_FILE -ErrorAction SilentlyContinue

function Invoke-AwsRaw {
    param([string[]]$CommandArgs)
    $cli = @("--profile", $Profile, "--region", $Region) + $CommandArgs
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

Write-Host "Profiles:" -ForegroundColor DarkGray
aws configure list-profiles | Out-Host

Write-Host "Account" -ForegroundColor Cyan
Invoke-AwsJson @("sts", "get-caller-identity") | Out-Host

function Get-QueueUrl([string]$Name) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $out = aws --profile $Profile --region $Region sqs get-queue-url --queue-name $Name --output text 2>$null
    $ok = ($LASTEXITCODE -eq 0) -and $out
    $ErrorActionPreference = $prevEap
    if (-not $ok) { return $null }
    return ($out | Out-String).Trim()
}

function Get-QueueArn([string]$Url) {
    if (-not $Url -or $Url -notmatch "^https://") {
        throw "Invalid queue URL: $Url"
    }
    $arn = aws --profile $Profile --region $Region sqs get-queue-attributes --queue-url $Url `
        --attribute-names QueueArn --query "Attributes.QueueArn" --output text
    if ($LASTEXITCODE -ne 0 -or -not $arn) {
        throw "get-queue-attributes failed for $Url"
    }
    return ($arn | Out-String).Trim()
}

function New-FifoQueue([string]$Name, [hashtable]$ExtraAttrs) {
    $existing = Get-QueueUrl $Name
    if ($existing) {
        Write-Host "  already exists: $Name" -ForegroundColor Yellow
        return $existing
    }
    $base = @{
        FifoQueue                 = "true"
        ContentBasedDeduplication = "false"
    }
    foreach ($k in $ExtraAttrs.Keys) { $base[$k] = [string]$ExtraAttrs[$k] }
    $file = Join-Path $env:TEMP "sqs-attrs-$Name.json"
    $json = $base | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($file, $json, [System.Text.UTF8Encoding]::new($false))
    $fileUri = "file://" + ($file -replace "\\", "/")
    $created = Invoke-AwsJson @("sqs", "create-queue", "--queue-name", $Name, "--attributes", $fileUri)
    Remove-Item $file -Force
    $url = $created.QueueUrl
    if (-not $url) {
        throw "create-queue did not return QueueUrl for $Name"
    }
    return ($url | Out-String).Trim()
}

Write-Host ""
Write-Host "DLQs" -ForegroundColor Cyan
$inDlqUrl = New-FifoQueue "renthus-inbound-dlq.fifo" @{}
$outDlqUrl = New-FifoQueue "renthus-outbound-dlq.fifo" @{}
$inDlqArn = Get-QueueArn $inDlqUrl
$outDlqArn = Get-QueueArn $outDlqUrl

Write-Host ""
Write-Host "Main queues" -ForegroundColor Cyan
$inRedrive = (@{ deadLetterTargetArn = $inDlqArn; maxReceiveCount = 1 } | ConvertTo-Json -Compress)  # Fase 14: 1 retry -> DLQ rapido
$outRedrive = (@{ deadLetterTargetArn = $outDlqArn; maxReceiveCount = 3 } | ConvertTo-Json -Compress)

$inUrl = New-FifoQueue "renthus-inbound.fifo" @{
    # Fase 14 (ADR-0003 §14.2.4): VT=60s = 1× Lambda timeout (60s)
    # Mensagem com falha volta pra fila em 60s (não 180s como na Fase 7)
    VisibilityTimeout              = "60"
    ReceiveMessageWaitTimeSeconds  = "20"  # long polling
    MessageRetentionPeriod         = "1209600"  # 14 dias (máx SQS)
    RedrivePolicy                  = $inRedrive
}
$outUrl = New-FifoQueue "renthus-outbound.fifo" @{
    VisibilityTimeout              = "180"
    ReceiveMessageWaitTimeSeconds  = "20"
    MessageRetentionPeriod         = "1209600"
    RedrivePolicy                  = $outRedrive
}

Write-Host ""
Write-Host "=== Copy to .env.local and Vercel (Production) ===" -ForegroundColor Green
Write-Host "AWS_REGION=$Region"
Write-Host "SQS_INBOUND_QUEUE_URL=$inUrl"
Write-Host "SQS_OUTBOUND_QUEUE_URL=$outUrl"
Write-Host "SQS_DISPATCH_ENABLED=0"
Write-Host ""
Write-Host "Do NOT commit AWS_SECRET_ACCESS_KEY. Use Vercel env for deploy keys only."
Write-Host ""
Write-Host "DLQ ARNs for CloudWatch alarms:"
Write-Host "  $inDlqArn"
Write-Host "  $outDlqArn"
