import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { omitCampaignPhones, parseCampaignPhones } from "../../lib/campaigns/parsePhones";

describe("números da campanha", () => {
    it("aceita o WhatsApp com ou sem 55", () => {
        assert.deepEqual(parseCampaignPhones("65999990000\n+55 65 98888-0000"), [
            "+5565999990000",
            "+5565988880000",
        ]);
    });

    it("separa uma linha com nome e dois números", () => {
        assert.deepEqual(
            parseCampaignPhones("João 65 99999-0000, Maria 65988880000"),
            ["+5565999990000", "+5565988880000"]
        );
    });

    it("não repete o mesmo número", () => {
        assert.deepEqual(parseCampaignPhones("65999990000\n(65) 99999-0000"), ["+5565999990000"]);
    });

    it("tira da leva o número excluído", () => {
        const kept = omitCampaignPhones(
            [
                { phoneE164: "+5565999990000" },
                { phoneE164: "+5565988880000" },
            ],
            ["65 99999-0000"]
        );
        assert.deepEqual(kept, [{ phoneE164: "+5565988880000" }]);
    });
});
