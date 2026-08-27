import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    formatMetaClientError,
    parseMetaGraphError,
} from "@/lib/whatsapp-templates/metaGraphError";

describe("metaGraphError", () => {
    it("não sugere App Review em erro de parâmetro (#100)", () => {
        const parsed = parseMetaGraphError(
            {
                error: {
                    message: "(#100) Param name already exists for this WABA",
                    code: 100,
                    type: "OAuthException",
                },
            },
            400
        );
        assert.match(parsed.error, /already exists/i);
        assert.equal(parsed.hint, undefined);
    });

    it("sugere App Review só em código de permissão", () => {
        const parsed = parseMetaGraphError(
            {
                error: {
                    message: "(#200) Permissions error",
                    code: 200,
                },
            },
            403
        );
        assert.match(parsed.hint ?? "", /whatsapp_business_management/);
    });

    it("formatMetaClientError prioriza mensagem Meta", () => {
        assert.equal(
            formatMetaClientError(
                "(#100) Invalid parameter",
                undefined,
                "fallback"
            ),
            "(#100) Invalid parameter"
        );
        assert.equal(
            formatMetaClientError(
                "(#200) Permissions error",
                "Permissão whatsapp_business_management / App Review pode estar pendente.",
                "fallback"
            ),
            "(#200) Permissions error — Permissão whatsapp_business_management / App Review pode estar pendente."
        );
    });
});
