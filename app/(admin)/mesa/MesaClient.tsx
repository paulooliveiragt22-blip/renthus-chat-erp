"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus, Search, ShoppingCart, Trash2, UtensilsCrossed } from "lucide-react";
import Modal from "@/lib/orders/Modal";
import { brlToNumber, formatBRL } from "@/lib/orders/helpers";
import { cn } from "@/lib/utils";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
    MESA_PAYMENT_LABELS,
    MESA_PAYMENT_METHODS,
    splitPreview,
    type MesaPaymentMethod,
    type PayerBasis,
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
    previous_table_codes?: string[];
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

type PayerDraft = {
    key: string;
    amount: string;
    method: MesaPaymentMethod;
    basis: PayerBasis;
    qty: Record<string, number>;
};
type SplitMode = "single" | "split";

const inputCls = cn(
    "w-full rounded-lg border border-border bg-background-card px-3 py-2 text-sm text-foreground",
    "placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-transparent"
);

const sectionCls = "rounded-xl border border-border bg-background-card p-4";
const labelCls = "mb-3 text-xs font-semibold uppercase tracking-wide text-foreground-muted";

function brl(n: number) {
    return `R$ ${formatBRL(n)}`;
}

function minutesOpen(iso: string | null) {
    if (!iso) return null;
    const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

function tableTitle(table: { label: string | null; code: string } | null | undefined) {
    if (!table) return "Mesa";
    return table.label || `Mesa ${table.code}`;
}

export default function MesaClient() {
    const [loading, setLoading] = useState(true);
    const [tables, setTables] = useState<FloorTable[]>([]);
    const [filter, setFilter] = useState<"all" | "free" | "open">("all");
    const [notice, setNotice] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);
    const [session, setSession] = useState<SessionDetail | null>(null);
    const [comandaOpen, setComandaOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [search, setSearch] = useState("");
    const [hits, setHits] = useState<CatalogHit[]>([]);
    const [searching, setSearching] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const [draftQty, setDraftQty] = useState<Record<string, number>>({});
    const [panel, setPanel] = useState<"comanda" | "release" | "transfer" | "cancel">("comanda");
    const [splitMode, setSplitMode] = useState<SplitMode>("single");
    const [payers, setPayers] = useState<PayerDraft[]>([
        { key: "1", amount: "", method: "pix", basis: "value", qty: {} },
    ]);
    const [manageOpen, setManageOpen] = useState(false);
    const [canManageTables, setCanManageTables] = useState(false);
    const [newCode, setNewCode] = useState("");
    const searchRef = useRef<HTMLInputElement>(null);

    const loadFloor = useCallback(async () => {
        const res = await fetch("/api/admin/mesa/floor", { credentials: "include", cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            setNotice(json.error || "Falha ao carregar mesas.");
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
            setSession(null);
            return false;
        }
        setSession(json.session as SessionDetail);
        return true;
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
        if (!comandaOpen) return;
        const q = search.trim();
        if (q.length < 2) {
            setHits([]);
            setSearching(false);
            return;
        }
        const timer = setTimeout(() => {
            void (async () => {
                setSearching(true);
                try {
                    const res = await fetch(`/api/admin/mesa/catalog?q=${encodeURIComponent(q)}&limit=12`, {
                        credentials: "include",
                        cache: "no-store",
                    });
                    const json = await res.json().catch(() => ({}));
                    const rows = Array.isArray(json.rows) ? (json.rows as CatalogHit[]) : [];
                    setHits(rows);
                    setHighlight(0);
                } finally {
                    setSearching(false);
                }
            })();
        }, 220);
        return () => clearTimeout(timer);
    }, [search, comandaOpen]);

    useEffect(() => {
        if (!comandaOpen || !session) return;
        const timer = setTimeout(() => searchRef.current?.focus(), 40);
        return () => clearTimeout(timer);
    }, [comandaOpen, session?.id]);

    const visible = useMemo(() => {
        return tables.filter((t) => {
            if (filter === "free") return !t.session_id && t.table_status !== "disabled";
            if (filter === "open") return Boolean(t.session_id);
            return true;
        });
    }, [tables, filter]);

    const freeTables = tables.filter((t) => !t.session_id && t.table_status === "free" && t.id !== session?.table.id);
    const openedAt = tables.find((t) => t.session_id === session?.id)?.opened_at ?? null;

    function closeComanda() {
        setComandaOpen(false);
        setSession(null);
        setSearch("");
        setHits([]);
        setMsg(null);
        setPanel("comanda");
        setSplitMode("single");
        setPayers([]);
        setDraftQty({});
    }

    async function openTable(tableId: string) {
        setComandaOpen(true);
        setSession(null);
        setMsg(null);
        setBusy(true);
        try {
            const res = await fetch("/api/admin/mesa/sessions", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tableId }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setNotice(json.error || "Não abriu a mesa.");
                setComandaOpen(false);
                return;
            }
            const sid = json.session?.id as string;
            await loadFloor();
            if (sid) await loadSession(sid);
        } finally {
            setBusy(false);
        }
    }

    async function selectOpen(sessionId: string) {
        setComandaOpen(true);
        setMsg(null);
        setBusy(true);
        try {
            const ok = await loadSession(sessionId);
            if (!ok) setComandaOpen(false);
        } finally {
            setBusy(false);
        }
    }

    function qtyOf(id: string) {
        return draftQty[id] ?? 1;
    }

    async function addHit(hit: CatalogHit, launchQty: number) {
        if (!session || launchQty < 1) return;
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
            setDraftQty((prev) => ({ ...prev, [hit.id]: 1 }));
            await loadSession(session.id);
            await loadFloor();
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
            const hit = hits[highlight];
            const exact = hits.length === 1;
            void addHit(hit, exact ? 1 : qtyOf(hit.id));
        }
    }

    async function setItemQty(itemId: string, next: number) {
        if (!session) return;
        setBusy(true);
        setMsg(null);
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
                    parts: payers.map((payer) =>
                        payer.basis === "item"
                            ? {
                                method: payer.method,
                                lines: (session.items ?? [])
                                    .map((it) => ({ item_id: it.id, qty: payer.qty[it.id] ?? 0 }))
                                    .filter((line) => line.qty > 0),
                            }
                            : { amount: brlToNumber(payer.amount), method: payer.method },
                    ),
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Não finalizou a mesa.");
                return;
            }
            const code = json.table_code ?? session.table.code;
            closeComanda();
            setNotice(`Mesa ${code} finalizada. A conta está na fila do PDV.`);
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    async function cancelComanda() {
        if (!session) return;
        setBusy(true);
        setMsg(null);
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
            closeComanda();
            setNotice("Comanda cancelada. O estoque dos itens voltou.");
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    async function transfer(tableId: string) {
        if (!session) return;
        setBusy(true);
        setMsg(null);
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
            const from = tableTitle(session.table);
            setPanel("comanda");
            await loadFloor();
            await loadSession(session.id);
            setNotice(`${from} ficou no histórico da comanda.`);
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
                setNotice(json.error || "Não criou a mesa.");
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
                setNotice(json.error || "Não atualizou a mesa.");
                return;
            }
            await loadFloor();
        } finally {
            setBusy(false);
        }
    }

    const due = Number(session?.total ?? 0);
    const splitLines = (session?.items ?? []).map((it) => ({
        id: it.id,
        qty: Number(it.qty),
        unitPrice: Number(it.unit_price),
    }));
    const itemsSubtotal = Math.round(splitLines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0) * 100) / 100;
    const serviceFee = Math.round((due - itemsSubtotal) * 100) / 100;
    const preview = splitPreview(
        splitLines,
        payers.map((payer) => ({
            basis: payer.basis,
            amount: payer.amount.trim() === "" ? null : brlToNumber(payer.amount),
            qty: payer.qty,
        })),
        due,
        serviceFee,
    );
    const remainder = preview.remainder;
    const canFinish = payers.length > 0
        && preview.qtyOk
        && remainder === 0
        && preview.amounts.every((amount) => amount != null && amount > 0);

    function pendingQty(itemId: string, exceptKey?: string) {
        const line = splitLines.find((entry) => entry.id === itemId);
        const used = payers
            .filter((payer) => payer.basis === "item" && payer.key !== exceptKey)
            .reduce((sum, payer) => sum + (payer.qty[itemId] ?? 0), 0);
        return Math.max(0, (line?.qty ?? 0) - used);
    }

    function openFinalizar() {
        setSplitMode("single");
        setPayers([{ key: crypto.randomUUID(), amount: formatBRL(due), method: "pix", basis: "value", qty: {} }]);
        setMsg(null);
        setPanel("release");
    }

    function addPayer() {
        setPayers((rows) => [
            ...rows,
            {
                key: crypto.randomUUID(),
                amount: remainder > 0 ? formatBRL(remainder) : "",
                method: "pix",
                basis: "value",
                qty: {},
            },
        ]);
    }

    function setPayerBasis(key: string, basis: PayerBasis) {
        setPayers((rows) => rows.map((row) => {
            if (row.key !== key || row.basis === basis) return row;
            if (basis === "item") {
                const qty: Record<string, number> = {};
                for (const line of splitLines) qty[line.id] = pendingQty(line.id, key);
                return { ...row, basis, qty };
            }
            const others = preview.amounts.reduce((sum, amount, index) => (
                payers[index]?.key === key || amount == null ? sum : sum + amount
            ), 0);
            const pending = Math.round((due - others) * 100) / 100;
            return { ...row, basis, amount: pending > 0 ? formatBRL(pending) : "" };
        }));
    }

    const modalTitle = !session
        ? "Mesa"
        : panel === "release"
            ? `Finalizar ${tableTitle(session.table)}`
            : panel === "transfer"
                ? "Trocar mesa"
                : panel === "cancel"
                    ? "Cancelar comanda"
                    : `${tableTitle(session.table)} · Em consumo`;

    if (loading) {
        return (
            <div className="flex items-center gap-2 p-8 text-sm text-foreground-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando salão…
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
                        <UtensilsCrossed className="h-5 w-5" />
                        Mesas
                    </h1>
                    <p className="mt-1 text-sm text-foreground-muted">
                        {tables.filter((t) => t.session_id).length} em consumo · {tables.length} mesas
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {(["all", "free", "open"] as const).map((key) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setFilter(key)}
                            className={cn(
                                "rounded-full px-3 py-1 text-xs font-medium",
                                filter === key
                                    ? "bg-primary text-white"
                                    : "border border-border bg-background-card text-foreground-muted"
                            )}
                        >
                            {key === "all" ? "Todas" : key === "free" ? "Livres" : "Em consumo"}
                        </button>
                    ))}
                    {canManageTables && (
                        <button
                            type="button"
                            onClick={() => setManageOpen(true)}
                            className="rounded-xl border border-border px-3 py-1.5 text-sm text-foreground"
                        >
                            Gerir mesas
                        </button>
                    )}
                </div>
            </div>

            {notice && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-100">
                    {notice}
                </p>
            )}

            <div className="grid grid-cols-2 content-start gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {visible.map((t) => {
                    const open = Boolean(t.session_id);
                    const inactive = t.table_status === "disabled";
                    return (
                        <button
                            key={t.id}
                            type="button"
                            disabled={busy || inactive}
                            onClick={() => {
                                if (open && t.session_id) void selectOpen(t.session_id);
                                else if (t.table_status === "free") void openTable(t.id);
                            }}
                            className={cn(
                                "rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                                open
                                    ? "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30"
                                    : "border-border bg-background-card hover:border-zinc-400",
                                inactive && "cursor-not-allowed opacity-50"
                            )}
                        >
                            <div className="truncate text-lg font-semibold">{tableTitle(t)}</div>
                            <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
                                {open ? "Em consumo" : inactive ? "Inativa" : "Livre"}
                            </div>
                            {open && (
                                <div className="mt-2 text-sm font-medium">
                                    {brl(Number(t.session_total || 0))}
                                    <span className="ml-1 text-xs font-normal text-foreground-muted">
                                        · {t.items_count} itens
                                        {minutesOpen(t.opened_at) ? ` · ${minutesOpen(t.opened_at)}` : ""}
                                    </span>
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>

            <Modal
                title={modalTitle}
                open={comandaOpen}
                onClose={closeComanda}
                footer={
                    !session ? undefined : panel === "release" ? (
                        <div className="flex flex-wrap items-center gap-3">
                            <Button type="button" disabled={busy || !canFinish} onClick={() => void release()}>
                                {busy ? "Finalizando..." : "Finalizar"}
                            </Button>
                            <Button type="button" variant="outline" disabled={busy} onClick={() => setPanel("comanda")}>
                                Voltar
                            </Button>
                            <p className="text-[11px] text-foreground-muted">
                                Conta {brl(due)} · restante {brl(remainder)}
                                . A mesa fica livre e a conta vai para a fila do PDV.
                            </p>
                            {msg && <span className="ml-auto text-xs font-medium text-rose-600">{msg}</span>}
                        </div>
                    ) : panel === "cancel" ? (
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => void cancelComanda()}
                                className="rounded-xl bg-rose-600 px-5 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                            >
                                {busy ? "Cancelando..." : "Cancelar comanda"}
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setPanel("comanda")}
                                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800"
                            >
                                Voltar
                            </button>
                            {msg && <span className="ml-auto text-xs font-medium text-rose-600">{msg}</span>}
                        </div>
                    ) : panel === "transfer" ? (
                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => setPanel("comanda")}
                                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-zinc-50 dark:hover:bg-zinc-800"
                            >
                                Voltar
                            </button>
                            {msg && <span className="text-xs font-medium text-rose-600">{msg}</span>}
                        </div>
                    ) : (
                        <div className="flex flex-wrap items-center gap-3">
                            <Button type="button" variant="outline" disabled={busy} onClick={closeComanda}>
                                OK
                            </Button>
                            <Button type="button" disabled={busy || session.items.length === 0} onClick={openFinalizar}>
                                Finalizar · {brl(due)}
                            </Button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    setMsg(null);
                                    setPanel("transfer");
                                }}
                                className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:hover:bg-zinc-800"
                            >
                                Trocar mesa
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                    setMsg(null);
                                    setPanel("cancel");
                                }}
                                className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                            >
                                Cancelar comanda
                            </button>
                            {msg && <span className="ml-auto text-xs font-medium text-rose-600">{msg}</span>}
                        </div>
                    )
                }
            >
                {busy && !session ? (
                    <p className="py-8 text-center text-sm text-foreground-muted">Carregando...</p>
                ) : !session ? (
                    <p className="py-8 text-center text-sm text-foreground-muted">Nenhuma mesa selecionada.</p>
                ) : panel === "release" ? (
                    <div className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                size="sm"
                                variant={splitMode === "single" ? "default" : "outline"}
                                aria-pressed={splitMode === "single"}
                                onClick={openFinalizar}
                            >
                                Conta inteira
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant={splitMode === "split" ? "default" : "outline"}
                                aria-pressed={splitMode === "split"}
                                onClick={() => {
                                    setSplitMode("split");
                                    setPayers([]);
                                }}
                            >
                                Dividir conta
                            </Button>
                        </div>

                        {splitMode === "split" && payers.length === 0 && (
                            <p className="text-sm text-foreground-muted">A divisão começa limpa. Cada pagador entra por valor, com o que ainda falta, e pode marcar item.</p>
                        )}
                        {splitMode === "single" && (
                            <p className="text-xs text-foreground-muted">Um pagamento com o valor da conta. Divida só se mais de uma pessoa for pagar.</p>
                        )}
                        <div className="space-y-3">
                            {payers.map((payer, index) => (
                                <div key={payer.key} className={sectionCls}>
                                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-sm font-semibold">Pagador {index + 1}</p>
                                        {payer.basis === "item" && (
                                            <p className="text-sm font-semibold text-primary">{brl(preview.amounts[index] ?? 0)}</p>
                                        )}
                                    </div>
                                    <div className="mb-3 flex flex-wrap items-center gap-2">
                                        {splitMode === "split" && (
                                            <ToggleGroup
                                                type="single"
                                                variant="outline"
                                                size="sm"
                                                value={payer.basis}
                                                onValueChange={(value) => {
                                                    if (value === "value" || value === "item") setPayerBasis(payer.key, value);
                                                }}
                                                aria-label={`Como o pagador ${index + 1} divide`}
                                            >
                                                <ToggleGroupItem value="value">Valor</ToggleGroupItem>
                                                <ToggleGroupItem value="item">Item</ToggleGroupItem>
                                            </ToggleGroup>
                                        )}
                                        <Select
                                            value={payer.method}
                                            onValueChange={(method) =>
                                                setPayers((rows) =>
                                                    rows.map((row) =>
                                                        row.key === payer.key ? { ...row, method: method as MesaPaymentMethod } : row
                                                    )
                                                )
                                            }
                                        >
                                            <SelectTrigger aria-label={`Forma do pagador ${index + 1}`} className="w-full sm:w-44">
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
                                        {splitMode === "split" && (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setPayers((rows) => rows.filter((row) => row.key !== payer.key))}
                                            >
                                                Remover
                                            </Button>
                                        )}
                                    </div>
                                    {payer.basis === "item" ? (
                                        <ul className="grid gap-2">
                                            {session.items.map((it) => {
                                                const marked = payer.qty[it.id] ?? 0;
                                                const cap = pendingQty(it.id, payer.key);
                                                return (
                                                    <li key={it.id} className="flex items-center justify-between gap-3 text-sm">
                                                        <span className="min-w-0 truncate">
                                                            {it.combo_label || it.product_name}
                                                            <span className="text-foreground-muted"> · {it.qty} na comanda</span>
                                                        </span>
                                                        <div className="inline-flex shrink-0 items-center rounded-lg border border-border">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                aria-label={`Diminuir ${it.product_name}`}
                                                                disabled={marked <= 0}
                                                                onClick={() =>
                                                                    setPayers((rows) =>
                                                                        rows.map((row) =>
                                                                            row.key === payer.key
                                                                                ? { ...row, qty: { ...row.qty, [it.id]: Math.max(0, marked - 1) } }
                                                                                : row
                                                                        )
                                                                    )
                                                                }
                                                            >
                                                                <Minus className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <span className="min-w-[1.75rem] text-center text-xs font-bold tabular-nums">{marked}</span>
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                aria-label={`Aumentar ${it.product_name}`}
                                                                disabled={marked >= cap}
                                                                onClick={() =>
                                                                    setPayers((rows) =>
                                                                        rows.map((row) =>
                                                                            row.key === payer.key
                                                                                ? { ...row, qty: { ...row.qty, [it.id]: Math.min(cap, marked + 1) } }
                                                                                : row
                                                                        )
                                                                    )
                                                                }
                                                            >
                                                                <Plus className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    ) : (
                                        <input
                                            inputMode="decimal"
                                            placeholder="Valor"
                                            aria-label={`Valor do pagador ${index + 1}`}
                                            value={payer.amount}
                                            onChange={(e) =>
                                                setPayers((rows) => rows.map((row) => (row.key === payer.key ? { ...row, amount: e.target.value } : row)))
                                            }
                                            className={inputCls}
                                        />
                                    )}
                                </div>
                            ))}
                            {payers.length > 0 && !canFinish && (
                                <p className="text-xs font-medium text-rose-600">
                                    {!preview.qtyOk
                                        ? "A quantidade marcada não fecha. Sem pagador por valor, tem de bater com a linha. Com pagador por valor, não pode passar da linha."
                                        : remainder > 0
                                            ? `Ainda falta ${brl(remainder)} para fechar a conta.`
                                            : remainder < 0
                                                ? `A soma passou ${brl(Math.abs(remainder))} da conta.`
                                                : "Cada pagador precisa de um valor."}
                                </p>
                            )}
                            {splitMode === "split" && (
                                <Button type="button" variant="outline" onClick={addPayer}>
                                    <Plus className="h-4 w-4" />
                                    Adicionar pagador
                                </Button>
                            )}
                        </div>
                    </div>
                ) : panel === "transfer" ? (
                    <div>
                        <p className="mb-3 text-xs text-foreground-muted">A comanda inteira vai para a mesa livre escolhida.</p>
                        <ul className="grid gap-2">
                            {freeTables.map((t) => (
                                <li key={t.id}>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        className="w-full rounded-xl border border-border px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                                        onClick={() => void transfer(t.id)}
                                    >
                                        {tableTitle(t)}
                                    </button>
                                </li>
                            ))}
                            {freeTables.length === 0 && <li className="text-sm text-foreground-muted">Nenhuma mesa livre.</li>}
                        </ul>
                    </div>
                ) : panel === "cancel" ? (
                    <p className="text-sm text-foreground">
                        A comanda de {tableTitle(session.table)} será cancelada e o estoque dos itens volta. Isso não reabre depois.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 gap-3">
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
                            <span>Aberta {minutesOpen(openedAt) ?? "agora"}</span>
                            <span>{session.items.length} itens</span>
                            <span className="font-semibold text-foreground">Total {brl(due)}</span>
                            {(session.previous_table_codes ?? []).length > 0 && (
                                <span>
                                    Antes {(session.previous_table_codes ?? []).map((code) => `Mesa ${code}`).join(", ")}
                                </span>
                            )}
                        </div>

                        <div className={sectionCls}>
                            <div className={labelCls}>Adicionar itens</div>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" aria-hidden />
                                <input
                                    ref={searchRef}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    onKeyDown={onSearchKey}
                                    placeholder="Nome, código ou EAN — Enter lança"
                                    className={cn(inputCls, "pl-9")}
                                    aria-label="Buscar produtos"
                                />
                            </div>
                            <div className="mt-3">
                                {search.trim().length < 2 ? (
                                    <p className="text-xs text-foreground-muted">Digite o nome, código ou EAN para lançar.</p>
                                ) : searching ? (
                                    <p className="text-xs text-foreground-muted">Buscando...</p>
                                ) : hits.length === 0 ? (
                                    <p className="text-xs text-foreground-muted">Nenhum produto encontrado.</p>
                                ) : (
                                    <div className="grid gap-2">
                                        {hits.map((h, i) => {
                                            const qtd = qtyOf(h.id);
                                            return (
                                                <div
                                                    key={`${h.kind}-${h.id}`}
                                                    className={cn(
                                                        "flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/50",
                                                        i === highlight && "ring-2 ring-violet-400"
                                                    )}
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <div className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                                                            {h.name}
                                                        </div>
                                                        <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                                                            {h.kind === "combo" ? "Combo" : h.sigla || "UN"}
                                                            {h.volume ? ` · ${h.volume}` : ""}
                                                            {" · "}
                                                            {h.sell_zero ? "estoque livre" : `estoque ${h.stock_qty ?? 0}`}
                                                        </div>
                                                        <div className="mt-1 text-[11px] text-zinc-700 dark:text-zinc-300">
                                                            <span className="font-bold">{brl(Number(h.price || 0))}</span>
                                                        </div>
                                                    </div>
                                                    <div className="flex shrink-0 items-end gap-2">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-[10px] font-semibold text-zinc-500">Qtd</span>
                                                            <div className="inline-flex items-center rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
                                                                <button
                                                                    type="button"
                                                                    aria-label={`Diminuir ${h.name}`}
                                                                    disabled={qtd <= 1}
                                                                    onClick={() => setDraftQty((prev) => ({ ...prev, [h.id]: Math.max(1, qtd - 1) }))}
                                                                    className="flex h-8 w-8 items-center justify-center rounded-l-lg text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                                                >
                                                                    <Minus className="h-3.5 w-3.5" />
                                                                </button>
                                                                <span className="min-w-[1.75rem] text-center text-xs font-bold tabular-nums">{qtd}</span>
                                                                <button
                                                                    type="button"
                                                                    aria-label={`Aumentar ${h.name}`}
                                                                    onClick={() => setDraftQty((prev) => ({ ...prev, [h.id]: qtd + 1 }))}
                                                                    className="flex h-8 w-8 items-center justify-center rounded-r-lg text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700"
                                                                >
                                                                    <Plus className="h-3.5 w-3.5" />
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={busy}
                                                            onClick={() => void addHit(h, qtd)}
                                                            className="flex h-8 items-center gap-1 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
                                                        >
                                                            <ShoppingCart className="h-3 w-3" />
                                                            Add
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className={sectionCls}>
                            <div className={labelCls}>Itens da comanda</div>
                            {session.items.length === 0 ? (
                                <p className="text-xs text-foreground-muted">Nenhum item adicionado.</p>
                            ) : (
                                <div className="grid gap-2">
                                    {session.items.map((it) => (
                                        <div
                                            key={it.id}
                                            className="flex items-center justify-between gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/50"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="truncate text-xs font-bold uppercase text-zinc-900 dark:text-zinc-50">
                                                        {it.combo_label || it.product_name}
                                                    </span>
                                                    <span className="shrink-0 rounded-full bg-zinc-200 px-1.5 py-px text-[9px] font-bold text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                                                        {it.sigla_comercial || "UN"}
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-[11px] text-zinc-700 dark:text-zinc-300">
                                                    <span className="font-bold">{it.qty}</span>
                                                    {" × "}
                                                    <span className="font-bold">{brl(Number(it.unit_price))}</span>
                                                    {" = "}
                                                    <span className="font-bold text-violet-700 dark:text-violet-400">
                                                        {brl(Number(it.qty) * Number(it.unit_price))}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1">
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    aria-label="Diminuir"
                                                    onClick={() => void setItemQty(it.id, Number(it.qty) - 1)}
                                                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                                >
                                                    <Minus className="h-3 w-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    aria-label="Aumentar"
                                                    onClick={() => void setItemQty(it.id, Number(it.qty) + 1)}
                                                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                                >
                                                    <Plus className="h-3 w-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busy}
                                                    aria-label="Remover"
                                                    onClick={() => void setItemQty(it.id, 0)}
                                                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-rose-500 hover:bg-rose-100 disabled:opacity-40 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-400"
                                                >
                                                    <Trash2 className="h-3 w-3" />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
                                <span className="font-semibold text-foreground">Total</span>
                                <span className="font-bold text-primary">{brl(due)}</span>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>

            <Modal title="Gerir mesas" open={manageOpen} onClose={() => setManageOpen(false)}>
                <p className="mb-3 text-xs text-foreground-muted">Mesa em consumo não é desativada.</p>
                <div className="mb-4 flex gap-2">
                    <input
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value)}
                        placeholder="Número"
                        aria-label="Número da mesa"
                        className={cn(inputCls, "w-28")}
                    />
                    <button
                        type="button"
                        onClick={() => void createTable()}
                        className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
                    >
                        Criar
                    </button>
                </div>
                <ul className="grid max-h-64 gap-2 overflow-auto">
                    {tables.map((t) => {
                        const locked = Boolean(t.session_id) || t.table_status === "occupied";
                        const inactive = t.table_status === "disabled";
                        return (
                            <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                                <span className="truncate">{tableTitle(t)}</span>
                                <button
                                    type="button"
                                    disabled={busy || locked}
                                    className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs disabled:opacity-40"
                                    onClick={() => void setTableActive(t, inactive)}
                                >
                                    {locked ? "Em consumo" : inactive ? "Reativar" : "Desativar"}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </Modal>
        </div>
    );
}
