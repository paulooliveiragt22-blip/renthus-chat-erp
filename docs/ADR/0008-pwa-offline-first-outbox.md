# ADR 0008 — PWA Offline-First: Local Command Outbox + Sync Engine

**Status:** aceito (estrutura aprovada 2026-09-05; implementação sob checklist)  
**Data:** 2026-09-05  
**Escopo técnico:** outbox local (IndexedDB), sync engine, optimistic UI com estado `pending`, políticas de cache do Service Worker, snapshot de catálogo para PDV, **constraints de performance (D7)** — sem over-engineering.  
**Escopo comercial / produto:** decisões D-P1…D-P5 abaixo — **confirmar antes de mutação offline (fase P1+)**.

**Checklist:** [`CHECKLIST_PWA_OFFLINE_FIRST.md`](../CHECKLIST_PWA_OFFLINE_FIRST.md)  
**Predecessor PWA:** `next.config.js` (`@ducanh2912/next-pwa` + Workbox), `app/offline/page.tsx`, `public/manifest.webmanifest`  
**Governança:** `governanca-seguranca-negocio.mdc` (mutação canônica no Postgres/RPC; frontend sem tabela crua)  
**Não confundir com:** ADR-0003 (outbox **server** Postgres → SQS) — este ADR é outbox **browser** → API/RPC.

---

## Contexto

O app já é PWA de **shell** (precaching, NetworkFirst em navegação, fallback `/offline`, exclude de APIs sensíveis). Em galpão com sinal ruim isso evita tela branca, mas **não** permite vender/atualizar pedidos sem rede: não há fila local de mutações, nem snapshot de catálogo, nem política de optimistic UI segura para dinheiro/estoque.

Plano inicial (Offline-First + Background Sync + Optimistic UI + SWR) estava no nível checklist de buzzwords. Elevação aprovada: **Local-First Command Outbox** — Background Sync é transporte opcional; fonte da verdade local = IndexedDB; fonte da verdade comercial = RPC Postgres com idempotência.

---

## Decisão

### D1 — Arquitetura: Local Command Outbox (não “Background Sync first”)

```
UI → enqueueCommand(command) → Outbox (IDB)
                ↓
        applyOptimistic (status: pending)
                ↓
        SyncEngine.flush()  ← online / visibility / Periodic Sync / BG Sync (opcional)
                ↓
        HTTP → app/api/* → RPC idempotente (client_mutation_id)
                ↓
        ACK → synced | conflict | failed
```

| Camada | Responsabilidade | O que **não** faz |
|--------|------------------|-------------------|
| Service Worker | Shell, assets, opcional reenvio de fila HTTP | Regra de estoque/crédito/preço; “otimizar” API comercial |
| Outbox IDB | Persistência de comandos + status | Cachear billing/WhatsApp; snapshot ilimitado de catálogo |
| SyncEngine | Flush **em lote** (teto), ordenado, retry, backoff | Um POST por comando; calcular amount/estoque como verdade |
| TanStack Query | Cache de leitura + optimistic + pause/resume; **persist só allowlist** | Persistir o `QueryClient` inteiro; substituir outbox |
| RPC/API | Idempotência, tenant, invariantes | Confiar em POST “cego” do SW sem chave |

### D2 — Escopo v1 (proposta técnica aprovada; gates de produto abaixo)

| Inclui | Exclui |
|--------|--------|
| Snapshot catálogo PDV **enxuto** (campos PDV + teto; ver D7) | Dump ilimitado do catálogo no IDB; billing / Pagar.me / webhooks |
| Busca/bipagem local sobre o snapshot (índice) | `filter` linear no array inteiro a cada tecla |
| Enqueue finalização PDV (quando D-P1 ok) | Mutações WhatsApp / chatbot |
| Optimistic + `pending` em status de pedido (fase P2) | SWR em estoque/saldo/limite crédito |
| SyncStatus UI | Migrar para Serwist na v1 (P4 opcional); virtualização/prefetch agressivo “por performance” |

### D3 — Matriz de cache (obrigatória)

| Camada | Estratégia | Exemplos |
|--------|------------|----------|
| `_next/static` | CacheFirst + hash | JS/CSS (já) |
| Imagens | StaleWhileRevalidate + TTL | (já) |
| Navegação HTML/RSC | NetworkFirst + `/offline` | (já); timeout: ver D7 (P3) |
| Catálogo PDV | Snapshot IDB **com teto + projection** + revalidate background | só campos de venda; índice EAN/código/nome |
| Estoque / saldo / limite | NetworkOnly ou TTL curto + badge stale | nunca SWR silencioso (perf ≠ cache mentiroso) |
| Mutações $ / estoque | Outbox + flush em lote + RPC idempotente | PDV finalize |
| Persist TanStack | Allowlist de `queryKey` (catálogo/PDV) | não dehydratar platform/billing |
| Billing / WhatsApp | Sempre online; fora do outbox | exclude SW (já) |

### D4 — Optimistic UI com política

| Operação | Modo | UI |
|----------|------|-----|
| Status pedido “leve” | Optimistic + rollback | pending → synced / failed |
| Finalizar PDV / a prazo | Semi-otimista | venda **pendente de sync**; cupom “confirmado servidor” só após ACK |
| Custo / preço | Optimistic + versão | conflito → server wins + highlight |
| Billing / PSP | Proibido offline | online only |

### D5 — Service Worker update

Hoje: `skipWaiting: true` + `reloadOnOnline: true`.  
**Meta deste ADR:** em sessão PDV, preferir **waiting + prompt** “Nova versão → Atualizar” (evitar mid-sale reload). Detalhe na fase P3.

### D6 — Decisões de produto (gates — não implementar mutação offline sem fechar)

| ID | Pergunta | Impacto | Estado |
|----|----------|---------|--------|
| D-P1 | Escopo offline v1: só PDV read? + enqueue finalize? + pedidos status? | fases P1/P2 | **pendente** (estrutura ok; mutação bloqueada até resposta) |
| D-P2 | Estoque insuficiente no sync: rejeitar e reabrir UI vs permitir negativo? | RPC + conflict UI | **pendente** |
| D-P3 | Máx. horas / máx. comandos na fila antes de bloquear novas vendas | SyncEligibility | **pendente** |
| D-P4 | Multi-aba: um outbox por profile; sync concorrente via idempotência? | Outbox + RPC | **pendente** (default técnico proposto: sim, idempotência) |
| D-P5 | Print Agent: imprimir só após ACK vs rascunho local? | PDV + print | **pendente** |

Default técnico sugerido (só após owner confirmar): **D-P1 = PDV read + enqueue finalize**; **D-P2 = rejeitar**; **D-P3 = 24h / 50 cmds**; **D-P4 = sim**; **D-P5 = imprimir só após ACK**.

---

## Recursos a adicionar (função)

| Recurso | Função |
|---------|--------|
| `OfflineCommand` | Contrato de comando local (`id`, `type`, `companyId`, `payload`, `clientMutationId`, `status`, `createdAt`, `attempts`, `lastError`) |
| `SyncEligibility` | Allowlist: quais `type` podem entrar na fila; limites D-P3 |
| `ConflictPolicy` | `server_wins` \| `reject_reopen` \| `manual` por tipo de comando |
| `OutboxStore` (port) | CRUD/fila durable no browser |
| `idbOutboxStore` (adapter) | IndexedDB (Dexie ou `idb`) |
| `SyncTransport` (port) | Envio de batch/comando ao servidor |
| `httpSyncTransport` | `POST /api/offline/sync` com AbortController + auth cookie/session |
| `CatalogSnapshotStore` | Ler/gravar snapshot de catálogo para PDV offline |
| `enqueueCommand` | Valida eligibility → IDB → dispara optimistic |
| `flushOutbox` | Drain ordenado; marca synced/failed/conflict |
| `applyOptimistic` / `useOfflineMutation` | Integra TanStack Query (`onMutate` / `onError` / `onSettled`) + badge pending |
| `SyncStatusBar` | UX: “N pendentes · sincronizando…” / offline |
| `workboxBgSyncBridge` | Opcional: Background Sync só como wake do flush (Chrome) |
| RPC/API sync | Aplica comandos com `client_mutation_id` único; tenant; estoque |

---

## Arquivos — adicionar

| Path | Papel |
|------|-------|
| `lib/offline/domain/OfflineCommand.ts` | Tipos + status machine |
| `lib/offline/domain/SyncEligibility.ts` | Allowlist + limites |
| `lib/offline/domain/ConflictPolicy.ts` | Política por `command.type` |
| `lib/offline/ports/OutboxStore.ts` | Interface store |
| `lib/offline/ports/SyncTransport.ts` | Interface transporte |
| `lib/offline/ports/CatalogSnapshotStore.ts` | Interface snapshot |
| `lib/offline/application/enqueueCommand.ts` | Use case enqueue |
| `lib/offline/application/flushOutbox.ts` | Use case flush |
| `lib/offline/application/applyOptimistic.ts` | Helpers optimistic |
| `lib/offline/application/resolveConflict.ts` | Mapeia resposta servidor → UI |
| `lib/offline/adapters/idbOutboxStore.ts` | IndexedDB |
| `lib/offline/adapters/idbCatalogSnapshotStore.ts` | Snapshot catálogo |
| `lib/offline/adapters/httpSyncTransport.ts` | HTTP batch |
| `lib/offline/adapters/workboxBgSyncBridge.ts` | Opcional BG Sync |
| `lib/offline/presentation/SyncStatusBar.tsx` | Indicador global |
| `lib/offline/presentation/useOfflineMutation.ts` | Hook TanStack |
| `lib/offline/presentation/OnlineGate.tsx` | Gate superfícies online-only |
| `app/api/offline/sync/route.ts` | Batch flush server-side (valida empresa/usuário) |
| `supabase/migrations/YYYYMMDDHHMMSS_offline_client_mutation_idempotency.sql` | Unique/`client_mutation_id` onde fizer sentido (ex.: pedidos PDV) |
| `tests/offline/*.test.ts` | Unit outbox/eligibility/flush |
| `docs/CHECKLIST_PWA_OFFLINE_FIRST.md` | Execução cronológica (este ADR) |

## Arquivos — alterar

| Path | Mudança |
|------|---------|
| `next.config.js` | Runtime caching fino; update strategy (waiting/prompt); opcional custom worker / BG Sync bridge |
| `app/offline/page.tsx` | Mensagem alinhada a “fila local / sync” (não só “sem internet”) |
| `app/layout.tsx` ou layout admin | Montar `SyncStatusBar` + provider persist Query se adotado |
| Provider TanStack Query (arquivo existente do `QueryClient`) | `networkMode`, `PersistQueryClientProvider`, `setMutationDefaults`, `resumePausedMutations` |
| `app/(admin)/pdv/page.tsx` (+ helpers PDV) | Snapshot catálogo; finalize → outbox; UI pending |
| `app/(admin)/pedidos/PedidosClient.tsx` | Fase P2: status transitions via outbox/optimistic |
| `proxy.ts` / testes proxy | Exempt `/api/offline/sync` só se necessário (auth continua obrigatória) |
| `docs/DB_CURRENT_STATE.md` | Documentar coluna/constraint de idempotência offline |
| `.cursorrules` (bloco “etapa”) | Marcar item PWA offline quando entregue |

**Fora de escopo (não alterar neste ADR):** rotas billing, WhatsApp webhook, workers SQS (ADR-0003), chatbot `processMessage`.

---

## Fases (visão)

| Fase | Nome | Entrega |
|------|------|---------|
| **P0** | Fundações | Domínio + ports + IDB outbox vazio + SyncStatus + testes unitários; **zero** mutação de negócio |
| **P1** | PDV offline-read + enqueue | Snapshot catálogo; finalize enfileirado; RPC/API idempotente (**após D-P1…D-P5**) |
| **P2** | Pedidos status | Optimistic + outbox só transições allowlist |
| **P3** | SW polish | Prompt de update; matriz cache; bridge BG Sync opcional |
| **P4** | Opcional | Migrar `@ducanh2912/next-pwa` → Serwist |

---

## Consequências

**Positivas**
- PDV utilizável com rede intermitente sem inventar “truth” no SW.
- Alinha com RPC idempotente e multi-tenant.
- Optimistic UI sem mentir confirmação financeira.

**Negativas / custo**
- Complexidade IndexedDB + sync + conflitos.
- BG Sync não cobre iOS de forma confiável → flush via `online`/`visibility` obrigatório.
- Snapshot de catálogo pode ficar stale → badge e revalidate obrigatórios.

**Riscos mitigados**
- Double-submit offline → `client_mutation_id` unique no servidor.
- Cache de preço/estoque errado → matriz D3 (sem SWR comercial silencioso).
- Reload mid-sale por SW → D5 (prompt).

---

## Referências

- Context7 / TanStack Query: `PersistQueryClientProvider`, `resumePausedMutations`, `setMutationDefaults`, optimistic `onMutate`/`onError`
- Context7 / Serwist: `NetworkFirst`, `StaleWhileRevalidate`, `BackgroundSyncPlugin`, `BroadcastUpdatePlugin` (modelo mental; v1 pode permanecer em next-pwa)
- Workbox Background Sync: transporte opcional, não fonte da verdade
- ADR-0003: outbox server (não substituído por este)
- `governanca-seguranca-negocio.mdc`, `projeto-pre-producao-radical.mdc`
