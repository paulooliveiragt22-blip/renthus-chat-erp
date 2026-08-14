import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    bucketCashByHour,
    countSettledSales,
    ticketFromCashAndSales,
} from "../../src/financeiro/application/queryHomeStats";

describe("queryHomeStats helpers (F3)", () => {
    it("ticket = 0 sem vendas liquidadas (não usa pedidos criados)", () => {
        assert.equal(ticketFromCashAndSales(120, 0), 0);
        assert.equal(ticketFromCashAndSales(100, 4), 25);
    });

    it("countSettledSales conta sale_id distintos só em sale_payment/recognize", () => {
        const n = countSettledSales([
            {
                posted_at: "2026-08-14T12:00:00.000Z",
                source_type: "sale_payment",
                status: "posted",
                sale_id: "s1",
                cash_amount: 50,
            },
            {
                posted_at: "2026-08-14T12:05:00.000Z",
                source_type: "sale_payment",
                status: "posted",
                sale_id: "s1",
                cash_amount: 20,
            },
            {
                posted_at: "2026-08-14T13:00:00.000Z",
                source_type: "bill_settlement",
                status: "posted",
                sale_id: "s2",
                cash_amount: 58,
            },
            {
                posted_at: "2026-08-14T14:00:00.000Z",
                source_type: "recognize",
                status: "posted",
                sale_id: "s3",
                cash_amount: 40,
            },
        ]);
        assert.equal(n, 2);
    });

    it("bucketCashByHour soma 1.1 no fuso e ignora fora da janela", () => {
        const now = new Date("2026-08-14T18:00:00.000Z"); // 14:00 Cuiabá
        const rows = [
            {
                posted_at: "2026-08-14T17:30:00.000Z",
                source_type: "sale_payment",
                status: "posted",
                sale_id: "s1",
                cash_amount: 100,
            },
            {
                posted_at: "2026-08-13T10:00:00.000Z",
                source_type: "sale_payment",
                status: "posted",
                sale_id: "s0",
                cash_amount: 999,
            },
            {
                posted_at: "2026-08-14T17:45:00.000Z",
                source_type: "cash_movement",
                status: "posted",
                sale_id: null,
                cash_amount: -50,
            },
        ];
        const buckets = bucketCashByHour(rows, "America/Cuiaba", now);
        const hit = buckets.find((b) => b.hora === "13h");
        assert.ok(hit);
        assert.equal(hit!.caixa, 100);
        assert.equal(
            buckets.reduce((s, b) => s + b.caixa, 0),
            100
        );
    });
});
