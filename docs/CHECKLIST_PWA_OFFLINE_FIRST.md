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
| O0.4 | SW update: waiting + prompt (não skipWaiting cego no PDV) | D5 / Perf-A | [x] 2026-09-05 (meta; código em P3) |
| O0.5 | **D-P1** escopo = catálogo + finalize PDV + status pedidos (entrega P1→P2) | D6 | [x] 2026-09-05 owner |
| O0.6 | **D-P2** sync estoque = `vender_com_estoque_zero` (stockPolicy) | D6 | [x] 2026-09-05 owner |
| O0.7 | **D-P3** máx. fila **24h / 200** cmds | D6 | [x] 2026-09-05 owner |
| O0.8 | **D-P4** multi-aba + `client_mutation_id` único | D6 | [x] 2026-09-05 owner |
| O0.9 | **D-P5** print local + Local Print Bus (anti-reimpressão no sync) | D6 | [x] 2026-09-05 owner |
| O0.10 | Performance D7 (Perf-1…5 obrigatório; A–D só com dor) | D7 | [x] 2026-09-05 ADR |

> O0.5–O0.9 **fechados 2026-09-05**. P1+ liberado sob ADR-0008 D6 (Local Print Bus em P1; status pedidos em P2).

Defaults antigos do ADR (50 cmds / ACK-only print) **supersedidos** pelas decisões do owner acima.

---

## Fase P0 — Fundações (zero mutação de negócio)

**Objetivo:** pastas, contratos, outbox IDB, UI de status, testes — app continua 100% online-only no comportamento comercial.

| # | Item | Arquivos (add/alt) | Função | DoD | Estado |
|---|------|-------------------|--------|-----|--------|
| P0.1 | Tipos `OfflineCommand` + status machine | `+ lib/offline/domain/OfflineCommand.ts` | Contrato único de comando | Tipos exportados; status `pending\|syncing\|synced\|failed\|conflict` | [x] 2026-09-05 |
| P0.2 | `SyncEligibility` (allowlist vazia + stubs de limite) | `+ lib/offline/domain/SyncEligibility.ts` | Quem pode entrar na fila | Allowlist `noop` só; testes | [x] 2026-09-05 |
| P0.3 | `ConflictPolicy` stub | `+ lib/offline/domain/ConflictPolicy.ts` | Política por tipo | Map default `reject_reopen` | [x] 2026-09-05 |
| P0.4 | Ports | `+ lib/offline/ports/{OutboxStore,SyncTransport,CatalogSnapshotStore}.ts` | Contratos hexagonais | Interfaces sem implementação de rede de negócio | [x] 2026-09-05 |
| P0.5 | Adapter IndexedDB outbox | `+ lib/offline/adapters/idbOutboxStore.ts` · `memoryOutboxStore.ts` | Persistência durable | enqueue/list/updateStatus/purgeSynced; teste unit (memory) | [x] 2026-09-05 |
| P0.6 | `enqueueCommand` + `flushOutbox` (dry, **batch**) | `+ lib/offline/application/{enqueueCommand,flushOutbox,applyOptimistic,resolveConflict}.ts` | Use cases; Perf-3 | Flush mock em lote; sem API real de PDV | [x] 2026-09-05 |
| P0.7 | `httpSyncTransport` stub batch / route opcional | `+ lib/offline/adapters/httpSyncTransport.ts` · `+ app/api/offline/sync/route.ts` 501 auth-only | Contrato HTTP lote (Perf-3) | Auth tenant; sem aplicar venda | [x] 2026-09-05 |
| P0.8 | `SyncStatusBar` + wiring layout | `+ lib/offline/presentation/SyncStatusBar.tsx` · `~` AdminShell | UX “N pendentes / offline” | Visível no admin; não quebra layout | [x] 2026-09-05 |
| P0.9 | Hook `useOfflineMutation` skeleton | `+ lib/offline/presentation/useOfflineMutation.ts` | Ponte TanStack | Skeleton + helpers optimistic; sem call sites PDV | [x] 2026-09-05 |
| P0.10 | QueryClient: offline-ready + **persist allowlist stub** | `+ createAppQueryClient.ts` · `~` Providers | Perf-4 | Sem persist global; networkMode online | [x] 2026-09-05 |
| P0.11 | Testes unitários domínio/outbox | `+ tests/offline/outbox.test.ts` | Não perder invariantes | Subset offline verde | [x] 2026-09-05 |
| P0.12 | Doc cruzada | `~ docs/ADR/0008-…` paths extras | Manter ADR ↔ código | Paths reais = ADR | [x] 2026-09-05 |

**Saída P0:** mergeável sem mudança de comportamento comercial; checklist O0.5–O0.9 ainda podem estar abertos. **P0 concluído 2026-09-05.**

---

## Fase P1 — PDV offline-read + enqueue finalize

**Pré-requisito:** O0.5–O0.9 = `[x]` (fechado 2026-09-05).

| # | Item | Arquivos | Função | DoD | Estado |
|---|------|----------|--------|-----|--------|
| P1.0 | Registrar decisões D-P1…D-P5 no ADR § D6 | `~ docs/ADR/0008-…` · esta checklist O0.5–O0.9 | Gate produto | Todos `[x]` com data | [x] 2026-09-05 |
| P1.1 | Snapshot store catálogo **enxuto** | `+ lib/offline/adapters/idbCatalogSnapshotStore.ts` | Perf-1: teto + projection | save/load por `company_id`; TTL/version; sem dump ilimitado | [x] 2026-09-05 |
| P1.1b | Índice busca/bipagem no snapshot | `+ lib/offline/application/buildCatalogSearchIndex.ts` · `~` PDV | Perf-2 | Lookup EAN/código/nome sem filter full-scan a cada tecla | [x] 2026-09-05 |
| P1.2 | Job/ hook de hydrate snapshot | `~ app/(admin)/pdv/page.tsx` · `+ /api/admin/pdv/catalog-snapshot` | Popular IDB quando online | PDV abre catálogo do snapshot se rede cair | [x] 2026-09-05 |
| P1.3 | Badge “catálogo pode estar desatualizado” | `~` PDV UI · SyncStatusBar | Honestidade de cache (Perf-5 vibe) | Visível quando snapshot age > limiar | [x] 2026-09-05 |
| P1.4 | Idempotência offline = `client_mutation_id` → `sales.idempotency_key` (unique já existe) | reuse `20260811110000_pdv_finalize_idempotency_key.sql` · doc DB | Unique real | Sem migration nova; UUID do outbox vira idempotency_key | [x] 2026-09-05 |
| P1.5 | Allowlist: `FinalizePdvSale` | `~ SyncEligibility.ts` | D-P1 | FinalizePdvSale + noop | [x] 2026-09-05 |
| P1.6 | API `POST /api/offline/sync` aplica **batch** | `~ app/api/offline/sync/route.ts` · `applyFinalizePdvOrder` | Perf-3 + mutação canônica | Idempotente; teto cmds/request; stockPolicy | [x] 2026-09-05 |
| P1.7 | PDV finalize → `enqueueCommand` | `~ app/(admin)/pdv/page.tsx` | Semi-otimista | Offline: entra fila; UI pending; online: flush | [x] 2026-09-05 |
| P1.8 | D-P5 Local Print Bus | `+` localPrintBridge · `rpc_record_offline_print_done` · sync printIntent | Anti-enxurrada | Já impresso → print_jobs `done` + unique client_print_id | [x] 2026-09-05 |
| P1.9 | Conflito estoque = D-P2 (`vender_com_estoque_zero` / stockPolicy) | `~ applyFinalizePdvOrder.ts` | Aceita se flag permite; senão 409 conflict | Enforced no sync/finalize | [x] 2026-09-05 |
| P1.10 | Limites fila = D-P3 (**24h / 200**) | `~ SyncEligibility.ts` · UI PDV | Cap horas/cmds | 200 default; mensagem fila cheia | [x] 2026-09-05 |
| P1.11 | Testes + smoke manual galpão | `+ tests/offline/*.test.ts` | Regressão | Unit offline verde | [x] 2026-09-05 |
| P1.12 | `docs/DB_CURRENT_STATE.md` | `~` | Doc schema | Nota offline→idempotency_key + client_print_id | [x] 2026-09-05 |

**Ordem de execução P1:** `1.0 → … → 1.7 → **1.8** → 1.9 → … → 1.12` (cronologia ADR).

**Saída P1 completa:** vender offline + sync + Local Print Bus.

---

## Fase P2 — Pedidos: status optimistic + outbox

| # | Item | Arquivos | Função | DoD | Estado |
|---|------|----------|--------|-----|--------|
| P2.1 | Allowlist transições de status | `~ SyncEligibility.ts` · preparing/delivered | Só status “leves” | finalize/cancel online-only | [x] 2026-09-05 |
| P2.2 | `useOfflineMutation` / enqueue nos call sites | `~ PedidosClient.tsx` applyOrderStatus | Optimistic + pending | Rollback se enqueue falha | [x] 2026-09-05 |
| P2.3 | Sync route aceita tipos pedido | `~ app/api/offline/sync/route.ts` · applyUpdateOrderStatus | Server apply | RPC set status | [x] 2026-09-05 |
| P2.4 | Testes transição | `+ tests/offline/orderStatus.test.ts` | | Verde | [x] 2026-09-05 |

**Fora P2:** alterar custo em massa, financeiro, a prazo complex — só se D-P1 expandir.

---

## Fase P3 — Service Worker polish

| # | Item | Arquivos | Função | DoD | Estado |
|---|------|----------|--------|-----|--------|
| P3.1 | Revisar `runtimeCaching` vs matriz D3 + Perf-5 | `~ next.config.js` | Não SWR em API comercial | NetworkOnly `/api/*` + exclude | [x] 2026-09-05 |
| P3.2 | Update prompt (waiting) — Perf-A | `skipWaiting:false` · `PwaUpdateBanner` | Evitar reload mid-PDV | Banner Atualizar/Depois | [x] 2026-09-05 |
| P3.3 | Copy `/offline` alinhada a fila | `~ app/offline/page.tsx` | UX | Menciona fila/PDV cache | [x] 2026-09-05 |
| P3.4 | `workboxBgSyncBridge` | `+ workboxBgSyncBridge.ts` · AdminShell wake | Wake flush online/visibility + SyncManager se houver | [x] 2026-09-05 |
| P3.5 | Proxy/e2e PWA assets | `~ tests/proxy.test.ts` | Exempts corretos; `/api/offline/sync` não é public | [x] 2026-09-05 |
| P3.6 | Timeout NetworkFirst 4s — Perf-B | `~ next.config.js` | PDV não “pende” 8s | [x] 2026-09-05 |

---

## Fase P4 — Opcional Serwist

| # | Item | Arquivos | Função | DoD | Estado |
|---|------|----------|--------|-----|--------|
| P4.1 | Avaliar custo migração next-pwa → Serwist (Perf-D) | nota abaixo | Manutenção SW, não speed | **no-go agora** — next-pwa atende matriz D3 | [x] 2026-09-05 |
| P4.2 | Se go: migrar + parity cache matrix | — | — | Adiado até dor de manutenção Workbox | [ ] n/a |

**P4 decisão (2026-09-05):** manter `@ducanh2912/next-pwa`. Serwist só se o plugin ficar abandonado ou bloquear Turbopack/build.

---

## Ordem cronológica (não pular)

```text
1–4. P0 → P2 entregues
5. P3.1 → P3.6 (SW polish) entregue
6. P4 no-go (ficar no next-pwa) até nova dor
```

**Regra anti-contexto-perdido:** a cada PR, marcar linhas `[x] YYYY-MM-DD` nesta checklist e citar o # (ex.: `P0.5`, `Perf-3`) no corpo do PR. Não abrir P1 mutação com O0.5–O0.9 em `[ ]`. P1 sem Perf-1…5 = incompleto.

---

## Hotfix pós-smoke (2026-09-05)

| # | Item | Estado |
|---|------|--------|
| HF.1 | Finalize PDV: fallback outbox se `Failed to fetch` (`navigator.onLine` mente no Windows) | [x] código local — redeploy |
| HF.2 | `planFeatures` em **localStorage** (TTL 48h) + gate fail-soft offline (não mostrar “upgrade”) | [x] código local — redeploy |

**Não confundir:** docs de rate-limit “in-memory → Upstash” (`rateLimitDistributed`, INFRA-1) são **servidor** (Redis). Não substituem cache de entitlements/UI no browser da PWA.

---

## Explicitamente fora (não fazer “de passagem”)

- Cachear ou enqueue billing / webhooks Pagar.me  
- Outbox browser para WhatsApp inbound/outbound (ADR-0003)  
- SWR silencioso em `estoque_atual` / `saldo_devedor` / `limite_credito` (Perf-5 / D7.3)  
- Dual-path “grava local e também direto na tabela crua no client”  
- Persist global do TanStack Query (Perf-4)  
- Snapshot ilimitado / busca full-scan (Perf-1/2)  
- Flush 1 POST por comando (Perf-3)  
- Virtualização/prefetch agressivo / Serwist “por performance” na mesma PR que P0  
- Serwist na mesma PR que P0 (exceto se P4 go explícito)

---

## Registro de confirmação de defaults (preencher)

| Decisão | Valor escolhido | Quem | Data |
|---------|-----------------|------|------|
| D-P1 | Catálogo + finalize PDV + status pedidos (P1→P2) | owner | 2026-09-05 |
| D-P2 | Por produto: `vender_com_estoque_zero` / stockPolicy | owner | 2026-09-05 |
| D-P3 | 24h / 200 comandos | owner | 2026-09-05 |
| D-P4 | Sim, concorrente + client_mutation_id | owner | 2026-09-05 |
| D-P5 | Print local + Local Print Bus (sync marca done, sem reimpressão) | owner | 2026-09-05 |
