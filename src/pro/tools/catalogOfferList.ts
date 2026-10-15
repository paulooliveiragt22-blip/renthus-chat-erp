/**
 * Pergunta de vitrine (promoções ou combos), não busca por nome de produto.
 * O texto ao cliente leva só o preço a cobrar — o da promoção, quando houver.
 */

export type CatalogOfferListKind = "promos" | "combos";

export type CatalogOfferListRow = {
    name: string;
    price: number;
    composition?: string | null;
};

const EDGE =
    /^(?:oi|ola|bom dia|boa tarde|boa noite|por favor|pfv|me|mostra|mostrar|liste|listar|quero|ver|veja|quais|qual|tem|voces tem|vcs tem|o que|que|esta|estao|em|as|os|de|da|do|no|na|cardapio|hoje|agora|ativa|ativas|disponivel|disponiveis)\s+|\s+(?:por favor|pfv|hoje|agora|no cardapio|voces tem|vcs tem|ativas?|disponiveis?)$/;

function normalizeOfferText(raw: string): string {
    return String(raw ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/[?!.,;:]/g, " ")
        .replaceAll(/\s+/g, " ")
        .trim();
}

function stripEdges(text: string): string {
    let s = text;
    let prev = "";
    while (s !== prev) {
        prev = s;
        s = s.replace(EDGE, "").trim();
    }
    return s;
}

export function catalogOfferListKind(raw: string): CatalogOfferListKind | null {
    const left = stripEdges(normalizeOfferText(raw));
    if (/^(?:promocao|promocoes|promo|promos|oferta|ofertas)$/.test(left)) return "promos";
    if (/^(?:combo|combos|kit|kits)$/.test(left)) return "combos";
    return null;
}

function formatBrl(value: number): string {
    return value.toFixed(2).replace(".", ",");
}

export function formatCatalogOfferList(
    kind: CatalogOfferListKind,
    rows: readonly CatalogOfferListRow[]
): string {
    const priced = rows.filter((row) => row.name.trim() && Number.isFinite(row.price) && row.price > 0);
    if (!priced.length) {
        return kind === "promos"
            ? "Agora não temos promoção ativa. Se quiser, me diga o produto."
            : "Agora não temos combo no cardápio. Se quiser, me diga o produto.";
    }
    const title = kind === "promos" ? "Promoções de agora:" : "Combos:";
    const lines = priced.map((row, index) => {
        const composition = String(row.composition ?? "").trim();
        const extra = composition ? `\n   ${composition}` : "";
        return `${index + 1}. ${row.name.trim()} — por R$ ${formatBrl(row.price)}${extra}`;
    });
    return `${title}\n\n${lines.join("\n")}\n\nSe quiser algum, diga o nome.`;
}
