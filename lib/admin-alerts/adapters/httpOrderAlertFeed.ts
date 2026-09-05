import type { AdminAlert } from "../domain/AdminAlert";
import { orderAlertCode, orderSourceLabel } from "../domain/AdminAlert";
import { orderOpenHref } from "../domain/AlertDeepLink";
import type { AlertFeed } from "../ports/AlertPorts";

type SnapshotOrder = {
    id: string;
    createdAt: string;
    source: string | null;
    totalAmount: number;
};

export function mapOrderSnapshotToAlerts(orders: SnapshotOrder[]): AdminAlert[] {
    return orders.map((o) => {
        const total = o.totalAmount.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
        });
        return {
            id: `order:${o.id}`,
            kind: "order_new",
            title: `Pedido ${orderAlertCode(o.id)}`,
            description: `${orderSourceLabel(o.source)} · ${total}`,
            href: orderOpenHref(o.id),
            createdAt: o.createdAt,
            actionLabel: "Abrir pedido",
        };
    });
}

export function createHttpOrderAlertFeed(): AlertFeed {
    return {
        async fetchAlerts() {
            const res = await fetch("/api/admin/orders/notify-snapshot", {
                credentials: "include",
                cache: "no-store",
            });
            if (!res.ok) return [];
            const json = (await res.json().catch(() => ({}))) as {
                orders?: SnapshotOrder[];
            };
            return mapOrderSnapshotToAlerts(json.orders ?? []);
        },
    };
}
