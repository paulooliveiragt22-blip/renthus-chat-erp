import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeMenuSlug, parseMenuSlug, slugFromDisplayName } from "../../lib/public-menu/slug";
import { parsePublicMenuRpcPayload } from "../../lib/public-menu/parsePublicMenu";
import {
    buildPublicMenuAbsoluteUrl,
    resolvePublicAppBaseUrl,
} from "../../lib/public-menu/appBaseUrl";
import { buildWebMenuOfferText } from "../../lib/public-menu/menuOfferText";
import { normalizeBrPhone } from "../../lib/public-menu/phone";

describe("public-menu slug", () => {
    it("normaliza acentos e espaços", () => {
        assert.equal(normalizeMenuSlug("Disk Bebidas São Mateus"), "disk-bebidas-sao-mateus");
    });

    it("parseMenuSlug rejeita inválidos", () => {
        assert.equal(parseMenuSlug("").ok, false);
        assert.equal(parseMenuSlug("A").ok, false);
        assert.equal(parseMenuSlug("---").ok, false);
    });

    it("parseMenuSlug aceita slug válido", () => {
        const r = parseMenuSlug("disk-beatriz");
        assert.equal(r.ok, true);
        if (r.ok) assert.equal(r.slug, "disk-beatriz");
    });

    it("slugFromDisplayName gera fallback", () => {
        const s = slugFromDisplayName("Disk Central");
        assert.equal(s, "disk-central");
    });
});

describe("parsePublicMenuRpcPayload", () => {
    it("retorna menu_not_found para payload vazio", () => {
        const r = parsePublicMenuRpcPayload(null);
        assert.deepEqual(r, { ok: false, error: "menu_not_found" });
    });

    it("retorna menu_inactive quando flag no payload", () => {
        const r = parsePublicMenuRpcPayload({ error: "menu_inactive" });
        assert.deepEqual(r, { ok: false, error: "menu_inactive" });
    });

    it("agrupa itens por categoria com contrato camelCase", () => {
        const r = parsePublicMenuRpcPayload({
            store: {
                company_id: "11111111-1111-1111-1111-111111111111",
                slug: "disk-teste",
                display_name: "Disk Teste",
                tagline: null,
                logo_url: null,
                whatsapp_phone: "+5565999999999",
                city: "Sorriso",
                state: "MT",
                is_active: true,
            },
            items: [
                {
                    embalagem_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                    product_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    category_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    category_name: "Cervejas",
                    name: "Heineken",
                    description: "Long neck",
                    price: "12.50",
                    sigla: "UN",
                    thumbnail_url: "https://example.com/t.jpg",
                    image_url: "https://example.com/i.jpg",
                    in_stock: true,
                    category_sort: 0,
                },
                {
                    embalagem_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                    product_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
                    category_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                    category_name: "Cervejas",
                    name: "Brahma",
                    description: null,
                    price: 8,
                    sigla: "UN",
                    thumbnail_url: null,
                    image_url: null,
                    in_stock: false,
                    category_sort: 0,
                },
            ],
        });

        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.menu.store.displayName, "Disk Teste");
        assert.equal(r.menu.store.whatsappPhone, "+5565999999999");
        assert.equal(r.menu.itemCount, 2);
        assert.equal(r.menu.categories.length, 1);
        assert.equal(r.menu.categories[0]!.name, "Cervejas");
        assert.equal(r.menu.categories[0]!.items[0]!.price, 12.5);
        assert.equal(r.menu.categories[0]!.items[0]!.currency, "BRL");
        assert.equal(r.menu.categories[0]!.items[0]!.embalagemId, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    });
});

describe("public-menu app URL + offer text", () => {
    it("resolvePublicAppBaseUrl prefere NEXT_PUBLIC_APP_URL", () => {
        assert.equal(
            resolvePublicAppBaseUrl({
                NEXT_PUBLIC_APP_URL: "https://app.exemplo.com/",
                VERCEL_URL: "other.vercel.app",
            }),
            "https://app.exemplo.com"
        );
    });

    it("buildPublicMenuAbsoluteUrl inclui utm_source", () => {
        const url = buildPublicMenuAbsoluteUrl("disk-teste", {
            utmSource: "whatsapp",
            env: { NEXT_PUBLIC_APP_URL: "https://app.renthus.com.br" },
        });
        const parsed = new URL(url);
        assert.equal(parsed.origin + parsed.pathname, "https://app.renthus.com.br/c/disk-teste");
        assert.equal(parsed.searchParams.get("utm_source"), "whatsapp");
    });

    it("buildPublicMenuAbsoluteUrl anexa token wm", () => {
        const url = buildPublicMenuAbsoluteUrl("disk-teste", {
            utmSource: "whatsapp",
            wmToken: "abc.def",
            env: { NEXT_PUBLIC_APP_URL: "https://app.renthus.com.br" },
        });
        assert.equal(new URL(url).searchParams.get("wm"), "abc.def");
    });

    it("buildWebMenuOfferText inclui URL e nome", () => {
        const text = buildWebMenuOfferText({
            url: "https://app.renthus.com.br/c/x",
            companyName: "Disk X",
        });
        assert.ok(text.includes("Disk X"));
        assert.ok(text.includes("https://app.renthus.com.br/c/x"));
    });

    it("normalizeBrPhone aceita celular com DDD", () => {
        const r = normalizeBrPhone("(11) 98888-7777");
        assert.equal(r.ok, true);
        if (r.ok) {
            assert.equal(r.phoneE164, "+5511988887777");
            assert.equal(r.digits, "11988887777");
        }
    });
});
