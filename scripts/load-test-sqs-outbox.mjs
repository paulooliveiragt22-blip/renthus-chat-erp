#!/usr/bin/env node
/**
 * Fase 6 ADR-0003 — load test transporte SQS → Lambda (skip path, sem LLM).
 *
 * Enfileira N envelopes com jobIds inexistentes (Lambda → job_not_found/skip).
 * Mede latência SendMessage → fila vazia (ApproximateNumberOfMessagesVisible=0)
 * e reporta p95. Critério ADR: p95 idade < 60s.
 *
 * Usage:
 *   node scripts/load-test-sqs-outbox.mjs
 *   node scripts/load-test-sqs-outbox.mjs --count=50 --p95-max-ms=30000
 *   node scripts/load-test-sqs-outbox.mjs --count=30 --sequential
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
    SQSClient,
    SendMessageCommand,
    GetQueueAttributesCommand,
    GetQueueUrlCommand,
} from "@aws-sdk/client-sqs";
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

function parseArgs(argv) {
    const out = {
        count: 30,
        p95MaxMs: 60_000,
        pollMs: 2_000,
        timeoutMs: 180_000,
        sequential: false,
        skipIdempotency: false,
        companyId: "",
    };
    for (const a of argv) {
        if (a.startsWith("--count=")) out.count = Math.max(1, Number(a.slice(8)) || 30);
        if (a.startsWith("--p95-max-ms=")) out.p95MaxMs = Math.max(1000, Number(a.slice(13)) || 60_000);
        if (a.startsWith("--timeout-ms=")) out.timeoutMs = Math.max(10_000, Number(a.slice(13)) || 180_000);
        if (a.startsWith("--company-id=")) out.companyId = a.slice(13).trim();
        if (a === "--sequential") out.sequential = true;
        if (a === "--skip-idempotency") out.skipIdempotency = true;
    }
    return out;
}

function percentile(sortedAsc, p) {
    if (!sortedAsc.length) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.ceil((p / 100) * sortedAsc.length) - 1);
    return sortedAsc[Math.max(0, idx)];
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

const env = { ...loadDotEnv(join(root, ".env.local")), ...process.env };
const region = env.AWS_REGION || "sa-east-1";
const awsProfile = env.AWS_PROFILE || "renthus";
if (!env.AWS_ACCESS_KEY_ID) {
    process.env.AWS_PROFILE = awsProfile;
}
const opts = parseArgs(process.argv.slice(2));

const sqs = new SQSClient({
    region,
    ...(env.AWS_ACCESS_KEY_ID
        ? {
              credentials: {
                  accessKeyId: env.AWS_ACCESS_KEY_ID,
                  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
              },
          }
        : {}),
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

async function resolveQueueUrl(nameOrUrl) {
    if (nameOrUrl?.startsWith("https://")) return nameOrUrl;
    const name = nameOrUrl || "renthus-inbound.fifo";
    const r = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    return r.QueueUrl;
}

async function visibleCount(queueUrl) {
    const r = await sqs.send(
        new GetQueueAttributesCommand({
            QueueUrl: queueUrl,
            AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
        })
    );
    const a = r.Attributes ?? {};
    let ageSec = 0;
    try {
        const ageRes = await sqs.send(
            new GetQueueAttributesCommand({
                QueueUrl: queueUrl,
                AttributeNames: ["ApproximateAgeOfOldestMessage"],
            })
        );
        ageSec = Number(ageRes.Attributes?.ApproximateAgeOfOldestMessage ?? 0);
    } catch {
        /* empty FIFO queue may not expose age */
    }
    return {
        visible: Number(a.ApproximateNumberOfMessages ?? 0),
        inFlight: Number(a.ApproximateNumberOfMessagesNotVisible ?? 0),
        ageSec,
    };
}

async function seedCompanyThread() {
    const { data, error } = await supabase
        .from("chatbot_queue")
        .select("company_id, thread_id")
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw new Error(`supabase seed: ${error.message}`);
    if (!data) throw new Error("no done chatbot_queue row to seed company/thread");
    return data;
}

async function assertMessageIdIdempotency(companyId) {
    const mid = `loadtest-idem-${randomUUID()}`;
    const base = {
        company_id: companyId,
        thread_id: randomUUID(),
        phone_e164: "+5500000000000",
        message_id: mid,
        body_text: "loadtest idempotency probe (safe to delete)",
        status: "done",
        attempts: 0,
        scheduled_at: new Date().toISOString(),
        last_error: "loadtest_idempotency",
    };
    const { error: e1 } = await supabase.from("chatbot_queue").insert(base);
    if (e1) throw new Error(`idempotency insert1: ${e1.message}`);

    const { error: e2 } = await supabase.from("chatbot_queue").insert({
        ...base,
        thread_id: randomUUID(),
    });
    const duplicateRejected =
        !!e2 &&
        (e2.code === "23505" ||
            /duplicate|unique/i.test(e2.message ?? "") ||
            /chatbot_queue_company_message_id/i.test(e2.message ?? ""));

    await supabase.from("chatbot_queue").delete().eq("message_id", mid);

    if (!duplicateRejected) {
        throw new Error(
            `idempotency FAIL: second insert with same (company_id, message_id) was accepted (${e2?.message ?? "no error"})`
        );
    }
    console.log("[load] idempotency OK — unique (company_id, message_id) rejected duplicate");
}

async function main() {
    const queueUrl = await resolveQueueUrl(env.SQS_INBOUND_QUEUE_URL?.trim());
    const seed = opts.companyId
        ? { company_id: opts.companyId, thread_id: randomUUID() }
        : await seedCompanyThread();
    console.log("[load] queue", queueUrl);
    console.log("[load] seed company/thread", seed.company_id, seed.thread_id);
    console.log("[load] count", opts.count, "p95 max ms", opts.p95MaxMs, "mode", opts.sequential ? "sequential" : "parallel");

    if (!opts.skipIdempotency) {
        await assertMessageIdIdempotency(seed.company_id);
    } else {
        console.log("[load] skip idempotency probe (--skip-idempotency)");
    }

    const before = await visibleCount(queueUrl);
    if (before.visible + before.inFlight > 5) {
        console.warn("[load] WARN: queue not empty before test", before);
    }

    const sentAt = [];
    const t0 = Date.now();
    for (let i = 0; i < opts.count; i++) {
        const jobId = randomUUID();
        // ADR canônico: MessageGroupId = thread_id (parallel = synthetic thread per msg)
        const companyId = seed.company_id;
        const threadId = opts.sequential ? seed.thread_id : randomUUID();
        const groupId = threadId;
        const body = JSON.stringify({
            v: 1,
            kind: "inbound",
            jobId,
            companyId,
            threadId,
            enqueuedAt: new Date().toISOString(),
        });
        const sent = Date.now();
        await sqs.send(
            new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: body,
                MessageGroupId: groupId,
                MessageDeduplicationId: jobId,
            })
        );
        sentAt.push(sent);
        if ((i + 1) % 10 === 0) console.log(`[load] enqueued ${i + 1}/${opts.count}`);
    }
    const enqueueMs = Date.now() - t0;
    console.log(`[load] enqueue done in ${enqueueMs}ms`);

    const deadline = Date.now() + opts.timeoutMs;
    let drainedAt = 0;
    while (Date.now() < deadline) {
        const s = await visibleCount(queueUrl);
        process.stdout.write(
            `\r[load] visible=${s.visible} inFlight=${s.inFlight} ageSec=${s.ageSec}   `
        );
        if (s.visible === 0 && s.inFlight === 0) {
            drainedAt = Date.now();
            break;
        }
        await sleep(opts.pollMs);
    }
    process.stdout.write("\n");

    if (!drainedAt) {
        console.error("[load] FAIL — queue not drained within timeout", opts.timeoutMs);
        process.exit(1);
    }

    // Conservative: all messages drained by drainedAt; age from each send → drain
    // (FIFO same group: last message age dominates; still valid upper bound for p95).
    const ages = sentAt.map((t) => drainedAt - t).sort((a, b) => a - b);
    const p50 = percentile(ages, 50);
    const p95 = percentile(ages, 95);
    const p99 = percentile(ages, 99);
    const max = ages[ages.length - 1] ?? 0;

    console.log("[load] ages ms", { p50, p95, p99, max, n: ages.length });
    if (p95 > opts.p95MaxMs) {
        console.error(`[load] FAIL — p95 ${p95}ms > ${opts.p95MaxMs}ms`);
        process.exit(1);
    }
    console.log(`[load] PASS — p95 ${p95}ms <= ${opts.p95MaxMs}ms (skip-path transport)`);
}

main().catch((err) => {
    console.error("[load] error:", err instanceof Error ? err.message : err);
    process.exit(1);
});
