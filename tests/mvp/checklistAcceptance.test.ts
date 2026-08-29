/**
 * Aceite do checklist MVP (`docs/CHECKLIST_MVP_LANCAMENTO.md`) — M1..M7 + M0.
 * Combina asserts de domínio + auditoria estática de contratos no repo.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

import {
    assertFulfillmentAllowed,
    loadFulfillmentPolicyFromRow,
    needsFulfillmentChoice,
    resolveSoleFulfillmentType,
} from "../../lib/delivery/fulfillment";
import {
    buildStoreClosedCustomerMessage,
    isStoreOpen,
    sanitizeDeliveryDescription,
    storeHoursFromRow,
} from "../../lib/delivery/hours";
import {
    DEFAULT_AUTO_PRINT_COPIES,
    filterCopiesForFulfillment,
    normalizePrintCopyTypes,
} from "../../lib/print/copyTypes";
import { zonedDayRange, zonedIsoDate } from "../../src/financeiro/domain/dayBounds";
import {
    canInviteRole,
    canManageTeam,
    inviteableRolesFor,
    normalizeCompanyRole,
} from "../../lib/workspace/staffRoles";
import { hasCapability } from "../../lib/workspace/rbac/capabilities";
import { DEFAULT_PROFILE_SEEDS } from "../../lib/workspace/rbac/profileTemplates";

const root = process.cwd();

function read(rel: string): string {
    return readFileSync(join(root, rel), "utf8");
}

function exists(rel: string): boolean {
    return existsSync(join(root, rel));
}

describe("MVP checklist — M1 fulfillment", () => {
    it("policy liga/desliga entrega e retirada", () => {
        const both = loadFulfillmentPolicyFromRow({
            deliveries_enabled: true,
            pickup_enabled: true,
        });
        assert.equal(needsFulfillmentChoice(both, null), true);
        assert.equal(resolveSoleFulfillmentType(both), null);

        const onlyPickup = loadFulfillmentPolicyFromRow({
            deliveries_enabled: false,
            pickup_enabled: true,
        });
        assert.equal(resolveSoleFulfillmentType(onlyPickup), "pickup");
        assert.deepEqual(assertFulfillmentAllowed(onlyPickup, "delivery"), {
            ok: false,
            error: "delivery_disabled",
        });
        assert.deepEqual(assertFulfillmentAllowed(onlyPickup, "pickup"), { ok: true });
    });

    it("código/migration com fulfillment_type e flags", () => {
        assert.match(read("lib/delivery/fulfillment.ts"), /deliveries_enabled/);
        assert.match(read("app/api/delivery/policy/route.ts"), /pickup_enabled/);
        const files = readdirSync(join(root, "supabase", "migrations")).filter(
            (f) => f.includes("fulfillment") || f.includes("delivery")
        );
        assert.ok(files.length > 0, "deve existir migration de fulfillment/delivery");
    });
});

describe("MVP checklist — M2 horário + descrição", () => {
    it("domínio hours: aberto/fechado + overnight + descrição ≤280", () => {
        const day = storeHoursFromRow({
            open_time: "08:00",
            close_time: "22:00",
            timezone: "America/Cuiaba",
        });
        assert.equal(isStoreOpen(Date.parse("2026-08-13T19:00:00.000Z"), day), true);
        assert.equal(isStoreOpen(Date.parse("2026-08-14T06:00:00.000Z"), day), false);

        const overnight = storeHoursFromRow({
            open_time: "18:00",
            close_time: "02:00",
            timezone: "America/Cuiaba",
        });
        assert.equal(isStoreOpen(Date.parse("2026-08-14T05:00:00.000Z"), overnight), true);

        assert.equal(sanitizeDeliveryDescription("a".repeat(300))?.length, 280);
        assert.match(
            buildStoreClosedCustomerMessage(day, Date.parse("2026-08-14T06:00:00.000Z")),
            /não estamos atendendo/i
        );
        assert.match(
            buildStoreClosedCustomerMessage(day, Date.parse("2026-08-14T06:00:00.000Z")),
            /hoje a partir das 08:00/i
        );
    });

    it("fonte canônica company_settings (não business_hours weekday)", () => {
        const hours = read("lib/delivery/hours.ts");
        assert.match(hours, /company_settings/);
        assert.match(hours, /opening_periods/);
        assert.match(hours, /não usar.*business_hours|Não usar.*business_hours/i);
        assert.equal(hours.includes("business_hours"), true); // só na proibição comentada
    });
});

describe("MVP checklist — M3 usuários / RBAC", () => {
    it("roles owner/admin/member; staff legado → member", () => {
        assert.equal(normalizeCompanyRole("staff"), "member");
        assert.deepEqual(inviteableRolesFor("owner"), ["admin", "member"]);
        assert.deepEqual(inviteableRolesFor("admin"), ["member"]);
        assert.equal(canManageTeam("member"), false);
        assert.equal(canInviteRole("admin", "admin"), false);
    });

    it("seeds padrão sem financeiro/settings sensível", () => {
        for (const seed of DEFAULT_PROFILE_SEEDS) {
            assert.equal(hasCapability(seed.capabilities, "financeiro.read"), false);
            assert.equal(hasCapability(seed.capabilities, "settings.company"), false);
        }
    });

    it("APIs e UI de equipe/perfis existem; feature staff_users", () => {
        assert.ok(exists("app/api/admin/users/route.ts"));
        assert.ok(exists("app/api/admin/staff-profiles/route.ts"));
        assert.ok(exists("components/settings/TeamMembersPanel.tsx"));
        assert.ok(exists("components/settings/StaffProfilesPanel.tsx"));
        assert.match(read("components/settings/TeamMembersPanel.tsx"), /staff_users/);
        assert.match(read("app/(admin)/configuracoes/page.tsx"), /StaffProfilesPanel/);
        assert.match(read("app/(admin)/configuracoes/page.tsx"), /Equipe e permissões/);
    });
});

describe("MVP checklist — M4 vias de impressão", () => {
    it("copy types + driver só delivery", () => {
        assert.deepEqual(DEFAULT_AUTO_PRINT_COPIES, ["kitchen", "cashier"]);
        assert.deepEqual(
            filterCopiesForFulfillment(["kitchen", "cashier", "driver"], "pickup"),
            ["kitchen", "cashier"]
        );
        assert.deepEqual(normalizePrintCopyTypes(["driver", "kitchen"]), ["driver", "kitchen"]);
    });

    it("RPC enqueue + settings print_auto_copies no código", () => {
        assert.match(read("lib/server/print/enqueuePrintJob.ts"), /rpc_enqueue_print_job/);
        assert.match(read("app/api/admin/company-settings/route.ts"), /print_auto_copies/);
        assert.match(read("app/(admin)/impressoras/page.tsx"), /print_auto_copies|autoCopies/);
    });
});

describe("MVP checklist — M5 preparing + notify", () => {
    it("transições: pickup não vai para delivered; preparing existe", () => {
        const src = read("tests/orders/statusTransitions.test.ts");
        assert.match(src, /preparing/);
        assert.match(src, /isAllowedTransition\("preparing", "delivered", "pickup"\), false\)/);
    });

    it("API pedidos usa rpc_set_order_status e enqueuePreparingNotify", () => {
        const orders = read("app/api/admin/orders/route.ts");
        assert.match(orders, /rpc_set_order_status/);
        assert.match(orders, /enqueuePreparingNotify|preparing/);
        assert.ok(exists("lib/orders/enqueuePreparingNotify.ts"));
        assert.match(read("app/api/admin/orders/route.ts"), /enqueuePreparingNotify|preparing/);
        assert.match(read("app/api/admin/orders/route.ts"), /scheduleOutboundAfterEnqueue/);
        assert.match(read("app/(admin)/pedidos/PedidosClient.tsx"), /kind === "prepare"/);
        assert.match(read("lib/orders/ViewOrderModal.tsx"), /Saiu pra entregar/);
        assert.equal(/Avisar WA/.test(read("lib/orders/ViewOrderModal.tsx")), false);
    });
});

describe("MVP checklist — M6 limpar fila", () => {
    it("clear-queue chama rpc_clear_print_queue e UI existe", () => {
        assert.match(read("app/api/admin/impressoras/clear-queue/route.ts"), /rpc_clear_print_queue/);
        assert.match(read("app/api/admin/impressoras/clear-queue/route.ts"), /owner.*admin|admin.*owner/);
        const impressoras = read("app/(admin)/impressoras/page.tsx");
        assert.match(impressoras, /clear-queue|Limpar fila/i);
    });
});

describe("MVP checklist — M7 receita canônica", () => {
    it("dashboard/extrato usam received income + fuso loja", () => {
        assert.match(read("src/financeiro/application/cashRevenue.ts"), /rpcCashRevenue/);
        assert.match(
            read("src/financeiro/adapters/supabase/financeQuery.supabase.ts"),
            /rpc_fin_cash_revenue/
        );
        assert.match(read("src/financeiro/application/queryDashboard.ts"), /loadCompanyTimezone|rpc_fin_dashboard|financeQuerySupabase/);
        assert.match(read("src/financeiro/application/queryExtrato.ts"), /v_fin_extrato|rpc_fin_cash_revenue/);
        assert.match(read("app/api/dashboard/stats/route.ts"), /queryHomeStats/);
        assert.match(read("app/api/dashboard/stats/route.ts"), /arOpen|settledSalesToday/);
        assert.match(read("components/DashboardClient.tsx"), /Recebido hoje|settledSalesToday|arOpen/);

        const d = new Date("2026-08-14T02:30:00.000Z");
        assert.equal(zonedIsoDate(d, "America/Cuiaba"), "2026-08-13");
        const range = zonedDayRange("2026-08-13", "America/Cuiaba");
        assert.ok(range.start.getTime() < range.endExclusive.getTime());
    });

    it("sem dual-path POST financial-entries em Pedidos; pagamento só no finalize", () => {
        const pedidos = read("app/(admin)/pedidos/PedidosClient.tsx");
        assert.equal(/financial-entries|financial_entries/.test(pedidos), false);
        assert.equal(exists("app/api/admin/financial-entries/route.ts"), false);

        const modal = read("lib/orders/ActionModal.tsx");
        assert.match(modal, /showPayment = kind === "finalize"/);
        assert.match(read("app/(admin)/pedidos/PedidosClient.tsx"), /settle:\s*true/);
        assert.match(read("app/api/admin/orders/route.ts"), /body\.settle === true/);
        assert.match(read("app/api/admin/financeiro/opex/route.ts"), /financeiro\.write/);
        assert.match(read("app/api/admin/financeiro/bills/route.ts"), /financeiro\.write/);
        assert.match(read("app/api/admin/pdv/cash-movements/route.ts"), /rpc_post_cash_movement|postCashMovement/);
    });
});

describe("MVP checklist — M0 features + matriz planos", () => {
    it("staff_users e printing_auto referenciados no código de gate", () => {
        assert.match(read("lib/billing/requirePlanFeature.ts"), /staff_users/);
        assert.match(read("lib/billing/requirePlanFeature.ts"), /printing_auto/);
        assert.match(read("components/settings/TeamMembersPanel.tsx"), /staff_users/);
        assert.match(read("app/api/admin/impressoras/clear-queue/route.ts"), /printing_auto/);
    });

    it("checklist marca M1–M7 como feitos", () => {
        const doc = read("docs/CHECKLIST_MVP_LANCAMENTO.md");
        for (const m of ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M0"]) {
            const row = doc.split("\n").find((l) => l.includes(`| ${m} |`));
            assert.ok(row, `linha resumo de ${m}`);
            assert.match(row!, /\[x\]/);
        }
    });
});
