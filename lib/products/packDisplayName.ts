/**
 * Nome de apresentação: produto + item/embalagem.
 * `descricao` em produto_embalagens = nome do item (ex.: "LATA").
 * Sigla/fator NÃO entram no título — só no badge via formatPackSiglaLabel.
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

/**
 * Badge da sigla no cardápio.
 * UN → `UN:1` (quantidade/fator cadastrado no item).
 * CX/FARD/… → `CX:8` (mesmo padrão).
 */
export function formatPackSiglaLabel(
    sigla: string | null | undefined,
    fatorConversao?: number | string | null
): string {
    const s = String(sigla ?? "UN").trim().toUpperCase() || "UN";
    const fator = Math.max(1, Number(fatorConversao ?? 1) || 1);
    return `${s}:${fator}`;
}

export function buildPackDisplayName(input: PackDisplayNameInput): string {
    const product = String(input.productName ?? "").trim() || "Produto";
    const item = String(input.itemName ?? "").trim();
    const vol = Number(input.volumeQuantidade ?? 0);
    const unit = String(input.unitSigla ?? "").trim();
    const volPart = vol > 0 && unit ? `${vol}${unit}` : "";

    // Título limpo: sem sigla nem fator
    if (item) {
        const upperProduct = product.toUpperCase();
        const upperItem = item.toUpperCase();
        if (upperItem === upperProduct || upperItem.startsWith(upperProduct + " ")) {
            return item;
        }
        return `${product} ${item}`.replaceAll(/\s+/g, " ").trim();
    }

    return [product, volPart].filter(Boolean).join(" ").replaceAll(/\s+/g, " ").trim();
}

export { isUnSigla };
