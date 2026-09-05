"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mixpanelReset } from "@/lib/analytics/mixpanelBrowser";

/**
 * Encerra sessão e redireciona ao login.
 * Usado pelas telas standalone de paywall (/plano/pagar, bloqueado, reativar).
 */
export default function LogoutPage() {
    const router = useRouter();

    useEffect(() => {
        let cancelled = false;

        async function run() {
            try {
                await fetch("/api/auth/signout", { method: "POST", credentials: "include" });
            } catch {
                /* best-effort */
            }
            try {
                await createClient().auth.signOut();
            } catch {
                /* best-effort */
            }
            try {
                mixpanelReset();
            } catch {
                /* best-effort */
            }
            if (!cancelled) {
                router.replace("/login");
            }
        }

        void run();
        return () => {
            cancelled = true;
        };
    }, [router]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-zinc-950">
            <p className="text-sm text-zinc-500">Saindo da conta…</p>
        </div>
    );
}
