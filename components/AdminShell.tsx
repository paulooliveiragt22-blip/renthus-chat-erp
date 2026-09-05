// components/AdminShell.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AdminOrdersProvider } from "@/components/AdminOrdersContext";
import AdminSidebar from "@/components/AdminSidebar";
import HeaderClient from "@/components/HeaderClient";
import AdminPrimaryNav from "@/components/AdminPrimaryNav";
import BillingStatusBanner from "@/components/billing/BillingStatusBanner";
import ImpersonationBanner from "@/components/platform/ImpersonationBanner";
import { SyncStatusBar } from "@/lib/offline/presentation/SyncStatusBar";
import { PwaUpdateBanner } from "@/lib/offline/presentation/PwaUpdateBanner";
import { installOutboxWakeListeners } from "@/lib/offline/adapters/workboxBgSyncBridge";
import { prefetchAdminOfflineSnapshots } from "@/lib/offline/browserStores";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { installBillingFetchInterceptor } from "@/lib/billing/installBillingFetchInterceptor";
import { useAdminPrimaryDockVisible } from "@/lib/ui/useAdminPrimaryDockVisible";
import { cn } from "@/lib/utils";
import Modal from "@/lib/orders/Modal";
import { Skeleton } from "@/components/ui/skeleton";

// ── Wrapper externo: só lê pathname (resolve rules-of-hooks) ──────────────────
export default function AdminShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    // Paywall / onboarding standalone (sem sidebar). Hub `/plano` fica no AdminShell.
    const isStandalone =
        pathname === "/login" ||
        pathname === "/billing/blocked" ||
        pathname.startsWith("/signup") ||
        pathname.startsWith("/onboarding") ||
        pathname === "/ativar" ||
        pathname.startsWith("/ativar/") ||
        pathname === "/plano/pagar" ||
        pathname === "/plano/bloqueado" ||
        pathname === "/plano/reativar" ||
        pathname === "/logout" ||
        pathname.startsWith("/c/") ||
        pathname === "/c" ||
        pathname.startsWith("/superadmin") ||
        pathname.startsWith("/platform");

    if (isStandalone) return <>{children}</>;

    return <AdminShellInner>{children}</AdminShellInner>;
}

// ── Inner: todos os hooks ficam aqui ─────────────────────────────────────────
function AdminShellInner({ children }: { children: React.ReactNode }) {
    const supabase = useMemo(() => createClient(), []);
    const primaryDockVisible = useAdminPrimaryDockVisible();
    const { currentCompanyId } = useWorkspace();

    useEffect(() => {
        return installOutboxWakeListeners(() => currentCompanyId);
    }, [currentCompanyId]);

    // P5a: prefetch catálogo + listas admin enquanto online (sem abrir cada aba)
    useEffect(() => {
        if (!currentCompanyId) return;
        if (typeof navigator !== "undefined" && !navigator.onLine) return;
        void prefetchAdminOfflineSnapshots(currentCompanyId);
        const onOnline = () => {
            void prefetchAdminOfflineSnapshots(currentCompanyId);
        };
        window.addEventListener("online", onOnline);
        return () => window.removeEventListener("online", onOnline);
    }, [currentCompanyId]);

    // ── Sidebar mobile ────────────────────────────────────────────────────────
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // ── Sidebar recolhido (desktop) ───────────────────────────────────────────
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem("sidebar-collapsed");
        if (stored === "true") setCollapsed(true);
    }, []);

    useEffect(() => {
        localStorage.setItem("sidebar-collapsed", String(collapsed));
    }, [collapsed]);

    useEffect(() => {
        installBillingFetchInterceptor();
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        const mq = window.matchMedia("(min-width: 1024px)");

        const syncDockLayout = () => {
            if (mq.matches || primaryDockVisible) {
                root.removeAttribute("data-admin-dock-hidden");
            } else {
                root.setAttribute("data-admin-dock-hidden", "true");
            }
        };

        syncDockLayout();
        mq.addEventListener("change", syncDockLayout);
        return () => {
            mq.removeEventListener("change", syncDockLayout);
            root.removeAttribute("data-admin-dock-hidden");
        };
    }, [primaryDockVisible]);

    // ── Fullscreen API ────────────────────────────────────────────────────────
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", handler);
        return () => document.removeEventListener("fullscreenchange", handler);
    }, []);

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    }

    // ── Modal de pedido (Radix via lib/orders/Modal) ─────────────────────────
    const [open, setOpen]       = useState(false);
    const [loading, setLoading] = useState(false);
    const [order, setOrder]     = useState<any | null>(null);
    const [msg, setMsg]         = useState<string | null>(null);

    async function fetchOrderFull(orderId: string) {
        setMsg(null);
        try {
            const { data: ord, error: ordErr } = await supabase
                .from("orders")
                .select(`
                    id, status, channel, total_amount, delivery_fee, payment_method, paid, change_for, created_at,
                    details,
                    notes,
                    customers ( name, phone, address )
                `)
                .eq("id", orderId)
                .single();

            if (ordErr) { setMsg(`Erro ao carregar pedido: ${ordErr.message}`); return null; }

            const { data: items, error: itemsErr } = await supabase
                .from("order_items")
                .select(`id, order_id, product_variant_id, product_name, unit_type, quantity, unit_price, line_total, qty, created_at`)
                .eq("order_id", orderId)
                .order("created_at", { ascending: true });

            if (itemsErr) { setMsg(`Erro ao carregar itens: ${itemsErr.message}`); return null; }

            return { ...(ord as any), items: (items as any) ?? [] };
        } catch (e: any) {
            setMsg(`Erro ao carregar pedido: ${String(e?.message ?? e)}`);
            return null;
        }
    }

    async function openOrder(orderId: string) {
        setMsg(null);
        setOpen(true);
        setLoading(true);
        setOrder(null);
        const full = await fetchOrderFull(orderId);
        setOrder(full);
        setLoading(false);
    }

    return (
        <AdminOrdersProvider openOrder={openOrder}>
            {/* ── App Shell: ocupa exatamente o viewport ── */}
            <div className="fixed inset-0 flex flex-col overflow-hidden bg-zinc-100 text-zinc-900 transition-colors duration-300 dark:bg-zinc-950 dark:text-zinc-50">

                {/* Header fixo no topo */}
                <HeaderClient
                    onOpenMobileMenu={() => setSidebarOpen(true)}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={toggleFullscreen}
                />
                <BillingStatusBanner />
                <ImpersonationBanner />
                <PwaUpdateBanner />
                <SyncStatusBar />

                {/* Corpo: sidebar + conteúdo */}
                <div className="flex flex-1 overflow-hidden">

                    {/* Overlay mobile */}
                    {sidebarOpen && (
                        <div
                            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                            onClick={() => setSidebarOpen(false)}
                            aria-hidden="true"
                        />
                    )}

                    <AdminSidebar
                        isOpen={sidebarOpen}
                        onClose={() => setSidebarOpen(false)}
                        collapsed={collapsed}
                        onToggleCollapse={() => setCollapsed((c) => !c)}
                    />

                    <main
                        className={cn(
                            "relative flex flex-1 flex-col overflow-y-auto bg-zinc-100 pb-[var(--admin-primary-dock-height)] transition-[padding] duration-200 dark:bg-zinc-950",
                            "lg:pb-0"
                        )}
                    >
                        <div className="mx-auto w-full max-w-screen-2xl px-3 py-3 md:px-5 md:py-4">
                            {children}
                        </div>
                    </main>
                </div>

                <AdminPrimaryNav variant="dock" dockVisible={primaryDockVisible} />
            </div>

            {/* ── Modal de pedido ── */}
            <Modal
                title={
                    order
                        ? `Pedido • ${new Date(order.created_at).toLocaleString("pt-BR")} • ${String(order?.status ?? "")}`
                        : "Pedido"
                }
                open={open}
                onClose={() => setOpen(false)}
            >
                <div className="space-y-3 text-[13px]">
                    {msg && <p className="text-xs font-medium text-rose-600">{msg}</p>}

                    {loading ? (
                        <div className="space-y-2">
                            <Skeleton className="h-16 w-full" />
                            <Skeleton className="h-24 w-full" />
                        </div>
                    ) : !order ? (
                        <p className="text-xs text-foreground-muted">Nenhum pedido.</p>
                    ) : (
                        <div className="space-y-3 text-[12px]">
                            <div className="rounded-xl border border-border bg-zinc-50 px-3 py-2 dark:bg-zinc-900/50">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold">
                                            {order.customers?.name ?? "-"}
                                        </div>
                                        <div className="text-[11px] text-foreground-muted">
                                            {order.customers?.phone ?? ""}
                                        </div>
                                        <div className="truncate text-[11px] text-foreground-muted">
                                            {order.customers?.address ?? "-"}
                                        </div>
                                    </div>
                                </div>
                                {(order.notes || order.details) && (
                                    <div className="mt-2 text-[11px] font-semibold text-foreground">
                                        OBS: <span>{order.notes || order.details}</span>
                                    </div>
                                )}
                            </div>

                            <div className="rounded-xl border border-border bg-background-card px-3 py-2">
                                <div className="mb-1 text-xs font-semibold text-foreground-muted">
                                    Pagamento
                                </div>
                                <div className="text-sm font-semibold">{order.payment_method}</div>
                            </div>

                            <div className="rounded-xl border border-border bg-background-card px-3 py-2">
                                <div className="mb-1 text-xs font-semibold text-foreground-muted">
                                    Itens
                                </div>
                                {order.items?.length === 0 ? (
                                    <p className="text-xs text-foreground-muted">Sem itens.</p>
                                ) : (
                                    <table className="w-full border-collapse text-[11px]">
                                        <thead>
                                            <tr className="border-b border-border bg-zinc-50 text-[10px] uppercase tracking-wide text-foreground-muted dark:bg-zinc-900/40">
                                                <th className="px-2 py-1 text-left">Item</th>
                                                <th className="px-2 py-1 text-right">Qtd</th>
                                                <th className="px-2 py-1 text-right">Preço</th>
                                                <th className="px-2 py-1 text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {order.items.map((it: any) => {
                                                const q = Number(it.quantity ?? 0);
                                                const p = Number(it.unit_price ?? 0);
                                                const t = Number(it.line_total ?? q * p);
                                                return (
                                                    <tr key={it.id}>
                                                        <td className="px-2 py-1">
                                                            {it.product_name ?? "Item"}
                                                        </td>
                                                        <td className="px-2 py-1 text-right">{q}</td>
                                                        <td className="px-2 py-1 text-right">
                                                            R${" "}
                                                            {p.toLocaleString("pt-BR", {
                                                                minimumFractionDigits: 2,
                                                            })}
                                                        </td>
                                                        <td className="px-2 py-1 text-right">
                                                            R${" "}
                                                            {t.toLocaleString("pt-BR", {
                                                                minimumFractionDigits: 2,
                                                            })}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                                <div className="mt-2 space-y-1 text-[11px]">
                                    <div className="flex items-center justify-between">
                                        <span>Taxa de entrega</span>
                                        <b>
                                            R${" "}
                                            {Number(order.delivery_fee ?? 0).toLocaleString("pt-BR", {
                                                minimumFractionDigits: 2,
                                            })}
                                        </b>
                                    </div>
                                    <div className="flex items-center justify-between text-[12px]">
                                        <span>Total</span>
                                        <b>
                                            R${" "}
                                            {Number(order.total_amount ?? 0).toLocaleString("pt-BR", {
                                                minimumFractionDigits: 2,
                                            })}
                                        </b>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </Modal>
        </AdminOrdersProvider>
    );
}
