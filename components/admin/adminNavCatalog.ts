import {
  BarChart3,
  Bike,
  BookOpen,
  Bot,
  CircleDollarSign,
  ClipboardList,
  Clock,
  CreditCard,
  Headphones,
  LayoutDashboard,
  Megaphone,
  MessageCircle,
  Package,
  Percent,
  Printer,
  Radio,
  Receipt,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  Users,
  UtensilsCrossed,
  Wallet,
  FileText,
  type LucideIcon,
} from "lucide-react";

/** Destino navegável do admin (sempre Link). */
export type AdminNavLeaf = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  feature?: string;
  anyOf?: readonly string[];
  /** Match em /configuracoes?tab= */
  tab?: string;
  /** Atalho do header/dock. */
  primary?: boolean;
  shortLabel?: string;
};

export type AdminNavSectionId =
  | "operacao"
  | "whatsapp"
  | "catalogo"
  | "gestao"
  | "configuracoes";

export type AdminNavSection = {
  kind: "section";
  id: AdminNavSectionId;
  label: string;
  /** Ícone do flyout quando a sidebar está recolhida. */
  icon: LucideIcon;
  children: readonly AdminNavLeaf[];
};

export type AdminNavLone = {
  kind: "link";
} & AdminNavLeaf;

export type AdminNavEntry = AdminNavLone | AdminNavSection;

/**
 * Catálogo canônico da navegação admin.
 * Sidebar, (futuro) Cmd+K e atalhos primários leem daqui.
 */
export const ADMIN_NAV_CATALOG: readonly AdminNavEntry[] = [
  {
    kind: "link",
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    kind: "section",
    id: "operacao",
    label: "Operação",
    icon: Receipt,
    children: [
      {
        id: "pedidos",
        label: "Pedidos",
        href: "/pedidos",
        icon: Receipt,
        primary: true,
      },
      {
        id: "fila",
        label: "Fila",
        href: "/fila",
        icon: Clock,
        primary: true,
        shortLabel: "Fila",
      },
      {
        id: "pdv",
        label: "PDV / Balcão",
        href: "/pdv",
        icon: ShoppingCart,
        anyOf: ["pdv_basic", "pdv"],
        primary: true,
        shortLabel: "PDV",
      },
      {
        id: "mesa",
        label: "Mesas",
        href: "/mesa",
        icon: UtensilsCrossed,
        feature: "table_service",
      },
    ],
  },
  {
    kind: "section",
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    children: [
      {
        id: "whatsapp-inbox",
        label: "Inbox",
        href: "/whatsapp",
        icon: MessageCircle,
        primary: true,
        shortLabel: "Chat",
      },
      {
        id: "templates",
        label: "Templates",
        href: "/templates",
        icon: FileText,
        feature: "whatsapp_templates_broadcast",
      },
      {
        id: "campanhas",
        label: "Campanhas",
        href: "/campanhas",
        icon: Megaphone,
        feature: "whatsapp_templates_broadcast",
      },
    ],
  },
  {
    kind: "section",
    id: "catalogo",
    label: "Catálogo",
    icon: ShoppingBag,
    children: [
      {
        id: "produtos",
        label: "Produtos",
        href: "/produtos/lista",
        icon: ShoppingBag,
      },
      {
        id: "estoque",
        label: "Estoque",
        href: "/estoque",
        icon: Package,
        feature: "estoque_full",
      },
    ],
  },
  {
    kind: "link",
    id: "clientes",
    label: "Clientes",
    href: "/clientes",
    icon: Users,
  },
  {
    kind: "link",
    id: "entregadores",
    label: "Entregadores",
    href: "/entregadores",
    icon: Bike,
  },
  {
    kind: "section",
    id: "gestao",
    label: "Gestão",
    icon: Wallet,
    children: [
      {
        id: "financeiro",
        label: "Financeiro",
        href: "/financeiro",
        icon: Wallet,
        feature: "financeiro_full",
      },
      {
        id: "relatorios",
        label: "Relatórios",
        href: "/relatorios",
        icon: BarChart3,
        feature: "financeiro_full",
      },
      {
        id: "impressoras",
        label: "Impressoras",
        href: "/impressoras",
        icon: Printer,
        feature: "printing_auto",
      },
    ],
  },
  {
    kind: "section",
    id: "configuracoes",
    label: "Configurações",
    icon: Settings,
    children: [
      {
        id: "cfg-geral",
        label: "Geral",
        href: "/configuracoes",
        icon: Store,
        tab: "geral",
      },
      {
        id: "cfg-delivery",
        label: "Delivery",
        href: "/configuracoes?tab=delivery",
        icon: Truck,
        tab: "delivery",
      },
      {
        id: "cfg-taxas",
        label: "Taxas",
        href: "/configuracoes?tab=taxas",
        icon: Percent,
        tab: "taxas",
      },
      {
        id: "cfg-cardapio",
        label: "Cardápio web",
        href: "/configuracoes?tab=cardapio",
        icon: BookOpen,
        tab: "cardapio",
      },
      {
        id: "cfg-canais",
        label: "Canais",
        href: "/configuracoes?tab=canais",
        icon: Radio,
        tab: "canais",
      },
      {
        id: "cfg-plano",
        label: "Plano",
        href: "/plano",
        icon: CircleDollarSign,
      },
      {
        id: "cfg-pagamentos",
        label: "Pagamentos cliente",
        href: "/configuracoes?tab=formas_pagamento",
        icon: CreditCard,
        tab: "formas_pagamento",
      },
      {
        id: "cfg-seguranca",
        label: "Segurança",
        href: "/configuracoes?tab=seguranca",
        icon: Shield,
        tab: "seguranca",
      },
      {
        id: "cfg-chatbot",
        label: "Chatbot",
        href: "/configuracoes?tab=chatbot",
        icon: Bot,
        tab: "chatbot",
      },
      {
        id: "cfg-pedidos",
        label: "Pedidos (regras)",
        href: "/configuracoes?tab=pedidos",
        icon: ClipboardList,
        tab: "pedidos",
      },
    ],
  },
  {
    kind: "link",
    id: "suporte",
    label: "Suporte",
    href: "/suporte",
    icon: Headphones,
  },
] as const;

export function leafAllowed(
  item: Pick<AdminNavLeaf, "feature" | "anyOf">,
  featuresLoading: boolean,
  features: ReadonlySet<string>
): boolean {
  if (featuresLoading) return true;
  if (item.anyOf?.length) return item.anyOf.some((k) => features.has(k));
  if (item.feature) return features.has(item.feature);
  return true;
}

export function isAdminNavLeafActive(
  pathname: string | null,
  searchTab: string | null,
  item: Pick<AdminNavLeaf, "href" | "tab">
): boolean {
  if (!pathname) return false;

  if (item.href.startsWith("/configuracoes")) {
    if (pathname !== "/configuracoes") return false;
    const expected = (item.tab ?? "geral").toLowerCase();
    const current = (searchTab ?? "geral").toLowerCase();
    return current === expected;
  }

  if (item.href === "/plano" || item.href.startsWith("/plano?")) {
    return pathname === "/plano" || pathname.startsWith("/plano/");
  }

  const pathOnly = item.href.split("?")[0] ?? item.href;
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

export function filterAdminNavCatalog(
  featuresLoading: boolean,
  features: ReadonlySet<string>
): AdminNavEntry[] {
  const out: AdminNavEntry[] = [];
  for (const entry of ADMIN_NAV_CATALOG) {
    if (entry.kind === "link") {
      if (leafAllowed(entry, featuresLoading, features)) out.push(entry);
      continue;
    }
    const children = entry.children.filter((c) =>
      leafAllowed(c, featuresLoading, features)
    );
    if (children.length === 0) continue;
    out.push({ ...entry, children });
  }
  return out;
}

/** Ordem do dock/header: Chat → Pedidos → Fila → PDV (estável). */
const PRIMARY_ORDER = ["whatsapp-inbox", "pedidos", "fila", "pdv"] as const;

export function getAdminPrimaryNavItems(
  featuresLoading: boolean,
  features: ReadonlySet<string>
): AdminNavLeaf[] {
  const byId = new Map<string, AdminNavLeaf>();
  for (const entry of ADMIN_NAV_CATALOG) {
    const leaves = entry.kind === "link" ? [entry] : entry.children;
    for (const leaf of leaves) {
      if (!leaf.primary) continue;
      if (!leafAllowed(leaf, featuresLoading, features)) continue;
      byId.set(leaf.id, leaf);
    }
  }
  return PRIMARY_ORDER.map((id) => byId.get(id)).filter(
    (x): x is AdminNavLeaf => Boolean(x)
  );
}
