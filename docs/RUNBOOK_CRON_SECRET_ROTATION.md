# Playbook — rotação do `CRON_SECRET` (B10)

**Decisão:** um único `CRON_SECRET` (sem split billing/ops por enquanto).

Auth canônica: `Authorization: Bearer ${CRON_SECRET}` em `lib/security/cronAuth.ts`.  
Em produção, secret ausente → **500** `server_misconfigured` (fail-closed).  
Header `x-vercel-cron: 1` é só telemetria — **nunca** autentica sozinho.

### Onde agendar (regra de ops)

| Frequência | Onde | Motivo |
|------------|------|--------|
| **≥ 1×/dia** (cron diário/mensal) | **Vercel Cron** (`vercel.json`) | Simples; Hobby aguenta |
| **&lt; 1 dia** (minutos/horas) | **AWS** (EventBridge Scheduler / Rules + `renthus-cron-bridge`) | Vercel Cron não é o lugar certo para sub-diário |

Não colocar `rate(5 minutes)` / `rate(15 minutes)` no `vercel.json`. Setup AWS: `npm run scheduler:setup` / `infra/renthus-cron-bridge` (ADR-0003).

---

## O que usa este secret

### Vercel Cron — só ≥ 1×/dia (`vercel.json`)

| Path | Schedule (UTC) |
|------|----------------|
| `/api/billing/charge` | `0 11 * * *` |
| `/api/billing/mark-abandoned` | `0 9 * * *` |
| `/api/billing/expire-trials` | `0 10 * * *` |
| `/api/billing/webhook-health` | `0 12 * * *` |
| `/api/marketplace/sync-catalog` | `0 4 * * *` |
| `/api/platform/audit/archive` | `0 5 1 * *` |

A Vercel injeta `Authorization: Bearer ${CRON_SECRET}` automaticamente quando a env existe no projeto.

> Se ainda aparecerem entradas diárias “de backup” no `vercel.json` para paths que o EventBridge já dispara em minutos (ex. detect-carts / platform alerts), preferir **só AWS** na frequência real e remover o duplicado da Vercel na próxima limpeza.

### AWS — sub-diário (EventBridge → HTTP Vercel)

Exemplos canônicos (`infra/renthus-cron-bridge`, `scripts/setup-eventbridge-scheduler.ps1`):

| Path | Expressão típica |
|------|------------------|
| `/api/chatbot/reactivate` | `rate(5 minutes)` |
| `/api/chatbot/detect-abandoned-carts` | `rate(5 minutes)` |
| `/api/platform/alerts/check` | `rate(15 minutes)` |
| Outbox reconciler (Lambda, não HTTP) | `rate(5 minutes)` — secret na role/env da Lambda se aplicável |

O Bearer vive na **EventBridge Connection** e/ou **SSM** (`/renthus/cron-bridge/cron-secret` no template do bridge) — **mesmo valor** que `CRON_SECRET` na Vercel.

### Outros consumidores (se existirem)

- cron-job.org / scheduler externo apontando para as mesmas rotas (evitar; preferir AWS)
- Scripts manuais / curl de ops

Antes de rotacionar: listar **todos** os lugares onde o valor está colado (Vercel Production + Preview + AWS Connection/SSM + 1Password/Vault).

---

## Gerar novo secret (PowerShell)

```powershell
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

Guardar o valor no cofre **antes** de colar na Vercel / AWS.

---

## Procedimento de rotação (sem dual-secret)

Janela: preferir horário de baixa carga (madrugada). Downtime esperado dos crons: **minutos** até o próximo deploy/propagação de env + update da Connection AWS.

1. **Gerar** o secret novo e guardar no cofre.
2. **Atualizar Vercel**
   - Project → Settings → Environment Variables
   - `CRON_SECRET` em **Production** (e Preview se os crons/preview usarem)
   - Não deixar o valor antigo em outro environment “esquecido”
3. **Atualizar AWS** (obrigatório se houver schedules sub-diários)
   - EventBridge Connection API key / Bearer = `Bearer <novo>`
   - SSM SecureString do cron-bridge (`CronSecretSsmPath`), se o bridge estiver ativo
   - Ou re-rodar `npm run scheduler:setup:apply` com `$env:CRON_SECRET` novo
4. **Redeploy** Production (env nova só entra em runtime novo).
   - Dashboard → Deployments → Redeploy, ou push vazio / `vercel --prod`
5. **Validar**
   - Disparo manual (substitua `HOST` e o secret):

```powershell
curl -i -X GET "https://HOST/api/platform/alerts/check" `
  -H "Authorization: Bearer SEU_CRON_SECRET_NOVO"
```

   - Esperado: **200** (ou lógica de negócio ok), não 401.
   - Com secret errado: **401**.
6. **Confirmar logs**
   - Próximo ciclo **Vercel Cron** (billing/charge etc.) — sem 401
   - Próximo ciclo **EventBridge** (5–15 min) — CloudWatch / logs da rota — sem 401
7. **Invalidar** o secret antigo no cofre (marcar como rotated) e remover de notes/Slack.

### Se algo quebrar

- Reverter `CRON_SECRET` na Vercel **e** Bearer/SSM na AWS para o valor anterior + redeploy.
- Schedulers externos: voltar o Bearer antigo até estabilizar.

Não há dual-path (“aceitar old **ou** new”) de propósito — ver `projeto-pre-producao-radical`.

---

## Checklist rápido pós-rotação

- [ ] Vercel Production atualizado + redeploy
- [ ] Preview atualizado (se aplicável)
- [ ] AWS EventBridge Connection / SSM atualizados
- [ ] curl smoke 200 com secret novo
- [ ] curl smoke 401 com secret errado
- [ ] Cofre atualizado; valor antigo descartado

---

## Frequência sugerida

- Rotação **proativa:** a cada 90 dias ou após offboarding de alguém com acesso ao dashboard.
- Rotação **imediata:** suspeita de leak, commit acidental, log com Bearer, share em chat.

---

*Referência: ADR-0003 (EventBridge), `docs/SECURITY_SERVICE_ROLE_FLOWS.md`, `docs/PLANO_BLINDAGEM_ATTACK_SURFACE_P3.md` (B10).*
