# check-secret-match.ps1
# Verifica se o token configurado na Connection AWS bate com o token da Vercel.

$env:PROFILE = if ($env:PROFILE) { $env:PROFILE } else { "renthus" }
$env:REGION = if ($env:REGION) { $env:REGION } else { "sa-east-1" }

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 1. Verificando token configurado na Connection AWS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# NAO mostra o token real (seguranca), mas mostra primeiros 8 chars + length
$connJson = aws --profile $env:PROFILE --region $env:REGION events describe-connection --name renthus-cron-connection --output json
Write-Host "Connection (metadata):" -ForegroundColor Yellow
if ($connJson) {
    $connObj = $connJson | ConvertFrom-Json
    $connObj.PSObject.Properties | ForEach-Object {
        if ($_.Name -match "Secret|Key|Auth") {
            $len = if ($_.Value) { $_.Value.ToString().Length } else { 0 }
            Write-Host "  $($_.Name): <hidden (len=$len)>" -ForegroundColor Gray
        } else {
            Write-Host "  $($_.Name): $($_.Value)" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "  ERRO: nao foi possivel ler a Connection" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 2. Verificando token local (`$env:CRON_SECRET)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if ([string]::IsNullOrWhiteSpace($env:CRON_SECRET)) {
    Write-Host "ATENCAO: `$env:CRON_SECRET esta vazio neste terminal!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Para definir:" -ForegroundColor Yellow
    Write-Host "  `$env:CRON_SECRET = 'seu-token-real'" -ForegroundColor White
    Write-Host ""
} else {
    $token = $env:CRON_SECRET
    Write-Host "Token local: length=$($token.Length)" -ForegroundColor Green
    $previewLen = [Math]::Min(8, $token.Length)
    Write-Host "Token local: primeiros 8 chars = '$($token.Substring(0, $previewLen))...'" -ForegroundColor Green
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 3. Testando chamada direta com o token local" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if (-not [string]::IsNullOrWhiteSpace($env:CRON_SECRET)) {
    $resp = curl.exe -s -w "`nHTTP_CODE: %{http_code}`n" -X GET "https://app.renthus.com.br/api/chatbot/reactivate" -H "Authorization: Bearer $env:CRON_SECRET"
    Write-Host "Resposta:" -ForegroundColor Yellow
    Write-Host $resp
} else {
    Write-Host "Defina `$env:CRON_SECRET primeiro e rode de novo." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 4. Verificando API Destinations" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$destJson = aws --profile $env:PROFILE --region $env:REGION events list-api-destinations --output json
if ($destJson) {
    $allDest = $destJson | ConvertFrom-Json
    $renthusDest = $allDest.ApiDestinations | Where-Object { $_.Name -like "renthus-dest-*" }
    Write-Host "API Destinations criadas:" -ForegroundColor Yellow
    $renthusDest | ForEach-Object {
        Write-Host ("  - " + $_.Name + " -> " + $_.InvocationEndpoint + " (" + $_.HttpMethod + ")") -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " 5. Verificando Rules (schedules)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$rulesJson = aws --profile $env:PROFILE --region $env:REGION events list-rules --output json
if ($rulesJson) {
    $allRules = $rulesJson | ConvertFrom-Json
    $renthusRules = $allRules.Rules | Where-Object { $_.Name -like "renthus-*" }
    Write-Host "Rules criadas:" -ForegroundColor Yellow
    $renthusRules | ForEach-Object {
        Write-Host ("  - " + $_.Name + " (" + $_.ScheduleExpression + ")" + " state=" + $_.State) -ForegroundColor Gray
    }
}