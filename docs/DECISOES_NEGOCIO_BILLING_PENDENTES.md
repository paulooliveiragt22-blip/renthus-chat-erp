# Decisões de negócio — Billing (pendentes)

**Status:** aguardando dono · **sem código/DB** até `[x] decidido`  
**Data:** 2026-09-04  
**Gate:** `.cursor/rules/decisoes-negocio-antes-codigo.mdc`

Hardening técnico / unificação de obrigações / RPC fulfill = **fora** desta lista (já decididos no corte).  
Isto = **comportamento comercial** que ainda muda preço, acesso, features ou ciclo de vida.

Estado: `[ ]` aberto · `[x] decidido` + data + escolha · `[~]` parcial.

---

## Como usar

1. Dono responde por ID (ex.: `BN-01 = B`).
2. Agente registra escolha nesta tabela.
3. Só então seed/migration/UI/API que dependem disso.

---

## BN — Catálogo e features

| ID | Pergunta | Opções (rascunho) | Impacto se adiar | Estado |
|----|----------|-------------------|------------------|--------|
| **BN-01** | Matriz final: quais `feature_key` em `essencial` / `pro` / `market`? | A) Manter `planCatalog.features` + `BILLING_PLANS.md` como está e só auditar DB `plan_features` · B) Revisar lista (adicionar/remover keys) · C) Congelar Essencial mínimo e expandir Pro/Market depois | Seed `plan_features`, gates UI/API, RPC entitlements | [ ] |
| **BN-02** | `planCatalog.features` vs linhas em `plan_features` — quem manda se divergirem? | A) DB (`plan_features`) canônico; TS só espelho · B) TS canônico; seed segue TS · C) CI falha se divergir | Evita drift silencioso | [ ] |
| **BN-03** | Cota `whatsapp_messages` (e outras) por plano — valores finais? | Informar números ou “manter o que está no DB hoje” | `feature_limits` | [ ] |

---

## BN — Preço e setup

| ID | Pergunta | Opções | Impacto se adiar | Estado |
|----|----------|--------|------------------|--------|
| **BN-04** | Mensalidades 197 / 279 / 397 — confirmadas? | A) Sim · B) Novos valores (informar centavos) | `plans.price_cents`, checkout | [ ] |
| **BN-05** | **Setup fee** (`SETUP_PRICE_*`): cobramos adesão? | A) Sempre 0 (só mensal; sem `pending_setup`) · B) Setup > 0 por plano (informar centavos) · C) Setup só no Market | Modelo pós-unificação: `kind=setup` existe ou morre; status `pending_setup` | [ ] |
| **BN-06** | Crédito IA incluso = 10% do mensal — confirmado? | A) Sim · B) Valor fixo por plano · C) Sem crédito incluso (só packs) | `aiIncludedCents`, wallet no signup/fulfill | [ ] |

---

## BN — Trial, signup, abandono

| ID | Pergunta | Opções | Impacto se adiar | Estado |
|----|----------|--------|------------------|--------|
| **BN-07** | Trial self-serve no signup: quantos dias default? | A) **0** (pay-to-start, Stripe incomplete) · B) N dias (informar N) · C) Configurável em `platform_billing_settings` só | `signup` RPC, TenantAccess, paywall | [ ] |
| **BN-08** | Courtesy trial (superadmin): teto 30d + planos comerciais — ok? | A) Manter E3 · B) Mudar teto/planos | `rpc_platform_grant_courtesy_trial` | [ ] |
| **BN-09** | Status `abandoned`: quando marcar e o que o tenant vê? | A) Política atual (doc TenantAccess) · B) Redefinir critérios · C) Remover status | Cron mark-abandoned, UI | [ ] |
| **BN-10** | Dois orquestradores pós-signup (`signupCompanyViaRpc` vs paths legados) — canônico único? | A) Só RPC signup · B) Manter ambos até data X | Evita drift N=0 / trial (B0.1) | [ ] |

---

## BN — Ciclo de vida / troca de plano

| ID | Pergunta | Opções | Impacto se adiar | Estado |
|----|----------|--------|------------------|--------|
| **BN-11** | Upgrade mid-cycle: cobra diferença agora ou só no próximo ciclo? | A) Rebill pending / cobra na hora · B) Só `next_billing_at` · C) Proration proporcional | `change-plan`, rebill, unificação | [ ] |
| **BN-12** | Downgrade: imediato, fim do ciclo, ou bloqueado? | A) Só fim do ciclo · B) Imediato sem reembolso · C) Bloqueado (só upgrade self-serve) | change-plan tenant | [ ] |
| **BN-13** | Grace / overdue: dias até `blocked` (D0/D1/D3 atuais)? | A) Manter `collectionPolicy` · B) Novos prazos | Cron charge, dunning | [ ] |
| **BN-14** | Reativação self-serve após blocked: paga ciclo cheio ou proporcional? | A) Ciclo cheio · B) Proration · C) Só superadmin reativa | `rpc_self_reactivate_*`, UI reativar | [ ] |

---

## BN — Add-ons / fora do core (pode adiar em bloco)

| ID | Pergunta | Opções | Estado |
|----|----------|--------|--------|
| **BN-15** | Packs IA (R$10/20/50) e auto-recharge — preços/fluxos finais? | A) Manter · B) Alterar | [ ] |
| **BN-16** | Fiscal NFC-e / TEF / 2FA — fora do MVP? | A) Fora · B) Entrar (escopo) | [ ] |
| **BN-17** | Multi-user por company — ainda 1 usuário MVP? | A) 1 user · B) N users | [ ] |

---

## Ordem sugerida de decisão (produto)

```
BN-05 setup fee  →  afeta modelo da unificação (kind=setup existe?)
BN-07 trial N    →  afeta signup/paywall
BN-04 preços     →  confirma catálogo
BN-01/02/03 features/cotas
BN-11/12 change-plan
BN-13/14 dunning/reativação
BN-08/09/10/15+  refinamentos
```

**BN-05 e BN-07** são as que mais bloqueiam desenho limpo da unificação + RPC fulfill sem retrabalho comercial.

---

## Já decidido (contexto técnico — não reabrir aqui)

| Decisão | Onde |
|---------|------|
| Unificar `setup_payments` ∪ `invoices` **agora** | Corte + ADR-0006 emenda |
| RPC fulfill radical | R2 |
| Runtime Route Handlers only | ADR-0004 A |
| Features booleanas leem `plan_features` (plumbing) | ADR-0004 B5 — **conteúdo** da matriz = BN-01 |

---

## Referências

- `docs/BILLING_PLANS.md`
- `docs/CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS.md` (E2/E3, B0.1)
- `docs/CORTE_CIRURGICO_BILLING_P1.md`
- `docs/ADR/0006-billing-hardening-idempotency-security.md`
- `.cursor/rules/decisoes-negocio-antes-codigo.mdc`
