# discover-target-arn.ps1
# Descobre o formato EXATO de Target.Arn aceito pelo EventBridge Scheduler,
# gerando o JSON skeleton via AWS CLI (sem fazer chamadas AWS).

$out = aws scheduler create-schedule --generate-cli-skeleton input --output json 2>&1
Write-Host "============================================================"
Write-Host " JSON SKELETON OFICIAL - aws scheduler create-schedule"
Write-Host "============================================================"
Write-Host $out
Write-Host ""
Write-Host "============================================================"
Write-Host " AGORA: schema do objeto Target"
Write-Host "============================================================"
$out2 = aws scheduler create-schedule --generate-cli-skeleton input 2>&1 | Out-String
Write-Host $out2
Write-Host ""
Write-Host "============================================================"
Write-Host " ARN PATTERNS oficiais via get-discoverable-configs"
Write-Host "============================================================"
# Tentar listar templates via undocumented helper
$out3 = aws scheduler get-arn-prefixes 2>&1 | Out-String
Write-Host $out3