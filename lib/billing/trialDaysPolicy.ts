/** Política de dias de trial — funções puras (testáveis sem Supabase). */

export const TRIAL_DAYS_MIN = 0;
export const TRIAL_DAYS_MAX = 90;

export function clampTrialDays(raw: unknown): number {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) return TRIAL_DAYS_MIN;
    return Math.max(TRIAL_DAYS_MIN, Math.min(TRIAL_DAYS_MAX, Math.floor(n)));
}

export function parseTrialDaysEnv(raw: string | undefined, fallback = TRIAL_DAYS_MIN): number {
    if (raw == null || raw.trim() === "") return clampTrialDays(fallback);
    return clampTrialDays(raw);
}
