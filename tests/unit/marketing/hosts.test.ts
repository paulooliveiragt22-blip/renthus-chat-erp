import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    accountHref,
    isLegacyAppHostname,
    isMarketingHostname,
    marketingHostAction,
} from "../../../lib/marketing/hosts";

const env = { NEXT_PUBLIC_APP_URL: "https://app.zampell.com.br" };

describe("marketing host", () => {
    it("reconhece o apex e o www", () => {
        assert.equal(isMarketingHostname("www.zampell.com.br", env), true);
        assert.equal(isMarketingHostname("zampell.com.br:443", env), true);
        assert.equal(isLegacyAppHostname("app.renthus.com.br"), true);
        assert.equal(isLegacyAppHostname("app.zampell.com.br"), false);
        assert.equal(isMarketingHostname("app.zampell.com.br", env), false);
    });

    it("manda conta para o app só na vitrine", () => {
        assert.equal(
            accountHref("/login", true, env),
            "https://app.zampell.com.br/login"
        );
        assert.equal(
            accountHref("/signup?plano=pro&periodo=year", true, env),
            "https://app.zampell.com.br/signup?plano=pro&periodo=year"
        );
        assert.equal(accountHref("/login", false, env), "/login");
    });

    it("libera a landing e desvia o resto do painel", () => {
        assert.equal(marketingHostAction("www.zampell.com.br", "/", env).type, "rewrite");
        assert.equal(marketingHostAction("www.zampell.com.br", "/inicio", env).type, "next");
        assert.equal(
            marketingHostAction("www.zampell.com.br", "/api/billing/public-plans", env).type,
            "next"
        );
        assert.equal(marketingHostAction("www.zampell.com.br", "/pdv", env).type, "redirect");
        assert.equal(marketingHostAction("www.zampell.com.br", "/c/loja", env).type, "redirect");
        assert.equal(marketingHostAction("www.zampell.com.br", "/api/orders/list", env).type, "deny");
        assert.equal(marketingHostAction("app.zampell.com.br", "/pdv", env).type, "ignore");
    });
});
