# Playwright — smokes MVP

Automatiza o browser para validar telas do checklist (M1–M7).

## Pré-requisitos

1. App rodando (`npm run dev` ou URL de preview).
2. Conta owner/admin da empresa.

```bash
# Windows PowerShell
$env:E2E_BASE_URL="http://127.0.0.1:3000"
$env:E2E_EMAIL="seu@email.com"
$env:E2E_PASSWORD="sua-senha"
npm run test:e2e
```

Sem `E2E_EMAIL`/`E2E_PASSWORD`, os testes autenticados são **skipped**; só a tela de login roda.
Se nada estiver na porta 3000, o Playwright sobe `npm run dev` sozinho (`E2E_SKIP_WEBSERVER=1` desliga).

O login E2E **não usa o formulário** (React controlado fica flaky no headless): autentica na API Supabase,
grava cookies via `/api/auth/sync-session` e seleciona a empresa. Precisa do `.env.local` com
`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` (o mesmo do `npm run dev`).

Use a **mesma origem** do browser manual (`localhost` vs `127.0.0.1`):
`$env:E2E_BASE_URL="http://localhost:3000"` se for assim que você entra no Chrome.

```bash
npx playwright install chromium   # uma vez por máquina
npm run test:e2e:ui               # modo interativo
```

## O que cobre

| Script | O quê |
|--------|--------|
| `npm run test:e2e` | Todos os specs Playwright |
| `npm run test:e2e:screens` | **Todas as telas** — smoke por rota (público + admin + billing) |
| `npm run test:e2e:billing` | Checkout sandbox cartão/PIX |
| `npm run test:e2e:billing:journey` | Signup → pagar → contrato `/plano` |
| `npm run test:e2e:plano` | Gestão de plano (assinante pago) |

### Smokes MVP (`e2e/mvp.smokes.spec.ts`)

| Smoke | O quê |
|-------|--------|
| M1+M2 | Config → Delivery (horário, descrição, entrega) |
| M3 | Config → Geral (equipe + perfis) |
| M5 | Pedidos → Em preparo |
| M4+M6 | Impressoras → Limpar fila / vias |
| M7 | Home/dashboard carrega |
| — | `/login` renderiza |
| B1+B2 | `/plano/pagar` — cartão + PIX sandbox (deploy Vercel) |

Ver `e2e/billing.sandbox.spec.ts` e `docs/SMOKE_BILLING_PAGARME_SANDBOX.md`.

Não substitui o E2E de banco/RPC (`tests/mvp/`) nem o envio real Meta WhatsApp.
