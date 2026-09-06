"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    isFacebookSignupOrigin,
    loadFacebookSdk,
    type FacebookSdk,
} from "@/lib/meta/loadFacebookSdk";
import { EMBEDDED_SIGNUP_EVENTS } from "@/src/domain/contracts/embeddedSignup";

type SignupConfig = {
    appId: string;
    configId: string;
    graphVersion: string;
    featureTypeDefault: string;
    sessionInfoVersion: string;
};

type SessionInfo = {
    event: string;
    wabaId: string;
    phoneNumberId?: string;
};

type CompleteJson = {
    coexistence?: boolean;
    error?: string;
    hint?: string;
};

function isFinishEvent(event: string): boolean {
    return (EMBEDDED_SIGNUP_EVENTS as readonly string[]).includes(event);
}

export default function WhatsAppEmbeddedSignupButton(props: {
    onConnected: () => void;
}) {
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [prepError, setPrepError] = useState<string | null>(null);
    const sessionRef = useRef<SessionInfo | null>(null);
    const cfgRef = useRef<SignupConfig | null>(null);
    const fbRef = useRef<FacebookSdk | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const cfgRes = await fetch("/api/admin/whatsapp-channel/embedded-signup/config", {
                    credentials: "include",
                    cache: "no-store",
                });
                const cfg = (await cfgRes.json().catch(() => ({}))) as SignupConfig & {
                    error?: string;
                    hint?: string;
                };
                if (!cfgRes.ok) {
                    throw new Error(cfg.hint || cfg.error || "Embedded Signup não configurado.");
                }
                const fb = await loadFacebookSdk({
                    appId: cfg.appId,
                    version: cfg.graphVersion,
                });
                if (cancelled) return;
                cfgRef.current = cfg;
                fbRef.current = fb;
                setReady(true);
            } catch (e) {
                if (cancelled) return;
                setPrepError(e instanceof Error ? e.message : "SDK da Meta indisponível.");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!isFacebookSignupOrigin(event.origin)) return;
            let data: Record<string, unknown>;
            try {
                data =
                    typeof event.data === "string"
                        ? (JSON.parse(event.data) as Record<string, unknown>)
                        : (event.data as Record<string, unknown>);
            } catch {
                return;
            }
            if (data.type !== "WA_EMBEDDED_SIGNUP") return;
            const ev = String(data.event ?? "").toUpperCase();
            const inner = (data.data ?? {}) as Record<string, unknown>;
            const wabaId = String(inner.waba_id ?? "").trim();
            if (!wabaId) return;
            sessionRef.current = {
                event: ev,
                wabaId,
                phoneNumberId: inner.phone_number_id
                    ? String(inner.phone_number_id)
                    : undefined,
            };
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    const waitForSession = useCallback(async (): Promise<SessionInfo | null> => {
        const started = Date.now();
        while (Date.now() - started < 6000) {
            if (sessionRef.current?.wabaId) return sessionRef.current;
            await new Promise((r) => setTimeout(r, 150));
        }
        return sessionRef.current;
    }, []);

    const complete = useCallback(
        async (code: string, session: SessionInfo) => {
            const res = await fetch("/api/admin/whatsapp-channel/embedded-signup/complete", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    event: isFinishEvent(session.event)
                        ? session.event
                        : "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
                    wabaId: session.wabaId,
                    phoneNumberId: session.phoneNumberId,
                }),
            });
            const json = (await res.json().catch(() => ({}))) as CompleteJson;
            if (!res.ok) {
                throw new Error(json.hint || json.error || "Falha ao concluir a conexão.");
            }
            toast.success(
                json.coexistence
                    ? "WhatsApp conectado. Você continua usando o app no celular."
                    : "WhatsApp conectado via Cloud API."
            );
            props.onConnected();
        },
        [props]
    );

    function launch() {
        const cfg = cfgRef.current;
        const fb = fbRef.current;
        if (!cfg || !fb) {
            toast.error(prepError || "Aguarde o carregamento da Meta e tente de novo.");
            return;
        }
        setBusy(true);
        sessionRef.current = null;
        fb.login(
            (response) => {
                void (async () => {
                    try {
                        const code = response.authResponse?.code?.trim() ?? "";
                        if (!code) {
                            toast.message("Conexão cancelada ou popup bloqueado.");
                            return;
                        }
                        const session = await waitForSession();
                        if (!session?.wabaId) {
                            throw new Error(
                                "A Meta não devolveu a conta WhatsApp. Tente de novo."
                            );
                        }
                        await complete(code, session);
                    } catch (e) {
                        const msg = e instanceof Error ? e.message : "Falha ao conectar.";
                        toast.error(msg);
                    } finally {
                        setBusy(false);
                    }
                })();
            },
            {
                config_id: cfg.configId,
                response_type: "code",
                override_default_response_type: true,
                extras: {
                    setup: {},
                    featureType: cfg.featureTypeDefault,
                    sessionInfoVersion: cfg.sessionInfoVersion,
                },
            }
        );
    }

    return (
        <div className="flex flex-col items-start gap-2">
            <Button type="button" disabled={busy || !ready} onClick={launch}>
                {busy || !ready ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {busy ? "Conectando…" : "Conectar WhatsApp"}
            </Button>
            {prepError ? (
                <p className="max-w-prose text-xs text-amber-800 dark:text-amber-200">{prepError}</p>
            ) : null}
        </div>
    );
}
