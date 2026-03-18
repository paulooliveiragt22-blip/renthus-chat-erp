"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  Bike,
  LayoutDashboard,
  MessageCircle,
  Moon,
  Package,
  Printer,
  Receipt,
  Settings,
  ShoppingBag,
  Sun,
  Users,
  Wallet,
} from "lucide-react";

const adminMenu = [
  { label: "Dashboard",     href: "/dashboard",      icon: LayoutDashboard },
  { label: "Pedidos",       href: "/pedidos",         icon: Receipt },
  { label: "WhatsApp",      href: "/whatsapp",        icon: MessageCircle },
  { label: "Produtos",      href: "/produtos",        icon: ShoppingBag },
  { label: "Clientes",      href: "/clientes",        icon: Users },
  { label: "Entregadores",  href: "/entregadores",    icon: Bike },
  { label: "Estoque",       href: "/estoque",         icon: Package },
  { label: "Financeiro",    href: "/financeiro",      icon: Wallet },
  { label: "Impressoras",   href: "/impressoras",     icon: Printer },
  { label: "Configurações", href: "/configuracoes",   icon: Settings },
];

export default function AdminSidebar() {
  const pathname       = usePathname();
  const { theme, setTheme } = useTheme();
  // Evita hydration mismatch: o ícone só renderiza no cliente
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = theme === "dark";

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col overflow-hidden bg-primary text-zinc-50 transition-colors duration-300">

      {/* ── Logo ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-lg font-bold shadow-[0_0_20px_rgba(249,115,22,0.3)]">
          R
        </div>
        <div>
          <div className="text-sm font-semibold tracking-wide">Renthus ERP</div>
          <div className="text-[10px] font-medium text-white/50">
            Painel Administrativo
          </div>
        </div>
      </div>

      {/* ── Navegação ────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto space-y-0.5 px-3 py-4">
        {adminMenu.map((item) => {
          const Icon   = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-all duration-150",
                active
                  ? "bg-white/15 text-white shadow-sm"
                  : "text-white/70 hover:bg-white/8 hover:text-white",
              ].join(" ")}
            >
              {active && (
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-accent shadow-[0_0_10px_rgba(249,115,22,0.8)]" />
              )}
              <div className={[
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                active
                  ? "bg-white/20 text-white"
                  : "bg-white/5 text-white/60 group-hover:bg-white/10 group-hover:text-white",
              ].join(" ")}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Rodapé: toggle tema + dica ───────────────────────────────────── */}
      <div className="border-t border-white/10 px-4 py-3 space-y-3">

        {/* Toggle Dark / Light */}
        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          aria-label="Alternar tema"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/8 hover:text-white"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
            {/* Ícone só renderiza após montar (evita flash de hidratação) */}
            {mounted ? (
              isDark
                ? <Sun  className="h-3.5 w-3.5 text-yellow-300" />
                : <Moon className="h-3.5 w-3.5 text-white/70"   />
            ) : (
              <span className="h-3.5 w-3.5" />
            )}
          </div>
          <span>{mounted && isDark ? "Modo Claro" : "Modo Escuro"}</span>

          {/* Indicador pill */}
          {mounted && (
            <span className={`ml-auto inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
              isDark ? "bg-yellow-400/20 text-yellow-300" : "bg-white/10 text-white/50"
            }`}>
              {isDark ? "Escuro" : "Claro"}
            </span>
          )}
        </button>

        {/* Dica */}
        <div className="rounded-xl bg-white/5 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-white">Dica rápida</p>
          <p className="mt-1 text-[10px] leading-relaxed text-white/50">
            Use o botão{" "}
            <span className="font-semibold text-accent">+ Novo pedido</span>{" "}
            na tela de Pedidos para agilizar o atendimento.
          </p>
        </div>
      </div>
    </aside>
  );
}
