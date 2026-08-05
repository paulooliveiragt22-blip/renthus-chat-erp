/**
 * Nome de apresentação: produto + item/embalagem.
 * `descricao` em produto_embalagens = nome do item (ex.: "CX 15UN", "LONG NECK").
 */

export type PackDisplayNameInput = {
    productName: string | null | undefined;
    itemName?: string | null | undefined; // pe.descricao
    sigla?: string | null | undefined;
    volumeQuantidade?: number | string | null | undefined;
    unitSigla?: string | null | undefined;
    fatorConversao?: number | string | null | undefined;
};

function isUnSigla(sigla: string): boolean {
    const s = sigla.toUpperCase();
    return s === "UN" || s === "UND" || s === "UNID" || s === "UNIDADE";
}

export function buildPackDisplayName(input: PackDisplayNameInput): string {
    const product = String(input.productName ?? "").trim() || "Produto";
    const item = String(input.itemName ?? "").trim();
    if (item) {
        const upperProduct = product.toUpperCase();
        const upperItem = item.toUpperCase();
        if (upperItem === upperProduct || upperItem.startsWith(upperProduct + " ")) {
            return item;
        }
        return `${product} ${item}`.replaceAll(/\s+/g, " ").trim();
    }

    const sigla = String(input.sigla ?? "").trim().toUpperCase();
    const vol = Number(input.volumeQuantidade ?? 0);
    const unit = String(input.unitSigla ?? "").trim();
    const volPart = vol > 0 && unit ? `${vol}${unit}` : "";
    const parts = [product, volPart].filter(Boolean);

    if (sigla && !isUnSigla(sigla)) {
        const fator = Number(input.fatorConversao ?? 0);
        const pack = fator > 1 ? `${sigla} c/${fator}` : sigla;
        parts.push(`(${pack})`);
    }

    return parts.join(" ").replaceAll(/\s+/g, " ").trim();
}
