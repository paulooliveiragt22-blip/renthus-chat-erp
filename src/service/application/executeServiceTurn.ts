import { wrapUserInboundForLlm } from "@/src/pro/adapters/ai/userInboundGuard";
import { QueueRetryableError, isQueueRetryableError } from "@/lib/chatbot/queueRetry";
import { buildServicePrompt } from "@/src/service/application/servicePrompt";
import { asksForHuman } from "@/src/service/domain/humanAsk";
import { composeServiceReply, serviceFailureText } from "@/src/service/domain/composeServiceReply";
import { serviceButton } from "@/src/service/domain/serviceButton";
import { toolsForProfile } from "@/src/service/domain/serviceTools";
import {
    appointmentIdInput,
    listFreeSlotsInput,
    proposeCaseInput,
    proposeSlotInput,
    rescheduleInput,
} from "@/src/service/domain/toolInput";
import {
    emptyTurnWrites,
    type ServiceCommandResult,
    type ServiceToolName,
    type TurnWrites,
} from "@/src/service/domain/types";
import type { ServiceTurnInput } from "@/src/service/application/serviceTurnInput";
import type { ServiceTurnPorts } from "@/src/service/ports/serviceTurnPorts";

const MAX_STEPS = 4;

const EMPTY_WALLET =
    "Neste momento não consigo continuar a conversa por aqui. Se quiser falar com uma pessoa, peça um atendente.";

const HANDOFF = "Vou chamar alguém da equipe.";

const NOT_CONFIGURED = "O atendimento desta empresa ainda não foi configurado.";

const MODEL_FAILED = "Não consegui responder agora. Tente de novo em instantes.";

function wrote(result: ServiceCommandResult): boolean {
    return result.ok && (result.code === "ok" || result.code === "idempotent_replay");
}

function formatWhen(iso: string | undefined, timeZone: string | undefined): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: timeZone && timeZone.length > 0 ? timeZone : "America/Cuiaba",
    }).format(date);
}

function isRateLimit(error: unknown): boolean {
    if (isQueueRetryableError(error)) return true;
    if (!error || typeof error !== "object") return false;
    const statusCode = "statusCode" in error ? error.statusCode : undefined;
    if (statusCode === 429) return true;
    const message = error instanceof Error ? error.message : "";
    return message.toLowerCase().includes("rate limit") || message.includes("429");
}

function channelOf(input: ServiceTurnInput): string {
    return input.messagingChannel ?? "whatsapp";
}

export async function executeServiceTurn(
    input: ServiceTurnInput,
    ports: ServiceTurnPorts
): Promise<void> {
    const writes = emptyTurnWrites();
    const toolsUsed: ServiceToolName[] = [];
    const button = serviceButton(input.text);

    const finish = async (body: string, buttons?: { id: "svc_confirm_slot" | "svc_confirm_case"; title: string }[]) => {
        if (buttons && buttons.length > 0) {
            await ports.reply.buttons(body, buttons);
        } else {
            await ports.reply.text(body);
        }
        await record(ports, input, toolsUsed, writes);
    };

    if (button === "slot") {
        const result = await ports.data.confirmOpenSlot(
            input.companyId,
            input.threadId,
            input.messageId,
            input.profileName ?? null
        );
        writes.booked = wrote(result);
        const when = formatWhen(result.startsAt, result.timeZone);
        const name = result.offeringName ? `: ${result.offeringName}` : "";
        const whenText = when ? `, ${when}` : "";
        const body = writes.booked
            ? `Horário marcado${name}${whenText}.`
            : serviceFailureText(result.code);
        await finish(composeServiceReply(body, writes));
        return;
    }

    if (button === "case") {
        const result = await ports.data.confirmOpenCase(
            input.companyId,
            input.threadId,
            input.messageId
        );
        writes.caseOpened = wrote(result);
        const title = result.title ? `: ${result.title}` : "";
        const body = writes.caseOpened ? `Card aberto${title}.` : serviceFailureText(result.code);
        await finish(composeServiceReply(body, writes));
        return;
    }

    const profile = await ports.data.loadProfile(input.companyId);
    if (!profile) {
        await finish(NOT_CONFIGURED);
        return;
    }

    const begun = await ports.wallet.begin(input.companyId, input.messageId);
    if (!begun.allowed) {
        if (asksForHuman(input.text)) {
            writes.humanRequested = true;
            await ports.handover.handoff("Cliente pediu atendimento humano sem crédito de IA");
            await finish(HANDOFF);
            return;
        }
        await finish(EMPTY_WALLET);
        return;
    }

    const tools = toolsForProfile(profile);
    try {
        const modelResult = await ports.model.run({
            system: buildServicePrompt(profile),
            userText: wrapUserInboundForLlm(input.text),
            maxSteps: MAX_STEPS,
            tools,
            executeTool: (name, raw) => executeTool(name, raw, input, writes, toolsUsed, ports),
        });
        const reply = withHandoff(composeServiceReply(modelResult.replyText, writes), writes);
        const buttons = proposalButtons(writes);
        if (modelResult.inputTokens > 0 || modelResult.outputTokens > 0) {
            await ports.wallet.settle(
                input.companyId,
                input.messageId,
                modelResult.model,
                modelResult.inputTokens,
                modelResult.outputTokens
            );
        } else {
            await ports.wallet.release(input.companyId, input.messageId);
        }
        await finish(reply, buttons);
    } catch (error: unknown) {
        await ports.wallet.release(input.companyId, input.messageId);
        if (isRateLimit(error)) {
            throw new QueueRetryableError("AI_RATE_LIMIT", "LLM rate limited — requeue with backoff");
        }
        await finish(MODEL_FAILED);
    }
}

function withHandoff(reply: string, writes: TurnWrites): string {
    if (!writes.humanRequested) return reply;
    if (reply.includes("alguém da equipe")) return reply;
    return `${HANDOFF} ${reply}`.trim();
}

function proposalButtons(writes: TurnWrites): { id: "svc_confirm_slot" | "svc_confirm_case"; title: string }[] {
    const buttons: { id: "svc_confirm_slot" | "svc_confirm_case"; title: string }[] = [];
    if (writes.slotProposed) buttons.push({ id: "svc_confirm_slot", title: "Confirmar horário" });
    if (writes.caseProposed) buttons.push({ id: "svc_confirm_case", title: "Confirmar card" });
    return buttons;
}

async function record(
    ports: ServiceTurnPorts,
    input: ServiceTurnInput,
    tools: ServiceToolName[],
    writes: TurnWrites
): Promise<void> {
    try {
        await ports.trace.record({
            companyId: input.companyId,
            threadId: input.threadId,
            messageId: input.messageId,
            channel: channelOf(input),
            tools,
            writes,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "service_trace_failed";
        console.warn("[service] trace", message);
    }
}

async function executeTool(
    name: ServiceToolName,
    raw: unknown,
    input: ServiceTurnInput,
    writes: TurnWrites,
    toolsUsed: ServiceToolName[],
    ports: ServiceTurnPorts
): Promise<unknown> {
    toolsUsed.push(name);
    const companyId = input.companyId;
    const threadId = input.threadId;

    if (name === "list_offerings") {
        return { ok: true, code: "ok", rows: await ports.data.listOfferings(companyId) };
    }
    if (name === "list_free_slots") {
        const parsed = listFreeSlotsInput.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "offering_invalid" };
        const listed = await ports.data.listFreeSlots(companyId, parsed.data.offering_id, parsed.data.day);
        return { ok: listed.ok, code: listed.code, slots: listed.slots };
    }
    if (name === "propose_slot") {
        const parsed = proposeSlotInput.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "offering_invalid" };
        const result = await ports.data.proposeSlot(
            companyId,
            threadId,
            parsed.data.offering_id,
            parsed.data.starts_at
        );
        if (wrote(result)) writes.slotProposed = true;
        return { ok: result.ok, code: result.code, guidance: "Ainda não está marcado. O cliente confirma no botão." };
    }
    if (name === "list_appointments") {
        return { ok: true, code: "ok", rows: await ports.data.listAppointments(companyId, threadId) };
    }
    if (name === "cancel_appointment") {
        const parsed = appointmentIdInput.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "appointment_closed" };
        const result = await ports.data.cancelAppointment(companyId, threadId, parsed.data.appointment_id);
        if (wrote(result)) writes.cancelled = true;
        return { ok: result.ok, code: result.code };
    }
    if (name === "reschedule_appointment") {
        const parsed = rescheduleInput.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "outside_hours" };
        const key = `svc-re:${input.messageId}:${parsed.data.appointment_id}`.slice(0, 200);
        const result = await ports.data.rescheduleAppointment(
            companyId,
            threadId,
            parsed.data.appointment_id,
            parsed.data.starts_at,
            key
        );
        if (wrote(result)) writes.rescheduled = true;
        return { ok: result.ok, code: result.code };
    }
    if (name === "list_open_cases") {
        return { ok: true, code: "ok", rows: await ports.data.listOpenCases(companyId, threadId) };
    }
    if (name === "propose_case") {
        const parsed = proposeCaseInput.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "invalid_title" };
        const result = await ports.data.proposeCase(
            companyId,
            threadId,
            parsed.data.title,
            parsed.data.summary ?? ""
        );
        if (wrote(result)) writes.caseProposed = true;
        return { ok: result.ok, code: result.code, guidance: "O card ainda não abriu. O cliente confirma no botão." };
    }
    if (name === "request_human") {
        writes.humanRequested = true;
        await ports.handover.handoff("Cliente pediu atendimento humano");
        return { ok: true, code: "ok" };
    }
    return { ok: true, code: "ok" };
}
