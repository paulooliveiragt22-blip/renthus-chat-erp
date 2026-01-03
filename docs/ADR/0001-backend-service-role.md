# ADR-0001 — Backend via app/api + Supabase Service Role

## Status
Aceito

## Contexto
O sistema é multi-tenant (`companies`) com ERP + WhatsApp + billing.
A UI precisa listar e operar dados sensíveis (mensagens, pedidos, integrações).
RLS em front aumenta complexidade e risco de configuração.

## Decisão
A UI chamará endpoints do Next em `app/api/...`.
O backend usará Supabase com **Service Role** para:
- ler/gravar mensagens WhatsApp
- executar lógica de billing/limits
- acionar impressão automática
- consolidar métricas de uso

## Consequências
- Regras de acesso e negócio ficam centralizadas no backend
- Reduz dependência de policies RLS no cliente
- Precisamos implementar:
  - validação de sessão/usuário do tenant em `app/api/...`
  - rate limit e auditoria (logging)
