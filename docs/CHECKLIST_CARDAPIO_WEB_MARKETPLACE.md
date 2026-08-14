# Checklist — Cardápio web + sync iFood/Aiqfome

Escopo alinhado às decisões do produto:

- Cardápio **baixado no Renthus** (fonte operacional).
- Sync **manual** via botão (cron opcional depois).
- **Sem** consulta live ao marketplace no atendimento WhatsApp.
- Cardápio web público leve, multi-tenant por slug/link.

Atualizar ao concluir (`[ ]` → `[x]` + data).

---

## Decisão técnica — Cardápio web (recomendação)

| Opção | Veredito |
|-------|----------|
| **Next.js App Router — rota pública no mesmo monólito** (`/c/[slug]`) | **Escolhida** — leve com SSR/ISR, mesmo deploy Vercel, mesma auth/API interna, SEO básico |
| App separado (Vite/SPA) | Evitar no MVP — 2 deploys, CORS, duplica tipos |
| Link bio / Carrinho externo (Instagram shops) | Não integra estoque/pedido Renthus |
| Só Flow WhatsApp com fotos | Limite Meta (base64, 3 imgs) — complementar, não substitui |

### Como identificar restaurante / disk

| Mecanismo | Uso |
|-----------|-----|
| **`slug` único por empresa** na URL (`/c/disk-beatriz`) | Identifica o tenant (obrigatório) |
| Subdomínio opcional depois (`disk.renthus.app`) | Fase 2 |
| Query `?utm_source=whatsapp` / `?ref=mesa-3` | Canal / origem da visita |
| Cookie/`localStorage` + `visitor_id` anônimo | Retorno do mesmo browser (sem login) |
| Login WhatsApp / telefone (opcional) | Identificar cliente conhecido → favoritos / pedido |

### Como saber quem acessa (leve, LGPD-aware)

| Dado | MVP | Depois |
|------|-----|--------|
| `company_id` via slug | Sim | — |
| `page_view` (produto/categoria) | Sim (agregado) | — |
| `visitor_id` anônimo (UUID cookie) | Sim | — |
| IP truncado / user-agent (analytics) | Opcional | — |
| Telefone/nome | Só se cliente informar no pedido | Login WhatsApp |
| Painel “visitas / produtos mais vistos” | — | Sim |

**Não** exigir login para ver o cardápio. Identidade forte só no checkout/pedido.

### Stack da página pública

- Rota: `app/(public)/c/[slug]/page.tsx` (sem AdminShell).
- Dados: API pública read-only (`/api/public/menu/[slug]`) → views/RPC; **sem** service role no browser.
- Imagens: URLs públicas do Storage `product-images` (já existe policy de leitura).
- Cache: ISR/`revalidate` 60–300s + invalidação após sync.
- Carrinho: estado no client; CTA “Pedir no WhatsApp” (MVP) ou checkout no ERP (fase 2).

---

## Fases

### F0 — Fundação multi-tenant (cardápio)

| # | Item | Estado | Notas |
|---|------|--------|-------|
| F0.1 | Coluna/tabela `company_menu_profile`: `slug` único, nome exibição, logo, WhatsApp, ativo | [x] | migration `20260804000001` |
| F0.2 | Flag produto `show_on_menu` (ou só ativos + com preço) | [x] | `products.show_on_menu` default true |
| F0.3 | Gerar/editar slug na UI Configurações / Produtos | [x] | Aba Configurações → Cardápio web |
| F0.4 | API `GET /api/public/menu/[slug]` (categorias, itens, preço, foto, descrição) | [x] | + contratos + RPC `rpc_get_public_menu` |
| F0.5 | Página pública `/c/[slug]` mobile-first (lista + foto + preço) | [x] | `app/(public)/c/[slug]` + proxy público |
| F0.6 | Link copiável no admin + QR code | [x] | Copiar / Abrir / QR na aba Cardápio |
| F0.7 | Analytics mínimo: view por slug + `visitor_id` | [x] | `page_view` no MenuClient |
| F0.8 | Chatbot envia link `/c/{slug}` quando cardápio ativo | [x] | 2026-08-04 — Starter/PRO/FAQ; fallback Flow |

### F1 — Sync marketplace (iFood primeiro)

| # | Item | Estado | Notas |
|---|------|--------|-------|
| F1.1 | Tabela `marketplace_connections` (company, provider, merchant_id, tokens encrypted, status) | [x] | 2026-08-04 — migration `20260804140000` |
| F1.2 | Tabela `marketplace_catalog_map` (external_id → product_id / embalagem_id) | [x] | 2026-08-04 |
| F1.3 | Adapter `src/marketplaces/adapters/ifood` (auth + Catalog API list) | [x] | Mock default; live se token |
| F1.4 | Job import: categoria, nome, descrição, preço → `products` + `produto_embalagens` | [x] | UN padrão via sync service |
| F1.5 | Download foto → Storage → `product_images` | [x] | best-effort se URL pública |
| F1.6 | UI: Conectar iFood + **Importar / Sincronizar cardápio** | [x] | Configurações → Cardápio web |
| F1.7 | Exibir “Última sync” + contadores (criados/atualizados/erros) | [x] | na mesma UI |
| F1.8 | Conta iFood Developer + homologação (ops, fora do código) | [ ] | Bloqueante produção real |

### F2 — Pedido a partir do cardápio web

| # | Item | Estado | Notas |
|---|------|--------|-------|
| F2.1 | Carrinho no browser + resumo | [x] | 2026-08-04 — MenuClient + localStorage |
| F2.2 | CTA WhatsApp com texto do pedido (deep link `wa.me`) | [ ] | Opcional — checkout web cobre o pedido |
| F2.3 | Checkout web → `create_order_with_items` + `source=web_menu` | [x] | 2026-08-04 — APIs session/quote/checkout |
| F2.4 | Endereço / taxa delivery (reusar policy Renthus) | [x] | salvos + novo + delivery policy |
| F2.5 | Identificar cliente por telefone se já existir em `customers` | [x] | token `wm` no link WA + form manual |

### F3 — Aiqfome + pedidos marketplace

| # | Item | Estado | Notas |
|---|------|--------|-------|
| F3.1 | Adapter Aiqfome no mesmo port de catálogo | [x] | 2026-08-04 — mock + UI sync |
| F3.2 | Pedidos inbound iFood → `orders` + Fila | [x] | poll API + mock PLC → `marketplace_ifood` |
| F3.3 | Status Renthus → marketplace (confirm/dispatch) | [x] | hook em PATCH `/api/admin/orders` |
| F3.4 | Homologação pedidos iFood | [ ] | Ops — conta Developer + SLA 8 min |

### F4 — Evoluções

| # | Item | Estado | Notas |
|---|------|--------|-------|
| F4.1 | Cron sync opcional (1–6h) se conexão ativa | [x] | 2026-08-04 — job Vercel diário (`0 4 * * *`; Hobby não aceita horário); intervalo 1–6h no código se Pro/externo |
| F4.2 | Painel analytics (visitas, top produtos, origem UTM) | [x] | 2026-08-04 — RPC + Configurações → Cardápio |
| F4.3 | Subdomínio custom / domínio próprio | [x] | 2026-08-04 — host rewrite + `custom_domain`; ops: wildcard/CNAME Vercel |
| F4.4 | Complementos/opcionais iFood → acompanhamentos | [x] | 2026-08-04 — optionGroups→produtos + link ≤2; metadata no map |
| F4.5 | Cardápio web com fotos no Flow (só destaques) | [ ] | Opcional |

### F5 — Descontinuar WhatsApp Flow (Meta) em favor do cardápio web

**Decisão de produto (2026-08-11). Implementado 2026-08-13 (F5a–F5c).**

WhatsApp Flow outbound (`status`, `address_register`, `catalog`, `checkout`) foi substituído pelo
cardápio web (`/c/[slug]`). Motivo: UX melhor (fotos reais, sem limite de 3 imagens/base64, sem
tela nativa do WhatsApp) e infraestrutura F2 já pronta (checkout, endereço, `MyOrdersDrawer`).

| Fase | O quê | Status |
|------|--------|--------|
| F5a | Status/catálogo via `cta_url` (`?orders=1` para Meus pedidos) | [x] `routeStage` |
| F5b | Snapshot `menu_handoffs` + token `hc` (carrinho **não** vai na URL) | [x] |
| F5c | Pipeline deixa de enviar Flow; inbound `flows/route.ts` permanece até o dashboard Meta remover os flows | [x] |

Direção:
- **Status:** CTA “Meus pedidos” → `withMenuSearchParams(webMenuUrl, { orders: "1" })`. `MenuClient` abre `MyOrdersDrawer`.
- **Checkout/endereço:** `createCheckoutHandoff` persiste o draft em `menu_handoffs`; URL só leva `hc` + `checkout=1`. GET `/api/public/menu/[slug]/handoff?hc=` hidrata o carrinho.
- **Inbound Flow:** `app/api/whatsapp/flows/route.ts` e `persistEnderecoClienteFromFlow` ficam para WebView Meta ainda ativo no canal. Remoção do webhook/4 types: depois que o dashboard Meta não tiver mais Flow publicado.

**Não fazer:** serializar carrinho no token `wm` / query string.

---

## Recursos / entregáveis a adicionar no repo

| Recurso | Onde |
|---------|------|
| Doc deste checklist | `docs/CHECKLIST_CARDAPIO_WEB_MARKETPLACE.md` |
| Migration profile + slug + events | `supabase/migrations/...` |
| API pública menu | `app/api/public/menu/[slug]/route.ts` |
| Página cardápio | `app/(public)/c/[slug]/` |
| Admin integrações | `app/(admin)/configuracoes` ou `/integracoes` |
| Adapters marketplace | `src/marketplaces/` |
| Env | `IFOOD_CLIENT_ID`, `IFOOD_CLIENT_SECRET` (app-level) + tokens por company no DB |
| Env menu domain | `NEXT_PUBLIC_MENU_BASE_DOMAIN` (ex. `renthus.app`) + wildcard no Vercel; domínio próprio via CNAME manual |
| Feature flags | `web_menu`, `marketplace_ifood` em entitlements (se houver) |

---

## Fora de escopo (explícito)

- Consulta live iFood/Aiqfome a cada mensagem do chatbot.
- Migrar ERP inteiro para Clean Architecture por causa do cardápio.
- Exigir login para só visualizar o menu.
- Substituir PDV/WhatsApp pelo cardápio web no dia 1.

---

## Ordem de implementação sugerida

1. F0 (slug + página + API + analytics mínimo) — valor imediato com fotos do cadastro atual  
2. F1 (import/sync iFood) — acelera onboarding de quem já vende no iFood  
3. F2 (pedir via WhatsApp a partir do link)  
4. F3 / F4 conforme demanda

---

## Ajustes da análise (2026-08-04)

| Ajuste | Decisão |
|--------|---------|
| Slug | `company_menu_profile.slug` é a URL pública; seed a partir de `companies.slug` / nome fantasia |
| Leitura pública | **RPC** `rpc_get_public_menu(p_slug)` — não reutilizar `/api/catalog/*` (é por `company_id`, top sellers) |
| Tipagem | Contratos camelCase em `src/types/contracts.public-menu.ts` + parsers (Zod ainda não está no app) |
| Visibilidade | `products.show_on_menu` + `is_active` + embalagem com preço |
| Segurança | Mesmo padrão do catalog: admin client no server + rate limit; RPC só `service_role` |
| Feature flag | Seed `web_menu` em `features` (gate admin depois; público exige `profile.is_active`) |
| Não usar | `view_chat_produtos` direto no browser; consulta live iFood |

---

## Registro

| Data | Nota |
|------|------|
| 2026-08-01 | Checklist criado; decisão: menu no Renthus + sync manual; web Next.js `/c/[slug]` |
| 2026-08-04 | Análise F0; contratos + migration + API pública + admin profile + testes parser |
| 2026-08-04 | Página `/c/[slug]`, aba Configurações Cardápio, proxy/AdminShell liberados |
| 2026-08-04 | F4.1: cron `/api/marketplace/sync-catalog` + `auto_sync_enabled` / intervalo 1–6h na UI |
| 2026-08-04 | F4.2: painel analytics cardápio (`rpc_get_menu_analytics` + product_view/UTM) |
| 2026-08-04 | F4.3: domínio próprio / subdomínio (`NEXT_PUBLIC_MENU_BASE_DOMAIN` + rewrite no proxy) |
| 2026-08-04 | F4.4: complementos iFood → produtos + `produto_embalagem_acompanhamentos` (≤2) |
| 2026-08-11 | F5 registrada (não implementada): decisão de descontinuar WhatsApp Flow em favor do cardápio web (status do pedido + endereço/checkout via link com carrinho carregado) |
| 2026-08-13 | F5a–F5c: CTA cardápio/`?orders=1`, tabela `menu_handoffs` + token `hc`, pipeline sem Flow outbound |
