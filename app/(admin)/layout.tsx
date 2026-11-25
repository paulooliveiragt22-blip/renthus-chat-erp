import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminRouteBlocked, isModeGatedAdminPath } from "@/src/service/domain/adminRoutes";

export default async function AdminSegmentLayout({ children }: { children: React.ReactNode }) {
    const pathname = (await headers()).get("x-renthus-pathname") ?? "";
    if (!isModeGatedAdminPath(pathname)) return children;

    const companyId = (await cookies()).get("renthus_company_id")?.value;
    if (!companyId) return children;

    const { data } = await createAdminClient().rpc("rpc_service_admin_snapshot", {
        p_company_id: companyId,
    });
    const mode =
        data && typeof data === "object" && "attendance_mode" in data && data.attendance_mode === "service"
            ? "service"
            : "delivery";
    if (adminRouteBlocked(mode, pathname)) notFound();
    return children;
}
