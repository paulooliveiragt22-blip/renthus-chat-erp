# scripts/fase14-cleanup-fase13.ps1
#
# ADR-0003 Fase 14 — Limpa arquivos órfãos da Fase 13 (Lambda direto).
# Executar uma vez: apaga arquivos que não são mais usados; não afeta runtime.
#
# Idempotente: arquivos já deletados são ignorados.

$filesToDelete = @(
    "lib/chatbot/inbound/lambdaInvoker.ts",
    "lib/chatbot/inbound/lambdaInvoker.aws.ts",
    "lib/chatbot/inbound/lambdaInvoker.noop.ts",
    "lib/chatbot/queue/outboxDlqWatchdog.ts",
    "workers/inbound/threadLock.ts",
    "workers/inbound/threadLock.errors.ts",
    "supabase/migrations/20260901000001_thread_locks.sql"
)

foreach ($f in $filesToDelete) {
    if (Test-Path $f) {
        Remove-Item $f -Force
        Write-Host "DELETED: $f"
    } else {
        Write-Host "SKIP (not found): $f"
    }
}

# Tenta deletar diretório lib/chatbot/inbound/ se ficou vazio
if ((Test-Path "lib/chatbot/inbound") -and -not (Get-ChildItem "lib/chatbot/inbound" -Recurse -ErrorAction SilentlyContinue | Where-Object { -not $_.PSIsContainer } | Select-Object -First 1)) {
    Remove-Item "lib/chatbot/inbound" -Recurse -Force
    Write-Host "DELETED empty dir: lib/chatbot/inbound"
}

Write-Host ""
Write-Host "Done. Arquivos Fase 13 removidos. Runtime NÃO afetado (Lambda já deployada com handler SQS)."