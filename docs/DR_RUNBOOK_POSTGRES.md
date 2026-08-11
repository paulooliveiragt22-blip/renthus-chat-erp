# Runbook — Backup / Disaster Recovery do Postgres (Supabase)

Item 5 de `docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md`. Projeto: **disk bebidas**
(`zwcfuvohxmvlxhdfbgxo`, região `sa-east-1`, Postgres 17.6). Estado levantado via
`npx supabase backups list --project-ref zwcfuvohxmvlxhdfbgxo` em **2026-08-11** — não é
suposição, é o retorno real da API do Supabase pra este projeto.

---

## 1. Estado atual confirmado

```json
{
  "region": "sa-east-1",
  "walg_enabled": true,
  "pitr_enabled": false,
  "backups": [
    { "inserted_at": "2026-08-10T04:30:15Z", "status": "COMPLETED", "is_physical_backup": true },
    { "inserted_at": "2026-08-09T04:29:41Z", "status": "COMPLETED", "is_physical_backup": true },
    { "inserted_at": "2026-08-06T04:27:34Z", "status": "COMPLETED", "is_physical_backup": true },
    { "inserted_at": "2026-08-05T04:27:43Z", "status": "COMPLETED", "is_physical_backup": true }
  ]
}
```

- **Backups físicos diários (WAL-G) estão ativos** (`walg_enabled: true`) — isso só existe em
  planos pagos (Free não tem backup automático nenhum; ver seção 2). Indica plano **Pro ou
  superior**, mas o nome exato do plano não é visível por API/CLI — confirmar em
  **Dashboard → Settings → Billing → Subscription** (`⚠️ pendente de confirmação manual`).
- **PITR (Point-in-Time Recovery) está DESLIGADO** (`pitr_enabled: false`) — é add-on pago
  (~US$100/mês pra 7 dias de retenção), não incluído no Pro/Team por padrão. Sem PITR, só é
  possível restaurar para o horário exato de um dos backups diários listados, não para "qualquer
  segundo".
- **Gap encontrado nos backups**: há registro em 05/08, 06/08, depois um salto pra 09/08, 10/08 —
  faltam 07/08 e 08/08 (e nada ainainda em 11/08 na hora da consulta, à tarde — pode só não ter
  rodado ainda no dia). **Não investigado a fundo** — pode ser corte de retenção da consulta (a
  API só devolve os últimos N) ou falha real de 2 backups. Ação: conferir no
  **Dashboard → Database → Backups** se a linha do tempo visual mostra os 2 dias faltantes; se
  também faltar lá, abrir ticket de suporte Supabase.
- **Tamanho atual do banco:** 29 MB (`select pg_size_pretty(pg_database_size(current_database()))`)
  — mostra que o projeto está em estágio bem inicial (consistente com
  `.cursor/rules/projeto-pre-producao-radical.mdc`: ainda não há cliente real em produção).

---

## 2. O que os backups cobrem — e o que não cobrem

| Coberto | Não coberto |
|---|---|
| Todo o schema `public` (tabelas, RLS, functions, triggers, dados) | **Supabase Storage** (buckets) — mídia recebida do WhatsApp, comprovantes/prints do agente de impressão. Backup de banco **não inclui arquivos de Storage**, só a tabela de metadados `storage.objects` (que referencia arquivos que podem já não existir mais no restore). |
| `auth.*` (usuários, sessões) | Secrets fora do banco (env vars da Vercel, `SUPABASE_SERVICE_ROLE_KEY`, tokens do WhatsApp/Pagar.me) — esses vivem na Vercel/no seu gerenciador de senhas, não no Postgres. Perda desses não é coberta por backup de banco nenhum. |
| Extensões instaladas (`pg_cron`, `pgsodium`, `vault` etc.) | Estado de jobs agendados fora do Postgres (ex.: cron externo cron-job.org que dispara `/api/chatbot/process-queue`) — configuração externa, não banco. |

**Ação recomendada (não crítica agora, dado volume pequeno):** se/quando o volume de mídia do
WhatsApp em Storage crescer, avaliar rotina própria de export do bucket (ex.: `supabase storage
ls`/download programático) — hoje não implementada. Não é bloqueante: mídia de WhatsApp é
efêmera e re-obtível via re-envio do cliente na pior hipótese.

---

## 3. RPO / RTO — proposta (aguardando validação do dono do negócio)

Sem PITR, o **RPO real hoje é de até ~24h** (pior caso: perda entre um backup diário e o próximo,
já considerando a hipótese dos dois dias faltantes na seção 1). Isso é aceitável ou não depende de
quanto custa pro negócio perder até 1 dia de pedidos/pagamentos/saldo de cliente.

**Proposta (postura radical/pragmática, mesma lógica de
`.cursor/rules/projeto-pre-producao-radical.mdc`):**

| | Enquanto não há cliente real pagando (hoje) | A partir do 1º cliente real em produção |
|---|---|---|
| **RPO aceito** | Até 24h (backup diário padrão do plano, sem custo extra) | Reavaliar — se o negócio não tolerar perder até 1 dia de pedidos/pagamentos, comprar add-on PITR (~US$100/mês/7 dias) |
| **RTO aceito** | Algumas horas (restore manual via Dashboard + validação) | Definir SLA formal; considerar automatizar o restore/drill |
| **Justificativa** | Banco tem 29 MB, sem dado de cliente real em jogo, custo de PITR não se paga ainda | Dinheiro real de cliente (saldo devedor, pedidos, pagamentos Pagar.me) muda o cálculo de risco |

**Decisão pendente de você:** confirmar se este RPO/RTO é aceitável, ou se prefere já habilitar
PITR agora (custo mensal fixo, independente do estágio do projeto).

---

## 4. Passo a passo de restore

### Opção A — Dashboard (caminho recomendado hoje, sem PITR)

1. Acesse **Dashboard do Supabase → projeto "disk bebidas" → Database → Backups**
   (`https://supabase.com/dashboard/project/zwcfuvohxmvlxhdfbgxo/database/backups/scheduled`).
2. Escolha o backup mais recente **anterior ao incidente** na lista.
3. Clique **Restore** no backup escolhido.
4. **⚠️ Isso é destrutivo e substitui o banco atual pelo estado daquele backup** — não existe
   "restaurar numa cópia" via Dashboard nesse fluxo; se precisar inspecionar sem sobrescrever
   produção, use a Opção B com um projeto novo antes de confirmar o restore em produção.
5. Aguarde o projeto voltar a `ACTIVE_HEALTHY` (a API pausa o projeto durante o restore).
6. Pós-restore, validar antes de liberar tráfego:
   - `select max(created_at) from orders;` (confere até quando os dados foram restaurados).
   - `select count(*) from company_users;`, `select count(*) from products;` — sanity check de
     volume batendo com o esperado.
   - Rodar `npm run build`/smoke test manual no admin (login, PDV abre, pedido de teste).

### Opção B — Restaurar num projeto novo (não destrutivo, pra investigar sem risco)

1. Criar um projeto Supabase novo (mesma região `sa-east-1` de preferência).
2. Contatar suporte Supabase pra restaurar um backup físico específico nesse projeto novo (o
   Dashboard/CLI de restore direcionado a projeto *diferente* do original normalmente exige
   suporte, não é self-service simples) — ou, alternativa self-service: `pg_dump`/`pg_restore` se
   você tiver um dump lógico próprio (ver seção 5, ainda não implementado).
3. Validar os dados no projeto novo sem qualquer risco ao projeto de produção.

### Opção C — CLI (`supabase backups restore`), só funciona com PITR ligado

```bash
npx supabase backups restore --project-ref zwcfuvohxmvlxhdfbgxo --timestamp <epoch_seconds>
```

**Hoje não se aplica** — a própria CLI descreve este comando como "Restore to a specific timestamp
using PITR", e `pitr_enabled` está `false` neste projeto. Só passa a valer se o add-on PITR for
habilitado (ver seção 3).

---

## 5. Lacuna encontrada: sem export próprio (fora do Supabase)

Hoje a única cópia dos dados é o backup gerenciado pelo Supabase — não há `pg_dump` agendado nem
export pra outro provedor (S3/Backblaze/etc.). Isso significa: se a conta Supabase tiver um
problema administrativo (cobrança, suspensão, bug da plataforma), não há Plano B fora da própria
Supabase.

**Não implementado nesta entrega** (decisão a validar com você): um cron mensal/semanal de
`pg_dump` pro Storage do próprio Supabase ou pra um bucket externo seria a mitigação — mas com
29 MB de banco e sem cliente real, o custo/benefício de montar isso agora é baixo. Revisitar
quando o volume de dados/clientes crescer.

---

## 6. Responsável / on-call

**⚠️ Pendente de preencher por você** — hoje não há definição de quem seria acionado num incidente
de perda de dados (só há o dono do projeto). Preencher quando houver equipe:

| Papel | Responsável | Contato |
|---|---|---|
| Owner / decide restore | _(preencher)_ | _(preencher)_ |
| Executa restore técnico | _(preencher)_ | _(preencher)_ |

---

## 7. Restore drill — checklist (ainda não executado)

**Estado: não executado.** Um drill real de restore não foi rodado nesta entrega porque:
1. Restaurar em produção é destrutivo (Opção A) — não deveria ser o primeiro teste do processo.
2. Restaurar num projeto novo (Opção B) envolve criar um projeto Supabase novo e possivelmente
   abrir ticket de suporte — ação com custo/tempo que exige sua autorização explícita antes de eu
   executar (não vou criar projeto novo/gastar sem confirmar com você).

**Checklist pra quando for executado** (marcar aqui a data e resultado):

- [ ] Criar projeto de teste (ou usar staging, se existir).
- [ ] Restaurar o backup mais recente disponível nesse projeto de teste.
- [ ] Cronometrar o tempo total (do clique em "Restore" até o projeto voltar `ACTIVE_HEALTHY`) —
      isso é o RTO real observado, compare com a meta da seção 3.
- [ ] Validar contagem de linhas nas tabelas críticas (`orders`, `customers`, `companies`,
      `financial_entries`) contra o que era esperado no momento do backup.
- [ ] Validar que RLS/policies restauraram corretas (`select policyname from pg_policies where
      tablename = 'orders';` deve continuar mostrando só `..._service_role_only`).
- [ ] Registrar aqui: data do drill, tempo total, resultado (sucesso/falha), o que ajustar.

---

## Resumo executivo

| Pergunta | Resposta hoje |
|---|---|
| Existe backup automático? | Sim — diário, físico (WAL-G), plano pago |
| PITR ligado? | Não |
| RPO real | ~24h (pode ser pior se o gap da seção 1 for real) |
| Storage (mídia WhatsApp) tem backup? | Não |
| Drill de restore já foi feito? | Não |
| Quem é acionado num incidente? | Não definido |

Documento existe (item 5 cumprido no que é levantamento/documentação); RPO/RTO propostos aguardam
sua validação; drill formal e definição de on-call ficam como próxima ação — não bloqueiam o
restante do checklist, mas precisam de decisão sua, não são só código.
