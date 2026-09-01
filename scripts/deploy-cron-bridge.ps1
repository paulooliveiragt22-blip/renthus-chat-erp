# Deploy Lambda renthus-cron-bridge + 3 EventBridge Rules
# Substitui o plano manual via Console (que pedia Node 20.x - deprecated).
# Usa Node 22.x LTS + SSM SecureString para o CRON_SECRET.
#
# Pre-requisitos:
#   - aws CLI instalado, perfil "renthus" configurado
#   - Parametro SSM SecureString criado: /renthus/cron-bridge/cron-secret
#   - Se quiser usar role existente, passe -RoleName. Default: cria renthus-cron-bridge-role
#     com trust para lambda.amazonaws.com + events.amazonaws.com e policy
#     AWSLambdaBasicExecutionRole (CloudWatch Logs).
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\deploy-cron-bridge.ps1

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1",
    [string]$FunctionName = "renthus-cron-bridge",
    [string]$RoleName = "renthus-cron-bridge-role",
    [string]$SsmParamPath = "/renthus/cron-bridge/cron-secret",
    [string]$BaseUrl = "https://app.renthus.com.br",
    [int]$Memory = 128,
    [int]$Timeout = 30
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$AccountId = "696457893414"
$RoleArn = "arn:aws:iam::${AccountId}:role/${RoleName}"

# Decidir role: usa a existente se passada via parametro, senao cria uma dedicada
$CreateNewRole = ($RoleName -eq "renthus-cron-bridge-role")
if ($CreateNewRole) {
    $RoleName = "renthus-cron-bridge-role"
    $RoleArn = "arn:aws:iam::${AccountId}:role/${RoleName}"
}

Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
Remove-Item Env:AWS_SHARED_CREDENTIALS_FILE -ErrorAction SilentlyContinue
Remove-Item Env:AWS_CONFIG_FILE -ErrorAction SilentlyContinue

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

Write-Host "=== renthus-cron-bridge deploy ===" -ForegroundColor Cyan
Write-Host "Profile=$Profile  Region=$Region  Function=$FunctionName  Runtime=nodejs22.x"

# --- 0. Validar credenciais e parametros ---
Write-Host ""
Write-Host "[0] Validando credenciais e parametros..." -ForegroundColor Cyan
Invoke-AwsJson @("sts", "get-caller-identity") | Out-Host

$paramCheck = Invoke-AwsJson @("ssm", "get-parameter", "--name", $SsmParamPath, "--with-decryption")
if (-not $paramCheck.Parameter) {
    throw "Parametro SSM '$SsmParamPath' nao encontrado. Crie em https://sa-east-1.console.aws.amazon.com/systems-manager/parameters"
}
$cronSecret = $paramCheck.Parameter.Value
Write-Host "  SSM OK: $($paramCheck.Parameter.Name) (versao $($paramCheck.Parameter.Version))" -ForegroundColor Green

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$roleCheck = aws --profile $Profile --region $Region iam get-role --role-name $RoleName --output json 2>$null
$roleExists = $LASTEXITCODE -eq 0
$ErrorActionPreference = $prevEap

if (-not $roleExists) {
    if (-not $CreateNewRole) {
        throw "Role IAM '$RoleName' nao encontrada. Verifique ou ajuste -RoleName."
    }
    Write-Host "  Role nao existe, criando $RoleName..." -ForegroundColor Yellow

    # trust policy: aceita lambda.amazonaws.com E events.amazonaws.com
    $trust = @{
        Version = "2012-10-17"
        Statement = @(
            @{
                Effect = "Allow"
                Principal = @{ Service = @("lambda.amazonaws.com", "events.amazonaws.com") }
                Action = "sts:AssumeRole"
            }
        )
    } | ConvertTo-Json -Depth 6 -Compress
    $trustFile = Join-Path $env:TEMP "renthus-cron-bridge-trust.json"
    [System.IO.File]::WriteAllText($trustFile, $trust, [System.Text.UTF8Encoding]::new($false))
    Invoke-AwsRaw @("iam", "create-role", "--role-name", $RoleName, "--assume-role-policy-document", ("file://" + ($trustFile -replace "\\", "/")))

    # managed policy: CloudWatch Logs basico (mesmo AWSLambdaBasicExecutionRole)
    Invoke-AwsRaw @("iam", "attach-role-policy", "--role-name", $RoleName, "--policy-arn", "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole")
    Write-Host "  Aguardando 10s para propagacao IAM..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 10
}
Write-Host "  Role OK: $RoleArn" -ForegroundColor Green

# --- 1. Empacotar codigo ---
Write-Host ""
Write-Host "[1] Empacotando handler (src/index.mjs)..." -ForegroundColor Cyan
$srcDir = Join-Path $Root "infra\renthus-cron-bridge\src"
$distDir = Join-Path $Root "dist\renthus-cron-bridge"
$zipPath = Join-Path $Root "dist\renthus-cron-bridge.zip"

if (-not (Test-Path $srcDir)) {
    throw "Diretorio de origem nao encontrado: $srcDir"
}
if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
New-Item -ItemType Directory -Path $distDir | Out-Null
Copy-Item -Path (Join-Path $srcDir "index.mjs") -Destination $distDir -Force

if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Add-Type -AssemblyName "System.IO.Compression.FileSystem"
[System.IO.Compression.ZipFile]::CreateFromDirectory($distDir, $zipPath)
Write-Host "  Zip criado: $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1KB, 1)) KB)" -ForegroundColor Green

# --- 2. Criar ou atualizar a Lambda ---
Write-Host ""
Write-Host "[2] Criando/atualizando Lambda $FunctionName..." -ForegroundColor Cyan
$envJson = @{
    Variables = @{
        CRON_SECRET = $cronSecret
        DEFAULT_URL = "$BaseUrl/api/chatbot/reactivate"
    }
} | ConvertTo-Json -Depth 4 -Compress
$envFile = Join-Path $env:TEMP "renthus-cron-bridge-env.json"
[System.IO.File]::WriteAllText($envFile, $envJson, [System.Text.UTF8Encoding]::new($false))
$envFileUri = "file://" + ($envFile -replace "\\", "/")

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$exists = aws --profile $Profile --region $Region lambda get-function --function-name $FunctionName --output json 2>$null
$ErrorActionPreference = $prevEap

if (-not $exists) {
    Write-Host "  Lambda nao existe, criando..." -ForegroundColor Yellow
    Invoke-AwsRaw @(
        "lambda", "create-function",
        "--function-name", $FunctionName,
        "--runtime", "nodejs22.x",
        "--role", $RoleArn,
        "--handler", "index.handler",
        "--zip-file", ("fileb://" + ($zipPath -replace "\\", "/")),
        "--timeout", "$Timeout",
        "--memory-size", "$Memory",
        "--environment", $envFileUri,
        "--architectures", "x86_64",
        "--description", "Bridge Lambda (Node 22.x) que aciona endpoints cron na Vercel via Authorization Bearer. ADR-0003 Fase 4."
    )
} else {
    Write-Host "  Lambda existe, atualizando codigo e config..." -ForegroundColor Yellow
    Invoke-AwsRaw @(
        "lambda", "update-function-code",
        "--function-name", $FunctionName,
        "--zip-file", ("fileb://" + ($zipPath -replace "\\", "/"))
    )
    Start-Sleep -Seconds 3
    Invoke-AwsRaw @(
        "lambda", "update-function-configuration",
        "--function-name", $FunctionName,
        "--timeout", "$Timeout",
        "--memory-size", "$Memory",
        "--environment", $envFileUri,
        "--handler", "index.handler",
        "--runtime", "nodejs22.x"
    )
}

$fnArn = Invoke-AwsText @("lambda", "get-function", "--function-name", $FunctionName, "--query", "Configuration.FunctionArn")
Write-Host "  Lambda ARN: $fnArn" -ForegroundColor Green

# --- 3. Criar 3 EventBridge Rules + targets + permissions ---
function Ensure-Rule {
    param(
        [string]$RuleName,
        [string]$Schedule,
        [string]$Description,
        [string]$TargetUrl,
        [string]$TargetId,
        [string]$FnArn
    )

    Write-Host ""
    Write-Host "[3] EventBridge Rule: $RuleName" -ForegroundColor Cyan
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $existing = aws --profile $Profile --region $Region events describe-rule --name $RuleName --output json 2>$null
    $ErrorActionPreference = $prevEap

    if (-not $existing) {
        Write-Host "  Criando rule..." -ForegroundColor Yellow
        Invoke-AwsRaw @(
            "events", "put-rule",
            "--name", $RuleName,
            "--schedule-expression", $Schedule,
            "--state", "ENABLED",
            "--description", $Description
        )
    } else {
        Write-Host "  Rule existe, atualizando schedule..." -ForegroundColor Yellow
        Invoke-AwsRaw @(
            "events", "put-rule",
            "--name", $RuleName,
            "--schedule-expression", $Schedule,
            "--state", "ENABLED",
            "--description", $Description
        )
    }

    # targets
    $inputJson = "{`"targetUrl`":`"$TargetUrl`"}"
    $targetsJson = @(
        @{ Id = $TargetId; Arn = $FnArn; Input = $inputJson }
    ) | ConvertTo-Json -Depth 4 -Compress
    if (-not $targetsJson.StartsWith("[")) {
        $targetsJson = "[$targetsJson]"
    }
    $targetsFile = Join-Path $env:TEMP "renthus-eb-targets-$RuleName.json"
    [System.IO.File]::WriteAllText($targetsFile, $targetsJson, [System.Text.UTF8Encoding]::new($false))
    Invoke-AwsRaw @(
        "events", "put-targets",
        "--rule", $RuleName,
        "--targets", ("file://" + ($targetsFile -replace "\\", "/"))
    )

    # permission
    $ruleArn = Invoke-AwsText @("events", "describe-rule", "--name", $RuleName, "--query", "Arn")
    $stmtId = "eventbridge-$RuleName"
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    aws --profile $Profile --region $Region lambda add-permission `
        --function-name $FunctionName `
        --statement-id $stmtId `
        --action "lambda:InvokeFunction" `
        --principal events.amazonaws.com `
        --source-arn $ruleArn 2>$null | Out-Null
    $ErrorActionPreference = $prevEap

    Write-Host "  Rule OK: $RuleName -> $TargetUrl" -ForegroundColor Green
}

Ensure-Rule -RuleName "renthus-reactivate-5m" `
    -Schedule "rate(5 minutes)" `
    -Description "Reativar bot em handover sem resposta > 5min (ADR-0003 Fase 4)" `
    -TargetUrl "$BaseUrl/api/chatbot/reactivate" `
    -TargetId "renthus-cron-bridge-reactivate" `
    -FnArn $fnArn

Ensure-Rule -RuleName "renthus-detect-carts-5m" `
    -Schedule "rate(5 minutes)" `
    -Description "Detectar carrinhos abandonados a cada 5 min (ADR-0003 Fase 4)" `
    -TargetUrl "$BaseUrl/api/chatbot/detect-abandoned-carts" `
    -TargetId "renthus-cron-bridge-detect-carts" `
    -FnArn $fnArn

Ensure-Rule -RuleName "renthus-platform-alerts-15m" `
    -Schedule "rate(15 minutes)" `
    -Description "Avaliar alertas de plataforma a cada 15 min (ADR-0003 Fase 4)" `
    -TargetUrl "$BaseUrl/api/platform/alerts/check" `
    -TargetId "renthus-cron-bridge-platform-alerts" `
    -FnArn $fnArn

# --- 4. Resumo ---
Write-Host ""
Write-Host "=== Deploy OK ===" -ForegroundColor Green
Write-Host "  Lambda:   $FunctionName (nodejs22.x, memory=$Memory, timeout=$Timeout)"
Write-Host "  Env vars: CRON_SECRET (from SSM $SsmParamPath), DEFAULT_URL=$BaseUrl/api/chatbot/reactivate"
Write-Host "  Rules:"
Write-Host "    - renthus-reactivate-5m       (rate 5min)  -> $BaseUrl/api/chatbot/reactivate"
Write-Host "    - renthus-detect-carts-5m      (rate 5min)  -> $BaseUrl/api/chatbot/detect-abandoned-carts"
Write-Host "    - renthus-platform-alerts-15m  (rate 15min) -> $BaseUrl/api/platform/alerts/check"
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Cyan
Write-Host "  1. Aguardar 5 min e verificar logs no CloudWatch:"
Write-Host "     aws --profile $Profile logs tail /aws/lambda/$FunctionName --follow"
Write-Host "  2. Confirmar status das Rules:"
Write-Host "     aws --profile $Profile events list-rules --name-prefix renthus"