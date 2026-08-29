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
