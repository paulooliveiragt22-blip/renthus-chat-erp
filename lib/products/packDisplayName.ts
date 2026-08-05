/**
 * Nome de apresentação: produto + item/embalagem.
 * `descricao` em produto_embalagens = nome do item (ex.: "LATA", "CX 15UN").
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

/** Rótulo da sigla para UI (cardápio/PDV): `CX c/8` ou `UN`. */
export function formatPackSiglaLabel(
    sigla: string | null | undefined,
    fatorConversao?: number | string | null
): string {
    const s = String(sigla ?? "UN").trim().toUpperCase() || "UN";
    if (isUnSigla(s)) return s;
    const fator = Number(fatorConversao ?? 0);
    return fator > 1 ? `${s} c/${fator}` : s;
}

function hasPackCountHint(text: string): boolean {
    return /\bc\/\d+/i.test(text);
}

export function buildPackDisplayName(input: PackDisplayNameInput): string {
    const product = String(input.productName ?? "").trim() || "Produto";
    const item = String(input.itemName ?? "").trim();
    const sigla = String(input.sigla ?? "").trim().toUpperCase();
    const vol = Number(input.volumeQuantidade ?? 0);
    const unit = String(input.unitSigla ?? "").trim();
    const volPart = vol > 0 && unit ? `${vol}${unit}` : "";
    const fator = Number(input.fatorConversao ?? 0);

    let name: string;
    if (item) {
        const upperProduct = product.toUpperCase();
        const upperItem = item.toUpperCase();
        if (upperItem === upperProduct || upperItem.startsWith(upperProduct + " ")) {
            name = item;
        } else {
            name = `${product} ${item}`.replaceAll(/\s+/g, " ").trim();
        }
    } else {
        name = [product, volPart].filter(Boolean).join(" ").replaceAll(/\s+/g, " ").trim();
    }

    if (sigla && !isUnSigla(sigla) && !hasPackCountHint(name)) {
        const pack = fator > 1 ? `${sigla} c/${fator}` : sigla;
        if (!name.toUpperCase().includes(`(${sigla}`)) {
            name = `${name} (${pack})`.replaceAll(/\s+/g, " ").trim();
        }
    }

    return name;
}
