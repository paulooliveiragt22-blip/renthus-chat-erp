/**
 * Snapshots de listas admin (P5a / D-P6) — last-known por domínio + company_id.
 */

export type AdminSnapshotDomain =
    | "orders"
    | "fila"
    | "customers"
    | "customer_addresses"
    | "drivers"
    | "printers";

export const ADMIN_SNAPSHOT_DOMAINS: readonly AdminSnapshotDomain[] = [
    "orders",
    "fila",
    "customers",
    "customer_addresses",
    "drivers",
    "printers",
] as const;

export type AdminListSnapshot<T = unknown> = {
    companyId: string;
    domain: AdminSnapshotDomain;
    savedAt: string;
    version: string;
    entryCount: number;
    entries: T[];
};

export type AdminListSnapshotStore = {
    save<T>(snapshot: AdminListSnapshot<T>): Promise<void>;
    load<T>(companyId: string, domain: AdminSnapshotDomain): Promise<AdminListSnapshot<T> | null>;
    clear(companyId: string, domain?: AdminSnapshotDomain): Promise<void>;
};
