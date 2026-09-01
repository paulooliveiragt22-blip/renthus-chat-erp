# fix-scheduler-iam.ps1
# Aplica inline policy no IAM user renthus-cli para permitir gerenciar EventBridge Schedules.
# Necessario para rodar setup-eventbridge-scheduler.ps1 com sucesso.
#
# USO:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\fix-scheduler-iam.ps1

if (-not $env:PROFILE)     { $env:PROFILE = "renthus" }
if (-not $env:REGION)      { $env:REGION = "sa-east-1" }
if (-not $env:ACCOUNT_ID)  { $env:ACCOUNT_ID = "696457893414" }
if (-not $env:IAM_USER)    { $env:IAM_USER = "renthus-cli" }
if (-not $env:DRY_RUN)     { $env:DRY_RUN = "1" }

$PROFILE = $env:PROFILE
$REGION = $env:REGION
$ACCOUNT_ID = $env:ACCOUNT_ID
$IAM_USER = $env:IAM_USER
$DRY_RUN = $env:DRY_RUN

function Step($m) { Write-Host "[STEP] " -ForegroundColor Cyan -NoNewline; Write-Host $m }
function OK($m)   { Write-Host "[OK]   " -ForegroundColor Green -NoNewline; Write-Host $m }
function Warn($m) { Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline; Write-Host $m }
function Err($m)  { Write-Host "[ERR]  " -ForegroundColor Red -NoNewline; Write-Host $m }

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host " IAM Policy: $IAM_USER" -ForegroundColor Cyan
Write-Host " MODO: $(if ($DRY_RUN -eq '0') { 'APLICAR' } else { 'DRY-RUN' })" -ForegroundColor $(if ($DRY_RUN -eq '0') { 'Green' } else { 'Yellow' })
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

if ($DRY_RUN -eq "0") {
    $confirm = Read-Host "Aplicar inline policy ao IAM user $IAM_USER? (s/n)"
    if ($confirm -ne "s") { exit 0 }
}

$policyName = "renthus-eventbridge-scheduler-access"

# Policy que libera: gerenciar schedules renthus-* + passar role para EventBridge
$policy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EventBridgeSchedulerManage",
      "Effect": "Allow",
      "Action": [
        "scheduler:CreateSchedule",
        "scheduler:GetSchedule",
        "scheduler:UpdateSchedule",
        "scheduler:DeleteSchedule",
        "scheduler:ListSchedules",
        "scheduler:ListScheduleGroups",
        "scheduler:ListTagsForResource"
      ],
      "Resource": "arn:aws:scheduler:${REGION}:${ACCOUNT_ID}:schedule/renthus-*"
    },
    {
      "Sid": "PassRoleToEventBridge",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::${ACCOUNT_ID}:role/renthus-eventbridge-scheduler-role",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "scheduler.amazonaws.com"
        }
      }
    }
  ]
}
"@

$tmpFile = Join-Path $env:TEMP "renthus-scheduler-policy.json"
[System.IO.File]::WriteAllText($tmpFile, $policy, [System.Text.UTF8Encoding]::new($false))

if ($DRY_RUN -eq "0") {
    Step "Aplicando inline policy $policyName ao user $IAM_USER"
    aws --profile $PROFILE --region $REGION iam put-user-policy `
        --user-name $IAM_USER `
        --policy-name $policyName `
        --policy-document "file://$tmpFile" `
        --output json | Out-Null
    if ($LASTEXITCODE -eq 0) {
        OK "Policy aplicada"
    } else {
        Err "Falha ao aplicar policy"
        exit 1
    }
} else {
    OK "[DRY-RUN] Policy seria aplicada. Para aplicar:"
    Write-Host ""
    Write-Host "  `$env:DRY_RUN='0'; powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\fix-scheduler-iam.ps1" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Ou via aws cli direto:" -ForegroundColor Cyan
    Write-Host "  aws iam put-user-policy --user-name $IAM_USER --policy-name $policyName --policy-document 'file://$tmpFile'" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Cyan
Write-Host "  1) Aplicar:  `$env:CRON_SECRET='seu-token'; `$env:DRY_RUN='0'; powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\fix-scheduler-iam.ps1" -ForegroundColor White
Write-Host "  2) Depois:   npm run scheduler:setup" -ForegroundColor White
Write-Host ""
