# Checklist — PWA Offline-First (Local Command Outbox)

**Origem:** [ADR-0008](./ADR/0008-pwa-offline-first-outbox.md) (aceito 2026-09-05).  
**Implementação:** sob “implementa” / bloco por fase. Não misturar com billing (ADR-0006) nem outbox SQS (ADR-0003).

Estado: `[ ]` pendente · `[~]` parcial · `[x]` feito + data · `[!]` bloqueado (motivo).

**Predecessor (shell PWA — não reabrir do zero):** `next.config.js` (`@ducanh2912/next-pwa`), `app/offline/page.tsx`, `public/manifest.webmanifest`, exempts em `proxy.ts`.

---

## O0 — Decisões (fechar antes de mutação offline)

| # | Decisão | Ref ADR | Estado |
|---|--------|---------|--------|
| O0.1 | Arquitetura Local Command Outbox (BG Sync = transporte opcional) | D1 | [x] 2026-09-05 |
| O0.2 | Matriz de cache (shell SWR ok; estoque/crédito NetworkOnly/TTL+badge) | D3 | [x] 2026-09-05 |
| O0.3 | Optimistic com política (PDV = semi-otimista / pending) | D4 | [x] 2026-09-05 |
| O0.4 | SW update: waiting + prompt (não skipWaiting cego no PDV) | D5 | [x] 2026-09-05 (meta; código em P3) |
| O0.5 | **D-P1** escopo v1 (PDV read? + enqueue finalize? + pedidos?) | D6 | [ ] |
| O0.6 | **D-P2** estoque insuficiente no sync (rejeitar vs negativo) | D6 | [ ] |
| O0.7 | **D-P3** máx. horas / máx. comandos na fila | D6 | [ ] |
| O0.8 | **D-P4** multi-aba / idempotência concorrente | D6 | [ ] |
| O0.9 | **D-P5** Print Agent só após ACK vs rascunho local | D6 | [ ] |

> Sem O0.5–O0.9 fechados: executar **só P0** (fundações). P1+ mutação = `[!]`.

Defaults sugeridos no ADR (confirmar owner): D-P1=PDV read+enqueue finalize; D-P2=rejeitar; D-P3=24h/50; D-P4=sim; D-P5=ACK only.

---

## Fase P0 — Fundações (zero mutação de negócio)

**Objetivo:** pastas, contratos, outbox IDB, UI de status, testes — app continua 100% online-only no comportamento comercial.

| # | Item | Arquivos (add/alt) | Função | DoD | Estado |
|---|------|-------------------|--------|-----|--------|
| P0.1 | Tipos `OfflineCommand` + status machine | `+ lib/offline/domain/OfflineCommand.ts` | Contrato único de comando | Tipos exportados; status `pending\|syncing\|synced\|failed\|conflict` | [ ] |
| P0.2 | `SyncEligibility` (allowlist vazia + stubs de limite) | `+ lib/offline/domain/SyncEligibility.ts` | Quem pode entrar na fila | Allowlist `[]` ou só tipos no-op; testes | [ ] |
| P0.3 | `ConflictPolicy` stub | `+ lib/offline/domain/ConflictPolicy.ts` | Política por tipo | Map default `reject_reopen` | [ ] |
| P0.4 | Ports | `+ lib/offline/ports/{OutboxStore,SyncTransport,CatalogSnapshotStore}.ts` | Contratos hexagonais | Interfaces sem implementação de rede de negócio | [ ] |
| P0.5 | Adapter IndexedDB outbox | `+ lib/offline/adapters/idbOutboxStore.ts` | Persistência durable | enqueue/list/updateStatus/purgeSynced; teste unit | [ ] |
| P0.6 | `enqueueCommand` + `flushOutbox` (dry) | `+ lib/offline/application/{enqueueCommand,flushOutbox,applyOptimistic,resolveConflict}.ts` | Use cases | Flush com transport mock; sem chamar API real de PDV | [ ] |
| P0.7 | `httpSyncTransport` stub / no-op route opcional | `+ lib/offline/adapters/httpSyncTransport.ts` · opcional `+ app/api/offline/sync/route.ts` retornando 501 ou echo auth-only | Preparar contrato HTTP | Auth tenant; sem aplicar comando de venda | [ ] |
| P0.8 | `SyncStatusBar` + wiring layout | `+ lib/offline/presentation/SyncStatusBar.tsx` · `~` layout admin | UX “N pendentes / offline” | Visível no admin; não quebra layout | [ ] |
| P0.9 | Hook `useOfflineMutation` skeleton | `+ lib/offline/presentation/useOfflineMutation.ts` | Ponte TanStack | onMutate/onError documentados; sem call sites PDV ainda | [ ] |
| P0.10 | QueryClient: base offline-ready | `~` provider QueryClient existente | `networkMode` + (opcional) persist stubs | Sem regressão nas telas platform/billing | [ ] |
| P0.11 | Testes unitários domínio/outbox | `+ tests/offline/*.test.ts` | Não perder invariantes | `npm test` verde no subset offline | [ ] |
| P0.12 | Doc cruzada | `~ docs/ADR/0008-…` se paths divergirem | Manter ADR ↔ código | Paths reais = ADR | [ ] |

**Saída P0:** mergeável sem mudança de comportamento comercial; checklist O0.5–O0.9 ainda podem estar abertos.

---

## Fase P1 — PDV offline-read + enqueue finalize

**Pré-requisito:** O0.5–O0.9 = `[x]` (ou owner aceitar defaults do ADR por escrito nesta checklist).

| # | Item | Arquivos | Função | DoD | Estado |
|---|------|----------|--------|-----|--------|
| P1.0 | Registrar decisões D-P1…D-P5 no ADR § D6 | `~ docs/ADR/0008-…` · esta checklist O0.5–O0.9 | Gate produto | Todos `[x]` com data | [ ] |
| P1.1 | Snapshot store catálogo | `+ lib/offline/adapters/idbCatalogSnapshotStore.ts` | Leitura PDV offline | save/load por `company_id`; TTL/version | [ ] |
| P1.2 | Job/ hook de hydrate snapshot | `~ app/(admin)/pdv/page.tsx` (+ API read existente se houver) | Popular IDB quando online | PDV abre catálogo do snapshot se rede cair | [ ] |
| P1.3 | Badge “catálogo pode estar desatualizado” | `~` PDV UI · SyncStatusBar | Honestidade de cache | Visível quando snapshot age > limiar | [ ] |
| P1.4 | Migration idempotência `client_mutation_id` | `+ supabase/migrations/…_offline_client_mutation_idempotency.sql` · apply remoto MCP | Unique real | `execute_sql` confirma constraint; RLS/security checklist | [ ] |
| P1.5 | Allowlist: `FinalizePdvSale` (nome final) | `~ SyncEligibility.ts` | D-P1 | Só tipos aprovados | [ ] |
| P1.6 | API `POST /api/offline/sync` aplica batch | `~ app/api/offline/sync/route.ts` → RPC existente ou nova | Mutação canônica server | Idempotente; valida company/user; Abort/timeout | [ ] |
| P1.7 | PDV finalize → `enqueueCommand` | `~ app/(admin)/pdv/page.tsx` (+ helpers) | Semi-otimista | Offline: entra fila; UI `pending`; online: flush | [ ] |
| P1.8 | Print / cupom vs D-P5 | `~` PDV + print agent paths | Não mentir confirmação | Comportamento = decisão D-P5 | [ ] |
| P1.9 | Conflito estoque = D-P2 | `~ resolveConflict.ts` · UI PDV | Rejeitar/reabrir ou regra escolhida | Caso teste documentado | [ ] |
| P1.10 | Limites fila = D-P3 | `~ SyncEligibility.ts` · UI bloqueio | Cap horas/cmds | Nova venda bloqueada com mensagem clara | [ ] |
| P1.11 | Testes + smoke manual galpão | `+ tests/offline/pdv-*.test.ts` · nota em ADR/checklist | Regressão | Unit + roteiro manual (offline airplane mode) | [ ] |
| P1.12 | `docs/DB_CURRENT_STATE.md` | `~` | Doc schema | Coluna/constraint descrita | [ ] |

**Saída P1:** vender no PDV com rede intermitente; sync ao voltar; sem double charge (idempotência).

---

## Fase P2 — Pedidos: status optimistic + outbox

| # | Item | Arquivos | Função | DoD | Estado |
|---|------|----------|--------|-----|--------|
| P2.1 | Allowlist transições de status | `~ SyncEligibility.ts` · `ConflictPolicy.ts` | Só status “leves” | Lista explícita no ADR ou neste doc | [ ] |
| P2.2 | `useOfflineMutation` nos call sites | `~ app/(admin)/pedidos/PedidosClient.tsx` | Optimistic + pending | Rollback/toast em failed | [ ] |
| P2.3 | Sync route aceita tipos pedido | `~ app/api/offline/sync/route.ts` | Server apply | RPC/API; sem bypass RLS | [ ] |
| P2.4 | Testes transição + conflito | `+ tests/offline/pedidos-*.test.ts` | | Verde | [ ] |

**Fora P2:** alterar custo em massa, financeiro, a prazo complex — só se D-P1 expandir.

---

## Fase P3 — Service Worker polish

| # | Item | Arquivos | Função | DoD | Estado |
|---|------|----------|--------|-----|--------|
| P3.1 | Revisar `runtimeCaching` vs matriz D3 | `~ next.config.js` | Não SWR em API comercial | Patterns documentados | [ ] |
| P3.2 | Update prompt (waiting) | `~ next.config.js` · `+` componente “Nova versão” | Evitar reload mid-PDV | skipWaiting cego desligado ou gated | [ ] |
| P3.3 | Copy `/offline` alinhada a fila | `~ app/offline/page.tsx` | UX | Menciona sync/pendentes se houver | [ ] |
| P3.4 | `workboxBgSyncBridge` opcional | `+ lib/offline/adapters/workboxBgSyncBridge.ts` | Wake flush no Chrome | Feature-detect; fallback `online` | [ ] |
| P3.5 | Proxy/e2e PWA assets | `~ proxy.ts` · `~ tests/proxy.test.ts` · e2e offline se existir | Exempts corretos | Testes proxy verdes | [ ] |

---

## Fase P4 — Opcional Serwist

| # | Item | Arquivos | Função | DoD | Estado |
|---|------|----------|--------|-----|--------|
| P4.1 | Avaliar custo migração next-pwa → Serwist | doc curto no ADR ou nota aqui | Manutenção SW | Decisão go/no-go | [ ] |
| P4.2 | Se go: migrar + parity cache matrix | `~ next.config.*` · SW entry | Mesma matriz D3 | Smoke PWA + PDV | [ ] |

---

## Ordem cronológica (não pular)

```text
1. Fechar O0.1–O0.4 (já) + executar P0.1 → P0.12
2. Fechar O0.5–O0.9 (produto) ──┐
3. P1.0 registrar no ADR         ├── bloqueia P1.4+
4. P1.1 → P1.12 (PDV)
5. P2.1 → P2.4 (pedidos)
6. P3.1 → P3.5 (SW)
7. P4 só se necessário
```

**Regra anti-contexto-perdido:** a cada PR, marcar linhas `[x] YYYY-MM-DD` nesta checklist e citar o # (ex.: `P0.5`) no corpo do PR. Não abrir P1 mutação com O0.5–O0.9 em `[ ]`.

---

## Explicitamente fora (não fazer “de passagem”)

- Cachear ou enqueue billing / webhooks Pagar.me  
- Outbox browser para WhatsApp inbound/outbound (ADR-0003)  
- SWR silencioso em `estoque_atual` / `saldo_devedor` / `limite_credito`  
- Dual-path “grava local e também direto na tabela crua no client”  
- Serwist na mesma PR que P0 (exceto se P4 go explícito)

---

## Registro de confirmação de defaults (preencher)

| Decisão | Valor escolhido | Quem | Data |
|---------|-----------------|------|------|
| D-P1 | | | |
| D-P2 | | | |
| D-P3 | | | |
| D-P4 | | | |
| D-P5 | | | |
