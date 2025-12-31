"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function LoginPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = useMemo(() => createClient(), []);

    const initialMode = (searchParams.get("mode") as Mode) || "login";
    const [mode, setMode] = useState<Mode>(initialMode);

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    // opcional pra signup (se quiser salvar nome depois em profile/customers)
    const [name, setName] = useState("");

    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    const redirectTo = searchParams.get("redirectTo") || "/pedidos";


    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        setMsg(null);
        setErr(null);

        const e1 = email.trim().toLowerCase();
        if (!isValidEmail(e1)) return setErr("Informe um e-mail válido.");
        if (!password || password.length < 6) return setErr("Senha deve ter no mínimo 6 caracteres.");

        setLoading(true);
        const { error } = await supabase.auth.signInWithPassword({
            email: e1,
            password,
        });
        setLoading(false);

        if (error) return setErr(error.message);

        router.replace(redirectTo);
        router.refresh();
    }

    async function handleSignup(e: React.FormEvent) {
        e.preventDefault();
        setMsg(null);
        setErr(null);

        const e1 = email.trim().toLowerCase();
        if (!isValidEmail(e1)) return setErr("Informe um e-mail válido.");
        if (!password || password.length < 6) return setErr("Senha deve ter no mínimo 6 caracteres.");

        setLoading(true);

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

        setLoading(false);

        if (error) return setErr(error.message);

        // Se exigir confirmação de e-mail, session pode vir nula.
        if (!data.session) {
            setMsg("Conta criada! Confirme seu e-mail para entrar.");
            return;
        }

        router.replace(redirectTo);
        router.refresh();
    }

    async function handleResetPassword() {
        setMsg(null);
        setErr(null);

        const e1 = email.trim().toLowerCase();
        if (!isValidEmail(e1)) return setErr("Digite seu e-mail para recuperar a senha.");

        setLoading(true);

        // IMPORTANT: essa URL precisa existir no seu app (abaixo te dou a rota)
        const origin =
            typeof window !== "undefined" ? window.location.origin : "";
        const { error } = await supabase.auth.resetPasswordForEmail(e1, {
            redirectTo: `${origin}/auth/reset`,
        });

        setLoading(false);

        if (error) return setErr(error.message);
        setMsg("Te enviei um e-mail para redefinir a senha.");
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

                {msg ? (
                    <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "rgba(13,170,0,0.12)" }}>
                        {msg}
                    </div>
                ) : null}

                {err ? (
                    <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "rgba(255,0,0,0.10)" }}>
                        {err}
                    </div>
                ) : null}

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
