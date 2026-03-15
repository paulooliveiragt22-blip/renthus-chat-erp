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
