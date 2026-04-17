# Checklist — arquitectura PRO / fila / escala

Estratégia alinhada à análise de arquitectura (fronteira V2 vs legado, custo, regressão).  
Atualizar este ficheiro ao concluir cada item (`[ ]` → `[x]` + data).

## P0 — Fronteira de estado e segurança

| # | Item | Estado | Notas |
|---|------|--------|--------|
| P0.1 | Documentar / cumprir: webhook sem motor com `CHATBOT_QUEUE_ENABLED=1` (`structure_chatbot_prod` §1.2) | [x] | Ver `docs/structure_chatbot_prod.md` |
| P0.2 | **Claim não-atómico desligado em produção** — nunca `runFallbackProcessing` com `NODE_ENV=production` | [x] | `app/api/chatbot/process-queue/route.ts`; env `CHATBOT_QUEUE_ALLOW_CLAIM_FALLBACK` ignorada em prod |
| P0.3 | **Worker:** em produção, falhar job se não existir canal Meta activo para `company_id` (sem token global como substituto) | [x] | `processJob` em `process-queue/route.ts` |
| P0.4a | `active` + exceção do V2: **bloquear** legado de pedido; `botReply` com texto fixo PT-BR | [x] | `lib/chatbot/processMessage.ts` |
| P0.4b | Sincronizar `ai_order_canonical` ↔ `__pro_v2_state` em cenários híbridos restantes (se existirem) | [ ] | Só se métrica/bug justificar |

## P1 — Operação e carga

| # | Item | Estado | Notas |
|---|------|--------|--------|
| P1.1 | PRO em produção: `CHATBOT_PRO_PIPELINE_V2=1` + `CHATBOT_PRO_PIPELINE_V2_MODE=active`; **shadow em prod** → log de erro explícito | [x] | `lib/chatbot/processMessage.ts` |
| P1.2 | Limite de **in-flight** por instância no caminho Anthropic pesado do PRO V2 (`FullAiServiceAdapter`) | [x] | `lib/chatbot/anthropicInFlightGate.ts` + env `ANTHROPIC_CHATBOT_MAX_IN_FLIGHT` (default 8) |
| P1.3 | Fairness por `company_id` no claim / pré-IA | [x] | Intercalação **dentro do batch** claimado: `lib/chatbot/interleaveQueueJobsByCompany.ts` + `process-queue/route.ts` (v1; fairness no SQL/claim fica para quando houver métrica) |
| P1.4 | Evidências `CHATBOT_PROD.md` (p95 webhook, replay `message_id`, runbook) | [ ] | Método + tabela: [`EVIDENCE_CHECKLIST_P14.md`](./EVIDENCE_CHECKLIST_P14.md) — marcar `[x]` aqui e nos checkboxes do `CHATBOT_PROD.md` **só** após colher dados reais |

## P2 — Documentação cruzada

| # | Item | Estado | Notas |
|---|------|--------|--------|
| P2.1 | `CHATBOT_PROD.md` — variáveis novas / reforços (claim, canal, in-flight) | [x] | Secção flags / worker |
| P2.2 | `pipeline_chatbot_prod.md` — Bloco 0.B canal em prod | [x] | Nota em worker |

---

## Registo de execução

| Data | Itens |
|------|--------|
| 2026-04-16 | P0.1–P0.3, P1.1–P1.2, P2.1–P2.2 aplicados no repo; P0.4, P1.3–P1.4 pendentes |
| 2026-04-16 | P0.4a: falha V2 em `active` → mensagem fixa, sem `inboundPipeline` / pedido legado |
| 2026-04-16 | P1.3: intercalação de jobs por `company_id` no batch do worker; P1.4: `EVIDENCE_CHECKLIST_P14.md` |
