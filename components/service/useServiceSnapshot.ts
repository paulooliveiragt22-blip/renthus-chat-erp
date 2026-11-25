"use client";

import { useEffect, useState } from "react";
import type { ServicePreset } from "@/src/service/domain/types";

export type ServiceSnapshot = {
    attendanceMode: "delivery" | "service";
    preset: ServicePreset | null;
    contextText: string;
    agendaEnabled: boolean;
    casesEnabled: boolean;
    cancelEnabled: boolean;
    rescheduleEnabled: boolean;
};

const EMPTY_DELIVERY: ServiceSnapshot = {
    attendanceMode: "delivery",
    preset: null,
    contextText: "",
    agendaEnabled: false,
    casesEnabled: false,
    cancelEnabled: false,
    rescheduleEnabled: false,
};

export function useServiceSnapshot(): { snapshot: ServiceSnapshot | null; loading: boolean; reload: () => void } {
    const [snapshot, setSnapshot] = useState<ServiceSnapshot | null>(null);
    const [loading, setLoading] = useState(true);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        fetch("/api/admin/service/snapshot", { credentials: "include", cache: "no-store" })
            .then(async (res) => {
                const json: unknown = await res.json().catch(() => null);
                if (!res.ok || !json || typeof json !== "object") return EMPTY_DELIVERY;
                return mapSnapshot(json);
            })
            .then((next) => {
                if (!cancelled) setSnapshot(next);
            })
            .catch(() => {
                if (!cancelled) setSnapshot(EMPTY_DELIVERY);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [tick]);

    return { snapshot, loading, reload: () => setTick((value) => value + 1) };
}

function mapSnapshot(raw: object): ServiceSnapshot {
    const row = raw as { attendance_mode?: unknown; profile?: unknown };
    if (row.attendance_mode !== "service") return EMPTY_DELIVERY;
    const profile = row.profile;
    if (!profile || typeof profile !== "object") {
        return { ...EMPTY_DELIVERY, attendanceMode: "service" };
    }
    const data = profile as Record<string, unknown>;
    const preset = data.preset;
    return {
        attendanceMode: "service",
        preset: preset === "horario" || preset === "servico" || preset === "consulta_caso" || preset === "balcao" ? preset : null,
        contextText: typeof data.context_text === "string" ? data.context_text : "",
        agendaEnabled: data.agenda_enabled === true,
        casesEnabled: data.cases_enabled === true,
        cancelEnabled: data.whatsapp_cancel_enabled === true,
        rescheduleEnabled: data.whatsapp_reschedule_enabled === true,
    };
}
