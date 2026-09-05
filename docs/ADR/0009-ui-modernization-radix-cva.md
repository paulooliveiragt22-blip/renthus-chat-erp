# ADR 0009 — UI moderna: design system Radix/CVA + polish SaaS

**Status:** aceito — Ondas A–E + polish F (P1) 2026-09-05  
**Data:** 2026-09-05  
**Escopo técnico:** primitivos `components/ui`, shell admin, feedback (toast/skeleton), command palette, animações `data-state`.  
**Escopo comercial:** **não** — sem mudar preço, planos, trial, features ou fluxo de cobrança. Atalhos de UI para billing só **navegam** para `/plano` (mutação continua nas RPCs/APIs canônicas).

**Checklist:** [`CHECKLIST_UI_MODERNIZATION_P0.md`](../CHECKLIST_UI_MODERNIZATION_P0.md)  
**Rules:** `.cursor/rules/ui-expert.mdc`, `arquitetura-lider.mdc` (Fase 1/2), `governanca-seguranca-negocio.mdc`  
**Diagnóstico prévio:** mapa Dialog/Select/Switch (billing já parcialmente plugado; resto do admin ainda nativo/`showModal`)

### Uso rápido (Onda A)

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner"; // Toaster já em Providers
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
```

`TooltipProvider` já envolve o app em `Providers`. Não remonte `<Toaster />` no AdminShell.

---

## Contexto

O app já tem:

| Ativo | Evidência |
|-------|-----------|
| Tokens de marca | `globals.css` — `#16364D` / `#57ff8f`, remap violet→primary |
| Tipografia | Geist (`--font-geist-sans`) |
| Primitivos parciais | `components/ui/{button,dialog,select,switch,input,card,label,badge}` |
| Toast | `sonner` em alguns módulos; **não** canônico no AdminShell |
| Motion | `framer-motion` no lockfile; uso pontual |
| Animate Dialog | utilitários `data-[state=open]:animate-in` em `globals.css` |
| Skeleton | **várias** cópias locais (financeiro, produtos, dashboard, impressoras) |

Dívida que faz a UI parecer “antiga”:

1. `<dialog>` / `showModal` / overlays `fixed` fora de Radix (`lib/orders/Modal`, PDV, produtos…).
2. `<select>` nativo e toggles `role="switch"` caseiros.
3. Feedback com `alert()`, banners ad-hoc e spinner full-page.
4. Inline styles pesados em superfícies públicas (ex.: `/signup`).
5. Sem atalho de teclado global (Cmd/Ctrl+K).

Pré-produção radical (`projeto-pre-producao-radical.mdc`): **um** design system — sem dual-path “botão antigo + Button novo” por tela; migrar o hub primeiro (`lib/orders/Modal`) e cascatear.

---

## Decisão

### D1 — Stack canônica de UI

| Camada | Escolha | Não fazer |
|--------|---------|-----------|
| Interação complexa | `@radix-ui/*` via `components/ui/*` | Reinventar Dialog/Select/Switch/Tabs com `useState` |
| Variantes | `class-variance-authority` + `cn()` | Ternários de className espalhados |
| Toast | **sonner** (já no repo) | Segundo stack `@radix-ui/react-toast` em paralelo |
| Command palette | **cmdk** + Dialog Radix | Mutar billing/plano direto do menu |
| Skeleton | **um** `components/ui/skeleton.tsx` | Novos Skeleton locais |
| Motion | Tailwind `data-[state=*]` + CSS já no globals; Framer **só** onde layout animation justifica | Framer em PDV/listas densas |
| Tipografia / tokens | Geist + `--color-primary/accent/border` | Hex solto / `bg-[#…]` em telas novas |

### D2 — Ondas (ordem cronológica obrigatória)

```
Onda A  Foundation     → ui/* faltantes + Toaster + Skeleton canônico + animate nos primitivos
Onda B  Shared hubs    → lib/orders/Modal → Dialog; WorkspaceSwitcher Select; alert→toast
Onda C  Revenue UX     → PDV / produtos / plano+signup tokens (sem mudar regra comercial)
Onda D  Rest admin     → config, financeiro, WhatsApp, platform filters
Onda E  Command menu   → Cmd+K (navegação + busca; deep-links)
```

**Regra:** não abrir Onda E antes de A+B (palette sobre API inconsistente de feedback/modais piora DX).

### D3 — Command menu: contrato de segurança

Comandos permitidos:

- Navegar rotas do tenant (`/pdv`, `/pedidos`, `/clientes`, `/plano`, …).
- Abrir busca de cliente / produto (deep-link ou focus no campo existente).
- Trocar workspace **via** fluxo já autenticado (`/api/workspace/select`).

Comandos **proibidos** no palette:

- `change-plan`, checkout, cancelar assinatura, alterar seats — só atalho “Ir para Plano e pagamentos”.
- Qualquer mutação que bypass RPC/API server-side.

### D4 — O que cada recurso melhora (produto)

| Recurso | Melhora |
|---------|---------|
| **Primitivos Radix + CVA** | A11y (foco, Esc, teclado), aparência consistente, menos bugs de overlay |
| **Toaster sonner global** | Confirmação não-bloqueante; menos `alert()`; feedback uniforme em mutações |
| **Skeleton canônico** | Percepção de velocidade; menos “spinner no vazio”; layout estável no load |
| **Animate `data-state`** | Entrada/saída de Dialog/Select/Sheet sem “pop” seco |
| **Tabs / ToggleGroup** | Filtros e ciclo Mensal\|Anual com estado visual claro (não Switch booleano indevido) |
| **Migrar Modal compartilhado** | Pedidos + WhatsApp + fila ganham Dialog de uma vez |
| **Cmd+K (cmdk)** | Power users; menos mouse; descoberta de rotas; parity com SaaS modernos |
| **Tokens (border/shadow/primary)** | Marca Renthus coerente; dark mode previsível |

### D5 — Fora de escopo desta ADR

- Redesign de marca / nova paleta.
- Trocar Tailwind/shadcn por outro kit (MUI, Chakra…).
- Dark-mode-first forçado em PDV.
- Unificar checkout público `/c/[slug]` drawers (Onda posterior opcional).
- Decisões de billing comercial (`DECISOES_NEGOCIO_*`).

---

## Consequências

**Positivas**

- Uma linguagem visual; onboarding de tela nova fica mecânico (`ui-expert`).
- Menos dívida de a11y e de z-index/modais empilhados.
- Sonner + Skeleton + Dialog animado = “cara de SaaS 2026” sem rewrite.

**Negativas / custo**

- PRs grandes se misturar ondas → **proibido**; um hub por PR preferível.
- cmdk exige catálogo de comandos mantido (rotas + RBAC).
- Migrar `lib/orders/Modal` exige regressão e2e pedidos/WhatsApp.

**Riscos**

| Risco | Mitigação |
|-------|-----------|
| Dual Button (raw `<button>` + `ui/button`) | Ao tocar a tela, CTAs primários migram no mesmo PR |
| Toast esconde erro de pagamento | Billing crítico mantém banner; toast = sucesso/info |
| Cmd+K vaza ação admin | Filtrar por role; sem mutação financeira |

---

## Alternativas rejeitadas

| Alternativa | Por quê não |
|-------------|-------------|
| Só “embelezar” com CSS ad-hoc | Não fecha a11y nem inconsistência de primitivos |
| Instalar kit completo shadcn CLI big-bang | Preferir componentes sob demanda, alinhados aos tokens Renthus |
| `@radix-ui/react-toast` + sonner | Duplicidade; sonner já adotado |
| Framer Motion como default de toda transição | Peso + ruído em telas densas (PDV) |

---

## Critérios de aceite (DoD da ADR)

1. Checklist [`CHECKLIST_UI_MODERNIZATION_P0.md`](../CHECKLIST_UI_MODERNIZATION_P0.md) Onda A `[x]` com Toaster no shell e `ui/skeleton` único.
2. `lib/orders/Modal` usa Dialog Radix (Onda B).
3. Nenhum comando Cmd+K muta billing direto (teste de contrato ou review checklist).
4. Documentado neste ADR + checklist; commits por onda, não monólito.

---

## Referências

- `.cursor/rules/ui-expert.mdc`
- `components/ui/*` (estado atual)
- `app/globals.css` (tokens + animate-in)
- Conversa de produto 2026-09-05: prioridade Sonner → Skeleton → animate → Cmd+K
