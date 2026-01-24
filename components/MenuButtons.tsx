// components/MenuButtons.tsx
"use client";

import React from "react";
import Link from "next/link";

type MenuButtonsProps = {
    compact?: boolean; // quando true renderiza só ícones
    onNavigate?: () => void;
    textColor?: string;
    iconColor?: string;
};

function IconHome() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 10.5L12 4l9 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 20V11h14v9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
function IconProducts() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="3" y="3" width="7" height="7" stroke="currentColor" strokeWidth="1.4" rx="1" fill="none" />
            <rect x="14" y="3" width="7" height="7" stroke="currentColor" strokeWidth="1.4" rx="1" fill="none" />
            <rect x="3" y="14" width="7" height="7" stroke="currentColor" strokeWidth="1.4" rx="1" fill="none" />
            <rect x="14" y="14" width="7" height="7" stroke="currentColor" strokeWidth="1.4" rx="1" fill="none" />
        </svg>
    );
}
function IconOrders() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 7h18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    );
}
function IconWhatsApp() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M21 12a9 9 0 1 0-2.7 6.1L21 21l-2.9-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
function IconReport() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M3 3v18h18" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="6.5" y="10" width="2.8" height="7" rx="0.6" fill="currentColor" />
            <rect x="11" y="6" width="2.8" height="11" rx="0.6" fill="currentColor" />
            <rect x="15.5" y="13" width="2.8" height="4" rx="0.6" fill="currentColor" />
        </svg>
    );
}

export default function MenuButtons({ compact = false, onNavigate, textColor = "#111", iconColor = "#3B246B" }: MenuButtonsProps) {
    const btnStyle: React.CSSProperties = {
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textDecoration: "none",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: compact ? "8px 6px" : "10px 12px",
        borderRadius: compact ? 12 : 10,
        color: textColor,
        fontWeight: 700,
        fontSize: 13,
        boxSizing: "border-box",
    };

    const iconWrapper: React.CSSProperties = {
        width: 36,
        height: 36,
        display: "grid",
        placeItems: "center",
        borderRadius: 10,
        // color controls the icon because SVG uses currentColor
        color: iconColor,
    };

    const items = [
        { href: "/dashboard", icon: <IconHome />, label: "Dashboard" },
        { href: "/whatsapp", icon: <IconWhatsApp />, label: "WhatsApp" },
        { href: "/produtos", icon: <IconProducts />, label: "Cadastrar produto" },
        { href: "/produtos/lista", icon: <IconProducts />, label: "Produtos" },
        { href: "/pedidos", icon: <IconOrders />, label: "Pedidos" },
        { href: "/relatorio", icon: <IconReport />, label: "Relatório" },
    ];

    return (
        <div style={{ display: "grid", gap: compact ? 6 : 8 }}>
            {items.map((it) => (
                <Link
                    key={it.href}
                    href={it.href}
                    style={{
                        textDecoration: "none",
                        display: "flex",
                        alignItems: "center",
                        borderRadius: 10,
                        overflow: "hidden",
                        width: "100%",
                    }}
                    onClick={() => onNavigate?.()}
                >
                    <button
                        style={{
                            ...btnStyle,
                            justifyContent: compact ? "center" : "flex-start",
                            background: "transparent",
                            border: "none",
                        }}
                        aria-label={it.label}
                        type="button"
                    >
                        <span style={iconWrapper as React.CSSProperties}>{it.icon}</span>
                        {!compact ? <span style={{ marginLeft: 2 }}>{it.label}</span> : null}
                    </button>
                </Link>
            ))}
        </div>
    );
}
