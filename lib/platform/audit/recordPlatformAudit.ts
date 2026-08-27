import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformAuditAction } from "./auditActionCatalog";
import { redactAuditState } from "./redactAuditState";
import type { PlatformActor } from "../requirePlatformAccess";

export type RecordAuditInput = {
    admin: SupabaseClient;
    actor: PlatformActor | null;
    action: PlatformAuditAction | string;
    resourceType: string;
    resourceId?: string | null;
    companyId?: string | null;
    requestId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
    outcome?: "success" | "failure" | "denied";
};

export async function recordPlatformAudit(input: RecordAuditInput): Promise<string | null> {
    const { data, error } = await input.admin.rpc("rpc_platform_record_audit", {
        p_actor_id:      input.actor?.id ?? null,
        p_actor_email:   input.actor?.email ?? null,
        p_actor_role:    input.actor?.role ?? null,
        p_action:        input.action,
        p_resource_type: input.resourceType,
        p_resource_id:   input.resourceId ?? null,
        p_company_id:    input.companyId ?? null,
        p_request_id:    input.requestId,
        p_ip_address:    input.ipAddress ?? null,
        p_user_agent:    input.userAgent ?? null,
        p_before_state:  redactAuditState(input.beforeState),
        p_after_state:   redactAuditState(input.afterState),
        p_metadata:      input.metadata ?? {},
        p_outcome:       input.outcome ?? "success",
    });

    if (error) {
        console.error("[platform_audit]", error.message);
        return null;
    }
    return typeof data === "string" ? data : null;
}

export function newRequestId(existing?: string | null): string {
    const trimmed = existing?.trim();
    if (trimmed) return trimmed;
    return randomUUID();
}
