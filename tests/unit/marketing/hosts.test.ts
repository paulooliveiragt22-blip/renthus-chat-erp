import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    accountHref,
    isMarketingHostname,
    marketingHostAction,
} from "../../../lib/marketing/hosts";
import { isAdminShellStandalone } from "../../../lib/ui/adminShellMode";

const env = { NEXT_PUBLIC_APP_URL: "https://app.zampell.com.br" };

describe("marketing host", () => {
    it("reconhece o apex e o www", () => {
        assert.equal(isMarketingHostname("www.zampell.com.br", env), true);
        assert.equal(isMarketingHostname("zampell.com.br:443", env), true);
        assert.equal(isMarketingHostname("app.zampell.com.br", env), false);
        assert.equal(isMarketingHostname("app.renthus.com.br", env), false);
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
            marketingHostAction("www.zampell.com.br", "/marketing/loops/cardapio.mp4", env).type,
            "next"
        );
        assert.equal(
            marketingHostAction("www.zampell.com.br", "/api/billing/public-plans", env).type,
            "next"
        );
        assert.equal(
            marketingHostAction("www.zampell.com.br", "/api/public/site-chat", env).type,
            "next"
        );
        assert.equal(marketingHostAction("www.zampell.com.br", "/chat/0113a3fe-e224-49ff-81c6-f8b9df556267", env).type, "next");
        const attendance = marketingHostAction("www.zampell.com.br", "/atendimento", env);
        assert.equal(attendance.type, "rewrite");
        if (attendance.type === "rewrite") assert.equal(attendance.pathname, "/agente");
        assert.equal(marketingHostAction("www.zampell.com.br", "/agente", env).type, "next");
        assert.equal(marketingHostAction("app.zampell.com.br", "/atendimento", env).type, "ignore");
        assert.equal(marketingHostAction("www.zampell.com.br", "/pdv", env).type, "redirect");
        assert.equal(marketingHostAction("www.zampell.com.br", "/c/loja", env).type, "redirect");
        assert.equal(marketingHostAction("www.zampell.com.br", "/api/orders/list", env).type, "deny");
        assert.equal(marketingHostAction("app.zampell.com.br", "/pdv", env).type, "ignore");
        assert.equal(marketingHostAction("app.renthus.com.br", "/pdv", env).type, "ignore");
    });

    it("esconde o painel na vitrine mesmo com a URL em /", () => {
        assert.equal(isAdminShellStandalone("/", "www.zampell.com.br", env), true);
        assert.equal(isAdminShellStandalone("/", "zampell.com.br", env), true);
        assert.equal(isAdminShellStandalone("/", "app.zampell.com.br", env), false);
        assert.equal(isAdminShellStandalone("/inicio", "app.zampell.com.br", env), true);
        assert.equal(isAdminShellStandalone("/chat/aec7b002-dbd8-4ee8-b97e-9abd40112d05", "app.zampell.com.br", env), true);
        assert.equal(isAdminShellStandalone("/agente", "app.zampell.com.br", env), true);
        assert.equal(isAdminShellStandalone("/atendimento", "app.zampell.com.br", env), false);
        assert.equal(isAdminShellStandalone("/pdv", "app.renthus.com.br", env), false);
        assert.equal(isAdminShellStandalone("/oauth/google-done", "app.zampell.com.br", env), true);
    });
});
