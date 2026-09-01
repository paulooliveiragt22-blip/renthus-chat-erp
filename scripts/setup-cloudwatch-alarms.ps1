<#
# =============================================================================
# Renthus Chat + ERP - Setup de Alarmes CloudWatch + SNS
# ADR-0003 / DR_RUNBOOK_SQS.md
#
# USO:
#   powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup-cloudwatch-alarms.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/setup-cloudwatch-alarms.ps1 -DryRun
#
# ANTES DE RODAR:
#   1) aws configure --profile renthus  (credenciais com permissao sns:* + cloudwatch:*)
#   2) Ajustar -EmailOnCall se necessario
# =============================================================================
#>
[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1",
    [string]$AccountId = "696457893414",
    [string]$EmailOnCall = "ops@renthus.com.br",
    [int]$InboundAgeThresholdSec = 120,
    [int]$OutboundAgeThresholdSec = 180,
    [int]$LambdaErrorThreshold = 5
)

# Forca UTF-8 no console do Windows para evitar corrupcao de em-dash/acentos
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = "Stop"

[CmdletBinding()]
param(
    [switch]$DryRun,
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1",
    [string]$AccountId = "696457893414",
    [string]$EmailOnCall = "ops@renthus.com.br",
    [int]$InboundAgeThresholdSec = 120,
    [int]$OutboundAgeThresholdSec = 180,
    [int]$LambdaErrorThreshold = 5
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[STEP] " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Write-OK($msg)   { Write-Host "[OK]   " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn($msg) { Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Err($msg)  { Write-Host "[ERR]  " -ForegroundColor Red -NoNewline; Write-Host $msg }

# -----------------------------------------------------------------------------
# Verificacoes iniciais
# -----------------------------------------------------------------------------
Write-Step "Verificando AWS CLI..."
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Err "AWS CLI nao encontrado. Instale: https://aws.amazon.com/cli/"
    exit 1
}
$awsVersion = aws --version
Write-OK $awsVersion

Write-Step "Verificando perfil '$Profile' em regiao '$Region'..."
try {
    $identity = aws --profile $Profile --region $Region sts get-caller-identity --output json 2>&1 | ConvertFrom-Json
    Write-OK "Caller: $($identity.Arn)"
    if ($identity.Account -ne $AccountId) {
        Write-Warn "Account mismatch: esperado $AccountId, obtido $($identity.Account)"
        if (-not $DryRun) {
            $resp = Read-Host "Continuar mesmo assim? (s/n)"
            if ($resp -ne "s") { exit 1 }
        }
    }
} catch {
    Write-Err "Falha ao chamar sts:get-caller-identity. Verifique 'aws configure --profile $Profile'"
    Write-Err $_.Exception.Message
    exit 1
}

# -----------------------------------------------------------------------------
# 1) SNS Topic: renthus-ops
# -----------------------------------------------------------------------------
$topicName = "renthus-ops"
$topicArn = "arn:aws:sns:${Region}:${AccountId}:${topicName}"

Write-Step "Verificando SNS topic '$topicName'..."
$existingTopic = aws --profile $Profile --region $Region sns list-topics --output json 2>&1 | ConvertFrom-Json
$topicExists = $existingTopic.Topics | Where-Object { $_.TopicArn -eq $topicArn }

if ($topicExists) {
    Write-OK "Topic ja existe: $topicArn"
} else {
    Write-Step "Criando SNS topic '$topicName'..."
    if (-not $DryRun) {
        aws --profile $Profile --region $Region sns create-topic --name $topicName --output json | Out-Null
    }
    Write-OK "Topic criado: $topicArn"
}

# -----------------------------------------------------------------------------
# 2) SNS Subscription (e-mail)
# -----------------------------------------------------------------------------
Write-Step "Verificando subscription de e-mail: $EmailOnCall..."
$subs = aws --profile $Profile --region $Region sns list-subscriptions-by-topic --topic-arn $topicArn --output json 2>&1 | ConvertFrom-Json
$emailSub = $subs.Subscriptions | Where-Object { $_.Protocol -eq "email" -and $_.Endpoint -eq $EmailOnCall }

if ($emailSub) {
    Write-OK "Subscription ja existe: $($emailSub.SubscriptionArn)"
    if ($emailSub.SubscriptionArn -like "PendingConfirmation*") {
        Write-Warn "E-mail ainda NAO foi confirmado. Verifique a caixa de entrada de $EmailOnCall"
    }
} else {
    Write-Step "Criando subscription de e-mail..."
    if (-not $DryRun) {
        aws --profile $Profile --region $Region sns subscribe `
            --topic-arn $topicArn `
            --protocol email `
            --notification-endpoint $EmailOnCall `
            --output json | Out-Null
    }
    Write-OK "Subscription criada. CONFIRME no e-mail $EmailOnCall (link de confirmacao)"
}

# -----------------------------------------------------------------------------
# Helper: criar/atualizar alarme
# -----------------------------------------------------------------------------
function Set-CWAlarm {
    param(
        [string]$Name,
        [string]$Description,
        [string]$Namespace,
        [hashtable]$Dimensions,
        [string]$MetricName,
        [string]$Statistic,
        [int]$Period,
        [int]$EvaluationPeriods,
        [double]$Threshold,
        [string]$ComparisonOperator = "GreaterThanThreshold"
    )

    $dimArgs = @()
    foreach ($k in $Dimensions.Keys) {
        $dimArgs += "Name=$k,Value=$($Dimensions[$k])"
    }

    $existing = aws --profile $Profile --region $Region cloudwatch describe-alarms `
        --alarm-names $Name --output json 2>&1 | ConvertFrom-Json

    $args = @(
        "--profile", $Profile,
        "--region", $Region,
        "cloudwatch", "put-metric-alarm",
        "--alarm-name", $Name,
        "--alarm-description", $Description,
        "--namespace", $Namespace,
        "--metric-name", $MetricName,
        "--statistic", $Statistic,
        "--period", "$Period",
        "--evaluation-periods", "$EvaluationPeriods",
        "--threshold", "$Threshold",
        "--comparison-operator", $ComparisonOperator,
        "--treat-missing-data", "notBreaching",
        "--alarm-actions", $topicArn,
        "--ok-actions", $topicArn
    )
    $args += "--dimensions"
    foreach ($d in $dimArgs) { $args += $d }

    if ($existing.MetricAlarms.Count -gt 0) {
        Write-Warn "  Atualizando: $Name"
    } else {
        Write-Host "  Criando: " -NoNewline -ForegroundColor Cyan; Write-Host $Name
    }

    if (-not $DryRun) {
        aws @args 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Err "  Falha em $Name"
        } else {
            Write-OK "  OK"
        }
    }
}

# -----------------------------------------------------------------------------
# 3) Alarmes SQS (4)
# -----------------------------------------------------------------------------
Write-Step "Criando alarmes SQS..."

Set-CWAlarm -Name "renthus-inbound-age-critical" `
    -Description "Idade da mensagem mais antiga na fila inbound passou de ${InboundAgeThresholdSec}s. Ver DR_RUNBOOK_SQS.md" `
    -Namespace "AWS/SQS" `
    -Dimensions @{ QueueName = "renthus-inbound.fifo" } `
    -MetricName "ApproximateAgeOfOldestMessage" `
    -Statistic "Maximum" -Period 300 -EvaluationPeriods 1 `
    -Threshold $InboundAgeThresholdSec

Set-CWAlarm -Name "renthus-outbound-age-critical" `
    -Description "Idade da mensagem mais antiga na fila outbound passou de ${OutboundAgeThresholdSec}s. Ver DR_RUNBOOK_SQS.md" `
    -Namespace "AWS/SQS" `
    -Dimensions @{ QueueName = "renthus-outbound.fifo" } `
    -MetricName "ApproximateAgeOfOldestMessage" `
    -Statistic "Maximum" -Period 300 -EvaluationPeriods 1 `
    -Threshold $OutboundAgeThresholdSec

Set-CWAlarm -Name "renthus-dlq-inbound-critical" `
    -Description "DLQ inbound tem mensagens (>0). Ver DR_RUNBOOK_SQS.md secao 4" `
    -Namespace "AWS/SQS" `
    -Dimensions @{ QueueName = "renthus-inbound-dlq.fifo" } `
    -MetricName "ApproximateNumberOfMessagesVisible" `
    -Statistic "Maximum" -Period 60 -EvaluationPeriods 1 `
    -Threshold 0

Set-CWAlarm -Name "renthus-dlq-outbound-critical" `
    -Description "DLQ outbound tem mensagens (>0). Ver DR_RUNBOOK_SQS.md secao 4" `
    -Namespace "AWS/SQS" `
    -Dimensions @{ QueueName = "renthus-outbound-dlq.fifo" } `
    -MetricName "ApproximateNumberOfMessagesVisible" `
    -Statistic "Maximum" -Period 60 -EvaluationPeriods 1 `
    -Threshold 0

# -----------------------------------------------------------------------------
# 4) Alarmes Lambda (4)
# -----------------------------------------------------------------------------
Write-Step "Criando alarmes Lambda..."

$lambdaFns = @(
    @{ Name = "renthus-inbound-worker";  Period = 300; Threshold = $LambdaErrorThreshold },
    @{ Name = "renthus-outbound-worker"; Period = 300; Threshold = $LambdaErrorThreshold },
    @{ Name = "renthus-outbox-reconcile"; Period = 900; Threshold = 1 }
)

foreach ($fn in $lambdaFns) {
    Set-CWAlarm -Name "$($fn.Name)-errors" `
        -Description "Lambda $($fn.Name) com mais de $($fn.Threshold) erros no periodo. Ver DR_RUNBOOK_SQS.md secao 4" `
        -Namespace "AWS/Lambda" `
        -Dimensions @{ FunctionName = $fn.Name } `
        -MetricName "Errors" `
        -Statistic "Sum" -Period $fn.Period -EvaluationPeriods 1 `
        -Threshold $fn.Threshold
}

# Duration p99 inbound (otimizacao, nao critico)
Set-CWAlarm -Name "renthus-inbound-worker-duration-high" `
    -Description "Lambda inbound duracao > 96s (80% do timeout 120s). Considerar subir memory." `
    -Namespace "AWS/Lambda" `
    -Dimensions @{ FunctionName = "renthus-inbound-worker" } `
    -MetricName "Duration" `
    -Statistic "Maximum" -Period 300 -EvaluationPeriods 1 `
    -Threshold 96000

# -----------------------------------------------------------------------------
# 5) Resumo final
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host " DRY-RUN CONCLUIDO - nada foi criado/alterado de fato" -ForegroundColor Yellow
    Write-Host " Rode sem -DryRun para aplicar:" -ForegroundColor Yellow
    Write-Host "   .\setup-cloudwatch-alarms.ps1" -ForegroundColor Yellow
} else {
    Write-Host " SETUP CONCLUIDO" -ForegroundColor Green
}
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Cyan
Write-Host "  1) Verifique o e-mail em $EmailOnCall - AWS enviou confirmacao" -ForegroundColor White
Write-Host "  2) Clique no link 'Confirm subscription' para receber alarmes" -ForegroundColor White
Write-Host "  3) Teste o SNS (opcional):" -ForegroundColor White
Write-Host "     aws --profile $Profile --region $Region sns publish --topic-arn $topicArn --message 'Teste Renthus'" -ForegroundColor Gray
Write-Host "  4) Veja os alarmes criados:" -ForegroundColor White
Write-Host "     https://sa-east-1.console.aws.amazon.com/cloudwatch/home?region=sa-east-1#alarmsV2:" -ForegroundColor Gray
Write-Host ""


