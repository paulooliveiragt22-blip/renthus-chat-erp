"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  Bike,
  ChevronLeft,
  ChevronRight,
  Clock,
  Headphones,
  LayoutDashboard,
  MessageCircle,
  Moon,
  Package,
  Printer,
  Receipt,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sun,
  Users,
  Wallet,
  X,
} from "lucide-react";

const adminMenu = [
  { label: "Dashboard",     href: "/dashboard",      icon: LayoutDashboard },
  { label: "Pedidos",       href: "/pedidos",         icon: Receipt },
  { label: "Fila",          href: "/fila",            icon: Clock },
  { label: "PDV / Balcão",  href: "/pdv",             icon: ShoppingCart },
  { label: "WhatsApp",      href: "/whatsapp",        icon: MessageCircle },
  { label: "Produtos",      href: "/produtos/lista",  icon: ShoppingBag },
  { label: "Clientes",      href: "/clientes",        icon: Users },
  { label: "Entregadores",  href: "/entregadores",    icon: Bike },
  { label: "Estoque",       href: "/estoque",         icon: Package },
  { label: "Financeiro",    href: "/financeiro",      icon: Wallet },
  { label: "Impressoras",   href: "/impressoras",     icon: Printer },
  { label: "Suporte",       href: "/suporte",         icon: Headphones },
  { label: "Configurações", href: "/configuracoes",   icon: Settings },
];

interface AdminSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

function SidebarNavItem({
  item,
  pathname,
  collapsed,
}: Readonly<{
  item: (typeof adminMenu)[number];
  pathname: string | null;
  collapsed: boolean;
}>) {
  const Icon   = item.icon;
  const active = pathname === item.href || (pathname?.startsWith(item.href + "/") ?? false);

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={[
        "group relative flex items-center rounded-lg py-2.5 text-xs font-medium transition-all duration-150",
        collapsed ? "justify-center px-0" : "gap-3 px-3",
        active
          ? "bg-white/15 text-white shadow-sm"
          : "text-white/70 hover:bg-white/[0.08] hover:text-white",
      ].join(" ")}
    >
      {active && (
        <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_rgba(249,115,22,0.8)]" />
      )}
      <div
        className={[
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
          active
            ? "bg-white/20 text-white"
            : "bg-white/5 text-white/60 group-hover:bg-white/10 group-hover:text-white",
        ].join(" ")}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      {!collapsed && <span>{item.label}</span>}
    </Link>
  );
}

export default function AdminSidebar({
  isOpen,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: AdminSidebarProps) {
  const pathname            = usePathname();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Fecha sidebar ao navegar (mobile)
  useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDark = theme === "dark";

  return (
    <aside
      className={[
        // ── Estrutura base ──────────────────────────────────────────────────
        "flex flex-col overflow-hidden bg-primary text-zinc-50",
        "transition-all duration-300 ease-in-out",

        // ── Mobile: overlay fixed (slide in/out) ────────────────────────────
        "fixed inset-y-0 left-0 z-50 h-full",
        isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",

        // ── Desktop: parte do flex layout (não fixed) ───────────────────────
        "lg:static lg:inset-auto lg:z-auto lg:h-full lg:translate-x-0 lg:shadow-none",

        // ── Largura ─────────────────────────────────────────────────────────
        collapsed ? "w-16" : "w-64 lg:w-60",
      ].join(" ")}
    >
      {/* ── Logo + fechar (mobile) ──────────────────────────────────────────── */}
      <div className={[
        "flex shrink-0 items-center border-b border-white/10 py-4",
        collapsed ? "justify-center px-0" : "gap-3 px-5",
      ].join(" ")}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-base font-bold shadow-[0_0_20px_rgba(249,115,22,0.3)]">
          R
        </div>

        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold tracking-wide">Renthus ERP</div>
            <div className="text-[10px] font-medium text-white/50">Painel Administrativo</div>
          </div>
        )}

        {/* Fechar — mobile only */}
        {!collapsed && (
          <button
            onClick={onClose}
            aria-label="Fechar menu"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* ── Navegação ───────────────────────────────────────────────────────── */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto scrollbar-hide px-2 py-4">
        {adminMenu.map((item) => (
          <SidebarNavItem key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </nav>

      {/* ── Rodapé ──────────────────────────────────────────────────────────── */}
      <div className="shrink-0 space-y-1 border-t border-white/10 px-2 py-3">

        {/* Toggle tema */}
        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label="Alternar tema"
          title={collapsed ? (isDark ? "Modo Claro" : "Modo Escuro") : undefined}
          className={[
            "flex w-full items-center rounded-lg py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.08] hover:text-white",
            collapsed ? "justify-center px-0" : "gap-3 px-3",
          ].join(" ")}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5">
            {mounted ? (
              isDark
                ? <Sun  className="h-3.5 w-3.5 text-yellow-300" />
                : <Moon className="h-3.5 w-3.5 text-white/70"   />
            ) : <span className="h-3.5 w-3.5" />}
          </div>
          {!collapsed && (
            <>
              <span>{mounted && isDark ? "Modo Claro" : "Modo Escuro"}</span>
              {mounted && (
                <span className={`ml-auto inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  isDark ? "bg-yellow-400/20 text-yellow-300" : "bg-white/10 text-white/50"
                }`}>
                  {isDark ? "Escuro" : "Claro"}
                </span>
              )}
            </>
          )}
        </button>

        {/* Recolher / expandir — desktop only */}
        <button
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          className={[
            "hidden lg:flex w-full items-center rounded-lg py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/[0.08] hover:text-white",
            collapsed ? "justify-center px-0" : "gap-3 px-3",
          ].join(" ")}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/5">
            {collapsed
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronLeft  className="h-3.5 w-3.5" />}
          </div>
          {!collapsed && <span>Recolher</span>}
        </button>

        {/* Dica rápida — só quando expandido */}
        {!collapsed && (
          <div className="rounded-xl bg-white/5 px-3 py-2.5">
            <p className="text-[11px] font-semibold text-white">Dica rápida</p>
            <p className="mt-1 text-[10px] leading-relaxed text-white/50">
              Use o botão{" "}
              <span className="font-semibold text-accent">+ Novo pedido</span>{" "}
              na tela de Pedidos para agilizar o atendimento.
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
