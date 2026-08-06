# Baselines de replay

## Extração (`extraction-baseline.v1.json`)

Casos offline para `summarizeExtractionDivergence` / `npm run replay -- --extract-diff`.

Atualizar quando mudar o extrator ou o regex bootstrap: rode o diff e revise casos que divergirem de propósito.

## Threads reais

1. Com `PRO_PIPELINE_TURN_TRACE=1` em staging, faça um pedido curto.
2. `npm run replay -- <companyId> <threadId>` → salve o JSON em `threads/<slug>.dump.json`.
3. `npm run replay -- <companyId> <threadId> --run` → compare outbound vs traces (exit 2 se diff).

Não commitar PII (telefone/nome). Anonimizar `body` se necessário.
