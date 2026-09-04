// components/HeaderClient.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { usePathname, useRouter } from "next/navigation";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { useInstallPrompt } from "@/lib/pwa/useInstallPrompt";
import {
    Clock,
    Download,
    ImagePlus,
    Loader2,
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

    const { currentCompany } = useWorkspace();

    const [menuOpen, setMenuOpen] = useState(false);
    const [sessionExists, setSessionExists] = useState<boolean | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const logoInputRef = useRef<HTMLInputElement | null>(null);

    const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
    const [logoUploading, setLogoUploading] = useState(false);
    const [logoHint, setLogoHint] = useState<string | null>(null);

    const { canInstallDirectly, canShowIosInstructions, canOfferInstall, promptInstall } =
        useInstallPrompt();
    const [installHintOpen, setInstallHintOpen] = useState(false);
    const iosHintRef = useRef<HTMLDivElement | null>(null);

    const loadCompanyLogo = useCallback(async () => {
        try {
            const res = await fetch("/api/admin/menu-profile", {
                cache: "no-store",
                credentials: "include",
            });
            if (!res.ok) return;
            const json = (await res.json().catch(() => ({}))) as {
                profile?: { logoUrl?: string | null } | null;
            };
            const url = json.profile?.logoUrl;
            setCompanyLogoUrl(typeof url === "string" && url.trim() ? url : null);
        } catch {
            // silencioso — header não depende do cardápio
        }
    }, []);

    useEffect(() => {
        void loadCompanyLogo();
    }, [loadCompanyLogo, currentCompany?.id]);

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

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, _session) => {
            supabase.auth
                .getSession()
                .then((r) => setSessionExists(!!r.data?.session))
                .catch(() => setSessionExists(false));
        });

        return () => {
            mounted = false;
            subscription?.unsubscribe?.();
        };
    }, [supabase]);

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
            try {
                await fetch("/api/auth/signout", { method: "POST", credentials: "include" });
            } catch (e) {
                console.warn("Server signout failed", e);
            }
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

    async function handleLogoFile(file: File | null) {
        if (!file) return;
        setLogoUploading(true);
        setLogoHint(null);
        try {
            const fd = new FormData();
            fd.set("kind", "logo");
            fd.set("file", file);
            const res = await fetch("/api/admin/menu-profile/upload", {
                method: "POST",
                credentials: "include",
                body: fd,
            });
            const json = (await res.json().catch(() => ({}))) as {
                error?: string;
                url?: string;
                hint?: string;
            };
            if (!res.ok) {
                if (json.error === "profile_missing") {
                    setLogoHint("Salve o cardápio em Configurações antes de enviar o logo.");
                    return;
                }
                setLogoHint(json.error ?? "Falha ao enviar logo.");
                return;
            }
            if (typeof json.url === "string") setCompanyLogoUrl(json.url);
        } finally {
            setLogoUploading(false);
            if (logoInputRef.current) logoInputRef.current.value = "";
        }
    }

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
    )
        return null;
    if (sessionExists === false) return null;
    if (sessionExists === null) return null;

    return (
        <header className="relative grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 bg-[#11283B] px-3 py-2.5 text-white shadow-[0_6px_12px_rgba(0,0,0,0.16)] sm:px-[18px]">
            {/* esquerda */}
            <div className="flex min-w-0 items-center gap-2 justify-self-start sm:gap-3">
                {onOpenMobileMenu && (
                    <button
                        type="button"
                        onClick={onOpenMobileMenu}
                        aria-label="Abrir menu"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/12 text-white transition-transform duration-150 hover:-translate-y-0.5 lg:hidden"
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
            </div>

            {/* centro — atalhos */}
            <nav
                aria-label="Atalhos principais"
                className="flex items-center justify-center gap-2 justify-self-center sm:gap-3"
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
                                "inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold",
                                "transition-transform duration-150 ease-out will-change-transform",
                                "hover:-translate-y-0.5 hover:scale-[1.03]",
                                "active:translate-y-0 active:scale-100",
                                active
                                    ? "bg-accent text-accent-foreground shadow-sm"
                                    : "bg-[#16364D] text-white hover:brightness-110"
                            )}
                        >
                            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="hidden md:inline">{label}</span>
                            <span className="hidden sm:inline md:hidden">{shortLabel ?? label}</span>
                        </Link>
                    );
                })}
            </nav>

            {/* direita */}
            <div className="relative flex items-center justify-end gap-2 justify-self-end sm:gap-3">
                <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        void handleLogoFile(f);
                    }}
                />

                {canOfferInstall && (
                    <div ref={iosHintRef} className="relative">
                        <button
                            type="button"
                            onClick={() => {
                                handleInstallClick().catch(() => {});
                            }}
                            title="Instalar app"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/12 text-white transition-transform duration-150 hover:-translate-y-0.5"
                        >
                            <Download size={16} />
                        </button>

                        {installHintOpen && (
                            <div className="absolute right-0 top-[calc(100%+10px)] z-[60] w-[260px] rounded-lg bg-white p-3 text-[12.5px] leading-snug text-zinc-800 shadow-[0_8px_24px_rgba(0,0,0,0.18)]">
                                <div className="mb-1 font-bold">Instalar como app</div>
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

                {onToggleFullscreen && (
                    <button
                        type="button"
                        onClick={onToggleFullscreen}
                        title={isFullscreen ? "Sair da tela cheia (F11)" : "Tela cheia (F11)"}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/12 text-white transition-transform duration-150 hover:-translate-y-0.5"
                    >
                        {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                )}

                <button
                    type="button"
                    aria-haspopup="true"
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((s) => !s)}
                    title="Menu da empresa"
                    className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-bold text-[#16364D] shadow-[0_2px_6px_rgba(0,0,0,0.12)] transition-transform duration-150 hover:-translate-y-0.5"
                >
                    {logoUploading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-[#16364D]" />
                    ) : companyLogoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={companyLogoUrl}
                            alt=""
                            className="h-full w-full object-cover"
                        />
                    ) : (
                        <ImagePlus className="h-4 w-4 text-[#16364D]/70" aria-hidden />
                    )}
                </button>

                {logoHint ? (
                    <span className="absolute right-0 top-[calc(100%+6px)] z-[60] max-w-[240px] rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 shadow-lg">
                        {logoHint}{" "}
                        <button
                            type="button"
                            className="font-bold text-[#16364D] underline"
                            onClick={() => {
                                setLogoHint(null);
                                router.push("/configuracoes");
                            }}
                        >
                            Abrir
                        </button>
                    </span>
                ) : null}

                <div
                    ref={menuRef}
                    className={cn(
                        "absolute right-0 top-[calc(100%+10px)] z-[60] min-w-[200px] rounded-lg bg-white p-2 text-zinc-800 shadow-[0_8px_24px_rgba(0,0,0,0.18)]",
                        menuOpen ? "block" : "hidden"
                    )}
                >
                    <div className="border-b border-zinc-100 px-3 py-2">
                        <div className="font-bold">{currentCompany?.name ?? "Empresa"}</div>
                        <div className="text-xs text-zinc-500">Empresa</div>
                    </div>

                    <div className="flex flex-col gap-1.5 p-2">
                        <button
                            type="button"
                            onClick={() => {
                                setMenuOpen(false);
                                logoInputRef.current?.click();
                            }}
                            className="rounded-md px-2.5 py-2 text-left text-sm font-bold text-zinc-700 hover:bg-zinc-50"
                        >
                            {companyLogoUrl ? "Trocar logo" : "Adicionar logo"}
                        </button>
                        <button
                            type="button"
                            onClick={goToSettings}
                            className="rounded-md px-2.5 py-2 text-left text-sm font-bold text-zinc-700 hover:bg-zinc-50"
                        >
                            Configurações
                        </button>
                        <button
                            type="button"
                            onClick={handleSignOut}
                            className="rounded-md px-2.5 py-2 text-left text-sm font-bold text-red-700 hover:bg-red-50"
                        >
                            Sair
                        </button>
                    </div>
                </div>
            </div>
        </header>
    );
}
