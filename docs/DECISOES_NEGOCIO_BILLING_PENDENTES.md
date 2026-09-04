# Decisões de negócio — Billing

**Atualizado:** 2026-09-04 (rodada 2 — dono)  
**Gate:** `.cursor/rules/decisoes-negocio-antes-codigo.mdc`  
**Rodada 3 (só furos):** renovação com promo?; seats mid-cycle/downgrade com extras — § Rodada 3.  
**Não implementar** até comando “implementa” (+ fechar R3 se a feature tocada depender disso).

Estado: `[ ]` aberto · `[x] decidido` · `[~]` parcial · `[>]` adiado.

---

## Rodada 1 — Fechada (resumo)

| ID | Escolha |
|----|---------|
| BN-01 | **C** Essencial mínimo congelado; Pro/Market expandem depois |
| BN-02 | **A** DB `plan_features` canônico |
| BN-03 | Manter cotas no DB (editável depois, baixo custo) |
| BN-04 | Mensal **279 / 349 / 449**; anual −20% default; editável superadmin + promo |
| BN-05 | **A** Setup = 0 |
| BN-06 | **A** IA incluso 10% do mensal |
| BN-07 | **A** Trial self-serve 0 (pay-to-start) |
| BN-08–10 | **A** (courtesy 30d; abandoned atual; só RPC signup) |
| BN-11 | **C** Upgrade com proration |
| BN-12 | Downgrade **agendado** fim do ciclo; até lá pode voltar/subir/cancelar agendamento |
| BN-13 | D0 collect · D1/D3 retry+notify · D5 = D1/D3 · **D7 block** |
| BN-14 | Reativa ciclo cheio; `next_billing_at` = data do pagamento |
| BN-15 | `[>]` Packs depois; margem 2× no token do pack |
| BN-16 | **A** Fiscal/TEF/2FA fora |
| BN-17 | Seats: Essencial 1 · Pro +R$99 · Market 10 — detalhe R2 |

---

## Rodada 2 — Fechada

### R2-A / R1 — Promo editável (duração + meses + R$ ou %)

**Decisão:** Promo no superadmin com:

| Campo | Significado |
|-------|-------------|
| Janela / duração | `promo_starts_at` / `promo_ends_at` (quando a oferta está **ativa** para adesão) |
| Quantidade de meses | `promo_duration_months` — por quantos **ciclos mensais** o benefício vale **para quem aderiu** (ex.: 3 = três primeiras cobranças mensais com a regra promo) |
| Modo do ajuste | Sempre escolher: **`amount_brl`** (centavos) **ou** **`percent`** |
| Direção | **`discount`** (desconto) **ou** **`surcharge`** (acréscimo) |

**Regra transversal (dinheiro):** qualquer desconto/acréscimo editável no admin → UI/API com **dois modos** (`fixed_brl` | `percent`). Não inventar só %.

**Modelo de dados alvo (proposta canônica para implementação — não código ainda):**

Não basta uma coluna `promo_price_cents` sozinha (não cobre % nem acréscimo nem “N meses”). Preferir registro de promo (em `plans` ou tabela `plan_promotions` 1:1/N por plano):

```
price_month_cents          -- lista mensal editável
price_year_cents           -- lista anual editável (não só fórmula)
promo_enabled
promo_starts_at / promo_ends_at
promo_duration_months      -- N ciclos com benefício após aderir
promo_adjustment_kind      -- discount | surcharge
promo_adjustment_mode      -- fixed_brl | percent
promo_adjustment_value     -- centavos se fixed; basis points ou decimal se percent
promo_applies_to           -- month | year | both  (a fechar se anual usa promo)
```

**Cálculo (mensal):**  
`lista` ± ajuste → valor cobrado enquanto `ciclos_cobrados_com_promo < promo_duration_months` e adesão ocorreu com promo ativa. Depois volta à lista.

**Anual + promo:** se `promo_duration_months` e cobrança anual é 1×, definir na R3 se promo no anual = desconto na parcela única ou N/A (só mensal).

---

### R2-B / R2 — Preço anual **editável**

| Decisão | Detalhe |
|---------|---------|
| **Editável** | Superadmin grava `price_year_cents` (não amarrado só à fórmula) |
| Default sugerido na UI | `mensal × 12 × 0,8` (20% off) como **valor inicial** ao criar/resetar; depois o admin pode mudar |

---

### R2-B / R3 — Anual = **1 parcela**

| Decisão | Detalhe |
|---------|---------|
| Cobrança | **Uma única** obrigação no ano (PIX/cartão valor cheio anual) |
| Ciclo | `next_billing_at` ≈ `paid_at + 1 year` (ou +365/+12 months — detalhe técnico na implementação) |
| Obrigação unificada | `kind` / period = `year` (não 12 invoices) |

---

### R2-C / R4 — Seats Pro

| Decisão | Detalhe |
|---------|---------|
| Base Pro | **R$ 349 inclui 1 usuário** |
| Extra | Cada usuário **adicional** = **R$ 99,00 / mês** (preço seat editável no futuro? default 9900 cents — R3 se editável) |

Ex.: 3 users no Pro → 349 + 2×99 = **R$ 547**/mês (antes de promo).

---

### R2-C / R5 — Seats Market

| Decisão | Detalhe |
|---------|---------|
| Inclusos | **10 usuários** no R$ 449 |
| Extra | A partir do **11º** = **R$ 99,00** / user / mês |

Ex.: 12 users → 449 + 2×99 = **R$ 647**/mês.

---

### R2 — Essencial (já BN-17)

| Decisão | Detalhe |
|---------|---------|
| Cap | **1 usuário** incluso; sem compra de seat adicional (ou hard cap — se precisar de 2º user, sobe de plano) |

---

## Preços de referência (ainda não seedar)

| Plano | Mensal lista | Anual lista (default 20% off, editável) | Users inclusos | Seat extra |
|-------|--------------|------------------------------------------|----------------|------------|
| Essencial | R$ 279 | R$ 2.678,40 | 1 | — (cap) |
| Pro | R$ 349 | R$ 3.350,40 | 1 | R$ 99 |
| Market | R$ 449 | R$ 4.310,40 | 10 | R$ 99 |

IA incluso 10% do **mensal de lista** do plano (BN-06): R$ 27,90 / 34,90 / 44,90 — confirmar na R3 se crédito anual = 10% do anual ou 12× mensal.

---

## Rodada 3 — Furos restantes (curtos)

Responda só o que faltar; o resto da R2 está fechado.

| ID | Pergunta | Por quê |
|----|----------|---------|
| **R3-1** | Promo na **renovação** de quem já é cliente, ou só quem **adere enquanto a campanha está no ar** (e leva N meses de benefício)? | Afeta cron renew vs só checkout novo |
| **R3-2** | Plano **anual**: pode usar a mesma promo (desconto/acréscimo R$/%) na parcela única? Se sim, `promo_duration_months` ignora-se no anual? | Anual = 1× |
| **R3-3** | Seat adicional: cobra **na hora** (proration BN-11) ou só no próximo vencimento? | Add user mid-cycle |
| **R3-4** | Downgrade Pro→Essencial (ou Market→Pro) com users acima do incluso: **obrigar reduzir** até a data X, ou **bloquear** agendamento até caber no limite? | BN-12 + seats |
| **R3-5** | Preço do seat R$ 99 e preços de plano: todos editáveis no superadmin (mesmo padrão R$/\% promo de seat?)? | Consistência admin |
| **R3-6** | Crédito IA no plano **anual**: 10% do valor anual pago, ou equivalente a 12× (10% do mensal)? | Wallet no fulfill |

---

## O que **não** fazer ainda (gate)

- Seed `plans.price_cents` / promo / seats no DB  
- UI superadmin de preços  
- Mudar `collectionPolicy` / change-plan / signup trial  
- Packs (BN-15)

Hardening técnico (HMAC, CAS, unificação **sem** inventar setup, RPC fulfill) pode seguir **preservando comportamento atual de preço** até “implementa” a trilha comercial — ou esperar um único “implementa” conjunto; dono escolhe.

---

## Referências

- `docs/BILLING_PLANS.md` (desatualizado até implementação)
- `docs/CORTE_CIRURGICO_BILLING_P1.md`
- `docs/ADR/0006-billing-hardening-idempotency-security.md`
- `.cursor/rules/decisoes-negocio-antes-codigo.mdc`
