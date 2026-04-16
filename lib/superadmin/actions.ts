"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
    encryptWaAccessToken,
    sanitizeWhatsappChannelForClient,
    stripProviderMetadataSecrets,
} from "@/lib/whatsapp/channelCredentials";
import { invalidateWaConfig } from "@/lib/whatsapp/waConfigCache";

function envNonEmpty(name: string): boolean {
    const v = process.env[name];
    return typeof v === "string" && v.trim().length > 0;
}

/** Diagnóstico operacional (apenas presença de variáveis, nunca valores). */
export async function getSecurityOpsStatus() {
    const vercelEnv = process.env.VERCEL_ENV ?? null;
    const nodeEnv   = process.env.NODE_ENV ?? "development";
    const isProd =
        process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";

    const checks = [
        {
            key:   "WHATSAPP_APP_SECRET",
            label: "WHATSAPP_APP_SECRET",
            ok:    envNonEmpty("WHATSAPP_APP_SECRET"),
            hint:  "Assinatura HMAC dos webhooks Meta; sem isto /api/whatsapp/incoming responde 500.",
        },
        {
            key:   "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
            label: "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
            ok:    envNonEmpty("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
            hint:  "Usado no GET de verificação do webhook na Meta.",
        },
        {
            key:   "CRON_SECRET",
            label: "CRON_SECRET",
            ok:    !isProd || envNonEmpty("CRON_SECRET"),
            hint:  "Em produção os crons exigem Authorization: Bearer; ausente ⇒ 500 server_misconfigured.",
        },
        {
            key:   "SUPERADMIN_SECRET",
            label: "SUPERADMIN_SECRET",
            ok:    envNonEmpty("SUPERADMIN_SECRET"),
            hint:  "Segredo do cookie sa_token; login do superadmin.",
        },
        {
            key:   "SUPABASE_SERVICE_ROLE_KEY",
            label: "SUPABASE_SERVICE_ROLE_KEY",
            ok:    envNonEmpty("SUPABASE_SERVICE_ROLE_KEY"),
            hint:  "Chave service role do Supabase (server).",
        },
        {
            key:   "NEXT_PUBLIC_SUPABASE_URL",
            label: "NEXT_PUBLIC_SUPABASE_URL",
            ok:    envNonEmpty("NEXT_PUBLIC_SUPABASE_URL"),
            hint:  "URL do projeto Supabase.",
        },
        {
            key:   "WHATSAPP_TOKEN",
            label: "WHATSAPP_TOKEN / plataforma",
            ok:    !isProd
                || envNonEmpty("PLATFORM_WHATSAPP_COMPANY_ID")
                || (envNonEmpty("WHATSAPP_TOKEN") && envNonEmpty("WHATSAPP_PHONE_NUMBER_ID")),
            hint:  "Em prod: canal por empresa no DB; ou PLATFORM_WHATSAPP_COMPANY_ID; ou par WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID para billing/legado.",
        },
        {
            key:   "CREDENTIALS_ENCRYPTION_KEY",
            label: "CREDENTIALS_ENCRYPTION_KEY",
            ok:    !isProd || envNonEmpty("CREDENTIALS_ENCRYPTION_KEY"),
            hint:  "Em produção, recomendado: base64 de 32 bytes (AES-256); tokens gravados em encrypted_access_token.",
        },
    ] as const;

    return { vercelEnv, nodeEnv, isProd, checks: [...checks] };
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardStats() {
    const admin = createAdminClient();

    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [companiesRes, ordersRes, revenueRes, channelsRes] = await Promise.all([
        admin.from("companies").select("id", { count: "exact", head: true }),
        admin.from("orders")
            .select("id", { count: "exact", head: true })
            .gte("created_at", start),
        admin.from("orders")
            .select("total_amount")
            .gte("created_at", start),
        admin.from("whatsapp_channels")
            .select("id", { count: "exact", head: true })
            .eq("status", "active"),
    ]);

    const revenue = (revenueRes.data ?? []).reduce(
        (s: number, o: { total_amount: number }) => s + (o.total_amount ?? 0), 0
    );

    return {
        totalCompanies:   companiesRes.count ?? 0,
        ordersThisMonth:  ordersRes.count    ?? 0,
        revenueThisMonth: revenue,
        activeChannels:   channelsRes.count  ?? 0,
    };
}

export async function getQueueHealthStats(periodMinutes = 15) {
    const admin = createAdminClient();
    const windowStart = new Date(Date.now() - periodMinutes * 60_000).toISOString();

    const [pendingRes, recentRes] = await Promise.all([
        admin
            .from("chatbot_queue")
            .select("company_id")
            .eq("status", "pending"),
        admin
            .from("chatbot_queue")
            .select("company_id, status, last_error")
            .gte("created_at", windowStart)
            .in("status", ["done", "failed"]),
    ]);

    if (pendingRes.error) throw new Error(pendingRes.error.message);
    if (recentRes.error) throw new Error(recentRes.error.message);

    const byCompany = new Map<string, QueueHealthBaseRow>();

    const ensure = (companyId: string) => ensureCompanyRow(byCompany, companyId);

    for (const row of pendingRes.data ?? []) {
        if (!row.company_id) continue;
        ensure(row.company_id).pendingNow += 1;
    }

    for (const row of recentRes.data ?? []) {
        if (!row.company_id) continue;
        const item = ensure(row.company_id);
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

    const items = [...byCompany.values()].map((item) => toQueueHealthRow(item))
        .filter((item) => item.pendingNow > 0 || item.processed15m > 0)
        .sort(compareQueueHealthRows);

    const summary = items.reduce(
        (acc, item) => {
            acc.pendingNow += item.pendingNow;
            acc.processed15m += item.processed15m;
            acc.failed15m += item.failed15m;
            acc.coalesced15m += item.coalesced15m;
            return acc;
        },
        { pendingNow: 0, processed15m: 0, failed15m: 0, coalesced15m: 0 }
    );

    const failureRate = ratio(summary.failed15m, summary.processed15m);
    const dedupHitRate = ratio(summary.coalesced15m, summary.processed15m - summary.failed15m);

    return {
        periodMinutes,
        summary: {
            ...summary,
            failureRate,
            dedupHitRate,
        },
        companies: items,
    };
}

/** Linha agregada de métricas PRO (`pro_pipeline.*`) na janela temporal (Super Admin). */
export type ProPipelineMetricAggregateRow = {
    companyId: string;
    companyName: string;
    metricName: string;
    reason: string | null;
    intent: string | null;
    errorCode: string | null;
    total: number;
};

type ProPipelineMetricRpcRow = {
    company_id: string;
    metric_name: string;
    reason_key: string;
    intent_key: string;
    error_code: string;
    total: number | string;
};

function coerceMetricTotal(v: number | string): number {
    return typeof v === "string" ? Number(v) : v;
}

/** Agrega `pro_pipeline_metric_events` por empresa, métrica e tags (reason / intent / errorCode). */
export async function getProPipelineHealthStats(periodMinutes = 15) {
    const admin = createAdminClient();
    const { data: raw, error } = await admin.rpc("superadmin_pro_pipeline_metric_totals", {
        p_window_minutes: periodMinutes,
    });
    if (error) throw new Error(error.message);

    const rows = (raw ?? []) as ProPipelineMetricRpcRow[];
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

    const aggregates: ProPipelineMetricAggregateRow[] = rows.map((r) => ({
        companyId:   r.company_id,
        companyName: nameById.get(r.company_id) ?? r.company_id,
        metricName:  r.metric_name,
        reason:      r.reason_key.length ? r.reason_key : null,
        intent:      r.intent_key.length ? r.intent_key : null,
        errorCode:   r.error_code.length ? r.error_code : null,
        total:       coerceMetricTotal(r.total),
    }));

    const volume = aggregates.reduce((s, r) => s + r.total, 0);

    return {
        periodMinutes,
        volume,
        rows: aggregates,
    };
}

type QueueHealthBaseRow = {
    companyId: string;
    companyName: string;
    pendingNow: number;
    done15m: number;
    failed15m: number;
    coalesced15m: number;
};

type QueueHealthRow = QueueHealthBaseRow & {
    processed15m: number;
    failureRate: number;
    dedupHitRate: number;
    severity: "green" | "yellow" | "red";
};

function ensureCompanyRow(map: Map<string, QueueHealthBaseRow>, companyId: string): QueueHealthBaseRow {
    if (!map.has(companyId)) {
        map.set(companyId, {
            companyId,
            companyName: companyId,
            pendingNow: 0,
            done15m: 0,
            failed15m: 0,
            coalesced15m: 0,
        });
    }
    return map.get(companyId)!;
}

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return numerator / denominator;
}

function toQueueHealthRow(item: QueueHealthBaseRow): QueueHealthRow {
    const processed15m = item.done15m + item.failed15m;
    const failureRate = ratio(item.failed15m, processed15m);
    const dedupHitRate = ratio(item.coalesced15m, item.done15m);
    return {
        ...item,
        processed15m,
        failureRate,
        dedupHitRate,
        severity: resolveQueueSeverity(failureRate, item.pendingNow),
    };
}

function resolveQueueSeverity(failureRate: number, pendingNow: number): "green" | "yellow" | "red" {
    if (failureRate > 0.03 || pendingNow >= 20) return "red";
    if (failureRate > 0 || pendingNow > 0) return "yellow";
    return "green";
}

function severityWeight(severity: "green" | "yellow" | "red"): number {
    if (severity === "red") return 2;
    if (severity === "yellow") return 1;
    return 0;
}

function compareQueueHealthRows(a: QueueHealthRow, b: QueueHealthRow): number {
    return (
        severityWeight(b.severity) - severityWeight(a.severity)
        || b.pendingNow - a.pendingNow
        || b.failed15m - a.failed15m
    );
}

// ─── Planos ───────────────────────────────────────────────────────────────────

export async function getPlans() {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from("plans")
        .select("id, key, name, price_cents")
        .order("price_cents");
    if (error) throw new Error(error.message);
    return data ?? [];
}

// ─── Empresas ─────────────────────────────────────────────────────────────────

export async function getCompanies() {
    const admin = createAdminClient();

    const { data, error } = await admin
        .from("companies")
        .select(`
            id, name, slug, email, phone, cidade, created_at, onboarding_completed_at, is_active,
            subscriptions ( plan_id, status, plans ( name ) )
        `)
        .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const ids = (data ?? []).map((c: any) => c.id);
    const orderCounts: Record<string, number> = {};

    if (ids.length) {
        const { data: counts } = await admin
            .from("orders")
            .select("company_id")
            .in("company_id", ids);

        (counts ?? []).forEach((o: { company_id: string }) => {
            orderCounts[o.company_id] = (orderCounts[o.company_id] ?? 0) + 1;
        });
    }

    return (data ?? []).map((c: any) => ({
        ...c,
        orderCount:   orderCounts[c.id] ?? 0,
        subscription: Array.isArray(c.subscriptions) ? c.subscriptions[0] : c.subscriptions,
    }));
}

export async function getCompany(id: string) {
    const admin = createAdminClient();

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

    const company = compRes.data as any;
    const sub = Array.isArray(company.subscriptions) ? company.subscriptions[0] : null;

    const rawChannels = channelsRes.data ?? [];

    return {
        company:  { ...company, subscriptions: undefined },
        sub,
        channels: rawChannels.map((row: any) => sanitizeWhatsappChannelForClient(row)),
        orders:   ordersRes.data   ?? [],
        users:    usersRes.data    ?? [],
    };
}

export async function createCompany(data: {
    name:          string;
    email?:        string;
    slug?:         string;
    cnpj?:         string;
    razao_social?: string;
    phone?:        string;
    cidade?:       string;
    plan_id:       string;
}) {
    const admin = createAdminClient();

    const { name, plan_id, ...rest } = data;

    const { data: company, error: cErr } = await admin
        .from("companies")
        .insert({ name, ...rest })
        .select("id")
        .single();

    if (cErr) throw new Error(cErr.message);

    const { error: sErr } = await admin
        .from("subscriptions")
        .insert({
            company_id: company.id,
            plan_id,
            status: "active",
            started_at: new Date().toISOString(),
        });

    if (sErr) throw new Error(sErr.message);

    return company.id as string;
}

export async function updateCompany(id: string, data: {
    name?:          string;
    email?:         string;
    slug?:          string;
    cnpj?:          string;
    razao_social?:  string;
    nome_fantasia?: string;
    phone?:         string;
    whatsapp_phone?: string;
    cidade?:        string;
    cep?:           string;
    endereco?:      string;
    numero?:        string;
    bairro?:        string;
    uf?:            string;
    is_active?:     boolean;
}) {
    const admin = createAdminClient();
    const { error } = await admin
        .from("companies")
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq("id", id);
    if (error) throw new Error(error.message);
}

export async function updateSubscription(subId: string, data: {
    plan_id?:      string;
    status?:       string;
    allow_overage?: boolean;
}) {
    const admin = createAdminClient();
    const { error } = await admin
        .from("subscriptions")
        .update(data)
        .eq("id", subId);
    if (error) throw new Error(error.message);
}

// ─── Canais WhatsApp ──────────────────────────────────────────────────────────

export async function getAllChannels() {
    const admin = createAdminClient();

    const { data, error } = await admin
        .from("whatsapp_channels")
        .select(`
            id, company_id, from_identifier, status, provider_metadata, encrypted_access_token, waba_id, created_at,
            companies ( id, name )
        `)
        .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => ({
        ...sanitizeWhatsappChannelForClient(row),
        companies: row.companies,
    }));
}

export async function updateChannelIdentifier(channelId: string, fromIdentifier: string) {
    const admin = createAdminClient();
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
}

export async function createChannel(companyId: string, data: {
    phone_number_id: string;
    access_token:    string;
    waba_id?:        string;
    whatsapp_phone?: string;
}) {
    const admin = createAdminClient();

    const phone_number_id = data.phone_number_id.trim();
    const access_token    = data.access_token.trim();
    const waba_id         = data.waba_id?.trim() || null;
    const whatsapp_phone  = data.whatsapp_phone;

    if (!phone_number_id || !access_token) {
        throw new Error("Phone Number ID e Access Token são obrigatórios.");
    }

    const enc = encryptWaAccessToken(access_token);
    const provider_metadata = enc
        ? {}
        : { access_token, ...(waba_id ? { waba_id } : {}) };

    const { data: inserted, error: chErr } = await admin
        .from("whatsapp_channels")
        .insert({
            company_id:             companyId,
            provider:               "meta",
            status:                 "active",
            from_identifier:        phone_number_id,
            encrypted_access_token: enc,
            waba_id,
            provider_metadata,
        })
        .select("id")
        .single();

    if (chErr) throw new Error(chErr.message);

    if (inserted?.id) {
        await admin.from("whatsapp_channel_credential_audit").insert({
            channel_id: inserted.id,
            company_id: companyId,
            action:     "create_channel",
            actor:      "superadmin_service",
        });
    }

    invalidateWaConfig(companyId);

    if (whatsapp_phone) {
        await admin
            .from("companies")
            .update({ whatsapp_phone, updated_at: new Date().toISOString() })
            .eq("id", companyId);
    }
}

export async function updateChannelCredentials(channelId: string, data: {
    phone_number_id?: string;
    access_token?:    string;
    waba_id?:         string;
}) {
    const admin = createAdminClient();

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
                updates.provider_metadata      = cleaned;
            } else {
                updates.encrypted_access_token = null;
                updates.provider_metadata      = { ...cleaned, access_token: tokenIn };
            }
        } else {
            updates.provider_metadata = cleaned;
        }
    }

    if (data.waba_id !== undefined) {
        const w = data.waba_id.trim();
        updates.waba_id = w || null;
    }

    if (Object.keys(updates).length === 0) return;

    const { error } = await admin
        .from("whatsapp_channels")
        .update(updates)
        .eq("id", channelId);

    if (error) throw new Error(error.message);

    await admin.from("whatsapp_channel_credential_audit").insert({
        channel_id: channelId,
        company_id: companyId,
        action:     "update_credentials",
        actor:      "superadmin_service",
    });

    invalidateWaConfig(companyId);
}

// ─── Pedidos (cross-empresa) ──────────────────────────────────────────────────

export async function getAllOrders(page = 0, limit = 50) {
    const admin = createAdminClient();

    const { data, error, count } = await admin
        .from("orders")
        .select(`
            id, total_amount, status, payment_method,
            created_at, source,
            companies ( id, name )
        `, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * limit, (page + 1) * limit - 1);

    if (error) throw new Error(error.message);
    return { orders: data ?? [], total: count ?? 0 };
}

// ─── Ações de gestão ─────────────────────────────────────────────────────────

export async function updateChannelStatus(channelId: string, status: "active" | "inactive") {
    const admin = createAdminClient();
    const { data: row } = await admin
        .from("whatsapp_channels")
        .select("company_id")
        .eq("id", channelId)
        .maybeSingle();
    const { error } = await admin
        .from("whatsapp_channels")
        .update({ status })
        .eq("id", channelId);
    if (error) throw new Error(error.message);
    if (row?.company_id) invalidateWaConfig(row.company_id as string);
}
