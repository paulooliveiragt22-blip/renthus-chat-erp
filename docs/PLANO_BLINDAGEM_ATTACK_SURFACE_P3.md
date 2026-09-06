# Plano — blindagem da superfície de ataque (P3)

**Contexto:** pós RLS lock-down + A1–A7 + `search_path` pin.  
**Premissa:** PostgREST não é o vetor principal; o alvo é **borda Next** (secrets, sessão, webhooks, agent, menu público).  
**Fonte do red-team:** canvas `attacker-surface` + `docs/SECURITY_CREATEADMIN_INVENTORY.md`.

**Regra:** sem dual-path legado. Ao trocar secret/auth, atualizar call sites + testes na mesma entrega.

### Decisões fechadas (2026-09-05)

1. Env interno resolve: **`INTERNAL_CHATBOT_SECRET`**
2. B5: capability **`customers.export`** (catálogo RBAC já inclui; gate na rota = Onda 1)
3. B10: **um** `CRON_SECRET` por enquanto (sem split billing/ops)

---

## Onda 0 — secrets que abrem o reino (P0)

| ID | Item | Ação | Aceite | Status |
|----|------|------|--------|--------|
| **B1** | `POST /api/chatbot/resolve` | `INTERNAL_CHATBOT_SECRET` + timing-safe; prod fail-closed; sessão via `requireCapability` | Grep limpo; testes em `tests/security/internalChatbotAuth.test.ts` | [x] 2026-09-05 |
| **B2** | Tokens do cardápio | Removido fallback `SUPABASE_SERVICE_ROLE_KEY` em `sessionToken.ts` | Só `WEB_MENU_SESSION_SECRET` | [x] 2026-09-05 |
| **B3** | Auth HIBP | Ligar *Leaked Password Protection* no Dashboard Auth | Advisor limpa | [x] 2026-09-05 — ops + advisor sem HIBP |
| **B4** | Inventário service role como senha | `SECURITY_SERVICE_ROLE_FLOWS.md` seção B4 | Zero comparações de borda | [x] 2026-09-05 |

**Ops:** `INTERNAL_CHATBOT_SECRET` + `WEB_MENU_SESSION_SECRET` na Vercel (feito 2026-09-05).

---

## Onda 1 — blast radius com sessão válida (P1)

| ID | Item | Ação | Aceite | Status |
|----|------|------|--------|--------|
| **B5** | Export PII clientes | Paginação + lista leve; export completo com `customers.export` + rate limit. Capability já no catálogo. | Staff sem export não baixa dump PII | [x] 2026-09-05 — `?export=1` + list leve; UI clientes usa export |
| **B6** | `GET /api/orders/[id]` | Cookie: `requireCapability("orders.read")`. Agent: projecção mínima. | Sem capability → 403 | [x] 2026-09-05 |
| **B7** | Print Agent keys | Rotação / invalidação + scramble no revoke; `verifyAgentByApiKey` exige ativo | Key antiga 401 | [x] 2026-09-05 — PATCH rotate + UI |
| **B8** | Impersonation platform | TTL 30 min; expire→audit; PII mask em customers/orders; banner com countdown | Sessão expira + audit | [x] 2026-09-05 |

---

## Onda 2 — canais externos e dinheiro (P1)

| ID | Item | Ação | Aceite | Status |
|----|------|------|--------|--------|
| **B9** | Webhooks Meta / Pagar.me | Fail-closed secret ausente | Nunca processa sem auth | [x] 2026-09-05 — Meta 503; Pagarme ignora ALLOW_INSECURE em prod |
| **B10** | `CRON_SECRET` | Playbook de rotação (secret único) | Doc rotação | [x] 2026-09-05 — `docs/RUNBOOK_CRON_SECRET_ROTATION.md` |
| **B11** | Billing public | Allowlist + rate limit IP; signup + email/CNPJ; conflito 409 único | Sem enum útil além do catálogo | [x] 2026-09-05 — `signupPublicAbuse` + `enforceKeyRateLimitAsync` |

---

## Onda 3 — abuso de produto / AI (P2)

| ID | Item | Ação | Aceite | Status |
|----|------|------|--------|--------|
| **B12** | Menu público | Rate limits IP+slug | 429 sob flood | [x] 2026-09-06 — `enforcePublicMenuRateLimit` em todas rotas `/api/public/menu/[slug]/**` |
| **B13** | PRO / WhatsApp | Caps wallet; trim raw_payload | Tests básicos | [x] 2026-09-06 — teto débito `clampAiDebitCents`; `maxOutputTokens` turno; trim inbox `raw_payload` |
| **B14** | Extensions schema | Mover pg_trgm/unaccent | Advisor limpo | [x] 2026-09-06 — `ALTER EXTENSION … SET SCHEMA extensions`; advisor `extension_in_public` vazio |

---

## Contínuo (gate de PR)

| ID | Item | Ação | Status |
|----|------|------|--------|
| **B15** | Gate createAdmin | Inventário em toda rota nova | [ ] processo |
| **B16** | Teste de regressão | resolve + cron + meta + menu secret | [x] parcial (B1) |

---

## Ordem restante

```
(nenhum item de entrega — só B15 processo contínuo)
```

## Fora de escopo

- Reabrir RLS com policies `company_id` no PostgREST.
- Dual-path service_role **ou** secret novo.
- Split `CRON_SECRET` billing/ops (adiado).
