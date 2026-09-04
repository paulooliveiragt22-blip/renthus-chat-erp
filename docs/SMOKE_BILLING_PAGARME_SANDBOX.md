# Smoke — Billing Pagar.me (sandbox)

Testes de compra com **cartão** e **PIX**.

## Caminho recomendado: deploy `main` (Vercel)

As variáveis `PAGARME_*` já estão na Vercel — **não precisa** replicar no `.env.local` para testar na UI.

| Item | Valor |
|------|--------|
| URL | https://renthus-chat-erp.vercel.app |
| Página | `/plano/pagar` |
| Webhook | `https://renthus-chat-erp.vercel.app/api/billing/webhook` |

**Conta de teste sugerida (never-paid / pending_payment):**  
empresa com status `pending_setup` / `pending_payment` / `overdue` **ou** `pending_invoice`.  
Conta **já `active`** (ex.: Zampell após smoke pago) **não serve** — `/plano/pagar` redireciona para `/ativar`.

```powershell
$env:E2E_SKIP_WEBSERVER="1"
$env:E2E_BASE_URL="https://renthus-chat-erp.vercel.app"
$env:E2E_EMAIL="paulooliveiragt22@gmail.com"
$env:E2E_PASSWORD="..."   # senha do owner — não versionar
# opcional: força workspace never-paid
# $env:E2E_COMPANY_ID="uuid-da-empresa-pending"
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
| `PAGARME_API_KEY` | `sk_test_…` / `sk_live_…` | **Vercel** (+ local smoke) |
| `NEXT_PUBLIC_PAGARME_PUBLIC_KEY` | `pk_test_…` | **Vercel** |
| `PAGARME_WEBHOOK_BASIC_USER` | user do hookset | **Vercel** + painel Pagar.me (Basic Auth) |
| `PAGARME_WEBHOOK_BASIC_PASSWORD` | senha do hookset | **Vercel** + painel Pagar.me |
| `PAGARME_WEBHOOK_SECRET` | (opcional/legado) | Vercel — HMAC só se `X-Hub-Signature` vier (não é o auth v5) |
| `ALLOW_INSECURE_PAGARME_WEBHOOK` | `1` só preview/local | Nunca em Production |

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

**Auth v5 (L1):** no painel do hookset, ative **Basic Auth** (user/senha). Espelhe em `PAGARME_WEBHOOK_BASIC_USER` / `PAGARME_WEBHOOK_BASIC_PASSWORD` na Vercel Production. Sem isso o handler responde **503**; credencial errada → **401**. Preview/local sem Basic: `ALLOW_INSECURE_PAGARME_WEBHOOK=1`. HMAC `PAGARME_WEBHOOK_SECRET` é legado (só se `X-Hub-Signature` vier).

**Fonte da verdade do pago:** `GET /orders/:id` antes de liberar — Basic Auth só autentica o POST.

**Prova rápida auth:**
```bash
# deve 401
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/billing/webhook" -d '{}'
# deve passar do gate auth (pode 400 JSON) com Basic correto
curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/billing/webhook" \
  -u "$PAGARME_WEBHOOK_BASIC_USER:$PAGARME_WEBHOOK_BASIC_PASSWORD" -d '{}'
```

**Health:** `GET /api/billing/webhook-health` com `Authorization: Bearer $CRON_SECRET` — Sentry se pending+order e zero eventos/24h.

**Replay (ops):** `POST /api/platform/billing/replay-fulfill` `{ "order_id": "or_..." }` (superadmin).

**Sync sob demanda:** `GET /api/billing/status` (paywall poll ~5s) e reentrada no checkout — se pending tem `pagarme_order_id` e o PSP está `paid`, roda o mesmo `FulfillPayment`. Campo `psp_sync` na resposta. Webhook continua canônico; sync evita tenant travado.

Se `pagarme_webhook_events` = 0 após pagamento sandbox: conferir URL/POST no painel Pagar.me, Basic Auth env↔painel, e logs Vercel (401 unauthorized / 503 auth_not_configured / 405 método). Não usar reconcile cego em massa (ADR-0004).

### H6.2 — Webhook idempotente (2× mesmo `order.paid`)

DoD P1: dois POSTs com o **mesmo** evento/`id` → 1 fulfill + 1 `duplicate`; sub permanece `active` única.

```powershell
$BASE = "https://renthus-chat-erp.vercel.app"
$USER = $env:PAGARME_WEBHOOK_BASIC_USER
$PASS = $env:PAGARME_WEBHOOK_BASIC_PASSWORD
$ORDER = "or_...."   # order já paid no PSP (ou pending que GET marca paid)

$body = @{
  id = "evt_h62_smoke_$(Get-Date -Format 'yyyyMMddHHmmss')"
  type = "order.paid"
  data = @{ id = $ORDER }
} | ConvertTo-Json -Depth 5

curl.exe -s -w "`nHTTP %{http_code}`n" -X POST "$BASE/api/billing/webhook" -u "${USER}:${PASS}" -H "Content-Type: application/json" -d $body
curl.exe -s -w "`nHTTP %{http_code}`n" -X POST "$BASE/api/billing/webhook" -u "${USER}:${PASS}" -H "Content-Type: application/json" -d $body
```

Esperado: ambas **200**; 1ª com fulfill/`already_done`; 2ª `{ ok: true, duplicate: true }`; 1 linha em `pagarme_webhook_events` para a key. Unit: `tests/billing/tryConsumePagarmeWebhookEvent.test.ts`.

### PIX sem copia-e-cola (`pix_emv_unavailable` / `pix_gateway_stub` / PSP sem ambiente)

Se a API devolver `qr_code` = `https://digital.mundipagg.com/pix/` (e a PNG só embutir essa URL), **não há EMV recuperável** — o domínio Mundipagg está morto (ENOTFOUND).

Causa típica: meio PIX no gateway legado Mundipagg em vez do gateway **Pagar.me / Stone** (docs: PIX só com gateway Pagar.me).

No gateway **PSP**, charge pode falhar com `action_forbidden | Sem ambiente configurado para este tipo de transação` (sandbox sem PIX) — `qr_code` null. Diagnóstico: `node scripts/diag-pix-qr-code.mjs`.

No [painel Pagar.me](https://id.pagar.me/) → Configurações → Meios de pagamento: ative **PIX** no gateway correto **e** ambiente sandbox. Enquanto isso use **cartão**. **H6.3** do checklist P1 está **adiado**.

EMV saudável começa com `000201…` e contém `br.gov.bcb.pix` (ver [docs PIX](https://docs.pagar.me/reference/pix-2)).

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

- [x] `sk_test_` / `pk_test_` configurados (Vercel Production)
- [x] Domínio cadastrado no Pagar.me
- [x] Webhook apontando para deploy + Basic Auth (L1)
- [x] `npm run test:billing-sandbox` verde (cartão + PIX API; EMV UI pode falhar se PSP sem ambiente)
- [x] E2E cartão em `/plano/pagar` → `active` + `last_paid_at` (H6.4)
- [>] E2E PIX UI — **adiado** (H6.3; ambiente PIX PSP)
- [x] Suíte billing unit verde (H6.1)
- [x] H6.2 — 2× webhook mesmo `order.paid` (2026-09-04: `or_1XKEmwwulNFYeP2N` → ok + duplicate)

---

## Referências no repo

- Checkout: `app/api/billing/create-invoice-checkout/route.ts`
- Webhook: `app/api/billing/webhook/route.ts`
- Replay ops: `app/api/platform/billing/replay-fulfill/route.ts`
- UI: `components/billing/PlanBillingPanel.tsx`
- Cliente HTTP: `lib/billing/pagarme.ts`
- Token browser: `lib/pagarme/cardTokenBrowser.ts`
- Hardening: `docs/CHECKLIST_BILLING_HARDENING_P1.md` · `docs/ADR/0006-billing-hardening-idempotency-security.md`
- Orquestração P0: `docs/CHECKLIST_BILLING_ORCHESTRATION_P0.md` · `docs/ADR/0004-billing-route-handlers-only.md`
