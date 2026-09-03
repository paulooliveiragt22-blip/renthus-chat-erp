# Baselines de replay

## Extração (`extraction-baseline.v1.json`)

Casos offline para `summarizeExtractionDivergence` / `npm run replay -- --extract-diff`.
Extração de pedido é **somente LLM** (sem parsers regex de itens/pagamento/troca).

## Cassetes CI (`cassettes.v1.json`) — C4.2

≥3 turns sintéticos (`respond_to_customer`) reproduzidos em `tests/pro/c4CassetteReplay.test.ts`
via `createReplayModel` (nível C da pirâmide ADR-0005). Sem PII, sem Supabase.

## Threads reais (staging)

1. Worker Lambda: `PRO_PIPELINE_TURN_TRACE=1` no `.env.local` + `deploy-workers.ps1` (chave listada).
2. Pedido curto no WA; validar linhas:
   `select count(*) from pipeline_turn_traces where created_at > now() - interval '1 hour';`
3. `npm run replay -- <companyId> <threadId>` → dump; `--run` compara outbound vs traces.

Não commitar PII (telefone/nome). Anonimizar `body` se necessário.
