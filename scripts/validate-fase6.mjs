#!/usr/bin/env node
/**
 * Fase 6 ADR-0003 — validação consolidada (load test + KPIs outbox + alarmes AWS).
 * Usage: node scripts/validate-fase6.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadDotEnv(path) {
    const map = {};
    if (!existsSync(path)) return map;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const i = t.indexOf("=");
        if (i < 1) continue;
        let v = t.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
        }
        map[t.slice(0, i).trim()] = v;
    }
    return map;
}

const env = { ...loadDotEnv(join(root, ".env.local")), ...process.env };
const region = env.AWS_REGION || "sa-east-1";
const awsProfile = env.AWS_PROFILE || "renthus";
if (!env.AWS_ACCESS_KEY_ID) {
    process.env.AWS_PROFILE = awsProfile;
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

async function checkQueueKpis() {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.warn("[fase6] skip platform KPIs — Supabase env missing locally");
        return null;
    }
    const windowStart = new Date(Date.now() - 15 * 60_000).toISOString();
    const [pending, processing, recent, oldest] = await Promise.all([
        supabase.from("chatbot_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("chatbot_queue").select("id", { count: "exact", head: true }).eq("status", "processing"),
        supabase
            .from("chatbot_queue")
            .select("status")
            .gte("created_at", windowStart)
            .in("status", ["done", "failed"]),
        supabase
            .from("chatbot_queue")
            .select("scheduled_at")
            .eq("status", "pending")
            .order("scheduled_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
    ]);

    if (pending.error) throw new Error(pending.error.message);
    if (processing.error) throw new Error(processing.error.message);
    if (recent.error) throw new Error(recent.error.message);

    let done = 0;
    let failed = 0;
    for (const row of recent.data ?? []) {
        if (row.status === "done") done += 1;
        if (row.status === "failed") failed += 1;
    }

    let oldestAgeSec = 0;
    if (oldest.data?.scheduled_at) {
        oldestAgeSec = Math.max(
            0,
            Math.floor((Date.now() - new Date(oldest.data.scheduled_at).getTime()) / 1000)
        );
    }

    const kpis = {
        pendingNow: pending.count ?? 0,
        processingNow: processing.count ?? 0,
        doneLast15m: done,
        failedLast15m: failed,
        oldestPendingAgeSec: oldestAgeSec,
    };
    console.log("[fase6] platform KPIs (getQueueHealthStats equivalent)", kpis);

    if (kpis.pendingNow > 50) {
        throw new Error(`pending backlog too high: ${kpis.pendingNow}`);
    }
    if (kpis.oldestPendingAgeSec > 120) {
        throw new Error(`oldest pending age ${kpis.oldestPendingAgeSec}s > 120s`);
    }
    return kpis;
}

async function checkAlarms() {
    const profile = awsProfile;
    const res = spawnSync(
        "aws",
        [
            "--profile",
            profile,
            "--region",
            region,
            "cloudwatch",
            "describe-alarms",
            "--alarm-name-prefix",
            "renthus-",
            "--output",
            "json",
        ],
        { encoding: "utf8" }
    );
    if (res.status !== 0) {
        throw new Error(`aws describe-alarms failed: ${res.stderr || res.stdout}`);
    }
    const parsed = JSON.parse(res.stdout);
    const alarms = parsed.MetricAlarms ?? [];
    const bad = alarms.filter((a) => a.StateValue === "ALARM");
    const summary = alarms.map((a) => ({ name: a.AlarmName, state: a.StateValue }));
    console.log("[fase6] CloudWatch alarms", summary);
    if (bad.length > 0) {
        throw new Error(`alarms in ALARM: ${bad.map((a) => a.AlarmName).join(", ")}`);
    }
    if (alarms.length < 4) {
        throw new Error(`expected >= 4 renthus-* alarms, got ${alarms.length}`);
    }
    return alarms.length;
}

async function main() {
    const companyId = env.FASE6_COMPANY_ID || "e5865f09-7dce-4fce-afad-d9ab20031790";
    console.log("[fase6] === load test (parallel 50, p95 < 30s) ===");
    const load = spawnSync(
        process.execPath,
        [
            "scripts/load-test-sqs-outbox.mjs",
            "--count=50",
            "--p95-max-ms=30000",
            "--skip-idempotency",
            `--company-id=${companyId}`,
        ],
        { cwd: root, stdio: "inherit", env: { ...process.env, AWS_PROFILE: awsProfile } }
    );
    if (load.status !== 0) {
        process.exit(load.status ?? 1);
    }

    console.log("\n[fase6] === platform KPIs ===");
    await checkQueueKpis();

    console.log("\n[fase6] === CloudWatch alarms ===");
    await checkAlarms();

    console.log("\n[fase6] PASS — Fase 6 validation complete");
}

main().catch((err) => {
    console.error("[fase6] FAIL:", err instanceof Error ? err.message : err);
    process.exit(1);
});
