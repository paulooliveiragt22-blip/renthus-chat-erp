// components/HeaderClient.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { useInstallPrompt } from "@/lib/pwa/useInstallPrompt";
import AdminPrimaryNav from "@/components/AdminPrimaryNav";
import {
    Download,
    ImagePlus,
    Loader2,
    LogOut,
    Maximize2,
    Menu,
    Minimize2,
    Moon,
    Settings,
    Sun,
} from "lucide-react";
import { toast } from "sonner";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    const { theme, setTheme } = useTheme();
    const { currentCompany } = useWorkspace();

    const [sessionExists, setSessionExists] = useState<boolean | null>(null);
    const logoInputRef = useRef<HTMLInputElement | null>(null);

    const [companyLogoUrl, setCompanyLogoUrl] = useState<string | null>(null);
    const [logoUploading, setLogoUploading] = useState(false);

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
            if (iosHintRef.current && !iosHintRef.current.contains(e.target as Node)) {
                setInstallHintOpen(false);
            }
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setInstallHintOpen(false);
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
            router.push("/login");
        }
    }

    async function handleLogoFile(file: File | null) {
        if (!file) return;
        setLogoUploading(true);
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
            };
            if (!res.ok) {
                if (json.error === "profile_missing") {
                    toast.error("Salve o cardápio em Configurações antes de enviar o logo.", {
                        action: {
                            label: "Abrir",
                            onClick: () => router.push("/configuracoes"),
                        },
                    });
                    return;
                }
                toast.error(json.error ?? "Falha ao enviar logo.");
                return;
            }
            if (typeof json.url === "string") {
                setCompanyLogoUrl(json.url);
                toast.success("Logo atualizado");
            }
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

    const isDark = theme === "dark";

    return (
        <header className="relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 bg-[#11283B] px-3 py-2.5 text-white shadow-[0_6px_12px_rgba(0,0,0,0.16)] sm:px-[18px] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
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
                <a href="/" aria-label="Zampell" className="inline-flex shrink-0 items-center gap-2 no-underline">
                    <img
                        src="/brand/icone-512-transparente.svg?v=z1"
                        alt=""
                        className="block h-7 w-7 object-contain"
                    />
                    <img
                        src="/brand/zampell-wordmark.png?v=z1"
                        alt="Zampell"
                        className="block h-7 w-auto object-contain"
                    />
                </a>
            </div>

            <AdminPrimaryNav variant="desktop" />

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

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            type="button"
                            title="Menu da conta"
                            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white text-sm font-bold text-[#16364D] shadow-[0_2px_6px_rgba(0,0,0,0.12)] transition-transform duration-150 hover:-translate-y-0.5 outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="z-[70] min-w-52">
                        <DropdownMenuLabel className="font-normal">
                            <div className="font-semibold text-foreground">
                                {currentCompany?.name ?? "Empresa"}
                            </div>
                            <div className="text-xs text-foreground-muted">Conta</div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={() => {
                                logoInputRef.current?.click();
                            }}
                        >
                            <ImagePlus className="h-4 w-4" />
                            {companyLogoUrl ? "Trocar logo" : "Adicionar logo"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => router.push("/configuracoes")}>
                            <Settings className="h-4 w-4" />
                            Configurações
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
                            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                            {isDark ? "Modo claro" : "Modo escuro"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:focus:bg-red-950/40"
                            onSelect={() => {
                                void handleSignOut();
                            }}
                        >
                            <LogOut className="h-4 w-4" />
                            Sair
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
