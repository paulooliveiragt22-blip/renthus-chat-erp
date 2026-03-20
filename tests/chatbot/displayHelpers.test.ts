/**
 * Testes unitários para buildProductDisplayName.
 *
 * Cobre os 4 níveis de fallback de volume e os sufixos de embalagem.
 * Garante em especial que "product_unit_type = 'unidade'" NÃO aparece
 * como "600unidade" (o bug que foi corrigido).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildProductDisplayName,
    parseVolumeFromText,
    isGenericVolumeWord,
    type DisplayableVariant,
} from "../../lib/chatbot/displayHelpers";

// ─── helper ───────────────────────────────────────────────────────────────────

function v(overrides: Partial<DisplayableVariant> = {}): DisplayableVariant {
    return {
        productName:   "Heineken",
        volumeValue:   0,
        unit:          "un",
        unitTypeSigla: null,
        details:       null,
        caseQty:       null,
        bulkSigla:     null,
        ...overrides,
    };
}

// ─── Nível 1: volumeValue + unitTypeSigla ─────────────────────────────────────

describe("nível 1 — volumeValue + unitTypeSigla (estruturado)", () => {
    it("600ml → 'Heineken 600ml'", () => {
        assert.equal(buildProductDisplayName(v({ volumeValue: 600, unitTypeSigla: "ml" })), "Heineken 600ml");
    });

    it("1L → 'Água 1L'", () => {
        assert.equal(buildProductDisplayName(v({ productName: "Água", volumeValue: 1, unitTypeSigla: "L" })), "Água 1L");
    });

    it("500g → 'Amendoim 500g'", () => {
        assert.equal(buildProductDisplayName(v({ productName: "Amendoim", volumeValue: 500, unitTypeSigla: "g" })), "Amendoim 500g");
    });
});

// ─── Nível 2: volumeValue + unit (fallback campo produto) ─────────────────────

describe("nível 2 — volumeValue + unit (sem unitTypeSigla)", () => {
    it("unit='ml', sem sigla → usa unit como fallback", () => {
        assert.equal(
            buildProductDisplayName(v({ volumeValue: 350, unit: "ml", unitTypeSigla: null })),
            "Heineken 350ml"
        );
    });

    it("unit='unidade' → NÃO exibe 'unidade' (bug corrigido: nunca mostrar '600unidade')", () => {
        const name = buildProductDisplayName(v({ volumeValue: 600, unit: "unidade", unitTypeSigla: null }));
        assert.ok(!name.includes("unidade"), `Nome contém 'unidade': "${name}"`);
        assert.equal(name, "Heineken 600");
    });

    it("unit='UN' → NÃO exibe 'UN'", () => {
        const name = buildProductDisplayName(v({ volumeValue: 350, unit: "UN", unitTypeSigla: null }));
        assert.ok(!name.includes("UN"), `Nome contém 'UN': "${name}"`);
        assert.equal(name, "Heineken 350");
    });

    it("unit='un' → NÃO exibe 'un'", () => {
        const name = buildProductDisplayName(v({ volumeValue: 473, unit: "un", unitTypeSigla: null }));
        assert.equal(name, "Heineken 473");
    });
});

// ─── Nível 3: details como volume ────────────────────────────────────────────

describe("nível 3 — details parseable como volume (volumeValue=0)", () => {
    it("details='600' → 'Heineken 600'", () => {
        assert.equal(buildProductDisplayName(v({ details: "600" })), "Heineken 600");
    });

    it("details='350ml' → 'Heineken 350ml'", () => {
        assert.equal(buildProductDisplayName(v({ details: "350ml" })), "Heineken 350ml");
    });

    it("details='1L' → 'Heineken 1L'", () => {
        assert.equal(buildProductDisplayName(v({ details: "1L" })), "Heineken 1L");
    });

    it("details='1litro' → 'Heineken 1L'", () => {
        assert.equal(buildProductDisplayName(v({ details: "1litro" })), "Heineken 1L");
    });
});

// ─── Nível 4: details com sentido (não numérico, não genérico) ────────────────

describe("nível 4 — details com sentido textual", () => {
    it("details='latinha' → 'Brahma Latinha'", () => {
        assert.equal(
            buildProductDisplayName(v({ productName: "Brahma", details: "latinha" })),
            "Brahma Latinha"
        );
    });

    it("details='trezentinha' → 'Skol Trezentinha'", () => {
        assert.equal(
            buildProductDisplayName(v({ productName: "Skol", details: "trezentinha" })),
            "Skol Trezentinha"
        );
    });

    it("details='long neck' → 'Heineken Long neck'", () => {
        assert.equal(buildProductDisplayName(v({ details: "long neck" })), "Heineken Long neck");
    });
});

// ─── Nível 5: só o nome ───────────────────────────────────────────────────────

describe("nível 5 — só o nome (sem volume, sem details útil)", () => {
    it("sem nada → só o nome do produto", () => {
        assert.equal(buildProductDisplayName(v()), "Heineken");
    });

    it("details='unidade' (genérico) → só o nome", () => {
        assert.equal(buildProductDisplayName(v({ details: "unidade" })), "Heineken");
    });

    it("details='ml' (genérico) → só o nome", () => {
        assert.equal(buildProductDisplayName(v({ details: "ml" })), "Heineken");
    });

    it("details='un' (genérico) → só o nome", () => {
        assert.equal(buildProductDisplayName(v({ details: "un" })), "Heineken");
    });

    it("details='lata lata' (genérico) → só o nome", () => {
        assert.equal(buildProductDisplayName(v({ details: "lata lata" })), "Heineken");
    });
});

// ─── Sufixo de embalagem bulk ─────────────────────────────────────────────────

describe("sufixo de embalagem (isCase=true)", () => {
    it("CX 24un → 'Heineken 600ml (cx 24un)'", () => {
        assert.equal(
            buildProductDisplayName(v({ volumeValue: 600, unitTypeSigla: "ml", caseQty: 24, bulkSigla: "CX" }), true),
            "Heineken 600ml (cx 24un)"
        );
    });

    it("FARD 12un → 'Skol 350ml (fardo 12un)'", () => {
        assert.equal(
            buildProductDisplayName(v({ productName: "Skol", volumeValue: 350, unitTypeSigla: "ml", caseQty: 12, bulkSigla: "FARD" }), true),
            "Skol 350ml (fardo 12un)"
        );
    });

    it("PAC 15un → 'Amendoim (pct 15un)' (sem volume)", () => {
        assert.equal(
            buildProductDisplayName(v({ productName: "Amendoim", caseQty: 15, bulkSigla: "PAC" }), true),
            "Amendoim (pct 15un)"
        );
    });

    it("isCase=true mas caseQty=null → sem sufixo", () => {
        assert.equal(
            buildProductDisplayName(v({ volumeValue: 600, unitTypeSigla: "ml", caseQty: null, bulkSigla: "CX" }), true),
            "Heineken 600ml"
        );
    });

    it("isCase=false → sem sufixo mesmo com caseQty", () => {
        assert.equal(
            buildProductDisplayName(v({ volumeValue: 600, unitTypeSigla: "ml", caseQty: 24, bulkSigla: "CX" }), false),
            "Heineken 600ml"
        );
    });

    it("bulkSigla=null com isCase=true → usa CX como default", () => {
        const name = buildProductDisplayName(v({ volumeValue: 600, unitTypeSigla: "ml", caseQty: 24, bulkSigla: null }), true);
        assert.equal(name, "Heineken 600ml (cx 24un)");
    });
});

// ─── parseVolumeFromText ──────────────────────────────────────────────────────

describe("parseVolumeFromText", () => {
    it("'600' → '600'",   () => assert.equal(parseVolumeFromText("600"),   "600"));
    it("'350ml' → '350ml'", () => assert.equal(parseVolumeFromText("350ml"), "350ml"));
    it("'1L' → '1L'",    () => assert.equal(parseVolumeFromText("1L"),   "1L"));
    it("'1litro' → '1L'", () => assert.equal(parseVolumeFromText("1litro"), "1L"));
    it("'500g' → '500g'", () => assert.equal(parseVolumeFromText("500g"), "500g"));
    it("'latinha' → null", () => assert.equal(parseVolumeFromText("latinha"), null));
    it("'long neck' → null", () => assert.equal(parseVolumeFromText("long neck"), null));
    it("'' → null",       () => assert.equal(parseVolumeFromText(""),   null));
});

// ─── isGenericVolumeWord ──────────────────────────────────────────────────────

describe("isGenericVolumeWord", () => {
    it("'unidade' é genérico", () => assert.equal(isGenericVolumeWord("unidade"), true));
    it("'ml' é genérico",     () => assert.equal(isGenericVolumeWord("ml"),      true));
    it("'un' é genérico",     () => assert.equal(isGenericVolumeWord("un"),      true));
    it("'latinha' NÃO é genérico", () => assert.equal(isGenericVolumeWord("latinha"), false));
    it("'600ml' NÃO é genérico",   () => assert.equal(isGenericVolumeWord("600ml"),   false));
    it("case-insensitive: 'UNIDADE'", () => assert.equal(isGenericVolumeWord("UNIDADE"), true));
});
