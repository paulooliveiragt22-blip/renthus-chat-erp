// components/ExpandingMenu.tsx
"use client";

import React, { useState } from "react";
import MenuButtons from "./MenuButtons";

export default function ExpandingMenu() {
    const [open, setOpen] = useState(false);

    const containerStyle: React.CSSProperties = {
        position: "fixed",
        right: 18,
        bottom: 22,
        zIndex: 999,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
    };

    const panelStyle: React.CSSProperties = {
        background: "#fff",
        border: "1px solid #eee",
        borderRadius: 12,
        padding: 10,
        boxShadow: "0 8px 20px rgba(0,0,0,0.08)",
        width: open ? 220 : 64,
        transition: "width 220ms ease",
        overflow: "hidden",
    };

    const toggleStyle: React.CSSProperties = {
        width: 52,
        height: 52,
        borderRadius: 999,
        background: open ? "#3B246B" : "#fff",
        color: open ? "#fff" : "#3B246B",
        border: "1px solid #ddd",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
    };

    return (
        <div style={containerStyle}>
            <div style={panelStyle}>
                <MenuButtons compact={!open} onNavigate={() => setOpen(false)} />
            </div>

            <div style={{ display: "flex", gap: 8 }}>
                <button
                    onClick={() => setOpen((s) => !s)}
                    aria-expanded={open}
                    title={open ? "Fechar menu" : "Abrir menu"}
                    style={toggleStyle}
                    type="button"
                >
                    {open ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M6 6L18 18M6 18L18 6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                            <path d="M4 6h16M4 12h16M4 18h16" stroke="#3B246B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    )}
                </button>
            </div>
        </div>
    );
}
