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

```bash
npx playwright install chromium   # uma vez por máquina
npm run test:e2e:ui               # modo interativo
```

## O que cobre

| Smoke | O quê |
|-------|--------|
| M1+M2 | Config → Delivery (horário, descrição, entrega) |
| M3 | Config → Geral (equipe + perfis) |
| M5 | Pedidos → Em preparo |
| M4+M6 | Impressoras → Limpar fila / vias |
| M7 | Home/dashboard carrega |
| — | `/login` renderiza |

Não substitui o E2E de banco/RPC (`tests/mvp/`) nem o envio real Meta WhatsApp.
