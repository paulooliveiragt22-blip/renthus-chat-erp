"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ToastProvider, useToast } from "@/components/ToastProvider";
import { resolveSiteOrigin } from "@/lib/origin";
import { useAsyncAction } from "@/lib/hooks/useAsyncAction";

type Mode = "login" | "signup";

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function LoginContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = useMemo(() => createClient(), []);
    const { showToast } = useToast();

    const initialMode = (searchParams.get("mode") as Mode) || "login";
    const [mode, setMode] = useState<Mode>(initialMode);

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    // opcional pra signup (se quiser salvar nome depois em profile/customers)
    const [name, setName] = useState("");

    const redirectTo = searchParams.get("redirectTo") || "/pedidos";

    // Auto-select workspace if the user has only 1 company
    async function autoSelectCompany() {
        try {
            // lista workspaces do usuário
            const res = await fetch('/api/workspace/list');
            if (!res.ok) return;
            const json = await res.json();
            const companies = Array.isArray(json.companies) ? json.companies : [];
            if (companies.length === 1) {
                // seleciona automaticamente
                await fetch('/api/workspace/select', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ company_id: companies[0].id }),
                });
                // cookie renthus_company_id será setado pelo backend (HttpOnly)
            }
        } catch (e) {
            // silenciar: se der errado, o usuário poderá selecionar manualmente
            console.warn('autoSelectCompany failed', e);
        }
    }

    const loginAction = useAsyncAction(async () => {
        const e1 = email.trim().toLowerCase();
        if (!isValidEmail(e1)) throw { message: "Informe um e-mail válido." };
        if (!password || password.length < 6) throw { message: "Senha deve ter no mínimo 6 caracteres." };

        const { error } = await supabase.auth.signInWithPassword({
            email: e1,
            password,
        });

        if (error) throw error;

        // tenta auto-select (se houver apenas 1 company)
        await autoSelectCompany();

        router.replace(redirectTo);
        router.refresh();

        return { message: "Login realizado com sucesso." };
    });

    const signupAction = useAsyncAction(async () => {
        const e1 = email.trim().toLowerCase();
        if (!isValidEmail(e1)) throw { message: "Informe um e-mail válido." };
        if (!password || password.length < 6) throw { message: "Senha deve ter no mínimo 6 caracteres." };

        // Se você tiver confirmação de e-mail no Supabase, isso vai mandar e-mail.
        // Se não tiver, ele já cria e loga (dependendo da config do projeto).
        const { data, error } = await supabase.auth.signUp({
            email: e1,
            password,
            options: {
                data: {
                    name: name.trim() || null,
                },
            },
        });

        if (error) throw error;

        // Se exigir confirmação de e-mail, session pode vir nula.
        if (!data.session) {
            return { message: "Conta criada! Confirme seu e-mail para entrar." };
        }

        router.replace(redirectTo);
        router.refresh();

        return { message: "Conta criada com sucesso." };
    });

    const resetAction = useAsyncAction(async () => {
        const e1 = email.trim().toLowerCase();
        if (!isValidEmail(e1)) throw { message: "Digite seu e-mail para recuperar a senha." };

        // IMPORTANT: essa URL precisa existir no seu app (abaixo te dou a rota)
        const origin = resolveSiteOrigin() || (typeof window !== "undefined" ? window.location.origin : "");
        const { error } = await supabase.auth.resetPasswordForEmail(e1, {
            redirectTo: `${origin}/auth/reset`,
        });

        if (error) throw error;
        return { message: "Te enviei um e-mail para redefinir a senha." };
    });

    const loading = loginAction.loading || signupAction.loading || resetAction.loading;

    async function handleAction(
        action: typeof loginAction | typeof signupAction | typeof resetAction
    ) {
        const result = await action.execute();

        if (result.ok) {
            const message = result.data?.message;
            if (message) {
                showToast({ variant: "success", message });
            }
            return true;
        }

        if (result.error) {
            showToast({
                variant: "error",
                message: result.error.message,
                actionLabel: result.error.retryable ? "Tentar novamente" : undefined,
                onAction: result.error.retryable ? action.retry : undefined,
            });
        }
        return false;
    }

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        await handleAction(loginAction);
    }

    async function handleSignup(e: React.FormEvent) {
        e.preventDefault();
        await handleAction(signupAction);
    }

    async function handleResetPassword() {
        await handleAction(resetAction);
    }

    const isLogin = mode === "login";

    return (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
            <div
                style={{
                    width: "100%",
                    maxWidth: 420,
                    border: "1px solid rgba(0,0,0,0.12)",
                    borderRadius: 14,
                    padding: 18,
                }}
            >
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    <button
                        type="button"
                        onClick={() => setMode("login")}
                        disabled={loading}
                        style={{
                            flex: 1,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid rgba(0,0,0,0.12)",
                            background: isLogin ? "#3B246B" : "transparent",
                            color: isLogin ? "#fff" : "#111",
                            cursor: "pointer",
                        }}
                    >
                        Entrar
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode("signup")}
                        disabled={loading}
                        style={{
                            flex: 1,
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid rgba(0,0,0,0.12)",
                            background: !isLogin ? "#FF6600" : "transparent",
                            color: !isLogin ? "#fff" : "#111",
                            cursor: "pointer",
                        }}
                    >
                        Criar conta
                    </button>
                </div>

                <h1 style={{ fontSize: 20, margin: "4px 0 10px 0" }}>
                    {isLogin ? "Acessar sua conta" : "Criar uma nova conta"}
                </h1>

                <form onSubmit={isLogin ? handleLogin : handleSignup}>
                    {!isLogin ? (
                        <div style={{ marginBottom: 10 }}>
                            <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                                Nome (opcional)
                            </label>
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                disabled={loading}
                                placeholder="Ex.: João"
                                style={{
                                    width: "100%",
                                    padding: 10,
                                    borderRadius: 10,
                                    border: "1px solid rgba(0,0,0,0.15)",
                                }}
                            />
                        </div>
                    ) : null}

                    <div style={{ marginBottom: 10 }}>
                        <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>E-mail</label>
                        <input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={loading}
                            inputMode="email"
                            autoComplete="email"
                            placeholder="seuemail@exemplo.com"
                            style={{
                                width: "100%",
                                padding: 10,
                                borderRadius: 10,
                                border: "1px solid rgba(0,0,0,0.15)",
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: 10 }}>
                        <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Senha</label>
                        <input
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            type="password"
                            autoComplete={isLogin ? "current-password" : "new-password"}
                            placeholder="••••••••"
                            style={{
                                width: "100%",
                                padding: 10,
                                borderRadius: 10,
                                border: "1px solid rgba(0,0,0,0.15)",
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            width: "100%",
                            padding: "11px 12px",
                            borderRadius: 12,
                            border: "none",
                            background: isLogin ? "#3B246B" : "#FF6600",
                            color: "#fff",
                            cursor: "pointer",
                            fontWeight: 700,
                            marginTop: 6,
                        }}
                    >
                        {loading ? "Aguarde..." : isLogin ? "Entrar" : "Criar conta"}
                    </button>

                    {isLogin ? (
                        <button
                            type="button"
                            onClick={handleResetPassword}
                            disabled={loading}
                            style={{
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 12,
                                border: "1px solid rgba(0,0,0,0.12)",
                                background: "transparent",
                                cursor: "pointer",
                                marginTop: 10,
                            }}
                        >
                            Esqueci minha senha
                        </button>
                    ) : null}
                </form>

                <div style={{ marginTop: 14, fontSize: 12, opacity: 0.8 }}>
                    <Link href="/">Voltar</Link>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <ToastProvider>
            <LoginContent />
        </ToastProvider>
    );
}
