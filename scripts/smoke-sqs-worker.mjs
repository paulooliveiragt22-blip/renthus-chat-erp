#!/usr/bin/env node
/**
 * Smoke ADR-0003: SQS FIFO → Lambda → process*JobById (skip path, sem LLM/WhatsApp).
 * Usage: node scripts/smoke-sqs-worker.mjs
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
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
const profile = env.AWS_PROFILE || "renthus";

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const sqs = new SQSClient({
    region,
    credentials: env.AWS_ACCESS_KEY_ID
        ? {
              accessKeyId: env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
});

function buildEnvelope(kind, jobId, companyId, threadId) {
    return JSON.stringify({
        v: 1,
        kind,
        jobId,
        companyId,
        threadId,
        enqueuedAt: new Date().toISOString(),
    });
}

async function sendFifo(queueUrl, body, groupId, dedupId) {
    const r = await sqs.send(
        new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: body,
            MessageGroupId: groupId,
            MessageDeduplicationId: dedupId,
        })
    );
    return r.MessageId;
}

async function fetchDoneInboundJob() {
    const { data, error } = await supabase
        .from("chatbot_queue")
        .select("id, company_id, thread_id, status")
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw new Error(`supabase: ${error.message}`);
    if (!data) throw new Error("no done chatbot_queue row for smoke");
    return data;
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function tailLambdaLog(functionName, needle, sinceSec = 180) {
    const start = Math.floor(Date.now() / 1000) - sinceSec;
    const { execFileSync } = await import("node:child_process");
    try {
        const out = execFileSync(
            "aws",
            [
                "--profile",
                profile,
                "--region",
                region,
                "logs",
                "filter-log-events",
                "--log-group-name",
                `/aws/lambda/${functionName}`,
                "--start-time",
                String(start * 1000),
                "--filter-pattern",
                needle,
                "--output",
                "text",
            ],
            { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }
        );
        return out.trim();
    } catch {
        return "";
    }
}

async function main() {
    const inUrl = env.SQS_INBOUND_QUEUE_URL?.trim();
    const outUrl = env.SQS_OUTBOUND_QUEUE_URL?.trim();
    if (!inUrl || !outUrl) throw new Error("SQS_*_QUEUE_URL missing");

    const job = await fetchDoneInboundJob();
    console.log("[smoke] inbound done job", job.id);

    const inBody = buildEnvelope("inbound", job.id, job.company_id, job.thread_id);
    const inMsgId = await sendFifo(inUrl, inBody, job.thread_id, randomUUID());
    console.log("[smoke] SQS inbound sent", inMsgId);

    const fakeOutboundId = randomUUID();
    const outBody = buildEnvelope("outbound", fakeOutboundId, job.company_id, job.thread_id);
    const outMsgId = await sendFifo(outUrl, outBody, job.company_id, randomUUID());
    console.log("[smoke] SQS outbound sent (fake job)", outMsgId);

    console.log("[smoke] waiting 25s for Lambda...");
    await sleep(25_000);

    const inLogs = await tailLambdaLog("renthus-inbound-worker", job.id.slice(0, 8));
    const outLogs = await tailLambdaLog("renthus-outbound-worker", fakeOutboundId.slice(0, 8));

    let ok = true;
    if (inLogs.includes("skip") || inLogs.includes("done") || inLogs.includes(job.id)) {
        console.log("[smoke] inbound Lambda OK (logs matched)");
    } else if (inLogs) {
        console.log("[smoke] inbound Lambda logs:", inLogs.slice(0, 400));
        console.log("[smoke] inbound Lambda OK (activity detected)");
    } else {
        console.error("[smoke] FAIL inbound — no CloudWatch logs for job", job.id);
        ok = false;
    }

    if (outLogs.includes("skip") || outLogs.includes("job_not_found") || outLogs.includes(fakeOutboundId)) {
        console.log("[smoke] outbound Lambda OK (logs matched)");
    } else if (outLogs) {
        console.log("[smoke] outbound Lambda logs:", outLogs.slice(0, 400));
        console.log("[smoke] outbound Lambda OK (activity detected)");
    } else {
        console.error("[smoke] FAIL outbound — no CloudWatch logs");
        ok = false;
    }

    if (!ok) process.exit(1);
    console.log("[smoke] PASS — SQS → Lambda path verified");
}

main().catch((err) => {
    console.error("[smoke] error:", err instanceof Error ? err.message : err);
    process.exit(1);
});
