/**
 * B15 — toda rota em app/api que usa createAdminClient
 * deve ter um gate reconhecido (ou estar na allowlist documentada).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
    isCreateAdminGateAllowlisted,
    routeHasRecognizedGate,
    routeUsesCreateAdmin,
} from "../../lib/security/createAdminRouteGate";

function walkRouteFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const st = statSync(p);
        if (st.isDirectory()) walkRouteFiles(p, acc);
        else if (name === "route.ts") acc.push(p);
    }
    return acc;
}

describe("B15 createAdmin route gate", () => {
    const root = process.cwd();
    const apiRoot = join(root, "app", "api");
    const routes = walkRouteFiles(apiRoot);

    it("nenhuma rota com createAdmin fica sem gate (exceto allowlist)", () => {
        const offenders: string[] = [];
        let withAdmin = 0;
        for (const abs of routes) {
            const src = readFileSync(abs, "utf8");
            if (!routeUsesCreateAdmin(src)) continue;
            withAdmin += 1;
            const rel = relative(root, abs).replace(/\\/g, "/");
            if (isCreateAdminGateAllowlisted(rel)) continue;
            if (!routeHasRecognizedGate(src)) offenders.push(rel);
        }
        assert.ok(withAdmin > 0, "esperado achar rotas com createAdminClient");
        const msg =
            "Rotas com createAdmin sem gate reconhecido (atualizar gate ou inventário):\n" +
            offenders.join("\n");
        assert.deepEqual(offenders, [], msg);
    });

    it("allowlist health permanece documentada e sem gate de sessao", () => {
        const health = join(root, "app/api/health/route.ts");
        const src = readFileSync(health, "utf8");
        assert.equal(routeUsesCreateAdmin(src), true);
        assert.equal(isCreateAdminGateAllowlisted("app/api/health/route.ts"), true);
    });
});
