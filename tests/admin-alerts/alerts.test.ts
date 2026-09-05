import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapOrderSnapshotToAlerts } from "../../lib/admin-alerts/adapters/httpOrderAlertFeed";
import { mapHandoverRowsToAlerts } from "../../lib/admin-alerts/adapters/httpHandoverAlertFeed";
import { createDedupeState, diffAlertFeed } from "../../lib/admin-alerts/application/presentNewAlerts";
import { orderOpenHref, threadOpenHref } from "../../lib/admin-alerts/domain/AlertDeepLink";

describe("admin-alerts deep links", () => {
    it("order e thread hrefs canônicos", () => {
        assert.equal(orderOpenHref("abc-123"), "/pedidos?open=abc-123");
        assert.equal(threadOpenHref("tid-1"), "/whatsapp?t=tid-1");
    });
});

describe("admin-alerts mappers", () => {
    it("map order snapshot", () => {
        const alerts = mapOrderSnapshotToAlerts([
            {
                id: "11111111-1111-1111-1111-111111111111",
                createdAt: "2026-09-05T12:00:00.000Z",
                source: "pdv_direct",
                totalAmount: 30,
            },
        ]);
        assert.equal(alerts.length, 1);
        assert.equal(alerts[0]?.kind, "order_new");
        assert.match(alerts[0]?.href ?? "", /\/pedidos\?open=/);
        assert.equal(alerts[0]?.actionLabel, "Abrir pedido");
    });

    it("map handover", () => {
        const alerts = mapHandoverRowsToAlerts([
            {
                threadId: "t1",
                handoverAt: "2026-09-05T12:00:00.000Z",
                channel: "instagram",
                profileName: "Ana",
                phoneE164: null,
                reason: "Quer atendente",
            },
        ]);
        assert.equal(alerts[0]?.kind, "chat_handover");
        assert.equal(alerts[0]?.href, "/whatsapp?t=t1");
        assert.match(alerts[0]?.title ?? "", /Instagram/);
    });
});

describe("admin-alerts dedupe", () => {
    it("primeiro poll não dispara; segundo detecta novo", () => {
        const state = createDedupeState();
        const a1 = mapOrderSnapshotToAlerts([
            {
                id: "o1",
                createdAt: "2026-09-05T12:00:00.000Z",
                source: "ui",
                totalAmount: 1,
            },
        ]);
        assert.deepEqual(diffAlertFeed(state, a1), []);
        const a2 = mapOrderSnapshotToAlerts([
            {
                id: "o1",
                createdAt: "2026-09-05T12:00:00.000Z",
                source: "ui",
                totalAmount: 1,
            },
            {
                id: "o2",
                createdAt: "2026-09-05T12:01:00.000Z",
                source: "ui",
                totalAmount: 2,
            },
        ]);
        const neu = diffAlertFeed(state, a2);
        assert.equal(neu.length, 1);
        assert.equal(neu[0]?.id, "order:o2");
    });
});
