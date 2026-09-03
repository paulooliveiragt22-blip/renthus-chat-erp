import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { disambiguatePackagingForSearchRows } from "../../src/pro/pipeline/packagingDisambiguation";
import { resolvePendingPickGroupsFromFreeText } from "../../src/pro/pipeline/pendingPickGroups";
import { resolveSegmentPick } from "../../src/pro/pipeline/resolveSegmentPick";
import { countAllowlistRejectionErrors } from "../../src/pro/pipeline/matchingMetrics";
import { formatCatalogVolumeLabel } from "../../src/pro/tools/catalogPublicDto";
import type { PendingPickGroup } from "../../src/types/contracts";

type CorpusCase = {
    id: string;
    kind: string;
    [key: string]: unknown;
};

const corpusPath = join(process.cwd(), "tests/fixtures/pro/matching-corpus.v1.json");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
    version: number;
    cases: CorpusCase[];
};

describe("C2.2 matching corpus v1", () => {
    it("tem pelo menos 15 casos versionados", () => {
        assert.equal(corpus.version, 1);
        assert.ok(corpus.cases.length >= 15, `got ${corpus.cases.length}`);
    });

    for (const c of corpus.cases) {
        it(c.id, () => {
            if (c.kind === "disambiguate") {
                const out = disambiguatePackagingForSearchRows(
                    c.rows as Parameters<typeof disambiguatePackagingForSearchRows>[0],
                    String(c.query),
                    String(c.userText)
                );
                assert.deepEqual(
                    out.map((r) => String(r.id)).sort(),
                    [...(c.expectIds as string[])].sort()
                );
                return;
            }
            if (c.kind === "pending_free_text") {
                const { resolved } = resolvePendingPickGroupsFromFreeText(
                    [c.group as PendingPickGroup],
                    String(c.userText),
                    { habitSigla: (c.habitSigla as string | undefined) ?? null }
                );
                const id = resolved[0]?.embalagemId ?? null;
                assert.equal(id, c.expectResolvedId ?? null);
                return;
            }
            if (c.kind === "segment_pick") {
                const result = resolveSegmentPick(
                    String(c.segment),
                    c.rows as Array<{
                        id: string;
                        display_name?: string | null;
                        product_name?: string | null;
                        sigla_comercial?: string | null;
                        fator_conversao?: number | string | null;
                    }>
                );
                assert.equal(result.kind, c.expectKind);
                if (c.expectKind === "unique" && result.kind === "unique") {
                    assert.equal(result.pick.embalagemId, c.expectId);
                }
                return;
            }
            if (c.kind === "volume_label") {
                assert.equal(
                    formatCatalogVolumeLabel(
                        c.volumeQuantidade as never,
                        c.unitTypeSigla as never
                    ),
                    c.expectLabel
                );
                return;
            }
            if (c.kind === "allowlist_errors") {
                assert.equal(
                    countAllowlistRejectionErrors(c.errors as string[]),
                    c.expectCount
                );
                return;
            }
            assert.fail(`kind desconhecido: ${c.kind}`);
        });
    }
});
