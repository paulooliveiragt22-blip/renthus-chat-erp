# Smoke Runbook - PRO Pipeline V2

Decisões de arquitetura (Hobby vs escala, wake + scheduler, limites honestos): [`CHATBOT_PROD.md`](./CHATBOT_PROD.md).

## Objetivo
Validar em ambiente real que o fluxo assíncrono do PRO V2 está saudável:
- `incoming` enfileira rápido
- `process-queue` consome sem erro
- chatbot responde sem duplicidade

## Pré-requisitos obrigatórios
- `CHATBOT_PRO_PIPELINE_V2=1`
- `CHATBOT_PRO_PIPELINE_V2_MODE=active`
- `CHATBOT_QUEUE_ENABLED=1`
- `CRON_SECRET` configurado
- `ANTHROPIC_API_KEY` válido
- `INBOUND_DEDUP_WINDOW_SECONDS` (opcional, default `20`)
- **Wake (local):** `NEXT_PUBLIC_APP_URL` (ex.: `http://localhost:3000`) ou `CHATBOT_QUEUE_WAKE_URL`; em Vercel usa-se `VERCEL_URL` automaticamente. Opcional: `CHATBOT_QUEUE_WAKE_ENABLED=0` para forçar só scheduler.
- rota `GET /api/chatbot/process-queue` acessível com header:
  - `Authorization: Bearer <CRON_SECRET>`

## Modo Hobby (sem cron por minuto)
- **Wake:** com `CHATBOT_QUEUE_ENABLED=1` e wake ligado (default), o `incoming` agenda `GET /api/chatbot/process-queue` após responder ao Meta (`after()`). Defina **`NEXT_PUBLIC_APP_URL`** (ou `CHATBOT_QUEUE_WAKE_URL` / deploy na Vercel com `VERCEL_URL`) e **`CRON_SECRET`** para o wake funcionar em dev/local.
- No plano Hobby, execute o worker manualmente:
  - chamar `GET /api/chatbot/process-queue` apos cada mensagem de teste.
- Para operação contínua no Hobby, use scheduler externo (cron-job.org/UptimeRobot) chamando:
  - método: `GET`
  - URL: `https://SEU_DOMINIO/api/chatbot/process-queue`
  - header: `Authorization: Bearer <CRON_SECRET>`
  - intervalo: `1 minuto`
- Sequência recomendada:
  1. enviar mensagem no WhatsApp
  2. chamar `process-queue` manual
  3. validar resposta no WhatsApp e status da fila
- So migrar para cron recorrente (`* * * * *`) quando mudar para Pro.

## Plano de execução (15-20 min)

### Passo 1 - Sanidade inicial
1. Verificar logs sem erro de configuração:
   - `server_misconfigured`
   - `invalid_signature`
   - `unauthorized` no `process-queue`
2. Confirmar que cron/manual consegue chamar `GET /api/chatbot/process-queue`.

**Aprovado se:**
- resposta HTTP 200
- payload com `ok: true`

---

### Passo 2 - Enfileiramento inbound
1. Enviar mensagem real no WhatsApp de teste:  
   `quero 2 heineken`
2. Verificar rapidamente:
   - webhook `incoming` respondeu 200
   - houve insert em `chatbot_queue` com `status=pending`

**Aprovado se:**
- mensagem entrou na fila em até 2s

---

### Passo 3 - Consumo da fila
1. Disparar `GET /api/chatbot/process-queue` (manual no Hobby).
2. Conferir resposta:
   - `processed >= 1`
   - `failed = 0` (ideal)
3. Conferir job processado:
   - `chatbot_queue.status = done`

**Aprovado se:**
- job sai de `pending` para `done` na primeira execução

---

### Passo 4 - Cenários críticos mínimos
Executar 3 mensagens em sequência:
1. `quero pedir` (força IA)
2. `sim` em contexto de confirmação
3. `pedido vazio` (forçar validação com falta de dados)

Conferir:
- fallback seguro em retorno inválido de IA
- confirmação explícita finaliza quando aplicável
- pedido vazio não chama finalização indevida

**Aprovado se:**
- comportamento corresponde aos testes automatizados
- sem erro 5xx

---

### Passo 5 - Duplicidade outbound
1. Repetir a mesma mensagem inbound rapidamente (2x).
2. Verificar `whatsapp_messages` outbound:
   - não repetir texto bot idêntico em janela curta
3. Verificar retorno do worker:
   - `processed=1` no cenário duplicado
   - `coalesced` pode ficar `0` (dedup no enqueue) ou `1` (coalescing no worker)
4. Verificar métrica/log:
   - `[metric] wa_incoming_dedup` quando o duplicado é barrado no webhook
   - `[metric] chatbot_process_queue` com `processed/failed/coalesced`

**Aprovado se:**
- sem duplicidade visível ao cliente

---

## Critérios de GO / NO-GO

## GO
- `processed` estável e `failed` baixo
- sem duplicidade de resposta
- sem 5xx recorrente
- tempo ponta a ponta aceitável para teste

## NO-GO
- `failed > 5%` na janela de 15 min
- erro de autorização/configuração recorrente
- duplicidade frequente de outbound
- respostas inconsistentes no fluxo de pedido

## Rollback mínimo
Se qualquer critério NO-GO ocorrer:
1. Trocar `CHATBOT_PRO_PIPELINE_V2_MODE=shadow` imediatamente.
2. Se necessário, desativar fila assíncrona:
   - `CHATBOT_QUEUE_ENABLED=0`
3. Manter coleta de logs por 30 min.
4. Abrir correção e só voltar para `active` após novo smoke completo.

## Consultas rápidas sugeridas (opcional)
- Fila pendente:
  - `select count(*) from chatbot_queue where status='pending';`
- Falhas recentes:
  - `select count(*) from chatbot_queue where status='failed' and created_at > now() - interval '15 minutes';`
- Jobs recentes:
  - `select id,status,attempts,created_at from chatbot_queue order by created_at desc limit 20;`

## Checklist pós-migração de índices (dedup/queue)
1. Aplicar migration:
   - `supabase db push`
2. Confirmar criação dos índices:
   - `select indexname from pg_indexes where tablename='chatbot_queue' and indexname like 'chatbot_queue_%dedup%';`
   - `select indexname from pg_indexes where tablename='chatbot_queue' and indexname like 'chatbot_queue_coalesce_%';`
3. Smoke rápido:
   - repetir mensagem 2x em <= 10s
   - executar `GET /api/chatbot/process-queue`
   - esperado: `processed=1` e `failed=0`

## Execução automatizada local (referência)
- Suíte usada para validar este runbook no repositório:
  - `tests/integration/chatbot-queue-e2e.test.ts`
  - `tests/pro/proPipeline.test.ts`
  - `tests/pro/proPipeline.failure-regression.test.ts`

