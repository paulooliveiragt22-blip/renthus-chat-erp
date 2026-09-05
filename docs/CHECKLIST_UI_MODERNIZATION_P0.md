# Checklist — UI modernization P0 (Radix/CVA, toast, skeleton, cmdk)

**ADR:** [`ADR/0009-ui-modernization-radix-cva.md`](./ADR/0009-ui-modernization-radix-cva.md)  
**Data:** 2026-09-05  
**Runtime:** Next.js App Router + Tailwind v4 + Radix + CVA + sonner + cmdk (Onda E)

Estado: `[ ]` pendente · `[~]` parcial · `[x]` feito + data · `[!]` bloqueado

**Ordem:** Onda A → B → C → D → E (não pular para Cmd+K antes de A+B).

---

## O0 — Decisões fechadas (não reabrir sem ADR)

| # | Decisão |
|---|--------|
| O0.1 | Primitivos = `components/ui/*` (Radix + CVA); telas novas não inventam Dialog/Select/Switch |
| O0.2 | Toast canônico = **sonner** (não Radix Toast em paralelo) |
| O0.3 | Skeleton canônico = **um** `ui/skeleton`; apagar cópias locais ao tocar o módulo |
| O0.4 | Motion default = `data-[state=*]` + CSS; Framer só com justificativa de layout |
| O0.5 | Cmd+K = navegação/busca; **sem** mutação de plano/checkout/seats |
| O0.6 | Ciclo Mensal\|Anual = tabs/ToggleGroup (não Switch booleano) — já alinhado em `BillingPeriodToggle` |
| O0.7 | Mutação de negócio continua API/RPC; UI só orquestra e exibe |

---

## Matriz — o que cada recurso melhora

| Recurso | Melhora (UX) | Melhora (eng) |
|---------|--------------|---------------|
| Completar `ui/*` (Tabs, Sheet, Tooltip, Dropdown, Skeleton, Toaster) | UI previsível; teclado/foco corretos | Um import; CVA tipado |
| Animate `data-state` em Dialog/Select/Sheet | Modais/menus não “saltam” | Classes únicas; sem JS extra |
| Sonner global | Sucesso/erro sem `alert` | Menos estado local de banner |
| Skeleton canônico | Load parece rápido; layout estável | Sem 4 Skeletons diferentes |
| `lib/orders/Modal` → Dialog | Pedidos/WhatsApp/fila com a11y | Uma correção, N telas |
| Select nos filtros/forms | Visual moderno + teclado | Menos CSS por página |
| Switch nos toggles caseiros | Estado on/off claro | Remove `role="switch"` manual |
| Tokens (border/primary/shadow) | Marca Renthus coerente | Dark mode barato |
| Cmd+K (cmdk) | Power user; menos mouse | Descoberta de rotas |

---

## Onda A — Foundation (design system)

> Entregar antes de qualquer migração de tela grande.

| # | Item | Arquivos criar / alterar | DoD | Estado |
|---|------|--------------------------|-----|--------|
| A1 | `Skeleton` canônico (CVA) | **Criar** `components/ui/skeleton.tsx` | Export `Skeleton`; `animate-pulse` + `bg-muted`/zinc token; usado em 1 tela piloto | [x] 2026-09-05 — piloto `financeiro/components/Skeleton` re-export |
| A2 | Toaster sonner no shell | **Criar** `components/ui/sonner.tsx` (wrapper); **Alterar** `components/Providers.tsx` | `<Toaster />` montado; `toast.success/error` funciona em qualquer rota admin | [x] 2026-09-05 — `Providers` + `TooltipProvider` |
| A3 | Tabs Radix | **Criar** `components/ui/tabs.tsx` | `data-[state=active]` estilizado; dark ok | [x] 2026-09-05 |
| A4 | Tooltip | **Criar** `components/ui/tooltip.tsx` | Delay sensato; a11y | [x] 2026-09-05 — delay 300ms no Provider |
| A5 | DropdownMenu | **Criar** `components/ui/dropdown-menu.tsx` | Usável no header (conta/workspace) | [x] 2026-09-05 |
| A6 | Sheet (mobile drawer) | **Criar** `components/ui/sheet.tsx` | Side + overlay; animate-in | [x] 2026-09-05 |
| A7 | Separator + ScrollArea (opcional A) | **Criar** `components/ui/separator.tsx` (± scroll-area) | Importável | [x] 2026-09-05 — Separator; ScrollArea adiado |
| A8 | Dialog/Select: garantir animate-in | **Alterar** `components/ui/dialog.tsx`, `components/ui/select.tsx`; **Alterar** `app/globals.css` se faltar utility | Open/close fade+zoom; sem regressão billing modals | [x] 2026-09-05 — Select + popover/sheet keyframes em globals |
| A9 | Doc rápida de uso | **Alterar** este checklist + nota no ADR se API divergir | Exemplos mínimos no ADR ou comentário no skeleton | [x] 2026-09-05 — bloco “Uso rápido” no ADR-0009 |

**Melhora da onda:** base para o resto; feedback e loading modernos sem tocar domínio.

---

## Onda B — Shared hubs (máxima alavancagem)

| # | Item | Arquivos criar / alterar | DoD | Estado |
|---|------|--------------------------|-----|--------|
| B1 | Modal pedidos → Dialog | **Alterar** `lib/orders/Modal.tsx`; consumidores: `NewOrderModal`, `EditOrderModal`, `ViewOrderModal`, `ActionModal`, WhatsApp modals que usam o hub | Esc fecha; focus trap; sem `showModal` | [x] 2026-09-05 — hub Radix; zClass no overlay+content |
| B2 | Workspace switcher → Select | **Alterar** `components/WorkspaceSwitcher.tsx` | Select Radix; erro via **toast** (não `alert`) | [x] 2026-09-05 |
| B3 | AdminShell order peek | **Alterar** `components/AdminShell.tsx` | Dialog ui; toast se aplicável | [x] 2026-09-05 — `Modal` + Skeleton |
| B4 | Remover / arquivar órfãos | **Alterar ou deletar** `components/billing/CheckoutModal.tsx`, `components/OrdersStatsModal.tsx` se sem imports | Zero dead modal nativo | [x] 2026-09-05 — deletados |
| B5 | Trocar `alert()` óbvios | Grep `alert(` → toast nos arquivos tocados | Nenhum `alert` nos hubs B | [x] 2026-09-05 — WorkspaceSwitcher |
| B6 | Financeiro Skeleton → ui | **Alterar** `app/(admin)/financeiro/components/Skeleton.tsx` → re-export de `ui/skeleton` **ou** substituir imports | Uma implementação | [x] 2026-09-05 — feito na Onda A |

**Melhora da onda:** pedidos + WhatsApp + shell sentem “SaaS moderno” de uma vez.

---

## Onda C — Revenue UX (PDV, produtos, plano/signup)

> Sem mudar regra comercial de billing — só UI/tokens.

| # | Item | Arquivos criar / alterar | DoD | Estado |
|---|------|--------------------------|-----|--------|
| C1 | PDV overlays → Dialog/Sheet | **Alterar** `app/(admin)/pdv/page.tsx` | Novo cliente, pagamento, caixa, sangria = Dialog/Sheet | [x] 2026-09-05 — Dialog (tema dark PDV) |
| C2 | PDV payment select + auto-print Switch | mesmo arquivo | Select + Switch ui | [x] 2026-09-05 |
| C3 | Produtos lista modais/selects | **Alterar** `app/(admin)/produtos/lista/ListaClient.tsx` | Dialog + Select; Skeleton ui | [x] 2026-09-05 — Dialog + Switch + Skeleton; selects densos de linha mantidos nativos |
| C4 | Plano/signup: só tokens + Button | **Alterar** `components/billing/PlanChangeCatalog.tsx`, `app/(public)/signup/page.tsx`, `BillingPeriodToggle.tsx` | Sem hex solto novo; cards+tabs mantidos; Button/tokens | [x] 2026-09-05 — cards `border-primary` |
| C5 | Mesa payment Select | **Alterar** `app/(admin)/mesa/page.tsx` | Select ui | [x] 2026-09-05 |
| C6 | e2e smoke UI críticos | **Alterar** `e2e/plano*.spec.ts` / pdv se selectors mudarem | Verde | [~] 2026-09-05 — sem mudança de selectors de texto; smoke adiado |

**Melhora da onda:** telas que geram receita com a11y e visual alinhados à marca.

---

## Onda D — Restante admin / platform / WhatsApp

| # | Item | Arquivos criar / alterar | DoD | Estado |
|---|------|--------------------------|-----|--------|
| D1 | Config toggles → Switch | **Alterar** `app/(admin)/configuracoes/page.tsx`, `impressoras/page.tsx`, `components/menu/MenuCardapioSettings.tsx`, `MarketplaceIfoodSettings.tsx` | Sem `role="switch"` caseiro | [x] 2026-09-05 |
| D2 | Config ConfirmDialog → Dialog | **Alterar** `configuracoes/page.tsx` | Dialog ui | [x] 2026-09-05 |
| D3 | Financeiro modais/selects | **Alterar** `JournalEntryModal.tsx`, `PagarTab.tsx`, `ReceberTab.tsx` | Dialog + Select | [x] 2026-09-05 |
| D4 | Clientes / entregadores / estoque | **Alterar** `clientes/page.tsx`, `entregadores/page.tsx`, `estoque/page.tsx` | Dialog (+ Select clientes) | [x] 2026-09-05 |
| D5 | Settings panels Select | **Alterar** `TeamMembersPanel.tsx`, `ServiceFeesPanel.tsx` | Select ui | [x] 2026-09-05 |
| D6 | WhatsApp inbox | **Alterar** `WhatsAppInbox.tsx`, `CartEditModal.tsx`, `BillingModal.tsx`, `QuickReplyModal.tsx` | Dialog/Select/Switch; toast | [x] 2026-09-05 |
| D7 | Templates / Campaigns Select | **Alterar** `TemplatesClient.tsx`, `CampaignsClient.tsx` | Select ui | [x] 2026-09-05 |
| D8 | Platform filters + empresas | **Alterar** `PlatformCompaniesFiltersBar.tsx`, `PlatformOrdersFiltersBar.tsx`, `PlatformObservabilityConsole.tsx`, `platform/empresas/*`, `platform/billing/page.tsx` (selects), `usuarios`, `feature-flags` | Select/Dialog/Switch | [x] 2026-09-05 |
| D9 | Skeletons locais → ui | **Alterar** `ListaClient`, `DashboardClient`, `impressoras` (remover Skeleton local) | Só `ui/skeleton` | [x] 2026-09-05 |

**Melhora da onda:** consistência total do ERP + platform.

---

## Onda E — Command menu (Cmd/Ctrl+K)

| # | Item | Arquivos criar / alterar | DoD | Estado |
|---|------|--------------------------|-----|--------|
| E1 | Dependência cmdk | `package.json` | `cmdk` instalado | [ ] |
| E2 | Command UI | **Criar** `components/ui/command.tsx` (cmdk + Dialog) | Estilo tokens Renthus | [ ] |
| E3 | Palette + registry | **Criar** `components/command/CommandMenu.tsx`, `components/command/commandItems.ts` | Grupos: Navegação, Clientes, Billing (só link), Workspace | [ ] |
| E4 | Hotkey no shell | **Alterar** `AdminShell.tsx` | Ctrl/Cmd+K; não em `/signup` standalone desnecessário | [ ] |
| E5 | RBAC nos itens | `commandItems.ts` + role do workspace | Member não vê ações admin | [ ] |
| E6 | Contrato: sem mutação billing | **Criar** `tests/ui/commandMenuContract.test.ts` (grep/source) | Não chama `change-plan` / checkout | [ ] |
| E7 | Busca cliente (fase 1 = navigate) | deep-link `/clientes?q=` ou focus | Documentado; busca full pode ser E+ | [ ] |

**Melhora da onda:** teclado-first; descoberta; parity com Linear/Vercel-style SaaS.

---

## Cronograma sugerido (calendário de PRs)

| Semana | Onda | PR sugerido |
|--------|------|-------------|
| 1 | A | `ui: skeleton + sonner + tabs/tooltip/sheet + animate` |
| 2 | B1–B3 | `ui: lib/orders Modal → Dialog + workspace Select` |
| 2–3 | B4–B6 | limpeza órfãos + toast alerts |
| 3–4 | C | PDV + produtos (+ tokens plano/signup) |
| 5–6 | D | config → financeiro → WhatsApp → platform (PRs por domínio) |
| 7 | E | Cmd+K |

Ajustar ao ritmo do time; **não** fundir C+D+E num único PR.

---

## Inventário de arquivos (visão consolidada)

### Criar

| Arquivo | Onda | Recurso |
|---------|------|---------|
| `components/ui/skeleton.tsx` | A | Skeleton |
| `components/ui/sonner.tsx` | A | Toast |
| `components/ui/tabs.tsx` | A | Tabs |
| `components/ui/tooltip.tsx` | A | Tooltip |
| `components/ui/dropdown-menu.tsx` | A | Menu |
| `components/ui/sheet.tsx` | A | Sheet |
| `components/ui/separator.tsx` | A | Separator |
| `components/ui/command.tsx` | E | cmdk wrapper |
| `components/command/CommandMenu.tsx` | E | Palette |
| `components/command/commandItems.ts` | E | Registry |
| `tests/ui/commandMenuContract.test.ts` | E | Guardrail |

### Alterar (hubs / foundation)

| Arquivo | Onda |
|---------|------|
| `components/AdminShell.tsx` | A, B, E |
| `components/ui/dialog.tsx` | A |
| `components/ui/select.tsx` | A |
| `app/globals.css` | A (se utilities) |
| `lib/orders/Modal.tsx` | B |
| `components/WorkspaceSwitcher.tsx` | B |

### Alterar (telas — ver ondas C/D para lista completa)

PDV, produtos lista, mesa, plano/signup (tokens), configuracoes, impressoras, financeiro tabs, clientes, entregadores, estoque, WhatsApp\*, settings panels, platform\*, templates, campaigns, DashboardClient (skeleton).

### Remover / fundir

| Arquivo | Ação |
|---------|------|
| Skeletons locais (financeiro, ListaClient, impressoras, DashboardClient) | Re-export ou delete após migração |
| `CheckoutModal.tsx` / `OrdersStatsModal.tsx` órfãos | Delete se sem imports |
| `PlanSelect.tsx` | Já removido (cards restaurados) — não recriar sem ADR |

---

## Critérios de fechamento P0

- [x] Ondas A + B `[x]`
- [x] Pelo menos PDV **ou** produtos (C1–C3) `[x]`
- [x] Onda D (admin/platform/WhatsApp) `[x]` 2026-09-05
- [ ] Zero `alert(` nos hubs AdminShell / WorkspaceSwitcher / orders Modal
- [ ] Cmd+K (E) opcional para fechar P0 — se adiado, marcar `[~]` no ADR e abrir P1 UI
- [ ] `npm test` / e2e críticos verdes nos módulos tocados

---

## Referências

- ADR-0009  
- `.cursor/rules/ui-expert.mdc`  
- Mapa Dialog/Select/Switch (chat 2026-09-05)  
- Billing UI já plugado: `PlanCheckoutModal`, `AddPaymentMethodModal`, `PlanChangeCatalog`, `BillingPeriodToggle`
