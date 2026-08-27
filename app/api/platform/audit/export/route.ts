import { NextResponse } from "next/server";
import { toAuditCtx, withPlatformAccess } from "@/lib/platform/apiHelpers";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import { listPlatformAudit } from "@/lib/platform/services/platformOps";

export const runtime = "nodejs";

function csvEscape(value: unknown): string {
    const s = value == null ? "" : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

export async function GET(req: Request) {
    return withPlatformAccess("platform.audit.read", async (ctx) => {
        const url = new URL(req.url);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? "5000"), 10000);
        const companyId = url.searchParams.get("company_id") ?? undefined;
        const action = url.searchParams.get("action") ?? undefined;

        const { rows, total } = await listPlatformAudit(ctx.admin, {
            limit,
            offset: 0,
            companyId,
            action,
        });

        const header = [
            "occurred_at",
            "actor_email",
            "actor_role",
            "action",
            "resource_type",
            "resource_id",
            "company_id",
            "outcome",
        ];
        const lines = [
            header.join(","),
            ...rows.map((r) =>
                [
                    r.occurred_at,
                    r.actor_email,
                    r.actor_role,
                    r.action,
                    r.resource_type,
                    r.resource_id,
                    r.company_id,
                    r.outcome,
                ]
                    .map(csvEscape)
                    .join(",")
            ),
        ];

        const audit = toAuditCtx(ctx);
        await recordPlatformAudit({
            admin: ctx.admin,
            actor: audit.actor,
            action: "platform.audit.exported",
            resourceType: "platform_audit_log",
            requestId: audit.requestId,
            ipAddress: audit.ipAddress,
            userAgent: audit.userAgent,
            metadata: { exported: rows.length, total, companyId, action },
        });

        const stamp = new Date().toISOString().slice(0, 10);
        return new NextResponse(lines.join("\n"), {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="platform-audit-${stamp}.csv"`,
            },
        });
    });
}
