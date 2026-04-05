// components/AdminShell.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AdminOrdersProvider } from "@/components/AdminOrdersContext";
import AdminSidebar from "@/components/AdminSidebar";
import HeaderClient from "@/components/HeaderClient";

// ── Wrapper externo: só lê pathname (resolve rules-of-hooks) ──────────────────
export default function AdminShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    const isStandalone =
        pathname === "/login" ||
        pathname === "/billing/blocked" ||
        pathname.startsWith("/signup") ||
        pathname.startsWith("/onboarding") ||
        pathname.startsWith("/superadmin");

    if (isStandalone) return <>{children}</>;

    return <AdminShellInner>{children}</AdminShellInner>;
}

// ── Inner: todos os hooks ficam aqui ─────────────────────────────────────────
function AdminShellInner({ children }: { children: React.ReactNode }) {
    const supabase = useMemo(() => createClient(), []);

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

    // ── Modal de pedido (mantido) ─────────────────────────────────────────────
    const [open, setOpen]       = useState(false);
    const [loading, setLoading] = useState(false);
    const [order, setOrder]     = useState<any | null>(null);
    const [msg, setMsg]         = useState<string | null>(null);
    const orderDialogRef        = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const el = orderDialogRef.current;
        if (!el) return;
        if (open) {
            if (!el.open) el.showModal();
        } else if (el.open) {
            el.close();
        }
    }, [open]);

    async function fetchOrderFull(orderId: string) {
        setMsg(null);
        try {
            const { data: ord, error: ordErr } = await supabase
                .from("orders")
                .select(`
                    id, status, channel, total_amount, delivery_fee, payment_method, paid, change_for, created_at,
                    details,
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

                    <main className="relative flex flex-1 flex-col overflow-y-auto bg-zinc-100 transition-colors duration-300 dark:bg-zinc-950">
                        <div className="mx-auto w-full max-w-screen-2xl px-3 py-3 md:px-5 md:py-4">
                            {children}
                        </div>
                    </main>
                </div>
            </div>

            {/* ── Modal de pedido ── */}
            <dialog
                ref={orderDialogRef}
                className="fixed left-1/2 top-1/2 z-[9999] max-h-[90vh] w-full max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-zinc-200 bg-white p-4 text-[13px] shadow-lg backdrop:bg-black/40"
                onCancel={(e) => {
                    e.preventDefault();
                    setOpen(false);
                }}
            >
                        <div className="mb-3 flex items-center justify-between gap-3">
                            <h3 className="text-sm font-semibold">
                                {order
                                    ? `Pedido • ${new Date(order.created_at).toLocaleString("pt-BR")} • ${String(order?.status ?? "")}`
                                    : "Pedido"}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                            >
                                Fechar
                            </button>
                        </div>

                        <div className="space-y-3">
                            {msg && <p className="text-xs font-medium text-rose-600">{msg}</p>}

                            {loading ? (
                                <p className="text-xs text-zinc-500">Carregando...</p>
                            ) : !order ? (
                                <p className="text-xs text-zinc-500">Nenhum pedido.</p>
                            ) : (
                                <div className="space-y-3 text-[12px]">
                                    <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <div className="text-sm font-semibold">{order.customers?.name ?? "-"}</div>
                                                <div className="text-[11px] text-zinc-500">{order.customers?.phone ?? ""}</div>
                                                <div className="text-[11px] text-zinc-500">{order.customers?.address ?? "-"}</div>
                                            </div>
                                        </div>
                                        {order.details && (
                                            <div className="mt-2 text-[11px] font-semibold text-zinc-700">
                                                OBS: <span>{order.details}</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
                                        <div className="mb-1 text-xs font-semibold text-zinc-600">Pagamento</div>
                                        <div className="text-sm font-semibold text-zinc-900">{order.payment_method}</div>
                                    </div>

                                    <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2">
                                        <div className="mb-1 text-xs font-semibold text-zinc-600">Itens</div>
                                        {order.items?.length === 0 ? (
                                            <p className="text-xs text-zinc-500">Sem itens.</p>
                                        ) : (
                                            <table className="w-full border-collapse text-[11px]">
                                                <thead>
                                                    <tr className="border-b border-zinc-100 bg-zinc-50 text-[10px] uppercase tracking-wide text-zinc-500">
                                                        <th className="px-2 py-1 text-left">Item</th>
                                                        <th className="px-2 py-1 text-right">Qtd</th>
                                                        <th className="px-2 py-1 text-right">Preço</th>
                                                        <th className="px-2 py-1 text-right">Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100">
                                                    {order.items.map((it: any) => {
                                                        const q = Number(it.quantity ?? 0);
                                                        const p = Number(it.unit_price ?? 0);
                                                        const t = Number(it.line_total ?? q * p);
                                                        return (
                                                            <tr key={it.id} className="bg-white">
                                                                <td className="px-2 py-1">{it.product_name ?? "Item"}</td>
                                                                <td className="px-2 py-1 text-right">{q}</td>
                                                                <td className="px-2 py-1 text-right">R$ {p.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                                                                <td className="px-2 py-1 text-right">R$ {t.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        )}
                                        <div className="mt-2 space-y-1 text-[11px]">
                                            <div className="flex items-center justify-between">
                                                <span>Taxa de entrega</span>
                                                <b>R$ {Number(order.delivery_fee ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</b>
                                            </div>
                                            <div className="flex items-center justify-between text-[12px]">
                                                <span>Total</span>
                                                <b>R$ {Number(order.total_amount ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</b>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
            </dialog>
        </AdminOrdersProvider>
    );
}
