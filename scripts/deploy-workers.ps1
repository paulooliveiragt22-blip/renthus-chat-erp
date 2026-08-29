# Deploy Lambda workers + SQS event source (ADR-0003 Fase 3)
#   .\scripts\deploy-workers.ps1
# Prerequisites: aws CLI profile "renthus", node, npm run build:workers already or this script builds

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1",
    [string]$EnvFile = "",
    [int]$LlmGlobalMax = 20,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$AccountId = "696457893414"
$InboundFn = "renthus-inbound-worker"
$OutboundFn = "renthus-outbound-worker"
$ReconcileFn = "renthus-outbox-reconcile"
$RoleName = "renthus-lambda-sqs-worker"
$InboundQueue = "renthus-inbound.fifo"
$OutboundQueue = "renthus-outbound.fifo"

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

function Invoke-AwsText {
    param([string[]]$CommandArgs)
    $out = Invoke-AwsRaw ($CommandArgs + @("--output", "text"))
    return ($out | Out-String).Trim()
}

Write-Host "Caller identity" -ForegroundColor Cyan
Invoke-AwsJson @("sts", "get-caller-identity") | Out-Host

if (-not $SkipBuild) {
    Write-Host "Building workers..." -ForegroundColor Cyan
    npm run build:workers
    if ($LASTEXITCODE -ne 0) { throw "build:workers failed" }
}

$inboundZip = Join-Path $Root "dist\workers\inbound.zip"
$outboundZip = Join-Path $Root "dist\workers\outbound.zip"
$reconcileZip = Join-Path $Root "dist\workers\reconcile.zip"
if (-not (Test-Path $inboundZip) -or -not (Test-Path $outboundZip) -or -not (Test-Path $reconcileZip)) {
    throw "Missing zip artifacts under dist/workers (inbound, outbound, reconcile)"
}

# --- IAM role ---
$RoleArn = "arn:aws:iam::${AccountId}:role/${RoleName}"
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$existingRole = aws --profile $Profile iam get-role --role-name $RoleName --output json 2>$null
$ErrorActionPreference = $prevEap

if (-not $existingRole) {
    Write-Host "Creating IAM role $RoleName" -ForegroundColor Cyan
    $trust = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Effect = "Allow"
                Principal = @{ Service = "lambda.amazonaws.com" }
                Action = "sts:AssumeRole"
            }
        )
    } | ConvertTo-Json -Depth 6 -Compress
    $trustFile = Join-Path $env:TEMP "renthus-lambda-trust.json"
    [System.IO.File]::WriteAllText($trustFile, $trust, [System.Text.UTF8Encoding]::new($false))
    Invoke-AwsRaw @("iam", "create-role", "--role-name", $RoleName, "--assume-role-policy-document", ("file://" + ($trustFile -replace "\\", "/")))
    Invoke-AwsRaw @("iam", "attach-role-policy", "--role-name", $RoleName, "--policy-arn", "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole")

    $sqsPolicy = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Effect = "Allow"
                Action = @(
                    "sqs:ReceiveMessage",
                    "sqs:DeleteMessage",
                    "sqs:GetQueueAttributes",
                    "sqs:ChangeMessageVisibility",
                    "sqs:GetQueueUrl",
                    "sqs:SendMessage"
                )
                Resource = @(
                    "arn:aws:sqs:${Region}:${AccountId}:renthus-inbound.fifo",
                    "arn:aws:sqs:${Region}:${AccountId}:renthus-outbound.fifo",
                    "arn:aws:sqs:${Region}:${AccountId}:renthus-inbound-dlq.fifo",
                    "arn:aws:sqs:${Region}:${AccountId}:renthus-outbound-dlq.fifo"
                )
            }
        )
    } | ConvertTo-Json -Depth 8 -Compress
    $polFile = Join-Path $env:TEMP "renthus-lambda-sqs.json"
    [System.IO.File]::WriteAllText($polFile, $sqsPolicy, [System.Text.UTF8Encoding]::new($false))
    Invoke-AwsRaw @(
        "iam", "put-role-policy",
        "--role-name", $RoleName,
        "--policy-name", "renthus-sqs-consume",
        "--policy-document", ("file://" + ($polFile -replace "\\", "/"))
    )
    Write-Host "Waiting 10s for IAM propagation..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 10
} else {
    Write-Host "IAM role exists: $RoleName" -ForegroundColor Yellow
}

# Always refresh SQS policy (includes SendMessage for reconciler re-dispatch)
$sqsPolicy = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Action = @(
                "sqs:ReceiveMessage",
                "sqs:DeleteMessage",
                "sqs:GetQueueAttributes",
                "sqs:ChangeMessageVisibility",
                "sqs:GetQueueUrl",
                "sqs:SendMessage"
            )
            Resource = @(
                "arn:aws:sqs:${Region}:${AccountId}:renthus-inbound.fifo",
                "arn:aws:sqs:${Region}:${AccountId}:renthus-outbound.fifo",
                "arn:aws:sqs:${Region}:${AccountId}:renthus-inbound-dlq.fifo",
                "arn:aws:sqs:${Region}:${AccountId}:renthus-outbound-dlq.fifo"
            )
        }
    )
} | ConvertTo-Json -Depth 8 -Compress
$polFile = Join-Path $env:TEMP "renthus-lambda-sqs.json"
[System.IO.File]::WriteAllText($polFile, $sqsPolicy, [System.Text.UTF8Encoding]::new($false))
Invoke-AwsRaw @(
    "iam", "put-role-policy",
    "--role-name", $RoleName,
    "--policy-name", "renthus-sqs-consume",
    "--policy-document", ("file://" + ($polFile -replace "\\", "/"))
)
Write-Host "IAM SQS policy refreshed (SendMessage included)" -ForegroundColor DarkGray

# --- Queue URLs / ARNs ---
$inUrl = Invoke-AwsText @("sqs", "get-queue-url", "--queue-name", $InboundQueue, "--query", "QueueUrl")
$outUrl = Invoke-AwsText @("sqs", "get-queue-url", "--queue-name", $OutboundQueue, "--query", "QueueUrl")
$inArn = Invoke-AwsText @("sqs", "get-queue-attributes", "--queue-url", $inUrl, "--attribute-names", "QueueArn", "--query", "Attributes.QueueArn")
$outArn = Invoke-AwsText @("sqs", "get-queue-attributes", "--queue-url", $outUrl, "--attribute-names", "QueueArn", "--query", "Attributes.QueueArn")

# --- Env for Lambda ---
function Read-DotEnv([string]$Path) {
    $map = @{}
    if (-not (Test-Path $Path)) { return $map }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }
        $i = $line.IndexOf("=")
        if ($i -lt 1) { return }
        $k = $line.Substring(0, $i).Trim()
        $v = $line.Substring($i + 1).Trim()
        if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
            $v = $v.Substring(1, $v.Length - 2)
        }
        $map[$k] = $v
    }
    return $map
}

$envKeys = @(
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "ANTHROPIC_API_KEY",
    "WHATSAPP_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_APP_SECRET",
    "CREDENTIALS_ENCRYPTION_KEY",
    "CRON_SECRET",
    "CHATBOT_QUEUE_ENABLED",
    "CHATBOT_QUEUE_MAX_PER_COMPANY",
    "LLM_GLOBAL_MAX_IN_FLIGHT",
    "COMPANY_LLM_MAX_IN_FLIGHT",
    "SENTRY_DSN",
    "NEXT_PUBLIC_APP_URL",
    "SQS_DISPATCH_ENABLED",
    "CHATBOT_QUEUE_STALE_MINUTES"
)

$dotenvPath = if ($EnvFile) { $EnvFile } else { Join-Path $Root ".env.local" }
$dotenv = Read-DotEnv $dotenvPath

$variables = @{
    AWS_REGION_OVERRIDE = $Region  # avoid clash — use custom if needed
    SQS_INBOUND_QUEUE_URL = $inUrl
    SQS_OUTBOUND_QUEUE_URL = $outUrl
    CHATBOT_QUEUE_ENABLED = "1"
    SQS_DISPATCH_ENABLED = "1"
}

# Lambda reserves AWS_REGION — do not set it in Environment.Variables
foreach ($k in $envKeys) {
    if ($dotenv.ContainsKey($k) -and $dotenv[$k]) {
        $variables[$k] = $dotenv[$k]
    }
}
# Workers always dispatch (reconciler + retry paths). Do not inherit local "0".
$variables["SQS_DISPATCH_ENABLED"] = "1"
if (-not $variables.ContainsKey("LLM_GLOBAL_MAX_IN_FLIGHT")) {
    $variables["LLM_GLOBAL_MAX_IN_FLIGHT"] = "$LlmGlobalMax"
}
$variables.Remove("AWS_REGION_OVERRIDE")

$envJson = @{ Variables = $variables } | ConvertTo-Json -Depth 4 -Compress
$envFilePath = Join-Path $env:TEMP "renthus-lambda-env.json"
[System.IO.File]::WriteAllText($envFilePath, $envJson, [System.Text.UTF8Encoding]::new($false))
$envFileUri = "file://" + ($envFilePath -replace "\\", "/")

function Ensure-Function {
    param(
        [string]$Name,
        [string]$Zip,
        [int]$Memory,
        [int]$Timeout,
        [int]$Reserved
    )
    $ErrorActionPreference = "SilentlyContinue"
    $exists = aws --profile $Profile --region $Region lambda get-function --function-name $Name --output json 2>$null
    $ErrorActionPreference = "Stop"

    if (-not $exists) {
        Write-Host "Creating Lambda $Name" -ForegroundColor Cyan
        Invoke-AwsRaw @(
            "lambda", "create-function",
            "--function-name", $Name,
            "--runtime", "nodejs20.x",
            "--role", $RoleArn,
            "--handler", "index.handler",
            "--zip-file", ("fileb://" + ($Zip -replace "\\", "/")),
            "--timeout", "$Timeout",
            "--memory-size", "$Memory",
            "--environment", $envFileUri,
            "--architectures", "x86_64"
        )
    } else {
        Write-Host "Updating code $Name" -ForegroundColor Cyan
        Invoke-AwsRaw @(
            "lambda", "update-function-code",
            "--function-name", $Name,
            "--zip-file", ("fileb://" + ($Zip -replace "\\", "/"))
        )
        Start-Sleep -Seconds 3
        Invoke-AwsRaw @(
            "lambda", "update-function-configuration",
            "--function-name", $Name,
            "--timeout", "$Timeout",
            "--memory-size", "$Memory",
            "--environment", $envFileUri,
            "--handler", "index.handler",
            "--runtime", "nodejs20.x"
        )
    }

    Start-Sleep -Seconds 2
    if ($Reserved -gt 0) {
        Write-Host "Reserved concurrency $Name = $Reserved (best-effort)" -ForegroundColor DarkGray
        $prevEap2 = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & aws --profile $Profile --region $Region lambda put-function-concurrency --function-name $Name --reserved-concurrent-executions "$Reserved"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  skip reserved concurrency (account limit) - calibrate later" -ForegroundColor Yellow
        }
        $ErrorActionPreference = $prevEap2
    }
}

# Contas novas: UnreservedConcurrentExecution mínimo 10 — reserved alto quebra o deploy.
# Preferir 0 (sem reserved) e calibrar depois via Service Quotas / RENTHUS_LAMBDA_RESERVED=1.
$inboundReserved = 0
$outboundReserved = 0
if ($LlmGlobalMax -gt 0 -and $env:RENTHUS_LAMBDA_RESERVED -eq "1") {
    $inboundReserved = [Math]::Min(5, $LlmGlobalMax + 1)
    $outboundReserved = 3
}
Ensure-Function -Name $InboundFn -Zip $inboundZip -Memory 1024 -Timeout 120 -Reserved $inboundReserved
Ensure-Function -Name $OutboundFn -Zip $outboundZip -Memory 512 -Timeout 60 -Reserved $outboundReserved
Ensure-Function -Name $ReconcileFn -Zip $reconcileZip -Memory 256 -Timeout 60 -Reserved 0

function Ensure-EventBridgeReconcile {
    param([string]$FnArn)
    $ruleName = "renthus-outbox-reconcile-5m"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $existing = aws --profile $Profile --region $Region events describe-rule --name $ruleName --output json 2>$null
    $ErrorActionPreference = $prevEap
    if (-not $existing) {
        Write-Host "Creating EventBridge rule $ruleName" -ForegroundColor Cyan
        Invoke-AwsRaw @(
            "events", "put-rule",
            "--name", $ruleName,
            "--schedule-expression", "rate(5 minutes)",
            "--state", "ENABLED",
            "--description", "ADR-0003 outbox reconciler: pending without SQS + processing stale"
        )
    } else {
        Write-Host "EventBridge rule exists: $ruleName" -ForegroundColor Yellow
    }
    $targetId = "renthus-outbox-reconcile-lambda"
    $targetsJson = @(
        @{ Id = $targetId; Arn = $FnArn }
    ) | ConvertTo-Json -Depth 4 -Compress
    # ConvertTo-Json on single-element array may omit outer []; force array wrapper
    if (-not $targetsJson.StartsWith("[")) {
        $targetsJson = "[$targetsJson]"
    }
    $targetsFile = Join-Path $env:TEMP "renthus-eb-targets.json"
    [System.IO.File]::WriteAllText($targetsFile, $targetsJson, [System.Text.UTF8Encoding]::new($false))
    Invoke-AwsRaw @(
        "events", "put-targets",
        "--rule", $ruleName,
        "--targets", ("file://" + ($targetsFile -replace "\\", "/"))
    )
    $prevEap2 = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    aws --profile $Profile --region $Region lambda add-permission `
        --function-name $ReconcileFn `
        --statement-id "eventbridge-outbox-reconcile" `
        --action "lambda:InvokeFunction" `
        --principal events.amazonaws.com `
        --source-arn ("arn:aws:events:${Region}:${AccountId}:rule/" + $ruleName) 2>$null | Out-Null
    $ErrorActionPreference = $prevEap2
}

$reconcileArn = Invoke-AwsText @("lambda", "get-function", "--function-name", $ReconcileFn, "--query", "Configuration.FunctionArn")
Ensure-EventBridgeReconcile -FnArn $reconcileArn

function Ensure-EventSource {
    param(
        [string]$FnName,
        [string]$QueueArn,
        [int]$BatchSize,
        [int]$Visibility
    )
    $list = Invoke-AwsJson @("lambda", "list-event-source-mappings", "--function-name", $FnName)
    $existing = $list.EventSourceMappings | Where-Object { $_.EventSourceArn -eq $QueueArn } | Select-Object -First 1
    if ($existing) {
        Write-Host "Event source exists for $FnName ($($existing.UUID))" -ForegroundColor Yellow
        Invoke-AwsRaw @(
            "lambda", "update-event-source-mapping",
            "--uuid", $existing.UUID,
            "--batch-size", "$BatchSize",
            "--function-response-types", "ReportBatchItemFailures",
            "--enabled"
        )
        return
    }
    Write-Host "Creating event source $FnName ← $QueueArn" -ForegroundColor Cyan
    Invoke-AwsRaw @(
        "lambda", "create-event-source-mapping",
        "--function-name", $FnName,
        "--event-source-arn", $QueueArn,
        "--batch-size", "$BatchSize",
        "--function-response-types", "ReportBatchItemFailures",
        "--enabled"
    )
}

# Visibility on queue already set by bootstrap; mapping batch sizes per ADR
Ensure-EventSource -FnName $InboundFn -QueueArn $inArn -BatchSize 1 -Visibility 720
Ensure-EventSource -FnName $OutboundFn -QueueArn $outArn -BatchSize 5 -Visibility 360

Write-Host ""
Write-Host "Deploy OK" -ForegroundColor Green
Write-Host "  $InboundFn  memory=1024 timeout=120 reserved=$inboundReserved"
Write-Host "  $OutboundFn memory=512  timeout=60  reserved=$outboundReserved"
Write-Host "  $ReconcileFn memory=256 timeout=60  EventBridge every 5 min"
Write-Host "  Vercel: SQS_DISPATCH_ENABLED=1 (prod cutover)"
Write-Host ""
Write-Host "Synthetic test (optional):" -ForegroundColor Cyan
Write-Host "  npm run smoke:sqs-workers"
