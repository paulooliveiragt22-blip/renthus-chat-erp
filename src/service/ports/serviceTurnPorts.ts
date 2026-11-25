import type {
    ServiceAppointmentView,
    ServiceCaseView,
    ServiceCommandResult,
    ServiceOfferingView,
    ServiceProfileView,
    ServiceToolName,
    TurnWrites,
} from "@/src/service/domain/types";

export type ServiceSlotList = ServiceCommandResult & { slots: string[] };

export type ServiceDataPort = {
    loadProfile(companyId: string): Promise<ServiceProfileView | null>;
    listOfferings(companyId: string): Promise<ServiceOfferingView[]>;
    listFreeSlots(companyId: string, offeringId: string, day: string): Promise<ServiceSlotList>;
    proposeSlot(
        companyId: string,
        threadId: string,
        offeringId: string,
        startsAt: string
    ): Promise<ServiceCommandResult>;
    listAppointments(companyId: string, threadId: string): Promise<ServiceAppointmentView[]>;
    cancelAppointment(
        companyId: string,
        threadId: string,
        appointmentId: string
    ): Promise<ServiceCommandResult>;
    rescheduleAppointment(
        companyId: string,
        threadId: string,
        appointmentId: string,
        startsAt: string,
        idempotencyKey: string
    ): Promise<ServiceCommandResult>;
    listOpenCases(companyId: string, threadId: string): Promise<ServiceCaseView[]>;
    proposeCase(
        companyId: string,
        threadId: string,
        title: string,
        summary: string
    ): Promise<ServiceCommandResult>;
    confirmOpenSlot(
        companyId: string,
        threadId: string,
        idempotencyKey: string,
        customerName: string | null
    ): Promise<ServiceCommandResult>;
    confirmOpenCase(
        companyId: string,
        threadId: string,
        idempotencyKey: string
    ): Promise<ServiceCommandResult>;
};

export type ServiceWalletPort = {
    begin(companyId: string, idempotencyKey: string): Promise<{ allowed: boolean }>;
    settle(
        companyId: string,
        turnKey: string,
        model: string,
        inputTokens: number,
        outputTokens: number
    ): Promise<void>;
    release(companyId: string, turnKey: string): Promise<void>;
};

export type ServiceModelRequest = {
    system: string;
    userText: string;
    maxSteps: number;
    tools: readonly ServiceToolName[];
    executeTool: (name: ServiceToolName, raw: unknown) => Promise<unknown>;
};

export type ServiceModelResult = {
    replyText: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
};

export type ServiceModelPort = {
    run(input: ServiceModelRequest): Promise<ServiceModelResult>;
};

export type ServiceReplyButton = {
    id: "svc_confirm_slot" | "svc_confirm_case";
    title: string;
};

export type ServiceReplyPort = {
    text(body: string): Promise<void>;
    buttons(body: string, buttons: ServiceReplyButton[]): Promise<void>;
};

export type ServiceHandoverPort = {
    handoff(reason: string): Promise<void>;
};

export type ServiceTraceEvent = {
    companyId: string;
    threadId: string;
    messageId: string;
    channel: string;
    tools: readonly ServiceToolName[];
    writes: TurnWrites;
};

export type ServiceTracePort = {
    record(event: ServiceTraceEvent): Promise<void>;
};

export type ServiceTurnPorts = {
    data: ServiceDataPort;
    wallet: ServiceWalletPort;
    model: ServiceModelPort;
    reply: ServiceReplyPort;
    handover: ServiceHandoverPort;
    trace: ServiceTracePort;
};
