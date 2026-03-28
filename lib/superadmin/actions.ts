"use server";

import { createAdminClient } from "@/lib/supabase/admin";

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
            .select("id, from_identifier, status, provider_metadata, created_at")
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

    return {
        company:  { ...company, subscriptions: undefined },
        sub,
        channels: channelsRes.data ?? [],
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
            id, from_identifier, status, provider_metadata, created_at,
            companies ( id, name )
        `)
        .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return data ?? [];
}

export async function updateChannelIdentifier(channelId: string, fromIdentifier: string) {
    const admin = createAdminClient();
    const { error } = await admin
        .from("whatsapp_channels")
        .update({ from_identifier: fromIdentifier })
        .eq("id", channelId);
    if (error) throw new Error(error.message);
}

export async function createChannel(companyId: string, data: {
    phone_number_id: string;
    access_token:    string;
    waba_id?:        string;
    whatsapp_phone?: string;
}) {
    const admin = createAdminClient();

    const { phone_number_id, access_token, waba_id, whatsapp_phone } = data;

    const { error: chErr } = await admin
        .from("whatsapp_channels")
        .insert({
            company_id:        companyId,
            provider:          "meta",
            status:            "active",
            from_identifier:   phone_number_id,
            provider_metadata: { access_token, ...(waba_id ? { waba_id } : {}) },
        });

    if (chErr) throw new Error(chErr.message);

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

    const updates: Record<string, unknown> = {};

    if (data.phone_number_id) updates.from_identifier = data.phone_number_id;

    if (data.access_token || data.waba_id) {
        const { data: ch } = await admin
            .from("whatsapp_channels")
            .select("provider_metadata")
            .eq("id", channelId)
            .single();

        const current = (ch?.provider_metadata as Record<string, unknown>) ?? {};
        updates.provider_metadata = {
            ...current,
            ...(data.access_token ? { access_token: data.access_token } : {}),
            ...(data.waba_id      ? { waba_id:      data.waba_id      } : {}),
        };
    }

    const { error } = await admin
        .from("whatsapp_channels")
        .update(updates)
        .eq("id", channelId);

    if (error) throw new Error(error.message);
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
    const { error } = await admin
        .from("whatsapp_channels")
        .update({ status })
        .eq("id", channelId);
    if (error) throw new Error(error.message);
}
