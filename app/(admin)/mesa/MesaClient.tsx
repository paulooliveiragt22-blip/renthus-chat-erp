"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus, Search, Trash2, UtensilsCrossed } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    MESA_PAYMENT_LABELS,
    MESA_PAYMENT_METHODS,
    partsRemainder,
    type MesaPaymentMethod,
} from "@/src/mesa/domain/paymentParts";

type FloorTable = {
    id: string;
    code: string;
    label: string | null;
    table_status: string;
    session_id: string | null;
    opened_at: string | null;
    session_total: number;
    items_count: number;
};

type SessionItem = {
    id: string;
    product_name: string;
    qty: number;
    unit_price: number;
    sigla_comercial: string | null;
    combo_label: string | null;
};

type SessionDetail = {
    id: string;
    status: string;
    total: number;
    table: { id: string; code: string; label: string | null };
    items: SessionItem[];
};

type CatalogHit = {
    id: string;
    kind: "embalagem" | "combo";
    product_id: string | null;
    name: string;
    sigla: string | null;
    volume: string | null;
    price: number;
    stock_qty: number | null;
    sell_zero: boolean;
};

type PartDraft = { key: string; amount: string; method: MesaPaymentMethod };

function money(n: number) {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function minutesOpen(iso: string | null) {
    if (!iso) return null;
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export default function MesaClient() {
    const [loading, setLoading] = useState(true);
    const [tables, setTables] = useState<FloorTable[]>([]);
    const [filter, setFilter] = useState<"all" | "free" | "open">("all");
    const [msg, setMsg] = useState<string | null>(null);
    const [session, setSession] = useState<SessionDetail | null>(null);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState("");
    const [hits, setHits] = useState<CatalogHit[]>([]);
    const [highlight, setHighlight] = useState(0);
    const [qty, setQty] = useState(1);
    const [flashId, setFlashId] = useState<string | null>(null);
    const [releaseOpen, setReleaseOpen] = useState(false);
    const [parts, setParts] = useState<PartDraft[]>([
        { key: "1", amount: "", method: "pix" },
    ]);
    const [transferOpen, setTransferOpen] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const [canManageTables, setCanManageTables] = useState(false);
    const [newCode, setNewCode] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);

    const loadFloor = useCallback(async () => {
        const res = await fetch("/api/admin/mesa/floor", { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setMsg(json.error || "Falha ao carregar mesas.");
            return;
        }
        setTables(Array.isArray(json.tables) ? json.tables : []);
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
    }, []);

    useEffect(() => {
        void (async () => {
            setLoading(true);
            const access = await fetch("/api/admin/mesa/access", { credentials: "include", cache: "no-store" });
            const accessJson = await access.json().catch(() => ({}));
            setCanManageTables(access.ok && (accessJson.role === "owner" || accessJson.role === "admin"));
            await loadFloor();
            setLoading(false);
        })();
        const timer = setInterval(() => void loadFloor(), 12000);
        return () => clearInterval(timer);
    }, [loadFloor]);

    useEffect(() => {
        const q = search.trim();
        const timer = setTimeout(() => {
            void (async () => {
                const path = q.length < 2
                    ? "/api/admin/mesa/catalog?limit=8"
                    : `/api/admin/mesa/catalog?q=${encodeURIComponent(q)}&limit=12`;
                const res = await fetch(path, { credentials: "include", cache: "no-store" });
                const json = await res.json().catch(() => ({}));
                const rows = Array.isArray(json.rows) ? (json.rows as CatalogHit[]) : [];
                setHits(rows);
                setHighlight(0);
            })();
        }, q.length < 2 ? 0 : 220);
        return () => clearTimeout(timer);
    }, [search]);

    const visible = useMemo(() => {
        return tables.filter((t) => {
            if (filter === "free") return !t.session_id && t.table_status !== "disabled";
            if (filter === "open") return Boolean(t.session_id);
            return true;
        });
    }, [tables, filter]);

    const freeTables = tables.filter((t) => !t.session_id && t.table_status === "free");

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
            setTimeout(() => searchRef.current?.focus(), 50);
        } finally {
            setBusy(false);
        }
    }

    async function addHit(hit: CatalogHit, launchQty: number) {
        if (!session) return;
        setBusy(true);
        setMsg(null);
        try {
            const res = await fetch(`/api/admin/mesa/sessions/${session.id}/items`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    produto_embalagem_id: hit.kind === "embalagem" ? hit.id : null,
                    combo_id: hit.kind === "combo" ? hit.id : null,
                    product_id: hit.product_id,
                    qty: launchQty,
                    idempotency_key: crypto.randomUUID(),
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Falha ao lançar.");
                return;
            }
            setSearch("");
            setQty(1);
            await loadSession(session.id);
            await loadFloor();
            setFlashId(hit.id);
            setTimeout(() => searchRef.current?.focus(), 30);
        } finally {
            setBusy(false);
        }
    }

    function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(hits.length - 1, 0)));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
        } else if (e.key === "Enter" && hits[highlight]) {
            e.preventDefault();
            const exact = hits.length === 1;
            void addHit(hits[highlight], exact ? 1 : qty);
        }
    }

    async function setItemQty(itemId: string, next: number) {
        if (!session) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/admin/mesa/sessions/${session.id}/items`, {
                method: "PATCH",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ itemId, qty: next }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Falha ao atualizar quantidade.");
                return;
            }
            await loadSession(session.id);
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    async function release() {
        if (!session) return;
        setBusy(true);
        setMsg(null);
        try {
            const res = await fetch(`/api/admin/mesa/sessions/${session.id}/release`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    parts: parts
                        .filter((p) => p.amount.trim() !== "")
                        .map((p) => ({ amount: Number(p.amount.replace(",", ".")), method: p.method })),
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Não liberou a mesa.");
                return;
            }
            setReleaseOpen(false);
            setSession(null);
            setMsg(`Mesa liberada. Conta da mesa ${json.table_code ?? ""} na fila do PDV.`);
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    async function cancelComanda() {
        if (!session) return;
        if (!window.confirm("Cancelar esta comanda? O estoque dos itens volta.")) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/admin/mesa/sessions/${session.id}/cancel`, {
                method: "POST",
                credentials: "include",
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Não cancelou.");
                return;
            }
            setSession(null);
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    async function transfer(tableId: string) {
        if (!session) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/admin/mesa/sessions/${session.id}/transfer`, {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tableId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Não transferiu.");
                return;
            }
            setTransferOpen(false);
            await loadFloor();
            await loadSession(session.id);
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

    async function setTableActive(table: FloorTable, active: boolean) {
        if (table.session_id || table.table_status === "occupied") return;
        setBusy(true);
        try {
            const res = await fetch("/api/admin/mesa/tables", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: table.id,
                    code: table.code,
                    label: table.label,
                    status: active ? "free" : "disabled",
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Não atualizou a mesa.");
                return;
            }
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    const due = Number(session?.total ?? 0);
    const remainder = partsRemainder(
        due,
        parts.map((p) => {
            const n = Number(p.amount.replace(",", "."));
            return p.amount.trim() === "" || !Number.isFinite(n) ? null : n;
        })
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
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                        <UtensilsCrossed className="h-5 w-5" />
                        Mesas
                    </h1>
                    <p className="mt-1 text-sm text-zinc-500">
                        {tables.filter((t) => t.session_id).length} em consumo · {tables.length} mesas
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {(["all", "free", "open"] as const).map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setFilter(key)}
                            className={`rounded-full px-3 py-1 text-xs font-medium ${
                                filter === key
                                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                        >
                            {key === "all" ? "Todas" : key === "free" ? "Livres" : "Em consumo"}
                        </button>
                    ))}
                    {canManageTables && (
                        <button
                            type="button"
                            onClick={() => setManageOpen(true)}
                            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
                        >
                            Gerir mesas
                        </button>
                    )}
                </div>
            </div>

            {msg && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                    {msg}
                </p>
            )}

            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
                <div className="grid grid-cols-2 content-start gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {visible.map((t) => {
                        const open = Boolean(t.session_id);
                        return (
                            <button
                                key={t.id}
                                type="button"
                                disabled={busy || t.table_status === "disabled"}
                                onClick={() => {
                                    if (open && t.session_id) void loadSession(t.session_id);
                                    else if (t.table_status === "free") void openTable(t.id);
                                }}
                                className={[
                                    "rounded-xl border p-4 text-left transition",
                                    open
                                        ? "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30"
                                        : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950",
                                    session?.table.id === t.id ? "ring-2 ring-orange-400" : "",
                                ].join(" ")}
                            >
                                <div className="truncate text-lg font-semibold">{t.label || `Mesa ${t.code}`}</div>
                                <div className="mt-1 text-xs uppercase tracking-wide text-zinc-500">
                                    {open ? "Em consumo" : t.table_status === "disabled" ? "Inativa" : "Livre"}
                                </div>
                                {open && (
                                    <div className="mt-2 text-sm font-medium">
                                        {money(Number(t.session_total || 0))}
                                        <span className="ml-1 text-xs font-normal text-zinc-500">
                                            · {t.items_count} itens
                                            {minutesOpen(t.opened_at) ? ` · ${minutesOpen(t.opened_at)}` : ""}
                                        </span>
                                    </div>
                                )}
                            </button>
                        );
                    })}
                </div>

                <aside className="flex min-h-[24rem] flex-col rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-8rem)]">
                    {!session ? (
                        <p className="p-4 text-sm text-zinc-500">
                            Toque numa mesa livre para abrir uma comanda nova, ou numa em consumo para lançar.
                        </p>
                    ) : (
                        <>
                            <div className="flex items-start justify-between gap-2 border-b border-zinc-100 p-4 dark:border-zinc-800">
                                <div className="min-w-0">
                                    <h2 className="truncate font-semibold">
                                        {session.table.label || `Mesa ${session.table.code}`}
                                    </h2>
                                    <p className="text-sm text-zinc-500">Total {money(due)}</p>
                                </div>
                                <div className="flex shrink-0 gap-2">
                                    <button type="button" className="text-xs text-zinc-500 underline" onClick={() => setTransferOpen(true)}>
                                        Trocar mesa
                                    </button>
                                    <button type="button" className="text-xs text-red-600 underline" onClick={() => void cancelComanda()}>
                                        Cancelar
                                    </button>
                                </div>
                            </div>

                            <div className="border-b border-zinc-100 p-4 dark:border-zinc-800">
                                <div className="relative">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                                    <input
                                        ref={searchRef}
                                        autoFocus
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        onKeyDown={onSearchKey}
                                        placeholder="Nome, código ou EAN — Enter lança"
                                        className="w-full rounded-lg border border-zinc-200 py-2 pl-9 pr-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                    />
                                </div>
                                {hits.length > 0 && (
                                    <ul className="mt-2 max-h-48 overflow-auto rounded-lg border border-zinc-200 text-sm dark:border-zinc-700">
                                        {hits.map((h, i) => (
                                            <li key={`${h.kind}-${h.id}`}>
                                                <button
                                                    type="button"
                                                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${
                                                        i === highlight ? "bg-orange-50 dark:bg-orange-950/40" : ""
                                                    }`}
                                                    onClick={() => void addHit(h, qty)}
                                                >
                                                    <span className="min-w-0">
                                                        <span className="block truncate font-medium">
                                                            {h.name}
                                                            {h.kind === "combo" ? " · Combo" : h.sigla ? ` · ${h.sigla}` : ""}
                                                        </span>
                                                        <span className="text-xs text-zinc-500">
                                                            {h.volume ? `${h.volume} · ` : ""}
                                                            {h.sell_zero ? "estoque livre" : `estoque ${h.stock_qty ?? 0}`}
                                                        </span>
                                                    </span>
                                                    <span className="shrink-0 text-zinc-500">{money(Number(h.price || 0))}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <div className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
                                    <span>Qtd no clique</span>
                                    <button type="button" className="rounded border px-2 py-1" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Diminuir quantidade do lançamento">
                                        <Minus className="h-3 w-3" />
                                    </button>
                                    <span className="w-6 text-center tabular-nums">{qty}</span>
                                    <button type="button" className="rounded border px-2 py-1" onClick={() => setQty((q) => q + 1)} aria-label="Aumentar quantidade do lançamento">
                                        <Plus className="h-3 w-3" />
                                    </button>
                                </div>
                            </div>

                            <ul className="min-h-0 flex-1 space-y-2 overflow-auto p-4 text-sm">
                                {session.items.map((it) => (
                                    <li key={it.id} className={`flex items-start justify-between gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800 ${flashId && it.product_name.includes(flashId) ? "" : ""}`}>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate font-medium">{it.combo_label || it.product_name}</div>
                                            <div className="text-xs text-zinc-500">
                                                {money(Number(it.unit_price))}
                                                {it.sigla_comercial ? ` · ${it.sigla_comercial}` : ""}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button type="button" disabled={busy} className="rounded border p-1" aria-label="Diminuir" onClick={() => void setItemQty(it.id, Number(it.qty) - 1)}>
                                                <Minus className="h-3.5 w-3.5" />
                                            </button>
                                            <span className="w-6 text-center tabular-nums">{it.qty}</span>
                                            <button type="button" disabled={busy} className="rounded border p-1" aria-label="Aumentar" onClick={() => void setItemQty(it.id, Number(it.qty) + 1)}>
                                                <Plus className="h-3.5 w-3.5" />
                                            </button>
                                            <button type="button" className="text-zinc-400 hover:text-red-500" aria-label="Remover" onClick={() => void setItemQty(it.id, 0)}>
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                                {session.items.length === 0 && <li className="text-zinc-500">Nenhum item ainda.</li>}
                            </ul>

                            <div className="border-t border-zinc-100 p-4 dark:border-zinc-800">
                                <button
                                    type="button"
                                    disabled={busy || session.items.length === 0}
                                    onClick={() => {
                                        setParts([{ key: crypto.randomUUID(), amount: "", method: "pix" }]);
                                        setReleaseOpen(true);
                                    }}
                                    className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white disabled:opacity-40"
                                >
                                    Liberar mesa · {money(due)}
                                </button>
                            </div>
                        </>
                    )}
                </aside>
            </div>

            <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Liberar mesa</DialogTitle>
                        <DialogDescription>
                            Informe o valor e a forma de cada pagamento. A mesa fica livre e a conta vai para a fila do PDV. O caixa lança o financeiro.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {parts.map((part, index) => (
                            <div key={part.key} className="grid grid-cols-[1fr_9rem_auto] gap-2">
                                <input
                                    inputMode="decimal"
                                    placeholder="Valor"
                                    value={part.amount}
                                    onChange={(e) =>
                                        setParts((rows) => rows.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))
                                    }
                                    className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                                />
                                <Select
                                    value={part.method}
                                    onValueChange={(method) =>
                                        setParts((rows) =>
                                            rows.map((r, i) => (i === index ? { ...r, method: method as MesaPaymentMethod } : r))
                                        )
                                    }
                                >
                                    <SelectTrigger aria-label="Forma de pagamento">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {MESA_PAYMENT_METHODS.map((method) => (
                                            <SelectItem key={method} value={method}>
                                                {MESA_PAYMENT_LABELS[method]}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <button
                                    type="button"
                                    className="text-xs text-zinc-500"
                                    onClick={() => setParts((rows) => rows.filter((_, i) => i !== index))}
                                    disabled={parts.length === 1}
                                >
                                    Tirar
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            className="text-sm text-zinc-600 underline"
                            onClick={() =>
                                setParts((rows) => [...rows, { key: crypto.randomUUID(), amount: "", method: "pix" }])
                            }
                        >
                            Acrescentar parte
                        </button>
                        <p className="text-sm">
                            Conta {money(due)} · restante {money(remainder)}
                        </p>
                    </div>
                    <DialogFooter>
                        <button
                            type="button"
                            disabled={busy || remainder !== 0}
                            onClick={() => void release()}
                            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                        >
                            Liberar mesa
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Trocar mesa</DialogTitle>
                        <DialogDescription>A comanda inteira vai para a mesa livre escolhida.</DialogDescription>
                    </DialogHeader>
                    <ul className="max-h-64 space-y-2 overflow-auto">
                        {freeTables.map((t) => (
                            <li key={t.id}>
                                <button
                                    type="button"
                                    className="w-full rounded-lg border px-3 py-2 text-left text-sm"
                                    onClick={() => void transfer(t.id)}
                                >
                                    {t.label || `Mesa ${t.code}`}
                                </button>
                            </li>
                        ))}
                        {freeTables.length === 0 && <li className="text-sm text-zinc-500">Nenhuma mesa livre.</li>}
                    </ul>
                </DialogContent>
            </Dialog>

            <Dialog open={manageOpen} onOpenChange={setManageOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Gerir mesas</DialogTitle>
                        <DialogDescription>Mesa em consumo não é desativada.</DialogDescription>
                    </DialogHeader>
                    <div className="flex gap-2">
                        <input
                            value={newCode}
                            onChange={(e) => setNewCode(e.target.value)}
                            placeholder="Número"
                            className="w-28 rounded-lg border px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <button type="button" onClick={() => void createTable()} className="rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
                            Criar
                        </button>
                    </div>
                    <ul className="max-h-64 space-y-2 overflow-auto">
                        {tables.map((t) => {
                            const locked = Boolean(t.session_id) || t.table_status === "occupied";
                            const inactive = t.table_status === "disabled";
                            return (
                                <li key={t.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm dark:border-zinc-700">
                                    <span className="truncate">{t.label || `Mesa ${t.code}`}</span>
                                    <button
                                        type="button"
                                        disabled={busy || locked}
                                        className="shrink-0 rounded border px-2 py-1 text-xs disabled:opacity-40"
                                        onClick={() => void setTableActive(t, inactive)}
                                    >
                                        {locked ? "Em consumo" : inactive ? "Reativar" : "Desativar"}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </DialogContent>
            </Dialog>
        </div>
    );
}
