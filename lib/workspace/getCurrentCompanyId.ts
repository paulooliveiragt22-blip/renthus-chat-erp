import { cookies } from "next/headers";

export async function getCurrentCompanyIdFromCookie() {
    const store = await cookies();
    return store.get("renthus_company_id")?.value ?? null;
}
