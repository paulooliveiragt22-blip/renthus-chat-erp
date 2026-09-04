# Decisões de negócio — Billing

**Atualizado:** 2026-09-04 (revisão canônica — dono)  
**Gate:** `.cursor/rules/decisoes-negocio-antes-codigo.mdc`  
**Status:** Rodadas 1–3 **fechadas**. Este arquivo é a fonte de verdade comercial.

Estado: `[i]` implementado · `[>]` adiado · sem marca = decidido, código pendente de “implementa”.

---

## Rodada 1 — BN

| ID | Decisão |
|----|---------|
| **BN-01** | **C** — Congelar Essencial mínimo; expandir Pro/Market depois |
| **BN-02** | **A** — DB `plan_features` canônico |
| **BN-03** | Manter cotas no DB (editável depois, baixo retrabalho) |
| **BN-04** `[i]` | Mensal **279 / 349 / 449**; anual default **−20%**; **editáveis** no superadmin + promo (modelo R2) |
| **BN-05** `[i]` | **A** — Setup = 0 |
| **BN-06** | **A** — IA incluso = **10% do preço de lista mensal do plano** (ver R3-6) |
| **BN-07** `[i]` | **A** — Trial self-serve 0 (pay-to-start) |
| **BN-08** | **A** — Courtesy 30d (platform) |
| **BN-09** | **A** — Abandoned atual |
| **BN-10** | **A** — Signup só via RPC |
| **BN-11** | **C** — Upgrade com **proration** |
| **BN-12** | **A** + — Downgrade **agendado** para o fim do ciclo; até a data X pode **voltar** ao plano anterior, **subir** ou **cancelar** o agendamento |
| **BN-13** | **D0** tenta cobrar (cartão/PIX) · **D1 e D3** retry cartão + notifica se falhar · **D5+** = mesmo padrão D1/D3 · **D7 bloqueia** |
| **BN-14** | **A** — Reativa: paga **ciclo cheio**; se venceu dia 1, bloqueou D7 e pagou dia 15 → próximo vencimento = **dia 15** (`next_billing_at` = data do pagamento) |
| **BN-15** | **B** `[>]` — Packs **depois**; calibrar tokens no chatbot; nos packs cobrar **2×** o custo do token (pago 1 → cobra 2) |
| **BN-16** | **A** — Fiscal / TEF / 2FA **fora** |
| **BN-17** | Seats: Essencial **1** (cap) · Pro **+R$ 99**/user extra · Market **10** inclusos (detalhe R2/R3) |

---

## Rodada 2 — Promo, anual, seats base

### R2-1 — Promo editável

Superadmin configura:

| Campo | Significado |
|-------|-------------|
| Janela | `promo_starts_at` / `promo_ends_at` (oferta ativa para **adesão**) |
| Meses de benefício | `promo_duration_months` — N ciclos mensais com a regra, **para quem aderiu** |
| Ajuste | **`discount` \| `surcharge`** |
| Modo | **sempre** `fixed_brl` **ou** `percent` (qualquer dinheiro editável: não inventar só %) |

Modelo preferível: tabela `plan_promotions` (ou registro rico por plano) — não só uma coluna `promo_price_cents`.

### R2-2 — Anual editável

`price_year_cents` **editável** no superadmin.  
Default sugerido na UI: `mensal × 12 × 0,8` (20% off); depois o admin muda livremente.

### R2-3 — Anual = 1 parcela

Uma única obrigação no ano (PIX/cartão valor cheio).  
`next_billing_at` ≈ `paid_at + 1 year`.  
`kind` / period = `year` (não 12 invoices).

### R2-4 — Seats Pro

R$ **349 inclui 1** usuário.  
Cada adicional = **R$ 99,00 / mês** (default; editável — R3-5).

Ex.: 3 users → 349 + 2×99 = **547**/mês (antes de promo).

### R2-5 — Seats Market

**10** usuários no R$ 449.  
A partir do **11º** = **R$ 99** / user / mês.

### Essencial (BN-17)

Cap **1** usuário; sem compra de seat — precisa de 2º → sobe de plano.

---

## Rodada 3 — Furos

### R3-1 — Quem recebe promo

**Só quem entrou na campanha** (adesão enquanto a oferta está no ar).  
Leva **N meses** de benefício (ex.: 6× 50% off na mensalidade); acabou N → volta ao **valor normal (lista)** do plano.

**Não** aplicar promo na renovação de quem não aderiu na campanha.

Snapshot na subscription (`promo_id` / `promo_months_remaining` / regra congelada na adesão).

### R3-2 — Anual × promo

**Não misturar.** Anual **separado**, sem promo.  
Promo só no fluxo **mensal**.

### R3-3 — Seat adicional (cobrança)

**Cobra na hora** → **paga para liberar** a criação/ativação do usuário.

- Mid-cycle: obrigação `seat_add` com **proration** até o próximo `next_billing_at` (alinha BN-11).
- **Após adesão:** o valor adicional passa a ser **mensalidade recorrente junto com o plano** (N seats × preço do seat somados ao renew `subscription`).

### R3-4 — Downgrade com excesso de users

Na hora de **agendar** o downgrade:

1. Obrigatório **selecionar** usuário(s) a **manter**, até o limite do plano destino.
2. Obrigatório manter **≥1 Admin/owner** na seleção.
3. Demais: desativados/removidos **na data efetiva** (fim do ciclo), não antes.

Sem seleção válida → não agenda.

### R3-5 — Editável no admin

**Sim.** Todos editáveis no superadmin:

- Preço mensal lista  
- Preço anual lista  
- Preço do seat (default R$ 99)  
- Promo (janela, N meses, discount/surcharge, **R$ ou %**)

### R3-6 — Crédito IA (10%) — **lista sempre**

**Sempre 10% do valor original (lista mensal) do plano**, **sem** desconto.

| Exemplo | Cálculo |
|---------|---------|
| Essencial lista R$ 279 | 10% = **R$ 27,90** |
| Pro R$ 349 | **R$ 34,90** |
| Market R$ 449 | **R$ 44,90** |

**Independe** de:

- quanto foi **pago** naquele ciclo  
- se há **promo**  
- se o ciclo é **anual** ou mensal  

No anual: o crédito incluso mensal (ou budget do período) continua ancorado em **10% da lista mensal** do plano — **não** 10% do valor anual pago nem 10% do valor com promo.

> **Correção 2026-09-04:** anula a interpretação anterior “10% do valor efetivamente pago”. Canônico = **lista mensal original**.

Se o superadmin **editar** a lista mensal do plano (R3-5), o 10% passa a usar o **novo** preço de lista (não o valor histórico promocional).

---

## Matriz comercial

| Plano | Mensal lista | Anual (1×; default −20%; editável) | Users | Seat extra | Promo | IA incluso |
|-------|--------------|-------------------------------------|-------|------------|-------|------------|
| Essencial | R$ 279 | editável | 1 (cap) | — | só mensal / campanha | R$ 27,90 |
| Pro | R$ 349 | editável | 1 | R$ 99 | só mensal | R$ 34,90 |
| Market | R$ 449 | editável | 10 | R$ 99 | só mensal | R$ 44,90 |

---

## Já implementado vs pendente de “implementa”

| Item | Estado |
|------|--------|
| Preços 279/349/449 + year cols + seats cols + setup 0 + trial 0 | `[i]` PR #158 |
| IA wallet = 10% lista mensal (R3-6) | `[i]` via `planCatalog.aiIncludedCents` |
| Superadmin editar mensal/anual/seat (R3-5) + cobrança lê DB+seats | `[i]` C1 → UX C1-fix: anual via desconto %/R$ |
| `seat_quantity` + gate invite no cap | `[i]` C1 |
| Tabela `plan_promotions` (schema) | `[i]` C1 schema |
| Seat mid-cycle checkout `seat_add` + renew | `[i]` C2 — `POST /api/billing/seats/purchase` + fulfill bump |
| Promo engine + snapshot adesão | `[i]` C3 — attach na adesão + apply no charge + admin UI |
| Promo toggle kill-switch + signup De/por | `[i]` C1-fix — `active` + `/api/billing/public-plans` |
| Downgrade com seleção de users | pendente |

---

## Referências

- `docs/BILLING_PLANS.md`
- `docs/CORTE_CIRURGICO_BILLING_P1.md`
- `docs/ADR/0006-billing-hardening-idempotency-security.md`
- `.cursor/rules/decisoes-negocio-antes-codigo.mdc`
