"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PromoBannerFace } from "@/components/public-menu/PromoBannerFace";
import { buildPackDisplayName, formatMenuPackLabel } from "@/lib/products/packDisplayName";

type EmbHit = {
    id: string;
    label: string;
    price: number;
    details: string | null;
    sigla: string | null;
    fator: number;
};
type ComboItem = {
    produto_embalagem_id: string;
    quantidade: number;
    nome?: string;
    preco_venda_atual?: number;
    preco_catalogo_snapshot?: number | null;
    preco_alocado?: number | null;
    divergiu?: boolean;
    sigla?: string | null;
};
type ComboRow = {
    id: string;
    nome: string;
    descricao: string | null;
    is_active: boolean;
    show_on_menu: boolean;
    preco: number | null;
    preco_efetivo: number | null;
    modo_preco: string | null;
    image_path?: string | null;
    itens: ComboItem[];
};
type PromoAlvo = {
    combo_id: string | null;
    produto_embalagem_id: string | null;
    preco_promocional: number;
    nome: string | null;
};
type PromoRow = {
    id: string;
    nome: string;
    starts_at: string;
    ends_at: string;
    paused: boolean;
    status: string;
    image_path?: string | null;
    alvos: PromoAlvo[];
};

function brl(n: number): string {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const fieldLabel = "mb-1 block text-xs font-bold text-zinc-700 dark:text-zinc-300";
const fieldInput =
    "w-full rounded-lg border border-border bg-zinc-50 px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 dark:bg-zinc-800 dark:[color-scheme:dark] disabled:opacity-50";
const choiceLabel = "flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300";
const hitBtn =
    "w-full rounded-md px-2 py-1 text-left text-sm text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800";
const listCard =
    "divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900";

type DraftLine = EmbHit & { quantidade: number; precoUnitario: string };

function parseBrl(masked: string): number {
    return Number(masked.replace(/\D/g, "") || "0") / 100;
}

function formatBrlInput(n: number): string {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function maskBrl(raw: string): string {
    return formatBrlInput(parseBrl(raw));
}

function sumLines(lines: DraftLine[]): number {
    return Math.round(lines.reduce((s, l) => s + parseBrl(l.precoUnitario) * l.quantidade, 0) * 100) / 100;
}

/** Prévia do rateio. O valor gravado sai de rpc_precificar_combo. */
function previewRateio(parts: number[], alvo: number): number[] {
    const cents = parts.map((p) => Math.round(p * 100));
    const target = Math.round(alvo * 100);
    const sum = cents.reduce((a, b) => a + b, 0);
    if (sum <= 0 || target <= 0) return parts.map(() => 0);
    const alloc = cents.map((c) => Math.floor((target * c) / sum));
    let remain = target - alloc.reduce((a, b) => a + b, 0);
    let maxIdx = 0;
    for (let i = 1; i < cents.length; i += 1) {
        if (cents[i] > cents[maxIdx]) maxIdx = i;
    }
    alloc[maxIdx] += remain;
    return alloc.map((c) => c / 100);
}

function MoneyField(props: {
    label: string;
    value: string;
    onChange: (masked: string) => void;
    disabled?: boolean;
}) {
    return (
        <label className={fieldLabel}>
            {props.label}
            <span className="mt-1 flex items-center rounded-lg border border-border bg-zinc-50 dark:bg-zinc-800">
                <span className="pl-3 text-sm text-zinc-500 dark:text-zinc-400">R$</span>
                <input
                    className="w-full bg-transparent px-2 py-2 text-sm text-foreground outline-none disabled:opacity-50"
                    inputMode="numeric"
                    value={props.value}
                    disabled={props.disabled}
                    onChange={(e) => props.onChange(maskBrl(e.target.value))}
                />
            </span>
        </label>
    );
}

function cuiabaIso(local: string): string {
    return new Date(`${local}:00-04:00`).toISOString();
}

function toDatetimeLocal(iso: string): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Cuiaba",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export default function PromocoesClient() {
    const [combos, setCombos] = useState<ComboRow[]>([]);
    const [promos, setPromos] = useState<PromoRow[]>([]);
    const [msg, setMsg] = useState<string | null>(null);
    const [openCombo, setOpenCombo] = useState(false);
    const [openPromo, setOpenPromo] = useState(false);
    const [editCombo, setEditCombo] = useState<ComboRow | null>(null);
    const [editPromo, setEditPromo] = useState<PromoRow | null>(null);
    const [recalcId, setRecalcId] = useState<string | null>(null);

    async function recalcular(c: ComboRow) {
        if (c.preco == null) {
            setMsg("Defina o preço do combo antes de recalcular.");
            return;
        }
        setRecalcId(c.id);
        setMsg(null);
        try {
            const res = await fetch("/api/admin/combos/preco", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    combo_id: c.id,
                    modo: "pro_rata",
                    preco: Number(c.preco),
                    is_active: c.is_active,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setMsg(json.error || "Não recalculou o pro rata.");
                return;
            }
            setMsg("Pro rata recalculado com o preço atual do catálogo.");
            await load();
        } finally {
            setRecalcId(null);
        }
    }

    const load = useCallback(async () => {
        const [cRes, pRes] = await Promise.all([
            fetch("/api/admin/combos", { credentials: "include" }),
            fetch("/api/admin/promocoes", { credentials: "include" }),
        ]);
        const cJson = await cRes.json().catch(() => ({}));
        const pJson = await pRes.json().catch(() => ({}));
        if (!cRes.ok) setMsg(cJson.error || "Falha ao ler combos.");
        else setCombos(Array.isArray(cJson.combos) ? cJson.combos : []);
        if (!pRes.ok) setMsg(pJson.error || "Falha ao ler promoções.");
        else setPromos(Array.isArray(pJson.promocoes) ? pJson.promocoes : []);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 sm:p-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Combos e promoções</h1>
                    <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                        O combo existe sozinho. A promoção aplica um preço menor por um prazo e não altera o preço de catálogo.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button type="button" onClick={() => { setEditCombo(null); setOpenCombo(true); }}>Novo combo</Button>
                    <Button type="button" variant="outline" onClick={() => { setEditPromo(null); setOpenPromo(true); }}>Nova promoção</Button>
                </div>
            </header>
            {msg ? <p className="text-sm text-zinc-700 dark:text-zinc-300">{msg}</p> : null}

            <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Combos</h2>
                {combos.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhum combo ainda.</p>
                ) : (
                    <ul className={listCard}>
                        {combos.map((c) => {
                            const drift = (c.itens ?? []).some((i) => i.divergiu);
                            return (
                                <li key={c.id} className="flex flex-col gap-1 px-4 py-3">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <p className="font-medium text-zinc-900 dark:text-zinc-100">{c.nome}</p>
                                        <div className="flex items-center gap-3">
                                            <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                                {c.preco != null ? brl(Number(c.preco)) : "Sem preço"}
                                                {c.preco_efetivo != null && c.preco != null && Number(c.preco_efetivo) < Number(c.preco)
                                                    ? ` · promoção ${brl(Number(c.preco_efetivo))}`
                                                    : ""}
                                            </p>
                                            <button
                                                type="button"
                                                className="text-xs font-semibold text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200"
                                                onClick={() => { setEditCombo(c); setOpenCombo(true); }}
                                            >
                                                Editar
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                        {(c.itens ?? []).map((i) => `${i.quantidade}× ${i.nome ?? "Item"}`).join(" · ") || "Sem itens"}
                                        {c.is_active ? "" : " · inativo"}
                                        {c.show_on_menu ? "" : " · oculto no cardápio"}
                                    </p>
                                    {drift ? (
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-xs text-amber-800 dark:text-amber-200">
                                                O preço de catálogo de um componente mudou. O combo continua no preço congelado.
                                            </p>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                disabled={recalcId === c.id}
                                                onClick={() => void recalcular(c)}
                                            >
                                                {recalcId === c.id ? "Recalculando…" : "Recalcular pro rata"}
                                            </Button>
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </section>

            <section className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Promoções</h2>
                {promos.length === 0 ? (
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">Nenhuma promoção ainda.</p>
                ) : (
                    <ul className={listCard}>
                        {promos.map((p) => (
                            <li key={p.id} className="px-4 py-3">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <p className="font-medium text-zinc-900 dark:text-zinc-100">{p.nome}</p>
                                    <div className="flex items-center gap-3">
                                        <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{p.status}</p>
                                        <button
                                            type="button"
                                            className="text-xs font-semibold text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200"
                                            onClick={() => { setEditPromo(p); setOpenPromo(true); }}
                                        >
                                            Editar
                                        </button>
                                    </div>
                                </div>
                                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                    {new Date(p.starts_at).toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })}
                                    {" — "}
                                    {new Date(p.ends_at).toLocaleString("pt-BR", { timeZone: "America/Cuiaba" })}
                                    {" · "}
                                    {(p.alvos ?? []).map((a) => a.nome ?? "Alvo").join(", ")}
                                </p>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <ComboDialog
                open={openCombo}
                combo={editCombo}
                onOpenChange={(open) => { setOpenCombo(open); if (!open) setEditCombo(null); }}
                onSaved={async (text) => {
                    setMsg(text);
                    setOpenCombo(false);
                    await load();
                }}
            />
            <PromoDialog
                open={openPromo}
                promo={editPromo}
                atLimit={promos.filter((p) => p.status !== "expirada").length >= 5}
                combos={combos.filter((c) => c.preco != null)}
                onOpenChange={(open) => { setOpenPromo(open); if (!open) setEditPromo(null); }}
                onSaved={async (text) => {
                    setMsg(text);
                    setOpenPromo(false);
                    await load();
                }}
            />
        </div>
    );
}

function ComboDialog(props: {
    open: boolean;
    combo: ComboRow | null;
    onOpenChange: (open: boolean) => void;
    onSaved: (msg: string) => Promise<void>;
}) {
    const [nome, setNome] = useState("");
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<EmbHit[]>([]);
    const [lines, setLines] = useState<DraftLine[]>([]);
    const [modo, setModo] = useState<"pro_rata" | "manual">("manual");
    const [preco, setPreco] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [showOnMenu, setShowOnMenu] = useState(true);
    const [foto, setFoto] = useState<File | null>(null);

    useEffect(() => {
        if (!props.open) return;
        const c = props.combo;
        setErr(null);
        setFoto(null);
        setQ("");
        setHits([]);
        if (!c) {
            setNome("");
            setLines([]);
            setPreco("");
            setModo("manual");
            setShowOnMenu(true);
            return;
        }
        const next = (c.itens ?? []).map((i) => ({
            id: i.produto_embalagem_id,
            label: `${i.nome ?? "Item"} (${i.sigla ?? "UN"})`,
            price: Number(i.preco_venda_atual ?? 0),
            details: null,
            sigla: i.sigla ?? null,
            fator: 1,
            quantidade: Number(i.quantidade) || 1,
            precoUnitario: formatBrlInput(
                i.preco_alocado != null && Number(i.quantidade) > 0
                    ? Number(i.preco_alocado) / Number(i.quantidade)
                    : Number(i.preco_venda_atual ?? 0)
            ),
        }));
        setNome(c.nome);
        setShowOnMenu(c.show_on_menu);
        setLines(next);
        setPreco(c.preco != null ? formatBrlInput(Number(c.preco)) : formatBrlInput(sumLines(next)));
        setModo(c.modo_preco === "pro_rata" ? "pro_rata" : "manual");
    }, [props.open, props.combo]);

    function syncFromUnits(next: DraftLine[]) {
        setLines(next);
        setModo("manual");
        setPreco(formatBrlInput(sumLines(next)));
    }

    function applyComboTotal(masked: string, current = lines) {
        setPreco(masked);
        setModo("pro_rata");
        const total = parseBrl(masked);
        const parts = current.map((l) => Math.round(l.price * l.quantidade * 100) / 100);
        const catalog = parts.reduce((a, b) => a + b, 0);
        if (total <= 0 || current.length === 0 || parts.some((p) => p <= 0) || total > catalog + 0.001) return;
        const shares = previewRateio(parts, total);
        setLines(current.map((l, i) => ({
            ...l,
            precoUnitario: formatBrlInput(shares[i] / l.quantidade),
        })));
    }

    function addLine(hit: EmbHit) {
        if (lines.some((l) => l.id === hit.id)) return;
        syncFromUnits([...lines, { ...hit, quantidade: 1, precoUnitario: formatBrlInput(hit.price) }]);
    }

    function removeLine(id: string) {
        syncFromUnits(lines.filter((l) => l.id !== id));
    }

    useEffect(() => {
        const query = q.trim();
        if (query.length < 2) {
            setHits([]);
            return;
        }
        const t = setTimeout(() => {
            void (async () => {
                const res = await fetch(`/api/admin/pdv/products?q=${encodeURIComponent(query)}&limit=12`, {
                    credentials: "include",
                });
                const json = await res.json().catch(() => ({}));
                const rows = Array.isArray(json.rows) ? json.rows : [];
                setHits(
                    rows
                        .filter((r: { sigla_comercial?: string }) => String(r.sigla_comercial ?? "") !== "KIT")
                        .map((r: { id?: string; product_name?: string; preco_venda?: number; sigla_comercial?: string; fator_conversao?: number }) => ({
                            id: String(r.id),
                            label: `${r.product_name ?? "Item"} (${r.sigla_comercial ?? "UN"})`,
                            price: Number(r.preco_venda ?? 0),
                            details: null,
                            sigla: r.sigla_comercial ? String(r.sigla_comercial) : null,
                            fator: Number(r.fator_conversao ?? 1),
                        }))
                );
            })();
        }, 250);
        return () => clearTimeout(t);
    }, [q]);

    async function save() {
        setBusy(true);
        setErr(null);
        try {
            const created = await fetch("/api/admin/combos", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: props.combo?.id,
                    nome,
                    show_on_menu: showOnMenu,
                    image_path: props.combo?.image_path ?? null,
                    itens: lines.map((l) => ({ produto_embalagem_id: l.id, quantidade: l.quantidade })),
                }),
            });
            const createdJson = await created.json().catch(() => ({}));
            if (!created.ok) {
                setErr(createdJson.error || "Não salvou o combo.");
                return;
            }
            const comboId = String(createdJson.id ?? props.combo?.id ?? "");
            if (foto && comboId) {
                const form = new FormData();
                form.append("kind", "combo");
                form.append("id", comboId);
                form.append("file", foto);
                const up = await fetch("/api/admin/catalog-image", { method: "POST", credentials: "include", body: form });
                if (!up.ok) {
                    const upJson = await up.json().catch(() => ({}));
                    setErr(upJson.error || "Combo salvo, mas a foto não entrou.");
                    return;
                }
            }
            const priced = await fetch("/api/admin/combos/preco", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    combo_id: comboId,
                    modo,
                    preco: modo === "pro_rata" ? parseBrl(preco) : undefined,
                    is_active: props.combo?.is_active ?? true,
                    itens: lines.map((l) => ({
                        produto_embalagem_id: l.id,
                        preco_unitario: parseBrl(l.precoUnitario),
                    })),
                }),
            });
            const pricedJson = await priced.json().catch(() => ({}));
            if (!priced.ok) {
                setErr(pricedJson.error || "O combo foi salvo sem preço.");
                return;
            }
            await props.onSaved(props.combo ? "Combo atualizado." : "Combo salvo.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogTitle>{props.combo ? "Editar combo" : "Novo combo"}</DialogTitle>
                <label className={fieldLabel}>
                    Nome
                    <input className={`mt-1 ${fieldInput}`} value={nome} onChange={(e) => setNome(e.target.value)} />
                </label>
                <label className={fieldLabel}>
                    Foto do combo
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className={`mt-1 ${fieldInput}`}
                        onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
                    />
                </label>
                {props.combo?.image_path && !foto ? (
                    <img src={props.combo.image_path} alt="" className="h-16 w-16 rounded-lg object-cover" />
                ) : null}
                <label className={choiceLabel}>
                    <input type="checkbox" checked={showOnMenu} onChange={(e) => setShowOnMenu(e.target.checked)} />
                    Mostrar no cardápio
                </label>
                <label className={fieldLabel}>
                    Buscar produto já cadastrado
                    <input className={`mt-1 ${fieldInput}`} value={q} onChange={(e) => setQ(e.target.value)} />
                </label>
                <ul className="mt-2 flex flex-col gap-1">
                    {hits.map((h) => (
                        <li key={h.id}>
                            <button type="button" className={hitBtn} onClick={() => addLine(h)}>
                                {h.label} · {brl(h.price)}
                            </button>
                        </li>
                    ))}
                </ul>
                <Link href="/produtos/lista?novo=1" className="text-sm font-semibold text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200">
                    Adicionar novo produto
                </Link>
                <ul className="mt-3 flex flex-col gap-2">
                    {lines.map((l) => (
                        <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_auto] items-end gap-2 text-sm text-foreground">
                            <span className="truncate pb-2">{l.label}</span>
                            <label className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                                Qtd
                                <input
                                    aria-label={`Quantidade de ${l.label}`}
                                    className={fieldInput}
                                    inputMode="numeric"
                                    value={l.quantidade}
                                    onChange={(e) => {
                                        const quantidade = Math.max(1, Number(e.target.value) || 1);
                                        syncFromUnits(lines.map((x) => (x.id === l.id ? { ...x, quantidade } : x)));
                                    }}
                                />
                            </label>
                            <MoneyField
                                label="Unitário"
                                value={l.precoUnitario}
                                onChange={(masked) => {
                                    syncFromUnits(lines.map((x) => (x.id === l.id ? { ...x, precoUnitario: masked } : x)));
                                }}
                            />
                            <button
                                type="button"
                                aria-label={`Remover ${l.label}`}
                                className="mb-1 rounded-md p-2 text-zinc-500 hover:bg-zinc-100 hover:text-red-700 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                                onClick={() => removeLine(l.id)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </button>
                        </li>
                    ))}
                </ul>
                <MoneyField label="Valor do combo" value={preco} onChange={(masked) => applyComboTotal(masked)} />
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    {modo === "pro_rata"
                        ? "O valor do combo reparte o preço entre os produtos."
                        : "A soma dos produtos atualiza o valor do combo."}
                </p>
                {err ? <p className="mt-2 text-sm text-red-700 dark:text-red-400">{err}</p> : null}
                <Button type="button" className="mt-4" disabled={busy || lines.length === 0} onClick={() => void save()}>
                    {busy ? "Salvando…" : "Salvar combo"}
                </Button>
            </DialogContent>
        </Dialog>
    );
}

function PromoPreview(props: {
    preco: string;
    alvoKind: "emb" | "combo";
    alvoId: string;
    hits: EmbHit[];
    combos: ComboRow[];
    savedName: string | null;
    savedImage: string | null;
    fotoUrl: string | null;
}) {
    const hit = props.hits.find((h) => h.id === props.alvoId) ?? null;
    const combo = props.combos.find((c) => c.id === props.alvoId) ?? null;
    const name = (props.alvoKind === "combo" ? combo?.nome : hit?.label) || props.savedName || "Nome do produto";
    const items = (combo?.itens ?? [])
        .map((i) => `${i.quantidade}× ${i.nome ?? "Item"}`)
        .join(" · ");
    const description = props.alvoKind === "combo"
        ? [combo?.descricao, items].filter((part) => part && String(part).trim()).join("\n") || null
        : hit?.details ?? null;
    const pack = props.alvoKind === "emb" && hit ? formatMenuPackLabel(hit.sigla, hit.fator) : "";
    const amount = parseBrl(props.preco);
    const catalog = props.alvoKind === "combo" ? Number(combo?.preco ?? 0) : Number(hit?.price ?? 0);
    const imageUrl = props.fotoUrl || props.savedImage || (props.alvoKind === "combo" ? combo?.image_path : null) || null;
    return (
        <div>
            <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">Prévia no cardápio</p>
            <PromoBannerFace
                name={name}
                description={description}
                packLabel={pack || null}
                listPriceLabel={catalog > amount && catalog > 0 ? brl(catalog) : null}
                priceLabel={amount > 0 ? brl(amount) : null}
                imageUrl={imageUrl}
            />
        </div>
    );
}

function PromoDialog(props: {
    open: boolean;
    promo: PromoRow | null;
    atLimit: boolean;
    combos: ComboRow[];
    onOpenChange: (open: boolean) => void;
    onSaved: (msg: string) => Promise<void>;
}) {
    const [nome, setNome] = useState("");
    const [starts, setStarts] = useState("");
    const [ends, setEnds] = useState("");
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<EmbHit[]>([]);
    const [alvoId, setAlvoId] = useState("");
    const [alvoKind, setAlvoKind] = useState<"emb" | "combo">("emb");
    const [preco, setPreco] = useState("");
    const [foto, setFoto] = useState<File | null>(null);
    const [fotoUrl, setFotoUrl] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!foto) {
            setFotoUrl(null);
            return;
        }
        const url = URL.createObjectURL(foto);
        setFotoUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [foto]);

    useEffect(() => {
        if (!props.open) return;
        const p = props.promo;
        setFoto(null);
        setErr(null);
        if (!p) {
            setNome("");
            setStarts("");
            setEnds("");
            setAlvoId("");
            setAlvoKind("emb");
            setPreco("");
            return;
        }
        setNome(p.nome);
        setStarts(toDatetimeLocal(p.starts_at));
        setEnds(toDatetimeLocal(p.ends_at));
        const alvo = p.alvos?.[0];
        setAlvoKind(alvo?.combo_id ? "combo" : "emb");
        setAlvoId(alvo?.combo_id ?? alvo?.produto_embalagem_id ?? "");
        setPreco(alvo ? formatBrlInput(Number(alvo.preco_promocional)) : "");
    }, [props.open, props.promo]);

    useEffect(() => {
        const query = q.trim();
        if (query.length < 2) return;
        const t = setTimeout(() => {
            void (async () => {
                const res = await fetch(`/api/admin/pdv/products?q=${encodeURIComponent(query)}&limit=8`, {
                    credentials: "include",
                });
                const json = await res.json().catch(() => ({}));
                const rows = Array.isArray(json.rows) ? json.rows : [];
                setHits(
                    rows
                        .filter((r: { sigla_comercial?: string }) => String(r.sigla_comercial ?? "") !== "KIT")
                        .map((r: {
                            id?: string;
                            product_name?: string;
                            descricao?: string | null;
                            product_details?: string | null;
                            preco_venda?: number;
                            sigla_comercial?: string | null;
                            fator_conversao?: number;
                        }) => ({
                            id: String(r.id),
                            label: buildPackDisplayName({
                                productName: r.product_name,
                                itemName: r.descricao,
                            }),
                            price: Number(r.preco_venda ?? 0),
                            details: r.product_details ? String(r.product_details) : null,
                            sigla: r.sigla_comercial ? String(r.sigla_comercial) : null,
                            fator: Number(r.fator_conversao ?? 1),
                        }))
                );
            })();
        }, 250);
        return () => clearTimeout(t);
    }, [q]);

    async function save() {
        setBusy(true);
        setErr(null);
        try {
            const alvo = alvoKind === "combo"
                ? { combo_id: alvoId, preco_promocional: parseBrl(preco) }
                : { produto_embalagem_id: alvoId, preco_promocional: parseBrl(preco) };
            const res = await fetch("/api/admin/promocoes", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: props.promo?.id,
                    nome,
                    starts_at: cuiabaIso(starts),
                    ends_at: cuiabaIso(ends),
                    paused: props.promo?.paused ?? false,
                    alvos: [alvo],
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json.error || "Não salvou a promoção.");
                return;
            }
            const promoId = String(json.id ?? props.promo?.id ?? "");
            if (foto && promoId) {
                const form = new FormData();
                form.append("kind", "promo");
                form.append("id", promoId);
                form.append("file", foto);
                const up = await fetch("/api/admin/catalog-image", { method: "POST", credentials: "include", body: form });
                if (!up.ok) {
                    const upJson = await up.json().catch(() => ({}));
                    setErr(upJson.error || "Promoção salva, mas a arte não entrou.");
                    return;
                }
            }
            await props.onSaved(props.promo ? "Promoção atualizada." : "Promoção salva.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-h-[min(44rem,calc(100dvh-2rem))] overflow-y-auto sm:max-w-xl">
                <DialogTitle>{props.promo ? "Editar promoção" : "Nova promoção"}</DialogTitle>
                {!props.promo && props.atLimit ? (
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                        Esta loja já tem 5 promoções em aberto. Edite ou espere uma expirar.
                    </p>
                ) : null}
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Início e fim no horário de Cuiabá. A prévia é o banner do cardápio.
                </p>
                <PromoPreview
                    preco={preco}
                    alvoKind={alvoKind}
                    alvoId={alvoId}
                    hits={hits}
                    combos={props.combos}
                    savedName={props.promo?.alvos?.[0]?.nome ?? null}
                    savedImage={props.promo?.image_path ?? null}
                    fotoUrl={fotoUrl}
                />
                <label className={fieldLabel}>
                    Nome
                    <input className={`mt-1 ${fieldInput}`} value={nome} onChange={(e) => setNome(e.target.value)} />
                </label>
                <label className={fieldLabel}>
                    Arte da promoção
                    <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className={`mt-1 ${fieldInput}`}
                        onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
                    />
                </label>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className={fieldLabel}>
                        Início
                        <input type="datetime-local" className={`mt-1 ${fieldInput}`} value={starts} onChange={(e) => setStarts(e.target.value)} />
                    </label>
                    <label className={fieldLabel}>
                        Fim
                        <input type="datetime-local" className={`mt-1 ${fieldInput}`} value={ends} onChange={(e) => setEnds(e.target.value)} />
                    </label>
                </div>
                <fieldset className="mt-3 flex gap-4">
                    <label className={choiceLabel}>
                        <input type="radio" name="alvo" checked={alvoKind === "emb"} onChange={() => { setAlvoKind("emb"); setAlvoId(""); }} />
                        Produto
                    </label>
                    <label className={choiceLabel}>
                        <input type="radio" name="alvo" checked={alvoKind === "combo"} onChange={() => { setAlvoKind("combo"); setAlvoId(""); }} />
                        Combo já criado
                    </label>
                </fieldset>
                {alvoKind === "combo" ? (
                    <select className={fieldInput} value={alvoId} onChange={(e) => setAlvoId(e.target.value)} aria-label="Combo da promoção">
                        <option value="">Escolha o combo</option>
                        {props.combos.map((c) => (
                            <option key={c.id} value={c.id}>{c.nome} · {c.preco != null ? brl(Number(c.preco)) : ""}</option>
                        ))}
                    </select>
                ) : (
                    <>
                        <input className={fieldInput} placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar produto" />
                        <ul className="mt-1">
                            {hits.map((h) => (
                                <li key={h.id}>
                                    <button type="button" className={hitBtn} onClick={() => setAlvoId(h.id)}>
                                        {alvoId === h.id ? "✓ " : ""}{h.label} · {brl(h.price)}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </>
                )}
                <MoneyField label="Preço promocional" value={preco} onChange={setPreco} />
                <Link href="/produtos/lista?novo=1" className="text-sm font-semibold text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200">
                    Adicionar novo produto
                </Link>
                {err ? <p className="mt-2 text-sm text-red-700 dark:text-red-400">{err}</p> : null}
                <Button type="button" className="mt-4" disabled={busy || !alvoId || (!props.promo && props.atLimit)} onClick={() => void save()}>
                    {busy ? "Salvando…" : "Salvar promoção"}
                </Button>
            </DialogContent>
        </Dialog>
    );
}
