// app/login/LoginClient.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export default function LoginPage() {
    const router       = useRouter();
    const searchParams = useSearchParams();
    const supabase     = useMemo(() => createClient(), []);

    const [email,    setEmail]    = useState("");
    const [password, setPassword] = useState("");
    const [loading,  setLoading]  = useState(false);
    const [msg,      setMsg]      = useState<string | null>(null);
    const [err,      setErr]      = useState<string | null>(null);

    const redirectTo = searchParams.get("redirectTo") || "/pedidos";

    async function syncServerSession(session: Session | null) {
        if (!session) return false;
        try {
            const response = await fetch("/api/auth/sync-session", {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    access_token:  session.access_token,
                    refresh_token: session.refresh_token,
                }),
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async function autoSelectCompany() {
        try {
            const res = await fetch("/api/workspace/list");
            if (!res.ok) return;
            const json = await res.json();
            const companies = Array.isArray(json.companies) ? json.companies : [];
            if (companies.length === 1) {
                await fetch("/api/workspace/select", {
                    method:  "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ company_id: companies[0].id }),
                });
            }
        } catch {/* não bloquear */}
    }

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        setMsg(null);
        setErr(null);

        const e1 = email.trim().toLowerCase();
        if (!isValidEmail(e1)) return setErr("Informe um e-mail válido.");
        if (!password || password.length < 6) return setErr("Senha deve ter no mínimo 6 caracteres.");

        setLoading(true);
        const { data, error } = await supabase.auth.signInWithPassword({ email: e1, password });
        setLoading(false);

        if (error) return setErr(error.message);

        if (data?.session) await syncServerSession(data.session);
        await autoSelectCompany();

        router.replace(redirectTo);
        router.refresh();
    }

    async function handleResetPassword() {
        setMsg(null);
        setErr(null);
        const e1 = email.trim().toLowerCase();
        if (!isValidEmail(e1)) return setErr("Digite seu e-mail para recuperar a senha.");

        setLoading(true);
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const { error } = await supabase.auth.resetPasswordForEmail(e1, {
            redirectTo: `${origin}/auth/reset`,
        });
        setLoading(false);

        if (error) return setErr(error.message);
        setMsg("Te enviei um e-mail para redefinir a senha.");
    }

    return (
        <div style={{
            minHeight: "100vh",
            display:   "grid",
            placeItems: "center",
            padding:   16,
            background: "#f9fafb",
        }}>
            <div style={{
                width:        "100%",
                maxWidth:     420,
                background:   "#fff",
                border:       "1px solid #e5e7eb",
                borderRadius: 16,
                padding:      "32px 28px",
                boxShadow:    "0 8px 32px rgba(0,0,0,0.08)",
            }}>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: "0 0 6px" }}>
                    Entrar na sua conta
                </h1>
                <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 24px" }}>
                    Acesse o painel Renthus
                </p>

                {msg && (
                    <div style={{
                        marginBottom: 16, padding: "10px 14px", borderRadius: 10,
                        background: "#f0fdf4", border: "1px solid #bbf7d0",
                        fontSize: 13, color: "#15803d",
                    }}>
                        {msg}
                    </div>
                )}
                {err && (
                    <div style={{
                        marginBottom: 16, padding: "10px 14px", borderRadius: 10,
                        background: "#fef2f2", border: "1px solid #fecaca",
                        fontSize: 13, color: "#b91c1c",
                    }}>
                        {err}
                    </div>
                )}

                <form onSubmit={handleLogin}>
                    <div style={{ marginBottom: 14 }}>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                            E-mail
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={loading}
                            placeholder="seu@exemplo.com"
                            style={{
                                width: "100%", padding: "11px 14px",
                                border: "1.5px solid #d1d5db", borderRadius: 10,
                                fontSize: 14, color: "#111827", outline: "none",
                                boxSizing: "border-box",
                            }}
                        />
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 }}>
                            Senha
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            placeholder="••••••••"
                            style={{
                                width: "100%", padding: "11px 14px",
                                border: "1.5px solid #d1d5db", borderRadius: 10,
                                fontSize: 14, color: "#111827", outline: "none",
                                boxSizing: "border-box",
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            width: "100%", padding: "13px 20px",
                            background: "#3B246B", color: "#fff",
                            border: "none", borderRadius: 12,
                            fontSize: 15, fontWeight: 700, cursor: "pointer",
                            opacity: loading ? 0.7 : 1,
                        }}
                    >
                        {loading ? "Entrando..." : "Entrar"}
                    </button>
                </form>

                <div style={{ marginTop: 16, textAlign: "center" }}>
                    <button
                        type="button"
                        disabled={loading}
                        onClick={handleResetPassword}
                        style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: 13, color: "#6b7280", textDecoration: "underline",
                        }}
                    >
                        Esqueci minha senha
                    </button>
                </div>

                <div style={{
                    marginTop: 28, paddingTop: 20, borderTop: "1px solid #f3f4f6",
                    textAlign: "center", fontSize: 13, color: "#6b7280",
                }}>
                    Ainda não é cliente?{" "}
                    <a href="/signup" style={{ color: "#FF6B00", fontWeight: 700, textDecoration: "none" }}>
                        Conheça os planos →
                    </a>
                </div>
            </div>
        </div>
    );
}
