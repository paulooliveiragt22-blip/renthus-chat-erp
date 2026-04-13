"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
    Building2,
    LayoutDashboard,
    LogOut,
    MessageSquare,
    Moon,
    Receipt,
    Shield,
    Sun,
    X,
} from "lucide-react";

const saMenu = [
    { label: "Dashboard",  href: "/superadmin",          icon: LayoutDashboard },
    { label: "Empresas",   href: "/superadmin/empresas",  icon: Building2       },
    { label: "Canais WA",  href: "/superadmin/canais",    icon: MessageSquare   },
    { label: "Pedidos",    href: "/superadmin/pedidos",   icon: Receipt         },
    { label: "Segurança",  href: "/superadmin/seguranca", icon: Shield          },
];

interface Props {
    isOpen:  boolean;
    onClose: () => void;
}

export default function SuperAdminSidebar({ isOpen, onClose }: Props) {
    const pathname            = usePathname();
    const router              = useRouter();
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    useEffect(() => { onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

    const isDark = theme === "dark";

    async function handleLogout() {
        await fetch("/api/superadmin/login", { method: "DELETE" });
        router.push("/superadmin/login");
    }

    return (
        <aside
            className={[
                "fixed inset-y-0 left-0 z-50 flex h-full w-72 shrink-0 flex-col overflow-hidden",
                "bg-primary text-zinc-50 transition-transform duration-300",
                "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-60 lg:translate-x-0",
                isOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
            ].join(" ")}
        >
            {/* ── Logo ──────────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-lg font-bold shadow-[0_0_20px_rgba(249,115,22,0.3)]">
                    S
                </div>
                <div className="flex-1">
                    <div className="text-sm font-semibold tracking-wide">Renthus</div>
                    <div className="text-[10px] font-medium text-white/50">Super Admin</div>
                </div>
                <button
                    onClick={onClose}
                    aria-label="Fechar menu"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* ── Navegação ─────────────────────────────────────────────────── */}
            <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
                {saMenu.map((item) => {
                    const Icon   = item.icon;
                    const active =
                        item.href === "/superadmin"
                            ? pathname === "/superadmin"
                            : pathname.startsWith(item.href);

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

            {/* ── Rodapé ────────────────────────────────────────────────────── */}
            <div className="space-y-2 border-t border-white/10 px-4 py-3">
                <button
                    onClick={() => setTheme(isDark ? "light" : "dark")}
                    aria-label="Alternar tema"
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-white/70 transition-all hover:bg-white/8 hover:text-white"
                >
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
                        {mounted ? (
                            isDark
                                ? <Sun  className="h-3.5 w-3.5 text-yellow-300" />
                                : <Moon className="h-3.5 w-3.5 text-white/70"   />
                        ) : <span className="h-3.5 w-3.5" />}
                    </div>
                    <span>{mounted && isDark ? "Modo Claro" : "Modo Escuro"}</span>
                </button>

                <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-white/60 transition-all hover:bg-red-500/20 hover:text-red-300"
                >
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/5">
                        <LogOut className="h-3.5 w-3.5" />
                    </div>
                    <span>Sair</span>
                </button>
            </div>
        </aside>
    );
}
