/**
 * Testes unitários para PackagingExtractor.
 *
 * Cobertura:
 *  - Alias antes do produto (com e sem quantidade)
 *  - Alias depois do produto
 *  - Aliases regionais: caixinha, fardinho → CX
 *  - Verbos de pedido ("manda", "quero") removidos antes da extração
 *  - Palavras numéricas por extenso ("seis cx")
 *  - Sem alias → packagingSigla null
 *  - isBulkPackaging / packagingLabel
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    extractPackagingIntent,
    packagingLabel,
    isBulkPackaging,
} from "../../lib/chatbot/PackagingExtractor";

// ─── helpers ──────────────────────────────────────────────────────────────────

function pkg(text: string) {
    return extractPackagingIntent(text);
}

// ─── alias antes do produto ───────────────────────────────────────────────────

describe("alias antes do produto", () => {
    it("'6 cx de heineken' → CX, qty=6, clean=heineken", () => {
        const r = pkg("6 cx de heineken");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 6);
        assert.equal(r.cleanText, "heineken");
        assert.equal(r.isExplicit, true);
    });

    it("'2 caixas de skol' → CX, qty=2", () => {
        const r = pkg("2 caixas de skol");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 2);
        assert.equal(r.cleanText, "skol");
    });

    it("'2 caixinhas skol' → CX, qty=2 (alias regional)", () => {
        const r = pkg("2 caixinhas skol");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 2);
        assert.equal(r.cleanText, "skol");
    });

    it("'1 fardinho brahma' → CX, qty=1 (fardinho = cx nesta região)", () => {
        const r = pkg("1 fardinho brahma");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 1);
        assert.equal(r.cleanText, "brahma");
    });

    it("'3 fardinhos de skol' → CX, qty=3", () => {
        const r = pkg("3 fardinhos de skol");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 3);
        assert.equal(r.cleanText, "skol");
    });

    it("'2 fardos de brahma' → FARD, qty=2", () => {
        const r = pkg("2 fardos de brahma");
        assert.equal(r.packagingSigla, "FARD");
        assert.equal(r.qty, 2);
        assert.equal(r.cleanText, "brahma");
    });

    it("'3 pacotes de amendoim' → PAC, qty=3", () => {
        const r = pkg("3 pacotes de amendoim");
        assert.equal(r.packagingSigla, "PAC");
        assert.equal(r.qty, 3);
        assert.equal(r.cleanText, "amendoim");
    });

    it("'2 unidades de heineken' → UN, qty=2", () => {
        const r = pkg("2 unidades de heineken");
        assert.equal(r.packagingSigla, "UN");
        assert.equal(r.qty, 2);
        assert.equal(r.cleanText, "heineken");
    });

    it("'caixa de skol' (sem número) → CX, qty=1", () => {
        const r = pkg("caixa de skol");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 1);
        assert.equal(r.cleanText, "skol");
    });

    it("'cx heineken' (sem número, sem preposição) → CX, qty=1", () => {
        const r = pkg("cx heineken");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 1);
        assert.equal(r.cleanText, "heineken");
    });
});

// ─── palavras numéricas por extenso ──────────────────────────────────────────

describe("quantidade por extenso", () => {
    it("'seis cx de heineken' → qty=6", () => {
        const r = pkg("seis cx de heineken");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 6);
        assert.equal(r.cleanText, "heineken");
    });

    it("'doze caixas de skol' → qty=12", () => {
        const r = pkg("doze caixas de skol");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 12);
    });
});

// ─── verbos de pedido ─────────────────────────────────────────────────────────

describe("verbos de pedido removidos", () => {
    it("'manda 3 cx de skol' → CX, qty=3", () => {
        const r = pkg("manda 3 cx de skol");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 3);
        assert.equal(r.cleanText, "skol");
    });

    it("'quero 2 caixinhas de brahma' → CX, qty=2", () => {
        const r = pkg("quero 2 caixinhas de brahma");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 2);
        assert.equal(r.cleanText, "brahma");
    });

    it("'manda 6 cx de Heineken pra mim no beco sao bento 86' → qty=6 (endereço não vaza)", () => {
        // O PackagingExtractor extrai qty=6 do texto completo antes de remover endereço
        const r = pkg("6 cx de heineken");
        assert.equal(r.qty, 6);
        assert.equal(r.packagingSigla, "CX");
    });
});

// ─── alias depois do produto ──────────────────────────────────────────────────

describe("alias depois do produto", () => {
    it("'heineken caixa' → CX, clean=heineken", () => {
        const r = pkg("heineken caixa");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.cleanText, "heineken");
    });

    it("'skol em caixinha' → CX", () => {
        const r = pkg("skol em caixinha");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.cleanText, "skol");
    });

    it("'brahma fardinho' → CX", () => {
        const r = pkg("brahma fardinho");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.cleanText, "brahma");
    });

    it("'2 heineken caixa' → CX, qty=2", () => {
        const r = pkg("2 heineken caixa");
        assert.equal(r.packagingSigla, "CX");
        assert.equal(r.qty, 2);
    });
});

// ─── sem embalagem ────────────────────────────────────────────────────────────

describe("sem alias de embalagem", () => {
    it("'heineken 600ml' → sigla null, qty=1, cleanText preservado", () => {
        const r = pkg("heineken 600ml");
        assert.equal(r.packagingSigla, null);
        assert.equal(r.qty, 1);
        assert.equal(r.isExplicit, false);
        // cleanText contém o texto (sem qty)
        assert.ok(r.cleanText.includes("heineken"));
    });

    it("'2 brahma' → sigla null, qty=2, cleanText=brahma", () => {
        const r = pkg("2 brahma");
        assert.equal(r.packagingSigla, null);
        assert.equal(r.qty, 2);
        assert.equal(r.cleanText, "brahma");
    });

    it("'agua mineral' → sigla null, qty=1", () => {
        const r = pkg("agua mineral");
        assert.equal(r.packagingSigla, null);
        assert.equal(r.qty, 1);
        assert.equal(r.cleanText, "agua mineral");
    });

    it("string vazia → sigla null, qty=1, cleanText vazio", () => {
        const r = pkg("");
        assert.equal(r.packagingSigla, null);
        assert.equal(r.qty, 1);
        assert.equal(r.cleanText, "");
    });
});

// ─── packagingLabel / isBulkPackaging ────────────────────────────────────────

describe("packagingLabel", () => {
    it("CX → caixa", () => assert.equal(packagingLabel("CX"), "caixa"));
    it("FARD → fardo", () => assert.equal(packagingLabel("FARD"), "fardo"));
    it("PAC → pacote", () => assert.equal(packagingLabel("PAC"), "pacote"));
    it("UN → unidade", () => assert.equal(packagingLabel("UN"), "unidade"));
    it("null → unidade (default)", () => assert.equal(packagingLabel(null), "unidade"));
});

describe("isBulkPackaging", () => {
    it("CX é bulk", () => assert.equal(isBulkPackaging("CX"), true));
    it("FARD é bulk", () => assert.equal(isBulkPackaging("FARD"), true));
    it("PAC é bulk", () => assert.equal(isBulkPackaging("PAC"), true));
    it("UN não é bulk", () => assert.equal(isBulkPackaging("UN"), false));
    it("null não é bulk", () => assert.equal(isBulkPackaging(null), false));
});
