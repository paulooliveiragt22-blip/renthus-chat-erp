import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
    COMMAND_MENU_FORBIDDEN_SUBSTRINGS,
    clientesSearchHref,
    filterCommandNavItems,
} from "../../components/command/commandItems";

const root = process.cwd();

function read(rel: string): string {
    return readFileSync(join(root, rel), "utf8");
}

describe("command menu contract — sem mutação billing", () => {
    it("CommandMenu e registry não chamam change-plan / checkout / seats", () => {
        // commandItems lista substrings proibidas — exclui o bloco da constante.
        const itemsSrc = read("components/command/commandItems.ts").replace(
            /export const COMMAND_MENU_FORBIDDEN_SUBSTRINGS[\s\S]*?as const;/,
            ""
        );
        const sources = [
            read("components/command/CommandMenu.tsx"),
            itemsSrc,
            read("components/ui/command.tsx"),
        ].join("\n");

        for (const needle of COMMAND_MENU_FORBIDDEN_SUBSTRINGS) {
            assert.equal(
                sources.includes(needle),
                false,
                `forbidden substring in command palette source: ${needle}`
            );
        }
    });

    it("billing no catálogo é só link /plano", () => {
        const src = read("components/command/commandItems.ts");
        assert.match(src, /href:\s*"\/plano"/);
        assert.match(src, /group:\s*"billing"/);
        assert.doesNotMatch(src, /href:\s*["']\/api\/billing/);
        assert.doesNotMatch(src, /fetch\s*\(\s*["'`].*billing/);
    });

    it("member não vê itens com roles owner/admin", () => {
        const features = new Set(["financeiro_full", "pdv"]);
        const forMember = filterCommandNavItems({
            role: "member",
            featuresLoading: false,
            features,
        });
        assert.equal(
            forMember.some((i) => i.id === "billing-plano"),
            false
        );
        assert.equal(
            forMember.some((i) => i.id === "nav-config"),
            false
        );
        assert.equal(
            forMember.some((i) => i.id === "nav-financeiro"),
            false
        );

        const forOwner = filterCommandNavItems({
            role: "owner",
            featuresLoading: false,
            features,
        });
        assert.equal(
            forOwner.some((i) => i.id === "billing-plano"),
            true
        );
        assert.equal(forOwner.some((i) => i.id === "nav-config"), true);
    });

    it("clientesSearchHref monta deep-link q=", () => {
        assert.equal(clientesSearchHref(""), "/clientes");
        assert.equal(clientesSearchHref("  João  "), "/clientes?q=Jo%C3%A3o");
    });
});
