# Checklist — recursos MVP antes do lançamento

Origem: pontos do dono (2026-08-13). Este arquivo existe para **não perder contexto** entre
sessões. Atualizar `Estado` (`[ ]` → `[x]` + data) ao concluir cada item.

**Processo (2026-08-13):** propostas de estrutura de **todos** os itens pendentes → aprovação
do conjunto → sugestão de qual plano liga/bloqueia cada recurso → só então implementação
item a item (`apply_migration` MCP + `npm test`).

Regra: mutação só RPC/API server-side; frontend nunca acessa tabela crua; migrations com
FORCE RLS + `service_role_only` (ou view `v_sec_*` se o client precisar ler). Postura
pré-produção radical (`.cursor/rules/projeto-pre-producao-radical.mdc`).

**Leitura do banco remoto (disk bebidas, 2026-08-13) usada como ponto de partida** — não
inventar coluna/status que já exista com outro nome.

---

## Resumo

| # | Item | Planos (proposta inicial — ajustar na implementação) | Estado |
|---|------|------------------------------------------------------|--------|
| M1 | Entrega vs retirar no local + liga/desliga entregas (bot + cardápio) | todos (`web_menu` + WhatsApp) | [x] 2026-08-13 |
| M2 | Horário de atendimento + descrição do delivery (bot + cardápio) | todos | [ ] |
| M3 | Cadastro de usuários com permissões (admin cria) | Pro + Market (`staff_users`) | [ ] |
| M4 | Impressão 3 vias (entregador / cozinha / caixa) + reimprimir por via | Pro + Market (`printing_auto`) | [ ] |
| M5 | Status `preparing` + notificar cliente | todos com pedidos | [ ] |
| M6 | Limpar fila de impressão | Pro + Market (`printing_auto`) | [ ] |
| M7 | Integridade financeira (dashboard / pedidos / extrato = valores reais) | Pro + Market (`financeiro_full`); dashboard Essencial só o que o plano mostra | [ ] |
| M0 | Feature flags por plano para os recursos novos | catálogo `features` / `plan_features` | [ ] |

M0 não é tela: cada item M1–M6 declara a `feature_key` e o seed no mesmo commit da
implementação. M7 é correção de contrato de dinheiro, não um toggle de produto.

---

## Estado atual do remoto (achados)

### Pedidos
- `orders.status` CHECK: `new | canceled | delivered | finalized`. **Não existe** `preparing`.
- Contagem atual: 176 `new`, 28 `finalized`, 7 `delivered`, 2 `canceled`.
- Constraint `orders.total_amount = total + delivery_fee`.
- `create_order_with_items` **não** tem fulfillment (entrega/retirada). Sempre endereço + taxa.
- Canais/sources já cobrem WhatsApp, `web_menu`, PDV, marketplace.

### Delivery
- `company_delivery_policy`: cidade, modo (`all_city` / `allow_list` / `deny_list`), zona.
  **Não** tem `deliveries_enabled`, `pickup_enabled`, horário nem descrição.
- `companies.delivery_fee_enabled` liga **taxa**, não o serviço de entrega. UI de Configurações
  trata isso como “entrega ligada” — ambíguo; MVP precisa separar.
- `companies.settings` jsonb (poucas empresas): `delivery_min_order`, `delivery_est_minutes`,
  `delivery_free_above`, flags de impressão. **Não** há `open_time`/`close_time` gravados, embora
  o worker de outbound já *leia* `settings.open_time` / `close_time` (sempre null hoje).
- Chatbot e cardápio web **obrigam endereço** para fechar pedido.

### Usuários
- `company_users.role` CHECK: `owner | admin | staff`. No remoto **só existem owners** (8).
- Não há tela/API de convite. Signup cria `owner`. `requireCompanyAccess` já filtra por role.

### Impressão
- `print_jobs.status` enum: `pending | processing | done | failed`. Sem “cancelado”.
- `printers.type`: `receipt` / `a4` — **não** é via (cozinha/caixa/entregador).
- `companies.settings.print_delivery_copy` e `hide_prices_kitchen` já existem (boolean).
- Reprint (`POST /api/agent/reprint`) enfileira 1 job genérico, sem escolher via.
- Sem RPC de limpar fila.

### Financeiro
- `financial_entries` só nasce no trigger `fn_create_financial_entry_on_finalize` quando
  `status` vira `finalized` **e** `sale_id` é null (PDV não duplica).
- Dashboard (`/api/dashboard/stats`) soma `orders.total_amount` de **todos os não-cancelados
  do dia**, inclusive `new` (pedido aberto, dinheiro ainda não realizado). Pedidos e
  financeiro divergem — este é o vazamento/perda do item 7.
- `financial_entries.origin` no remoto: `balcao`, `chatbot`, `flow_catalog`, `ui_order`
  (só `income`).

### Planos (já no remoto)
| Plano | Features |
|-------|----------|
| Essencial | whatsapp, IA, web_menu, pdv_basic, packs |
| Pro | + pdv, printing_auto, estoque_full, financeiro_full |
| Market | + iFood, Aiqfome, IG/Messenger, mesa |

Keys novas a seedar quando o item correspondente entrar: `staff_users` (M3). M1/M2/M5
andam no núcleo (sem key nova, ou `fulfillment_modes` se quiser vender pickup só no Pro —
decisão na estrutura de cada item).

---

## M1 — Entrega ou retirar no local + liga/desliga entregas

**Objetivo:** cliente escolhe **entrega** ou **retirada** no chatbot e no cardápio web.
Loja liga/desliga entregas (e, simétrico, retirada) na UI admin; os dois canais respeitam
o mesmo canônico. Entrega desligada → não pede endereço nem cobra taxa; só retirada.

**Não confundir** com `companies.delivery_fee_enabled` (taxa).

**Arquivos / contratos (a detalhar na estrutura aprovada):**
- Colunas em `company_delivery_policy` (canônico).
- `orders.fulfillment_type` + RPC `create_order_with_items`.
- Cardápio checkout + pipeline PRO + Configurações delivery.

**Resultado esperado:** um toggle na loja reflete imediatamente no bot e no `/c/[slug]`.
Pedido retirada: `delivery_fee = 0`, endereço opcional, status/impressão mostram “Retirada”.

**Estado:** [x] 2026-08-13 — `company_delivery_policy.deliveries_enabled` / `pickup_enabled`;
`orders.fulfillment_type`; RPC `create_order_with_items` (`p_fulfillment_type`); chatbot
(botões Entrega / Retirar no local); cardápio (`CheckoutDrawer`); Configurações Delivery
(toggles separados da taxa).

---

## M2 — Horário de atendimento + descrição do delivery

**Objetivo:** horário (abre/fecha, fuso) e texto de descrição (ex.: “entregamos até 3 km”)
cadastrados uma vez; chatbot, cardápio e outbound (já tem gate `isWithinBusinessHours`)
consomem a **mesma** fonte. Fora do horário: cardápio não fecha pedido; bot informa o
horário em PT-BR.

**Não** deixar só em `companies.settings` jsonb — coluna tipada (radical). Candidato:
`company_settings` (hoje só `require_order_approval`, `auto_print_orders`, `llm_provider`).

**Depende de:** M1 para copy “entregas pausadas vs loja fechada”.

**Estado:** [ ]

---

## M3 — Usuários e permissões

**Objetivo:** `owner`/`admin` cria usuário (e-mail + senha inicial ou convite), escolhe
`admin` ou `staff`, ativa/desativa. Permissões = role existente + gate por feature do plano.
Sem role nova no CHECK até haver caso de uso (cozinha vs caixa pode esperar M4 se precisar
de role `kitchen`).

**Fora do client:** `auth.admin.createUser` + insert `company_users` só em API/RPC.
Feature `staff_users`: Pro + Market. Essencial = só o owner.

**Estado:** [ ]

---

## M4 — Três vias de impressão + reimprimir por via

**Objetivo:** ao imprimir (auto e reprint), gerar vias `kitchen | cashier | driver`.
UI de reimpressão pergunta **qual via**. Cozinha pode omitir preços se
`hide_prices_kitchen`. Entregador só em pedido `delivery` (M1).

**Canônico:** `print_jobs.meta.copy` (ou coluna `copy_type`) — `printers.type` continua
formato físico (receipt/a4), não a via.

**Estado:** [ ]

---

## M5 — Status em preparo + notificar cliente

**Objetivo:** ampliar CHECK de `orders.status` com `preparing`. Cozinha/admin marca
“em preparo” → WhatsApp/IG/Messenger (se houver identidade) avisa em PT-BR. Transições
canônicas: `new → preparing → delivered | finalized | canceled` (retirada: preparing →
finalized sem `delivered`, a definir na estrutura).

Dashboard “pedidos ativos” passa a incluir `preparing`.

**Estado:** [ ]

---

## M6 — Limpar fila de impressão

**Objetivo:** ação admin (owner/admin) cancela jobs `pending` (e opcionalmente `failed`)
da empresa. Jobs `processing` não matar no agente no ar — marcar `failed`/`canceled` com
motivo. RPC transacional + botão na UI de impressoras.

**Estado:** [ ]

---

## M7 — Integridade de valores (dashboard, pedidos, financeiro)

**Objetivo:** uma definição canônica de “receita realizada” vs “pedido em aberto”. Hoje o
dashboard trata `new` como faturamento; o extrato só vê `financial_entries` no
`finalized`. Isso **inventa receita** e **esconde** o que ainda não foi recebido.

Correção radical (proposta a detalhar na estrutura do item):
- Dashboard: faturamento do dia = `financial_entries` `type=income` `status=received`
  do dia **ou** pedidos `finalized`/`delivered` com entrada correspondente — nunca `new`.
- Pedidos: `total` / `delivery_fee` / `total_amount` continuam a constraint; retirada
  zera taxa (M1).
- Extrato: mesma fonte que o dashboard para “entradas”.
- Trigger de finalize permanece a única mutação de receita de pedido (sem dual-write
  no client).
- Testes de invariante: soma dashboard = soma extrato no mesmo recorte; cancelado nunca
  entra; PDV (`sale_id`) não duplica com o trigger.

**Estado:** [ ]

---

## Ordem de implementação

1. M1 (fulfillment) — desbloqueia M4 via entregador e M5 via retirada.
2. M2 (horário) — usa o mesmo policy de M1.
3. M5 (preparing + notify).
4. M4 + M6 (impressão).
5. M3 (usuários).
6. M7 (financeiro) — por último para incorporar taxa zero de retirada e status novos.

---

## Registro

| Data | Nota |
|------|------|
| 2026-08-13 | Checklist criado após inspeção do schema remoto (MCP supabase) + conferência de planos/features |
| 2026-08-13 | M1 aplicado no remoto. Processo: propostas do restante em lote; flags de plano depois da aprovação; implementação só então |
