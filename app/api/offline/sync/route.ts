import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { DEFAULT_FLUSH_BATCH_SIZE } from "@/lib/offline/ports/SyncTransport";
import {
    applyFinalizePdvOrder,
    type FinalizePdvPayload,
} from "@/lib/offline/application/applyFinalizePdvOrder";
import type { SyncCommandResult } from "@/lib/offline/ports/SyncTransport";
import {
    requireCompanyAnyPlanFeature,
    PDV_ACCESS_FEATURES,
} from "@/lib/billing/requirePlanFeature";
import { recordOfflinePrintIfNeeded } from "@/lib/offline/application/recordOfflinePrint";
import type { PrintIntent } from "@/lib/offline/domain/LocalPrintJob";
import { applyUpdateOrderStatus } from "@/lib/offline/application/applyUpdateOrderStatus";
import { isOfflineOrderStatusAllowed } from "@/lib/offline/domain/SyncEligibility";

export const runtime = "nodejs";

type SyncCommandIn = {
    id?: string;
    type?: string;
    clientMutationId?: string;
    payload?: Record<string, unknown>;
    createdAt?: string;
};

/**
 * POST /api/offline/sync — aplica batch do outbox (Perf-3).
 * P1: FinalizePdvSale + printIntent. P2: UpdateOrderStatus (preparing|delivered).
 */
export async function POST(req: Request) {
    const access = await requireCompanyAccess(["owner", "admin", "member"]);
    if (!access.ok) {
        return NextResponse.json({ error: access.error }, { status: access.status });
    }

    let body: { companyId?: string; commands?: SyncCommandIn[] };
    try {
        body = (await req.json()) as typeof body;
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    if (body.companyId && body.companyId !== access.companyId) {
        return NextResponse.json({ error: "company_mismatch" }, { status: 403 });
    }

    const commands = Array.isArray(body.commands) ? body.commands : [];
    if (commands.length > DEFAULT_FLUSH_BATCH_SIZE) {
        return NextResponse.json(
            { error: "batch_too_large", max: DEFAULT_FLUSH_BATCH_SIZE },
            { status: 400 }
        );
    }

    const pdvCtx = await requireCompanyAnyPlanFeature(
        [...PDV_ACCESS_FEATURES],
        ["owner", "admin", "member"],
        "pdv.access"
    );
    if (!pdvCtx.ok) return pdvCtx.response;
    const { admin, companyId } = pdvCtx;

    const results: SyncCommandResult[] = [];

    for (const cmd of commands) {
        const clientMutationId = String(cmd.clientMutationId ?? "").trim();
        if (!clientMutationId) {
            results.push({
                clientMutationId: "",
                outcome: "failed",
                error: "missing_client_mutation_id",
            });
            continue;
        }

        if (cmd.type === "FinalizePdvSale") {
            const payload = (cmd.payload ?? {}) as FinalizePdvPayload & {
                printIntent?: PrintIntent;
            };
            const printIntent = payload.printIntent;
            const result = await applyFinalizePdvOrder({
                admin,
                companyId,
                body: {
                    ...payload,
                    client_mutation_id: clientMutationId,
                    auto_print:
                        payload.auto_print === true && printIntent?.alreadyPrinted !== true,
                },
                enforceStockPolicy: true,
            });

            if (result.ok) {
                if (printIntent?.alreadyPrinted && printIntent.clientPrintId) {
                    await recordOfflinePrintIfNeeded({
                        admin,
                        companyId,
                        orderId: result.order_id,
                        printIntent,
                    });
                }
                results.push({
                    clientMutationId,
                    outcome: "synced",
                    serverPayload: { sale_id: result.sale_id, order_id: result.order_id },
                });
            } else if (result.conflict) {
                results.push({
                    clientMutationId,
                    outcome: "conflict",
                    error: result.error,
                });
            } else {
                results.push({
                    clientMutationId,
                    outcome: "failed",
                    error: result.error,
                });
            }
            continue;
        }

        if (cmd.type === "UpdateOrderStatus") {
            const payload = (cmd.payload ?? {}) as {
                orderId?: string;
                status?: string;
                details?: string | null;
            };
            const orderId = String(payload.orderId ?? "").trim();
            const status = String(payload.status ?? "").trim();
            if (!orderId || !status) {
                results.push({
                    clientMutationId,
                    outcome: "failed",
                    error: "invalid_order_status_payload",
                });
                continue;
            }
            if (!isOfflineOrderStatusAllowed(status)) {
                results.push({
                    clientMutationId,
                    outcome: "failed",
                    error: `status_not_offline_eligible:${status}`,
                });
                continue;
            }
            const result = await applyUpdateOrderStatus({
                admin,
                companyId,
                orderId,
                status,
                details: payload.details ?? null,
                clientMutationId,
            });
            if (result.ok) {
                results.push({
                    clientMutationId,
                    outcome: "synced",
                    serverPayload: { status: result.status },
                });
            } else if (result.conflict) {
                results.push({
                    clientMutationId,
                    outcome: "conflict",
                    error: result.error,
                });
            } else {
                results.push({
                    clientMutationId,
                    outcome: "failed",
                    error: result.error,
                });
            }
            continue;
        }

        results.push({
            clientMutationId,
            outcome: "failed",
            error: `unsupported_type:${cmd.type ?? "?"}`,
        });
    }

    return NextResponse.json({ results });
}
