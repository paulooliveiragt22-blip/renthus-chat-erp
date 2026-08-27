export const PLATFORM_ROLES = [
    "superadmin",
    "ops",
    "billing",
    "support",
    "readonly",
] as const;

export type PlatformRole = (typeof PLATFORM_ROLES)[number];

const ROLE_SET = new Set<string>(PLATFORM_ROLES);

export function normalizePlatformRole(raw: unknown): PlatformRole | null {
    if (typeof raw !== "string") return null;
    const v = raw.trim().toLowerCase();
    return ROLE_SET.has(v) ? (v as PlatformRole) : null;
}

export function roleRequiresMfa(role: PlatformRole): boolean {
    return role === "superadmin" || role === "ops";
}
