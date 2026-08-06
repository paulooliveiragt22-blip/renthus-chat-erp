/**
 * Harness de replay (Fase 1).
 *
 * Uso:
 *   npm run replay -- <companyId> <threadId>              # dump mensagens + traces
 *   npm run replay -- <companyId> <threadId> --run        # dry-run pipeline (sem Meta/pedido)
 *   npm run replay -- --extract-diff [path]               # divergência LLM×regex offline
 *
 * Env (dump/--run): NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    loadThreadMessagesForReplay,
    loadThreadTracesForReplay,
} from "../src/pro/replay/loadThreadForReplay";
import {
    summarizeExtractionDivergence,
    type ExtractionDivergenceCase,
} from "../src/pro/replay/measureExtractionDivergence";
import type { OrderLineExtraction } from "../src/domain/contracts/orderExtraction";

function hasFlag(argv: string[], name: string): boolean {
    return argv.includes(name);
}

function flagValue(argv: string[], name: string): string | null {
    const i = argv.indexOf(name);
    if (i < 0) return null;
    const next = argv[i + 1];
    if (!next || next.startsWith("-")) return null;
    return next;
}

/** Args posicionais ignorando flags conhecidas e seus valores opcionais. */
function positionalArgs(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (a === "--run") continue;
        if (a === "--extract-diff") {
            const next = argv[i + 1];
            if (next && !next.startsWith("-")) i += 1;
            continue;
        }
        if (a.startsWith("-")) continue;
        out.push(a);
    }
    return out;
}

function loadExtractionBaseline(path: string): ExtractionDivergenceCase[] {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
        cases?: Array<{
            text: string;
            extraction: OrderLineExtraction | null;
        }>;
    };
    if (!Array.isArray(raw.cases)) {
        throw new Error(`Baseline inválida (falta cases[]): ${path}`);
    }
    return raw.cases.map((c) => ({
        text: String(c.text ?? ""),
        extraction: c.extraction ?? null,
    }));
}

async function runExtractDiff(argv: string[]) {
    const defaultPath = resolve(
        process.cwd(),
        "tests/fixtures/replay/extraction-baseline.v1.json"
    );
    const path = flagValue(argv, "--extract-diff") ?? defaultPath;
    const cases = loadExtractionBaseline(path);
    const summary = summarizeExtractionDivergence(cases);
    console.log(
        JSON.stringify(
            {
                mode: "extract-diff",
                fixture: path,
                summary,
            },
            null,
            2
        )
    );
}

async function runDumpOrReplay(argv: string[]) {
    const pos = positionalArgs(argv);
    const companyId = pos[0]?.trim();
    const threadId = pos[1]?.trim();
    if (!companyId || !threadId) {
        console.error(
            "Uso:\n" +
                "  npm run replay -- <companyId> <threadId>\n" +
                "  npm run replay -- <companyId> <threadId> --run\n" +
                "  npm run replay -- --extract-diff [path]"
        );
        process.exit(1);
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
        process.exit(1);
    }

    const admin = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    if (hasFlag(argv, "--run")) {
        const { runThreadReplay } = await import("../src/pro/replay/runThreadReplay");
        const result = await runThreadReplay({ admin, companyId, threadId });
        console.log(
            JSON.stringify(
                {
                    mode: "run",
                    companyId,
                    threadId,
                    summary: result.summary,
                    turns: result.turns,
                },
                null,
                2
            )
        );
        if (result.summary.diffs > 0) process.exitCode = 2;
        return;
    }

    const messages = await loadThreadMessagesForReplay(admin, { companyId, threadId });
    let traces: Awaited<ReturnType<typeof loadThreadTracesForReplay>> = [];
    try {
        traces = await loadThreadTracesForReplay(admin, { companyId, threadId });
    } catch (e) {
        console.warn(
            "traces indisponíveis (rode a migration pipeline_turn_traces?):",
            e instanceof Error ? e.message : e
        );
    }

    console.log(
        JSON.stringify(
            {
                mode: "dump",
                companyId,
                threadId,
                messageCount: messages.length,
                traceCount: traces.length,
                inboundTurns: messages.filter((m) => m.direction === "inbound").length,
                hint: "Reprocessar: npm run replay -- <companyId> <threadId> --run",
                messages: messages.map((m) => ({
                    at: m.created_at,
                    dir: m.direction,
                    sender: m.sender_type,
                    body: (m.body ?? "").slice(0, 160),
                })),
                traces: traces.map((t) => ({
                    at: t.created_at,
                    inbound: t.inbound_message_id,
                    ai: t.ai_profile,
                    reason: t.telemetry_reason,
                    outbound: t.outbound,
                })),
            },
            null,
            2
        )
    );
}

async function main() {
    const argv = process.argv.slice(2);
    if (hasFlag(argv, "--extract-diff") && positionalArgs(argv).length === 0) {
        await runExtractDiff(argv);
        return;
    }
    await runDumpOrReplay(argv);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
