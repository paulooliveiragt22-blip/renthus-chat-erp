// components/AdminShell.tsx
"use client";

import React, { Suspense, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
import { CommandMenu } from "@/components/command/CommandMenu";

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
type OrderCustomer = {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
};

type OrderItemRow = {
    id: string;
    product_name?: string | null;
    quantity?: number | null;
    unit_price?: number | null;
    line_total?: number | null;
};

type OrderModal = {
    created_at: string;
    status?: string | null;
    notes?: string | null;
    details?: string | null;
    payment_method?: string | null;
    delivery_fee?: number | null;
    total_amount?: number | null;
    customers?: OrderCustomer | null;
    items: OrderItemRow[];
};

function asCustomer(raw: unknown): OrderCustomer | null {
    if (!raw || typeof raw !== "object") return null;
    if (Array.isArray(raw)) {
        const first = raw[0];
        return first && typeof first === "object" ? (first as OrderCustomer) : null;
    }
    return raw as OrderCustomer;
}

function AdminShellInner({ children }: { children: React.ReactNode }) {
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

    // ── Cmd/Ctrl+K ────────────────────────────────────────────────────────────
    const [commandOpen, setCommandOpen] = useState(false);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName?.toLowerCase();
            // Não intercepta se o usuário está digitando em campo de texto denso (exceto quando
            // o atalho é explícito — ainda assim Cmd+K é global tipo Linear).
            if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
                // Permite mesmo assim: padrão SaaS; evita conflito só com IME.
            }
            e.preventDefault();
            setCommandOpen((v) => !v);
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

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
    const [order, setOrder]     = useState<OrderModal | null>(null);
    const [msg, setMsg]         = useState<string | null>(null);

    async function fetchOrderFull(orderId: string): Promise<OrderModal | null> {
        setMsg(null);
        try {
            const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
                credentials: "include",
                cache: "no-store",
            });
            const body = (await res.json().catch(() => ({}))) as {
                error?: string;
                order?: Record<string, unknown>;
                items?: OrderItemRow[];
            };
            if (!res.ok || !body.order) {
                setMsg(`Erro ao carregar pedido: ${body.error ?? res.status}`);
                return null;
            }
            const o = body.order;
            return {
                created_at: String(o.created_at ?? ""),
                status: typeof o.status === "string" ? o.status : null,
                notes: typeof o.notes === "string" ? o.notes : null,
                details: typeof o.details === "string" ? o.details : null,
                payment_method:
                    typeof o.payment_method === "string" ? o.payment_method : null,
                delivery_fee: Number(o.delivery_fee ?? 0),
                total_amount: Number(o.total_amount ?? 0),
                customers: asCustomer(o.customers),
                items: Array.isArray(body.items) ? body.items : [],
            };
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            setMsg(`Erro ao carregar pedido: ${message}`);
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

                    <Suspense fallback={
                        <aside className={[
                            "flex flex-col overflow-hidden bg-primary",
                            collapsed ? "w-16" : "w-64 lg:w-60",
                            "fixed inset-y-0 left-0 z-50 h-full lg:static lg:h-full",
                        ].join(" ")} />
                    }>
                        <AdminSidebar
                            isOpen={sidebarOpen}
                            onClose={() => setSidebarOpen(false)}
                            collapsed={collapsed}
                            onToggleCollapse={() => setCollapsed((c) => !c)}
                        />
                    </Suspense>

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

            <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />

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
                                            {order.items.map((it) => {
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
