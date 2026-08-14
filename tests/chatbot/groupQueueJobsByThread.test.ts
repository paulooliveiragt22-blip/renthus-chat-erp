import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupQueueJobsByThread } from "../../lib/chatbot/queue/groupByThread";

describe("groupQueueJobsByThread", () => {
    it("preserva ordem relativa dentro do mesmo thread_id", () => {
        const jobs = [
            { id: "a1", thread_id: "t-a" },
            { id: "b1", thread_id: "t-b" },
            { id: "a2", thread_id: "t-a" },
        ];
        const buckets = groupQueueJobsByThread(jobs);
        assert.deepEqual(
            buckets.map((b) => b.map((j) => j.id)),
            [
                ["a1", "a2"],
                ["b1"],
            ]
        );
    });

    it("threads diferentes geram buckets diferentes", () => {
        const jobs = [
            { id: "1", thread_id: "t-1" },
            { id: "2", thread_id: "t-2" },
        ];
        const buckets = groupQueueJobsByThread(jobs);
        assert.equal(buckets.length, 2);
        assert.equal(buckets[0]?.[0]?.thread_id, "t-1");
        assert.equal(buckets[1]?.[0]?.thread_id, "t-2");
    });

    it("thread_id vazio/nulo não junta jobs de conversas diferentes", () => {
        const jobs = [
            { id: "x", thread_id: "" },
            { id: "y", thread_id: "" },
            { id: "z", thread_id: "t-z" },
        ];
        const buckets = groupQueueJobsByThread(jobs);
        assert.equal(buckets.length, 3);
        assert.deepEqual(
            buckets.map((b) => b.map((j) => j.id)),
            [["x"], ["y"], ["z"]]
        );
    });

    it("lista vazia devolve zero buckets", () => {
        assert.deepEqual(groupQueueJobsByThread([]), []);
    });
});
