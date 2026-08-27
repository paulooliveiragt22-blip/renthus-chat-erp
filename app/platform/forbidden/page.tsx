import { headers } from "next/headers";
import { collectClientIpCandidates } from "@/lib/platform/checkPlatformIpAllowlist";

type Props = { searchParams?: Promise<{ seen?: string }> };

export default async function PlatformForbiddenPage({ searchParams }: Props) {
    const sp = (await searchParams) ?? {};
    const h = await headers();
    const fromHeaders = collectClientIpCandidates(h);
    const fromQuery = (sp.seen ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    const seen = [...new Set([...fromQuery, ...fromHeaders])];

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                    Acesso bloqueado por IP
                </h1>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    O console <code className="font-mono text-xs">/platform</code> em produção
                    exige a variável{" "}
                    <code className="font-mono text-xs">PLATFORM_ADMIN_IP_ALLOWLIST</code> na
                    Vercel com o IP que a Vercel vê na requisição (pode diferir do site
                    ifconfig.me).
                </p>

                <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                        IP(s) que a Vercel detectou agora
                    </div>
                    <div className="mt-1 break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">
                        {seen.length ? seen.join(", ") : "(nenhum — headers vazios)"}
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500">
                        Cole exatamente um desses valores em{" "}
                        <code className="font-mono">PLATFORM_ADMIN_IP_ALLOWLIST</code> e
                        faça Redeploy.
                    </p>
                </div>

                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                    <li>Vercel → Settings → Environment Variables → Production</li>
                    <li>
                        Valor sem aspas, ex.:{" "}
                        <code className="font-mono text-xs">203.0.113.45</code>
                    </li>
                    <li>Confirme o escopo <strong>Production</strong> (não só Preview)</li>
                    <li>Redeploy do deployment de Production</li>
                </ol>
            </div>
        </div>
    );
}
