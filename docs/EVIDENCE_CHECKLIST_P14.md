# Evidências — critérios de aceite (P1.4)

Objetivo: fechar os checkboxes em [`CHATBOT_PROD.md`](./CHATBOT_PROD.md) (*Critérios de aceite (release)*) com método repetível.

| Critério `CHATBOT_PROD.md` | Estado | Evidência (link / anexo / data) |
|----------------------------|--------|----------------------------------|
| Webhook p95 &lt; 2 s sem Haiku | [ ] | Secção *Como obter evidências* §1 em `CHATBOT_PROD.md` |
| Zero duplicata replay `message_id` | [ ] | §2 + verificação Supabase; ver também [`SMOKE_RUNBOOK_PRO_PIPELINE_V2.md`](./SMOKE_RUNBOOK_PRO_PIPELINE_V2.md) |
| Fila acumulada: latência, não 500 em cascata no webhook | [ ] | Logs webhook + profundidade fila em stress controlado |
| Runbook 1 página (fila, secrets, Anthropic, Meta) | [ ] | Pode condensar `SMOKE_RUNBOOK` + secrets em 1 página interna |
| Vários consumers: limites (pool, Anthropic, Meta) | [ ] | ADR curto ou parágrafo em `CHATBOT_PROD.md` *Arquitetura por horizonte* |

**Nota:** só marcar `[x]` na tabela acima **e** nos checkboxes do `CHATBOT_PROD.md` quando existir amostra ou prova (datas, export de logs, query SQL).
