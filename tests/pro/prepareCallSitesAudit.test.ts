/**
 * ADR 0012 D6 — auditoria estática dos caminhos que montam rascunho.
 *
 * O tipo já exige o envelope do inbound em `prepareOrderDraftFromTool` /
 * `OrderDraftPort.prepareFromToolInput`. Este teste cobre o que o tipo não pega:
 * `as any`, `@ts-expect-error` e call site novo que passa contexto vazio sem querer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PREPARE_CALLEES = ["prepareOrderDraftFromTool", "prepareFromToolInput"];

/** Inventário conhecido (ADR 0012). Caminho novo entra aqui de propósito, em review. */
const KNOWN_CALL_SITES = [
    "src/pro/adapters/ai/ai.service.ts",
    "src/pro/adapters/ai/tools/prepareOrderDraft.tool.ts",
    "src/pro/adapters/ai/tools/resolvePendingPicks.tool.ts",
    "src/pro/adapters/supabase/orderDraft.supabase.ts",
    "src/pro/pipeline/orderWorklist/coalescePrepareUniqueHits.ts",
    "src/pro/pipeline/serverOfferDeliveryAddress.ts",
    "src/pro/pipeline/serverPrepareAfterAddressPick.ts",
    "src/pro/pipeline/serverPrepareAfterPick.ts",
    "src/pro/pipeline/serverResolvePendingPicks.ts",
];

function walkTsFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walkTsFiles(p, acc);
        else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) acc.push(p);
    }
    return acc;
}

/** Texto da chamada, do `(` até o parêntese que fecha (balanceado). */
function callText(src: string, openParenIndex: number): string {
    let depth = 0;
    for (let i = openParenIndex; i < src.length; i++) {
        const c = src[i];
        if (c === "(") depth += 1;
        else if (c === ")") {
            depth -= 1;
            if (depth === 0) return src.slice(openParenIndex, i + 1);
        }
    }
    return src.slice(openParenIndex);
}

type CallSite = { file: string; snippet: string };

function findPrepareCalls(root: string): CallSite[] {
    const calls: CallSite[] = [];
    for (const file of walkTsFiles(join(root, "src", "pro"))) {
        const src = readFileSync(file, "utf8");
        for (const callee of PREPARE_CALLEES) {
            const re = new RegExp(`\\b${callee}\\s*\\(`, "g");
            let m: RegExpExecArray | null;
            while ((m = re.exec(src))) {
                /** Declaração da própria função, não chamada. */
                const before = src.slice(Math.max(0, m.index - 40), m.index);
                if (/\bfunction\s*$/.test(before)) continue;
                const open = m.index + m[0].length - 1;
                const snippet = callText(src, open);
                /** Assinatura de método (port/adapter): `(params: ...): Promise<...>`. */
                if (/^\s*:/.test(src.slice(open + snippet.length))) continue;
                calls.push({
                    file: relative(root, file).replaceAll("\\", "/"),
                    snippet,
                });
            }
        }
    }
    return calls;
}

describe("ADR 0012 — todo prepare recebe o envelope do inbound", () => {
    const root = process.cwd();
    const calls = findPrepareCalls(root);

    it("encontra os caminhos de prepare (auditoria não pode virar no-op)", () => {
        assert.ok(calls.length >= KNOWN_CALL_SITES.length, `esperado ≥${KNOWN_CALL_SITES.length} chamadas, achei ${calls.length}`);
    });

    it("nenhuma chamada sem slots/turn", () => {
        const offenders = calls
            .filter((c) => !/\bslots\b|\bturn\b/.test(c.snippet))
            .map((c) => `${c.file}: ${c.snippet.slice(0, 120).replaceAll("\n", " ")}`);
        assert.deepEqual(
            offenders,
            [],
            "Chamada de prepare sem contexto do turno (ADR 0012 D2):\n" + offenders.join("\n")
        );
    });

    it("nenhuma chamada escapa o tipo com as any / ts-expect-error", () => {
        const offenders = calls
            .filter((c) => /as any|@ts-expect-error|as unknown as/.test(c.snippet))
            .map((c) => c.file);
        assert.deepEqual(offenders, [], "Prepare com escape de tipo:\n" + offenders.join("\n"));
    });

    it("inventário de call sites bate com o ADR", () => {
        const files = [...new Set(calls.map((c) => c.file))].sort();
        assert.deepEqual(
            files,
            [...KNOWN_CALL_SITES].sort(),
            "Caminho de prepare novo/removido: atualizar KNOWN_CALL_SITES e a tabela do ADR 0012."
        );
    });
});
