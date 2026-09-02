# Smoke — Billing Pagar.me (sandbox)

Testes de compra com **cartão** e **PIX**.

## Caminho recomendado: deploy `main` (Vercel)

As variáveis `PAGARME_*` já estão na Vercel — **não precisa** replicar no `.env.local` para testar na UI.

| Item | Valor |
|------|--------|
| URL | https://renthus-chat-erp.vercel.app |
| Página | `/plano/pagar` |
| Webhook | `https://renthus-chat-erp.vercel.app/api/billing/webhook` |

**Conta de teste sugerida (never-paid / pending_setup):**  
`paulooliveiragt22@gmail.com` — empresas `pending_setup` com `setup_payments` pending no banco.

```powershell
$env:E2E_SKIP_WEBSERVER="1"
$env:E2E_BASE_URL="https://renthus-chat-erp.vercel.app"
$env:E2E_EMAIL="paulooliveiragt22@gmail.com"
$env:E2E_PASSWORD="..."   # senha do owner — não versionar
npm run test:e2e:billing
```

> Sem `E2E_PASSWORD` o Playwright faz skip. Defina no shell (não commit no `.env.local` se o repo for compartilhado).

---

## E2E automatizado (Playwright no deploy)

`.env.local` só precisa de Supabase + credenciais E2E (mesmo padrão dos outros smokes):

```powershell
$env:E2E_SKIP_WEBSERVER="1"
$env:E2E_BASE_URL="https://renthus-chat-erp.vercel.app"
$env:E2E_EMAIL="paulooliveiragt22@gmail.com"   # ou outra conta pending_setup
$env:E2E_PASSWORD="..."
npm run test:e2e:billing
```

Cartão sandbox: `4000000000000010` · `12/30` · CVV `123`.

---

## Smoke API local (opcional)

Só se quiser validar chaves fora do deploy (`vercel env pull` ou colar `sk_test_` no `.env.local`):

```bash
npm run test:billing-sandbox
```

---

## 1. Pré-requisitos (painel Pagar.me)

### Chaves (dashboard [Pagar.me](https://id.pagar.me/) → Desenvolvedores → Chaves)

| Variável | Exemplo | Onde |
|----------|---------|------|
| `PAGARME_API_KEY` | `sk_test_...` | **Vercel** (já configurado na main) |
| `NEXT_PUBLIC_PAGARME_PUBLIC_KEY` | `pk_test_...` | **Vercel** |
| `PAGARME_WEBHOOK_SECRET` | (HMAC do painel) | Vercel |

Local `.env.local` **opcional** — só para `npm run test:billing-sandbox` ou Playwright com `E2E_BASE_URL` local.

### Simulador

Em **Configurações → Meios de pagamento**, use o simulador adequado à conta (PSP ou Gateway + **Simulador PIX**).

Regras oficiais ([docs](https://docs.pagar.me/docs/simulador-psp)):

| Meio | Regra sandbox |
|------|----------------|
| Cartão aprovado | `4000000000000010`, CVV `123`, validade futura |
| Cartão recusado | CVV começando com `6` (ex.: `612`) |
| PIX sucesso | valor **≤ R$ 500,00** — simulador paga sozinho em segundos |
| PIX falha | valor **> R$ 500,00** |

Planos Renthus (Essencial R$ 197, Pro R$ 279, Market R$ 397) estão dentro do limite PIX.

### Domínio (tokenização no browser)

No painel Pagar.me, cadastre:

- `https://renthus-chat-erp.vercel.app`
- `http://localhost:3000` (dev local)

Sem isso, `/plano/pagar` falha ao tokenizar cartão (`NEXT_PUBLIC_PAGARME_PUBLIC_KEY`).

### Webhook (PIX e cartão em análise)

URL: `https://renthus-chat-erp.vercel.app/api/billing/webhook`

Eventos mínimos: `order.paid`, `charge.paid` (opcional `order.payment_failed`).

**Health:** `GET /api/billing/webhook-health` com `Authorization: Bearer $CRON_SECRET` — Sentry se pending+order e zero eventos/24h.

**Replay (ops):** `POST /api/platform/billing/replay-fulfill` `{ "order_id": "or_..." }` (superadmin).

Se `pagarme_webhook_events` = 0 após pagamento sandbox: conferir URL/POST no painel Pagar.me e logs Vercel (401 secret / 405 método). Não usar reconcile cego (ADR-0004).

Em **localhost**, use túnel apontando para `:3000/api/billing/webhook`. No deploy Vercel (**recomendado**), o webhook já está no ar.

---

## 2. Smoke automatizado (API Pagar.me)

Valida chaves e simuladores **sem** login no admin:

```bash
# Chaves Pagar.me estão em Production na Vercel — pull separado (não sobrescreva .env.local):
vercel env pull .env.pagarme.local --environment=production
npm run test:billing-sandbox
```

O script lê `.env.local` **e** `.env.pagarme.local` (só preenche vars ausentes).

Esperado: `PASS cartão` + `PASS PIX`.

### Matriz R6.4 (manual pós-deploy)

| Cenário | Como validar |
|---------|----------------|
| Renovação cartão OK | Tenant `active` + `default_card_id`; cron charge ou vencimento trial |
| Cartão fail → PIX EMV | CVV `612` ou simulador recusa; UI `/plano/pagar` mostra PIX copia-e-cola |
| Add card → retry | `/plano/pagar` cadastra cartão; `POST /api/billing/payment-methods` set_default |
| AI auto-recharge | Saldo IA baixo → job `ai_recharge_jobs`; step no cron charge |

---

## 3. Smoke E2E — cartão de crédito

**Tenant sugerido:** empresa com `pagarme_subscriptions.status` em `pending_setup`, `pending_payment` ou `overdue` (ex.: lojas de teste no banco).

1. Login como **owner/admin** da loja.
2. Abrir **`/plano/pagar`** (ou `/plano` se já ativo).
3. Aba **Cartão** — preencher:
   - Titular, número `4000000000000010`, validade `12/30`, CVV `123`
   - Endereço completo (CEP 8 dígitos)
   - CNPJ da empresa (se vazio, preencher em Configurações → Geral)
4. Clicar **Pagar**.

**Esperado (imediato):**

- UI: “Pagamento aprovado. Plano liberado.”
- `GET /api/billing/status` → `pagarme_subscription.status` = `active` ou `trial` (conforme setup)
- PDV/API deixam de retornar **402** `billing_inactive`
- Redirect/onboarding: **`/ativar`** se `onboarding_completed_at` null

**SQL de verificação:**

```sql
SELECT ps.status, ps.plan, ps.activated_at, ps.last_paid_at
FROM pagarme_subscriptions ps
WHERE ps.company_id = '<company_id>';
```

---

## 4. Smoke E2E — PIX

1. Mesmo tenant em **`/plano/pagar`**.
2. Aba **PIX** → **Gerar PIX**.
3. Copiar código EMV ou QR (não é necessário pagar no app bancário real no sandbox).
4. Aguardar **~5–30 s** — simulador Pagar.me confirma e dispara webhook.

**Esperado:**

- Webhook `order.paid` → idempotência em `pagarme_webhook_events`
- `setup_payments` ou `invoices` → `status = paid`
- `pagarme_subscriptions.status` atualizado
- UI atualiza após refresh ou `loadBilling()`

**Se PIX não liberar:**

- Confirmar webhook URL no painel Pagar.me
- Logs Vercel: `/api/billing/webhook`
- Tabela `pagarme_webhook_events` — evento duplicado retorna `{ duplicate: true }` (ok)

---

## 5. Matriz rápida

| Cenário | Onde | Pass? |
|---------|------|-------|
| API smoke cartão | `npm run test:billing-sandbox` | |
| API smoke PIX | idem | |
| E2E cartão → active | `/plano/pagar` | |
| E2E PIX → webhook → active | `/plano/pagar` + webhook | |
| Cartão recusado (CVV 612) | UI mostra erro, status unchanged | |
| Paywall 402 antes / 200 depois | `POST /api/admin/pdv/finalize` | |

---

## 6. Checklist DoD sandbox

- [ ] `sk_test_` / `pk_test_` configurados local + Vercel preview
- [ ] Domínio cadastrado no Pagar.me
- [ ] Webhook apontando para deploy
- [ ] `npm run test:billing-sandbox` verde
- [ ] E2E cartão em `/plano/pagar` verde
- [ ] E2E PIX em `/plano/pagar` verde
- [ ] `npm test` verde (regressão billing gate)

---

## Referências no repo

- Checkout: `app/api/billing/create-invoice-checkout/route.ts`
- Webhook: `app/api/billing/webhook/route.ts`
- UI: `components/billing/PlanBillingPanel.tsx`
- Cliente HTTP: `lib/billing/pagarme.ts`
- Token browser: `lib/pagarme/cardTokenBrowser.ts`
