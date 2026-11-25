// app/login/LoginClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import PasswordInput from "@/components/PasswordInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { mixpanelIdentify } from "@/lib/analytics/mixpanelBrowser";
import { loginDestination, profileLabel } from "@/lib/workspace/loginDestination";
import type { AttendanceMode } from "@/src/service/domain/types";

/** Validação linear (sem regex com backtracking / S5852). */
function isValidEmail(email: string) {
    const s = email.trim();
    if (s.length === 0 || s.length > 254) return false;
    const at = s.indexOf("@");
    if (at <= 0) return false;
    if (s.includes("@", at + 1)) return false;
    const local = s.slice(0, at);
    const host = s.slice(at + 1);
    if (local.length > 64 || host.length === 0 || host.length > 253) return false;
    if (!host.includes(".")) return false;
    return true;
}

type LoginCompany = {
    id: string;
    name: string;
    attendanceMode: AttendanceMode;
};

export default function LoginPage() {
    const router       = useRouter();
    const searchParams = useSearchParams();
    const supabase     = useMemo(() => createClient(), []);

    const [email,    setEmail]    = useState("");
    const [password, setPassword] = useState("");
    const [loading,  setLoading]  = useState(false);
    const [msg,      setMsg]      = useState<string | null>(null);
    const [err,      setErr]      = useState<string | null>(null);
    const [choices, setChoices] = useState<LoginCompany[] | null>(null);
    const [picked, setPicked] = useState("");

    const redirectTo = searchParams.get("redirectTo") || "/pedidos";

    useEffect(() => {
        if (searchParams.get("cadastro") === "ok") {
            setMsg("Conta criada. Entre com o e-mail e a senha que você cadastrou.");
        }
    }, [searchParams]);

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

    async function loadCompanies(): Promise<LoginCompany[]> {
        const res = await fetch("/api/workspace/list", { credentials: "include" });
        if (!res.ok) return [];
        const json = (await res.json()) as { companies?: unknown };
        if (!Array.isArray(json.companies)) return [];
        return json.companies.flatMap((row) => {
            if (!row || typeof row !== "object") return [];
            const item = row as { id?: unknown; name?: unknown; attendanceMode?: unknown };
            if (typeof item.id !== "string" || typeof item.name !== "string") return [];
            const attendanceMode: AttendanceMode = item.attendanceMode === "service" ? "service" : "delivery";
            return [{ id: item.id, name: item.name, attendanceMode }];
        });
    }

    async function selectCompany(companyId: string) {
        const res = await fetch("/api/workspace/select", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ company_id: companyId }),
        });
        if (!res.ok) throw new Error("Não foi possível abrir esse perfil.");
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

        try {
            if (data?.session) {
                await syncServerSession(data.session);
                const u = data.session.user;
                mixpanelIdentify(u.id, { email: u.email ?? null });
            }
            const companies = await loadCompanies();
            if (companies.length === 1) {
                const only = companies[0];
                if (only) {
                    await selectCompany(only.id);
                    router.replace(loginDestination(only.attendanceMode, redirectTo));
                    router.refresh();
                }
                return;
            }
            if (companies.length > 1) {
                await fetch("/api/workspace/clear", { method: "POST", credentials: "include" });
                setChoices(companies);
                setPicked(companies[0]?.id ?? "");
                return;
            }

            router.replace(redirectTo);
            router.refresh();
        } catch (error: unknown) {
            setErr(error instanceof Error ? error.message : "Não foi possível abrir o perfil.");
        }
    }

    async function enterPickedProfile() {
        const company = choices?.find((item) => item.id === picked);
        if (!company) return;
        setErr(null);
        setLoading(true);
        try {
            await selectCompany(company.id);
            router.replace(loginDestination(company.attendanceMode, redirectTo));
            router.refresh();
        } catch (error: unknown) {
            setErr(error instanceof Error ? error.message : "Não foi possível abrir esse perfil.");
            setLoading(false);
        }
    }

    async function handleResetPassword() {
        setMsg(null);
        setErr(null);
        const e1 = email.trim().toLowerCase();
        if (!isValidEmail(e1)) return setErr("Digite seu e-mail para recuperar a senha.");

        setLoading(true);
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const { error } = await supabase.auth.resetPasswordForEmail(e1, {
            redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/auth/set-password")}`,
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
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                    <img
                        src="/icons/icon-192.png?v=mark10"
                        alt=""
                        width={56}
                        height={56}
                        style={{
                            height: 56,
                            width: 56,
                            display: "block",
                            flexShrink: 0,
                            borderRadius: 14,
                        }}
                    />
                    <span style={{ fontSize: 20, fontWeight: 700, color: "#111827", letterSpacing: "-0.02em" }}>
                        RenthusAgent
                    </span>
                </div>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: "#111827", margin: "0 0 6px" }}>
                    Entrar na sua conta
                </h1>
                <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 24px" }}>
                    Acesse o painel RenthusAgent
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
                    <div
                        role="alert"
                        style={{
                            marginBottom: 16, padding: "10px 14px", borderRadius: 10,
                            background: "#fef2f2", border: "1px solid #fecaca",
                            fontSize: 13, color: "#b91c1c",
                        }}
                    >
                        {err}
                    </div>
                )}

                {choices && choices.length > 1 ? (
                    <div>
                        <p style={{ fontSize: 13, color: "#374151", margin: "0 0 12px" }}>
                            Qual perfil você quer acessar?
                        </p>
                        <Select value={picked} onValueChange={setPicked}>
                            <SelectTrigger className="w-full" aria-label="Perfil">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {choices.map((company) => (
                                    <SelectItem key={company.id} value={company.id}>
                                        {company.name} · {profileLabel(company.attendanceMode)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <button
                            type="button"
                            disabled={loading || !picked}
                            onClick={() => void enterPickedProfile()}
                            style={{
                                width: "100%", padding: "13px 20px", marginTop: 16,
                                background: "#16364D", color: "#fff",
                                border: "none", borderRadius: 12,
                                fontSize: 15, fontWeight: 700, cursor: "pointer",
                                opacity: loading ? 0.7 : 1,
                            }}
                        >
                            {loading ? "Entrando..." : "Acessar"}
                        </button>
                    </div>
                ) : (
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
                        <PasswordInput
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            placeholder="••••••••"
                            autoComplete="current-password"
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
                            background: "#16364D", color: "#fff",
                            border: "none", borderRadius: 12,
                            fontSize: 15, fontWeight: 700, cursor: "pointer",
                            opacity: loading ? 0.7 : 1,
                        }}
                    >
                        {loading ? "Entrando..." : "Entrar"}
                    </button>
                </form>
                )}

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
