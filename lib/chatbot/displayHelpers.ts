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
 *   3. details que parece volume   → "Skol 600"        (parse do campo livre)
 *   4. details com sentido         → "Skol Latinha"    (texto livre não genérico)
 *   5. só o nome do produto        → "Skol"
 *
 * Sufixo de embalagem bulk quando isCase=true:
 *   CX   → " (cx Nun)"
 *   FARD → " (fardo Nun)"
 *   PAC  → " (pct Nun)"
 */
export function buildProductDisplayName(v: DisplayableVariant, isCase = false): string {
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
    } else if (v.details) {
        // 3) Tenta parsear o campo livre como volume numérico
        const parsed = parseVolumeFromText(v.details);
        if (parsed) {
            volLabel = ` ${parsed}`;
        } else if (!isGenericVolumeWord(v.details)) {
            // 4) Texto com sentido ("latinha", "trezentinha", "garrafa")
            const cap = v.details.trim();
            volLabel = ` ${cap.charAt(0).toUpperCase()}${cap.slice(1).toLowerCase()}`;
        }
        // 5) Genérico ruído ("ml", "un", "unidade") → omite
    }

    const baseName = `${v.productName}${volLabel}`.trim();

    if (!isCase || !v.caseQty) return baseName;

    // Sufixo de embalagem bulk
    const sigla = v.bulkSigla ?? "CX";
    switch (sigla) {
        case "FARD": return `${baseName} (fardo ${v.caseQty}un)`;
        case "PAC":  return `${baseName} (pct ${v.caseQty}un)`;
        default:     return `${baseName} (cx ${v.caseQty}un)`;
    }
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
