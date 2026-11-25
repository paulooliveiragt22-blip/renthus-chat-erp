import type { SupabaseClient } from "@supabase/supabase-js";
import { isAttendanceMode, type AttendanceMode } from "@/src/service/domain/attendanceMode";

export async function resolveAttendanceMode(
    admin: SupabaseClient,
    companyId: string
): Promise<AttendanceMode> {
    const { data, error } = await admin
        .from("companies")
        .select("attendance_mode")
        .eq("id", companyId)
        .maybeSingle();

    if (error) {
        throw new Error(`attendance_mode_read: ${error.message}`);
    }
    if (!data || typeof data !== "object") {
        throw new Error("attendance_mode_read: company_missing");
    }

    const mode = "attendance_mode" in data ? data.attendance_mode : undefined;
    if (!isAttendanceMode(mode)) {
        throw new Error("attendance_mode_read: invalid");
    }
    return mode;
}
