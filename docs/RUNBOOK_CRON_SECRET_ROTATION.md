# Playbook — rotação do `CRON_SECRET` (B10)

**Decisão:** um único `CRON_SECRET` (sem split billing/ops por enquanto).

Auth canônica: `Authorization: Bearer ${CRON_SECRET}` em `lib/security/cronAuth.ts`.  
Em produção, secret ausente → **500** `server_misconfigured` (fail-closed).  
Header `x-vercel-cron: 1` é só telemetria — **nunca** autentica sozinho.

---

## O que usa este secret

### Vercel Cron (`vercel.json`)

| Path | Schedule (UTC) |
|------|----------------|
| `/api/billing/charge` | `0 11 * * *` |
| `/api/billing/mark-abandoned` | `0 9 * * *` |
| `/api/billing/expire-trials` | `0 10 * * *` |
| `/api/billing/webhook-health` | `0 12 * * *` |
| `/api/chatbot/detect-abandoned-carts` | `10 3 * * *` |
| `/api/marketplace/sync-catalog` | `0 4 * * *` |
| `/api/platform/alerts/check` | `30 4 * * *` |
| `/api/platform/audit/archive` | `0 5 1 * *` |

A Vercel injeta `Authorization: Bearer ${CRON_SECRET}` automaticamente quando a env existe no projeto.

### Outros consumidores (se existirem)

- cron-job.org / scheduler externo apontando para as mesmas rotas
- Scripts manuais / curl de ops
- EventBridge / workers que ainda disparem HTTP com Bearer (ver ADR-0003)

Antes de rotacionar: listar **todos** os lugares onde o valor está colado (Vercel Production + Preview + schedulers externos + 1Password/Vault).

---

## Gerar novo secret (PowerShell)

```powershell
-join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

Guardar o valor no cofre **antes** de colar na Vercel.

---

## Procedimento de rotação (sem dual-secret)

Janela: preferir horário de baixa carga (madrugada). Downtime esperado dos crons: **minutos** até o próximo deploy/propagação de env.

1. **Gerar** o secret novo e guardar no cofre.
2. **Atualizar Vercel**
   - Project → Settings → Environment Variables
   - `CRON_SECRET` em **Production** (e Preview se os crons/preview usarem)
   - Não deixar o valor antigo em outro environment “esquecido”
3. **Atualizar schedulers externos** (se houver) com o mesmo Bearer novo — **antes** ou **no mesmo minuto** do redeploy.
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
6. **Confirmar logs** do próximo ciclo Vercel Cron (billing/charge etc.) — sem 401 em massa.
7. **Invalidar** o secret antigo no cofre (marcar como rotated) e remover de notes/Slack.

### Se algo quebrar

- Reverter `CRON_SECRET` na Vercel para o valor anterior + redeploy.
- Schedulers externos: voltar o Bearer antigo até estabilizar.

Não há dual-path (“aceitar old **ou** new”) de propósito — ver `projeto-pre-producao-radical`.

---

## Checklist rápido pós-rotação

- [ ] Vercel Production atualizado + redeploy
- [ ] Preview atualizado (se aplicável)
- [ ] cron-job.org / externos atualizados
- [ ] curl smoke 200 com secret novo
- [ ] curl smoke 401 com secret errado
- [ ] Cofre atualizado; valor antigo descartado

---

## Frequência sugerida

- Rotação **proativa:** a cada 90 dias ou após offboarding de alguém com acesso ao dashboard.
- Rotação **imediata:** suspeita de leak, commit acidental, log com Bearer, share em chat.

---

*Referência: `docs/SECURITY_SERVICE_ROLE_FLOWS.md`, `docs/PLANO_BLINDAGEM_ATTACK_SURFACE_P3.md` (B10).*
