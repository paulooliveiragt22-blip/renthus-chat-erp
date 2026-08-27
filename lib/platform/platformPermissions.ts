import type { PlatformRole } from "./platformRoles";

export const PLATFORM_PERMISSIONS = [
    "platform.companies.read",
    "platform.companies.write",
    "platform.companies.suspend",
    "platform.billing.read",
    "platform.billing.write",
    "platform.channels.read",
    "platform.channels.write",
    "platform.orders.read",
    "platform.orders.reverse",
    "platform.impersonate",
    "platform.users.manage",
    "platform.audit.read",
    "platform.metrics.read",
    "platform.feature_flags.write",
    "platform.security.read",
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];

const MATRIX: Record<PlatformRole, readonly PlatformPermission[]> = {
    superadmin: PLATFORM_PERMISSIONS,
    ops: [
        "platform.companies.read",
        "platform.companies.write",
        "platform.companies.suspend",
        "platform.channels.read",
        "platform.channels.write",
        "platform.orders.read",
        "platform.audit.read",
        "platform.metrics.read",
        "platform.feature_flags.write",
        "platform.security.read",
    ],
    billing: [
        "platform.companies.read",
        "platform.billing.read",
        "platform.billing.write",
        "platform.audit.read",
    ],
    support: [
        "platform.companies.read",
        "platform.channels.read",
        "platform.orders.read",
        "platform.impersonate",
        "platform.audit.read",
    ],
    readonly: [
        "platform.companies.read",
        "platform.billing.read",
        "platform.channels.read",
        "platform.orders.read",
        "platform.audit.read",
        "platform.metrics.read",
    ],
};

export function platformRoleHasPermission(
    role: PlatformRole,
    permission: PlatformPermission
): boolean {
    return MATRIX[role].includes(permission);
}
