import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    filterAddressesForCustomer,
    type CachedCustomerAddress,
} from "../../lib/offline/application/loadCachedCustomerAddresses";
import { resolveDeliveryAddress } from "../../lib/orders/resolveDeliveryAddress";

const rows: CachedCustomerAddress[] = [
    {
        id: "a1",
        customer_id: "c1",
        apelido: "Casa",
        logradouro: "Rua A",
        numero: "10",
        complemento: null,
        bairro: "Centro",
        cidade: "SP",
        estado: "SP",
        cep: "01001000",
        is_principal: false,
    },
    {
        id: "a2",
        customer_id: "c1",
        apelido: "Trabalho",
        logradouro: "Av B",
        numero: "20",
        complemento: null,
        bairro: "Bela Vista",
        cidade: "SP",
        estado: "SP",
        cep: null,
        is_principal: true,
    },
    {
        id: "a3",
        customer_id: "c2",
        apelido: "Outro",
        logradouro: "Rua C",
        numero: null,
        complemento: null,
        bairro: null,
        cidade: null,
        estado: null,
        cep: null,
        is_principal: true,
    },
];

describe("filterAddressesForCustomer", () => {
    it("filtra por customer_id e prioriza principal", () => {
        const list = filterAddressesForCustomer(rows, "c1");
        assert.equal(list.length, 2);
        assert.equal(list[0]?.id, "a2");
        assert.equal(list[0]?.apelido, "Trabalho");
        assert.equal(list[1]?.id, "a1");
    });

    it("retorna vazio se cliente sem cache", () => {
        assert.equal(filterAddressesForCustomer(rows, "missing").length, 0);
    });
});

describe("resolveDeliveryAddress (offline-friendly)", () => {
    it("saved → linha formatada", () => {
        const r = resolveDeliveryAddress({
            isPickup: false,
            mode: "saved",
            freeText: "",
            selectedAddrId: "a1",
            saved: filterAddressesForCustomer(rows, "c1"),
            newForm: {
                apelido: "",
                logradouro: "",
                numero: "",
                complemento: "",
                bairro: "",
                cidade: "",
                estado: "",
                cep: "",
            },
        });
        assert.equal(r.ok, true);
        if (r.ok) assert.match(r.address, /Rua A/);
    });

    it("new → exige núcleo delivery e formata linha", () => {
        const bad = resolveDeliveryAddress({
            isPickup: false,
            mode: "new",
            freeText: "",
            selectedAddrId: null,
            saved: [],
            newForm: {
                apelido: "Temp",
                logradouro: "Rua Offline",
                numero: "",
                complemento: "",
                bairro: "Centro",
                cidade: "Campinas",
                estado: "SP",
                cep: "",
            },
        });
        assert.equal(bad.ok, false);

        const r = resolveDeliveryAddress({
            isPickup: false,
            mode: "new",
            freeText: "",
            selectedAddrId: null,
            saved: [],
            newForm: {
                apelido: "Temp",
                logradouro: "Rua Offline",
                numero: "1",
                complemento: "",
                bairro: "Centro",
                cidade: "Campinas",
                estado: "SP",
                cep: "",
            },
        });
        assert.equal(r.ok, true);
        if (r.ok) assert.match(r.address, /Rua Offline/);
    });

    it("pickup → endereço vazio", () => {
        const r = resolveDeliveryAddress({
            isPickup: true,
            mode: "free",
            freeText: "qualquer",
            selectedAddrId: null,
            saved: [],
            newForm: {
                apelido: "",
                logradouro: "",
                numero: "",
                complemento: "",
                bairro: "",
                cidade: "",
                estado: "",
                cep: "",
            },
        });
        assert.deepEqual(r, { ok: true, address: "" });
    });
});
