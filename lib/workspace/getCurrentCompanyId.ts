import { cookies } from "next/headers";

export function getCurrentCompanyIdFromCookie() {
    return cookies().get("renthus_company_id")?.value ?? null;
}
