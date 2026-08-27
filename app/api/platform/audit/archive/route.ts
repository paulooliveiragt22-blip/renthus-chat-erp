/**
 * Cron mensal: arquiva rows de platform_audit_log com >24 meses no Storage
 * (bucket privado) e só então apaga o hot path.
 *
 * Auth: Bearer CRON_SECRET
 */
import { gzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { newRequestId } from "@/lib/platform/audit/recordPlatformAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BUCKET = "platform-audit-archive";
const BATCH = Math.min(
    Math.max(Number(process.env.PLATFORM_AUDIT_ARCHIVE_BATCH ?? "2000"), 100),
    5000
);
const MAX_BATCHES = Math.min(
    Math.max(Number(process.env.PLATFORM_AUDIT_ARCHIVE_MAX_BATCHES ?? "10"), 1),
    50
);
const RETENTION_MONTHS = Math.min(
    Math.max(Number(process.env.PLATFORM_AUDIT_RETENTION_MONTHS ?? "24"), 6),
    120
);

function cutoffIso(months: number): string {
    const d = new Date();
    d.setUTCMonth(d.getUTCMonth() - months);
    return d.toISOString();
}

export async function GET(request: NextRequest) {
    const denied = validateCronAuthorization(request.headers.get("authorization"));
    if (denied) return denied;

    const admin = createAdminClient();
    const cutoff = cutoffIso(RETENTION_MONTHS);
    const runId = newRequestId();
    let archivedRows = 0;
    let deletedRows = 0;
    let batches = 0;
    const objectPaths: string[] = [];

    for (let i = 0; i < MAX_BATCHES; i++) {
        const { data: rows, error } = await admin
            .from("platform_audit_log")
            .select(
                "id, occurred_at, actor_id, actor_email, actor_role, action, resource_type, resource_id, company_id, request_id, ip_address, user_agent, before_state, after_state, metadata, outcome"
            )
            .lt("occurred_at", cutoff)
            .order("occurred_at", { ascending: true })
            .limit(BATCH);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        if (!rows?.length) break;

        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const path = `${cutoff.slice(0, 7)}/${runId}/batch-${String(i).padStart(3, "0")}-${stamp}.json.gz`;
        const payload = gzipSync(
            Buffer.from(
                JSON.stringify({
                    runId,
                    cutoff,
                    exportedAt: new Date().toISOString(),
                    count: rows.length,
                    rows,
                }),
                "utf8"
            )
        );

        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, payload, {
            contentType: "application/gzip",
            upsert: false,
        });
        if (upErr) {
            return NextResponse.json(
                {
                    error: upErr.message,
                    archivedRows,
                    deletedRows,
                    note: "upload falhou — nenhum delete deste batch",
                },
                { status: 500 }
            );
        }

        const ids = rows.map((r) => r.id as string);
        const { data: deleted, error: delErr } = await admin.rpc(
            "rpc_platform_delete_audit_by_ids",
            { p_ids: ids }
        );
        if (delErr) {
            return NextResponse.json(
                {
                    error: delErr.message,
                    objectPath: path,
                    archivedRows: archivedRows + rows.length,
                    deletedRows,
                    note: "arquivo no Storage; delete falhou — reexecutar após correção",
                },
                { status: 500 }
            );
        }

        archivedRows += rows.length;
        deletedRows += typeof deleted === "number" ? deleted : Number(deleted) || 0;
        objectPaths.push(path);
        batches += 1;

        if (rows.length < BATCH) break;
    }

    await admin.rpc("rpc_platform_record_audit", {
        p_actor_id: null,
        p_actor_email: "system:cron",
        p_actor_role: "system",
        p_action: "platform.audit.archived",
        p_resource_type: "platform_audit_log",
        p_resource_id: runId,
        p_company_id: null,
        p_request_id: runId,
        p_ip_address: null,
        p_user_agent: "cron/platform-audit-archive",
        p_before_state: null,
        p_after_state: {
            cutoff,
            archivedRows,
            deletedRows,
            batches,
            objectPaths,
        },
        p_metadata: { retentionMonths: RETENTION_MONTHS },
        p_outcome: "success",
    });

    return NextResponse.json({
        ok: true,
        cutoff,
        retentionMonths: RETENTION_MONTHS,
        batches,
        archivedRows,
        deletedRows,
        objectPaths,
    });
}
