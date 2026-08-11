# Plano: Supabase pooling/paralelismo/agendamento para picos de pedidos simultâneos (chatbot)

Documento de execução. Origem: chat "pra que serve o pooling do Supabase / como turbinar o chatbot
pra picos" (2026-08-11). Diagnóstico completo (achados de código + SQL real do projeto) não é
repetido aqui — está no histórico daquele chat. Este documento é só o plano de implementação.

**Status:** ⬜ Nenhuma fase iniciada. Aguardando aprovação/comando explícito por fase (protocolo de
2 fases da regra `arquitetura-lider`).

**Vinculado a:** [`CHECKLIST_ARCH_PRO_SCALE.md`](./CHECKLIST_ARCH_PRO_SCALE.md) — nova seção "P3 —
Infra Supabase / paralelismo para picos" aponta pra este documento, mesmo padrão de
[`EVIDENCE_CHECKLIST_P14.md`](./EVIDENCE_CHECKLIST_P14.md).

---

## 0. Regras de execução (leia antes de cada sessão)

1. **Uma fase por vez, até `npm test` verde.** Não abrir a fase N+1 com a fase N em `🔄`.
2. **Fase 0 é operacional (dashboard Supabase), não é commit de código** — trate como
   pré-requisito, não como "opcional pra depois". Sem ela, `CHATBOT_QUEUE_CONCURRENCY` acima de
   ~3 (Fase 3) pode estourar `max_connections` num pico real.
3. **Migrations:** aplicar no remoto no mesmo commit (regra `supabase-migrations.mdc`), via MCP
   `user-supabase` ou `npx supabase db push --linked --yes`. **Nunca commitar secret em texto
   plano numa migration** — `CRON_SECRET` vai para o Supabase Vault via `execute_sql`/dashboard,
   fora do arquivo versionado (a migration só referencia o *nome* do secret).
4. **Fases 1–2 não mudam comportamento em produção** (funções puras novas, sem import no worker
   ainda). Comportamento muda de fato só a partir da Fase 3.
5. **Ao retomar sessão perdida:** leia a Seção 6 (contexto de retomada) antes de mexer em código.

---

## 1. Inventário — arquivos por fase (visão geral)

| Fase | Arquivos tocados | Muda comportamento? |
|---|---|---|
| 0 | Nenhum (Dashboard Supabase: Compute Add-on + Connection Pooling) | Não (infra) |
| 1 | `lib/chatbot/queueTypes.ts` (novo) | Não (só tipos) |
| 2 | `lib/chatbot/groupQueueJobsByThread.ts` (novo), `lib/chatbot/concurrencyLimit.ts` (novo) + testes | Não (funções puras aditivas, sem consumidor ainda) |
| 3 | `app/api/chatbot/process-queue/route.ts`, `tests/integration/chatbot-queue-e2e.test.ts` | **Sim** — paralelismo real no worker |
| 4 | 1 migration nova (`pg_cron` + `pg_net`) + Vault (dashboard) | **Sim** — drenagem passa a ter batimento fixo |
| 5 | `docs/CHATBOT_PROD.md`, `docs/CHECKLIST_ARCH_PRO_SCALE.md` | Não (documentação) |

Fora de escopo nesta rodada (Seção 4): migrar `chatbot_queue` para `pgmq`; enxugar
`app/api/whatsapp/incoming/route.ts` para mover parsing pro worker.

---

## 2. Fases

### Fase 0 — Infra Supabase (pré-requisito, sem código)

**Objetivo:** dar margem de conexão real antes de aumentar concorrência no worker.

- [ ] **Compute Add-on** (Dashboard → Settings → Compute): confirmar/subir tier. Hoje
  `max_connections = 60` (confirmado via SQL nesta sessão) — pouco para PostgREST + Realtime +
  admin + picos do worker somados.
- [ ] **Connection Pooling** (Dashboard → Settings → Database → Connection Pooling): revisar
  **Pool Size** do Supavisor (modo *Transaction*, porta 6543) — pode subir sem mudar de tier, até
  o teto do compute atual.
- [ ] Registrar aqui o novo `max_connections` e Pool Size depois de aplicado (linha na Seção
  "Registo de execução").
- **Critério de pronto:** `select setting from pg_settings where name = 'max_connections';` mostra
  valor novo (se subiu o tier) e o Pool Size está documentado.
- **Não tocar:** nenhum arquivo do repo.

---

### Fase 1 — Tipos (`queueTypes.ts`) — contrato puro, zero lógica

**Objetivo:** o `job: any` de `processJob` em `process-queue/route.ts` (linha 368-371) e o `any`
implícito em `claimed.map((r: any) => r.id)` (linha 115) ganham tipo — pré-requisito pra escrever
as funções puras da Fase 2 com segurança, sem tocar ainda no route.

- [ ] Novo `lib/chatbot/queueTypes.ts`:

```ts
export interface ChatbotQueueJobRow {
    id: string;
    company_id: string;
    thread_id: string;
    phone_e164: string;
    message_id: string | null;
    body_text: string;
    profile_name: string | null;
    messaging_channel: "whatsapp" | "instagram" | "messenger" | null;
    channel_user_id: string | null;
    attempts: number;
    created_at?: string;
    scheduled_at?: string;
    metadata: { message_type?: string | null } | null;
}

export interface QueueBatchOutcome {
    processed: number;
    failed: number;
    coalesced: number;
}
```

- **Critério de pronto:** `npm test` compila sem erro. Nenhum arquivo existente importa o tipo
  ainda (aditivo puro).
- **Não tocar:** `process-queue/route.ts` (isso é Fase 3).

---

### Fase 2 — Funções puras de agrupamento/concorrência (sem consumidor ainda)

**Objetivo:** ter as duas peças que a Fase 3 vai conectar, testadas isoladamente antes de tocar no
worker real.

- [ ] `lib/chatbot/groupQueueJobsByThread.ts`: agrupa um array já intercalado por empresa
  (`interleaveQueueJobsByCompany`) em *buckets* por `thread_id`, preservando a ordem relativa
  dentro de cada bucket (garante que jobs da mesma conversa continuem sequenciais mesmo se um dia
  o claim SQL devolver 2 jobs pendentes da mesma thread no mesmo lote).

```ts
import type { ChatbotQueueJobRow } from "./queueTypes";

export function groupQueueJobsByThread<T extends Pick<ChatbotQueueJobRow, "thread_id">>(
    jobs: T[]
): T[][] {
    const order: string[] = [];
    const buckets = new Map<string, T[]>();
    for (const job of jobs) {
        const key = job.thread_id || `__no_thread_${buckets.size}`;
        if (!buckets.has(key)) {
            buckets.set(key, []);
            order.push(key);
        }
        buckets.get(key)!.push(job);
    }
    return order.map((key) => buckets.get(key)!);
}
```

- [ ] `lib/chatbot/concurrencyLimit.ts`: limitador simples sem dependência nova (não há `p-limit`
  no `package.json` — checado nesta sessão).

```ts
export async function runWithConcurrencyLimit<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>
): Promise<void> {
    const cap = Math.max(1, Math.floor(limit));
    let cursor = 0;
    async function runNext(): Promise<void> {
        const index = cursor++;
        if (index >= items.length) return;
        await worker(items[index], index);
        return runNext();
    }
    await Promise.all(Array.from({ length: Math.min(cap, items.length) }, () => runNext()));
}
```

- [ ] Testes novos:
  - `tests/chatbot/groupQueueJobsByThread.test.ts`: ordem preservada dentro do bucket; threads
    diferentes geram buckets diferentes; `thread_id` nulo/vazio não junta jobs de conversas
    diferentes no mesmo bucket.
  - `tests/chatbot/concurrencyLimit.test.ts`: nunca mais que `limit` workers ativos ao mesmo tempo
    (contador de picos via mock com `setTimeout`); todos os itens são processados; erro em um item
    não aborta os demais que já estão em voo (usar `Promise.allSettled` internamente se este
    requisito for confirmado como necessário — decidir na implementação, não travar o design agora
    por antecipação).
- **Critério de pronto:** `npm test` verde. Nenhum import novo em `process-queue/route.ts`.
- **Não tocar:** `process-queue/route.ts` (Fase 3).

---

### Fase 3 — Paralelizar o worker por thread (aqui o comportamento muda de verdade)

**Objetivo:** jobs de threads/empresas diferentes claimados no mesmo lote passam a processar em
paralelo (limitado), em vez do `for` sequencial atual. Jobs da mesma thread continuam 100%
sequenciais (usa o bucket da Fase 2) — sem risco novo de race no estado da conversa/carrinho.

**Por que é seguro:** o claim RPC (`claim_chatbot_queue_jobs`,
`supabase/migrations/20260805100000_claim_chatbot_queue_jobs_fair_company.sql`) já **exclui**
jobs cujo `thread_id` tenha outro job `processing` — a garantia de "nunca 2 processing na mesma
thread ao mesmo tempo" já existe no banco. Paralelizar por thread só usa essa garantia que já
existia; não é gambiarra nova.

- [ ] `app/api/chatbot/process-queue/route.ts`:
  - Import novo: `groupQueueJobsByThread`, `runWithConcurrencyLimit`, tipo `ChatbotQueueJobRow`.
  - Nova env: `CHATBOT_QUEUE_CONCURRENCY` (helper `getPositiveIntEnv`, já existe na linha 40-46),
    default sugerido **3** (chute inicial — calibrar depois da Fase 0, ver Seção 5 riscos).
  - Extrair o corpo do `for` principal (linhas 148-212) para uma função nomeada
    `processQueueJobEntry(admin, job, seenInBatch, counters)` que faz coalesce → `processJob` →
    `done`/retry — comportamento **idêntico** ao atual, só isolado em função pra reuso.
  - No `GET` (após `interleaveQueueJobsByCompany`, linha 141): trocar o `for` por
    `runWithConcurrencyLimit(groupQueueJobsByThread(jobList), CHATBOT_QUEUE_CONCURRENCY, async (bucket) => { for (const job of bucket) await processQueueJobEntry(...); })`.
  - Mesma troca em `runFallbackProcessing` (linhas 287-359) — mesma função `processQueueJobEntry`
    reaproveitada, sem duplicar lógica de coalesce/retry entre os dois caminhos.
  - `job: any` (linha 370) e `claimed.map((r: any) => r.id)` (linha 115) trocam para
    `ChatbotQueueJobRow` / tipo inferido do RPC.
  - **Nota de design (registrar, não é bug):** `seenInBatch` (coalescing) passa a ser
    lido/escrito intercalado entre buckets concorrentes — o efeito prático (evitar duplicar
    processamento do mesmo texto na mesma janela) continua válido; a ordem exata de quem "vence"
    o coalesce entre duas threads diferentes não importa (são conversas diferentes).
- [ ] `tests/integration/chatbot-queue-e2e.test.ts`: novo caso — 2 jobs de **threads/empresas
  diferentes**, mock de `processInboundMessage` com delay artificial (`await new Promise(r =>
  setTimeout(r, 50))`), assert que o tempo total do `processQueueGet` é **~1x** o delay (paralelo),
  não ~2x (sequencial) — prova real de paralelismo, não só contagem de `processed`. Os 2 testes
  existentes (linha 202-309) continuam verdes sem alteração de asserts.
- [ ] Novo teste dedicado (ou ampliar o e2e): 2 jobs pendentes da **mesma thread** no mesmo lote
  (simulando o caso raro descrito na Fase 2) continuam processados em ordem, nunca em paralelo
  entre si.
- **Critério de pronto:** `npm test` verde; teste de timing novo passando; nenhuma regressão nos
  2 testes de integração existentes.

---

### Fase 4 — `pg_cron` + `pg_net`: drenagem com batimento fixo (reduz tempestade de self-wake)

**Objetivo:** hoje cada enqueue dispara um `fetch` HTTP pro próprio worker
(`lib/chatbot/queueWorkerWake.ts`), com auto-drain recursivo (profundidade até
`CHATBOT_QUEUE_DRAIN_MAX`, default 5). Em pico isso pode gerar várias invocações concorrentes do
worker batendo no PostgREST ao mesmo tempo — não é bug de correção (o claim RPC particiona certo),
é ineficiência de recursos. `pg_cron` dá uma drenagem previsível de dentro do banco, complementar
ao wake (que continua cobrindo a latência do "primeiro job").

- [ ] Confirmar extensões disponíveis (já checado nesta sessão via MCP `user-supabase`): `pg_cron`
  1.6.4 e `pg_net` 0.19.5 (este já **instalado**, schema `extensions`).
- [ ] **Fora da migration, via `execute_sql`/dashboard** (nunca versionar o valor em texto plano):
  `select vault.create_secret('<valor real do CRON_SECRET>', 'chatbot_queue_cron_secret');`
- [ ] Migration nova `supabase/migrations/<timestamp>_pg_cron_chatbot_queue_drain.sql`:

```sql
create extension if not exists pg_cron;

select cron.schedule(
    'chatbot-queue-drain',
    '10 seconds',
    $$
    select net.http_post(
        url := '<APP_URL>/api/chatbot/process-queue',
        headers := jsonb_build_object(
            'authorization',
            'Bearer ' || (
                select decrypted_secret
                from vault.decrypted_secrets
                where name = 'chatbot_queue_cron_secret'
            )
        )
    );
    $$
);
```

  `<APP_URL>` = mesma origem já usada em `CHATBOT_QUEUE_WAKE_URL`/`APP_INTERNAL_URL` — decidir na
  implementação se vem hardcoded na migration (domínio de produção é estável) ou lido de uma
  `app.settings` custom (mais indireção, avaliar se compensa).
- [ ] Aplicar no remoto (regra `supabase-migrations.mdc`) e confirmar:
  `select * from cron.job;` (job ativo) e `select * from cron.job_run_details order by start_time desc limit 5;` (execuções OK, sem erro).
- [ ] Decisão operacional a registrar (não é código): com cron de 10s ativo, avaliar se reduz
  `CHATBOT_QUEUE_DRAIN_MAX` (menos self-wake recursivo) ou desliga
  `CHATBOT_QUEUE_WAKE_ENABLED` — **não fazer nesta fase sem dado real de produção**, registrar
  como próximo passo observacional.
- **Critério de pronto:** job aparece em `cron.job`, execuções recentes sem erro em
  `cron.job_run_details`. Nenhum `.ts` alterado nesta fase.

---

### Fase 5 — Documentação cruzada

- [ ] `docs/CHATBOT_PROD.md`: nova env `CHATBOT_QUEUE_CONCURRENCY` na tabela de variáveis (perto de
  `CHATBOT_QUEUE_MAX_PER_COMPANY`, linha ~319); seção "Fluxo canónico" ganha nota sobre o cron de
  drenagem (linhas 37-39, ao lado de wake/self-wake/reclaim já documentados).
- [ ] `docs/CHECKLIST_ARCH_PRO_SCALE.md`: marcar os itens da nova seção "P3" (ver Seção 3 abaixo)
  conforme cada fase fechar, igual ao padrão já usado em P0-P2.
- **Critério de pronto:** docs refletem exatamente o que está em produção, sem menção a mecanismo
  removido/alterado deixada pra trás.

---

## 3. Entrada correspondente em `CHECKLIST_ARCH_PRO_SCALE.md`

Adicionar (Fase 5) a seção:

```markdown
## P3 — Infra Supabase / paralelismo para picos

| # | Item | Estado | Notas |
|---|------|--------|--------|
| P3.1 | Compute add-on + Pool Size Supavisor revisados para o volume esperado | [ ] | Plano: `PLANO_ESCALA_PICOS_PEDIDOS.md` Fase 0 |
| P3.2 | Paralelismo por thread no worker (`CHATBOT_QUEUE_CONCURRENCY`) | [ ] | Fase 3 — seguro por design (claim já isola thread `processing`) |
| P3.3 | `pg_cron` + `pg_net` drenando a fila em batimento fixo | [ ] | Fase 4 |
```

---

## 4. O que fica fora de escopo aqui (não abrir sem métrica/pedido novo)

- **Migrar `chatbot_queue` para `pgmq`:** extensão disponível (não instalada) e traria DLQ/métricas
  nativas, mas exigiria reescrever claim/coalesce/fairness por empresa (hoje SQL customizado) e
  todos os pontos que leem a tabela direto (`process-queue/route.ts`, `cleanupOldJobs`,
  `emitQueueMetrics`, testes de integração). Risco/esforço alto frente ao ganho incremental das
  Fases 1-4. Reabrir só se dado real (`pg_stat_statements`, métricas do worker) mostrar que o
  desenho tabela + `SKIP LOCKED` é o gargalo, não a falta de paralelismo/agendamento.
- **Enxugar `app/api/whatsapp/incoming/route.ts`** (mover parsing de `processIncomingEntries`,
  linha 221+, pro worker, guardando payload bruto em nova coluna `chatbot_queue.raw_payload`):
  maior risco (reescreve o parsing síncrono todo) e sem evidência hoje de timeout do webhook no
  Meta. Não abrir sem esse sinal.
- **Read Replicas:** útil se leitura administrativa (dashboard/relatórios) começar a disputar
  recursos com escrita de pedidos — sem esse sinal hoje (volume de fila é baixo: 9 jobs `done` no
  total, checado nesta sessão). Requer plano Pro+.
- **Redis/broker externo para teto de IA multi-réplica:** já registrado como adiado em
  `CHATBOT_PROD.md` (linha 234) e `CHECKLIST_ARCH_PRO_SCALE.md` (P2p.4) — não é escopo deste plano.

---

## 5. Riscos aceitos (registrados, não bloqueiam)

- `CHATBOT_QUEUE_CONCURRENCY = 3` (Fase 3) é um chute inicial sem dado de carga real — calibrar
  depois via `emitQueueMetrics` (métricas já emitidas pelo worker) e `pg_stat_statements`. Subir é
  1 env var, não redeploy de lógica.
- Job de `pg_cron` a cada 10s (Fase 4) soma mais um caller ao PostgREST/DB — negligível frente ao
  ganho de previsibilidade, mas conta no orçamento de conexões se a Fase 0 não tiver subido o
  compute.
- Depender de `<APP_URL>` hardcoded na migration do cron (Fase 4) é um acoplamento a decidir na
  implementação — alternativa (`app.settings` customizado) adiciona indireção; escolher o mais
  simples que resolva, documentar a escolha real no commit.

---

## 6. Contexto para retomada rápida (se a sessão cair)

1. Leia este arquivo, Seção 2, ache a última fase marcada `🔄` ou a primeira `⬜`.
2. `git log --oneline -20` — cada fase = 1+ commits.
3. **Achado que motivou este plano** (não redebater): `max_connections = 60` no projeto (confirmado
   via SQL, MCP `user-supabase`, 2026-08-11); o `for` sequencial em
   `app/api/chatbot/process-queue/route.ts` (linha ~148) processa jobs de threads/empresas
   diferentes um por vez mesmo sendo independentes; o claim RPC já garante que 2 jobs da mesma
   thread nunca ficam `processing` ao mesmo tempo — por isso paralelizar por thread é seguro sem
   redesenho de estado.
4. Não reabrir a discussão de infraestrutura geral (o que é pooling, Supavisor Transaction vs
   Session vs Direct) — já respondida no chat de origem. Este documento é só execução.
5. `pgmq`/`pg_cron` estão **disponíveis no projeto mas não instalados** (checado via
   `list_extensions`); `pg_net` já está instalado. Não assumir que já existem jobs de cron rodando
   antes de checar `select * from cron.job;`.

---

## Registo de execução

| Data | Itens |
|------|--------|
| 2026-08-11 | Documento criado (Fase 0-5 planejadas, nenhuma executada) |
