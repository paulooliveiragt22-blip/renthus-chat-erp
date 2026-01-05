"use client";

import React, { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "./Login.module.css";

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

        // tenta auto-select (se houver apenas 1 company)
        await autoSelectCompany();

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
        <div className={styles.authPage}>
            <div className={styles.authCard}>
                <div className={styles.modeSwitcher}>
                    <button
                        type="button"
                        onClick={() => setMode("login")}
                        disabled={loading}
                        className={styles.tabButton}
                        data-active={isLogin ? "login" : undefined}
                    >
                        Entrar
                    </button>
                    <button
                        type="button"
                        onClick={() => setMode("signup")}
                        disabled={loading}
                        className={styles.tabButton}
                        data-active={!isLogin ? "signup" : undefined}
                    >
                        Criar conta
                    </button>
                </div>

                <h1 className={styles.heading}>
                    {isLogin ? "Acessar sua conta" : "Criar uma nova conta"}
                </h1>

                {msg ? (
                    <div className={`${styles.feedback} ${styles.feedbackSuccess}`}>
                        {msg}
                    </div>
                ) : null}

                {err ? (
                    <div className={`${styles.feedback} ${styles.feedbackError}`}>
                        {err}
                    </div>
                ) : null}

                <form onSubmit={isLogin ? handleLogin : handleSignup}>
                    {!isLogin ? (
                        <div className={styles.formField}>
                            <label className={styles.label}>Nome (opcional)</label>
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                disabled={loading}
                                placeholder="Ex.: João"
                                className={styles.input}
                            />
                        </div>
                    ) : null}

                    <div className={styles.formField}>
                        <label className={styles.label}>E-mail</label>
                        <input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={loading}
                            inputMode="email"
                            autoComplete="email"
                            placeholder="seuemail@exemplo.com"
                            className={styles.input}
                        />
                    </div>

                    <div className={styles.formField}>
                        <label className={styles.label}>Senha</label>
                        <input
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            type="password"
                            autoComplete={isLogin ? "current-password" : "new-password"}
                            placeholder="••••••••"
                            className={styles.input}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className={isLogin ? styles.primaryButton : styles.secondaryButton}
                    >
                        {loading ? "Aguarde..." : isLogin ? "Entrar" : "Criar conta"}
                    </button>

                    {isLogin ? (
                        <button
                            type="button"
                            onClick={handleResetPassword}
                            disabled={loading}
                            className={styles.ghostButton}
                        >
                            Esqueci minha senha
                        </button>
                    ) : null}
                </form>

                <div className={styles.footer}>
                    <Link href="/">Voltar</Link>
                </div>
            </div>
        </div>
    );
}
