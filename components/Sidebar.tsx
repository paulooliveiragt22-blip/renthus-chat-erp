// components/Sidebar.tsx
"use client";

import React, { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const PURPLE = "#3B246B";
const ORANGE = "#FF6600";
const WHATSAPP_GREEN = "#25D366";

type MenuItem = {
    label: string;
    href: string;
    icon?: (props: { color?: string; className?: string }) => ReactElement | null;
    exact?: boolean;
};

/* ícones padrão (outline) */
const IconGrid = ({ color = "currentColor", className = "h-6 w-6" }: any) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="13" y="3" width="8" height="8" rx="1" />
        <rect x="3" y="13" width="8" height="8" rx="1" />
        <rect x="13" y="13" width="8" height="8" rx="1" />
    </svg>
);
const IconBox = ({ color = "currentColor", className = "h-6 w-6" }: any) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73L13 3a2 2 0 0 0-2 0L4 6.27A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73L11 21a2 2 0 0 0 2 0l7-3.27A2 2 0 0 0 21 16z" />
        <path d="M12 3v9" />
    </svg>
);
const IconOrders = ({ color = "currentColor", className = "h-6 w-6" }: any) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 7h8" />
        <path d="M8 12h8" />
        <path d="M8 17h5" />
    </svg>
);
const IconUser = ({ color = "currentColor", className = "h-6 w-6" }: any) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M4 21v-2a4 4 0 0 1 3-3.87" />
        <circle cx="12" cy="7" r="4" />
    </svg>
);
const IconChart = ({ color = "currentColor", className = "h-6 w-6" }: any) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M12 13v6" />
        <path d="M18 7v12" />
        <path d="M6 17v6" />
    </svg>
);

const IconChevron = ({ color = "currentColor", className = "h-5 w-5", flipped = false }: any) => (
    <svg className={`${className} ${flipped ? "transform rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

/* === Opção recomendada: ícone do WhatsApp preenchido (mais reconhecível) ===
   bolha verde com handset branco. Funciona melhor visualmente em ambas as larguras. */
const IconWhatsAppFilled = ({ className = "h-6 w-6" }: any) => (
    <svg className={className} viewBox="0 0 24 24" aria-hidden width="24" height="24">
        {/* bolha verde */}
        <circle cx="12" cy="12" r="10" fill={WHATSAPP_GREEN} />
        {/* handset - path aproveitando o desenho branco */}
        <path
            d="M16.2 14.8c-.3-.12-1.24-.62-1.43-.7-.19-.08-.33-.11-.47.07-.14.18-.6.7-.73.83-.13.13-.27.15-.48.06-.22-.1-.92-.34-1.75-.98-.65-.5-1.09-1.1-1.25-1.3-.16-.2-.03-.3.1-.39.13-.09.3-.2.45-.3.14-.1.18-.18.26-.29.08-.1.04-.19 0-.29-.04-.1-.5-1.1-.67-1.5-.17-.4-.34-.34-.48-.34-.14-.01-.28-.01-.4-.01-.12 0-.32.05-.49.22-.17.17-.28.39-.4.6-.12.21-.25.46-.25.71 0 .25.57.95 1.1 1.4.52.46 2.15 1.94 4.2 3.09 2.05 1.15 3.78 1.74 4.37 1.84.59.1 1.44.05 1.87-.19.43-.24 1.11-.84 1.25-1.66.14-.82-.1-1.25-.45-1.41z"
            fill="#fff"
        />
    </svg>
);

/* Tooltip style */
const tooltipStyle: React.CSSProperties = {
    position: "absolute",
    left: "calc(100% + 12px)",
    top: "50%",
    transform: "translateY(-50%)",
    background: "rgba(0,0,0,0.85)",
    color: "#fff",
    padding: "6px 10px",
    borderRadius: 8,
    whiteSpace: "nowrap",
    boxShadow: "0 8px 18px rgba(0,0,0,0.18)",
    zIndex: 60,
    fontSize: 13,
    fontWeight: 700,
};
const tooltipArrowStyle: React.CSSProperties = {
    position: "absolute",
    left: -6,
    top: "50%",
    transform: "translateY(-50%) rotate(45deg)",
    width: 12,
    height: 12,
    background: "rgba(0,0,0,0.85)",
    zIndex: 59,
    borderRadius: 2,
};

export default function Sidebar() {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState<boolean>(false);
    const [hovered, setHovered] = useState<string | null>(null);
    const [focused, setFocused] = useState<string | null>(null);

    useEffect(() => {
        try {
            const saved = localStorage.getItem("renthus_sidebar_collapsed");
            if (saved !== null) setCollapsed(saved === "true");
        } catch {
            /* ignore */
        }
    }, []);

    useEffect(() => {
        try {
            localStorage.setItem("renthus_sidebar_collapsed", String(collapsed));
        } catch {
            /* ignore */
        }
    }, [collapsed]);

    const menu: MenuItem[] = [
        { label: "Dashboard", href: "/dashboard", icon: IconGrid },
        { label: "Produtos", href: "/produtos/lista", icon: IconBox },
        { label: "Pedidos", href: "/pedidos", icon: IconOrders },
        { label: "Clientes", href: "/clientes", icon: IconUser },
        { label: "Analytics", href: "/analytics", icon: IconChart },
        // WhatsApp não usa "icon" aqui — vamos tratá-lo como caso especial na renderização
        { label: "WhatsApp", href: "/whatsapp" },
    ];

    function isActive(href: string, exact = false) {
        if (!pathname) return false;
        if (exact) return pathname === href;
        return pathname === href || (href !== "/" && pathname.startsWith(href));
    }

    return (
        <aside
            aria-label="Sidebar"
            className="flex flex-col text-white select-none"
            style={{
                width: collapsed ? 72 : 260,
                minWidth: collapsed ? 72 : 260,
                background: PURPLE,
                transition: "width 180ms ease",
            }}
        >
            <div className="flex items-center gap-3 p-4 border-b" style={{ borderColor: "rgba(255,255,255,0.08)", minHeight: 64 }}>
                <div
                    className="flex items-center justify-center rounded-md"
                    style={{
                        height: 40,
                        width: 40,
                        background: "rgba(255,255,255,0.08)",
                        fontWeight: 800,
                        color: "#fff",
                        fontSize: 18,
                    }}
                >
                    R
                </div>

                {!collapsed && (
                    <div style={{ lineHeight: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: 16 }}>Renthus</div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)" }}>Admin</div>
                    </div>
                )}

                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                        onClick={() => setCollapsed((s) => !s)}
                        aria-label={collapsed ? "Expandir menu" : "Fechar menu"}
                        aria-expanded={!collapsed}
                        className="p-2 rounded hover:bg-white/10 focus:outline-none"
                        title={collapsed ? "Expandir" : "Fechar"}
                        style={{ color: "#fff" }}
                    >
                        <IconChevron color="#fff" flipped={!collapsed} />
                    </button>
                </div>
            </div>

            <nav
                className="flex-1 overflow-y-auto px-2"
                style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-start", // empilhados no topo quando fechado
                    paddingTop: collapsed ? 14 : 12,
                }}
            >
                <ul
                    style={{
                        listStyle: "none",
                        padding: 0,
                        margin: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: collapsed ? 36 : 12,
                        alignItems: "flex-start",
                        width: "100%",
                        boxSizing: "border-box",
                    }}
                >
                    {menu.map((m) => {
                        const active = isActive(m.href, false);
                        const iconColor = active ? ORANGE : "#fff";
                        const textColor = active ? ORANGE : "#fff";
                        const bgActive = active ? "rgba(255,102,0,0.09)" : "transparent";

                        const padLeftExpanded = 20;
                        const padLeftCollapsed = 20;
                        const linkStyle: React.CSSProperties = {
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            gap: 12,
                            paddingTop: 14,
                            paddingBottom: 14,
                            paddingLeft: collapsed ? padLeftCollapsed : padLeftExpanded,
                            paddingRight: collapsed ? 12 : 16,
                            background: bgActive,
                            color: textColor,
                            textDecoration: "none",
                            boxSizing: "border-box",
                            width: "100%",
                            position: "relative",
                        };

                        // se for WhatsApp, renderizamos o ícone preenchido verde (ele já tem o círculo)
                        const isWhatsapp = m.href === "/whatsapp";

                        // padrão para os outros ícones (círculo suspenso quando fechado)
                        const iconContainerStyle: React.CSSProperties = collapsed
                            ? {
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                width: 52,
                                height: 52,
                                borderRadius: 999,
                                background: "rgba(255,255,255,0.04)",
                                boxShadow: "0 4px 10px rgba(0,0,0,0.10)",
                            }
                            : {
                                width: 34,
                                minWidth: 34,
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                            };

                        // para whatsapp usamos container transparente (porque o ícone já tem seu círculo verde)
                        const whatsappContainerStyle: React.CSSProperties = collapsed
                            ? {
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                width: 52,
                                height: 52,
                            }
                            : {
                                width: 34,
                                minWidth: 34,
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                            };

                        const showTooltip = collapsed && (hovered === m.href || focused === m.href);

                        return (
                            <li key={m.href} style={{ listStyle: "none", margin: 0, width: "100%" }}>
                                <Link
                                    href={m.href}
                                    style={linkStyle}
                                    title={m.label}
                                    onMouseEnter={() => setHovered(m.href)}
                                    onMouseLeave={() => setHovered(null)}
                                    onFocus={() => setFocused(m.href)}
                                    onBlur={() => setFocused(null)}
                                >
                                    {/* WhatsApp especial (filled) */}
                                    {isWhatsapp ? (
                                        <div style={whatsappContainerStyle}>
                                            {/* quando ativo ainda mantemos o ícone verde; não tentamos trocar cor do filled icon */}
                                            <IconWhatsAppFilled className={collapsed ? "h-7 w-7" : "h-6 w-6"} />
                                        </div>
                                    ) : (
                                        <div style={iconContainerStyle}>
                                            {m.icon ? m.icon({ color: iconColor, className: "h-6 w-6" }) : null}
                                        </div>
                                    )}

                                    {!collapsed && (
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                                            <span style={{ whiteSpace: "nowrap", color: textColor, fontWeight: 700 }}>{m.label}</span>
                                            {active && <span style={{ width: 8, height: 8, borderRadius: 999, background: ORANGE, marginLeft: 8 }} />}
                                        </div>
                                    )}

                                    {showTooltip && (
                                        <div style={tooltipStyle} role="status" aria-hidden={false}>
                                            <div style={tooltipArrowStyle} />
                                            {m.label}
                                        </div>
                                    )}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            <div className="p-3 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                {!collapsed ? (
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-white/12 flex items-center justify-center font-semibold">PA</div>
                        <div className="flex-1">
                            <div style={{ fontWeight: 700 }}>Paulo</div>
                            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.8)" }}>Administrador</div>
                        </div>
                        <button className="ml-2 px-3 py-2 rounded bg-white/10 text-white text-sm">Sair</button>
                    </div>
                ) : (
                    <div className="flex items-center justify-center">
                        <button className="p-2 rounded hover:bg-white/10" title="Sair" style={{ color: "#fff" }}>
                            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                <path d="M16 17l5-5-5-5" />
                                <path d="M21 12H9" />
                            </svg>
                        </button>
                    </div>
                )}
            </div>
        </aside>
    );
}
