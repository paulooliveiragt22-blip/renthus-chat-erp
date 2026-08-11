-- Idempotência no lançamento "a prazo" do finalize-order do financeiro (rota
-- não usa RPC — checagem fica no app, ver app/api/admin/financeiro/finalize-order/route.ts).
-- Checklist item 9, docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md.

alter table public.bills
    add column if not exists idempotency_key text;

create unique index if not exists bills_idempotency_key_unique
    on public.bills (company_id, idempotency_key)
    where idempotency_key is not null;
