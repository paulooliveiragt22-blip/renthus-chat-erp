import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @deprecated Removido por LGPD — pedidos por telefone sem prova de identidade.
 * Use POST /api/public/menu/[slug]/orders com sessão assinada (cookie ou wm).
 */
export async function GET() {
    return NextResponse.json(
        {
            error: "endpoint_removed",
            message:
                "Consulta por telefone foi desativada. Abra Meus pedidos pelo link do WhatsApp da loja.",
        },
        { status: 410 }
    );
}
