import type { SupabaseClient } from "@supabase/supabase-js";
import {
    encryptWaAccessToken,
    sanitizeWhatsappChannelForClient,
    stripProviderMetadataSecrets,
} from "@/lib/whatsapp/channelCredentials";
import { invalidateWaConfig } from "@/lib/whatsapp/waConfigCache";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import type { PlatformActor } from "@/lib/platform/requirePlatformAccess";

export type PlatformOpsAuditCtx = {
    actor: PlatformActor;
    requestId: string;
    ipAddress: string;
    userAgent: string | null;
};

function envNonEmpty(name: string): boolean {
    const v = process.env[name];
    return typeof v === "string" && v.trim().length > 0;
}

export function getSecurityOpsStatus() {
    const vercelEnv = process.env.VERCEL_ENV ?? null;
    const nodeEnv = process.env.NODE_ENV ?? "development";
    const isProd =
        process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

    const checks = [
        {
            key: "WHATSAPP_APP_SECRET",
            label: "WHATSAPP_APP_SECRET",
            ok: envNonEmpty("WHATSAPP_APP_SECRET"),
            hint: "Assinatura HMAC dos webhooks Meta.",
        },
        {
            key: "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
            label: "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
            ok: envNonEmpty("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
            hint: "Verificação GET webhook Meta.",
        },
        {
            key: "CRON_SECRET",
            label: "CRON_SECRET",
            ok: !isProd || envNonEmpty("CRON_SECRET"),
            hint: "Crons exigem Bearer em produção.",
        },
        {
            key: "PLATFORM_ADMIN_IP_ALLOWLIST",
            label: "PLATFORM_ADMIN_IP_ALLOWLIST",
            ok: !isProd || envNonEmpty("PLATFORM_ADMIN_IP_ALLOWLIST"),
            hint: "Allowlist IP para /platform em produção.",
        },
        {
            key: "SUPABASE_SERVICE_ROLE_KEY",
            label: "SUPABASE_SERVICE_ROLE_KEY",
            ok: envNonEmpty("SUPABASE_SERVICE_ROLE_KEY"),
            hint: "Chave service role.",
        },
        {
            key: "NEXT_PUBLIC_SUPABASE_URL",
            label: "NEXT_PUBLIC_SUPABASE_URL",
            ok: envNonEmpty("NEXT_PUBLIC_SUPABASE_URL"),
            hint: "URL Supabase.",
        },
        {
            key: "CREDENTIALS_ENCRYPTION_KEY",
            label: "CREDENTIALS_ENCRYPTION_KEY",
            ok: !isProd || envNonEmpty("CREDENTIALS_ENCRYPTION_KEY"),
            hint: "AES-256 tokens WA.",
        },
    ] as const;

    return { vercelEnv, nodeEnv, isProd, checks: [...checks] };
}

export async function getDashboardStats(admin: SupabaseClient) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [companiesRes, ordersRes, revenueRes, channelsRes] = await Promise.all([
        admin.from("companies").select("id", { count: "exact", head: true }),
        admin
            .from("orders")
            .select("id", { count: "exact", head: true })
            .gte("created_at", start),
        admin.from("orders").select("total_amount").gte("created_at", start),
        admin
            .from("whatsapp_channels")
            .select("id", { count: "exact", head: true })
            .eq("status", "active"),
    ]);

    const revenue = (revenueRes.data ?? []).reduce(
        (s: number, o: { total_amount: number }) => s + (o.total_amount ?? 0),
        0
    );

    return {
        totalCompanies: companiesRes.count ?? 0,
        ordersThisMonth: ordersRes.count ?? 0,
        revenueThisMonth: revenue,
        activeChannels: channelsRes.count ?? 0,
    };
}

type QueueHealthBaseRow = {
    companyId: string;
    companyName: string;
    pendingNow: number;
    oldestPendingAgeSec: number;
    done15m: number;
    failed15m: number;
    coalesced15m: number;
};

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return numerator / denominator;
}

function ensureCompanyRow(map: Map<string, QueueHealthBaseRow>, companyId: string): QueueHealthBaseRow {
    if (!map.has(companyId)) {
        map.set(companyId, {
            companyId,
            companyName: companyId,
            pendingNow: 0,
            oldestPendingAgeSec: 0,
            done15m: 0,
            failed15m: 0,
            coalesced15m: 0,
        });
    }
    return map.get(companyId)!;
}

export async function getQueueHealthStats(admin: SupabaseClient, periodMinutes = 15) {
    const windowStart = new Date(Date.now() - periodMinutes * 60_000).toISOString();

    const [pendingRes, recentRes, oldestPendingRes] = await Promise.all([
        admin.from("chatbot_queue").select("company_id, scheduled_at").eq("status", "pending"),
        admin
            .from("chatbot_queue")
            .select("company_id, status, last_error")
            .gte("created_at", windowStart)
            .in("status", ["done", "failed"]),
        admin
            .from("chatbot_queue")
            .select("scheduled_at")
            .eq("status", "pending")
            .order("scheduled_at", { ascending: true })
            .limit(1)
            .maybeSingle(),
    ]);

    if (pendingRes.error) throw new Error(pendingRes.error.message);
    if (recentRes.error) throw new Error(recentRes.error.message);

    const byCompany = new Map<string, QueueHealthBaseRow>();
    const nowMs = Date.now();
    let globalOldestAgeSec = 0;

    for (const row of pendingRes.data ?? []) {
        if (!row.company_id) continue;
        const item = ensureCompanyRow(byCompany, row.company_id);
        item.pendingNow += 1;
        if (typeof row.scheduled_at === "string") {
            const age = Math.max(0, Math.floor((nowMs - new Date(row.scheduled_at).getTime()) / 1000));
            if (age > item.oldestPendingAgeSec) item.oldestPendingAgeSec = age;
            if (age > globalOldestAgeSec) globalOldestAgeSec = age;
        }
    }

    if (typeof oldestPendingRes.data?.scheduled_at === "string") {
        const age = Math.max(
            0,
            Math.floor((nowMs - new Date(oldestPendingRes.data.scheduled_at).getTime()) / 1000)
        );
        if (age > globalOldestAgeSec) globalOldestAgeSec = age;
    }

    for (const row of recentRes.data ?? []) {
        if (!row.company_id) continue;
        const item = ensureCompanyRow(byCompany, row.company_id);
        if (row.status === "failed") item.failed15m += 1;
        if (row.status === "done") item.done15m += 1;
        if (row.last_error === "coalesced_duplicate_inbound") item.coalesced15m += 1;
    }

    const companyIds = [...byCompany.keys()];
    if (companyIds.length) {
        const { data: companies, error: companiesErr } = await admin
            .from("companies")
            .select("id, name")
            .in("id", companyIds);
        if (companiesErr) throw new Error(companiesErr.message);
        for (const c of companies ?? []) {
            const item = byCompany.get(c.id);
            if (item) item.companyName = c.name ?? c.id;
        }
    }

    const items = [...byCompany.values()]
        .map((item) => {
            const processed15m = item.done15m + item.failed15m;
            const failureRate = ratio(item.failed15m, processed15m);
            const dedupHitRate = ratio(item.coalesced15m, item.done15m);
            const severity =
                failureRate > 0.03 || item.pendingNow >= 20
                    ? "red"
                    : failureRate > 0 || item.pendingNow > 0
                      ? "yellow"
                      : "green";
            return { ...item, processed15m, failureRate, dedupHitRate, severity };
        })
        .filter((item) => item.pendingNow > 0 || item.processed15m > 0);

    const summary = items.reduce(
        (acc, item) => {
            acc.pendingNow += item.pendingNow;
            acc.processed15m += item.processed15m;
            acc.failed15m += item.failed15m;
            acc.coalesced15m += item.coalesced15m;
            if (item.oldestPendingAgeSec > acc.oldestPendingAgeSec) {
                acc.oldestPendingAgeSec = item.oldestPendingAgeSec;
            }
            return acc;
        },
        {
            pendingNow: 0,
            processed15m: 0,
            failed15m: 0,
            coalesced15m: 0,
            oldestPendingAgeSec: globalOldestAgeSec,
        }
    );

    return {
        periodMinutes,
        summary: {
            ...summary,
            failureRate: ratio(summary.failed15m, summary.processed15m),
            dedupHitRate: ratio(summary.coalesced15m, summary.processed15m - summary.failed15m),
        },
        companies: items,
    };
}

export async function getProPipelineHealthStats(admin: SupabaseClient, periodMinutes = 15) {
    const { data: raw, error } = await admin.rpc("superadmin_pro_pipeline_metric_totals", {
        p_window_minutes: periodMinutes,
    });
    if (error) throw new Error(error.message);

    type RpcRow = {
        company_id: string;
        metric_name: string;
        reason_key: string;
        intent_key: string;
        error_code: string;
        provider_key: string;
        total: number | string;
    };

    const rows = (raw ?? []) as RpcRow[];
    const companyIds = [...new Set(rows.map((r) => r.company_id))];
    const nameById = new Map<string, string>();
    if (companyIds.length) {
        const { data: companies, error: companiesErr } = await admin
            .from("companies")
            .select("id, name")
            .in("id", companyIds);
        if (companiesErr) throw new Error(companiesErr.message);
        for (const c of companies ?? []) {
            nameById.set(c.id, c.name ?? c.id);
        }
    }

    const aggregates = rows.map((r) => ({
        companyId: r.company_id,
        companyName: nameById.get(r.company_id) ?? r.company_id,
        metricName: r.metric_name,
        reason: r.reason_key.length ? r.reason_key : null,
        intent: r.intent_key.length ? r.intent_key : null,
        errorCode: r.error_code.length ? r.error_code : null,
        provider: r.provider_key.length ? r.provider_key : null,
        total: typeof r.total === "string" ? Number(r.total) : r.total,
    }));

    return {
        periodMinutes,
        volume: aggregates.reduce((s, r) => s + r.total, 0),
        rows: aggregates,
    };
}

export async function getPlans(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("plans")
        .select("id, key, name, price_cents")
        .order("price_cents");
    if (error) throw new Error(error.message);
    return data ?? [];
}

export async function getCompanies(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("companies")
        .select(`
            id, name, slug, email, phone, cidade, created_at, onboarding_completed_at, is_active,
            subscriptions ( plan_id, status, plans ( name ) )
        `)
        .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const ids = (data ?? []).map((c: { id: string }) => c.id);
    const orderCounts: Record<string, number> = {};

    if (ids.length) {
        const { data: counts } = await admin.from("orders").select("company_id").in("company_id", ids);
        (counts ?? []).forEach((o: { company_id: string }) => {
            orderCounts[o.company_id] = (orderCounts[o.company_id] ?? 0) + 1;
        });
    }

    return (data ?? []).map((c: Record<string, unknown> & { id: string; subscriptions?: unknown }) => ({
        ...c,
        orderCount: orderCounts[c.id] ?? 0,
        subscription: Array.isArray(c.subscriptions) ? c.subscriptions[0] : c.subscriptions,
    }));
}

export async function getCompany(admin: SupabaseClient, id: string) {
    const [compRes, channelsRes, ordersRes, usersRes] = await Promise.all([
        admin
            .from("companies")
            .select(`
                id, name, slug, email, phone, cnpj, razao_social, nome_fantasia,
                cidade, cep, endereco, numero, bairro, uf, whatsapp_phone,
                created_at, onboarding_completed_at, is_active,
                subscriptions ( id, plan_id, status, allow_overage, started_at, plans ( id, name ) )
            `)
            .eq("id", id)
            .maybeSingle(),
        admin
            .from("whatsapp_channels")
            .select("id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at")
            .eq("company_id", id)
            .order("created_at", { ascending: false }),
        admin
            .from("orders")
            .select("id, total_amount, status, payment_method, created_at")
            .eq("company_id", id)
            .order("created_at", { ascending: false })
            .limit(20),
        admin
            .from("company_users")
            .select("user_id, role, created_at")
            .eq("company_id", id)
            .limit(10),
    ]);

    if (!compRes.data) return null;

    const company = compRes.data as Record<string, unknown> & { subscriptions?: unknown };
    const sub = Array.isArray(company.subscriptions) ? company.subscriptions[0] : null;
    const rawChannels = channelsRes.data ?? [];

    return {
        company: { ...company, subscriptions: undefined },
        sub,
        channels: rawChannels.map((row: Record<string, unknown>) =>
            sanitizeWhatsappChannelForClient(row as Parameters<typeof sanitizeWhatsappChannelForClient>[0])
        ),
        orders: ordersRes.data ?? [],
        users: usersRes.data ?? [],
    };
}

export async function createCompany(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    data: {
        name: string;
        email?: string;
        slug?: string;
        cnpj?: string;
        razao_social?: string;
        phone?: string;
        cidade?: string;
        plan_id: string;
    }
) {
    const { name, plan_id, ...rest } = data;

    const { data: company, error: cErr } = await admin
        .from("companies")
        .insert({ name, ...rest })
        .select("id")
        .single();

    if (cErr) throw new Error(cErr.message);

    const { error: sErr } = await admin.from("subscriptions").insert({
        company_id: company.id,
        plan_id,
        status: "active",
        started_at: new Date().toISOString(),
    });

    if (sErr) throw new Error(sErr.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.company.created",
        resourceType: "company",
        resourceId: company.id,
        companyId: company.id,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        afterState: { name, plan_id },
    });

    return company.id as string;
}

export async function updateCompany(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    id: string,
    data: Record<string, unknown>
) {
    const { data: before } = await admin
        .from("companies")
        .select("name, email, slug, is_active")
        .eq("id", id)
        .maybeSingle();

    const { error } = await admin
        .from("companies")
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq("id", id);
    if (error) throw new Error(error.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.company.updated",
        resourceType: "company",
        resourceId: id,
        companyId: id,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        beforeState: (before as Record<string, unknown>) ?? null,
        afterState: data,
    });
}

export async function suspendCompany(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    companyId: string,
    reason: string
) {
    const { error } = await admin.rpc("rpc_platform_suspend_company", {
        p_company_id: companyId,
        p_actor_id: audit.actor.id,
        p_actor_email: audit.actor.email,
        p_actor_role: audit.actor.role,
        p_request_id: audit.requestId,
        p_ip_address: audit.ipAddress,
        p_user_agent: audit.userAgent,
        p_reason: reason,
    });
    if (error) throw new Error(error.message);
}

export async function reactivateCompany(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    companyId: string,
    reason: string
) {
    const { error } = await admin.rpc("rpc_platform_reactivate_company", {
        p_company_id: companyId,
        p_actor_id: audit.actor.id,
        p_actor_email: audit.actor.email,
        p_actor_role: audit.actor.role,
        p_request_id: audit.requestId,
        p_ip_address: audit.ipAddress,
        p_user_agent: audit.userAgent,
        p_reason: reason,
    });
    if (error) throw new Error(error.message);
}

export async function getAllChannels(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("whatsapp_channels")
        .select(`
            id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at,
            companies ( id, name )
        `)
        .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row: Record<string, unknown>) => ({
        ...sanitizeWhatsappChannelForClient(row as Parameters<typeof sanitizeWhatsappChannelForClient>[0]),
        companies: row.companies,
    }));
}

export async function updateChannelIdentifier(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    channelId: string,
    fromIdentifier: string
) {
    const { data: row } = await admin
        .from("whatsapp_channels")
        .select("company_id")
        .eq("id", channelId)
        .maybeSingle();
    const { error } = await admin
        .from("whatsapp_channels")
        .update({ from_identifier: fromIdentifier })
        .eq("id", channelId);
    if (error) throw new Error(error.message);
    if (row?.company_id) invalidateWaConfig(row.company_id as string);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.channel.updated",
        resourceType: "channel",
        resourceId: channelId,
        companyId: row?.company_id as string | undefined,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        afterState: { from_identifier: fromIdentifier },
    });
}

export async function createChannel(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    companyId: string,
    data: {
        phone_number_id: string;
        access_token: string;
        waba_id?: string;
        whatsapp_phone?: string;
    }
) {
    const phone_number_id = data.phone_number_id.trim();
    const access_token = data.access_token.trim();
    const waba_id = data.waba_id?.trim() || null;

    if (!phone_number_id || !access_token) {
        throw new Error("Phone Number ID e Access Token são obrigatórios.");
    }

    const enc = encryptWaAccessToken(access_token);
    const provider_metadata = enc ? {} : { access_token, ...(waba_id ? { waba_id } : {}) };

    const { data: inserted, error: chErr } = await admin
        .from("whatsapp_channels")
        .insert({
            company_id: companyId,
            provider: "meta",
            status: "active",
            from_identifier: phone_number_id,
            encrypted_access_token: enc,
            waba_id,
            provider_metadata,
        })
        .select("id")
        .single();

    if (chErr) throw new Error(chErr.message);

    const actorLabel = `platform:${audit.actor.id}`;
    if (inserted?.id) {
        await admin.from("whatsapp_channel_credential_audit").insert({
            channel_id: inserted.id,
            company_id: companyId,
            action: "create_channel",
            actor: actorLabel,
        });
    }

    invalidateWaConfig(companyId);

    if (data.whatsapp_phone) {
        await admin
            .from("companies")
            .update({ whatsapp_phone: data.whatsapp_phone, updated_at: new Date().toISOString() })
            .eq("id", companyId);
    }

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.channel.created",
        resourceType: "channel",
        resourceId: inserted?.id,
        companyId,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
    });
}

export async function updateChannelCredentials(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    channelId: string,
    data: {
        phone_number_id?: string;
        access_token?: string;
        waba_id?: string;
    }
) {
    const { data: ch, error: loadErr } = await admin
        .from("whatsapp_channels")
        .select("company_id, provider_metadata, encrypted_access_token")
        .eq("id", channelId)
        .single();

    if (loadErr || !ch) throw new Error(loadErr?.message ?? "Canal não encontrado");

    const companyId = ch.company_id as string;
    const updates: Record<string, unknown> = {};

    if (data.phone_number_id?.trim()) {
        updates.from_identifier = data.phone_number_id.trim();
    }

    const tokenIn = data.access_token?.trim() ?? "";
    const metaNeedsTouch = Boolean(tokenIn) || data.waba_id !== undefined;

    if (metaNeedsTouch) {
        const current = (ch.provider_metadata as Record<string, unknown>) ?? {};
        const cleaned = stripProviderMetadataSecrets(current);

        if (tokenIn) {
            const enc = encryptWaAccessToken(tokenIn);
            if (enc) {
                updates.encrypted_access_token = enc;
                updates.provider_metadata = cleaned;
            } else {
                updates.encrypted_access_token = null;
                updates.provider_metadata = { ...cleaned, access_token: tokenIn };
            }
        } else {
            updates.provider_metadata = cleaned;
        }
    }

    if (data.waba_id !== undefined) {
        updates.waba_id = data.waba_id.trim() || null;
    }

    if (Object.keys(updates).length === 0) return;

    const { error } = await admin.from("whatsapp_channels").update(updates).eq("id", channelId);
    if (error) throw new Error(error.message);

    await admin.from("whatsapp_channel_credential_audit").insert({
        channel_id: channelId,
        company_id: companyId,
        action: "update_credentials",
        actor: `platform:${audit.actor.id}`,
    });

    invalidateWaConfig(companyId);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.channel.credentials_updated",
        resourceType: "channel",
        resourceId: channelId,
        companyId,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
    });
}

export async function updateChannelStatus(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    channelId: string,
    status: "active" | "inactive"
) {
    const { data: row } = await admin
        .from("whatsapp_channels")
        .select("company_id")
        .eq("id", channelId)
        .maybeSingle();
    const { error } = await admin.from("whatsapp_channels").update({ status }).eq("id", channelId);
    if (error) throw new Error(error.message);
    if (row?.company_id) invalidateWaConfig(row.company_id as string);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.channel.status_changed",
        resourceType: "channel",
        resourceId: channelId,
        companyId: row?.company_id as string | undefined,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        afterState: { status },
    });
}

export async function getAllOrders(admin: SupabaseClient, page = 0, limit = 50) {
    const { data, error, count } = await admin
        .from("orders")
        .select(
            `
            id, total_amount, status, payment_method,
            created_at, source,
            companies ( id, name )
        `,
            { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range(page * limit, (page + 1) * limit - 1);

    if (error) throw new Error(error.message);
    return { orders: data ?? [], total: count ?? 0 };
}

export async function listPlatformAudit(
    admin: SupabaseClient,
    opts: { limit: number; offset: number; companyId?: string; action?: string }
) {
    let q = admin
        .from("platform_audit_log")
        .select(
            "id, occurred_at, actor_email, actor_role, action, resource_type, resource_id, company_id, outcome",
            { count: "exact" }
        )
        .order("occurred_at", { ascending: false })
        .range(opts.offset, opts.offset + opts.limit - 1);

    if (opts.companyId) q = q.eq("company_id", opts.companyId);
    if (opts.action) q = q.eq("action", opts.action);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: data ?? [], total: count ?? 0 };
}

export async function listPlatformUsers(admin: SupabaseClient) {
    const { data, error } = await admin
        .from("platform_users")
        .select("id, email, display_name, role, is_active, mfa_required, last_login_at, created_at")
        .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
}

export async function updateSubscription(
    admin: SupabaseClient,
    audit: PlatformOpsAuditCtx,
    subId: string,
    data: { plan_id?: string; status?: string; allow_overage?: boolean }
) {
    const { data: before } = await admin
        .from("subscriptions")
        .select("plan_id, status, allow_overage, company_id")
        .eq("id", subId)
        .maybeSingle();

    const { error } = await admin.from("subscriptions").update(data).eq("id", subId);
    if (error) throw new Error(error.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.company.updated",
        resourceType: "subscription",
        resourceId: subId,
        companyId: (before as { company_id?: string } | null)?.company_id ?? null,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        beforeState: (before as Record<string, unknown>) ?? null,
        afterState: data,
    });
}
