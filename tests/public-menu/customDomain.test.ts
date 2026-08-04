import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    isAppApexHost,
    normalizeCustomDomainInput,
    normalizeMenuHost,
    slugFromMenuSubdomainHost,
} from "../../lib/public-menu/customDomain";
import { resolveMenuHostRewrite } from "../../lib/public-menu/menuHostRewrite";
import { buildPublicMenuAbsoluteUrl } from "../../lib/public-menu/appBaseUrl";

describe("customDomain F4.3", () => {
    it("normaliza host e domínio", () => {
        assert.equal(normalizeMenuHost("Cardapio.Loja.COM.BR:443"), "cardapio.loja.com.br");
        const norm = normalizeCustomDomainInput("https://www.cardapio.loja.com.br/path");
        assert.equal(norm.ok, true);
        if (norm.ok) assert.equal(norm.host, "cardapio.loja.com.br");
        assert.equal(normalizeCustomDomainInput("not a domain").ok, false);
    });

    it("resolve slug do subdomínio menu", () => {
        const env = { NEXT_PUBLIC_MENU_BASE_DOMAIN: "renthus.app" };
        assert.equal(slugFromMenuSubdomainHost("disk-bebidas.renthus.app", env), "disk-bebidas");
        assert.equal(slugFromMenuSubdomainHost("app.renthus.com.br", env), null);
        assert.equal(isAppApexHost("app.renthus.com.br", env), true);
    });

    it("rewrite só na raiz do vanity host", async () => {
        const env = { NEXT_PUBLIC_MENU_BASE_DOMAIN: "renthus.app" };
        const hit = await resolveMenuHostRewrite({
            host: "disk-bebidas.renthus.app",
            pathname: "/",
            env,
        });
        assert.deepEqual(hit, {
            rewrite: true,
            slug: "disk-bebidas",
            pathname: "/c/disk-bebidas",
        });

        const skipApi = await resolveMenuHostRewrite({
            host: "disk-bebidas.renthus.app",
            pathname: "/api/public/menu/x",
            env,
        });
        assert.equal(skipApi.rewrite, false);
    });

    it("rewrite custom domain via lookup", async () => {
        const hit = await resolveMenuHostRewrite({
            host: "cardapio.loja.com.br",
            pathname: "/",
            env: {},
            lookupCustomDomainSlug: async () => "minha-loja",
        });
        assert.equal(hit.rewrite, true);
        if (hit.rewrite) assert.equal(hit.pathname, "/c/minha-loja");
    });

    it("preferência de URL: custom > subdomínio > path", () => {
        const custom = buildPublicMenuAbsoluteUrl("loja", {
            customDomain: "cardapio.loja.com.br",
            customDomainVerified: true,
            env: { NEXT_PUBLIC_MENU_BASE_DOMAIN: "renthus.app" },
        });
        assert.equal(custom, "https://cardapio.loja.com.br/");

        const sub = buildPublicMenuAbsoluteUrl("loja", {
            env: { NEXT_PUBLIC_MENU_BASE_DOMAIN: "renthus.app" },
        });
        assert.equal(sub, "https://loja.renthus.app/");

        const path = buildPublicMenuAbsoluteUrl("loja", {
            preferPath: true,
            env: {
                NEXT_PUBLIC_APP_URL: "https://app.renthus.com.br",
                NEXT_PUBLIC_MENU_BASE_DOMAIN: "renthus.app",
            },
        });
        assert.equal(path, "https://app.renthus.com.br/c/loja");
    });
});
