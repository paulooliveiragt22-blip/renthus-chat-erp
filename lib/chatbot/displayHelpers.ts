/**
 * displayHelpers
 *
 * Funções puras para montar o nome de exibição de produtos.
 * Sem dependências externas — seguro para import em testes unitários.
 */

/** Campos mínimos para buildProductDisplayName */
export interface DisplayableVariant {
    productName:   string;
    volumeValue:   number;
    unit:          string;
    unitTypeSigla: string | null;
    details:       string | null;
    caseQty:       number | null;
    bulkSigla:     string | null;
}

/**
 * Monta o nome de exibição do produto com 4 níveis de fallback.
 *
 * Prioridade de volume:
 *   1. volumeValue + unitTypeSigla → "Heineken 600ml"  (estruturado, vem do JOIN unit_types)
 *   2. volumeValue + unit          → "Heineken 600ml"  (fallback campo product_unit_type)
 *   3. só o nome do produto        → "Skol"
 *
 * details NÃO é usado na exibição — serve apenas para busca por texto.
 *
 * Sufixo de embalagem bulk quando isCase=true:
 *   → "Heineken 600ml 24 unidades"  (sem traço; o traço fica no preço ao exibir)
 *
 * A primeira letra do nome do produto é sempre maiúscula.
 */
export function buildProductDisplayName(v: DisplayableVariant, isCase = false): string {
    // Garante que a primeira letra do nome do produto está em maiúscula
    const productName = v.productName
        ? v.productName.charAt(0).toUpperCase() + v.productName.slice(1)
        : v.productName;

    let volLabel = "";

    if (v.volumeValue > 0) {
        // 1) Sigla estruturada (JOIN com unit_types): "ml", "L", "kg" — confiável
        // 2) Fallback: campo unit do produto, mas ignora genéricos "un"/"UN"
        const unitStr = v.unitTypeSigla ?? (
            v.unit && !/^un(d|idade|idades)?$/i.test(v.unit)
                ? v.unit
                : null
        );
        volLabel = unitStr ? ` ${v.volumeValue}${unitStr}` : ` ${v.volumeValue}`;
    }
    // details é usado apenas para busca — não entra na exibição ao cliente

    const baseName = `${productName}${volLabel}`.trim();

    if (!isCase || !v.caseQty) return baseName;

    // Sufixo de embalagem bulk: "N unidades" (sem traço — o traço fica no preço)
    return `${baseName} ${v.caseQty} unidades`;
}

/**
 * Extrai string de volume de um texto livre (campo descricao).
 * Ex: "600" → "600", "350ml" → "350ml", "1L" → "1L", "latinha" → null
 */
export function parseVolumeFromText(text: string): string | null {
    const m = text.trim().match(/^(\d+(?:[.,]\d+)?)\s*(ml|l|litro|litros|g|kg)?\s*$/i);
    if (!m) return null;
    const num     = m[1];
    const rawUnit = m[2] ? m[2].toLowerCase() : "";
    // Normaliza: "litro"/"litros" → "L"; "l" sozinho → "L"; outros mantêm lowercase
    const unit    = rawUnit === "l" || /^litros?$/i.test(rawUnit) ? "L" : rawUnit;
    return unit ? `${num}${unit}` : num;
}

/**
 * Retorna true para strings que são ruído puro como campo de volume.
 * Esses valores NÃO devem ser exibidos ao cliente.
 */
export function isGenericVolumeWord(text: string): boolean {
    const GENERIC = new Set(["ml", "l", "un", "und", "unidade", "unidades", "lata lata", "latinha lata"]);
    return GENERIC.has(text.trim().toLowerCase());
}
