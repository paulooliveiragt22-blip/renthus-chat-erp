/**
 * Ponto de entrada do chatbot.
 * `attendance_mode = delivery` segue no motor PRO.
 * `attendance_mode = service` segue no turno de serviço.
 */

export type { ProcessMessageParams } from "./types";
export type { CartItem, Session } from "./types";

import type { ProcessMessageParams } from "./types";
import { resolveAttendanceMode } from "./resolveAttendanceMode";
import { runProInbound } from "./runProInbound";
import { runServiceTurn } from "@/src/service/application/runServiceTurn";

export async function processInboundMessage(params: ProcessMessageParams): Promise<void> {
    const mode = await resolveAttendanceMode(params.admin, params.companyId);
    if (mode === "service") {
        await runServiceTurn(params);
        return;
    }
    await runProInbound(params);
}
