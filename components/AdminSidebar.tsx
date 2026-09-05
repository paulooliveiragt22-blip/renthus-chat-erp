"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import {
  Bike,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Headphones,
  LayoutDashboard,
  MessageCircle,
  Moon,
  BarChart3,
  Package,
  Printer,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sun,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
  FileText,
  Megaphone,
  type LucideIcon,
} from "lucide-react";
import { usePlanFeatures } from "@/lib/billing/usePlanFeatures";
import { cn } from "@/lib/utils";

type FeatureKey = string;

type NavLeaf = {
  kind: "link";
  label: string;
  href: string;
  icon: LucideIcon;
  feature?: FeatureKey;
  anyOf?: readonly FeatureKey[];
  /** Match por query (?tab=) em /configuracoes */
  tab?: string;
};

type NavGroup = {
  kind: "group";
  id: string;
  label: string;
  icon: LucideIcon;
  children: NavLeaf[];
};

type NavEntry = NavLeaf | NavGroup;

const adminNav: readonly NavEntry[] = [
  { kind: "link", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    kind: "group",
    id: "operacao",
    label: "Operação",
    icon: Receipt,
    children: [
      { kind: "link", label: "Pedidos", href: "/pedidos", icon: Receipt },
      { kind: "link", label: "Fila", href: "/fila", icon: Clock },
      { kind: "link", label: "PDV / Balcão", href: "/pdv", icon: ShoppingCart, anyOf: ["pdv_basic", "pdv"] },
      { kind: "link", label: "Mesas", href: "/mesa", icon: UtensilsCrossed, feature: "table_service" },
    ],
  },
  {
    kind: "group",
    id: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    children: [
      { kind: "link", label: "Inbox", href: "/whatsapp", icon: MessageCircle },
      { kind: "link", label: "Templates", href: "/templates", icon: FileText, feature: "whatsapp_templates_broadcast" },
      { kind: "link", label: "Campanhas", href: "/campanhas", icon: Megaphone, feature: "whatsapp_templates_broadcast" },
    ],
  },
  {
    kind: "group",
    id: "catalogo",
    label: "Catálogo",
    icon: ShoppingBag,
    children: [
      { kind: "link", label: "Produtos", href: "/produtos/lista", icon: ShoppingBag },
      { kind: "link", label: "Estoque", href: "/estoque", icon: Package, feature: "estoque_full" },
    ],
  },
  { kind: "link", label: "Clientes", href: "/clientes", icon: Users },
  { kind: "link", label: "Entregadores", href: "/entregadores", icon: Bike },
  {
    kind: "group",
    id: "financeiro",
    label: "Financeiro",
    icon: Wallet,
    children: [
      { kind: "link", label: "Caixa e lançamentos", href: "/financeiro", icon: Wallet, feature: "financeiro_full" },
      { kind: "link", label: "Relatórios", href: "/relatorios", icon: BarChart3, feature: "financeiro_full" },
    ],
  },
  { kind: "link", label: "Impressoras", href: "/impressoras", icon: Printer, feature: "printing_auto" },
  { kind: "link", label: "Suporte", href: "/suporte", icon: Headphones },
  {
    kind: "group",
    id: "config",
    label: "Configurações",
    icon: Settings,
    children: [
      { kind: "link", label: "Geral", href: "/configuracoes", icon: Settings, tab: "geral" },
      { kind: "link", label: "Delivery", href: "/configuracoes?tab=delivery", icon: Settings, tab: "delivery" },
      { kind: "link", label: "Taxas", href: "/configuracoes?tab=taxas", icon: Settings, tab: "taxas" },
      { kind: "link", label: "Cardápio web", href: "/configuracoes?tab=cardapio", icon: Settings, tab: "cardapio" },
      { kind: "link", label: "Canais", href: "/configuracoes?tab=canais", icon: Settings, tab: "canais" },
      { kind: "link", label: "Plano", href: "/plano", icon: Wallet },
      { kind: "link", label: "Pagamentos cliente", href: "/configuracoes?tab=formas_pagamento", icon: Wallet, tab: "formas_pagamento" },
      { kind: "link", label: "Segurança", href: "/configuracoes?tab=seguranca", icon: Settings, tab: "seguranca" },
      { kind: "link", label: "Chatbot", href: "/configuracoes?tab=chatbot", icon: MessageCircle, tab: "chatbot" },
      { kind: "link", label: "Pedidos (regras)", href: "/configuracoes?tab=pedidos", icon: Package, tab: "pedidos" },
    ],
  },
] as const;

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function leafAllowed(
  item: NavLeaf,
  featuresLoading: boolean,
  features: ReadonlySet<string>
): boolean {
  if (featuresLoading) return true;
  if (item.anyOf?.length) return item.anyOf.some((k) => features.has(k));
  if (item.feature) return features.has(item.feature);
  return true;
}

function pathMatchesLeaf(pathname: string | null, searchTab: string | null, item: NavLeaf): boolean {
  if (!pathname) return false;

  if (item.href.startsWith("/configuracoes")) {
    if (pathname !== "/configuracoes") return false;
    const expected = item.tab ?? "geral";
    const current = (searchTab ?? "geral").toLowerCase();
    return current === expected;
  }

  if (item.href.startsWith("/plano")) {
    return pathname === "/plano" || pathname.startsWith("/plano/");
  }

  const pathOnly = item.href.split("?")[0] ?? item.href;
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

function groupIsActive(
  group: NavGroup,
  pathname: string | null,
  searchTab: string | null
): boolean {
  return group.children.some((c) => pathMatchesLeaf(pathname, searchTab, c));
}

function NavLinkRow({
  item,
  pathname,
  searchTab,
  collapsed,
  nested,
}: Readonly<{
  item: NavLeaf;
  pathname: string | null;
  searchTab: string | null;
  collapsed: boolean;
  nested?: boolean;
}>) {
  const Icon = item.icon;
  const active = pathMatchesLeaf(pathname, searchTab, item);

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center rounded-lg py-2 text-xs font-medium transition-all duration-150",
        collapsed ? "justify-center px-0" : "gap-3 px-3",
        nested && !collapsed && "py-1.5 pl-3",
        active
          ? "bg-white/15 text-white shadow-sm"
          : "text-white/70 hover:bg-white/[0.08] hover:text-white"
      )}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_rgba(87,255,143,0.8)]" />
      )}
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-md transition-colors",
          nested && !collapsed ? "h-6 w-6" : "h-7 w-7",
          active
            ? "bg-white/20 text-white"
            : "bg-white/5 text-white/60 group-hover:bg-white/10 group-hover:text-white"
        )}
      >
        <Icon className={cn(nested && !collapsed ? "h-3 w-3" : "h-3.5 w-3.5")} />
      </div>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function NavGroupBlock({
  group,
  pathname,
  searchTab,
  collapsed,
  open,
  onToggle,
}: Readonly<{
  group: NavGroup;
  pathname: string | null;
  searchTab: string | null;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
}>) {
  const Icon = group.icon;
  const active = groupIsActive(group, pathname, searchTab);
  const firstHref = group.children[0]?.href ?? "#";

  if (collapsed) {
    return (
      <Link
        href={firstHref}
        title={group.label}
        className={cn(
          "group relative flex items-center justify-center rounded-lg py-2.5 transition-all duration-150",
          active
            ? "bg-white/15 text-white shadow-sm"
            : "text-white/70 hover:bg-white/[0.08] hover:text-white"
        )}
      >
        {active && (
          <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_rgba(87,255,143,0.8)]" />
        )}
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md",
            active ? "bg-white/20 text-white" : "bg-white/5 text-white/60"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
      </Link>
    );
  }

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-all duration-150",
          active
            ? "bg-white/10 text-white"
            : "text-white/70 hover:bg-white/[0.08] hover:text-white"
        )}
      >
        {active && (
          <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_rgba(87,255,143,0.8)]" />
        )}
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
            active ? "bg-white/20 text-white" : "bg-white/5 text-white/60 group-hover:bg-white/10"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-white/50 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="ml-3 space-y-0.5 border-l border-white/10 pl-2">
          {group.children.map((child) => (
            <NavLinkRow
              key={child.href}
              item={child}
              pathname={pathname}
              searchTab={searchTab}
              collapsed={false}
              nested
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminSidebar({
  isOpen,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchTab = searchParams.get("tab");
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { loading: featuresLoading, features } = usePlanFeatures();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => setMounted(true), []);

  // Fecha sidebar ao navegar (mobile)
  useEffect(() => {
    onClose();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleNav = useMemo(() => {
    const out: NavEntry[] = [];
    for (const entry of adminNav) {
      if (entry.kind === "link") {
        if (leafAllowed(entry, featuresLoading, features)) out.push(entry);
        continue;
      }
      const children = entry.children.filter((c) => leafAllowed(c, featuresLoading, features));
      if (children.length === 0) continue;
      if (children.length === 1) {
        out.push(children[0]!);
        continue;
      }
      out.push({ ...entry, children });
    }
    return out;
  }, [featuresLoading, features]);

  // Auto-abre o grupo da rota atual (sem fechar os que o usuário abriu manualmente).
  useEffect(() => {
    setOpenGroups((prev) => {
      const next = { ...prev };
      for (const entry of visibleNav) {
        if (entry.kind !== "group") continue;
        if (groupIsActive(entry, pathname, searchTab)) next[entry.id] = true;
      }
      return next;
    });
  }, [pathname, searchTab, visibleNav]);

  const isDark = theme === "dark";

  return (
    <aside
      className={cn(
        "flex flex-col overflow-hidden bg-primary text-zinc-50",
        "transition-all duration-300 ease-in-out",
        "fixed inset-y-0 left-0 z-50 h-full",
        isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
        "lg:static lg:inset-auto lg:z-auto lg:h-full lg:translate-x-0 lg:shadow-none",
        collapsed ? "w-16" : "w-64 lg:w-60"
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-white/10 py-4",
          collapsed ? "justify-center px-0" : "gap-3 px-5"
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center">
          <img
            src="/brand/renthus-mark-on-dark.svg?v=mark9"
            alt={collapsed ? "RenthusAgent" : ""}
            width={36}
            height={36}
            className="h-9 w-9 object-contain object-center drop-shadow-[0_0_12px_rgba(87,255,143,0.45)]"
          />
        </span>

        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-wide">RenthusAgent</div>
            <div className="text-[10px] font-medium text-white/50">Painel Administrativo</div>
          </div>
        )}

        {!collapsed && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar menu"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto scrollbar-hide px-2 py-4">
        {visibleNav.map((entry) => {
          if (entry.kind === "link") {
            return (
              <NavLinkRow
                key={entry.href}
                item={entry}
                pathname={pathname}
                searchTab={searchTab}
                collapsed={collapsed}
              />
            );
          }
          return (
            <NavGroupBlock
              key={entry.id}
              group={entry}
              pathname={pathname}
              searchTab={searchTab}
              collapsed={collapsed}
              open={openGroups[entry.id] ?? false}
              onToggle={() =>
                setOpenGroups((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))
              }
            />
          );
        })}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-white/10 px-2 py-3">
        <button
          type="button"
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label="Alternar tema"
          title={collapsed ? (isDark ? "Modo Claro" : "Modo Escuro") : undefined}
          className={cn(
            "flex w-full items-center rounded-lg py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.08] hover:text-white",
            collapsed ? "justify-center px-0" : "gap-3 px-3"
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5">
            {mounted ? (
              isDark ? (
                <Sun className="h-3.5 w-3.5 text-yellow-300" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-white/70" />
              )
            ) : (
              <span className="h-3.5 w-3.5" />
            )}
          </div>
          {!collapsed && (
            <>
              <span>{mounted && isDark ? "Modo Claro" : "Modo Escuro"}</span>
              {mounted && (
                <span
                  className={cn(
                    "ml-auto inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold",
                    isDark ? "bg-yellow-400/20 text-yellow-300" : "bg-white/10 text-white/50"
                  )}
                >
                  {isDark ? "Escuro" : "Claro"}
                </span>
              )}
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className={cn(
            "hidden w-full items-center rounded-lg py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.08] hover:text-white lg:flex",
            collapsed ? "justify-center px-0" : "gap-3 px-3"
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5">
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronLeft className="h-3.5 w-3.5" />
            )}
          </div>
          {!collapsed && <span>Recolher</span>}
        </button>

        {!collapsed && (
          <div className="rounded-xl bg-white/5 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-white">Dica rápida</p>
            <p className="mt-1 text-[10px] leading-relaxed text-white/50">
              Pressione{" "}
              <kbd className="rounded bg-white/10 px-1 font-semibold text-accent">Ctrl</kbd>+
              <kbd className="rounded bg-white/10 px-1 font-semibold text-accent">K</kbd> para abrir
              o menu de comandos (navegação rápida).
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
