"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

type EmbHit = { id: string; label: string; price: number };
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

function cuiabaIso(local: string): string {
    return new Date(`${local}:00-04:00`).toISOString();
}

export default function PromocoesClient() {
    const [combos, setCombos] = useState<ComboRow[]>([]);
    const [promos, setPromos] = useState<PromoRow[]>([]);
    const [msg, setMsg] = useState<string | null>(null);
    const [openCombo, setOpenCombo] = useState(false);
    const [openPromo, setOpenPromo] = useState(false);
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
                    <Button type="button" onClick={() => setOpenCombo(true)}>Novo combo</Button>
                    <Button type="button" variant="outline" onClick={() => setOpenPromo(true)}>Nova promoção</Button>
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
                                        <p className="text-sm text-zinc-700 dark:text-zinc-300">
                                            {c.preco != null ? brl(Number(c.preco)) : "Sem preço"}
                                            {c.preco_efetivo != null && c.preco != null && Number(c.preco_efetivo) < Number(c.preco)
                                                ? ` · promoção ${brl(Number(c.preco_efetivo))}`
                                                : ""}
                                        </p>
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
                                    <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{p.status}</p>
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
                onOpenChange={setOpenCombo}
                onSaved={async (text) => {
                    setMsg(text);
                    setOpenCombo(false);
                    await load();
                }}
            />
            <PromoDialog
                open={openPromo}
                combos={combos.filter((c) => c.preco != null)}
                onOpenChange={setOpenPromo}
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
    onOpenChange: (open: boolean) => void;
    onSaved: (msg: string) => Promise<void>;
}) {
    const [nome, setNome] = useState("");
    const [q, setQ] = useState("");
    const [hits, setHits] = useState<EmbHit[]>([]);
    const [lines, setLines] = useState<Array<EmbHit & { quantidade: number; precoUnitario: string }>>([]);
    const [modo, setModo] = useState<"pro_rata" | "manual">("pro_rata");
    const [preco, setPreco] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [showOnMenu, setShowOnMenu] = useState(true);
    const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
    const [unSiglaId, setUnSiglaId] = useState("");
    const [novoNome, setNovoNome] = useState("");
    const [novoCat, setNovoCat] = useState("");
    const [novoPreco, setNovoPreco] = useState("");
    const [novoNoMenu, setNovoNoMenu] = useState(false);

    useEffect(() => {
        if (!props.open) return;
        void (async () => {
            const [catRes, metaRes] = await Promise.all([
                fetch("/api/admin/products/categories", { credentials: "include" }),
                fetch("/api/admin/products", { credentials: "include" }),
            ]);
            const catJson = await catRes.json().catch(() => ({}));
            const metaJson = await metaRes.json().catch(() => ({}));
            const cats = Array.isArray(catJson.categories) ? catJson.categories : [];
            setCategories(cats.map((c: { id?: string; name?: string }) => ({ id: String(c.id), name: String(c.name ?? "") })));
            const siglas = Array.isArray(metaJson.siglas) ? metaJson.siglas : [];
            const un = siglas.find((s: { sigla?: string }) => String(s.sigla ?? "").toUpperCase() === "UN");
            setUnSiglaId(un ? String(un.id) : "");
        })();
    }, [props.open]);

    function addLine(hit: EmbHit) {
        if (lines.some((l) => l.id === hit.id)) return;
        setLines((prev) => [...prev, { ...hit, quantidade: 1, precoUnitario: String(hit.price) }]);
    }

    async function createProduct() {
        setBusy(true);
        setErr(null);
        try {
            const price = Number(novoPreco.replace(",", "."));
            if (!novoNome.trim() || !novoCat || !unSiglaId || !(price > 0)) {
                setErr("Informe nome, categoria e um preço maior que zero. A sigla UN precisa existir na empresa.");
                return;
            }
            const created = await fetch("/api/admin/products", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: novoNome.trim(),
                    category_id: novoCat,
                    is_active: true,
                    vender_com_estoque_zero: true,
                    volumes: [{
                        estoque_atual: 0,
                        estoque_minimo: 0,
                        items: [{
                            id_sigla_comercial: unSiglaId,
                            fator_conversao: 1,
                            preco_venda: price,
                            descricao: novoNome.trim(),
                        }],
                    }],
                }),
            });
            const createdJson = await created.json().catch(() => ({}));
            if (!created.ok) {
                setErr(createdJson.error || "Não cadastrou o produto.");
                return;
            }
            const productId = String(createdJson.product_id ?? "");
            if (productId && !novoNoMenu) {
                const vis = await fetch("/api/admin/products/menu-visibility", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ productId, showOnMenu: false }),
                });
                if (!vis.ok) {
                    const visJson = await vis.json().catch(() => ({}));
                    setErr(visJson.error || "Produto criado, mas não saiu do cardápio.");
                }
            }
            const search = await fetch(`/api/admin/pdv/products?q=${encodeURIComponent(novoNome.trim())}&limit=12`, {
                credentials: "include",
            });
            const searchJson = await search.json().catch(() => ({}));
            const rows = Array.isArray(searchJson.rows) ? searchJson.rows : [];
            const wanted = novoNome.trim().toUpperCase();
            const row = rows.find((r: { product_name?: string; sigla_comercial?: string }) =>
                String(r.product_name ?? "").toUpperCase() === wanted && String(r.sigla_comercial ?? "") !== "KIT"
            );
            if (!row?.id) {
                setErr("Produto criado. Busque o nome acima para incluir no combo.");
                return;
            }
            addLine({
                id: String(row.id),
                label: `${row.product_name ?? novoNome} (${row.sigla_comercial ?? "UN"})`,
                price: Number(row.preco_venda ?? price),
            });
            setNovoNome("");
            setNovoPreco("");
        } finally {
            setBusy(false);
        }
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
                        .map((r: { id?: string; product_name?: string; preco_venda?: number; sigla_comercial?: string }) => ({
                            id: String(r.id),
                            label: `${r.product_name ?? "Item"} (${r.sigla_comercial ?? "UN"})`,
                            price: Number(r.preco_venda ?? 0),
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
                    nome,
                    show_on_menu: showOnMenu,
                    itens: lines.map((l) => ({ produto_embalagem_id: l.id, quantidade: l.quantidade })),
                }),
            });
            const createdJson = await created.json().catch(() => ({}));
            if (!created.ok) {
                setErr(createdJson.error || "Não salvou o combo.");
                return;
            }
            const priced = await fetch("/api/admin/combos/preco", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    combo_id: createdJson.id,
                    modo,
                    preco: modo === "pro_rata" ? Number(preco.replace(",", ".")) : undefined,
                    is_active: true,
                    itens: lines.map((l) => ({
                        produto_embalagem_id: l.id,
                        preco_unitario: Number(l.precoUnitario.replace(",", ".")),
                    })),
                }),
            });
            const pricedJson = await priced.json().catch(() => ({}));
            if (!priced.ok) {
                setErr(pricedJson.error || "O combo foi criado sem preço.");
                return;
            }
            await props.onSaved("Combo salvo.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
                <DialogTitle>Novo combo</DialogTitle>
                <label className={fieldLabel}>
                    Nome
                    <input className={`mt-1 ${fieldInput}`} value={nome} onChange={(e) => setNome(e.target.value)} />
                </label>
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
                            <button
                                type="button"
                                className={hitBtn}
                                onClick={() => addLine(h)}
                            >
                                {h.label} · {brl(h.price)}
                            </button>
                        </li>
                    ))}
                </ul>
                <fieldset className="mt-4 flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                    <legend className={`px-1 ${fieldLabel}`}>Ou cadastrar produto novo</legend>
                    <input className={fieldInput} placeholder="Nome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} />
                    <select className={fieldInput} value={novoCat} onChange={(e) => setNovoCat(e.target.value)} aria-label="Categoria do produto novo">
                        <option value="">Categoria</option>
                        {categories.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <input className={fieldInput} placeholder="Preço de venda" value={novoPreco} onChange={(e) => setNovoPreco(e.target.value)} />
                    <label className={choiceLabel}>
                        <input type="checkbox" checked={novoNoMenu} onChange={(e) => setNovoNoMenu(e.target.checked)} />
                        Mostrar este produto sozinho no cardápio
                    </label>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void createProduct()}>
                        Cadastrar e incluir no combo
                    </Button>
                </fieldset>
                <ul className="mt-3 flex flex-col gap-2">
                    {lines.map((l) => (
                        <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_4rem_6rem] items-center gap-2 text-sm text-foreground">
                            <span className="truncate">{l.label}</span>
                            <input
                                aria-label={`Quantidade de ${l.label}`}
                                className={fieldInput}
                                inputMode="numeric"
                                value={l.quantidade}
                                onChange={(e) => {
                                    const quantidade = Math.max(1, Number(e.target.value) || 1);
                                    setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, quantidade } : x)));
                                }}
                            />
                            <input
                                aria-label={`Preço unitário de ${l.label}`}
                                className={fieldInput}
                                value={l.precoUnitario}
                                onChange={(e) => setLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, precoUnitario: e.target.value } : x)))}
                                disabled={modo !== "manual"}
                            />
                        </li>
                    ))}
                </ul>
                <fieldset className="mt-3 flex gap-4">
                    <label className={choiceLabel}>
                        <input type="radio" name="modo" checked={modo === "pro_rata"} onChange={() => setModo("pro_rata")} />
                        Pro rata
                    </label>
                    <label className={choiceLabel}>
                        <input type="radio" name="modo" checked={modo === "manual"} onChange={() => setModo("manual")} />
                        Preço de cada item
                    </label>
                </fieldset>
                {modo === "pro_rata" ? (
                    <label className={fieldLabel}>
                        Valor do combo
                        <input className={`mt-1 ${fieldInput}`} value={preco} onChange={(e) => setPreco(e.target.value)} />
                    </label>
                ) : null}
                {err ? <p className="mt-2 text-sm text-red-700 dark:text-red-400">{err}</p> : null}
                <Button type="button" className="mt-4" disabled={busy || lines.length === 0} onClick={() => void save()}>
                    {busy ? "Salvando…" : "Salvar combo"}
                </Button>
            </DialogContent>
        </Dialog>
    );
}

function PromoDialog(props: {
    open: boolean;
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
    const [err, setErr] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

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
                        .map((r: { id?: string; product_name?: string; preco_venda?: number }) => ({
                            id: String(r.id),
                            label: String(r.product_name ?? "Item"),
                            price: Number(r.preco_venda ?? 0),
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
                ? { combo_id: alvoId, preco_promocional: Number(preco.replace(",", ".")) }
                : { produto_embalagem_id: alvoId, preco_promocional: Number(preco.replace(",", ".")) };
            const res = await fetch("/api/admin/promocoes", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nome,
                    starts_at: cuiabaIso(starts),
                    ends_at: cuiabaIso(ends),
                    paused: false,
                    alvos: [alvo],
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                setErr(json.error || "Não salvou a promoção.");
                return;
            }
            await props.onSaved("Promoção salva.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogTitle>Nova promoção</DialogTitle>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Início e fim no horário de Cuiabá.</p>
                <label className={fieldLabel}>
                    Nome
                    <input className={`mt-1 ${fieldInput}`} value={nome} onChange={(e) => setNome(e.target.value)} />
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
                <label className={fieldLabel}>
                    Preço promocional
                    <input className={`mt-1 ${fieldInput}`} value={preco} onChange={(e) => setPreco(e.target.value)} />
                </label>
                {err ? <p className="mt-2 text-sm text-red-700 dark:text-red-400">{err}</p> : null}
                <Button type="button" className="mt-4" disabled={busy || !alvoId} onClick={() => void save()}>
                    {busy ? "Salvando…" : "Salvar promoção"}
                </Button>
            </DialogContent>
        </Dialog>
    );
}
