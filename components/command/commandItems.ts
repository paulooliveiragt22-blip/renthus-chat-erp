import type { CompanyRole } from "@/lib/workspace/staffRoles";

export type CommandGroupId = "navegacao" | "clientes" | "billing" | "workspace";

export type CommandNavItem = {
  id: string;
  label: string;
  href: string;
  group: Exclude<CommandGroupId, "workspace">;
  keywords?: string[];
  /** Se definido, só esses papéis veem o item. */
  roles?: readonly CompanyRole[];
  feature?: string;
  anyOf?: readonly string[];
};

/**
 * Catálogo estático do Cmd+K.
 * Contrato: só navegação / deep-link — sem mutação de plano, cobrança ou seats.
 */
export const COMMAND_NAV_ITEMS: readonly CommandNavItem[] = [
  {
    id: "nav-dashboard",
    label: "Dashboard",
    href: "/dashboard",
    group: "navegacao",
    keywords: ["inicio", "home"],
  },
  {
    id: "nav-pedidos",
    label: "Pedidos",
    href: "/pedidos",
    group: "navegacao",
  },
  {
    id: "nav-fila",
    label: "Fila de pedidos",
    href: "/fila",
    group: "navegacao",
    keywords: ["fila"],
  },
  {
    id: "nav-pdv",
    label: "PDV / Balcão",
    href: "/pdv",
    group: "navegacao",
    keywords: ["caixa", "venda"],
    anyOf: ["pdv_basic", "pdv"],
  },
  {
    id: "nav-mesa",
    label: "Mesas",
    href: "/mesa",
    group: "navegacao",
    feature: "table_service",
  },
  {
    id: "nav-whatsapp",
    label: "WhatsApp",
    href: "/whatsapp",
    group: "navegacao",
    keywords: ["chat", "inbox"],
  },
  {
    id: "nav-templates",
    label: "Templates WA",
    href: "/templates",
    group: "navegacao",
    feature: "whatsapp_templates_broadcast",
  },
  {
    id: "nav-campanhas",
    label: "Campanhas",
    href: "/campanhas",
    group: "navegacao",
    feature: "whatsapp_templates_broadcast",
  },
  {
    id: "nav-produtos",
    label: "Produtos",
    href: "/produtos/lista",
    group: "navegacao",
    keywords: ["cardapio", "estoque produto"],
  },
  {
    id: "nav-clientes",
    label: "Clientes",
    href: "/clientes",
    group: "navegacao",
    keywords: ["crm"],
  },
  {
    id: "nav-entregadores",
    label: "Entregadores",
    href: "/entregadores",
    group: "navegacao",
  },
  {
    id: "nav-estoque",
    label: "Estoque",
    href: "/estoque",
    group: "navegacao",
    feature: "estoque_full",
  },
  {
    id: "nav-financeiro",
    label: "Financeiro",
    href: "/financeiro",
    group: "navegacao",
    feature: "financeiro_full",
    roles: ["owner", "admin"],
  },
  {
    id: "nav-relatorios",
    label: "Relatórios",
    href: "/relatorios",
    group: "navegacao",
    feature: "financeiro_full",
    roles: ["owner", "admin"],
  },
  {
    id: "nav-impressoras",
    label: "Impressoras",
    href: "/impressoras",
    group: "navegacao",
    feature: "printing_auto",
  },
  {
    id: "nav-suporte",
    label: "Suporte",
    href: "/suporte",
    group: "navegacao",
  },
  {
    id: "nav-config",
    label: "Configurações",
    href: "/configuracoes",
    group: "navegacao",
    keywords: ["settings", "equipe"],
    roles: ["owner", "admin"],
  },
  {
    id: "clientes-buscar",
    label: "Buscar cliente…",
    href: "/clientes",
    group: "clientes",
    keywords: ["procurar", "pesquisa", "cliente"],
  },
  {
    id: "billing-plano",
    label: "Plano e pagamentos",
    href: "/plano",
    group: "billing",
    keywords: ["assinatura", "cobranca", "billing", "upgrade"],
    roles: ["owner", "admin"],
  },
] as const;

export const COMMAND_GROUP_LABELS: Record<CommandGroupId, string> = {
  navegacao: "Navegação",
  clientes: "Clientes",
  billing: "Billing",
  workspace: "Workspace",
};

export type FilterCommandItemsInput = {
  items?: readonly CommandNavItem[];
  role: CompanyRole | null;
  /** Fail-open quando features ainda carregam (igual sidebar). */
  featuresLoading: boolean;
  features: ReadonlySet<string>;
};

export function filterCommandNavItems({
  items = COMMAND_NAV_ITEMS,
  role,
  featuresLoading,
  features,
}: FilterCommandItemsInput): CommandNavItem[] {
  return items.filter((item) => {
    if (item.roles?.length) {
      if (!role || !item.roles.includes(role)) return false;
    }
    if (featuresLoading) return true;
    if (item.anyOf?.length) return item.anyOf.some((k) => features.has(k));
    if (item.feature) return features.has(item.feature);
    return true;
  });
}

/** Deep-link fase 1: busca em clientes via query string. */
export function clientesSearchHref(query: string): string {
  const q = query.trim();
  if (!q) return "/clientes";
  return `/clientes?q=${encodeURIComponent(q)}`;
}

/** Strings proibidas no source do palette (contrato E6). */
export const COMMAND_MENU_FORBIDDEN_SUBSTRINGS = [
  "change-plan",
  "create-invoice-checkout",
  "/api/billing/checkout",
  "ensurePlanUpgradeCheckout",
  "cancelSubscription",
  "updateSeats",
] as const;
