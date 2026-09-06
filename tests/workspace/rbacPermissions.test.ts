/**
 * Auditoria RBAC: vazamento entre perfis, requireCapability e rotas sensíveis.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
    canChangeMemberRole,
    canDeactivateMember,
    canInviteRole,
    canManageTeam,
    canRemoveMember,
    inviteableRolesFor,
} from "../../lib/workspace/staffRoles";
import {
    CAPABILITY_KEYS,
    hasCapability,
    normalizeCapabilities,
    type CapabilityKey,
} from "../../lib/workspace/rbac/capabilities";
import { DEFAULT_PROFILE_SEEDS } from "../../lib/workspace/rbac/profileTemplates";

const SENSITIVE: CapabilityKey[] = [
    "financeiro.read",
    "financeiro.write",
    "estoque.write",
    "products.write",
    "settings.company",
    "menu.manage",
    "pdv.access",
    "customers.export",
];

function walkTs(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walkTs(p, acc);
        else if (name.endsWith(".ts") || name.endsWith(".tsx")) acc.push(p);
    }
    return acc;
}

describe("RBAC — isolamento dos templates padrão", () => {
    it("nenhum seed padrão recebe settings.company / menu.manage / financeiro / estoque write", () => {
        const forbidden = new Set<CapabilityKey>([
            "settings.company",
            "menu.manage",
            "financeiro.read",
            "financeiro.write",
            "estoque.write",
            "products.write",
            "customers.export",
        ]);
        for (const seed of DEFAULT_PROFILE_SEEDS) {
            for (const cap of seed.capabilities) {
                assert.equal(
                    forbidden.has(cap),
                    false,
                    `${seed.template_key} não deveria ter ${cap}`
                );
            }
        }
    });

    it("cozinha não acessa PDV nem financeiro", () => {
        const kitchen = DEFAULT_PROFILE_SEEDS.find((s) => s.template_key === "kitchen")!;
        assert.equal(hasCapability(kitchen.capabilities, "pdv.access"), false);
        assert.equal(hasCapability(kitchen.capabilities, "financeiro.read"), false);
        assert.equal(hasCapability(kitchen.capabilities, "kitchen.view"), true);
    });

    it("entregador não acessa PDV / mesa / financeiro", () => {
        const driver = DEFAULT_PROFILE_SEEDS.find((s) => s.template_key === "driver")!;
        assert.equal(hasCapability(driver.capabilities, "pdv.access"), false);
        assert.equal(hasCapability(driver.capabilities, "mesa.access"), false);
        assert.equal(hasCapability(driver.capabilities, "financeiro.read"), false);
        assert.equal(hasCapability(driver.capabilities, "delivery.view"), true);
    });

    it("garçom não acessa financeiro nem estoque", () => {
        const waiter = DEFAULT_PROFILE_SEEDS.find((s) => s.template_key === "waiter")!;
        assert.equal(hasCapability(waiter.capabilities, "financeiro.read"), false);
        assert.equal(hasCapability(waiter.capabilities, "estoque.write"), false);
        assert.equal(hasCapability(waiter.capabilities, "mesa.access"), true);
    });

    it("caixa tem PDV mas não financeiro.write", () => {
        const cashier = DEFAULT_PROFILE_SEEDS.find((s) => s.template_key === "cashier")!;
        assert.equal(hasCapability(cashier.capabilities, "pdv.access"), true);
        assert.equal(hasCapability(cashier.capabilities, "financeiro.write"), false);
        assert.equal(hasCapability(cashier.capabilities, "financeiro.read"), false);
    });

    it("capabilities inventadas na UI são descartadas", () => {
        assert.deepEqual(
            normalizeCapabilities(["pdv.access", "team.manage", "hack.root", 1, null]),
            ["pdv.access"]
        );
    });
});

describe("RBAC — gestão de equipe (owner/admin only)", () => {
    it("member não convida nem gerencia equipe", () => {
        assert.deepEqual(inviteableRolesFor("member"), []);
        assert.equal(canInviteRole("member", "member"), false);
        assert.equal(canManageTeam("member"), false);
        assert.equal(
            canRemoveMember({ actorRole: "member", targetRole: "member", isSelf: false }),
            false
        );
        assert.equal(
            canDeactivateMember({ actorRole: "member", targetRole: "member", isSelf: false }),
            false
        );
    });

    it("admin não promove a admin nem mexe em owner", () => {
        assert.equal(canInviteRole("admin", "admin"), false);
        assert.equal(
            canChangeMemberRole({
                actorRole: "admin",
                targetRole: "admin",
                nextRole: "member",
                isSelf: false,
            }),
            false
        );
        assert.equal(
            canDeactivateMember({ actorRole: "admin", targetRole: "admin", isSelf: false }),
            false
        );
        assert.equal(
            canRemoveMember({ actorRole: "admin", targetRole: "owner", isSelf: false }),
            false
        );
    });

    it("owner gerencia admin/member mas nunca owner", () => {
        assert.equal(canManageTeam("owner"), true);
        assert.equal(canInviteRole("owner", "admin"), true);
        assert.equal(
            canRemoveMember({ actorRole: "owner", targetRole: "owner", isSelf: false }),
            false
        );
        assert.equal(
            canChangeMemberRole({
                actorRole: "owner",
                targetRole: "member",
                nextRole: "owner",
                isSelf: false,
            }),
            false
        );
    });
});

describe("RBAC — requireCapability (guard server)", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let requireCapability: (req: any, mode?: "any" | "all") => Promise<any>;

    let role = "member";
    let profileId: string | null = "prof-1";
    let profileActive = true;
    let profileCaps: string[] = ["kitchen.view", "orders.read"];

    before(() => {
        const root = join(__dirname, "..", "..");
        const requireAccessBase = join(root, "lib", "workspace", "requireCompanyAccess");
        const requireCapBase = join(root, "lib", "workspace", "rbac", "requireCapability");

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cache = (require as any).cache as Record<string, unknown>;
        for (const base of [requireCapBase, requireAccessBase]) {
            delete cache[base + ".js"];
            delete cache[base + ".ts"];
        }

        function setCached(
            basePathWithoutExt: string,
            exports: Record<string, unknown>
        ) {
            for (const ext of [".js", ".ts"]) {
                const p = basePathWithoutExt + ext;
                cache[p] = { id: p, filename: p, loaded: true, exports };
            }
        }

        const fakeAdmin = {
            from(table: string) {
                if (table === "company_users") {
                    return {
                        select: () => ({
                            eq: () => ({
                                eq: () => ({
                                    maybeSingle: async () => ({
                                        data: { profile_id: profileId },
                                        error: null,
                                    }),
                                }),
                            }),
                        }),
                    };
                }
                if (table === "company_staff_profiles") {
                    return {
                        select: () => ({
                            eq: () => ({
                                eq: () => ({
                                    maybeSingle: async () => ({
                                        data: profileId
                                            ? {
                                                  capabilities: profileCaps,
                                                  is_active: profileActive,
                                              }
                                            : null,
                                        error: null,
                                    }),
                                }),
                            }),
                        }),
                    };
                }
                throw new Error(`unexpected table ${table}`);
            },
        };

        setCached(requireAccessBase, {
            requireCompanyAccess: async () => ({
                ok: true,
                companyId: "c1",
                userId: "u1",
                role,
                admin: fakeAdmin,
            }),
        });

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require(requireCapBase + ".js");
        requireCapability = mod.requireCapability;
    });

    it("owner bypassa qualquer capability", async () => {
        role = "owner";
        profileId = null;
        profileCaps = [];
        for (const cap of SENSITIVE) {
            const r = await requireCapability(cap);
            assert.equal(r.ok, true, `owner deveria passar em ${cap}`);
        }
    });

    it("admin bypassa qualquer capability", async () => {
        role = "admin";
        const r = await requireCapability("financeiro.write");
        assert.equal(r.ok, true);
    });

    it("member cozinha: kitchen ok, pdv/financeiro negados", async () => {
        role = "member";
        profileId = "prof-1";
        profileActive = true;
        profileCaps = ["kitchen.view", "orders.read", "orders.status", "print.operate"];

        assert.equal((await requireCapability("kitchen.view")).ok, true);
        assert.equal((await requireCapability("orders.read")).ok, true);

        const pdv = await requireCapability("pdv.access");
        assert.equal(pdv.ok, false);
        assert.equal(pdv.status, 403);

        const fin = await requireCapability("financeiro.read");
        assert.equal(fin.ok, false);
        assert.equal(fin.status, 403);
    });

    it("member sem profile_id é bloqueado", async () => {
        role = "member";
        profileId = null;
        const r = await requireCapability("orders.read");
        assert.equal(r.ok, false);
        assert.match(String(r.error), /perfil/i);
    });

    it("perfil inativo não concede capability", async () => {
        role = "member";
        profileId = "prof-1";
        profileActive = false;
        profileCaps = ["pdv.access", "financeiro.read"];
        const r = await requireCapability("pdv.access");
        assert.equal(r.ok, false);
        assert.equal(r.status, 403);
    });

    it("mode=all exige todas as caps", async () => {
        role = "member";
        profileId = "prof-1";
        profileActive = true;
        profileCaps = ["orders.read"];
        const fail = await requireCapability(["orders.read", "orders.write"], "all");
        assert.equal(fail.ok, false);
        profileCaps = ["orders.read", "orders.write"];
        const ok = await requireCapability(["orders.read", "orders.write"], "all");
        assert.equal(ok.ok, true);
    });
});

describe("RBAC — auditoria estática de rotas (vazamento)", () => {
    const projectRoot = process.cwd();
    const apiRoot = join(projectRoot, "app", "api");

    it("nenhuma rota operacional usa staff legado no allowlist", () => {
        const offenders: string[] = [];
        for (const file of walkTs(apiRoot)) {
            const src = readFileSync(file, "utf8");
            if (/"staff"|'staff'/.test(src) && /requireCompanyAccess|requireCompanyPlanFeature|requireCompanyAnyPlanFeature/.test(src)) {
                offenders.push(file.replace(/\\/g, "/"));
            }
        }
        assert.deepEqual(offenders, [], `rotas com staff legado:\n${offenders.join("\n")}`);
    });

    it("member não entra em gestão de equipe / perfis / billing sensível sem owner|admin", () => {
        const critical = [
            "app/api/admin/users/route.ts",
            "app/api/admin/users/[id]/route.ts",
            "app/api/admin/staff-profiles/route.ts",
            "app/api/admin/staff-profiles/[id]/route.ts",
            "app/api/billing/change-plan/route.ts",
            "app/api/admin/impressoras/clear-queue/route.ts",
        ];
        for (const rel of critical) {
            const src = readFileSync(join(projectRoot, rel), "utf8");
            assert.match(
                src,
                /requireCompanyAccess\(\s*(?:\[\s*["']owner["']\s*,\s*["']admin["']\s*\]|\{\s*allowedRoles:\s*\[\s*["']owner["']\s*,\s*["']admin["']\s*\])/,
                `${rel} deve restringir a owner/admin`
            );
            assert.equal(
                /requireCompanyAccess\(\[[^\]]*member/.test(src) ||
                    /allowedRoles:\s*\[[^\]]*member/.test(src),
                false,
                `${rel} não deve permitir member em requireCompanyAccess`
            );
        }
    });

    it("rotas de domínio usam requireCapability (não só member solto)", () => {
        const mustUseCap = [
            "app/api/admin/orders/route.ts",
            "app/api/admin/pdv/finalize/route.ts",
            "app/api/admin/financeiro/dashboard/route.ts",
            "app/api/dashboard/stats/route.ts",
            "app/api/admin/fila/pending-orders/route.ts",
        ];
        for (const rel of mustUseCap) {
            const src = readFileSync(join(projectRoot, rel), "utf8");
            assert.match(
                src,
                /requireCapability|requireCompanyPlanFeature\([^)]+,\s*[^,]+,\s*["']|requireCompanyAnyPlanFeature\([^)]+,\s*[^,]+,\s*["']/,
                `${rel} deve checar capability`
            );
        }
    });

    it("vazamentos clássicos fechados (companies/ai-wallet/reports/agent)", () => {
        const checks: Array<{ rel: string; must: RegExp }> = [
            {
                rel: "app/api/admin/ai-wallet/route.ts",
                must: /requireCompanyAccess\(\[\s*["']owner["']\s*,\s*["']admin["']\s*\]\)/,
            },
            {
                rel: "app/api/companies/update/route.ts",
                must: /requireCompanyAccess\(\[\s*["']owner["']\s*,\s*["']admin["']\s*\]\)/,
            },
            {
                rel: "app/api/reports/summary/route.ts",
                must: /requireCapability\(\s*["']financeiro\.read["']\s*\)/,
            },
            {
                rel: "app/api/reports/daily/route.ts",
                must: /requireCapability\(\s*["']financeiro\.read["']\s*\)/,
            },
            {
                rel: "app/api/agent/reprint/route.ts",
                must: /requireCapability\(\s*["']print\.operate["']\s*\)/,
            },
            {
                rel: "app/api/agent/keys/route.ts",
                must: /requireCompanyAccess\(\[\s*["']owner["']\s*,\s*["']admin["']\s*\]\)/,
            },
        ];
        for (const c of checks) {
            const src = readFileSync(join(projectRoot, c.rel), "utf8");
            assert.match(src, c.must, `${c.rel} falhou must`);
            if (c.rel.includes("ai-wallet")) {
                assert.equal(
                    /requireCompanyAccess\(\[[^\]]*member/.test(src),
                    false,
                    `${c.rel} ainda permite member`
                );
            }
        }
    });

    it("mutações financeiras exigem financeiro.write; PDV sangria fica em pdv.access", () => {
        const opex = readFileSync(join(projectRoot, "app/api/admin/financeiro/opex/route.ts"), "utf8");
        const bills = readFileSync(join(projectRoot, "app/api/admin/financeiro/bills/route.ts"), "utf8");
        const fin = readFileSync(join(projectRoot, "app/api/admin/financeiro/finalize-order/route.ts"), "utf8");
        const sangria = readFileSync(join(projectRoot, "app/api/admin/pdv/cash-movements/route.ts"), "utf8");
        assert.match(opex, /financeiro\.write/);
        assert.match(bills, /financeiro\.write/);
        assert.match(fin, /financeiro\.write/);
        assert.match(sangria, /pdv\.access/);
        assert.equal(/financeiro\.write/.test(sangria), false);
        assert.equal(
            existsSync(join(projectRoot, "app/api/admin/financeiro/expenses/route.ts")),
            false,
            "expenses route deve ter sido removida (F5 → /opex)"
        );
    });

    it("catálogo cobre todas as keys usadas nos seeds", () => {
        const catalog = new Set<string>(CAPABILITY_KEYS);
        for (const seed of DEFAULT_PROFILE_SEEDS) {
            for (const cap of seed.capabilities) {
                assert.ok(catalog.has(cap), `seed ${seed.template_key} usa cap fora do catálogo: ${cap}`);
            }
        }
    });
});
