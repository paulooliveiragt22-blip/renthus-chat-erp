# Planos e Cobrança — Renthus Chat + ERP

**Atualizado:** 2026-09-04 — BN-04 (279 / 349 / 449). Decisões: `docs/DECISOES_NEGOCIO_BILLING_PENDENTES.md`.

## Identidade do cliente pagante
Cliente pagante = `company` (tenant).

## Planos

| Key | Nome | Mensal | Anual (default −20%) | Users inclusos | Seat extra |
|-----|------|--------|----------------------|----------------|------------|
| `essencial` | Essencial | **R$ 279** | R$ 2.678,40 | 1 (cap) | — |
| `pro` | Pro | **R$ 349** | R$ 3.350,40 | 1 | R$ 99/mês |
| `market` | Market | **R$ 449** | R$ 4.310,40 | 10 | R$ 99/mês |

Catálogo código: `lib/billing/planCatalog.ts`. DB: `plans.price_cents` / `price_year_cents` / `included_seats` / `seat_extra_cents`.

### Essencial (R$ 279)
- WhatsApp (Meta) + Flow + cardápio web (free)
- Credenciais WABA self-serve em **Configurações → Canais**
- IA com **crédito incluso = 10% do mensal** (R$ 27,90) + packs R$10/20/50
- PDV básico · **1 usuário** (sem seat adicional) · sem marketplace / impressão auto

### Pro (R$ 349)
- ERP completo + impressão + templates/campanhas WA
- 1 usuário incluso; seat adicional **R$ 99** (cobrança mid-cycle: pendente R3-3)
- Sem marketplace / IG-Messenger

### Market (R$ 449)
- Tudo do Pro + iFood/Aiqfome + IG/Messenger + mesa
- **10 usuários** inclusos; a partir do 11º = R$ 99

## Setup e trial
- **Setup fee = R$ 0** (BN-05)
- **Trial self-serve = 0** (pay-to-start, BN-07); cortesia platform = 30d (BN-08)

## Crédito IA
- Incluso = 10% do **mensal de lista** (BN-06)
- Crédito no plano **anual**: pendente R3-6
- Packs / margem 2×: adiado BN-15

## Gates de plano (UI + API)
- `estoque_full` · `financeiro_full` · `printing_auto` → Pro/Market
- `whatsapp_templates_broadcast` → Pro/Market
- `marketplace_*` / `omnichannel_ig_messenger` / `table_service` → Market
- `staff_users` → Pro/Market (limites de seat: produto R3)

## Fora / adiado
- Promo editável superadmin (modelo R2-A; renovação/anual = R3-1/R3-2)
- Packs IA (BN-15) · Fiscal/TEF/2FA (BN-16)

## Legado
`normalizePlanKey`: `bot`/`starter` → `essencial`, `complete` → `pro`.
APIs públicas: só `essencial` | `pro` | `market`.
