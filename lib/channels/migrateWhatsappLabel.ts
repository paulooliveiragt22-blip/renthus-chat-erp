import { profileLabel } from "@/lib/workspace/loginDestination";
import type { AttendanceMode } from "@/src/service/domain/types";

export function migrateButtonLabel(source: AttendanceMode, target: AttendanceMode): string {
    return `Migrar de ${profileLabel(source)} para ${profileLabel(target)}`;
}
