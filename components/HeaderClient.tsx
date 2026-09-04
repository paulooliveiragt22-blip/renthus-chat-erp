// components/HeaderClient.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { useInstallPrompt } from "@/lib/pwa/useInstallPrompt";
import {
    Clock,
    Download,
    Maximize2,
    Menu,
    MessageCircle,
    Minimize2,
    Receipt,
    ShoppingCart,
    type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const HEADER_NAV: ReadonlyArray<{
    href: string;
    label: string;
    shortLabel?: string;
    icon: LucideIcon;
}> = [
    { href: "/whatsapp", label: "Chat", icon: MessageCircle },
    { href: "/pedidos", label: "Pedidos", icon: Receipt },
    { href: "/fila", label: "Fila de pedidos", shortLabel: "Fila", icon: Clock },
    { href: "/pdv", label: "PDV", icon: ShoppingCart },
];

function isNavActive(pathname: string | null, href: string): boolean {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
}

interface HeaderClientProps {
    onOpenMobileMenu?: () => void;
    isFullscreen?: boolean;
    onToggleFullscreen?: () => void;
}

export default function HeaderClient({
    onOpenMobileMenu,
    isFullscreen,
    onToggleFullscreen,
}: HeaderClientProps = {}) {
    const supabase = createClient();
    const router = useRouter();
    const pathname = usePathname();

    const { currentCompany, loading: loadingWorkspace } = useWorkspace();

    const [menuOpen, setMenuOpen] = useState(false);
    const [sessionExists, setSessionExists] = useState<boolean | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);

    const { canInstallDirectly, canShowIosInstructions, canOfferInstall, promptInstall } =
        useInstallPrompt();
    const [installHintOpen, setInstallHintOpen] = useState(false);
    const iosHintRef = useRef<HTMLDivElement | null>(null);

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
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
            if (iosHintRef.current && !iosHintRef.current.contains(e.target as Node)) {
                setInstallHintOpen(false);
            }
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") {
                setMenuOpen(false);
                setInstallHintOpen(false);
            }
        }
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("keydown", onKey);
        };
    }, []);

    async function handleInstallClick() {
        if (canInstallDirectly) {
            const accepted = await promptInstall();
            if (accepted) setInstallHintOpen(false);
            return;
        }
        setInstallHintOpen((s) => !s);
    }

    async function handleSignOut() {
        try {
            // Primeiro, limpa sessão cookies server-side e cookie workspace
            try {
                await fetch("/api/auth/signout", { method: "POST", credentials: "include" });
            } catch (e) {
                // não bloquear logout client se o server falhar
                console.warn("Server signout failed", e);
            }

            // Depois, limpa sessão client-side no Supabase
            try {
                await supabase.auth.signOut();
            } catch (e) {
                console.warn("Client signOut failed", e);
            }
        } finally {
            setMenuOpen(false);
            router.push("/login");
        }
    }

    function goToSettings() {
        setMenuOpen(false);
        router.push("/configuracoes");
    }

    // Não renderiza o header em páginas standalone
    if (
        pathname === "/login" ||
        pathname === "/register" ||
        pathname === "/billing/blocked" ||
        pathname.startsWith("/signup") ||
        pathname.startsWith("/onboarding") ||
        pathname.startsWith("/c/") ||
        pathname === "/c" ||
        pathname.startsWith("/superadmin") ||
        pathname.startsWith("/platform")
    ) return null;
    if (sessionExists === false) return null;
    if (sessionExists === null) {
        // ainda checando: evitar flash indesejado
        return null;
    }

    return (
        <header
            style={{
                backgroundColor: "#11283B",
                color: "#fff",
                padding: "10px 18px",
                boxShadow: "0 6px 12px rgba(0,0,0,0.16)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
            }}
        >
            {/* esquerda: hamburger (mobile only) + logotipo */}
            <div className="flex min-w-0 items-center gap-3">
                {onOpenMobileMenu && (
                    <button
                        type="button"
                        onClick={onOpenMobileMenu}
                        aria-label="Abrir menu"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/12 text-white lg:hidden"
                    >
                        <Menu size={18} />
                    </button>
                )}
                <a href="/" aria-label="Zampell" className="inline-flex shrink-0 items-center no-underline">
                    <img
                        src="/brand/zampell-wordmark.png?v=z1"
                        alt="Zampell"
                        className="block h-7 w-auto object-contain"
                    />
                </a>

                <nav
                    aria-label="Atalhos principais"
                    className="ml-1 flex items-center gap-0.5 sm:ml-2 sm:gap-1"
                >
                    {HEADER_NAV.map(({ href, label, shortLabel, icon: Icon }) => {
                        const active = isNavActive(pathname, href);
                        return (
                            <Link
                                key={href}
                                href={href}
                                title={label}
                                aria-current={active ? "page" : undefined}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors sm:px-2.5",
                                    active
                                        ? "bg-accent text-accent-foreground"
                                        : "text-white/80 hover:bg-white/10 hover:text-white"
                                )}
                            >
                                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                <span className="hidden md:inline">{label}</span>
                                <span className="hidden sm:inline md:hidden">{shortLabel ?? label}</span>
                            </Link>
                        );
                    })}
                </nav>
            </div>

            {/* direita: empresa + fullscreen + avatar */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {loadingWorkspace ? "Carregando..." : currentCompany?.name ?? "RenthusAgent"}
                </div>

                {/* Instalar app (PWA) — some só quando já está em modo standalone */}
                {canOfferInstall && (
                    <div ref={iosHintRef} style={{ position: "relative" }}>
                        <button
                            onClick={() => { handleInstallClick().catch(() => {}); }}
                            title="Instalar app"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                background: "rgba(255,255,255,0.12)",
                                border: "none",
                                cursor: "pointer",
                                color: "#fff",
                                flexShrink: 0,
                            }}
                        >
                            <Download size={16} />
                        </button>

                        {installHintOpen && (
                            <div
                                style={{
                                    position: "absolute",
                                    right: 0,
                                    top: "calc(100% + 10px)",
                                    width: 260,
                                    background: "#fff",
                                    color: "#222",
                                    borderRadius: 8,
                                    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                                    padding: 12,
                                    zIndex: 60,
                                    fontSize: 12.5,
                                    lineHeight: 1.4,
                                }}
                            >
                                <div style={{ fontWeight: 700, marginBottom: 4 }}>Instalar como app</div>
                                {canShowIosInstructions ? (
                                    <>
                                        Toque em <b>Compartilhar</b> (ícone □↑ na barra do Safari) e depois em{" "}
                                        <b>&quot;Adicionar à Tela de Início&quot;</b>.
                                    </>
                                ) : (
                                    <>
                                        No Chrome, abra o menu <b>⋮</b> (canto superior direito) e escolha{" "}
                                        <b>Instalar RenthusAgent</b>. Se a opção não aparecer, feche o Chrome por
                                        completo e abra o site de novo.
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Tela cheia */}
                {onToggleFullscreen && (
                    <button
                        onClick={onToggleFullscreen}
                        title={isFullscreen ? "Sair da tela cheia (F11)" : "Tela cheia (F11)"}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 36,
                            height: 36,
                            borderRadius: 8,
                            background: "rgba(255,255,255,0.12)",
                            border: "none",
                            cursor: "pointer",
                            color: "#fff",
                            flexShrink: 0,
                        }}
                    >
                        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                )}

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
                        color: "#16364D",
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
                        <div style={{ fontWeight: 900 }}>{currentCompany?.name ?? "RenthusAgent"}</div>
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
