# Planos e Cobrança — Renthus Chat + ERP

## Identidade do cliente pagante
Cliente pagante = `company` (tenant). **MVP: 1 usuário** por company (login em vários dispositivos OK).

## Planos (opção A fechada)

| Key | Nome | Mensal | Posição |
|-----|------|--------|---------|
| `essencial` | Essencial | **R$ 197** | Entrada — canal próprio |
| `pro` | Pro | **R$ 279** | Âncora (mais popular) — ERP + IA |
| `market` | Market | **R$ 349** | Omni + marketplaces + mesa + app |

### Essencial (R$ 197)
- WhatsApp (Meta) + Flow + cardápio web (free)
- IA Haiku com **crédito incluso = 10% do plano** (R$ 19,70) + packs R$10/20/50
- Toggle desligar IA a qualquer momento
- Sem crédito IA → trava **só a IA** (cai no Flow); ERP/WhatsApp seguem
- PDV básico · **sem** iFood/Aiqfome · **sem** impressão automática

### Pro (R$ 279)
- Tudo do Essencial (crédito IA R$ 27,90)
- PDV + estoque + financeiro + impressão automática
- **Sem** marketplace (iFood/Aiqfome)

### Market (R$ 349)
- Tudo do Pro (crédito IA R$ 34,90)
- **Próxima versão:** iFood + Aiqfome · Instagram + Messenger · atendimento de mesa · app Flutter

## Crédito IA (Haiku 4.5)
- Preço API: **USD $1/M input** · **$5/M output** (cache hit $0,10/M)
- Conversão BRL: `AI_USD_BRL_RATE` (default 5,5)
- Tabelas: `company_ai_wallets`, `company_ai_ledger`
- Packs: 1000 / 2000 / 5000 centavos; auto-recharge opcional (cartão/PIX na sequência)

## Confirmação de valor alto
- Por loja em Configurações → Chatbot: toggle + valor em R$ (ou desligado)
- Keys em `chatbots.config`: `high_value_confirm_enabled`, `high_value_confirm_amount_brl`

## Gates de plano (UI + API)
- `estoque_full` · `financeiro_full` · `printing_auto` → Pro/Market (menu + APIs)
- `marketplace_*` → Market (GET/PATCH/sync)
- Essencial não contorna gate pela API

## Print Agent
- Pareamento: Impressoras → código → `POST /api/agent/activate`
- Release: [print-agent-v1.1.3](https://github.com/paulooliveiragt22-blip/renthus-chat-erp/releases/tag/print-agent-v1.1.3)
- Download: `…/releases/download/print-agent-v1.1.3/renthus-print-agent-1.1.3-win.zip` (override via `NEXT_PUBLIC_PRINT_AGENT_DOWNLOAD_URL`)
- Criptografia do código: `CREDENTIALS_ENCRYPTION_KEY` (32 bytes base64)

## PDV por plano
- Essencial (`pdv_basic`): venda à vista, caixa, cliente sem limite de crédito
- Pro/Market (`pdv`): + A Prazo / boleto / cheque / promissória + limite de crédito
- Impressão automática: só com `printing_auto` (Pro/Market)

## Add-ons / fora do escopo atual
- Fiscal NFC-e / TEF → próxima etapa
- A Prazo → só PDV
- 2FA → adiado (1 usuário)

## Legado (somente leitura interna)
`normalizePlanKey` ainda mapeia `bot`/`starter` → `essencial` e `complete` → `pro` para linhas/webhooks antigos.
APIs públicas (`signup`, `change-plan`) aceitam **somente** `essencial` | `pro` | `market`.
Catálogo canônico: `lib/billing/planCatalog.ts`.
A rota morta `/api/billing/upgrade` (mini_erp/full_erp) foi removida.
