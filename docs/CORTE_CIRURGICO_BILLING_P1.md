# Corte cirúrgico — Billing (antes de implementar)

**Status:** proposta de escopo · **não implementar** até “implementa”  
**Data:** 2026-09-04  
**Liga:** [ADR-0006](./ADR/0006-billing-hardening-idempotency-security.md) · [CHECKLIST_BILLING_HARDENING_P1](./CHECKLIST_BILLING_HARDENING_P1.md)  
**Próximo papo (fora deste doc):** regras de negócio ainda pendentes (features por plano, trial, preços setup, etc.)

Princípio: **endurecer o mínimo no caminho quente; fundir/apagar cerimônia; não abrir rewrite nem unificar tabelas agora.**

---

## 1. Alvo (forma final do fluxo)

```
Webhook (HMAC) → consume CAS → GET order → claim obrigação → 1 efeito fulfill
Cron = só criar cobrança / dunning (não libera plano)
/status = lê estado (+ sync curto só se pending+order_id; mesmo fulfill)
Platform replay = ops; não é caminho feliz
```

Menos caminhos de liberação de plano. Mais invariante no Postgres.

---

## 2. Endurecer (fazer — alinhado H0→H3, depois H4 mínimo)

| Prioridade | O quê | Checklist | Por quê |
|------------|-------|-----------|---------|
| P0 | HMAC timing-safe + secret obrigatório em prod | H0.10–H1.2 | Segurança barata; corta flood |
| P0 | CAS no consume (`updated_at` + RETURNING) | H1.3 | Um worker por evento |
| P0 | Key idempotência por `order_id` | H1.4 | `order.paid` ≈ `charge.paid` |
| P0 | Unique parcial `invoices(subscription_id) WHERE pending` | H2.1–H2.2 | Uma linha SQL > retry theater |
| P0 | Side-effects **só** após claim; customer só do GET | H3.1–H3.2 | Para double-activate |
| P0 | `handleOrderFailed` só após GET failed | H3.4 | Evita fail forjado |
| P1 | RPC `rpc_fulfill_*` **ou** sync com `next_billing_at` sempre no mesmo write | H3.3 | Preferência radical: RPC |
| P1 | Cancel-before-create (PIX cron + card) + paid→fulfill não cancel | H4.1–H4.2, H4.6 | Anti-órfão sem 4º reconciler |
| P1 | Amount checkout = catálogo | H4.3 | Preço stale |
| P2 | Cron: set processados + neverPaid→pending_payment; blockCompany 1 UPDATE | H5.1–H5.3 | Limpa lógica morta |
| P2 | RLS/TTL `billing_checkout_idempotency` | H2.3–H2.4 | Cache sensível |
| P2 | Platform change-plan + replay **reais** (ou apagar falso `[x]`) | H5.6 | Ops honesta |

**Não** empilhar H5.4/H5.5 (repos scale) antes do P0 — só se platform list doer agora.

---

## 3. Fundir (reduzir superfície sem big-bang)

| Ação | De | Para | Quando |
|------|-----|------|--------|
| **F1** | `activateAfterSetupPayment` + `syncLogicalSubscription` (+ provision) | **Um** write path / RPC fulfill | Com H3.3 |
| **F2** | Tenant `change-plan` + platform `change-plan` | Mesmo use case + **mesmo** `rebillPendingObligation` | Com H4.4 |
| **F3** | Key de evento por `eventType:orderId` | Só `pge:{orderId}` (ou event.id se estável) | H1.4 |
| **F4** | `SubscriptionPlanKey` com `bot`/`complete` | Aliases só em input + `normalizePlanKey` | H5.7 (barato, fazer cedo) |

Manter `setup_payments` ∪ `invoices` **separados** (ADR-0004 B7 / 0006 D7). Kind lógico em `EnsureCheckout` basta até doer de verdade.

---

## 4. Apagar / não crescer (corte explícito)

| Não fazer / remover | Motivo |
|---------------------|--------|
| **Novo** aggregate Obligation / unificar tabelas neste P1 | Rewrite; ADR proíbe |
| **Novo** path “listar paid no PSP e liberar” | Máscara de webhook morto |
| **4º** reconciler / cron reconcile-first | Piora overengineering |
| Expandir hexagonal no hot path **agora** | Ports quase não usados em webhook/fulfill/charge — ou injeta tudo depois, ou deixa; **não** metade |
| Novos contracts/mappers “por limpeza” sem bug | Cerimônia |
| Dual-path “HMAC opcional em prod” | ADR-0006 D2 mata isso |
| Tratar sync `/status` como cérebro | Rede de segurança UX; DoD = webhook + fulfill |

**Ports/adapters hoje:** deixar como estão para platform (`never-paid`, suspend). **Não** refatorar fulfill para ports neste corte — custo sem ganho de segurança. Reavaliar só se H3.3 for RPC (aí o Node vira thin caller).

---

## 5. O que **não** entra neste corte (papo seguinte)

Regras de negócio pendentes — **discussão separada**, não misturar com H1–H3:

- Matriz `feature_key` por plano (`essencial` / `pro` / `market`)
- Conteúdo de `plan_features` + `docs/BILLING_PLANS.md`
- Política de trial / courtesy / abandoned
- Preço de setup (`SETUP_PRICE_*` zero vs cobrado)
- AI wallet / packs como produto
- Downgrade / proration / mid-cycle
- Multi-PSP

Este doc = **segurança + invariante + menos caminho**. Produto = próximo thread.

---

## 6. Ordem de execução sugerida (quando “implementa”)

```
Bloco A (1 PR):  H1.* + H2.1 unique + H3.1/H3.2/H3.4     → L1 L2 L4 L5 parcial
Bloco B (1 PR):  H3.3 RPC ou sync atômico + H2.3/H2.4     → L4/L5
Bloco C (1 PR):  H4.1–H4.3 + H4.6 + H5.1–H5.3 + H5.7     → anti-órfão + cron limpo
Bloco D (ops):   H0.10 secret Vercel + H5.6 platform real + smoke H6
```

Prova mínima pós-Bloco A: 2× webhook mesmo order → 1 fulfill; HMAC inválido → 401 em prod.

---

## 7. Critério de sucesso do corte

| Antes (dor) | Depois |
|-------------|--------|
| Liberação de plano em vários lugares frágeis | Um efeito (fulfill / RPC) |
| Segurança no “jeito de falar” | L1–L5 no caminho quente |
| Hexagonal teatral + app direto | Hot path simples; ports só onde já usam |
| Mais reconcile quando quebra | Consertar ingestão + claim + unique |

---

## 8. Decisões (atualizado 2026-09-04)

| # | Pergunta | Resposta |
|---|----------|----------|
| R1 | Ordem do primeiro bloco | **Agente prioriza** — §9 |
| R2 | H3.3 fulfill | **RPC fulfill (radical)** |
| R3 | Unificar `setup_payments` ∪ `invoices`? | **SIM, agora** (2026-09-04) — supersede ADR-0004 B7 / 0006 D7 “não unificar no P0/P1” |

**Implicação R3:** P1 inclui migration de unificação + rewire call sites **antes ou junto** do RPC fulfill.  
**BN-05 (setup fee)** em `DECISOES_NEGOCIO_BILLING_PENDENTES.md` deve ser fechada **antes** de gravar o significado final de `kind=setup` — unificação estrutural pode começar preservando comportamento atual; não inventar setup fee novo.

---

## 9. Prioridade R1 (análise de risco → ordem)

Ordem pelo que **quebra dinheiro/acesso primeiro**, não pela numeração H*:

| Ordem | Item | Por quê primeiro |
|-------|------|------------------|
| 1 | H1.1–H1.2 HMAC | Sem auth, o resto é cosmético em prod |
| 2 | H3.1 claim-only side-effects | Double-activate / provision duplicado **hoje** |
| 3 | H1.3 CAS consume | Dois workers no mesmo evento |
| 4 | H2.1 unique pending invoice (+ setup se faltar) | Duplicate cobrança no ciclo |
| 5 | H1.4 key por order_id | Barato; fecha buraco order.paid vs charge.paid |
| 6 | H3.4 fail só após GET | Fail forjado |
| 7 | **H3.3 RPC fulfill** (R2) | Bloco próprio: migration + rewire `fulfillPayment` |
| 8 | H4 cancel-before-create + amount catálogo | Órfãos PSP / preço stale |
| 9 | H0.10 secret Vercel + smoke | Ops; pode paralelo a 1–2 |
| 10 | H5 cron limpo / platform / TTL | Depois do núcleo |

**Primeiro PR sugerido (núcleo):** itens 1–6 (HMAC + claim + CAS + unique + key + fail-GET).  
**Segundo PR:** item 7 RPC fulfill.  
**Terceiro:** anti-órfão + cron (§2 P1/P2 restantes).

---

## 10. Unificar tabelas — **decidido: SIM agora (R3)**

- Uma obrigação canônica (ex. `billing_obligations` ou `invoices` + `kind`).
- Backfill `setup_payments` → nova forma; unique pending único; um fulfill branch.
- **Não** misturar com decisões BN-* (preço setup, trial, features) — ver `DECISOES_NEGOCIO_BILLING_PENDENTES.md`.
- Gate: `.cursor/rules/decisoes-negocio-antes-codigo.mdc`.

Ordem técnica revisada (§9 + R3):

```
PR0  HMAC + claim + CAS + key + fail-GET (+ validar unique existente)
PR1  Unificação obrigações (schema + rewire) — preservar comportamento comercial atual
PR2  RPC fulfill radical sobre a tabela unificada
PR3  Anti-órfão PSP + amount catálogo + cron limpo
```
