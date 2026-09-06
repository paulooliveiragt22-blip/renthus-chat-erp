import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("B5 customers export gate", () => {
    const src = readFileSync(
        join(process.cwd(), "app/api/admin/customers/route.ts"),
        "utf8"
    );

    it("lista leve exige customers.read; export exige customers.export", () => {
        assert.match(src, /requireCapability\("customers\.read"\)/);
        assert.match(src, /requireCapability\("customers\.export"\)/);
        assert.match(src, /export"\) === "1"/);
        assert.match(src, /customers_export:/);
        assert.doesNotMatch(src, /\.limit\(500\)/);
    });

    it("lista não seleciona cpf_cnpj / notes por default", () => {
        assert.match(src, /LIST_SELECT\s*=/);
        const listBlock = src.slice(src.indexOf("LIST_SELECT"), src.indexOf("EXPORT_SELECT"));
        assert.doesNotMatch(listBlock, /cpf_cnpj/);
        assert.doesNotMatch(listBlock, /notes/);
        assert.doesNotMatch(listBlock, /saldo_devedor/);
    });
});
