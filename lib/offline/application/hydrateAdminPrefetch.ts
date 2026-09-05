/**
 * P5a: prefetch admin (catálogo + listas) quando online — sem abrir cada aba.
 */

import { hydrateCatalogSnapshotFromApi } from "./hydrateCatalogSnapshot";
import type { CatalogSnapshotStore } from "../ports/CatalogSnapshotStore";
import type { AdminListSnapshotStore } from "../ports/AdminListSnapshotStore";
import type { AdminSnapshotDomain } from "../ports/AdminListSnapshotStore";
import { ADMIN_LIST_CAPS } from "../adapters/idbAdminListSnapshotStore";

export type AdminPrefetchResult = {
    catalogOk: boolean;
    domains: Partial<Record<AdminSnapshotDomain, { ok: boolean; count: number; error?: string }>>;
};

async function saveDomain(
    store: AdminListSnapshotStore,
    companyId: string,
    domain: AdminSnapshotDomain,
    entries: unknown[]
): Promise<number> {
    const capped = entries.slice(0, ADMIN_LIST_CAPS[domain]);
    const now = new Date().toISOString();
    await store.save({
        companyId,
        domain,
        savedAt: now,
        version: now,
        entryCount: capped.length,
        entries: capped,
    });
    return capped.length;
}

async function fetchJson(url: string): Promise<{ ok: boolean; json: Record<string, unknown> }> {
    const res = await fetch(url, { credentials: "include", cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, json };
}

/**
 * Baixa em paralelo (Promise.allSettled) e grava IDB.
 * Catálogo reutiliza hydrate existente (paginado).
 */
export async function hydrateAdminPrefetch(params: {
    companyId: string;
    catalogStore: CatalogSnapshotStore;
    listStore: AdminListSnapshotStore;
}): Promise<AdminPrefetchResult> {
    const { companyId, catalogStore, listStore } = params;
    const domains: AdminPrefetchResult["domains"] = {};

    const catalogTask = hydrateCatalogSnapshotFromApi(catalogStore, companyId)
        .then(() => true)
        .catch(() => false);

    const ordersTask = (async () => {
        const { ok, json } = await fetchJson("/api/admin/orders?page=1&limit=50&status=all");
        if (!ok) throw new Error(String(json.error ?? "orders_prefetch_failed"));
        const entries = Array.isArray(json.orders) ? json.orders : [];
        return saveDomain(listStore, companyId, "orders", entries);
    })();

    const filaTask = (async () => {
        const { ok, json } = await fetchJson("/api/admin/fila/pending-orders");
        if (!ok) throw new Error(String(json.error ?? "fila_prefetch_failed"));
        const entries = Array.isArray(json.orders) ? json.orders : [];
        return saveDomain(listStore, companyId, "fila", entries);
    })();

    const customersTask = (async () => {
        const { ok, json } = await fetchJson("/api/admin/customers");
        if (!ok) throw new Error(String(json.error ?? "customers_prefetch_failed"));
        const entries = Array.isArray(json.customers) ? json.customers : [];
        return saveDomain(listStore, companyId, "customers", entries);
    })();

    const addressesTask = (async () => {
        const { ok, json } = await fetchJson("/api/admin/customer-addresses/snapshot");
        if (!ok) throw new Error(String(json.error ?? "customer_addresses_prefetch_failed"));
        const entries = Array.isArray(json.addresses) ? json.addresses : [];
        return saveDomain(listStore, companyId, "customer_addresses", entries);
    })();

    const driversTask = (async () => {
        const { ok, json } = await fetchJson("/api/admin/drivers");
        if (!ok) throw new Error(String(json.error ?? "drivers_prefetch_failed"));
        const entries = Array.isArray(json.drivers) ? json.drivers : [];
        return saveDomain(listStore, companyId, "drivers", entries);
    })();

    const printersTask = (async () => {
        const { ok, json } = await fetchJson("/api/agent/keys");
        if (!ok) throw new Error(String(json.error ?? "printers_prefetch_failed"));
        const entries = Array.isArray(json.agents) ? json.agents : [];
        return saveDomain(listStore, companyId, "printers", entries);
    })();

    const settled = await Promise.allSettled([
        catalogTask,
        ordersTask,
        filaTask,
        customersTask,
        addressesTask,
        driversTask,
        printersTask,
    ]);

    const catalogOk = settled[0].status === "fulfilled" && settled[0].value === true;

    const domainOrder: AdminSnapshotDomain[] = [
        "orders",
        "fila",
        "customers",
        "customer_addresses",
        "drivers",
        "printers",
    ];
    for (let i = 0; i < domainOrder.length; i++) {
        const d = domainOrder[i]!;
        const r = settled[i + 1];
        if (r.status === "fulfilled") {
            domains[d] = { ok: true, count: r.value as number };
        } else {
            const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
            domains[d] = { ok: false, count: 0, error: msg };
        }
    }

    return { catalogOk, domains };
}
