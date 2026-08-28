import { headers } from "next/headers";
import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { collectClientIpCandidates } from "@/lib/platform/checkPlatformIpAllowlist";

export default async function PlatformForbiddenPage() {
    const h = await headers();
    const seen = collectClientIpCandidates(h);
    const primaryIp = seen[0] ?? null;

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4 dark:bg-zinc-950">
            <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                    <ShieldOff className="h-5 w-5" aria-hidden />
                </div>

                <h1 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Este endereço não está autorizado
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    O console de plataforma só aceita conexões de IPs previamente
                    liberados. Se você faz parte da operação RenthusAgent, use a
                    rede ou VPN cadastrada — ou peça a um superadmin para incluir o
                    IP desta conexão.
                </p>

                <div className="mt-5 rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
                    <p className="font-medium">O que fazer</p>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] leading-snug text-amber-900/90 dark:text-amber-100/80">
                        <li>Confirme se está na rede corporativa / VPN correta</li>
                        <li>Tente de novo em alguns minutos (IP dinâmico pode mudar)</li>
                        <li>
                            Se o acesso for legítimo, envie o IP abaixo ao time de
                            plataforma
                        </li>
                    </ul>
                </div>

                <details className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 open:pb-3 dark:border-zinc-700 dark:bg-zinc-800/80">
                    <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                        Detalhes técnicos (ops)
                    </summary>
                    <div className="space-y-3 border-t border-zinc-200 px-4 pt-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                        <div>
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                                IP detectado nesta requisição
                            </div>
                            <code className="mt-1 block break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">
                                {primaryIp ?? "(nenhum header de IP)"}
                            </code>
                            {seen.length > 1 ? (
                                <p className="mt-1 text-[11px] text-zinc-500">
                                    Candidatos: {seen.join(", ")}
                                </p>
                            ) : null}
                        </div>
                    </div>
                </details>

                <div className="mt-6 flex flex-wrap gap-2">
                    <Link
                        href="/platform/login"
                        className="inline-flex h-10 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                    >
                        Voltar ao login
                    </Link>
                    <Link
                        href="/"
                        className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                    >
                        Ir para o app
                    </Link>
                </div>
            </div>
        </div>
    );
}
