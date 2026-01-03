import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export const runtime = "nodejs";

export async function GET() {
    const companyId = cookies().get("renthus_company_id")?.value ?? null;
    return NextResponse.json({ company_id: companyId });
}
