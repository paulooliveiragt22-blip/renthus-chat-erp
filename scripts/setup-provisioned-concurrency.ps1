# scripts/setup-provisioned-concurrency.ps1
#
# Fase 7 (PR 7) — Aplica Provisioned Concurrency para eliminar cold-start
# ADR-0003 — APROVADO 2026-09-01
#
# O QUE FAZ:
#   - Configura 1 unidade de Provisioned Concurrency em `renthus-inbound-worker`
#   - Idempotente: re-executar com -Count diferente aplica o novo valor
#   - Para desativar: -Count 0 (deleta config; custo cai a zero)
#
# CUSTO (sa-east-1, x86, 1024MB):
#   1 unidade × 730h × 1GB × USD 0.0000083333/GB-s = USD 6.08/mês
#   2 unidades                                       = USD 12.16/mês
#
# PRÉ-REQUISITOS:
#   - AWS CLI + profile "renthus"
#   - Lambda `renthus-inbound-worker` publicada
#
# USO:
#   .\scripts\setup-provisioned-concurrency.ps1                    # aplica 1 unidade
#   .\scripts\setup-provisioned-concurrency.ps1 -Count 2            # escala para 2
#   .\scripts\setup-provisioned-concurrency.ps1 -Count 0            # desativa
#   .\scripts\setup-provisioned-concurrency.ps1 -DryRun             # só mostra o que faria

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1",
    [int]$Count = 1,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$InboundFn = "renthus-inbound-worker"

Write-Host "=== Provisioned Concurrency Setup ===" -ForegroundColor Cyan
Write-Host "Function: $InboundFn"
Write-Host "Region:   $Region"
Write-Host "Count:    $Count"
Write-Host "DryRun:   $DryRun"
Write-Host ""

# 1. Listar versões publicadas da função
Write-Host "--- Versões publicadas ---" -ForegroundColor Yellow
$versions = aws --profile $Profile --region $Region lambda list-versions-by-function `
    --function-name $InboundFn --query 'Versions[?Version != `$LATEST].{Version:Version,LastModified:LastModified}' `
    --output json 2>$null | ConvertFrom-Json

if (-not $versions -or $versions.Count -eq 0) {
    Write-Host "  (sem versões publicadas — usará '$LATEST')" -ForegroundColor Yellow
} else {
    Write-Host "  Versões publicadas: $($versions.Count)" -ForegroundColor Gray
}

$latestVersion = if ($versions -and $versions.Count -gt 0) { $versions[-1].Version } else { '$LATEST' }
Write-Host "  Última versão: $latestVersion" -ForegroundColor Gray
Write-Host ""

# 2. Verificar/criar alias
$aliasName = "live"
$aliasExists = aws --profile $Profile --region $Region lambda get-alias `
    --function-name $InboundFn --name $aliasName --query 'Name' --output text 2>$null

if (-not $aliasExists -or $aliasExists -ne $aliasName) {
    Write-Host "Criando alias '$aliasName' → versão $latestVersion" -ForegroundColor Yellow
    if (-not $DryRun) {
        aws --profile $Profile --region $Region lambda create-alias `
            --function-name $InboundFn `
            --name $aliasName `
            --function-version $latestVersion | Out-Null
    }
} else {
    Write-Host "Alias '$aliasName' já existe" -ForegroundColor Green
    if (-not $DryRun) {
        aws --profile $Profile --region $Region lambda update-alias `
            --function-name $InboundFn `
            --name $aliasName `
            --function-version $latestVersion | Out-Null
    }
}
Write-Host ""

# 3. Verificar config atual de provisioned concurrency
Write-Host "--- Config atual ---" -ForegroundColor Yellow
$current = aws --profile $Profile --region $Region lambda get-provisioned-concurrency-config `
    --function-name $InboundFn --qualifier $aliasName --output json 2>$null | ConvertFrom-Json

if ($current) {
    Write-Host "  Allocated: $($current.AllocatedProvisionedConcurrentExecutions)"
    Write-Host "  Available: $($current.AvailableProvisionedConcurrentExecutions)"
    Write-Host "  Status:    $($current.Status)"
} else {
    Write-Host "  (nenhum provisioned concurrency configurado)" -ForegroundColor Yellow
}
Write-Host ""

# 4. Aplicar mudança
if ($Count -eq 0) {
    if ($current -and -not $DryRun) {
        Write-Host "Removendo provisioned concurrency..." -ForegroundColor Yellow
        aws --profile $Profile --region $Region lambda delete-provisioned-concurrency-config `
            --function-name $InboundFn --qualifier $aliasName | Out-Null
        Write-Host "  OK — custo zerado" -ForegroundColor Green
    } else {
        Write-Host "[DRY RUN] Removeria provisioned concurrency config" -ForegroundColor Yellow
    }
} else {
    if ($current -and $current.AllocatedProvisionedConcurrentExecutions -eq $Count -and -not $DryRun) {
        Write-Host "Já está configurado com $Count unidades — nada a fazer" -ForegroundColor Green
    } else {
        if ($DryRun) {
            Write-Host "[DRY RUN] Aplicaria: Provisioned=$Count no alias '$aliasName'" -ForegroundColor Yellow
            Write-Host "  Custo estimado: USD $([math]::Round($Count * 730 * 1 * 0.0000083333, 2))/mês" -ForegroundColor Yellow
        } else {
            Write-Host "Aplicando Provisioned=$Count..." -ForegroundColor Green
            aws --profile $Profile --region $Region lambda put-provisioned-concurrency-config `
                --function-name $InboundFn `
                --qualifier $aliasName `
                --provisioned-concurrent-executions $Count | Out-Null
            Write-Host "  OK" -ForegroundColor Green
        }
    }
}
Write-Host ""

# 5. Resumo
Write-Host "=== Resumo ===" -ForegroundColor Cyan
Write-Host "Função:                $InboundFn"
Write-Host "Alias:                 $aliasName"
Write-Host "Provisioned Concurrency: $Count unidades"
Write-Host "Custo estimado/mês:    USD $([math]::Round($Count * 730 * 1 * 0.0000083333, 2))"
Write-Host ""
Write-Host "Próximos passos:"
Write-Host "  1. Monitorar cold-start ratio via ProvisionedConcurrencyUtilization metric"
Write-Host "  2. Se p95 concurrency > 0.7 sustained por 24h: re-executar com -Count 2"
Write-Host "  3. Se tráfego cair consistentemente < 0.1: re-executar com -Count 0"