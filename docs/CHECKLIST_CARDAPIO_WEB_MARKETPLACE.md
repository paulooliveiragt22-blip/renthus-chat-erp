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
| F0.1 | Coluna/tabela `company_menu_profile`: `slug` único, nome exibição, logo, WhatsApp, ativo | [ ] | |
| F0.2 | Flag produto `show_on_menu` (ou só ativos + com preço) | [ ] | |
| F0.3 | Gerar/editar slug na UI Configurações / Produtos | [ ] | |
| F0.4 | API `GET /api/public/menu/[slug]` (categorias, itens, preço, foto, descrição) | [ ] | Rate limit |
| F0.5 | Página pública `/c/[slug]` mobile-first (lista + foto + preço) | [ ] | Sem cards genéricos excessivos; 1 composição |
| F0.6 | Link copiável no admin + QR code | [ ] | |
| F0.7 | Analytics mínimo: view por slug + `visitor_id` | [ ] | Tabela `menu_page_events` |

### F1 — Sync marketplace (iFood primeiro)

| # | Item | Estado | Notas |
|---|------|--------|-------|
| F1.1 | Tabela `marketplace_connections` (company, provider, merchant_id, tokens encrypted, status) | [ ] | |
| F1.2 | Tabela `marketplace_catalog_map` (external_id → product_id / embalagem_id) | [ ] | |
| F1.3 | Adapter `src/marketplaces/adapters/ifood` (auth + Catalog API list) | [ ] | Mock até credenciais |
| F1.4 | Job import: categoria, nome, descrição, preço → `products` + `produto_embalagens` | [ ] | UN padrão |
| F1.5 | Download foto → Storage → `product_images` | [ ] | |
| F1.6 | UI: Conectar iFood + **Importar / Sincronizar cardápio** | [ ] | Botão manual |
| F1.7 | Exibir “Última sync” + contadores (criados/atualizados/erros) | [ ] | |
| F1.8 | Conta iFood Developer + homologação (ops, fora do código) | [ ] | Bloqueante produção |

### F2 — Pedido a partir do cardápio web

| # | Item | Estado | Notas |
|---|------|--------|-------|
| F2.1 | Carrinho no browser + resumo | [ ] | |
| F2.2 | CTA WhatsApp com texto do pedido (deep link `wa.me`) | [ ] | MVP pedido |
| F2.3 | (Opcional) Checkout web → `create_order_with_items` + `source=web_menu` | [ ] | |
| F2.4 | Endereço / taxa delivery (reusar policy Renthus) | [ ] | |
| F2.5 | Identificar cliente por telefone se já existir em `customers` | [ ] | |

### F3 — Aiqfome + pedidos marketplace

| # | Item | Estado | Notas |
|---|------|--------|-------|
| F3.1 | Adapter Aiqfome no mesmo port de catálogo | [ ] | Mesmo botão sync |
| F3.2 | Pedidos inbound iFood → `orders` + Fila | [ ] | Após catálogo estável |
| F3.3 | Status Renthus → marketplace (confirm/dispatch) | [ ] | |
| F3.4 | Homologação pedidos iFood | [ ] | |

### F4 — Evoluções

| # | Item | Estado | Notas |
|---|------|--------|-------|
| F4.1 | Cron sync opcional (1–6h) se conexão ativa | [ ] | |
| F4.2 | Painel analytics (visitas, top produtos, origem UTM) | [ ] | |
| F4.3 | Subdomínio custom / domínio próprio | [ ] | |
| F4.4 | Complementos/opcionais iFood → acompanhamentos | [ ] | |
| F4.5 | Cardápio web com fotos no Flow (só destaques) | [ ] | Opcional |

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

## Registro

| Data | Nota |
|------|------|
| 2026-08-01 | Checklist criado; decisão: menu no Renthus + sync manual; web Next.js `/c/[slug]` |
