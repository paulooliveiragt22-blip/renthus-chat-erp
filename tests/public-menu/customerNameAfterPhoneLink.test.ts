import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickCustomerNameAfterPhoneLink } from "../../lib/public-menu/customerNameAfterPhoneLink";

describe("pickCustomerNameAfterPhoneLink", () => {
    it("merge: preserva nome do cadastro existente", () => {
        assert.equal(
            pickCustomerNameAfterPhoneLink({
                existingName: "Maria Silva",
                formName: null,
                channelName: "@maria.ig",
            }),
            "Maria Silva"
        );
    });

    it("prioriza nome digitado no form", () => {
        assert.equal(
            pickCustomerNameAfterPhoneLink({
                existingName: "Maria Silva",
                formName: "Maria S.",
                channelName: "@maria.ig",
            }),
            "Maria S."
        );
    });

    it("enriquece cadastro genérico com nome do canal", () => {
        assert.equal(
            pickCustomerNameAfterPhoneLink({
                existingName: "Cliente",
                formName: null,
                channelName: "Ana Costa",
            }),
            "Ana Costa"
        );
    });
});
