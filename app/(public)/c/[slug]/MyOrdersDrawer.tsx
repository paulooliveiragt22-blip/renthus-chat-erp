"use client";

import { useCallback, useEffect, useState } from "react";
import type {
    PublicMenuOrderDetail,
    PublicMenuOrderSummary,
    PublicMenuSessionOk,
} from "@/src/types/contracts.public-menu";
import {
    loadStoredMenuSession,
    saveStoredMenuSession,
} from "@/lib/public-menu/sessionStorage";

function formatBRL(n: number): string {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}

type Props = {
    slug: string;
    storeName: string;
    onClose: () => void;
};

export default function MyOrdersDrawer({ slug, storeName, onClose }: Props) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessionToken, setSessionToken] = useState<string | null>(null);
    const [phone, setPhone] = useState("");
    const [name, setName] = useState("");
    const [orders, setOrders] = useState<PublicMenuOrderSummary[]>([]);
    const [detail, setDetail] = useState<PublicMenuOrderDetail | null>(null);

    const loadOrders = useCallback(
        async (token: string) => {
            setBusy(true);
            setError(null);
            try {
                const res = await fetch(`/api/public/menu/${encodeURIComponent(slug)}/orders`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sessionToken: token }),
                });
                const json = (await res.json()) as
                    | { ok: true; orders: PublicMenuOrderSummary[] }
                    | { ok: false; error: string };
                if (!json.ok) {
                    setError(
                        json.error === "session_invalid"
                            ? "Sessão expirada. Informe seu telefone novamente."
                            : "Não foi possível carregar os pedidos."
                    );
                    setSessionToken(null);
                    return;
                }
                setOrders(json.orders);
            } catch {
                setError("Falha de conexão.");
            } finally {
                setBusy(false);
            }
        },
        [slug]
    );

    useEffect(() => {
        const stored = loadStoredMenuSession(slug);
        if (!stored) return;
        setSessionToken(stored.sessionToken);
        setPhone(stored.phoneE164);
        setName(stored.customerName ?? "");
        void loadOrders(stored.sessionToken);
    }, [slug, loadOrders]);

    async function identify() {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/public/menu/${encodeURIComponent(slug)}/session`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone, name: name || undefined }),
            });
            const json = (await res.json()) as PublicMenuSessionOk | { ok: false; error: string };
            if (!json.ok) {
                if (json.error === "name_required") {
                    setError("Informe seu nome (primeiro acesso).");
                } else if (json.error === "phone_invalid") {
                    setError("Telefone inválido.");
                } else {
                    setError("Não foi possível identificar.");
                }
                return;
            }
            setSessionToken(json.sessionToken);
            saveStoredMenuSession(slug, {
                sessionToken: json.sessionToken,
                customerName: json.customer.name,
                phoneE164: json.customer.phoneE164,
            });
            await loadOrders(json.sessionToken);
        } catch {
            setError("Falha de conexão.");
        } finally {
            setBusy(false);
        }
    }

    async function openDetail(orderId: string) {
        if (!sessionToken) return;
        setBusy(true);
        setError(null);
        try {
            const res = await fetch(`/api/public/menu/${encodeURIComponent(slug)}/orders`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionToken, orderId }),
            });
            const json = (await res.json()) as
                | { ok: true; order: PublicMenuOrderDetail }
                | { ok: false; error: string };
            if (!json.ok) {
                setError("Pedido não encontrado.");
                return;
            }
            setDetail(json.order);
        } catch {
            setError("Falha ao abrir o pedido.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#f6f3ee]">
            <header className="flex items-center justify-between border-b border-zinc-200 bg-[#1c1917] px-4 py-3 text-[#faf7f2]">
                <button
                    type="button"
                    onClick={() => {
                        if (detail) {
                            setDetail(null);
                            return;
                        }
                        onClose();
                    }}
                    className="text-sm font-medium text-zinc-300"
                >
                    {detail ? "Lista" : "Fechar"}
                </button>
                <p className="text-sm font-semibold">Meus pedidos · {storeName}</p>
                <span className="w-12" />
            </header>

            <div className="mx-auto w-full max-w-lg flex-1 overflow-y-auto px-4 py-5">
                {error ? (
                    <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
                        {error}
                    </p>
                ) : null}

                {!sessionToken && (
                    <section className="space-y-4">
                        <h2 className="text-lg font-semibold text-zinc-900">Identifique-se</h2>
                        <p className="text-sm text-zinc-500">
                            Use o mesmo WhatsApp do pedido para ver o histórico.
                        </p>
                        <label className="block text-sm">
                            <span className="text-zinc-600">Telefone</span>
                            <input
                                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                inputMode="tel"
                                placeholder="(11) 99999-9999"
                            />
                        </label>
                        <label className="block text-sm">
                            <span className="text-zinc-600">Nome (se for a 1ª vez)</span>
                            <input
                                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                            />
                        </label>
                        <button
                            type="button"
                            disabled={busy || !phone.trim()}
                            onClick={() => void identify()}
                            className="w-full rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-50"
                        >
                            {busy ? "Carregando…" : "Ver meus pedidos"}
                        </button>
                    </section>
                )}

                {sessionToken && !detail && (
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold text-zinc-900">Últimos pedidos</h2>
                        {busy && orders.length === 0 ? (
                            <p className="text-sm text-zinc-500">Carregando…</p>
                        ) : null}
                        {!busy && orders.length === 0 ? (
                            <p className="rounded-xl bg-white p-6 text-center text-sm text-zinc-500 ring-1 ring-zinc-200">
                                Você ainda não tem pedidos nesta loja.
                            </p>
                        ) : null}
                        <ul className="space-y-2">
                            {orders.map((o) => (
                                <li key={o.id}>
                                    <button
                                        type="button"
                                        onClick={() => void openDetail(o.id)}
                                        className="w-full rounded-xl bg-white px-4 py-3 text-left ring-1 ring-zinc-200 transition hover:ring-zinc-400"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <p className="text-sm font-semibold text-zinc-900">
                                                    {o.orderCode}
                                                </p>
                                                <p className="mt-0.5 text-xs text-zinc-500">
                                                    {formatDate(o.createdAt)}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-zinc-900">
                                                    {formatBRL(o.grandTotal)}
                                                </p>
                                                <p className="mt-0.5 text-[11px] font-medium text-amber-800">
                                                    {o.statusLabel}
                                                </p>
                                            </div>
                                        </div>
                                        <p className="mt-2 text-xs text-zinc-500">
                                            {o.itemCount} {o.itemCount === 1 ? "item" : "itens"}
                                            {o.paymentMethod
                                                ? ` · ${
                                                      o.paymentMethod === "pix"
                                                          ? "PIX"
                                                          : o.paymentMethod === "card"
                                                            ? "Cartão"
                                                            : o.paymentMethod === "cash"
                                                              ? "Dinheiro"
                                                              : o.paymentMethod
                                                  }`
                                                : ""}
                                        </p>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {detail && (
                    <section className="space-y-4">
                        <div>
                            <h2 className="text-lg font-semibold text-zinc-900">
                                Pedido {detail.orderCode}
                            </h2>
                            <p className="mt-1 text-sm font-medium text-amber-800">
                                {detail.statusLabel}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-500">
                                {formatDate(detail.createdAt)}
                            </p>
                        </div>

                        <ul className="divide-y divide-zinc-100 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200">
                            {detail.items.map((item, idx) => (
                                <li
                                    key={`${item.productName}-${idx}`}
                                    className="flex justify-between gap-2 px-3 py-2.5 text-sm"
                                >
                                    <span className="min-w-0">
                                        {item.quantity}× {item.productName}
                                    </span>
                                    <span className="shrink-0 font-medium">
                                        {formatBRL(item.lineTotal)}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        <div className="space-y-1 rounded-xl bg-white p-3 text-sm ring-1 ring-zinc-200">
                            <div className="flex justify-between">
                                <span className="text-zinc-600">Subtotal</span>
                                <span>{formatBRL(detail.subtotal)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-zinc-600">Taxa de entrega</span>
                                <span>{formatBRL(detail.deliveryFee)}</span>
                            </div>
                            <div className="flex justify-between text-base font-bold">
                                <span>Total</span>
                                <span>{formatBRL(detail.grandTotal)}</span>
                            </div>
                        </div>

                        <div className="space-y-2 rounded-xl bg-white p-3 text-sm ring-1 ring-zinc-200">
                            <p>
                                <span className="text-zinc-500">Pagamento: </span>
                                <span className="font-medium">{detail.paymentLabel}</span>
                                {detail.changeFor != null && detail.changeFor > 0 ? (
                                    <span className="text-zinc-500">
                                        {" "}
                                        · troco para {formatBRL(detail.changeFor)}
                                    </span>
                                ) : null}
                            </p>
                            {detail.deliveryAddress ? (
                                <p>
                                    <span className="text-zinc-500">Endereço: </span>
                                    <span className="font-medium">{detail.deliveryAddress}</span>
                                </p>
                            ) : null}
                            {detail.channel || detail.source ? (
                                <p className="text-xs text-zinc-400">
                                    Origem:{" "}
                                    {detail.source === "web_menu"
                                        ? "Cardápio web"
                                        : detail.source === "flow_catalog"
                                          ? "WhatsApp Flow"
                                          : detail.source === "ai_chat_pro_v2" ||
                                              detail.source === "chatbot"
                                            ? "WhatsApp"
                                            : detail.source || detail.channel || "—"}
                                </p>
                            ) : null}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
