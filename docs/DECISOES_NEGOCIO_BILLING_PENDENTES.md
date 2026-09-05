# Decisões de negócio — Billing

**Atualizado:** 2026-09-04 (Pacote 5 — UI anual /signup + /plano toggle + troca mensal→anual pay-to-switch R2-5)  
**Gate:** `.cursor/rules/decisoes-negocio-antes-codigo.mdc`  
**Status:** Rodadas 1–3 **fechadas**. Este arquivo é a fonte de verdade comercial.

Estado: `[i]` implementado · `[~]` implementado com **desvio** a corrigir · `[>]` adiado · sem marca = decidido, código pendente de “implementa”.

---

## Rodada 1 — BN

| ID | Decisão |
|----|---------|
| **BN-01** | **C** — Congelar Essencial mínimo; expandir Pro/Market depois |
| **BN-02** | **A** — DB `plan_features` canônico |
| **BN-03** | Manter cotas no DB (editável depois, baixo retrabalho) |
| **BN-04** `[i]` | Mensal **279 / 349 / 449**; anual default **−20%**; **editáveis** no superadmin + promo (modelo R2) |
| **BN-05** `[i]` | **A** — Setup = 0 (**não existe**); `kind=setup` removido do CHECK; histórico remapeado para `subscription` |
| **BN-06** `[i]` | **A** — IA incluso = **10% do preço de lista mensal do plano** (ver R3-6) |
| **BN-07** `[i]` | **A** — Trial self-serve 0 (pay-to-start) |
| **BN-08** `[~]` | **A** — Courtesy **1–30d** (platform); RPC ok; **use case ainda 1–14** |
| **BN-09** | **A** — Abandoned atual (never-paid; **não** é o D7 de renovação) |
| **BN-10** | **A** — Signup só via RPC |
| **BN-11** `[i]` | **C** — Upgrade com **proration** |
| **BN-12** `[i]` | **A** + — Downgrade **agendado** fim do ciclo; voltar / subir / cancelar até a data |
| **BN-13** | **D0** cobra · **D1/D3** retry card + notify · **D5+** retry card + notify · **D7 bloqueia** — clarificações 2026-09-04 abaixo |
| **BN-14** | **A** — Pós-D7: paga **ciclo cheio**; `next_billing_at` = **data do pagamento** (ex.: bloqueou D7, pagou dia 15 → vence dia 15) |
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

### R2-3 — Anual = 1 parcela `[i]`

Uma única obrigação no ano (PIX/cartão valor cheio).  
`next_billing_at` ≈ `paid_at + 1 year`.  
`kind` / period = `year` (não 12 invoices).

**Resolvido (Pacote 2/4):** `fn_billing_next_due(paid_at, period)` (+1m|+1y), `rpc_fulfill_obligation` period-aware, `rpc_create_billing_obligation` promove `kind=year` com valor anual canônico e dunning anual no cron (`kind in (subscription,year)`). Validado end-to-end via RPC.

**UI anual (Pacote 5 — 2026-09-04):** `/signup` ganhou toggle Mensal/Anual (default Anual): card mostra `price_year_cents/12` /mês + total/ano à vista + −20%; `rpc_signup_company_with_billing` recebe `p_billing_period` (grava `billing_period`), 1ª fatura via `createInitialInvoice` (period-aware). `/plano` e `/plano/pagar` (PlanChangeCatalog) ganharam o mesmo toggle (também em `pending_payment`); never-paid persiste ciclo via `rpc_set_prepay_billing_period`. Assinante mensal ativo usa **migrar mensal→anual** (ver R2-5).

### R2-5 — Troca de ciclo mensal→anual (pay-to-switch) `[i]`

**Decidido 2026-09-04:** assinante **mensal ativo** pode migrar para anual pagando o **anual à vista − crédito do mês já pago** (`credit = prorate(mensal_efetivo, dias_restantes≤30, 30)`). Ao pagar, `billing_period='year'` e o ciclo reinicia (+1 ano). Só `owner/admin`. Anual→mensal **não** nesta rodada.

**Resolvido (Pacote 5):** `rpc_quote_period_switch` (amount canônico no banco), `rpc_fulfill_obligation` branch `kind=period_switch` (flip período + `next=+1y`), `ensurePeriodSwitchCheckout` + `POST /api/billing/switch-period` (RBAC owner/admin), UI toggle no `PlanChangeCatalog`. Validado o quote em subs reais via RPC.

**Emenda 2026-09-05 — upgrade + anual combinado `[i]`:** na view Anual, clicar plano **maior** (ex. Market) gera um único checkout: `annual(destino) − crédito(mês atual)`. Intent `upgrade_to_annual` + `pending_upgrade_plan_key`; invoice `period_switch` com `target_plan_key`; fulfill aplica plano + `billing_period=year`. View Mensal no upgrade continua BN-11 (delta mensal prorateado).

**Emenda 2026-09-05b — matriz de migração (dono):**

| De → Para | Comportamento |
|-----------|----------------|
| Mensal → mensal **superior** | Imediato (pró-rata BN-11) |
| Mensal → mensal **inferior** | Agendado fim do ciclo (BN-12) |
| Mensal → **anual** (igual / superior / **inferior**) | **Imediato** pró-rata (`annual(destino) − crédito do mês`) — **não** espera o fim do mês |
| Anual → anual **superior** | Imediato (delta anual / 365) |
| Anual → anual **inferior** | Agendado fim do ciclo anual |
| Anual → mensal | Fora de escopo (anual só migra para anual) |

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

### R3-3 — Seat adicional (cobrança) `[i]`

**Cobra na hora** → **paga para liberar** a criação/ativação do usuário.

- Mid-cycle: obrigação `seat_add` com **proration** até o próximo `next_billing_at` (alinha BN-11).
- **Após adesão:** o valor adicional passa a ser **mensalidade recorrente junto com o plano** (N seats × preço do seat somados ao renew `subscription`).

**Modelo anual do seat — decidido 2026-09-04 (opção A):** no plano anual o seat extra custa `seat_extra_cents × 12` (preço anual do assento), prorateado por `dias_restantes / 365` até a renovação; a renovação anual (`kind=year`) soma `(seats − included) × (seat_extra_cents × 12)`.

**Resolvido (Pacote 4):** proration período-aware no banco (`rpc_quote_seat_add`: mês → unit=seat, cycle=30; ano → unit=seat×12, cycle=365) chamando `fn_billing_prorate_cents`; renovação anual com extras em `rpc_create_billing_obligation`. Espelho puro mensal `prorateSeatExtraCents` mantido só para teste.

### R3-7 — Quem pode fazer upgrade/downgrade — **só owner/admin** `[i]`

Mudança de plano (upgrade proration ou downgrade agendado) e compra de seat são
operações **owner/admin**. Enforçado no servidor: `POST /api/billing/change-plan`,
`POST /api/billing/seats/purchase` e `pending-plan-change` usam
`requireCompanyAccess(["owner","admin"])`. UI defense-in-depth `[i]`: `/api/billing/status`
devolve `role`; `PlanBillingPanel` esconde `PlanChangeCatalog` p/ não-owner/admin;
`TeamMembersPanel` já não mostra convite/seat p/ member (`inviteable=[]`) + msg clara no 403.

### R3-8 — Upgrade dentro do anual — rateio/abatimento `[i]`

Cliente que já pagou o anual e faz upgrade **paga só a diferença**: cobra-se o
**delta anual** (`year(destino) − year(atual)`) prorateado por `dias_restantes / 365`
— o valor já pago é abatido implicitamente. **Anual só sobe para anual** (o upgrade
preserva `billing_period` da assinatura; não há troca de período nesse fluxo).
Resolvido (Pacote 4): `rpc_quote_plan_upgrade` período-aware (mês → delta mensal / 30;
ano → delta anual / 365) no banco.

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
| IA wallet = 10% lista mensal (R3-6) | `[i]` `fn_billing_ai_included_cents` + coluna gerada `plans.ai_included_cents` + `rpc_ai_included_budget`; status/carteira não leem o catálogo TS |
| Superadmin editar mensal/anual/seat (R3-5) + cobrança lê DB+seats | `[i]` C1 → UX C1-fix: anual via desconto %/R$ |
| `seat_quantity` + gate invite no cap | `[i]` C1 |
| Tabela `plan_promotions` (schema) | `[i]` C1 schema |
| Seat mid-cycle checkout `seat_add` + renew | `[i]` Pacote 4 — proration período-aware no banco (`rpc_quote_seat_add`); renew anual com extras |
| Promo engine + snapshot adesão | `[i]` C3 — attach na adesão + apply no charge + admin UI |
| Promo toggle kill-switch + signup De/por | `[i]` C1-fix — `active` + `/api/billing/public-plans` |
| Promo Switch UI + editar campanha (PATCH full) | `[i]` C1-fix2 |
| Downgrade com seleção de users | `[i]` BN-12 — pending_* + apply no fulfill + UI /plano |
| Upgrade mid-cycle com proration (BN-11) | `[i]` plan_upgrade + PIX pay-to-unlock; anual = delta anual /365 (`rpc_quote_plan_upgrade`, R3-8) |
| Ciclo anual R2-3 (kind=year, +1y no fulfill) | `[i]` Pacote 2/4 — fulfill period-aware, `kind=year`, dunning anual, seat/upgrade anual |
| RBAC upgrade/downgrade só owner/admin (R3-7) | `[i]` server-side nas 3 rotas + UI defense-in-depth (status.role → esconde catálogo; painel de equipe já oculta convite/seat p/ member) |
| Cortesia BN-08 1–30d | `[i]` RPC + use case + UI + testes alinhados a 1–30 |
| BN-13 dunning D7 | `[i]` `fn_billing_collection_action` D1/D3/D5 retry + D7 block; cron filtra `kind∈{subscription,year}` |
| BN-14 reativação pós-bloqueio (ciclo cheio) | `[i]` checkout interativo puxa obrigação canônica (subscription\|year); fulfill → `active` + `next=paid+período`; **≠** `self-reactivate` (abandoned→trial) |
| BN-15 packs | `[>]` |
| Limpeza legado setup (BN-05) | `[i]` CHECK sem setup; fulfill/checkout/status sem ramo; `computeNextBillingAt` removido |

---

## Clarificações BN-13 (2026-09-04 — dono)

| ID | Decisão |
|----|---------|
| **BN-13-R1** | **Setup não existe mais.** Dunning/overdue **não** processa `kind=setup`. Remover/ignorar path `generateSetupCharge`; void/cancel pendings `setup` órfãos. |
| **BN-13-R2** | Sem cartão: **só WA** nos dias **D1 / D3 / D5** (não refresh PIX obrigatório no cron). Com cartão: retry nos dias de política. |
| **BN-13-R3** | **Sim** — `kind=year` entra no mesmo dunning BN-13 (junto com `subscription`). |

Matriz alvo pós-correção:

| Dia | Com `default_card_id` | Sem cartão |
|-----|----------------------|------------|
| D0 | collect card→PIX fallback | collect PIX |
| D1, D3 | retry card; se falhar → WA | WA only |
| D2, D4, D6 | noop | noop |
| D5+ (&lt; D7) | retry card; se falhar → WA (templates D1/D3/**D5**) | WA only em **D5** |
| D7+ | **block** | **block** |

Never-paid / abandoned (BN-09) **fora** desta matriz — não misturar com D7 de renovação.

---

## Auditoria cruzada — conflitos e inconsistências

### A) Conflitos entre decisões (produto)

| Par | Problema | Resolução proposta |
|-----|----------|-------------------|
| **BN-05 × kind=setup no schema/cron** | `[i]` Fee=0; `generateSetupCharge` + `resolveTrialDueKind` removidos; trial vencido → 1ª mensalidade via `collectPayment`; overdue só `subscription`\|`year` (kind=setup nunca gerado) |
| **BN-08 × GrantCourtesyTrial 1..14** | Decisão/RPC = 30d; use case rejeita 15–30 | Alinhar use case + UI a **1..30** |
| **BN-13 × checklist renewal / collectionPolicy** | Docs+código block **D5**; canônico **D7** | Atualizar política, testes, WA, checklist |
| **BN-13 × WA templates** | Texto “bloqueio em D5” / “faltam 2 dias” no D3 | Reescrever para D7; D5 = penúltimo aviso |
| **BN-13 × BN-09 / stale 5d block** | `[i]` Loop `stalePendingSetups` (5d) removido do charge; `processOverdueInvoiceRow` checa `neverPaid` **antes** do block → D7 bloqueia só quem já pagou; never-paid → abandoned via `mark-abandoned` (14d) |
| **BN-14 × self-reactivate** | Self-reactivate = abandoned→**trial**; BN-14 = blocked overdue→**paga ciclo cheio** | Dois fluxos: manter self-reactivate p/ abandoned; BN-14 = checkout renew full + fulfill com `next_billing_at=paid_at+(1m\|1y)` |
| **R2-3 × fulfill/charge** | Anual no catálogo; fulfill sempre +1 mês; invoice sempre mensal | Pacote “anual completo”: charge amount year, `kind=year`, `next=+1 year` |
| **R2-3 × R3-3 seat proration** | Seat mid-cycle com cap 30d em ciclo anual subcobra | Proration `daysLeft / cycleDays` sem cap artificial; `cycleDays` = 30 (mês) ou dias do ciclo anual |
| **R3-2 × renew** | Promo só mensal — OK no attach | Garantir charge de `year` nunca aplica promo (já parcial) |
| **BN-11 × R3-2** | Upgrade prorata sem promo | OK — manter |
| **BN-12 × BN-11** | Downgrade agenda; upgrade cobra agora | OK — sem conflito |
| **BN-06/R3-6 × anual** | IA = 10% lista **mensal** mesmo no anual | OK — documentado; não usar 10% do year |

### B) Desvios no código já “aplicado” (corrigir)

| # | Item | Ação |
|---|------|------|
| C1 | BN-08 courtesy 1–30 | `[i]` `grantCourtesyTrial.ts` (>30), route/UI label, teste 31 inválido + 30 válido |
| C2 | BN-05 limpeza setup | `[i]` `generateSetupCharge`/`resolveTrialDueKind` removidos; trial→1ª mensalidade; stale 5d block removido; D7 só p/ quem já pagou |
| C3 | R2-3 anual | `[i]` `fn_billing_next_due(period)`; fulfill period-aware; `rpc_create_billing_obligation` promove `kind=year` + valor anual; dunning `kind in (subscription,year)`; **checkout interativo** (`loadCheckoutContext`) também puxa amount+kind do banco |
| C4 | R3-3 seat × anual | `[i]` `rpc_quote_seat_add` período-aware (ano = seat×12 / 365); renew anual soma extras |
| C5 | Marcar BN-12 `[i]` | já refletido acima |

### C) Ainda não aplicados — estrutura alvo

#### BN-13 (retries / D7) — após C2

```
Domain:     collectionPolicy (D7 block; D5+ retry; labels d0|d1|d3|d5|…)
Application: charge/route overdue loop
  - filter kind ∈ {subscription, year}
  - neverPaid early-exit SEM block D7 de renovação
  - WA: buildOverdueMessage(1|3|5) + msg D7 opcional no block
  - attempt_n = daysOverdue
Adapters:   (sem schema novo)
Docs:       CHECKLIST_AUTO_RECHARGE + DECISOES [i]
```

#### BN-14 (reativação pós-D7)

```
Domain:     resolveReactivationAmount (ciclo cheio month|year)
Application: EnsureCheckout / CollectPayment para status=blocked + last_paid_at
             fulfill: next_billing_at = paid_at + period (NÃO trial)
API:        /plano/pagar já; garantir blocked → checkout full cycle
NÃO reusar: rpc_self_reactivate_subscription (é BN-09 abandoned→trial)
```

#### R2-3 anual (completar) — pré-requisito de BN-13-R3 e BN-14 anual

```
Domain:     computeNextBillingAt(paidAt, period)
Application: ensureCheckout + collectPayment + rpc_fulfill_obligation
UI:         signup/plano já mostra anual; cobrir smoke renew year
```

#### BN-15 `[>]` / BN-16 — fora

---

## Ordem de execução sugerida

1. **C1** Courtesy 1–30 (rápido, sem conflito)  
2. **C2** Limpeza setup no dunning + void pendings (desbloqueia BN-13 seguro)  
3. **C3+C4** Anual fulfill/charge + seat proration (R2-3 / R3-3)  
4. **BN-13** política D7 + WA + filtros (com R1–R3)  
5. **BN-14** reativação pós-bloqueio (depende de BN-13)  
6. Docs checklist renewal alinhar D7  

---

## Referências

- `docs/BILLING_PLANS.md`
- `docs/CORTE_CIRURGICO_BILLING_P1.md`
- `docs/ADR/0006-billing-hardening-idempotency-security.md`
- `.cursor/rules/decisoes-negocio-antes-codigo.mdc`
