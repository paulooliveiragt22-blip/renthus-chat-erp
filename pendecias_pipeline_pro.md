# Pendecias Pipeline PRO

## Status atual
- Pipeline PRO V2 + fila assíncrona prontos para pico Hobby (wake, reclaim, claim justo, resiliência Anthropic/Meta, backlog UX, cache busca).
- **Aberto operacional:** evidências P1.4 e checklist de homologação abaixo (não é gap de código).

## Resolvidas (histórico)

| # | Tema | Status |
|---|------|--------|
| 1 | Timeout real de IA (`AbortController`) | resolvido |
| 2 | Finalização V2 (`order.service.v2`) | resolvido |
| 3 | Métricas (`METRICS_INGEST_URL` + store Supabase) | resolvido |
| 4 | Dedup outbound gateway | resolvido |
| 5 | Testes regressão + E2E fila | resolvido |
| 6 | Wake imediato pós-enqueue | resolvido |
| 7 | Self-wake + reclaim stuck | resolvido (2026-08) |
| 8 | Claim justo SQL + skip busy thread | resolvido (2026-08) |
| 9 | Backlog notice + catalog cache TTL | resolvido (2026-08) |
| 10 | Anthropic resilience + Meta Graph throttle | resolvido (2026-08) |

## Ainda aberto (produto / ops)

| Tema | Onde | Nota |
|------|------|------|
| Evidências release (p95, replay, stress) | [`docs/EVIDENCE_CHECKLIST_P14.md`](./docs/EVIDENCE_CHECKLIST_P14.md) | Método em `CHATBOT_PROD.md` |
| Sync legado ↔ V2 (híbrido) | CHECKLIST P0.4b | Só se bug/métrica |
| Unificar state machines | `PRO_ORDER_SLOT_MACHINE.md` §6 | `applyAiStateTransition` ↔ `resolveProStepFromDraft` |
| Redis concurrency Anthropic | CHECKLIST P2p.4 | Só se 429 multi-réplica |

## Checklist minimo de homologacao/producao (operacional)
- [ ] `CHATBOT_QUEUE_ENABLED=1` no ambiente.
- [ ] `CRON_SECRET` definido e **cron-job.org** (≈1 min) chamando `GET /api/chatbot/process-queue` com `Authorization: Bearer`.
- [ ] Wake: `CHATBOT_QUEUE_WAKE_URL` ou `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` + secret.
- [ ] Logs sem `queue insert error` e sem `job falhou` acima de 1% em janela de 15 min.
- [ ] `processed` do worker > 0 para mensagens de teste; JSON pode incluir `reclaimed` / `continued`.
- [ ] Sem duplicidade de outbound para mesma thread/body em janela curta.
- [ ] (Opcional pico) Confirmar defaults ou overrides: `CHATBOT_QUEUE_MAX_PER_COMPANY`, `CHATBOT_BACKLOG_*`, `ANTHROPIC_*`, `WHATSAPP_MIN_GAP_MS`.

## Docs canónicos
- Decisões: [`docs/CHATBOT_PROD.md`](./docs/CHATBOT_PROD.md)
- Checklist: [`docs/CHECKLIST_ARCH_PRO_SCALE.md`](./docs/CHECKLIST_ARCH_PRO_SCALE.md)
- Smoke: [`docs/SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`](./docs/SMOKE_RUNBOOK_PRO_PIPELINE_V2.md)
