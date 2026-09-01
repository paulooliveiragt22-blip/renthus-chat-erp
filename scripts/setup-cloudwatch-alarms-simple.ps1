# Setup-CW-Alarms-Simple.ps1
# Versao minima sem param/CmdletBinding para evitar problemas de parser PS 5.1.
# Parametros via variaveis de ambiente (set antes de rodar):
#   $env:PROFILE   = perfil AWS (default: renthus)
#   $env:REGION    = regiao (default: sa-east-1)
#   $env:ACCOUNT_ID = id conta AWS (default: 696457893414)
#   $env:EMAIL     = e-mail on-call para subscription SNS (default: ops@renthus.com.br)
#   $env:DRY_RUN   = "1" para so simular (default), "0" para aplicar de verdade

if (-not $env:PROFILE)     { $env:PROFILE = "renthus" }
if (-not $env:REGION)      { $env:REGION = "sa-east-1" }
if (-not $env:ACCOUNT_ID)  { $env:ACCOUNT_ID = "696457893414" }
if (-not $env:EMAIL)       { $env:EMAIL = "ops@renthus.com.br" }
if (-not $env:DRY_RUN)     { $env:DRY_RUN = "1" }

$PROFILE = $env:PROFILE
$REGION = $env:REGION
$ACCOUNT_ID = $env:ACCOUNT_ID
$EMAIL = $env:EMAIL
$DRY_RUN = $env:DRY_RUN

# Banner mostrando modo
$mode = if ($DRY_RUN -eq "0") { "APLICAR (vai criar recursos)" } else { "DRY-RUN (so simula)" }
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " MODO: $mode" -ForegroundColor $(if ($DRY_RUN -eq "0") { "Green" } else { "Yellow" })
Write-Host " Perfil: $PROFILE  Regiao: $REGION  Conta: $ACCOUNT_ID" -ForegroundColor Gray
Write-Host " E-mail: $EMAIL" -ForegroundColor Gray
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

# Pausa se for aplicar de verdade, para evitar acidente
if ($DRY_RUN -eq "0") {
    $confirm = Read-Host "ATENCAO: modo APLIQUE vai criar recursos reais. Continuar? (s/n)"
    if ($confirm -ne "s") {
        Write-Host "Abortado pelo usuario." -ForegroundColor Yellow
        exit 0
    }
}

function Step($m) { Write-Host "[STEP] " -ForegroundColor Cyan -NoNewline; Write-Host $m }
function OK($m)   { Write-Host "[OK]   " -ForegroundColor Green -NoNewline; Write-Host $m }
function Warn($m) { Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $m }
function Err($m)  { Write-Host "[ERR]  " -ForegroundColor Red -NoNewline; Write-Host $m }

$ErrorActionPreference = "Continue"

Step "AWS CLI check"
$awsVer = aws --version 2>&1
if ($LASTEXITCODE -ne 0) { Err "AWS CLI nao instalado"; exit 1 }
OK $awsVer

Step "STS caller identity"
$identityJson = aws --profile $PROFILE --region $REGION sts get-caller-identity --output json 2>&1
if ($LASTEXITCODE -ne 0) { Err "Falha sts:get-caller-identity"; Write-Host $identityJson; exit 1 }
$identity = $identityJson | ConvertFrom-Json
OK "Caller: $($identity.Arn)"

$TOPIC_NAME = "renthus-ops"
$TOPIC_ARN = "arn:aws:sns:${REGION}:${ACCOUNT_ID}:${TOPIC_NAME}"

Step "Verifica SNS topic $TOPIC_NAME"
$topicJson = aws --profile $PROFILE --region $REGION sns list-topics --output json 2>&1
$topics = $topicJson | ConvertFrom-Json
$topicExists = $false
foreach ($t in $topics.Topics) {
    if ($t.TopicArn -eq $TOPIC_ARN) { $topicExists = $true; break }
}

if ($topicExists) {
    OK "Topic ja existe: $TOPIC_ARN"
} else {
    if ($DRY_RUN -eq "0") {
        aws --profile $PROFILE --region $REGION sns create-topic --name $TOPIC_NAME --output json | Out-Null
        OK "Topic criado: $TOPIC_ARN"
    } else {
        OK "[DRY-RUN] Topic seria criado: $TOPIC_ARN"
    }
}

Step "Verifica subscription de e-mail: $EMAIL"
$subsJson = ""
$subsOk = $false
try {
    $subsJson = aws --profile $PROFILE --region $REGION sns list-subscriptions-by-topic --topic-arn $TOPIC_ARN --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $subs = $subsJson | ConvertFrom-Json
        $subsOk = $true
    }
} catch { }

if ($subsOk) {
    $emailSub = $false
    foreach ($s in $subs.Subscriptions) {
        if ($s.Protocol -eq "email" -and $s.Endpoint -eq $EMAIL) { $emailSub = $true; break }
    }
    if ($emailSub) {
        OK "Subscription ja existe"
    } else {
        if ($DRY_RUN -eq "0") {
            aws --profile $PROFILE --region $REGION sns subscribe --topic-arn $TOPIC_ARN --protocol email --notification-endpoint $EMAIL --output json | Out-Null
            OK "Subscription criada. CONFIRME no e-mail."
        } else {
            OK "[DRY-RUN] Subscription seria criada para $EMAIL"
        }
    }
} else {
    # topic nao existe ainda - subscription sera criada depois
    if ($DRY_RUN -eq "0") {
        Warn "Topic ainda nao existe. Sera criado na fase 1."
        OK "Subscription a ser criada (topico nao existe ainda)"
    } else {
        OK "[DRY-RUN] Subscription seria criada para $EMAIL (topico sera criado junto)"
    }
}

# Helper para criar alarme
function SetAlarm($name, $desc, $ns, $dim, $metric, $stat, $period, $threshold) {
    Step "Alarme: $name"
    $action = "Criando"
    try {
        $existsJson = aws --profile $PROFILE --region $REGION cloudwatch describe-alarms --alarm-names $name --output json 2>&1
        if ($LASTEXITCODE -eq 0) {
            $exists = $existsJson | ConvertFrom-Json
            if ($exists.MetricAlarms.Count -gt 0) {
                $action = "Atualizando"
            }
        }
    } catch { }

    $dimStr = "Name=QueueName,Value=$dim"
    if ($ns -eq "AWS/Lambda") { $dimStr = "Name=FunctionName,Value=$dim" }

    $args = @(
        "--profile", $PROFILE,
        "--region", $REGION,
        "cloudwatch", "put-metric-alarm",
        "--alarm-name", $name,
        "--alarm-description", $desc,
        "--namespace", $ns,
        "--metric-name", $metric,
        "--statistic", $stat,
        "--period", "$period",
        "--evaluation-periods", "1",
        "--threshold", "$threshold",
        "--comparison-operator", "GreaterThanThreshold",
        "--treat-missing-data", "notBreaching",
        "--alarm-actions", $TOPIC_ARN,
        "--ok-actions", $TOPIC_ARN,
        "--dimensions", $dimStr
    )

    if ($DRY_RUN -eq "0") {
        aws @args 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { OK "$action OK" } else { Err "Falha em $name" }
    } else {
        OK "[DRY-RUN] $action seria feito"
    }
}

Step "Criando alarmes SQS (4)"
SetAlarm "renthus-inbound-age-critical" "Idade > 120s na fila inbound. DR_RUNBOOK_SQS.md" "AWS/SQS" "renthus-inbound.fifo" "ApproximateAgeOfOldestMessage" "Maximum" 300 120
SetAlarm "renthus-outbound-age-critical" "Idade > 180s na fila outbound. DR_RUNBOOK_SQS.md" "AWS/SQS" "renthus-outbound.fifo" "ApproximateAgeOfOldestMessage" "Maximum" 300 180
SetAlarm "renthus-dlq-inbound-critical" "DLQ inbound tem mensagens. DR_RUNBOOK_SQS.md" "AWS/SQS" "renthus-inbound-dlq.fifo" "ApproximateNumberOfMessagesVisible" "Maximum" 60 0
SetAlarm "renthus-dlq-outbound-critical" "DLQ outbound tem mensagens. DR_RUNBOOK_SQS.md" "AWS/SQS" "renthus-outbound-dlq.fifo" "ApproximateNumberOfMessagesVisible" "Maximum" 60 0

Step "Criando alarmes Lambda (4)"
SetAlarm "renthus-inbound-worker-errors" "Lambda inbound com erros. DR_RUNBOOK_SQS.md" "AWS/Lambda" "renthus-inbound-worker" "Errors" "Sum" 300 5
SetAlarm "renthus-outbound-worker-errors" "Lambda outbound com erros. DR_RUNBOOK_SQS.md" "AWS/Lambda" "renthus-outbound-worker" "Errors" "Sum" 300 5
SetAlarm "renthus-outbox-reconcile-errors" "Lambda reconciler com erros. DR_RUNBOOK_SQS.md" "AWS/Lambda" "renthus-outbox-reconcile" "Errors" "Sum" 900 1
SetAlarm "renthus-inbound-worker-duration-high" "Lambda inbound > 96s. Considerar memory." "AWS/Lambda" "renthus-inbound-worker" "Duration" "Maximum" 300 96000

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
if ($DRY_RUN -eq "0") { Write-Host " SETUP CONCLUIDO" -ForegroundColor Green }
else { Write-Host " DRY-RUN CONCLUIDO (set DRY_RUN=0 para aplicar)" -ForegroundColor Yellow }
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Para aplicar de verdade (sem dry-run):" -ForegroundColor Cyan
Write-Host "  `$env:DRY_RUN=0; .\setup-cloudwatch-alarms-simple.ps1" -ForegroundColor White
Write-Host ""
Write-Host "Console AWS: https://sa-east-1.console.aws.amazon.com/cloudwatch/home?region=sa-east-1#alarmsV2:" -ForegroundColor Gray

