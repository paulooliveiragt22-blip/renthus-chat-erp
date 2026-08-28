/**
 * Interceptor global fetch (client): 402 billing_inactive → /plano/bloqueado (P1.6).
 * Idempotente — instala uma vez no AdminShell.
 */

let installed = false;

export function installBillingFetchInterceptor(): void {
    if (typeof window === "undefined" || installed) return;
    installed = true;

    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const res = await nativeFetch(input, init);
        if (res.status !== 402) return res;

        try {
            const clone = res.clone();
            const body = (await clone.json()) as {
                error?: { code?: string } | string;
                code?: string;
            };
            const code =
                typeof body.error === "object" && body.error?.code
                    ? body.error.code
                    : body.code;
            if (code === "billing_inactive") {
                const path = window.location.pathname;
                if (
                    !path.startsWith("/plano") &&
                    path !== "/login" &&
                    !path.startsWith("/signup")
                ) {
                    window.location.assign("/plano/bloqueado");
                }
            }
        } catch {
            /* ignore parse errors */
        }

        return res;
    };
}
