import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildDeliveryCoverageReply,
    extractNeighborhoodFromDeliveryFaq,
} from "../../src/pro/pipeline/deliveryCoverageFaq";

describe("deliveryCoverageFaq", () => {
    it("extrai bairro de perguntas comuns", () => {
        assert.equal(extractNeighborhoodFromDeliveryFaq("vocês entregam no Centro?"), "Centro");
        assert.equal(extractNeighborhoodFromDeliveryFaq("entregam em Vila Romana"), "Vila Romana");
        assert.equal(extractNeighborhoodFromDeliveryFaq("atendem na Jardim Primavera?"), "Jardim Primavera");
        assert.equal(extractNeighborhoodFromDeliveryFaq("quero 2 heineken"), null);
    });

    it("zona desligada → atende cidade inteira", () => {
        const text = buildDeliveryCoverageReply({
            neighborhood: "Centro",
            served: true,
            serviceByZone: false,
            serviceCity: "Sorriso",
        });
        assert.match(text, /toda a cidade/i);
        assert.match(text, /Sorriso/);
    });

    it("zona ligada e atende → sim amigável", () => {
        const text = buildDeliveryCoverageReply({
            neighborhood: "Centro",
            served: true,
            serviceByZone: true,
            serviceCity: "Sorriso",
        });
        assert.match(text, /Sim!/i);
        assert.match(text, /Centro/);
        assert.doesNotMatch(text, /não entregamos/i);
    });

    it("zona ligada e fora → não amigável", () => {
        const text = buildDeliveryCoverageReply({
            neighborhood: "Zona Rural",
            served: false,
            serviceByZone: true,
            serviceCity: "Sorriso",
        });
        assert.match(text, /não entregamos/i);
        assert.match(text, /Zona Rural/);
    });
});
