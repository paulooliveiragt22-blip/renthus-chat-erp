import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { summarizeExtractionDivergence } from "../../src/pro/replay/measureExtractionDivergence";
import type { OrderLineExtraction } from "../../src/domain/contracts/orderExtraction";

describe("extraction baseline v1", () => {
    it("fixture versionada carrega e resume sem regressão grosseira", () => {
        const path = resolve(
            process.cwd(),
            "tests/fixtures/replay/extraction-baseline.v1.json"
        );
        const raw = JSON.parse(readFileSync(path, "utf8")) as {
            version: number;
            cases: Array<{ text: string; extraction: OrderLineExtraction | null }>;
        };
        assert.equal(raw.version, 1);
        assert.ok(raw.cases.length >= 4);

        const summary = summarizeExtractionDivergence(raw.cases);
        assert.equal(summary.cases, raw.cases.length);
        assert.ok(summary.withExtraction >= 3);
        assert.ok(summary.planReady >= 3);
    });
});
