import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("B7 print agent key rotation", () => {
    it("keys route expõe PATCH rotate e DELETE scramble", () => {
        const src = readFileSync(join(process.cwd(), "app/api/agent/keys/route.ts"), "utf8");
        assert.match(src, /export async function PATCH/);
        assert.match(src, /rotatePrintAgentApiKey/);
        assert.match(src, /revokePrintAgentApiKey/);
        assert.match(src, /mutating:\s*true/);
        assert.doesNotMatch(src, /console\.(log|info|debug).*api_key/);
    });

    it("verifyAgentByApiKey delega ao verificador com is_active", () => {
        const src = readFileSync(join(process.cwd(), "lib/print/agents.ts"), "utf8");
        assert.match(src, /verifyPrintAgentApiKey/);
        assert.doesNotMatch(src, /bcrypt\.compare/);
    });

    it("generatePrintAgentKeyMaterial usa prefixo rpa_", async () => {
        const { generatePrintAgentKeyMaterial } = await import(
            "../../lib/print/rotatePrintAgentKey"
        );
        const m = await generatePrintAgentKeyMaterial();
        assert.match(m.apiKeyPlain, /^rpa_[0-9a-f]{80}$/);
        assert.equal(m.prefix.length, 8);
        assert.ok(m.hash.length > 20);
    });
});
