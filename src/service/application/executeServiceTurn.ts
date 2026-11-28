import { QueueRetryableError, isQueueRetryableError } from "@/lib/chatbot/queueRetry";
import { buildServicePrompt } from "@/src/service/application/servicePrompt";
import { asksForHuman } from "@/src/service/domain/humanAsk";
import {
    SITE_SUPPORT_ASK_NAME,
    SITE_SUPPORT_ASK_PHONE,
    SITE_SUPPORT_INTEREST,
    siteSupportStep,
} from "@/src/service/domain/siteSupport";
import { composeServiceReply, serviceFailureText } from "@/src/service/domain/composeServiceReply";
import { httpsOfferLink, offerLinkLabel } from "@/src/service/domain/offerLink";
import {
    benefitLines,
    looksLikeSales,
    normalizeVisitorPhone,
    visitorName,
    offeringPriceLabel,
    asksForPlanPage,
    SITE_CONTACT_SAVED,
    SITE_PLAN_PAGE_HINT,
    siteSalesStep,
    speakOfferings,
    storeWhatsappHref,
    WHATSAPP_PLAN_INTRO,
    whatsappPlanBubbles,
    type SiteSalesStep,
    type WhatsappPlanBubble,
} from "@/src/service/domain/offeringSpeech";
import { serviceButton } from "@/src/service/domain/serviceButton";
import { sanitizeModelError } from "@/src/service/domain/modelError";
import { toServiceModelMessages } from "@/src/service/domain/modelMessages";
import { toolsForTurn } from "@/src/service/domain/serviceTools";
import {
    appointmentIdInput,
    listFreeSlotsInput,
    proposeCaseInput,
    proposeSlotInput,
    rescheduleInput,
    saveVisitorInput,
} from "@/src/service/domain/toolInput";
import {
    emptyTurnWrites,
    type ServiceCommandResult,
    type ServiceOfferingView,
    type ServiceToolName,
    type TurnWrites,
} from "@/src/service/domain/types";
import type { ServiceTurnInput } from "@/src/service/application/serviceTurnInput";
import type { ServiceTurnPorts } from "@/src/service/ports/serviceTurnPorts";

const MAX_STEPS = 4;

const EMPTY_WALLET =
    "Neste momento não consigo continuar a conversa por aqui. Se quiser falar com uma pessoa, peça um atendente.";

const HANDOFF = "Vou chamar alguém da equipe.";

const SITE_HANDOFF = "Para falar com uma pessoa, chame no WhatsApp.";

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
    const offerLinks: { name: string; label: string; url: string }[] = [];
    const planBubbles: WhatsappPlanBubble[] = [];
    const sales: { rows: ServiceOfferingView[] | null; saved: boolean } = { rows: null, saved: false };
    const button = input.messagingChannel === "site" ? null : serviceButton(input.text);
    let modelFailure: string | null = null;

    const finish = async (body: string | null, buttons?: { id: "svc_confirm_slot" | "svc_confirm_case"; title: string }[]) => {
        const trimmed = body?.trim() ?? "";
        if (trimmed) {
            if (buttons && buttons.length > 0) {
                await ports.reply.buttons(trimmed, buttons);
            } else {
                await ports.reply.text(trimmed);
            }
        }
        await record(ports, input, toolsUsed, writes, modelFailure);
    };

    if (button === "slot") {
        if (ports.calendar) {
            const gate = await ports.calendar.gateOpenSlot(input.companyId, input.threadId);
            if (gate === "busy" || gate === "unavailable") {
                await finish(serviceFailureText(gate === "busy" ? "slot_taken" : "calendar_unavailable"));
                return;
            }
        }
        const result = await ports.data.confirmOpenSlot(
            input.companyId,
            input.threadId,
            input.messageId,
            input.profileName ?? null
        );
        writes.booked = wrote(result);
        if (writes.booked && result.appointmentId) {
            await ports.calendar?.mirrorBooked(input.companyId, result.appointmentId);
        }
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
            if (input.messagingChannel === "site") {
                await finish(SITE_SUPPORT_ASK_NAME);
                return;
            }
            await ports.handover.handoff("Cliente pediu atendimento humano sem crédito de IA");
            await finish(handoffLine(input));
            return;
        }
        await finish(EMPTY_WALLET);
        return;
    }

    if (input.messagingChannel === "site") {
        const support = siteSupportStep(input.text, input.priorTurns ?? []);
        if (support) {
            await ports.wallet.release(input.companyId, input.messageId);
            if (support.kind === "save") {
                await saveSiteSupport(ports, input, offerLinks, support.name, support.phone);
                await finish(SITE_CONTACT_SAVED);
                for (const link of offerLinks) {
                    await ports.reply.cta(link.name, link.label, link.url);
                }
                return;
            }
            await finish(support.kind === "ask_phone" ? SITE_SUPPORT_ASK_PHONE : SITE_SUPPORT_ASK_NAME);
            return;
        }
    }

    if (input.messagingChannel === "site" && !asksForHuman(input.text) && asksForPlanPage(input.text)) {
        await ports.wallet.release(input.companyId, input.messageId);
        await finish(SITE_PLAN_PAGE_HINT);
        return;
    }

    const tools = toolsForTurn(profile, input.messagingChannel);
    try {
        const faqs = await ports.data.listFaqs(input.companyId);
        const modelResult = await ports.model.run({
            system: buildServicePrompt(profile, input.messagingChannel === "site" ? "site" : "whatsapp", faqs),
            messages: toServiceModelMessages(
                input.priorTurns,
                input.text,
                input.messagingChannel === "site" ? "do site" : "WhatsApp"
            ),
            maxSteps: MAX_STEPS,
            tools,
            executeTool: (name, raw) => executeTool(name, raw, input, writes, toolsUsed, ports, offerLinks, sales),
        });
        const drafted = withHandoff(composeServiceReply(modelResult.replyText, writes), writes, input);
        let reply = await salesReply(drafted, input, ports, offerLinks, sales, writes, planBubbles);
        if (input.messagingChannel === "site" && writes.humanRequested && !sales.saved) {
            const phone = normalizeVisitorPhone(input.text);
            const name = visitorName(input.text);
            if (name && phone) {
                const saved = await saveSiteSupport(ports, input, offerLinks, name, phone);
                sales.saved = saved;
                reply = saved ? SITE_CONTACT_SAVED : SITE_SUPPORT_ASK_NAME;
            } else {
                reply = SITE_SUPPORT_ASK_NAME;
            }
        }
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
        if (input.messagingChannel === "site") {
            if (sales.saved) {
                for (const link of offerLinks) {
                    await ports.reply.cta(link.name, link.label, link.url);
                }
            }
            return;
        }
        if (buttons.length === 0 && planBubbles.length > 0) {
            for (const bubble of planBubbles) {
                if (bubble.kind === "cta") {
                    await ports.reply.cta(bubble.body, bubble.label, bubble.url);
                } else {
                    await ports.reply.text(bubble.body);
                }
            }
        }
    } catch (error: unknown) {
        await ports.wallet.release(input.companyId, input.messageId);
        if (isRateLimit(error)) {
            throw new QueueRetryableError("AI_RATE_LIMIT", "LLM rate limited — requeue with backoff");
        }
        modelFailure = sanitizeModelError(error);
        console.warn("[service] model", modelFailure);
        await finish(MODEL_FAILED);
    }
}

async function saveSiteSupport(
    ports: ServiceTurnPorts,
    input: ServiceTurnInput,
    offerLinks: { name: string; label: string; url: string }[],
    name: string,
    phone: string
): Promise<boolean> {
    const saved = await ports.data.saveSiteContact(
        input.companyId,
        input.threadId,
        name,
        phone,
        SITE_SUPPORT_INTEREST
    );
    if (!saved.ok || !input.humanHref) return saved.ok;
    if (!offerLinks.some((item) => item.label === "Chamar no WhatsApp")) {
        offerLinks.push({
            name: SITE_SUPPORT_INTEREST,
            label: "Chamar no WhatsApp",
            url: storeWhatsappHref(input.humanHref, SITE_SUPPORT_INTEREST, name),
        });
    }
    return true;
}

function handoffLine(input: ServiceTurnInput): string {
    if (input.messagingChannel !== "site") return HANDOFF;
    return input.humanHref ? `Para falar com uma pessoa, chame no WhatsApp: ${input.humanHref}` : SITE_HANDOFF;
}

function withHandoff(reply: string, writes: TurnWrites, input: ServiceTurnInput): string {
    if (!writes.humanRequested) return reply;
    if (input.messagingChannel === "site") return reply;
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
    writes: TurnWrites,
    failure: string | null
): Promise<void> {
    try {
        await ports.trace.record({
            companyId: input.companyId,
            threadId: input.threadId,
            messageId: input.messageId,
            channel: channelOf(input),
            tools,
            writes,
            failure,
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "service_trace_failed";
        console.warn("[service] trace", message);
    }
}

async function salesReply(
    reply: string,
    input: ServiceTurnInput,
    ports: ServiceTurnPorts,
    offerLinks: { name: string; label: string; url: string }[],
    sales: { rows: ServiceOfferingView[] | null; saved: boolean },
    writes: TurnWrites,
    planBubbles: WhatsappPlanBubble[]
): Promise<string> {
    if (writes.humanRequested) return reply;
    const collect = input.messagingChannel === "site";
    if (!sales.saved && !sales.rows && !looksLikeSales(input.text)) return reply;
    const rows = sales.rows ?? (await ports.data.listOfferings(input.companyId));
    if (!sales.saved) {
        const step = siteSalesStep(input.text, rows, input.priorTurns ?? [], collect, input.offeringId);
        if (step?.kind === "save") {
            const saved = await ports.data.saveSiteContact(
                input.companyId,
                input.threadId,
                step.name,
                step.phone,
                step.interest
            );
            if (saved.ok) {
                sales.saved = true;
                if (input.humanHref && !offerLinks.some((item) => item.label === "Chamar no WhatsApp")) {
                    offerLinks.push({
                        name: step.interest,
                        label: "Chamar no WhatsApp",
                        url: storeWhatsappHref(input.humanHref, step.interest, step.name),
                    });
                }
            }
        } else if (step && input.messagingChannel !== "site") {
            const targets =
                step.kind === "catalog"
                    ? rows
                    : step.kind === "period"
                      ? step.rows
                      : step.kind === "benefits"
                        ? [step.offering]
                        : [];
            const bubbles = whatsappPlanBubbles(targets);
            if (bubbles.some((bubble) => bubble.kind === "cta")) {
                planBubbles.push(...bubbles);
                const onePlan = step.kind === "benefits" && bubbles.length === 1;
                reply = onePlan ? "" : WHATSAPP_PLAN_INTRO;
            } else {
                reply = composeServiceReply(step.body, writes);
            }
        } else if (step && step.kind !== "catalog" && step.kind !== "period" && step.kind !== "benefits") {
            reply = composeServiceReply(step.body, writes);
        }
    }
    if (sales.saved && collect) return SITE_CONTACT_SAVED;
    return reply;
}

async function executeTool(
    name: ServiceToolName,
    raw: unknown,
    input: ServiceTurnInput,
    writes: TurnWrites,
    toolsUsed: ServiceToolName[],
    ports: ServiceTurnPorts,
    offerLinks: { name: string; label: string; url: string }[],
    sales: { rows: ServiceOfferingView[] | null; saved: boolean }
): Promise<unknown> {
    toolsUsed.push(name);
    const companyId = input.companyId;
    const threadId = input.threadId;

    if (name === "list_offerings") {
        const rows = await ports.data.listOfferings(companyId);
        sales.rows = rows;
        for (const row of rows) {
            const url = httpsOfferLink(row.linkUrl);
            if (!url || offerLinks.some((item) => item.url === url)) continue;
            offerLinks.push({ name: row.name, label: offerLinkLabel(row.linkLabel), url });
        }
        return {
            ok: true,
            code: "ok",
            speak: speakOfferings(rows),
            rows: rows.map((row) => ({
                id: row.id,
                name: row.name,
                description: row.description,
                duration_min: row.durationMin,
                price_label: offeringPriceLabel(row),
                benefits: benefitLines(row.description),
                has_link: httpsOfferLink(row.linkUrl) !== null,
            })),
        };
    }
    if (name === "list_free_slots") {
        const parsed = listFreeSlotsInput.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "offering_invalid" };
        const listed = await ports.data.listFreeSlots(companyId, parsed.data.offering_id, parsed.data.day);
        if (listed.ok && ports.calendar && listed.durationMin && listed.durationMin > 0 && listed.slots.length > 0) {
            const filtered = await ports.calendar.filterSlots(companyId, listed.slots, listed.durationMin);
            if (filtered.gate === "unavailable") return { ok: false, code: "calendar_unavailable", slots: [] };
            return { ok: true, code: "ok", slots: filtered.slots };
        }
        return { ok: listed.ok, code: listed.code, slots: listed.slots };
    }
    if (name === "propose_slot") {
        const parsed = proposeSlotInput.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "offering_invalid" };
        if (ports.calendar) {
            const gate = await ports.calendar.gateOffering(companyId, parsed.data.offering_id, parsed.data.starts_at);
            if (gate === "busy") return { ok: false, code: "slot_taken" };
            if (gate === "unavailable") return { ok: false, code: "calendar_unavailable" };
        }
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
        if (wrote(result)) {
            writes.cancelled = true;
            await ports.calendar?.mirrorCancelled(companyId, parsed.data.appointment_id);
        }
        return { ok: result.ok, code: result.code };
    }
    if (name === "reschedule_appointment") {
        const parsed = rescheduleInput.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "outside_hours" };
        if (ports.calendar) {
            const gate = await ports.calendar.gateMoved(companyId, parsed.data.appointment_id, parsed.data.starts_at);
            if (gate === "busy") return { ok: false, code: "slot_taken" };
            if (gate === "unavailable") return { ok: false, code: "calendar_unavailable" };
        }
        const key = `svc-re:${input.messageId}:${parsed.data.appointment_id}`.slice(0, 200);
        const result = await ports.data.rescheduleAppointment(
            companyId,
            threadId,
            parsed.data.appointment_id,
            parsed.data.starts_at,
            key
        );
        if (wrote(result)) {
            writes.rescheduled = true;
            if (result.appointmentId) {
                await ports.calendar?.mirrorMoved(companyId, parsed.data.appointment_id, result.appointmentId);
            }
        }
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
    if (name === "save_visitor") {
        if (input.messagingChannel !== "site") return { ok: false, code: "flag_off" };
        const parsed = saveVisitorInput.safeParse(raw);
        if (!parsed.success) return { ok: false, code: "offering_invalid" };
        const phone = normalizeVisitorPhone(parsed.data.phone);
        if (!phone) return { ok: false, code: "offering_invalid", guidance: "Peça um WhatsApp com DDD." };
        const saved = await ports.data.saveSiteContact(
            input.companyId,
            input.threadId,
            parsed.data.name,
            phone,
            parsed.data.interest
        );
        if (saved.ok) sales.saved = true;
        if (saved.ok && input.humanHref) {
            offerLinks.push({
                name: parsed.data.interest,
                label: "Chamar no WhatsApp",
                url: storeWhatsappHref(input.humanHref, parsed.data.interest, parsed.data.name),
            });
        }
        return {
            ok: saved.ok,
            code: saved.code,
            guidance: saved.ok ? "O botão do WhatsApp sai depois da frase." : "Não gravei o contato.",
        };
    }
    if (name === "request_human") {
        writes.humanRequested = true;
        if (input.messagingChannel !== "site") {
            await ports.handover.handoff("Cliente pediu atendimento humano");
        }
        return { ok: true, code: "ok" };
    }
    return { ok: true, code: "ok" };
}
