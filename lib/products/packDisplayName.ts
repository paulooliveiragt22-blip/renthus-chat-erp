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

/** Rótulo da sigla para UI: sempre com fator — `UN c/1`, `CX c/8`. */
export function formatPackSiglaLabel(
    sigla: string | null | undefined,
    fatorConversao?: number | string | null
): string {
    const s = String(sigla ?? "UN").trim().toUpperCase() || "UN";
    const fator = Math.max(1, Number(fatorConversao ?? 1) || 1);
    return `${s} c/${fator}`;
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
    const fator = Math.max(1, Number(input.fatorConversao ?? 1) || 1);

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

    // Todas as siglas: inclui c/fator no nome (exceto se já houver)
    if (sigla && !hasPackCountHint(name)) {
        const pack = `${sigla} c/${fator}`;
        if (!name.toUpperCase().includes(`(${sigla}`)) {
            name = `${name} (${pack})`.replaceAll(/\s+/g, " ").trim();
        }
    }

    return name;
}
