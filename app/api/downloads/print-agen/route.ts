// app/api/downloads/print-agent/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import fs from "fs";
import path from "path";

export async function GET(req: NextRequest) {
    try {
        // resposta intermediária (usada para comportamento de cookies, como no middleware do projeto)
        const response = NextResponse.next();

        // cria client server-side usando cookies do request -> response (mesma abordagem do middleware)
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    getAll: () => req.cookies.getAll(),
                    setAll: (cookiesToSet) => {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            response.cookies.set(name, value, options);
                        });
                    },
                },
            }
        );

        // checa usuário logado
        const { data } = await supabase.auth.getUser();
        if (!data || !data.user) {
            // não logado: redireciona para a página de login
            const url = new URL("/login", req.nextUrl.origin);
            return NextResponse.redirect(url);
        }

        // Caminho do arquivo ZIP (arquivo guardado fora da pasta 'public')
        const zipFileName = "renthus-print-agent-v1.0.0.zip";
        const zipPath = path.join(process.cwd(), "private_downloads", zipFileName);

        if (!fs.existsSync(zipPath)) {
            return new NextResponse("Arquivo não encontrado", { status: 404 });
        }

        const fileBuffer = fs.readFileSync(zipPath);

        // Retorna o ZIP como anexo para download
        return new NextResponse(fileBuffer, {
            status: 200,
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${zipFileName}"`,
            },
        });
    } catch (err: any) {
        console.error("Erro na rota de download:", err?.message || err);
        return new NextResponse("Erro servidor", { status: 500 });
    }
}
