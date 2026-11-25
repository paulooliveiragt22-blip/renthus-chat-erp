import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adminRouteBlocked } from "../../src/service/domain/adminRoutes";

describe("rotas do painel por modo", () => {
    it("serviço não abre tela de delivery", () => {
        assert.equal(adminRouteBlocked("service", "/pedidos"), true);
        assert.equal(adminRouteBlocked("service", "/pdv/caixa"), true);
    });

    it("delivery não abre tela de serviço", () => {
        assert.equal(adminRouteBlocked("delivery", "/agenda"), true);
        assert.equal(adminRouteBlocked("delivery", "/cards/1"), true);
    });

    it("whatsapp e configurações ficam nos dois modos", () => {
        assert.equal(adminRouteBlocked("service", "/whatsapp"), false);
        assert.equal(adminRouteBlocked("delivery", "/configuracoes"), false);
        assert.equal(adminRouteBlocked("service", "/atendimento"), false);
        assert.equal(adminRouteBlocked("delivery", "/pedidos"), false);
    });
});
