# Cleanup do plano errado (Lambda bridge) + criacao do plano correto (Scheduler HTTP)
# Conforme ADR-0003: "Manter na Vercel: crons sem fila via EventBridge Scheduler -> HTTP"
# (linha 82-85 + tabela EventBridge Scheduler linha 256-261)
#
# Pre-requisitos:
#   - aws CLI perfil "renthus"
#   - Variavel de ambiente CRON_SECRET definida (valor original do .env.local)
#   - Role existente: renthus-eventbridge-scheduler-role
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\cleanup-and-create-scheduler-crons.ps1

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1",
    [string]$SchedulerRoleName = "renthus-eventbridge-scheduler-role",
    [string]$BaseUrl = "https://app.renthus.com.br",
    [string]$CronSecretEnvVarName = "CRON_SECRET",
    [string]$ScheduleGroupName = "default"
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

Write-Host "=== Cleanup + Scheduler HTTP (ADR-0003) ===" -ForegroundColor Cyan
Write-Host "Profile=$Profile  Region=$Region"

# =====================================================================
# FASE 1: CLEANUP (deletar plano errado)
# =====================================================================

Write-Host ""
Write-Host "=== FASE 1: CLEANUP ===" -ForegroundColor Magenta

# --- 1.1 Deletar Lambda renthus-cron-bridge ---
Write-Host ""
Write-Host "[1.1] Deletando Lambda renthus-cron-bridge..." -ForegroundColor Cyan
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$fnExists = aws --profile $Profile --region $Region --no-cli-pager lambda get-function --function-name renthus-cron-bridge --output json 2>$null
$ErrorActionPreference = $prevEap
if ($fnExists) {
    Invoke-AwsRaw @("lambda", "delete-function", "--function-name", "renthus-cron-bridge")
    Write-Host "  Lambda deletada" -ForegroundColor Green
} else {
    Write-Host "  Lambda nao existe, skip" -ForegroundColor DarkGray
}

# --- 1.2 Deletar 3 EventBridge Rules ---
Write-Host ""
Write-Host "[1.2] Deletando EventBridge Rules..." -ForegroundColor Cyan
$rulesToDelete = @(
    "renthus-reactivate-5m",
    "renthus-detect-carts-5m",
    "renthus-platform-alerts-15m"
)
foreach ($ruleName in $rulesToDelete) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $ruleExists = aws --profile $Profile --region $Region --no-cli-pager events describe-rule --name $ruleName --output json 2>$null
    $ErrorActionPreference = $prevEap
    if ($ruleExists) {
        # Listar target IDs reais antes de remover
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        $targetsJson = aws --profile $Profile --region $Region --no-cli-pager events list-targets-by-rule --rule $ruleName --output json 2>$null
        $ErrorActionPreference = $prevEap
        if ($targetsJson) {
            $targets = ($targetsJson | ConvertFrom-Json).Targets
            if ($targets -and $targets.Count -gt 0) {
                $targetIds = @()
                foreach ($t in $targets) { $targetIds += $t.Id }
                Write-Host "  Removendo $($targetIds.Count) target(s) da rule $ruleName..." -ForegroundColor DarkGray
                $prevEap = $ErrorActionPreference
                $ErrorActionPreference = "SilentlyContinue"
                $args = @("events", "remove-targets", "--rule", $ruleName)
                foreach ($id in $targetIds) { $args += @("--ids", $id) }
                aws --profile $Profile --region $Region --no-cli-pager @args 2>&1 | Out-Null
                $ErrorActionPreference = $prevEap
            }
        }
        Invoke-AwsRaw @("events", "delete-rule", "--name", $ruleName)
        Write-Host "  Rule $ruleName deletada" -ForegroundColor Green
    } else {
        Write-Host "  Rule $ruleName nao existe, skip" -ForegroundColor DarkGray
    }
}

# --- 1.3 Deletar Role renthus-cron-bridge-role ---
Write-Host ""
Write-Host "[1.3] Deletando IAM Role renthus-cron-bridge-role..." -ForegroundColor Cyan
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$roleExists = aws --profile $Profile --region $Region --no-cli-pager iam get-role --role-name renthus-cron-bridge-role --output json 2>$null
$ErrorActionPreference = $prevEap
if ($roleExists) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    aws --profile $Profile --region $Region --no-cli-pager iam detach-role-policy --role-name renthus-cron-bridge-role --policy-arn "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" 2>$null | Out-Null
    $ErrorActionPreference = $prevEap
    Invoke-AwsRaw @("iam", "delete-role", "--role-name", "renthus-cron-bridge-role")
    Write-Host "  Role deletada" -ForegroundColor Green
} else {
    Write-Host "  Role nao existe, skip" -ForegroundColor DarkGray
}

# --- 1.4 Deletar parametro SSM ---
Write-Host ""
Write-Host "[1.4] Deletando SSM Parameter /renthus/cron-bridge/cron-secret..." -ForegroundColor Cyan
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
$paramExists = aws --profile $Profile --region $Region --no-cli-pager ssm describe-parameters --parameter-filters "Key=Name,Option=Equals,Values=/renthus/cron-bridge/cron-secret" --query "Parameters[0].Name" --output text 2>$null
$ErrorActionPreference = $prevEap
if ($paramExists -and $paramExists -ne "None") {
    Invoke-AwsRaw @("ssm", "delete-parameter", "--name", "/renthus/cron-bridge/cron-secret")
    Write-Host "  Parametro SSM deletado" -ForegroundColor Green
} else {
    Write-Host "  Parametro SSM nao existe, skip" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== Cleanup OK ===" -ForegroundColor Green

# =====================================================================
# FASE 2: CRIACAO DOS 3 SCHEDULER JOBS HTTP (sem Lambda bridge)
# Conforme ADR-0003: "EventBridge Scheduler -> HTTP" (linha 82-85)
# =====================================================================

Write-Host ""
Write-Host "=== FASE 2: Scheduler HTTP jobs ===" -ForegroundColor Magenta

# --- 2.1 Validar IAM Role do Scheduler ---
Write-Host ""
Write-Host "[2.1] Validando IAM Role $SchedulerRoleName..." -ForegroundColor Cyan
$schedulerRoleArn = Invoke-AwsText @("iam", "get-role", "--role-name", $SchedulerRoleName, "--query", "Role.Arn")
if (-not $schedulerRoleArn) {
    throw "Role '$SchedulerRoleName' nao encontrada."
}
Write-Host "  Role OK: $schedulerRoleArn" -ForegroundColor Green

# --- 2.2 Ler CRON_SECRET da env var ---
Write-Host ""
Write-Host "[2.2] Lendo CRON_SECRET..." -ForegroundColor Cyan
$cronSecret = [Environment]::GetEnvironmentVariable($CronSecretEnvVarName, "User")
if (-not $cronSecret) {
    $cronSecret = [Environment]::GetEnvironmentVariable($CronSecretEnvVarName, "Process")
}
if (-not $cronSecret) {
    throw "Variavel $CronSecretEnvVarName nao definida. Set antes de rodar: `$env:$CronSecretEnvVarName = 'valor'"
}
Write-Host "  CRON_SECRET OK (comprimento: $($cronSecret.Length))" -ForegroundColor Green

# --- 2.3 Criar/atualizar os 3 Scheduler jobs ---
function Create-SchedulerJob {
    param(
        [string]$JobName,
        [string]$ScheduleExpression,
        [string]$TargetUrl,
        [string]$Description
    )

    Write-Host ""
    Write-Host "[2.3] Job: $JobName" -ForegroundColor Cyan

    # Verificar se ja existe
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $existing = aws --profile $Profile --region $Region --no-cli-pager scheduler get-schedule --name $JobName --group-name $ScheduleGroupName --output json 2>$null
    $ErrorActionPreference = $prevEap

    # Universal HTTP target: arn:aws:scheduler:::http-endpoint
    # Target JSON com HeaderParameters para Authorization Bearer
    $target = @{
        Arn              = "arn:aws:scheduler:::http-endpoint"
        RoleArn          = $schedulerRoleArn
        HttpParameters   = @{
            HeaderParameters = @{
                "Authorization" = "Bearer $cronSecret"
                "Content-Type"  = "application/json"
            }
            QueryStringParameters = @{}
        }
    } | ConvertTo-Json -Depth 6 -Compress

    $targetFile = Join-Path $env:TEMP "renthus-scheduler-target-$JobName.json"
    [System.IO.File]::WriteAllText($targetFile, $target, [System.Text.UTF8Encoding]::new($false))
    $targetUri = "file://" + ($targetFile -replace "\\", "/")

    # Flexible time window: escrever em arquivo separado para evitar bug do PowerShell ConvertTo-Json
    $flexFile = Join-Path $env:TEMP "renthus-scheduler-flex-$JobName.json"
    [System.IO.File]::WriteAllText($flexFile, '{"Mode":"OFF"}', [System.Text.UTF8Encoding]::new($false))
    $flexUri = "file://" + ($flexFile -replace "\\", "/")

    $subCmd = if ($existing) { "update-schedule" } else { "create-schedule" }
    if ($existing) {
        Write-Host "  Job existe, atualizando..." -ForegroundColor Yellow
    }

    Invoke-AwsRaw @(
        "scheduler", $subCmd,
        "--name", $JobName,
        "--group-name", $ScheduleGroupName,
        "--schedule-expression", $ScheduleExpression,
        "--state", "ENABLED",
        "--description", $Description,
        "--target", $targetUri,
        "--flexible-time-window", $flexUri
    )

    Write-Host "  OK: $JobName -> $TargetUrl" -ForegroundColor Green
}

Create-SchedulerJob `
    -JobName "renthus-reactivate-5m" `
    -ScheduleExpression "rate(5 minutes)" `
    -TargetUrl "$BaseUrl/api/chatbot/reactivate" `
    -Description "Reativar bot em handover sem resposta > 5min (ADR-0003 Fase 4)"

Create-SchedulerJob `
    -JobName "renthus-detect-carts-5m" `
    -ScheduleExpression "rate(5 minutes)" `
    -TargetUrl "$BaseUrl/api/chatbot/detect-abandoned-carts" `
    -Description "Detectar carrinhos abandonados a cada 5 min (ADR-0003 Fase 4)"

Create-SchedulerJob `
    -JobName "renthus-platform-alerts-15m" `
    -ScheduleExpression "rate(15 minutes)" `
    -TargetUrl "$BaseUrl/api/platform/alerts/check" `
    -Description "Avaliar alertas de plataforma a cada 15 min (ADR-0003 Fase 4)"

Write-Host ""
Write-Host "=== Deploy OK ===" -ForegroundColor Green
Write-Host "  3 Scheduler jobs HTTP criados (sem Lambda bridge)"
Write-Host "  Auth: Authorization Bearer no header (via HeaderParameters)"
Write-Host ""
Write-Host "Para listar os jobs:" -ForegroundColor Cyan
Write-Host "  aws --profile $Profile --region $Region scheduler list-schedules --group-name $ScheduleGroupName"
Write-Host ""
Write-Host "Para ver execucao de um job (CloudWatch Logs):"
Write-Host "  aws --profile $Profile --region $Region logs describe-log-groups --log-group-name-prefix /aws/scheduler"