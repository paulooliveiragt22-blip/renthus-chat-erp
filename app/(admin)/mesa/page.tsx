"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import MarketPlanGate from "@/components/menu/MarketPlanGate";

type FloorTable = {
    id: string;
    code: string;
    label: string | null;
    capacity: number | null;
    sort_order: number;
    table_status: string;
    session_id: string | null;
    opened_at: string | null;
    session_total: number;
    items_count: number;
};

type SessionItem = {
    id: string;
    produto_embalagem_id: string;
    product_id: string | null;
    product_name: string;
    qty: number;
    unit_price: number;
    sigla_comercial: string | null;
};

type SessionDetail = {
    id: string;
    status: string;
    total: number;
    table: { id: string; code: string; label: string | null };
    items: SessionItem[];
};

type ProductHit = {
    embalagemId: string;
    productId: string;
    name: string;
    price: number;
    sigla: string | null;
};

function money(n: number) {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function MesaFloor() {
    const [loading, setLoading] = useState(true);
    const [tables, setTables] = useState<FloorTable[]>([]);
    const [msg, setMsg] = useState<string | null>(null);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [session, setSession] = useState<SessionDetail | null>(null);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState("");
    const [hits, setHits] = useState<ProductHit[]>([]);
    const [cashRegisterId, setCashRegisterId] = useState("");
    const [cashLabel, setCashLabel] = useState<string | null>(null);
    const [paymentMethod, setPaymentMethod] = useState("pix");
    const [newCode, setNewCode] = useState("");

    const loadFloor = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/mesa/floor", { credentials: "include", cache: "no-store" });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Falha ao carregar mesas.");
                return;
            }
            setTables(Array.isArray(json.tables) ? json.tables : []);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadSession = useCallback(async (sessionId: string) => {
        const res = await fetch(`/api/admin/mesa/sessions/${sessionId}`, {
            credentials: "include",
            cache: "no-store",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setMsg(json.error || "Sessão inválida.");
            return;
        }
        setSession(json.session as SessionDetail);
        setActiveSessionId(sessionId);
    }, []);

    useEffect(() => {
        void loadFloor();
        void (async () => {
            const res = await fetch("/api/admin/pdv/cash-register", {
                credentials: "include",
                cache: "no-store",
            });
            const json = await res.json().catch(() => ({}));
            const caixa = json?.caixa;
            if (caixa?.id) {
                setCashRegisterId(String(caixa.id));
                const op = caixa.operator_name ? String(caixa.operator_name) : null;
                setCashLabel(op ? `Aberto · ${op}` : "Caixa aberto");
            } else {
                setCashRegisterId("");
                setCashLabel(null);
            }
        })();
    }, [loadFloor]);

    useEffect(() => {
        const q = search.trim();
        if (q.length < 2) {
            setHits([]);
            return;
        }
        const timer = setTimeout(() => {
            void (async () => {
                const res = await fetch(
                    `/api/admin/pdv/products?q=${encodeURIComponent(q)}&limit=24`,
                    { credentials: "include", cache: "no-store" }
                );
                const json = await res.json().catch(() => ({}));
                const rows = Array.isArray(json.rows) ? json.rows : [];
                const mapped: ProductHit[] = rows.map((r: Record<string, unknown>) => ({
                    embalagemId: String(r.id ?? ""),
                    productId: String(r.produto_id ?? ""),
                    name: String(r.product_name ?? r.descricao ?? "Item"),
                    price: Number(r.preco_venda ?? 0),
                    sigla: (r.sigla_comercial ?? null) as string | null,
                }));
                setHits(mapped.slice(0, 8));
            })();
        }, 280);
        return () => clearTimeout(timer);
    }, [search]);

    async function openTable(tableId: string) {
        setBusy(true);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/mesa/sessions", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tableId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Não abriu a mesa.");
                return;
            }
            const sid = json.session?.id as string;
            await loadFloor();
            if (sid) await loadSession(sid);
        } finally {
            setBusy(false);
        }
    }

    async function addItem(hit: ProductHit) {
        if (!activeSessionId) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/admin/mesa/sessions/${activeSessionId}/items`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    produto_embalagem_id: hit.embalagemId,
                    product_id: hit.productId || null,
                    product_name: hit.name,
                    qty: 1,
                    unit_price: hit.price,
                    sigla_comercial: hit.sigla,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Falha ao adicionar item.");
                return;
            }
            setSearch("");
            setHits([]);
            await loadSession(activeSessionId);
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    async function removeItem(itemId: string) {
        if (!activeSessionId) return;
        setBusy(true);
        try {
            await fetch(
                `/api/admin/mesa/sessions/${activeSessionId}/items?itemId=${encodeURIComponent(itemId)}`,
                { method: "DELETE", credentials: "include" }
            );
            await loadSession(activeSessionId);
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    async function setItemQty(itemId: string, qty: number) {
        if (!activeSessionId) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/admin/mesa/sessions/${activeSessionId}/items`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ itemId, qty }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Falha ao atualizar quantidade.");
                return;
            }
            await loadSession(activeSessionId);
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    async function closeSession() {
        if (!activeSessionId) return;
        if (!cashRegisterId) {
            setMsg("Abra o caixa no PDV antes de fechar a mesa.");
            return;
        }
        setBusy(true);
        setMsg(null);
        try {
            const res = await fetch(`/api/admin/mesa/sessions/${activeSessionId}/close`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    cash_register_id: cashRegisterId,
                    payment_method: paymentMethod,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Falha ao fechar conta.");
                return;
            }
            setMsg(`Conta fechada. Pedido ${String(json.orderId).slice(0, 8)}…`);
            setSession(null);
            setActiveSessionId(null);
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    async function createTable() {
        const code = newCode.trim();
        if (!code) return;
        setBusy(true);
        try {
            const res = await fetch("/api/admin/mesa/tables", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code, label: `Mesa ${code}` }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Não criou a mesa.");
                return;
            }
            setNewCode("");
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    const occupied = useMemo(
        () => tables.filter((t) => t.session_id).length,
        [tables]
    );

    if (loading) {
        return (
            <div className="flex items-center gap-2 p-8 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando salão…
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 p-4 md:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                        <UtensilsCrossed className="h-5 w-5" />
                        Mesas
                    </h1>
                    <p className="mt-1 text-sm text-zinc-500">
                        {tables.length} mesas · {occupied} ocupadas
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <input
                        className="w-28 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        placeholder="Nº"
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value)}
                    />
                    <button
                        type="button"
                        disabled={busy || !newCode.trim()}
                        onClick={() => void createTable()}
                        className="inline-flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                    >
                        <Plus className="h-4 w-4" />
                        Mesa
                    </button>
                </div>
            </div>

            {msg && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                    {msg}
                </p>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {tables.map((t) => {
                        const open = Boolean(t.session_id);
                        return (
                            <button
                                key={t.id}
                                type="button"
                                disabled={busy || t.table_status === "disabled"}
                                onClick={() => {
                                    if (open && t.session_id) void loadSession(t.session_id);
                                    else void openTable(t.id);
                                }}
                                className={[
                                    "rounded-xl border p-4 text-left transition",
                                    open
                                        ? "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30"
                                        : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950",
                                ].join(" ")}
                            >
                                <div className="text-lg font-semibold">{t.label || `Mesa ${t.code}`}</div>
                                <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
                                    {open ? "Ocupada" : t.table_status === "disabled" ? "Inativa" : "Livre"}
                                </div>
                                {open && (
                                    <div className="mt-2 text-sm font-medium">
                                        {money(Number(t.session_total || 0))}
                                        <span className="ml-1 text-xs font-normal text-zinc-500">
                                            · {t.items_count} itens
                                        </span>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>

                <aside className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                    {!session ? (
                        <p className="text-sm text-zinc-500">
                            Selecione uma mesa livre para abrir, ou uma ocupada para lançar itens.
                        </p>
                    ) : (
                        <div className="flex flex-col gap-4">
                            <div>
                                <h2 className="font-semibold">
                                    {session.table.label || `Mesa ${session.table.code}`}
                                </h2>
                                <p className="text-sm text-zinc-500">Total {money(Number(session.total || 0))}</p>
                            </div>

                            <ul className="max-h-56 space-y-2 overflow-auto text-sm">
                                {session.items.map((it) => (
                                    <li
                                        key={it.id}
                                        className="flex items-start justify-between gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium truncate">{it.product_name}</div>
                                            <div className="text-xs text-zinc-500">
                                                {money(Number(it.unit_price))}
                                                {it.sigla_comercial ? ` · ${it.sigla_comercial}` : ""}
                                                {" · "}
                                                {money(Number(it.unit_price) * Number(it.qty))}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                disabled={busy}
                                                className="rounded border border-zinc-200 p-1 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700"
                                                onClick={() =>
                                                    void setItemQty(it.id, Number(it.qty) - 1)
                                                }
                                                aria-label="Diminuir"
                                            >
                                                <Minus className="h-3.5 w-3.5" />
                                            </button>
                                            <span className="w-6 text-center tabular-nums">{it.qty}</span>
                                            <button
                                                type="button"
                                                disabled={busy}
                                                className="rounded border border-zinc-200 p-1 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700"
                                                onClick={() =>
                                                    void setItemQty(it.id, Number(it.qty) + 1)
                                                }
                                                aria-label="Aumentar"
                                            >
                                                <Plus className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="ml-1 text-zinc-400 hover:text-red-500"
                                                onClick={() => void removeItem(it.id)}
                                                aria-label="Remover"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                                {session.items.length === 0 && (
                                    <li className="text-zinc-500">Nenhum item ainda.</li>
                                )}
                            </ul>

                            <div>
                                <input
                                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    placeholder="Buscar produto…"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                                {hits.length > 0 && (
                                    <ul className="mt-2 max-h-40 overflow-auto rounded-lg border border-zinc-200 text-sm dark:border-zinc-700">
                                        {hits.map((h) => (
                                            <li key={h.embalagemId}>
                                                <button
                                                    type="button"
                                                    className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                                                    onClick={() => void addItem(h)}
                                                >
                                                    <span>
                                                        {h.name}
                                                        {h.sigla ? ` (${h.sigla})` : ""}
                                                    </span>
                                                    <span className="text-zinc-500">{money(h.price)}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>

                            <div className="space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                                <div className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700">
                                    {cashRegisterId ? (
                                        <>
                                            <div className="font-medium text-emerald-700 dark:text-emerald-300">
                                                {cashLabel ?? "Caixa aberto"}
                                            </div>
                                            <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
                                                {cashRegisterId.slice(0, 8)}…
                                            </div>
                                        </>
                                    ) : (
                                        <p className="text-amber-700 dark:text-amber-300">
                                            Abra o caixa no PDV antes de fechar.
                                        </p>
                                    )}
                                </div>
                                <label className="block text-xs text-zinc-500">
                                    Pagamento
                                    <select
                                        className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                        value={paymentMethod}
                                        onChange={(e) => setPaymentMethod(e.target.value)}
                                    >
                                        <option value="pix">PIX</option>
                                        <option value="cash">Dinheiro</option>
                                        <option value="card">Cartão</option>
                                    </select>
                                </label>
                                <button
                                    type="button"
                                    disabled={busy || session.items.length === 0}
                                    onClick={() => void closeSession()}
                                    className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                                >
                                    Fechar conta
                                </button>
                            </div>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}

export default function MesaPage() {
    return (
        <MarketPlanGate
            featureKey="table_service"
            title="Atendimento de mesa"
            description="Comandas e salão no plano Market."
        >
            <MesaFloor />
        </MarketPlanGate>
    );
}
