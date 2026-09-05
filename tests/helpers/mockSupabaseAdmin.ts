/**
 * Mock mínimo do client Supabase (query builder + `rpc`) usado nos testes de integração/unitários
 * que precisam simular tabelas em memória sem bater no banco real. Extraído de
 * `tests/integration/chatbot-queue-e2e.test.ts` pra reuso (evita duplicar o mesmo mock em cada
 * teste novo que precisa de `.from().eq().maybeSingle()` etc.).
 *
 * Suporta só o subconjunto de métodos encadeáveis realmente usado pelos testes atuais — não é um
 * mock completo do `@supabase/supabase-js`. Se um teste novo precisar de um método não coberto
 * aqui (`neq`, `or`, etc.), estender este arquivo em vez de criar outro mock paralelo.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
}

function matches(row: Row, filters: Array<(r: Row) => boolean>): boolean {
    return filters.every((fn) => fn(row));
}

export interface MockAdminHandle {
    client: {
        from: (tableName: string) => Record<string, unknown>;
        rpc: (name: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    };
    writes: Array<{ table: string; operation: string; data: unknown }>;
    tables: Tables;
}

/**
 * Cria um client mock cujo `rpc("claim_chatbot_queue_jobs", ...)` simula o claim atômico
 * (pending → processing) sobre `tables.chatbot_queue`. Qualquer outro nome de RPC retorna erro
 * `rpc not found` — estenda aqui se um teste precisar mockar outra RPC.
 */
export function makeMockAdmin(tables: Tables): MockAdminHandle {
    const writes: Array<{ table: string; operation: string; data: unknown }> = [];
    let idSeq = 1;

    function chain(tableName: string, filters: Array<(r: Row) => boolean> = []) {
        const table = tables[tableName] ?? (tables[tableName] = []);
        const api: Record<string, unknown> = {
            select: () => chain(tableName, filters),
            eq: (key: string, value: unknown) => chain(tableName, [...filters, (r) => r[key] === value]),
            is: (key: string, value: unknown) =>
                chain(tableName, [
                    ...filters,
                    (r) => (value === null ? r[key] == null : r[key] === value),
                ]),
            in: (key: string, values: unknown[]) => chain(tableName, [...filters, (r) => values.includes(r[key])]),
            lt: (key: string, value: unknown) => chain(tableName, [...filters, (r) => String(r[key] ?? "") < String(value)]),
            lte: (key: string, value: unknown) => chain(tableName, [...filters, (r) => String(r[key] ?? "") <= String(value)]),
            gte: (key: string, value: unknown) => chain(tableName, [...filters, (r) => String(r[key] ?? "") >= String(value)]),
            order: () => chain(tableName, filters),
            limit: () => chain(tableName, filters),
            maybeSingle: async () => {
                const row = table.find((r) => matches(r, filters)) ?? null;
                return { data: row, error: null };
            },
            single: async () => {
                const row = table.find((r) => matches(r, filters)) ?? null;
                return { data: row, error: row ? null : { message: "not found" } };
            },
            then: (resolve: (v: unknown) => void) => {
                const data = table.filter((r) => matches(r, filters));
                // `.select("id", { count: "exact", head: true })` (sem `.then` explícito no route)
                // ainda resolve via este thenable — expõe `count` igual ao Supabase real.
                return Promise.resolve({ data, error: null, count: data.length }).then(resolve);
            },
            insert: (data: Row | Row[]) => {
                const arr = Array.isArray(data) ? data : [data];
                const inserted = arr.map((item) => {
                    const row = { ...item };
                    if (!row.id) row.id = `${tableName}-${idSeq++}`;
                    if (!row.created_at) row.created_at = new Date().toISOString();
                    table.push(row);
                    return row;
                });
                writes.push({ table: tableName, operation: "insert", data: clone(arr) });
                return {
                    select: () => ({
                        single: async () => ({ data: inserted[0] ?? null, error: null }),
                        maybeSingle: async () => ({ data: inserted[0] ?? null, error: null }),
                    }),
                    single: async () => ({ data: inserted[0] ?? null, error: null }),
                    then: (resolve: (v: unknown) => void) =>
                        Promise.resolve({ data: inserted, error: null }).then(resolve),
                };
            },
            update: (patch: Row) => {
                const targets = table.filter((r) => matches(r, filters));
                for (const row of targets) Object.assign(row, patch);
                writes.push({ table: tableName, operation: "update", data: clone(patch) });
                return chain(tableName, filters);
            },
            delete: () => {
                const keep: Row[] = [];
                const removed: Row[] = [];
                for (const row of table) {
                    if (matches(row, filters)) removed.push(row);
                    else keep.push(row);
                }
                tables[tableName] = keep;
                writes.push({ table: tableName, operation: "delete", data: clone(removed) });
                return chain(tableName, []);
            },
        };
        return api;
    }

    return {
        client: {
            from: (tableName: string) => chain(tableName),
            rpc: async (name: string, params: Record<string, unknown>) => {
                // rpc_create_billing_obligation: cria/reusa invoice pending (amount canônico).
                // Amount vem do banco na produção; no mock devolve valor positivo estável.
                if (name === "rpc_create_billing_obligation") {
                    const companyId = params.p_company_id;
                    const kind = String(params.p_kind ?? "subscription");
                    const invoices = tables.invoices ?? (tables.invoices = []);
                    const existing = invoices.find(
                        (r) => r.status === "pending" && (r.kind == null || r.kind === kind)
                    );
                    if (existing) {
                        const cents = 27900;
                        const stored = Number.isFinite(Number(existing.amount))
                            ? Math.round(Number(existing.amount) * 100)
                            : 0;
                        const realigned = Math.abs(stored - cents) > 2;
                        if (realigned) {
                            existing.amount = cents / 100;
                            existing.pagarme_order_id = null;
                            existing.pix_qr_code = null;
                        }
                        return {
                            data: {
                                status: realigned ? "realigned" : "exists",
                                invoice_id: existing.id,
                                company_id: companyId,
                                kind,
                                amount_cents: cents,
                                created: false,
                                realigned,
                            },
                            error: null,
                        };
                    }
                    const row: Row = {
                        id: `invoices-${idSeq++}`,
                        company_id: companyId,
                        kind,
                        status: "pending",
                        amount: 279,
                        pagarme_order_id: null,
                        pix_qr_code: null,
                        created_at: new Date().toISOString(),
                    };
                    invoices.push(row);
                    return {
                        data: {
                            status: "created",
                            invoice_id: row.id,
                            company_id: companyId,
                            kind,
                            amount_cents: 27900,
                            created: true,
                        },
                        error: null,
                    };
                }
                if (name === "rpc_transition_billing_status") {
                    const companyId = params.p_company_id;
                    const to = String(params.p_to ?? "");
                    const cas = params.p_cas_updated_at;
                    const subs = tables.pagarme_subscriptions ?? (tables.pagarme_subscriptions = []);
                    const sub = subs.find((r) => r.company_id === companyId) ?? subs[0];
                    if (!sub) {
                        return { data: null, error: { message: "subscription_not_found" } };
                    }
                    const from = String(sub.status ?? "");
                    if (cas != null && sub.updated_at != null && sub.updated_at !== cas) {
                        return {
                            data: {
                                status: "conflict",
                                claimed: false,
                                from,
                                to,
                                reason: "cas_mismatch",
                            },
                            error: null,
                        };
                    }
                    if (from === to) {
                        if (to === "blocked") {
                            const companies = tables.companies ?? (tables.companies = []);
                            const co = companies.find((c) => c.id === companyId);
                            if (co) co.is_active = false;
                        }
                        return {
                            data: { status: "already", claimed: false, from, to },
                            error: null,
                        };
                    }
                    sub.status = to;
                    if (to === "blocked") {
                        const companies = tables.companies ?? (tables.companies = []);
                        const co = companies.find((c) => c.id === companyId);
                        if (co) co.is_active = false;
                    }
                    writes.push({
                        table: "pagarme_subscriptions",
                        operation: "rpc_transition_billing_status",
                        data: { company_id: companyId, from, to },
                    });
                    return {
                        data: { status: "transitioned", claimed: true, from, to },
                        error: null,
                    };
                }
                if (name === "rpc_mark_abandoned_due") {
                    const subs = tables.pagarme_subscriptions ?? [];
                    const companies = tables.companies ?? [];
                    const cutoff = Date.now() - 14 * 86_400_000;
                    const companyIds: string[] = [];
                    for (const sub of subs) {
                        const from = String(sub.status ?? "");
                        if (from !== "pending_payment" && from !== "pending_setup") continue;
                        if (sub.last_paid_at != null) continue;
                        if (sub.abandoned_at != null) continue;
                        const created = sub.created_at ? new Date(String(sub.created_at)).getTime() : 0;
                        if (created > cutoff) continue;
                        const co = companies.find((c) => c.id === sub.company_id);
                        if (!co || co.is_active !== false) continue;
                        sub.status = "abandoned";
                        sub.abandoned_at = new Date().toISOString();
                        companyIds.push(String(sub.company_id));
                    }
                    return {
                        data: { status: "ok", marked: companyIds.length, company_ids: companyIds },
                        error: null,
                    };
                }
                if (name === "rpc_list_commercial_plan_pricing") {
                    const defaults = [
                        { key: "essencial", price_cents: 27900, price_year_cents: 267840, ai_included_cents: 2790, yearly_discount_mode: "percent", yearly_discount_value: 2000 },
                        { key: "pro", price_cents: 34900, price_year_cents: 335040, ai_included_cents: 3490, yearly_discount_mode: "percent", yearly_discount_value: 2000 },
                        { key: "market", price_cents: 44900, price_year_cents: 431040, ai_included_cents: 4490, yearly_discount_mode: "percent", yearly_discount_value: 2000 },
                    ];
                    const fromTable = (tables.plans ?? []).filter((p) =>
                        ["essencial", "pro", "market"].includes(String(p.key))
                    );
                    const rows =
                        fromTable.length > 0
                            ? fromTable.map((p) => {
                                  const price = Number(p.price_cents ?? 0);
                                  return {
                                      key: String(p.key),
                                      price_cents: price,
                                      price_year_cents: Number(p.price_year_cents ?? 0),
                                      ai_included_cents: Math.floor((price * 10) / 100),
                                      yearly_discount_mode: p.yearly_discount_mode ?? "percent",
                                      yearly_discount_value: p.yearly_discount_value ?? 2000,
                                  };
                              })
                            : defaults;
                    return { data: rows, error: null };
                }
                if (name === "rpc_ai_included_budget") {
                    const companyId = params.p_company_id;
                    const subs = tables.pagarme_subscriptions ?? [];
                    const plans = tables.plans ?? [];
                    const sub = subs.find((r) => r.company_id === companyId) ?? subs[0];
                    const raw = String(sub?.plan ?? "essencial").toLowerCase();
                    const key =
                        raw === "bot" || raw === "starter"
                            ? "essencial"
                            : raw === "complete"
                              ? "pro"
                              : raw === "pro" || raw === "market"
                                ? raw
                                : "essencial";
                    const plan = plans.find((p) => p.key === key);
                    const price = Number(plan?.price_cents ?? (key === "market" ? 44900 : key === "pro" ? 34900 : 27900));
                    return { data: Math.floor((price * 10) / 100), error: null };
                }
                if (name !== "claim_chatbot_queue_jobs") return { data: null, error: { message: "rpc not found" } };
                const batch = Number(params.batch_size ?? 5);
                const maxAttempts = Number(params.max_attempts ?? 3);
                const queue = tables.chatbot_queue ?? [];
                const pending = queue
                    .filter((j) => j.status === "pending" && Number(j.attempts ?? 0) < maxAttempts)
                    .slice(0, batch);
                for (const job of pending) {
                    job.status = "processing";
                    job.attempts = Number(job.attempts ?? 0) + 1;
                }
                return { data: pending.map((j) => ({ id: j.id })), error: null };
            },
        },
        writes,
        tables,
    };
}
