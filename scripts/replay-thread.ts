/**
 * Harness de replay (Fase 1).
 *
 * Uso:
 *   npm run replay -- <companyId> <threadId>
 *
 * Dump de mensagens + traces. Runner dry-run: `src/pro/replay/runThreadReplay.ts`
 * (wire CLI `--run` na próxima fatia / com tsx).
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import {
    loadThreadMessagesForReplay,
    loadThreadTracesForReplay,
} from "../src/pro/replay/loadThreadForReplay";

async function main() {
    const companyId = process.argv[2]?.trim();
    const threadId = process.argv[3]?.trim();
    if (!companyId || !threadId) {
        console.error("Uso: npm run replay -- <companyId> <threadId>");
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
                hint: "Runner dry-run: import runThreadReplay from src/pro/replay/runThreadReplay.ts",
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

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
