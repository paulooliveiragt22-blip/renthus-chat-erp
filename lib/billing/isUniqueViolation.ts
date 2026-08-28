/** Detecta unique_violation Postgres (23505) em erros Supabase/PostgREST. */

export function isUniqueViolation(err: { code?: string; message?: string } | null | undefined): boolean {
    if (!err) return false;
    if (err.code === "23505") return true;
    const msg = typeof err.message === "string" ? err.message.toLowerCase() : "";
    return msg.includes("duplicate key") || msg.includes("unique constraint");
}
