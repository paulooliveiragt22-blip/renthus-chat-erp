import type { ServiceFlags, ServicePreset } from "./types";

const PRESETS: readonly ServicePreset[] = ["horario", "servico", "consulta_caso", "balcao"];

export function isServicePreset(value: string): value is ServicePreset {
    return (PRESETS as readonly string[]).includes(value);
}

export function flagsForPreset(preset: ServicePreset): ServiceFlags {
    if (preset === "balcao") {
        return { agendaEnabled: false, casesEnabled: false };
    }
    if (preset === "horario") {
        return { agendaEnabled: true, casesEnabled: false };
    }
    return { agendaEnabled: true, casesEnabled: true };
}
