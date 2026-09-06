/**
 * IDOR regression — association checks + RPC tenant guards (static).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("IDOR tenant association guards", () => {
    const root = process.cwd();

    it("RPC admin upsert rejeita customer/embalagem cross-tenant", () => {
        const sql = readFileSync(
            join(root, "supabase/migrations/20260906190000_idor_rpc_admin_upsert_tenant_checks.sql"),
            "utf8"
        );
        assert.match(sql, /customer_not_in_company/);
        assert.match(sql, /produto_embalagem_not_in_company/);
        assert.match(sql, /driver_not_in_company/);
        assert.match(sql, /produto_embalagens pe/);
        assert.match(sql, /pe\.company_id = p_company_id/);
    });

    it("PATCH admin/orders valida customer_id na company", () => {
        const src = readFileSync(join(root, "app/api/admin/orders/route.ts"), "utf8");
        assert.match(src, /assertCustomerInCompany/);
        assert.match(src, /customer_not_in_company|cust\.error/);
    });

    it("address POSTs validam customer na company", () => {
        const a = readFileSync(join(root, "app/api/admin/order-addresses/route.ts"), "utf8");
        const b = readFileSync(
            join(root, "app/api/admin/customers/[id]/addresses/route.ts"),
            "utf8"
        );
        assert.match(a, /assertCustomerInCompany/);
        assert.match(b, /assertCustomerInCompany/);
    });

    it("support create-ticket valida thread/customer", () => {
        const src = readFileSync(join(root, "app/api/support/create-ticket/route.ts"), "utf8");
        assert.match(src, /assertThreadInCompany/);
        assert.match(src, /assertCustomerInCompany/);
    });

    it("push subscribe não sobrescreve endpoint de outro tenant", () => {
        const src = readFileSync(join(root, "app/api/admin/push/subscribe/route.ts"), "utf8");
        assert.match(src, /endpoint_owned/);
        assert.match(src, /existing\.company_id !== companyId/);
    });

    it("check:prod-env exige PLATFORM_ADMIN_IP_ALLOWLIST em strict", () => {
        const src = readFileSync(join(root, "scripts/check-production-env.mjs"), "utf8");
        assert.match(src, /PLATFORM_ADMIN_IP_ALLOWLIST/);
        assert.match(src, /process\.exit\(1\)/);
        const idx = src.indexOf("PLATFORM_ADMIN_IP_ALLOWLIST");
        const slice = src.slice(idx, idx + 500);
        assert.match(slice, /exit\(1\)/);
    });
});
