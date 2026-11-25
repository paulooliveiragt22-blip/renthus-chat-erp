import type { AttendanceMode } from "./types";

export type { AttendanceMode };

export function isAttendanceMode(value: unknown): value is AttendanceMode {
    return value === "delivery" || value === "service";
}
