# Checklist — melhorias de segurança (prioridade sugerida)

Use como guia de implementação e revisão periódica. Itens derivados da análise do repositório `renthus-chat-erp`.

**Legenda:** `[x]` implementado ou documentado neste repo · `[ ]` ação manual / contínua · `[~]` parcial

---

## 1. Autorização em rotas com `createAdminClient` (service role)

- [x] Inventariar todas as rotas `app/api/**` que usam `createAdminClient()`. → `docs/SECURITY_CREATEADMIN_INVENTORY.md`
- [ ] Garantir em cada uma: identidade confiável (sessão, API key, HMAC, `CRON_SECRET`, etc.) **antes** de qualquer query. *(revisão contínua com o inventário)*
- [ ] Garantir filtro por `company_id` (ou equivalente) com valor vindo de fonte validada, nunca só de input externo sem checagem. *(ex.: rever `?company_id=` em `billing/status`)*

---

## 2. Reduzir superfície “pública” no middleware

- [x] Manter em `isTechnicalApiPublic` apenas o estritamente necessário (webhook Meta, flows Meta, print, billing público, agent, etc.). → `middleware.ts` (WhatsApp já granular)
- [ ] Revisar periodicamente `app/api/agent/**` para que nenhuma sub-rota fique sem autenticação.

---

## 3. RLS no Supabase como rede de segurança

- [ ] Confirmar que tabelas sensíveis têm RLS ativo (já existe em várias migrações). *(Supabase Dashboard / migrações)*
- [x] Documentar quais fluxos **só** podem usar service role (webhook, cron) vs. leitura via utilizador autenticado. → `docs/SECURITY_SERVICE_ROLE_FLOWS.md`

---

## 4. Webhooks (Meta, Pagar.me)

- [ ] Produção: `WHATSAPP_APP_SECRET` e `PAGARME_WEBHOOK_SECRET` definidos e rotacionados se vazados. *(env Vercel + `npm run check:prod-env --strict`)*
- [x] Considerar rate limit adicional no webhook de billing (além do existente no WhatsApp, se aplicável). → `app/api/billing/webhook/route.ts` (IP + janela)
- [x] Produção sem `PAGARME_WEBHOOK_SECRET`: webhook responde `500 server_misconfigured` (não aceita corpo sem verificação).

---

## 5. Crons e filas (`CRON_SECRET`)

- [x] `CRON_SECRET` obrigatório em produção (já parcialmente coberto por `validateCronAuthorization`).
- [x] Validar em CI/deploy que a variável existe no ambiente `production`. → `npm run check:prod-env` com `VERCEL_ENV=production` ou `--strict`

---

## 6. Superadmin (`SUPERADMIN_SECRET` / cookie `sa_token`)

- [ ] Segredo longo e aleatório; HTTPS obrigatório. *(operação / env)*
- [ ] Opcional: token de curta duração ou 2FA para área superadmin.

---

## 7. Uploads (Storage)

- [x] Limites de tamanho e allowlist de MIME em `/api/whatsapp/upload`, `/api/products/upload-image`, etc. → `lib/security/uploadGuards.ts`
- [ ] Revisar políticas de bucket (público só onde for inevitável). *(Supabase Storage policies)*

---

## 8. Rate limiting distribuído

- [~] Substituir ou complementar o rate limit em memória (`lib/security/rateLimit.ts`) para rotas críticas em ambiente multi-instância (Redis/Upstash ou WAF). → comentário de orientação no ficheiro

---

## 9. Cabeçalhos HTTP globais

- [~] Definir `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options` / `frame-ancestors`, `Permissions-Policy` (testar com PWA e integrações). → `next.config.js`: HSTS (prod), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. **CSP** não incluída (exige ajuste fino com Next.js / PWA).
- [ ] Opcional: `Content-Security-Policy` ou `Report-Only` após testes manuais.

---

## 10. Segredos e variáveis de ambiente

- [x] Nunca commitar `.env*`; revisar histórico se chaves vazaram. → `.gitignore` já inclui `.env*`
- [ ] Menor privilégio nos tokens Meta (só escopos necessários). *(Meta Business)*

---

## 11. Rotas de diagnóstico

- [x] Desativar ou restringir `/api/debug/whoami` em produção (ou exigir role admin / flag de env). → Em produção responde `404` salvo `DEBUG_WHOAMI_ENABLED=true`

---

## 12. PWA / cache de APIs

- [x] Revisar `runtimeCaching` no `next.config.js` para APIs com dados sensíveis (pedidos, clientes) e evitar cache indevido em dispositivo partilhado. → Removidas entradas NetworkFirst para `/api/dashboard`, `/api/orders`, `/api/reports`, `/api/whatsapp/threads` (mantidos só `_next/static` e `_next/image`).

---

## Anexo — Onde entra a *service role* do Supabase

No **código da aplicação**, a chave `SUPABASE_SERVICE_ROLE_KEY` é lida em:

| Local | Uso |
|-------|-----|
| `lib/supabase/admin.ts` | Cria o cliente Supabase com essa chave → todas as chamadas com esse cliente usam o papel **`service_role`** no Postgres (ignora RLS). |
| `middleware.ts` | Usa a mesma variável em `Authorization: Bearer` em `fetch` direto ao PostgREST (assinatura/cobrança por `company_id` no cookie). |
| `app/api/companies/create/route.ts` | Além de `createAdminClient()`, usa `SUPABASE_SERVICE_ROLE_KEY` em `fetch` para RPC. |
| `app/api/chatbot/resolve/route.ts` | Compara header interno com `SUPABASE_SERVICE_ROLE_KEY` + usa `createAdminClient()`. |
| `lib/superadmin/actions.ts` | Apenas checagem de “env preenchido” para health/diagnóstico superadmin. |

Inventário atualizado de rotas: `docs/SECURITY_CREATEADMIN_INVENTORY.md`.

Nos **scripts SQL** (`supabase/migrations/`), `service_role` aparece em `GRANT`, policies `TO service_role`, e condições `auth.role() = 'service_role'` — define o que o JWT da service role pode fazer no lado da base de dados.

---

*Última atualização: execução do checklist (código + docs + script `check:prod-env`).*
