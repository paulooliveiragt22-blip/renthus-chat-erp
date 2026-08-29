/**
 * Contrato SQS envelope v1 (ADR-0003) — sem server-only (usado em Lambda).
 */

export type SqsJobKind = "inbound" | "outbound";

export type SqsEnvelopeV1 = {
    v: 1;
    kind: SqsJobKind;
    jobId: string;
    companyId: string;
    threadId: string;
    enqueuedAt: string;
};

export function parseSqsEnvelope(raw: string): SqsEnvelopeV1 | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (o.v !== 1) return null;
    if (o.kind !== "inbound" && o.kind !== "outbound") return null;
    if (typeof o.jobId !== "string" || !o.jobId.trim()) return null;
    if (typeof o.companyId !== "string" || !o.companyId.trim()) return null;
    if (typeof o.threadId !== "string" || !o.threadId.trim()) return null;
    if (typeof o.enqueuedAt !== "string" || !o.enqueuedAt.trim()) return null;
    return {
        v: 1,
        kind: o.kind,
        jobId: o.jobId.trim(),
        companyId: o.companyId.trim(),
        threadId: o.threadId.trim(),
        enqueuedAt: o.enqueuedAt.trim(),
    };
}
