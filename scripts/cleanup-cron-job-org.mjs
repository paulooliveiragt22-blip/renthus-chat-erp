#!/usr/bin/env node
/**
 * Remove jobs obsoletos no cron-job.org (ADR-0003 Fase 4).
 * Requer CRONJOB_ORG_API_KEY em .env.local ou env (Settings → API key no console).
 *
 * Usage: node scripts/cleanup-cron-job-org.mjs
 *        node scripts/cleanup-cron-job-org.mjs --dry-run
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

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
const apiKey = env.CRONJOB_ORG_API_KEY?.trim();
if (!apiKey) {
    console.error(
        "[cleanup-cron-job-org] CRONJOB_ORG_API_KEY ausente.\n" +
            "  Gere em https://console.cron-job.org → Settings → API key\n" +
            "  Adicione em .env.local: CRONJOB_ORG_API_KEY=..."
    );
    process.exit(1);
}

const OBSOLETE_PATHS = [
    "/api/chatbot/process-queue",
    "/api/chatbot/outbound-worker",
    "/api/chatbot/reactivate",
];

function isObsoleteJob(job) {
    const url = String(job?.url ?? "").toLowerCase();
    return OBSOLETE_PATHS.some((p) => url.includes(p));
}

async function api(method, path, body) {
    const res = await fetch(`https://api.cron-job.org${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${method} ${path}: ${JSON.stringify(data)}`);
    }
    return data;
}

async function main() {
    const list = await api("GET", "/jobs");
    const jobs = list?.jobs ?? [];
    const targets = jobs.filter(isObsoleteJob);

    if (!targets.length) {
        console.log("[cleanup-cron-job-org] Nenhum job obsoleto encontrado (já removidos?).");
        console.log(`  Total jobs na conta: ${jobs.length}`);
        for (const j of jobs) {
            console.log(`  - #${j.jobId} ${j.title ?? ""} ${j.url ?? ""}`);
        }
        return;
    }

    console.log(`[cleanup-cron-job-org] ${targets.length} job(s) obsoleto(s):`);
    for (const j of targets) {
        console.log(`  #${j.jobId} ${j.title ?? "(sem título)"}`);
        console.log(`    ${j.url}`);
    }

    if (dryRun) {
        console.log("[cleanup-cron-job-org] --dry-run: nada deletado.");
        return;
    }

    for (const j of targets) {
        await api("DELETE", `/jobs/${j.jobId}`);
        console.log(`[cleanup-cron-job-org] deleted #${j.jobId}`);
    }
    console.log("[cleanup-cron-job-org] OK");
}

main().catch((err) => {
    console.error("[cleanup-cron-job-org] error:", err instanceof Error ? err.message : err);
    process.exit(1);
});
