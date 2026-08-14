import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSlugFromPublicMenuUrl, withMenuSearchParams } from "@/lib/public-menu/menuUrlQuery";

describe("menuUrlQuery", () => {
    it("withMenuSearchParams preserva UTM e acrescenta query", () => {
        const url = "https://app.renthus.com.br/c/disk-teste?utm_source=whatsapp";
        const out = withMenuSearchParams(url, { orders: "1", checkout: "1" });
        const parsed = new URL(out);
        assert.equal(parsed.searchParams.get("utm_source"), "whatsapp");
        assert.equal(parsed.searchParams.get("orders"), "1");
        assert.equal(parsed.searchParams.get("checkout"), "1");
        assert.equal(parsed.pathname, "/c/disk-teste");
    });

    it("withMenuSearchParams ignora valores vazios", () => {
        const url = "https://app.renthus.com.br/c/loja";
        const out = withMenuSearchParams(url, { hc: "", checkout: "1", extra: null });
        const parsed = new URL(out);
        assert.equal(parsed.searchParams.get("checkout"), "1");
        assert.equal(parsed.searchParams.has("hc"), false);
        assert.equal(parsed.searchParams.has("extra"), false);
    });

    it("parseSlugFromPublicMenuUrl lê /c/{slug}", () => {
        assert.equal(
            parseSlugFromPublicMenuUrl("https://app.renthus.com.br/c/Disk-Bebidas?wm=abc"),
            "disk-bebidas"
        );
    });

    it("parseSlugFromPublicMenuUrl lê subdomínio", () => {
        assert.equal(parseSlugFromPublicMenuUrl("https://loja-demo.renthus.app/"), "loja-demo");
    });

    it("parseSlugFromPublicMenuUrl rejeita host genérico", () => {
        assert.equal(parseSlugFromPublicMenuUrl("https://app.renthus.com.br/"), null);
        assert.equal(parseSlugFromPublicMenuUrl("not a url"), null);
    });
});
