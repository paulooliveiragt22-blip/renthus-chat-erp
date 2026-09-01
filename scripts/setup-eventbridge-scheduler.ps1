# setup-eventbridge-scheduler.ps1
# Configura os 8 crons do ADR-0003 via AWS EventBridge Scheduler + API Destination.
# Substitui cron-job.org + Vercel Hobby + crons diarios do vercel.json.
#
# POR QUE EventBridge Scheduler (Nao Rules):
#   - Scheduler tem expressoes cron mais faceis (rate/cron) + timezone nativo.
#   - API Destination e gerenciado pelo Scheduler (integracao oficial).
#   - Funciona em sa-east-1 (Sao Paulo) - confirmado.
#
# Arquitetura:
#   Connection (Bearer ${CRON_SECRET})  -> API Destination (URL) -> HTTP GET
#   1 Connection compartilhada + 1 API Destination por schedule (cada path).
#
# USO:
#   `$env:CRON_SECRET="seu-token"; npm run scheduler:setup:apply

# Defaults
if (-not $env:PROFILE)         { $env:PROFILE = "renthus" }
if (-not $env:REGION)          { $env:REGION = "sa-east-1" }
if (-not $env:ACCOUNT_ID)      { $env:ACCOUNT_ID = "696457893414" }
if (-not $env:DOMAIN)          { $env:DOMAIN = "app.renthus.com.br" }
if (-not $env:CRON_SECRET)     { $env:CRON_SECRET = "" }
if (-not $env:EMAIL)           { $env:EMAIL = "ops@renthus.com.br" }
if (-not $env:DRY_RUN)         { $env:DRY_RUN = "1" }

$PROFILE = $env:PROFILE
$REGION = $env:REGION
$ACCOUNT_ID = $env:ACCOUNT_ID
$DOMAIN = $env:DOMAIN
$CRON_SECRET = $env:CRON_SECRET
$EMAIL = $env:EMAIL
$DRY_RUN = $env:DRY_RUN

function Step($m) { Write-Host "[STEP] " -ForegroundColor Cyan -NoNewline; Write-Host $m }
function OK($m)   { Write-Host "[OK]   " -ForegroundColor Green -NoNewline; Write-Host $m }
function Warn($m) { Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $m }
function Err($m)  { Write-Host "[ERR]  " -ForegroundColor Red -NoNewline; Write-Host $m }

$mode = if ($DRY_RUN -eq "0") { "APLICAR (vai criar recursos)" } else { "DRY-RUN (so simula)" }
Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " MODO: $mode" -ForegroundColor $(if ($DRY_RUN -eq "0") { "Green" } else { "Yellow" })
Write-Host " Perfil: $PROFILE  Regiao: $REGION  Conta: $ACCOUNT_ID" -ForegroundColor Gray
Write-Host " Dominio: https://$DOMAIN" -ForegroundColor Gray
Write-Host " E-mail: $EMAIL" -ForegroundColor Gray
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

if ($DRY_RUN -eq "0") {
    $confirm = Read-Host "ATENCAO: vai criar 8 EventBridge Schedules. Continuar? (s/n)"
    if ($confirm -ne "s") {
        Write-Host "Abortado." -ForegroundColor Yellow
        exit 0
    }
}

# Verificacoes iniciais
$ErrorActionPreference = "Continue"

Step "AWS CLI check"
$awsVer = aws --version 2>&1
if ($LASTEXITCODE -ne 0) { Err "AWS CLI nao instalado"; exit 1 }
OK $awsVer

Step "STS caller identity"
$identityJson = aws --profile $PROFILE --region $REGION sts get-caller-identity --output json 2>&1
if ($LASTEXITCODE -ne 0) { Err "Falha sts:get-caller-identity"; exit 1 }
$identity = $identityJson | ConvertFrom-Json
OK "Caller: $($identity.Arn)"

Step "Testando endpoint scheduler na regiao $REGION"
$testSchedJson = aws --profile $PROFILE --region $REGION scheduler list-schedules --max-results 1 --output json 2>&1
$testSchedExit = $LASTEXITCODE
if ($testSchedExit -eq 0) {
    OK "Endpoint scheduler.$REGION.amazonaws.com respondendo"
} else {
    $testErr = ($testSchedJson | Out-String).Trim()
    if ($testErr.Length -gt 200) { $testErr = $testErr.Substring(0, 200) }
    Err "Endpoint scheduler.$REGION.amazonaws.com NAO disponivel"
    Write-Host "  Erro: $testErr" -ForegroundColor DarkYellow
    if ($DRY_RUN -eq "0") { exit 1 }
}

# -----------------------------------------------------------------------------
# Validar CRON_SECRET
# -----------------------------------------------------------------------------
if ([string]::IsNullOrWhiteSpace($CRON_SECRET)) {
    Warn "================================================================"
    Warn " CRON_SECRET NAO DEFINIDO - schedules serao criados SEM auth"
    Warn "================================================================"
    Warn ""
    Warn " Os endpoints Vercel vao retornar 401 Unauthorized porque"
    Warn " esperam `Authorization: Bearer <CRON_SECRET>`."
    Warn ""
    Warn " Para corrigir, ANTES de rodar este script faca:"
    Warn "   `$env:CRON_SECRET = 'valor-igual-ao-da-vercel'"
    Warn ""
    Warn " Voce encontra o valor em:"
    Warn "   Vercel Dashboard > Settings > Environment Variables > CRON_SECRET"
    Warn ""
    Warn "================================================================"
} else {
    OK "CRON_SECRET definido (length: $($CRON_SECRET.Length)) - chamadas HTTP serao autenticadas"
}

# -----------------------------------------------------------------------------
# IAM Role para EventBridge Scheduler chamar API Destination
# -----------------------------------------------------------------------------
$ebRoleName = "renthus-eventbridge-scheduler-role"
$ebRoleArn = "arn:aws:iam::${ACCOUNT_ID}:role/${ebRoleName}"

Step "Verificando IAM role $ebRoleName"
$roleExists = $false
try {
    $roleJson = aws --profile $PROFILE --region $REGION iam get-role --role-name $ebRoleName --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
        $roleJson = $null
    }
} catch {
    $roleJson = $null
}

if ($roleJson) {
    OK "Role ja existe: $ebRoleArn"
} else {
    if ($DRY_RUN -eq "0") {
        Step "Criando IAM role $ebRoleName"

        $trustPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "scheduler.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
"@

        $trustFile = Join-Path $env:TEMP "eb-trust-policy.json"
        [System.IO.File]::WriteAllText($trustFile, $trustPolicy, [System.Text.UTF8Encoding]::new($false))

        aws --profile $PROFILE --region $REGION iam create-role `
            --role-name $ebRoleName `
            --assume-role-policy-document "file://$trustFile" `
            --output json | Out-Null
        if ($LASTEXITCODE -ne 0) { Err "Falha criando role"; exit 1 }

        # Policy minima: permite invocar API Destination
        # (usado pelo target aws-sdk:eventbridge:invokeApiDestination)
        $rolePolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "events:InvokeApiDestination",
      "Resource": "arn:aws:events:${REGION}:${ACCOUNT_ID}:api-destination/*"
    }
  ]
}
"@

        $rolePolicyFile = Join-Path $env:TEMP "eb-role-policy.json"
        [System.IO.File]::WriteAllText($rolePolicyFile, $rolePolicy, [System.Text.UTF8Encoding]::new($false))

        aws --profile $PROFILE --region $REGION iam put-role-policy `
            --role-name $ebRoleName `
            --policy-name renthus-scheduler-invoke-api-destination `
            --policy-document "file://$rolePolicyFile" | Out-Null

        OK "Role criada com policy: $ebRoleArn"
    } else {
        OK "[DRY-RUN] Role seria criada: $ebRoleArn"
    }
}

# -----------------------------------------------------------------------------
# Funcao: garantir Connection (Bearer auth compartilhada)
# -----------------------------------------------------------------------------
function Ensure-Connection {
    param([string]$Name)

    Step "Connection: $Name"

    $descJson = aws --profile $PROFILE --region $REGION events describe-connection `
        --name $Name --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $desc = $descJson | ConvertFrom-Json
        OK "Connection ja existe: $($desc.ConnectionArn)"
        return $desc.ConnectionArn
    }

    if ($DRY_RUN -ne "0") {
        OK "[DRY-RUN] Connection seria criada: $Name"
        return "arn:aws:events:${REGION}:${ACCOUNT_ID}:connection/${Name}/DRY-RUN"
    }

    $connInput = @{
        Name                 = $Name
        Description          = "Bearer auth para crons Vercel (CRON_SECRET)"
        AuthorizationType    = "API_KEY"
        AuthParameters       = @{
            ApiKeyAuthParameters = @{
                ApiKeyName  = "Authorization"
                ApiKeyValue = "Bearer $CRON_SECRET"
            }
        }
    } | ConvertTo-Json -Depth 10

    $connFile = Join-Path $env:TEMP "eb-conn-$Name.json"
    [System.IO.File]::WriteAllText($connFile, $connInput, [System.Text.UTF8Encoding]::new($false))

    $createOut = aws --profile $PROFILE --region $REGION events create-connection `
        --cli-input-json "file://$connFile" --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
        Err "Falha criando Connection $Name"
        Write-Host "  AWS: $createOut" -ForegroundColor DarkYellow
        exit 1
    }

    $created = $createOut | ConvertFrom-Json
    OK "Connection criada: $($created.ConnectionArn)"
    return $created.ConnectionArn
}

# -----------------------------------------------------------------------------
# Funcao: garantir API Destination (URL HTTP)
# -----------------------------------------------------------------------------
function Ensure-ApiDestination {
    param(
        [string]$Name,
        [string]$ConnectionArn,
        [string]$Endpoint,
        [string]$Method = "GET"
    )

    Step "ApiDestination: $Name"

    $descJson = aws --profile $PROFILE --region $REGION events describe-api-destination `
        --name $Name --output json 2>&1
    if ($LASTEXITCODE -eq 0) {
        $desc = $descJson | ConvertFrom-Json
        OK "ApiDestination ja existe: $($desc.ApiDestinationArn)"
        return $desc.ApiDestinationArn
    }

    if ($DRY_RUN -ne "0") {
        OK "[DRY-RUN] ApiDestination seria criada: $Name -> $Endpoint"
        return "arn:aws:events:${REGION}:${ACCOUNT_ID}:api-destination/${Name}/DRY-RUN"
    }

    $destInput = @{
        Name                              = $Name
        Description                       = "HTTP $Method $Endpoint (cron job)"
        ConnectionArn                     = $ConnectionArn
        InvocationEndpoint                = $Endpoint
        HttpMethod                        = $Method
        InvocationRateLimitPerSecond      = 10
    } | ConvertTo-Json -Depth 10

    $destFile = Join-Path $env:TEMP "eb-dest-$Name.json"
    [System.IO.File]::WriteAllText($destFile, $destInput, [System.Text.UTF8Encoding]::new($false))

    $createOut = aws --profile $PROFILE --region $REGION events create-api-destination `
        --cli-input-json "file://$destFile" --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
        Err "Falha criando ApiDestination $Name"
        Write-Host "  AWS: $createOut" -ForegroundColor DarkYellow
        exit 1
    }

    $created = $createOut | ConvertFrom-Json
    OK "ApiDestination criada: $($created.ApiDestinationArn)"
    return $created.ApiDestinationArn
}

# -----------------------------------------------------------------------------
# Setup de Connection compartilhada (Bearer CRON_SECRET)
# -----------------------------------------------------------------------------
Step "Criando/verificando EventBridge Connection (Bearer)"

if ($DRY_RUN -eq "0") {
    $connectionArn = Ensure-Connection -Name "renthus-cron-connection"
} else {
    OK "[DRY-RUN] Connection seria criada: renthus-cron-connection"
    $connectionArn = "arn:aws:events:${REGION}:${ACCOUNT_ID}:connection/renthus-cron-connection/DRY-RUN"
}

# -----------------------------------------------------------------------------
# Funcao helper: criar/atualizar EventBridge Schedule via API Destination
# -----------------------------------------------------------------------------
function Set-Schedule {
    param(
        [string]$Name,
        [string]$ScheduleExpression,
        [string]$Path,
        [string]$Description
    )

    Step "Schedule: $Name"
    $url = "https://$DOMAIN$Path"

    # 1) Garantir API Destination para este endpoint
    $apiDestName = "renthus-dest-$Name"
    if ($DRY_RUN -eq "0") {
        $apiDestArn = Ensure-ApiDestination -Name $apiDestName -ConnectionArn $connectionArn -Endpoint $url -Method "GET"
    } else {
        OK "[DRY-RUN] ApiDestination seria criada: $apiDestName -> $url"
        $apiDestArn = "arn:aws:events:${REGION}:${ACCOUNT_ID}:api-destination/${apiDestName}/DRY-RUN"
    }

    if ($DRY_RUN -ne "0") {
        OK "[DRY-RUN] Schedule seria criado: renthus-$Name -> $url ($ScheduleExpression)"
        return
    }

    # 2) Payload do schedule - usar aws-sdk:eventbridge:invokeApiDestination
    # O Scheduler NAO aceita o ARN da API Destination diretamente em Target.Arn.
    # O caminho oficial e usar o target SDK Universal que invoca a operacao
    # eventbridge:InvokeApiDestination, passando o ApiDestinationArn no Input.
    $invokeInput = (@{
        "ApiDestinationArn" = $apiDestArn
        "HttpMethod"        = "GET"
    } | ConvertTo-Json -Compress)

    $fullInput = @{
        "Name"                       = "renthus-$Name"
        "Description"                = $Description
        "ScheduleExpression"         = $ScheduleExpression
        "ScheduleExpressionTimezone" = "America/Sao_Paulo"
        "State"                      = "ENABLED"
        "FlexibleTimeWindow"         = @{ "Mode" = "OFF" }
        "ActionAfterCompletion"      = "NONE"
        "Target"                     = @{
            "Arn"     = "arn:aws:scheduler:::aws-sdk:eventbridge:invokeApiDestination"
            "RoleArn" = $ebRoleArn
            "Input"   = $invokeInput
        }
    } | ConvertTo-Json -Depth 10

    $tmpDir = Join-Path $env:TEMP "renthus-scheduler"
    if (-not (Test-Path $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null }
    $inputFile = Join-Path $tmpDir "input-$Name.json"
    [System.IO.File]::WriteAllText($inputFile, $fullInput, [System.Text.UTF8Encoding]::new($false))

    # 3) Tentar update primeiro (idempotente); se falhar, criar
    # Usar cmd /c para bypassar o comportamento de NativeCommandError do PowerShell
    # (senao o stderr vira RemoteException e some no limbo)
    $updateOut = cmd /c "aws --profile $PROFILE --region $REGION scheduler update-schedule --cli-input-json file://$inputFile --output json 2>&1"
    $updateExit = $LASTEXITCODE

    if ($updateExit -eq 0) {
        OK "Atualizado: renthus-$Name -> $url"
    } else {
        # 4) Criar (caso nao exista)
        $createOut = cmd /c "aws --profile $PROFILE --region $REGION scheduler create-schedule --cli-input-json file://$inputFile --output json 2>&1"
        $createExit = $LASTEXITCODE

        if ($createExit -eq 0) {
            OK "Criado: renthus-$Name -> $url"
        } else {
            $errMsg = ($createOut | Out-String).Trim()
            if ([string]::IsNullOrWhiteSpace($errMsg)) { $errMsg = "(sem mensagem - exit=$createExit)" }
            $lines = $errMsg -split "`n" | Select-Object -First 8
            $snippet = ($lines -join " | ") -replace "`r", ""
            if ($snippet.Length -gt 500) { $snippet = $snippet.Substring(0, 500) + "..." }

            Err "Falha em renthus-$Name (exit=$createExit)"
            Write-Host "  AWS: $snippet" -ForegroundColor DarkYellow
        }
    }
}

# -----------------------------------------------------------------------------
# 8 crons do ADR-0003 (substitui cron-job.org + Vercel Hobby)
# -----------------------------------------------------------------------------
Step "Criando 8 EventBridge Schedules (ADR-0003)"

# 1) Reactivate (5 min) - Vercel /api/chatbot/reactivate
Set-Schedule -Name "reactivate" `
    -ScheduleExpression "rate(5 minutes)" `
    -Path "/api/chatbot/reactivate" `
    -Description "Reativa bot em threads em handover sem resposta humana por 5+ min (substitui cron-job.org)"

# 2) Detect abandoned carts (5 min) - Vercel /api/chatbot/detect-abandoned-carts
Set-Schedule -Name "detect-abandoned-carts" `
    -ScheduleExpression "rate(5 minutes)" `
    -Path "/api/chatbot/detect-abandoned-carts" `
    -Description "Detecta rascunhos parados e enfileira mensagens de recuperacao (substitui cron Vercel)"

# 3) Billing charge (diario 11:00 UTC = 08:00 BRT)
Set-Schedule -Name "billing-charge" `
    -ScheduleExpression "cron(0 11 * * ? *)" `
    -Path "/api/billing/charge" `
    -Description "Cobranca diaria de assinaturas: trial/active vencido, retry card, overdue D1/D3/D5+ (substitui cron Vercel)"

# 4) Billing mark-abandoned (diario 09:00 UTC = 06:00 BRT)
Set-Schedule -Name "billing-mark-abandoned" `
    -ScheduleExpression "cron(0 9 * * ? *)" `
    -Path "/api/billing/mark-abandoned" `
    -Description "Marca assinaturas abandoned apos 30+ dias sem pagamento (substitui cron Vercel)"

# 5) Billing expire-trials (diario 10:00 UTC = 07:00 BRT)
Set-Schedule -Name "billing-expire-trials" `
    -ScheduleExpression "cron(0 10 * * ? *)" `
    -Path "/api/billing/expire-trials" `
    -Description "Expira trials nao convertidos apos periodo limite (substitui cron Vercel)"

# 6) Marketplace sync-catalog (diario 04:00 UTC = 01:00 BRT)
Set-Schedule -Name "marketplace-sync-catalog" `
    -ScheduleExpression "cron(0 4 * * ? *)" `
    -Path "/api/marketplace/sync-catalog" `
    -Description "Sync automatico de catalogo marketplace iFood/Aiqfome (substitui cron Vercel)"

# 7) Platform alerts check (15 min) + audit archive (mensal 05:00 UTC dia 1)
Set-Schedule -Name "platform-alerts-check" `
    -ScheduleExpression "rate(15 minutes)" `
    -Path "/api/platform/alerts/check" `
    -Description "Avalia alertas platform e reporta ao Sentry (substitui cron Vercel)"

Set-Schedule -Name "platform-audit-archive" `
    -ScheduleExpression "cron(0 5 1 * ? *)" `
    -Path "/api/platform/audit/archive" `
    -Description "Arquiva rows de platform_audit_log com >24 meses no Storage (substitui cron Vercel)"

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
if ($DRY_RUN -eq "0") {
    Write-Host " SETUP CONCLUIDO" -ForegroundColor Green
    Write-Host " 8 schedules criados no EventBridge Scheduler" -ForegroundColor Green
    Write-Host " Substitui: cron-job.org (3 jobs) + Vercel Hobby crons (7 jobs)" -ForegroundColor Green
} else {
    Write-Host " DRY-RUN CONCLUIDO" -ForegroundColor Yellow
    Write-Host " Rode com `$env:DRY_RUN='0' para aplicar de verdade" -ForegroundColor Yellow
}
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Cyan
Write-Host "  1) Verifique no console:" -ForegroundColor White
Write-Host "     https://sa-east-1.console.aws.amazon.com/scheduler/home?region=sa-east-1#schedules" -ForegroundColor Gray
Write-Host "  2) Remova os crons antigos:" -ForegroundColor White
Write-Host "     a) Vercel: https://vercel.com/seu-projeto/settings/crons" -ForegroundColor Gray
Write-Host "     b) cron-job.org: https://console.cron-job.org/jobs (rodar: npm run cleanup:cron-job-org)" -ForegroundColor Gray
Write-Host "  3) Primeiro teste: aguarde 5 min e veja logs do schedule 'reactivate'" -ForegroundColor White
Write-Host ""


