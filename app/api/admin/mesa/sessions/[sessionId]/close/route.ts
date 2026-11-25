import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** O garçom libera a mesa; o caixa confirma em /api/admin/pdv/mesa-queue. */
export async function POST() {
    return NextResponse.json(
        { error: "use_release_then_pdv_queue" },
        { status: 410 }
    );
}
