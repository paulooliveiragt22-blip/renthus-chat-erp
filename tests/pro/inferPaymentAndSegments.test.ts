import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    inferPaymentMethodFromText,
    inferUseSavedAddressFromText,
} from "../../src/pro/pipeline/inferPaymentFromText";
import { parseMultiItemOrderSegments } from "../../src/pro/pipeline/parseMultiItemOrderSegments";
import { stripInternalCatalogIdsFromCustomerText } from "../../src/pro/adapters/ai/sanitizeAiVisibleOrderClaims";

describe("inferPaymentMethodFromText", () => {
    it("detecta pix", () => {
        assert.equal(
            inferPaymentMethodFromText("pagamento no pix no mesmo endereco"),
            "pix"
        );
    });
});

describe("inferUseSavedAddressFromText", () => {
    it("mesmo endereco de sempre", () => {
        assert.equal(
            inferUseSavedAddressFromText("no mesmo endereco de sempre"),
            true
        );
    });
});

describe("parseMultiItemOrderSegments", () => {
    it("quebra pedido tipico em 3 segmentos", () => {
        const segs = parseMultiItemOrderSegments(
            "Ola, quero uma Heineken long neck caixa, um hamburguer rosseiro e um salgadinho no mesmo endereco de sempre, pagamento no pix"
        );
        assert.ok(segs.length >= 3);
        assert.ok(segs.some((s) => /heineken/i.test(s)));
        assert.ok(segs.some((s) => /hamburguer|salgadinho/i.test(s)));
    });
});

describe("stripInternalCatalogIdsFromCustomerText", () => {
    it("remove produto_embalagem_id e uuid", () => {
        const out = stripInternalCatalogIdsFromCustomerText(
            "Entendi! O salgadinho com produto_embalagem_id=0af29f61-fb1c-46b4-9da9-b85df0a12c82 ja esta no rascunho."
        );
        assert.ok(!/0af29f61/i.test(out));
        assert.ok(!/produto_embalagem_id/i.test(out));
        assert.ok(/salgadinho/i.test(out));
    });
});
