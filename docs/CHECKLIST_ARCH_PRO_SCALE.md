# Checklist — arquitectura PRO / fila / escala

Estratégia alinhada à análise de arquitectura (fronteira V2 vs legado, custo, regressão).  
Atualizar este ficheiro ao concluir cada item (`[ ]` → `[x]` + data).

## P0 — Fronteira de estado e segurança

| # | Item | Estado | Notas |
|---|------|--------|--------|
| P0.1 | Documentar / cumprir: webhook sem motor com `CHATBOT_QUEUE_ENABLED=1` (`structure_chatbot_prod` §1.2) | [x] | Ver `docs/structure_chatbot_prod.md` |
| P0.2 | **Claim não-atómico desligado em produção** — nunca `runFallbackProcessing` com `NODE_ENV=production` | [x] | `process-queue/route.ts`: `ALLOW_CLAIM_FALLBACK = NODE_ENV !== "production"` (não há env `CHATBOT_QUEUE_ALLOW_CLAIM_FALLBACK`) |
| P0.3 | **Worker:** em produção, falhar job se não existir canal Meta activo para `company_id` (sem token global como substituto) | [x] | `processJob` em `process-queue/route.ts` |
| P0.4a | `active` + exceção do V2: **bloquear** legado de pedido; `botReply` com texto fixo PT-BR | [x] | `lib/chatbot/processMessage.ts` |
| P0.4b | Sync legado ↔ V2 | [x] | N/A — motor PRO legado removido; estado só `__pro_v2_state` |

## P1 — Operação e carga

| # | Item | Estado | Notas |
|---|------|--------|--------|
| P1.1 | PRO = sempre `runProPipeline` (flags shadow/`CHATBOT_PRO_PIPELINE_V2*` removidas) | [x] | `lib/chatbot/processMessage.ts` |
| P1.2 | Limite **in-flight** + resiliência 429 Anthropic (por instância) | [x] | `anthropicInFlightGate.ts` + `anthropicResilience.ts`; hot paths: PRO V2, intent, FAQ. Env: `ANTHROPIC_CHATBOT_MAX_IN_FLIGHT`, `ANTHROPIC_CIRCUIT_OPEN_MS` |
| P1.3 | Fairness por `company_id` no claim / pré-IA | [x] | Interleave no batch + **claim SQL** `max_per_company` + skip thread `processing` (`20260805100000_claim_chatbot_queue_jobs_fair_company.sql`) |
| P1.4 | Evidências `CHATBOT_PROD.md` (p95 webhook, replay `message_id`, runbook) | [ ] | Método + tabela: [`EVIDENCE_CHECKLIST_P14.md`](./EVIDENCE_CHECKLIST_P14.md) — marcar `[x]` aqui e nos checkboxes do `CHATBOT_PROD.md` **só** após colher dados reais |

## P2 — Documentação cruzada

| # | Item | Estado | Notas |
|---|------|--------|--------|
| P2.1 | `CHATBOT_PROD.md` — variáveis novas / reforços (claim, canal, in-flight) | [x] | Secção flags / worker |
| P2.2 | `pipeline_chatbot_prod.md` — Bloco 0.B canal em prod | [x] | Nota em worker |

## P2-peak — Fila / UX / cache (sem Redis)

| # | Item | Estado | Notas |
|---|------|--------|--------|
| P2p.1 | Claim justo SQL + skip thread busy | [x] | `claim_chatbot_queue_jobs(..., max_per_company)` |
| P2p.2 | Aviso WhatsApp de backlog | [x] | `lib/chatbot/backlogNotice.ts` + `incoming` |
| P2p.3 | Cache TTL busca catálogo | [x] | `catalogSearchCache.ts` |
| P2p.4 | Redis concurrency global Anthropic | [ ] | Só se 429 multi-réplica persistir |
| P2p.5 | Sync docs structure/pipeline/REFACTOR/smoke com P0–P2peak | [x] | 2026-08-05 |

## P3 — Infra Supabase / paralelismo para picos

| # | Item | Estado | Notas |
|---|------|--------|--------|
| P3.1 | Compute add-on + Pool Size Supavisor revisados para o volume esperado | [ ] | Plano detalhado: [`PLANO_ESCALA_PICOS_PEDIDOS.md`](./PLANO_ESCALA_PICOS_PEDIDOS.md) Fase 0 — `max_connections` hoje = 60 |
| P3.2 | Paralelismo por thread no worker (`CHATBOT_QUEUE_CONCURRENCY`) | [ ] | Fase 3 — seguro por design (claim SQL já isola thread `processing`, ver `20260805100000_claim_chatbot_queue_jobs_fair_company.sql`) |
| P3.3 | `pg_cron` + `pg_net` drenando a fila em batimento fixo (reduz tempestade de self-wake) | [ ] | Fase 4 |

---

## Registo de execução

| Data | Itens |
|------|--------|
| 2026-04-16 | P0.1–P0.3, P1.1–P1.2, P2.1–P2.2 aplicados no repo; P0.4b e P1.4 pendentes |
| 2026-04-16 | P0.4a: falha V2 em `active` → mensagem fixa, sem `inboundPipeline` / pedido legado |
| 2026-04-16 | P1.3 v1: intercalação de jobs por `company_id` no batch; P1.4: `EVIDENCE_CHECKLIST_P14.md` |
| 2026-08-05 | P1.3 SQL + P2-peak: claim fair, backlog UX, catalog cache; P1 resiliência Anthropic/Meta |
| 2026-08-05 | P2p.5: sync documental structure / pipeline / REFACTOR / smoke / CHECKLIST |
