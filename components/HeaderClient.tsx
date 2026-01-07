// components/HeaderClient.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePathname, useRouter } from "next/navigation";
import { ORANGE } from "@/lib/orders/helpers";

export default function HeaderClient() {
    const supabase = createClient();
    const router = useRouter();
    const pathname = usePathname();

    const [menuOpen, setMenuOpen] = useState(false);
    const [sessionExists, setSessionExists] = useState<boolean | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    // verifica sessão (apenas no cliente)
    useEffect(() => {
        let mounted = true;
        async function check() {
            try {
                const { data } = await supabase.auth.getSession();
                if (!mounted) return;
                setSessionExists(!!data?.session);
            } catch {
                if (!mounted) return;
                setSessionExists(false);
            }
        }
        check();

        // subscreve mudanças de auth (ex: login/logout em outra aba)
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, _session) => {
            supabase.auth.getSession().then((r) => setSessionExists(!!r.data?.session)).catch(() => setSessionExists(false));
        });

        return () => {
            mounted = false;
            subscription?.unsubscribe?.();
        };
    }, [supabase]);

    // fecha ao clicar fora / ESC
    useEffect(() => {
        function onDoc(e: MouseEvent) {
            if (!menuRef.current) return;
            if (menuRef.current.contains(e.target as Node)) return;
            setMenuOpen(false);
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setMenuOpen(false);
        }
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
        };
    }, []);

    async function handleSignOut() {
        try {
            await supabase.auth.signOut();
        } finally {
            setMenuOpen(false);
            router.push("/login");
        }
    }

    function goToSettings() {
        setMenuOpen(false);
        router.push("/settings");
    }

    function goToUpgrade() {
        setMenuOpen(false);
        router.push("/billing/upgrade");
    }

    // Não renderiza o header na tela de login (ou enquanto não sabemos a sessão)
    if (pathname === "/login" || pathname === "/register") return null;
    if (sessionExists === false) return null;
    if (sessionExists === null) {
        // ainda checando: evitar flash indesejado
        return null;
    }

    return (
        <header
            style={{
                backgroundColor: "#3B246B",
                color: "#fff",
                padding: "16px 24px",
                boxShadow: "0 6px 12px rgba(0,0,0,0.16)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
            }}
        >
            {/* esquerda: retângulo para logo Renthus */}
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {/* esquerda: logo Renthus */}
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <a href="/" aria-label="Renthus" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                        <img
                            src="/assets/renthus-logo.svg"
                            alt="Renthus"
                            style={{
                                height: 40,        // ajuste a altura desejada
                                width: "auto",
                                display: "block",
                                objectFit: "contain",
                            }}
                        />
                    </a>
                </div>

            </div>

            {/* direita: perfil da empresa + menu */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>Renthus Service</div>

                <button
                    aria-haspopup="true"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((s) => !s)}
                    style={{
                        width: 44,
                        height: 44,
                        borderRadius: "50%",
                        backgroundColor: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#3B246B",
                        fontWeight: 700,
                        overflow: "hidden",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                        border: "none",
                        cursor: "pointer",
                    }}
                    title="Abrir menu do usuário"
                >
                    R
                </button>

                <div
                    ref={menuRef}
                    style={{
                        position: "absolute",
                        right: 12,
                        top: "calc(100% + 10px)",
                        minWidth: 200,
                        background: "#fff",
                        color: "#222",
                        borderRadius: 8,
                        boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                        padding: 8,
                        zIndex: 60,
                        display: menuOpen ? "block" : "none",
                    }}
                >
                    <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
                        <div style={{ fontWeight: 900 }}>Renthus Service</div>
                        <div style={{ color: "#666", fontSize: 12 }}>Empresa</div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", padding: 8, gap: 6 }}>
                        <button
                            onClick={goToSettings}
                            style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                borderRadius: 6,
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                fontWeight: 700,
                                color: "#333",
                            }}
                        >
                            Configurações
                        </button>

                        <button
                            onClick={goToUpgrade}
                            style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                borderRadius: 6,
                                border: "1px solid " + ORANGE,
                                background: ORANGE,
                                color: "#fff",
                                cursor: "pointer",
                                fontWeight: 900,
                            }}
                        >
                            Upgrade
                        </button>

                        <button
                            onClick={handleSignOut}
                            style={{
                                textAlign: "left",
                                padding: "8px 10px",
                                borderRadius: 6,
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                fontWeight: 700,
                                color: "#c62828",
                            }}
                        >
                            Sair
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}
