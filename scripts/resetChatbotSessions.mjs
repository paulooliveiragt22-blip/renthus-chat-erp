/**
 * One-off: apaga todas as linhas de chatbot_sessions e remove jobs pendentes
 * da chatbot_queue (pending/processing) para evitar reprocessar estado antigo.
 *
 * Uso (PowerShell):
 *   Get-Content .env.local | ... carregar env ...
 *   node scripts/resetChatbotSessions.mjs
 *
 * Ou exporte NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY manualmente.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnvLocal() {
    const p = resolve(process.cwd(), ".env.local");
    let raw;
    try {
        raw = readFileSync(p, "utf8");
    } catch {
        return;
    }
    for (const line of raw.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const idx = t.indexOf("=");
        if (idx <= 0) continue;
        const key = t.slice(0, idx).trim();
        let val = t.slice(idx + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

async function countAll(admin, table) {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
}

async function countQueuePendingOrProcessing(admin) {
    const { count, error } = await admin
        .from("chatbot_queue")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "processing"]);
    if (error) throw error;
    return count ?? 0;
}

async function main() {
    loadDotEnvLocal();

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const admin = createClient(url, key, { auth: { persistSession: false } });

    const sessionsBefore = await countAll(admin, "chatbot_sessions");
    const queueBefore = await countQueuePendingOrProcessing(admin);

    // eslint-disable-next-line no-console
    console.log(
        JSON.stringify(
            {
                sessionsBefore,
                chatbotQueuePendingOrProcessingBefore: queueBefore,
            },
            null,
            2
        )
    );

    const { error: delSessionsErr } = await admin
        .from("chatbot_sessions")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delSessionsErr) throw delSessionsErr;

    const { error: delQueueErr } = await admin.from("chatbot_queue").delete().in("status", ["pending", "processing"]);
    if (delQueueErr) throw delQueueErr;

    const sessionsAfter = await countAll(admin, "chatbot_sessions");
    const queueAfter = await countQueuePendingOrProcessing(admin);

    // eslint-disable-next-line no-console
    console.log(
        JSON.stringify(
            {
                sessionsAfter,
                chatbotQueuePendingOrProcessingAfter: queueAfter,
            },
            null,
            2
        )
    );

    // `@supabase/supabase-js` pode deixar handles abertos (fetch/keep-alive) que impedem exit natural.
    process.exit(0);
}

main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
});
