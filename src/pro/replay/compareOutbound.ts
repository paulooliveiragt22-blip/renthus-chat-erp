export type TraceOutboundSlice = { kind?: string; text?: string | null };

export type OutboundDiff = {
    equal: boolean;
    expectedCount: number;
    actualCount: number;
    mismatches: Array<{ index: number; expected?: string; actual?: string }>;
};

function normalizeText(t?: string | null): string {
    return String(t ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

/** Diff simples de outbound (kind + texto) para o harness. */
export function compareOutbound(
    expected: TraceOutboundSlice[],
    actual: TraceOutboundSlice[]
): OutboundDiff {
    const mismatches: OutboundDiff["mismatches"] = [];
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
        const e = expected[i];
        const a = actual[i];
        const eKey = `${e?.kind ?? ""}:${normalizeText(e?.text)}`;
        const aKey = `${a?.kind ?? ""}:${normalizeText(a?.text)}`;
        if (eKey !== aKey) {
            mismatches.push({ index: i, expected: eKey, actual: aKey });
        }
    }
    return {
        equal: mismatches.length === 0 && expected.length === actual.length,
        expectedCount: expected.length,
        actualCount: actual.length,
        mismatches,
    };
}
