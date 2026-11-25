import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loginDestination } from "../../lib/workspace/loginDestination";

describe("destino do login por perfil", () => {
    it("um perfil de serviço não cai em tela de delivery", () => {
        assert.equal(loginDestination("service", "/pedidos"), "/atendimento");
        assert.equal(loginDestination("service", "/pdv"), "/atendimento");
    });

    it("um perfil de delivery não cai em tela de serviço", () => {
        assert.equal(loginDestination("delivery", "/atendimento"), "/pedidos");
        assert.equal(loginDestination("delivery", "/agenda"), "/pedidos");
    });

    it("whatsapp e o destino já compatível permanecem", () => {
        assert.equal(loginDestination("service", "/whatsapp"), "/whatsapp");
        assert.equal(loginDestination("delivery", "/pedidos?status=new"), "/pedidos?status=new");
    });
});
