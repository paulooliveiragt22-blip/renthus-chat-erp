import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderCreatedProps, SignUpCompletedProps } from "../../lib/analytics/types";

describe("mixpanel analytics types (Quick Start)", () => {
    it("order_created props aceitam canais do plano", () => {
        const props: OrderCreatedProps = {
            channel: "admin",
            offline: false,
            fulfillment_type: "delivery",
            item_count: 2,
            company_id: "c1",
            order_id: "o1",
        };
        assert.equal(props.channel, "admin");
        const pdv: OrderCreatedProps = { channel: "pdv", offline: true };
        assert.equal(pdv.offline, true);
        const wa: OrderCreatedProps = { channel: "whatsapp", offline: false };
        assert.equal(wa.channel, "whatsapp");
    });

    it("sign_up_completed props mínimas", () => {
        const props: SignUpCompletedProps = {
            sign_up_method: "email",
            platform: "web",
            plan: "pro",
            billing_period: "month",
        };
        assert.equal(props.sign_up_method, "email");
        assert.equal(props.platform, "web");
    });
});
