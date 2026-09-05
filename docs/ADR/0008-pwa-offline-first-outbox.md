# ADR 0008 — PWA Offline-First: Local Command Outbox + Sync Engine

**Status:** aceito (P0–P3 entregues 2026-09-05; P4 Serwist = no-go; **D-P6 M1–M9 fechado** → fase P5)  
**Data:** 2026-09-05  
**Escopo técnico:** outbox local (IndexedDB), sync engine, optimistic UI `pending`, cache SW, snapshot PDV, perf D7, Local Print Bus (D-P5), **P5 prefetch admin + mutações M1–M9**.  
**Escopo comercial / produto:** D-P1…D-P6 **fechadas** (ver § D6).

**Checklist:** [`CHECKLIST_PWA_OFFLINE_FIRST.md`](../CHECKLIST_PWA_OFFLINE_FIRST.md)  
**Predecessor PWA:** `next.config.js` (`@ducanh2912/next-pwa` + Workbox), `app/offline/page.tsx`, `public/manifest.webmanifest`  
**Governança:** `governanca-seguranca-negocio.mdc` (mutação canônica no Postgres/RPC; frontend sem tabela crua)  
**Não confundir com:** ADR-0003 (outbox **server** Postgres → SQS) — este ADR é outbox **browser** → API/RPC.

---

## Contexto

O app já é PWA de **shell** (precaching, NetworkFirst em navegação, fallback `/offline`, exclude de APIs sensíveis). Em galpão com sinal ruim isso evita tela branca, mas **não** permite vender/atualizar pedidos sem rede: não há fila local de mutações, nem snapshot de catálogo, nem política de optimistic UI segura para dinheiro/estoque.

Plano inicial (Offline-First + Background Sync + Optimistic UI + SWR) estava no nível checklist de buzzwords. Elevação aprovada: **Local-First Command Outbox** — Background Sync é transporte opcional; fonte da verdade local = IndexedDB; fonte da verdade comercial = RPC Postgres com idempotência. Constraints de performance (**D7**) entram no desenho desde já: snapshot enxuto, índice de busca, flush em lote, persist seletivo — sem over-engineering.

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
| Snapshot catálogo PDV **enxuto** + finalize PDV offline + status pedidos (P2) | Dump ilimitado do catálogo no IDB; billing / Pagar.me / webhooks |
| Busca/bipagem local sobre o snapshot (índice) | `filter` linear no array inteiro a cada tecla |
| Print local + Local Print Bus (D-P5) | Reenqueue `pending` de cupom já impresso offline |
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
**Nota de perf:** isto é estabilidade de sessão, não ganho de FPS — ainda assim obrigatório no PDV (P3). BG Sync / Periodic Sync = wake opcional do flush; **não** contar como otimização em iOS.

### D6 — Decisões de produto (fechadas 2026-09-05 — owner)

| ID | Decisão fechada | Impacto técnico | Estado |
|----|-----------------|-----------------|--------|
| **D-P1** | Escopo produto = **os três**: (1) leitura catálogo PDV offline, (2) enqueue finalizar venda PDV, (3) mudança de status de pedidos. *Nota:* não era “escolher um”; era “até onde na v1”. Entrega ainda **sequenciada** P1→P2 para não misturar risco (P1 = 1+2+print; P2 = 3). | Allowlist + fases P1/P2 | **[x] 2026-09-05** |
| **D-P2** | Estoque no sync **segue a regra já existente** `products.vender_com_estoque_zero` (`lib/products/stockPolicy.ts`): se o produto **pode** vender com estoque zero/negativo → aceita sync; se **não** → rejeita e reabre na UI. Sem política nova “global rejeitar/aceitar”. | RPC sync por item/produto | **[x] 2026-09-05** |
| **D-P3** | Limite de fila: **24h** / **200** comandos (delivery raramente fica dias offline; 200 aguenta pico sem thundering herd extremo). | `SyncEligibility` | **[x] 2026-09-05** |
| **D-P4** | Multi-aba/concorrente **sim** + `client_mutation_id` único (idempotência no servidor). | Unique constraint + outbox | **[x] 2026-09-05** |
| **D-P5** | **Rascunho/impressão local na hora** + sync com sinalização “já impresso” para o agent **não** reimprimir (anti-enxurrada). Estrutura: **Local Print Bus** (abaixo). | Print Agent + outbox + `print_jobs` | **[x] 2026-09-05** |
| **D-P6** | Escopo offline **admin ampliado** = **M1–M9 todos** (owner 2026-09-05). Entrega **sequenciada** P5a→P5e (não um PR monólito). | Prefetch IDB + allowlist + sync RPCs | **[x] 2026-09-05** |

#### D-P6 — Mutações / recursos offline (M1–M9) — fechado

| ID | Escopo | Write? | Onda |
|----|--------|--------|------|
| **M1** | Criar pedido (admin/Pedidos), alinhado ao outbox do PDV | sim | P5c |
| **M2** | Busca produtos em Pedidos via snapshot catálogo (read) | não | P5a |
| **M3** | Status offline além de preparing/delivered (ex.: `out_for_delivery`) | sim | P5b |
| **M4** | Ajuste estoque manual | sim | P5d |
| **M5** | CRUD cliente leve (nome/fone) | sim | P5d |
| **M6** | Atribuir entregador / sair pra entrega | sim | P5b |
| **M7** | Fila: claim / chamar próximo | sim | P5e |
| **M8** | Impressoras: lista/config local (read) + reprint se job existir | read + reprint | P5a / P5e |
| **M9** | Produtos: editar preço/cadastro offline | sim | P5d |

**P5a (obrigatório antes das writes):** prefetch no `AdminShell` quando online — catálogo, pedidos recentes, fila, clientes top-N, entregadores, impressoras — em IDB com teto (Perf-1), **sem** exigir abrir cada aba. Reload offline usa last-known.

**Ainda fora de D-P6:** billing/PSP, WhatsApp inbound/outbound, dual-write tabela crua no client.

#### D-P1 — esclarecimento

As três opções são pertinentes e **todas entram no produto**. A fase P0/P1 do checklist só separava entrega técnica (finalize antes de status) — não exclui status do roadmap. P2 deixa de ser “opcional de produto” e passa a ser **obrigatório após P1**.

#### D-P5 — Local Print Bus (estrutura escolhida)

**Como o Print Agent funciona hoje (online):**  
Electron/agent autentica com API key → faz poll em `/api/agent/jobs/*` → reserva `print_jobs` **no Postgres** → imprime → `complete`. Não “lê o banco direto” com service role; a fila canônica é `print_jobs` via API. Offline, se no sync criarmos jobs `pending`, o agent (quando a net voltar) **imprimiria de novo** tudo que o caixa já imprimiu localmente → enxurrada.

**Desenho alvo (capaz de anti-reimpressão):**

```
PDV offline finalize
  → OfflineCommand FinalizePdvSale (+ printIntent)
  → LocalPrintQueue (IDB) ──localhost/WS──► Print Agent (modo local)
  → Agent imprime → marca job local printed_at + client_print_id
  → Outbox atualiza payload: printIntent.alreadyPrinted = true

Sync (rede volta)
  → RPC cria pedido (idempotent client_mutation_id)
  → Para cada client_print_id já impresso:
        INSERT print_jobs status='done' (ou 'skipped_local')
        + UNIQUE (company_id, client_print_id)
        + meta.printed_offline = true
     Sem alreadyPrinted:
        rpc_enqueue_print_job normal (pending) — agent cloud imprime 1×
```

| Peça | Função |
|------|--------|
| `LocalPrintQueue` (IDB) | Fila de cupons offline no browser; irmã do outbox de comandos |
| Bridge localhost no Print Agent | Segundo consumer além do poll cloud: recebe jobs da PWA na mesma máquina (HTTP loopback ou WS); **não** exige Supabase offline |
| `client_print_id` (UUID) | Idempotência de impressão; sobe no sync |
| `print_jobs` sync path | Já impresso → grava `done`/`skipped_local` (auditoria, zero poll pending); não impresso → `pending` como hoje |
| Unique `(company_id, client_print_id)` | Retry de sync não duplica job nem reabre pending |

**Fora deste desenho:** agent continuar só no poll cloud sem sinal local; dual-write “imprimir local e também enqueue pending sem flag”.

**Implementação:** P1.8 na cronologia após finalize (P1.7). Bridge: Electron IPC ou `POST http://127.0.0.1:17890/local-print` — ver `lib/offline/localPrintBridgeContract.ts`.

---

### D7 — Performance (obrigatório no desenho; sem exagero)

Ganho real do Offline-First neste ERP: **snapshot enxuto + busca local + sync em lote + persist seletivo**. O resto é polish ou risco disfarçado de performance.

#### D7.1 — Necessário (senão offline fica lento ou inútil)

| # | Regra | Onde aplica | Default técnico (ajustar se medir) |
|---|--------|-------------|-------------------------------------|
| Perf-1 | Snapshot com **teto** (não dump ilimitado) | `CatalogSnapshotStore`, hydrate PDV (P1) | Só ativos da `company_id`; projection: ids, nome, EAN, códigos, preço, sigla, fator; paginar/cortar se exceder teto de entradas |
| Perf-2 | **Índice local** de busca/bipagem | PDV sobre snapshot (P1) | Map/índice por EAN, código interno, nome — não `filter` no array a cada tecla |
| Perf-3 | Flush outbox **em lote** + backoff | `flushOutbox`, `httpSyncTransport`, `POST /api/offline/sync` (P0 contrato / P1 real) | Ex.: 10–20 cmds/request; backoff simples; sem um POST por item |
| Perf-4 | Persist QueryClient **só allowlist** | Provider TanStack (P0 stub / P1) | Persistir queries de catálogo/PDV; **não** platform/billing/inbox |
| Perf-5 | Estoque/crédito **fora** de cache “bonito” | Matriz D3 | NetworkOnly ou TTL curto + badge; cache errado custa mais que ~200 ms |

#### D7.2 — Útil depois (só se houver dor medida)

| # | Item | Fase | Comentário |
|---|------|------|------------|
| Perf-A | Prompt de update do SW (D5) | P3 | Estabilidade mid-sale > micro-otimização |
| Perf-B | Revisar `networkTimeoutSeconds` do NetworkFirst (hoje 8s) | P3 | Se PDV “pende” em rede ruim: 3–4s + cair no snapshot/`/offline` |
| Perf-C | `workboxBgSyncBridge` | P3 | Wake no Chrome; irrelevante como perf em iOS |
| Perf-D | Migrar next-pwa → Serwist | P4 | Manutenção de SW, não milagre de velocidade |

#### D7.3 — Explicitamente fora (não dourar a pílula)

- Virtualização agressiva / prefetch de metade do admin “por causa do PWA”
- Edge cache ou SWR de API comercial (preço/estoque/crédito)
- Service Worker calculando estoque ou regra de venda
- Dual-path “otimizado” (local + tabela crua no client)
- Empacotar billing/WhatsApp no mesmo esforço de perf

**Regra de checklist:** itens P1 de snapshot/sync **devem** citar Perf-1…Perf-5 no DoD; Perf-A…D só entram com evidência (travamento, quota, timeout).

---

## Recursos a adicionar (função)

| Recurso | Função |
|---------|--------|
| `OfflineCommand` | Contrato de comando local (`id`, `type`, `companyId`, `payload`, `clientMutationId`, `status`, `createdAt`, `attempts`, `lastError`) |
| `SyncEligibility` | Allowlist: quais `type` podem entrar na fila; limites D-P3 |
| `ConflictPolicy` | `server_wins` \| `reject_reopen` \| `manual` por tipo de comando |
| `OutboxStore` (port) | CRUD/fila durable no browser |
| `idbOutboxStore` (adapter) | IndexedDB (Dexie ou `idb`) |
| `SyncTransport` (port) | Envio de **batch** (não single-only) ao servidor |
| `httpSyncTransport` | `POST /api/offline/sync` em lote + AbortController + auth; respeita teto Perf-3 |
| `CatalogSnapshotStore` | Snapshot **enxuto** (Perf-1): teto, projection, version/TTL por `company_id` |
| `buildCatalogSearchIndex` / lookup | Índice EAN/código/nome sobre o snapshot (Perf-2) |
| `enqueueCommand` | Valida eligibility → IDB → dispara optimistic |
| `flushOutbox` | Drain ordenado **em lotes**; marca synced/failed/conflict; backoff |
| `applyOptimistic` / `useOfflineMutation` | Integra TanStack Query (`onMutate` / `onError` / `onSettled`) + badge pending |
| `SyncStatusBar` | UX: “N pendentes · sincronizando…” / offline / snapshot stale |
| `workboxBgSyncBridge` | Opcional: Background Sync só como wake do flush (Chrome) — Perf-C |
| Persist allowlist (QueryClient) | Dehydrate só `queryKey` de catálogo/PDV (Perf-4) |
| RPC/API sync | Aplica comandos com `client_mutation_id` único; tenant; estoque; aceita batch |

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
| `lib/offline/application/flushOutbox.ts` | Use case flush **em lotes** + backoff (Perf-3) |
| `lib/offline/application/applyOptimistic.ts` | Helpers optimistic |
| `lib/offline/application/resolveConflict.ts` | Mapeia resposta servidor → UI |
| `lib/offline/adapters/idbOutboxStore.ts` | IndexedDB |
| `lib/offline/adapters/memoryOutboxStore.ts` | Outbox em memória (testes / SSR) |
| `lib/offline/adapters/idbCatalogSnapshotStore.ts` | Snapshot catálogo (teto + projection — Perf-1) |
| `lib/offline/application/buildCatalogSearchIndex.ts` | Índice de busca/bipagem local (Perf-2) |
| `lib/offline/adapters/httpSyncTransport.ts` | HTTP **batch** (Perf-3) |
| `lib/offline/syncStatusStore.ts` | Snapshot reativo pending/online (UI) |
| `lib/offline/persistQueryAllowlist.ts` | Allowlist Perf-4 |
| `lib/offline/createAppQueryClient.ts` | QueryClient com networkMode online + hook allowlist |
| `lib/offline/adapters/workboxBgSyncBridge.ts` | Opcional BG Sync |
| `lib/offline/presentation/SyncStatusBar.tsx` | Indicador global |
| `lib/offline/presentation/useOfflineMutation.ts` | Hook TanStack |
| `lib/offline/presentation/OnlineGate.tsx` | Gate superfícies online-only |
| `app/api/offline/sync/route.ts` | Batch flush server-side (valida empresa/usuário; teto de cmds/request) |
| `supabase/migrations/YYYYMMDDHHMMSS_offline_client_mutation_idempotency.sql` | Unique/`client_mutation_id` onde fizer sentido (ex.: pedidos PDV) |
| `tests/offline/*.test.ts` | Unit outbox/eligibility/flush/lote/índice de busca |
| `docs/CHECKLIST_PWA_OFFLINE_FIRST.md` | Execução cronológica (este ADR) |

## Arquivos — alterar

| Path | Mudança |
|------|---------|
| `next.config.js` | Runtime caching fino (D3); update waiting/prompt (D5/Perf-A); opcional timeout NetworkFirst (Perf-B); BG Sync bridge (Perf-C) |
| `app/offline/page.tsx` | Mensagem alinhada a “fila local / sync” (não só “sem internet”) |
| `app/layout.tsx` ou layout admin | Montar `SyncStatusBar` + provider persist Query **com allowlist** (Perf-4) |
| `components/AdminShell.tsx` | `SyncStatusBar` abaixo dos banners de billing/impersonation |
| `components/Providers.tsx` | Usa `createAppQueryClient()` |
| Provider TanStack Query (arquivo existente do `QueryClient`) | `networkMode`, persist seletivo, `setMutationDefaults`, `resumePausedMutations` — **não** persist global |
| `app/(admin)/pdv/page.tsx` (+ helpers PDV) | Snapshot enxuto + índice busca; finalize → outbox; UI pending; badge stale |
| `app/(admin)/pedidos/PedidosClient.tsx` | Fase P2: status transitions via outbox/optimistic |
| `proxy.ts` / testes proxy | Exempt `/api/offline/sync` só se necessário (auth continua obrigatória) |
| `docs/DB_CURRENT_STATE.md` | Documentar coluna/constraint de idempotência offline |
| `.cursorrules` (bloco “etapa”) | Marcar item PWA offline quando entregue |

**Fora de escopo (não alterar neste ADR):** rotas billing, WhatsApp webhook, workers SQS (ADR-0003), chatbot `processMessage`; ver também D7.3.

---

## Fases (visão)

| Fase | Nome | Entrega | Perf (D7) |
|------|------|---------|-----------|
| **P0** | Fundações | Domínio + ports + IDB outbox vazio + SyncStatus + testes; **zero** mutação de negócio | Contrato de transport **batch**; persist allowlist stub (Perf-3/4) |
| **P1** | PDV offline-read + enqueue | Snapshot; finalize enfileirado; RPC/API idempotente (**após D-P1…D-P5**) | **Obrigatório** Perf-1…5 (teto, índice, lote, persist seletivo, sem SWR estoque) |
| **P2** | Pedidos status | Optimistic + outbox só transições allowlist | Reusar lote/backoff; sem snapshot extra |
| **P3** | SW polish | Prompt de update; matriz cache; bridge BG Sync opcional | Perf-A…C só se dor; timeout NetworkFirst se PDV “pende” |
| **P4** | Opcional | Migrar `@ducanh2912/next-pwa` → Serwist | Perf-D — manutenção, não speed |

---

## Consequências

**Positivas**
- PDV utilizável com rede intermitente sem inventar “truth” no SW.
- Alinha com RPC idempotente e multi-tenant.
- Optimistic UI sem mentir confirmação financeira.
- Perf focada no caminho crítico (galpão/PDV), sem teatro de otimização.

**Negativas / custo**
- Complexidade IndexedDB + sync + conflitos.
- BG Sync não cobre iOS de forma confiável → flush via `online`/`visibility` obrigatório.
- Snapshot de catálogo pode ficar stale → badge e revalidate obrigatórios.
- Projection/teto do snapshot exige manutenção quando o PDV ganhar campos novos.

**Riscos mitigados**
- Double-submit offline → `client_mutation_id` unique no servidor.
- Cache de preço/estoque errado → matriz D3 + Perf-5 (sem SWR comercial silencioso).
- Reload mid-sale por SW → D5 / Perf-A (prompt).
- Hydrate/quota/IDB lento → Perf-1 (teto + projection).
- Busca offline O(n) a cada tecla → Perf-2 (índice).
- “Thundering herd” ao voltar a rede → Perf-3 (lote + backoff).
- Boot lento / storage cheio → Perf-4 (persist allowlist).

**Riscos se ignorar D7**
- Snapshot gigante trava o PDV offline ou estoura quota.
- Flush 1:1 DDoSa a própria API no reconnect.
- Persist global do React Query degrada login/admin sem benefício no galpão.

---

## Referências

- Context7 / TanStack Query: `PersistQueryClientProvider`, `resumePausedMutations`, `setMutationDefaults`, optimistic `onMutate`/`onError` — persist **parcial** (allowlist)
- Context7 / Serwist: `NetworkFirst`, `StaleWhileRevalidate`, `BackgroundSyncPlugin`, `BroadcastUpdatePlugin` (modelo mental; v1 pode permanecer em next-pwa)
- Workbox Background Sync: transporte opcional, não fonte da verdade nem “perf iOS”
- ADR-0003: outbox server (não substituído por este)
- `governanca-seguranca-negocio.mdc`, `projeto-pre-producao-radical.mdc`
- Checklist: DoD P1 deve citar Perf-1…Perf-5 (`CHECKLIST_PWA_OFFLINE_FIRST.md`)
