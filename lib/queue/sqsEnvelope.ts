/**
 * lib/queue/sqsEnvelope.ts
 *
 * ADR-0003 Fase 14 — Restaurado para incluir inbound + outbound.
 * O `kind: "inbound"` foi reintroduzido no envelope.
 */

export type SqsEnvelopeV1 = {
    v: 1;
    kind: "inbound" | "outbound";
    jobId: string;
    companyId: string;
    threadId: string;
    enqueuedAt: string;
};

export type SqsJobKind = "inbound" | "outbound";

export function parseSqsEnvelope(body: string): SqsEnvelopeV1 | null {
    try {
        const parsed: unknown = JSON.parse(body);
        if (
            typeof parsed === "object" &&
            parsed !== null &&
            "v" in parsed &&
            "kind" in parsed &&
            "jobId" in parsed &&
            "companyId" in parsed &&
            "threadId" in parsed &&
            "enqueuedAt" in parsed
        ) {
            const p = parsed as Record<string, unknown>;
            if (p.v === 1 && (p.kind === "inbound" || p.kind === "outbound")) {
                return {
                    v: 1,
                    kind: p.kind,
                    jobId: String(p.jobId),
                    companyId: String(p.companyId),
                    threadId: String(p.threadId),
                    enqueuedAt: String(p.enqueuedAt),
                };
            }
        }
        return null;
    } catch {
        return null;
    }
}