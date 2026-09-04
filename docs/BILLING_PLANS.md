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
- 1 usuário incluso; seat adicional **R$ 99**  
  - Mid-cycle: **cobra na hora (proration) → só então libera** o user  
  - Depois da adesão: valor extra entra na **mensalidade recorrente** junto com o plano (N × 99)
- Sem marketplace / IG-Messenger

### Market (R$ 449)
- Tudo do Pro + iFood/Aiqfome + IG/Messenger + mesa
- **10 usuários** inclusos; a partir do 11º = R$ 99

## Setup e trial
- **Setup fee = R$ 0** (BN-05)
- **Trial self-serve = 0** (pay-to-start, BN-07); cortesia platform = 30d (BN-08)

## Crédito IA
- Incluso = **sempre 10% do preço de lista mensal** do plano (R3-6): 27,90 / 34,90 / 44,90  
- **Independe** de promo, valor pago ou ciclo anual  
- Packs / margem 2× no token: adiado BN-15

## Gates de plano (UI + API)
- `estoque_full` · `financeiro_full` · `printing_auto` → Pro/Market
- `whatsapp_templates_broadcast` → Pro/Market
- `marketplace_*` / `omnichannel_ig_messenger` / `table_service` → Market
- `staff_users` → Pro/Market (limites de seat: R3-3/R3-4)

## Fora / adiado (código ainda não)
- Promo editável superadmin (R2-1 / R3-1; anual sem promo R3-2)
- Cobrança seat mid-cycle + renew com seats (R3-3)
- Downgrade com seleção de users (R3-4)
- Packs IA (BN-15) · Fiscal/TEF/2FA (BN-16)

## Legado
`normalizePlanKey`: `bot`/`starter` → `essencial`, `complete` → `pro`.
APIs públicas: só `essencial` | `pro` | `market`.
