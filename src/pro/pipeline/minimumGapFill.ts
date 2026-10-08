import { isPickupDraft } from "@/lib/delivery/fulfillment";
import type { OrderDraft, OutboundMessage } from "@/src/types/contracts";

export type GapFillSuggestion = {
    produtoEmbalagemId: string;
    label: string;
    price: number;
};

export type GapCatalogRow = {
    id: string;
    productName: string;
    label: string;
    price: number;
    sigla: string;
};

export type GapDraftLine = {
    produtoEmbalagemId: string;
    productName: string;
    sigla: string | null;
};

const PACK_WORDS = new Set([
    "caixa",
    "caixas",
    "lata",
    "latas",
    "unidade",
    "unidades",
    "fardo",
    "fardos",
    "pacote",
    "pacotes",
]);

function brl(value: number): string {
    return value.toFixed(2).replace(".", ",");
}

function normalizeToken(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\(.*?\)/g, " ")
        .replaceAll(/[^a-z0-9\s]/g, " ")
        .replaceAll(/\s+/g, " ")
        .trim();
}

/** Primeira palavra do nome que identifica a marca (SKOL, HEINEKEN). Sem tabela de marcas. */
export function brandTokenFromName(name: string): string | null {
    const token = normalizeToken(name)
        .split(" ")
        .find((t) => t.length >= 3 && !PACK_WORDS.has(t));
    return token ?? null;
}

/**
 * Mínimo que vale para este rascunho.
 * Com endereço, usa o mínimo já calculado (pode ser o do bairro).
 * Sem endereço, usa o mínimo da loja — o aviso sai depois dos itens.
 */
export function resolveMinimumOrderAmount(
    draft: OrderDraft,
    storeMinOrder: number | null | undefined
): number | null {
    if (isPickupDraft(draft) || draft.fulfillmentType === "pickup") return null;
    if (draft.deliveryMinOrder != null && draft.deliveryMinOrder > 0) return draft.deliveryMinOrder;
    if (storeMinOrder != null && storeMinOrder > 0) return storeMinOrder;
    return null;
}

/**
 * 1) mesma marca e mesma embalagem (sigla) do que já está no pedido
 * 2) senão, acompanhamentos ligados a essas embalagens no cadastro
 * 3) senão, lista vazia — a frase pede outro produto, sem citar item
 */
export function pickMinimumGapSuggestions(params: {
    draft: readonly GapDraftLine[];
    catalog: readonly GapCatalogRow[];
    accompaniments: readonly GapCatalogRow[];
}): GapFillSuggestion[] {
    const inDraft = new Set(params.draft.map((l) => l.produtoEmbalagemId).filter(Boolean));
    const wanted = new Set<string>();
    for (const line of params.draft) {
        const brand = brandTokenFromName(line.productName);
        const sigla = String(line.sigla ?? "").trim().toUpperCase();
        if (!brand || !sigla) continue;
        wanted.add(`${brand}|${sigla}`);
    }
    const samePack = params.catalog
        .filter((row) => {
            if (inDraft.has(row.id) || !(row.price > 0) || !row.label.trim()) return false;
            const brand = brandTokenFromName(row.productName);
            const sigla = row.sigla.trim().toUpperCase();
            return Boolean(brand && sigla && wanted.has(`${brand}|${sigla}`));
        })
        .sort((a, b) => a.price - b.price)
        .slice(0, 3)
        .map(toSuggestion);
    if (samePack.length) return samePack;

    const seen = new Set<string>();
    const accompaniments: GapFillSuggestion[] = [];
    for (const row of params.accompaniments) {
        if (inDraft.has(row.id) || seen.has(row.id) || !(row.price > 0) || !row.label.trim()) continue;
        seen.add(row.id);
        accompaniments.push(toSuggestion(row));
        if (accompaniments.length >= 3) break;
    }
    return accompaniments;
}

function toSuggestion(row: GapCatalogRow): GapFillSuggestion {
    return {
        produtoEmbalagemId: row.id,
        label: row.label.trim(),
        price: row.price,
    };
}

export function minimumOrderShortfallText(
    grandTotal: number,
    min: number,
    suggestions: readonly GapFillSuggestion[],
    draftEmbalagemIds: readonly string[]
): string {
    const missing = Math.max(0, min - grandTotal);
    const base =
        `Seu pedido está em R$ ${brl(grandTotal)} e o mínimo para entrega é R$ ${brl(min)} ` +
        `(faltam R$ ${brl(missing)}).`;
    const inDraft = new Set(draftEmbalagemIds.filter(Boolean));
    const lines = suggestions
        .filter(
            (s) =>
                s.label.trim() &&
                Number.isFinite(s.price) &&
                s.price > 0 &&
                !inDraft.has(s.produtoEmbalagemId)
        )
        .slice(0, 3);
    if (!lines.length) {
        return `${base} Me diga outro produto que você quer adicionar.`;
    }
    const extra = lines.map((s) => `• ${s.label.trim()} — R$ ${brl(s.price)}`).join("\n");
    return `${base}\n\nPara completar, pode ser:\n${extra}`;
}

/**
 * Coloca o aviso depois do que já foi respondido neste turno.
 * Se a frase de mínimo já está no texto, troca por esta versão (com ou sem itens).
 */
export function applyMinimumOrderNotice(
    outbound: readonly OutboundMessage[],
    draft: OrderDraft | null | undefined,
    suggestions: readonly GapFillSuggestion[] | undefined,
    storeMinOrder: number | null | undefined
): OutboundMessage[] {
    if (!draft || draft.items.length === 0) return [...outbound];
    const min = resolveMinimumOrderAmount(draft, storeMinOrder);
    if (min == null || draft.grandTotal >= min) return [...outbound];
    const text = minimumOrderShortfallText(
        draft.grandTotal,
        min,
        suggestions ?? [],
        draft.items.map((i) => i.produtoEmbalagemId)
    );
    let replaced = false;
    const next = outbound.map((m) => {
        if (replaced || m.kind !== "text") return m;
        if (!/m[ií]nimo para entrega/iu.test(String(m.text ?? ""))) return m;
        replaced = true;
        return { ...m, text };
    });
    if (replaced) return next;
    return [...next, { kind: "text" as const, text }];
}
