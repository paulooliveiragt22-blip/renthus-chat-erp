export default function PlatformForbiddenPage() {
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
                    Vercel com o seu IP público.
                </p>
                <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
                    <li>
                        Descubra seu IP em{" "}
                        <a
                            className="text-primary underline"
                            href="https://ifconfig.me"
                            target="_blank"
                            rel="noreferrer"
                        >
                            ifconfig.me
                        </a>
                    </li>
                    <li>
                        Vercel → Project → Settings → Environment Variables → Production
                    </li>
                    <li>
                        Defina{" "}
                        <code className="font-mono text-xs">
                            PLATFORM_ADMIN_IP_ALLOWLIST=SEU_IP
                        </code>
                    </li>
                    <li>Redeploy e tente de novo</li>
                </ol>
                <p className="mt-4 text-xs text-zinc-400">
                    Não use <code className="font-mono">127.0.0.1</code> na Vercel — a plataforma
                    vê o IP público do seu navegador.
                </p>
            </div>
        </div>
    );
}
