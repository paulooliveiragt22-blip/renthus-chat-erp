\"use client\";

import Link from \"next/link\";
import { usePathname } from \"next/navigation\";
import {
  LayoutDashboard,
  Receipt,
  MessageCircle,
  Printer,
  Settings,
} from \"lucide-react\";

const adminMenu = [
  { label: \"Dashboard\", href: \"/dashboard\", icon: LayoutDashboard },
  { label: \"Pedidos\", href: \"/pedidos\", icon: Receipt },
  { label: \"WhatsApp\", href: \"/whatsapp\", icon: MessageCircle },
  { label: \"Impressoras\", href: \"/impressoras\", icon: Printer },
  { label: \"Configurações\", href: \"/configuracoes\", icon: Settings },
];

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className=\"hidden min-h-screen w-64 flex-col border-r border-zinc-800 bg-gradient-to-b from-[#1e0b3a] via-[#120623] to-[#05010b] text-zinc-50 md:flex\">
      <div className=\"flex items-center gap-3 border-b border-white/10 px-5 py-4\">
        <div className=\"flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-lg font-bold shadow-[0_0_20px_rgba(234,88,12,0.25)]\">
          R
        </div>
        <div>
          <div className=\"text-sm font-semibold tracking-wide\">Renthus ERP</div>
          <div className=\"text-[10px] font-medium text-zinc-300/70\">
            Painel Administrativo
          </div>
        </div>
      </div>

      <nav className=\"flex-1 space-y-1 px-3 py-4\">
        {adminMenu.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                \"group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors\",
                \"text-zinc-200 hover:bg-white/5 hover:text-white\",
                active ? \"bg-white/8 text-white\" : \"\",
              ].join(\" \")}
            >
              {active && (
                <span className=\"absolute inset-y-1 left-0 w-[3px] rounded-full bg-[#ea580c] shadow-[0_0_12px_rgba(234,88,12,0.7)]\" />
              )}
              <div className=\"flex h-7 w-7 items-center justify-center rounded-md bg-white/5 text-zinc-100 shadow-sm group-hover:bg-white/10\">
                <Icon className=\"h-3.5 w-3.5\" />
              </div>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className=\"border-t border-white/10 px-4 py-3 text-[11px] text-zinc-300/80\">
        <div className=\"rounded-xl bg-white/5 px-3 py-2 backdrop-blur-sm\">
          <div className=\"text-[11px] font-semibold text-zinc-50\">
            Atalhos rápidos
          </div>
          <div className=\"mt-1 text-[10px]\">
            Use o botão <span className=\"font-semibold text-[#ea580c]\">Novo pedido</span> na tela de
            Pedidos para agilizar o atendimento.
          </div>
        </div>
      </div>
    </aside>
  );
}

// components/AdminSidebar.tsx
"use client";

import React, { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { FiHome, FiShoppingCart, FiPrinter } from "react-icons/fi";
import { FaWhatsapp } from "react-icons/fa";
import { GiCube } from "react-icons/gi";
import { BiBarChart } from "react-icons/bi";

const ORANGE = "#FF6600";
const PURPLE = "#3B246B";
const SIDEBAR_BG = PURPLE;
const SIDEBAR_TEXT = "#FFFFFF";
const SIDEBAR_BORDER = "rgba(255,255,255,0.08)";
const SIDEBAR_CARD_BG = "rgba(255,255,255,0.06)";

export default function AdminSidebar() {
    const router = useRouter();
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(false);

    const navItems = [
        { key: "dashboard", label: "Dashboard",  Icon: FiHome,        href: "/"             },
        { key: "whatsapp",  label: "WhatsApp",   Icon: FaWhatsapp,    href: "/whatsapp"     },
        { key: "produtos",  label: "Produtos",   Icon: GiCube,        href: "/produtos/lista"},
        { key: "pedidos",   label: "Pedidos",    Icon: FiShoppingCart,href: "/pedidos"      },
        { key: "impressao", label: "Impressão",  Icon: FiPrinter,     href: "/impressoras"  },
        { key: "relatorio", label: "Relatório",  Icon: BiBarChart,    href: "/relatorios"   },
    ];

    function isActive(item: { key: string; href: string }) {
        if (!pathname) return false;
        if (item.href === "/") return pathname === "/";
        return pathname === item.href || pathname.startsWith(item.href + "/");
    }

    const width = collapsed ? 64 : 220;

    return (
        <>
            <style>{`.renthus-sidebar { -ms-overflow-style: none; scrollbar-width: none; } .renthus-sidebar::-webkit-scrollbar { width: 0; height: 0; }`}</style>
            <aside
                className="renthus-sidebar"
                style={{
                    position: "sticky",
                    top: 14,
                    height: "calc(100vh - 28px)",
                    width,
                    maxWidth: width,
                    border: `1px solid ${SIDEBAR_BORDER}`,
                    borderRadius: 14,
                    padding: 12,
                    background: SIDEBAR_BG,
                    color: SIDEBAR_TEXT,
                    overflowY: "auto",
                    overflowX: "hidden",
                    boxSizing: "border-box",
                    transition: "width 180ms ease",
                    flexShrink: 0,
                }}
            >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    {!collapsed && <div style={{ fontWeight: 900, fontSize: 13 }}>Menu</div>}
                    <button
                        onClick={() => setCollapsed(s => !s)}
                        title={collapsed ? "Expandir" : "Colapsar"}
                        style={{
                            border: `1px solid ${SIDEBAR_BORDER}`,
                            background: SIDEBAR_CARD_BG,
                            color: SIDEBAR_TEXT,
                            borderRadius: 8,
                            padding: 6,
                            cursor: "pointer",
                            marginLeft: "auto",
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            {collapsed
                                ? <path d="M8 5l8 7-8 7" stroke={SIDEBAR_TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                : <path d="M16 5l-8 7 8 7" stroke={SIDEBAR_TEXT} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            }
                        </svg>
                    </button>
                </div>

                {/* Nav */}
                <nav style={{ marginTop: 12 }}>
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                        {navItems.map(item => {
                            const active = isActive(item);
                            return (
                                <li key={item.key}>
                                    <button
                                        type="button"
                                        onClick={() => router.push(item.href)}
                                        aria-current={active ? "page" : undefined}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 12,
                                            width: "100%",
                                            textAlign: "left",
                                            padding: "10px 12px",
                                            borderRadius: 10,
                                            border: active ? `1px solid ${ORANGE}` : "1px solid transparent",
                                            background: active ? "rgba(255,102,0,0.15)" : "transparent",
                                            cursor: "pointer",
                                            color: SIDEBAR_TEXT,
                                        }}
                                    >
                                        <item.Icon size={16} color={active ? ORANGE : SIDEBAR_TEXT} />
                                        {!collapsed && (
                                            <span style={{ fontSize: 13, fontWeight: active ? 800 : 600, color: active ? ORANGE : SIDEBAR_TEXT }}>
                                                {item.label}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>
            </aside>
        </>
    );
}
