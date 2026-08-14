import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("produtos embalagem — volume / código / EAN", () => {
    it("migration unique codigo_interno + view case EAN", () => {
        const mig = join(root, "supabase/migrations/20260814190000_produto_embalagens_codigo_interno_uq.sql");
        assert.equal(existsSync(mig), true);
        const sql = read("supabase/migrations/20260814190000_produto_embalagens_codigo_interno_uq.sql");
        assert.match(sql, /uq_produto_embalagens_company_codigo_interno/);
        assert.match(sql, /case_codigo_barras_ean/);
        assert.match(sql, /volume_formatado/);
        assert.match(sql, /gerar_proximo_codigo_interno/);
    });

    it("lista: coluna EAN opcional + volume_formatado", () => {
        const ui = read("app/(admin)/produtos/lista/ListaClient.tsx");
        assert.match(ui, /showEan/);
        assert.match(ui, /volume_formatado/);
        assert.match(ui, /case_codigo_barras_ean/);
        assert.match(ui, /EAN \{isUnSigla/);
    });

    it("PDV scan continua por codigo_interno / EAN", () => {
        const pdv = read("app/(admin)/pdv/page.tsx");
        assert.match(pdv, /codigo_interno/);
        assert.match(pdv, /codigo_barras_ean/);
        assert.match(pdv, /looksLikeScanCode/);
    });
});
