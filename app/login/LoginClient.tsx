// app/login/LoginClient.tsx
"use client";

import React, { useMemo, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type Mode = "login" | "signup";

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function onlyDigits(s: string) {
    return String(s || "").replace(/\D/g, "");
}

export default function LoginPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const supabase = useMemo(() => createClient(), []);

    const initialMode = (searchParams.get("mode") as Mode) || "login";
    const [mode, setMode] = useState<Mode>(initialMode);

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    // representante / usuário
    const [repName, setRepName] = useState("");

    // company fields
    const [cnpj, setCnpj] = useState("");
    const [razaoSocial, setRazaoSocial] = useState("");
    const [nomeFantasia, setNomeFantasia] = useState("");
    const [companyPhone, setCompanyPhone] = useState("");

    // endereco
    const [cep, setCep] = useState("");
    const [endereco, setEndereco] = useState("");
    const [numero, setNumero] = useState("");
    const [bairro, setBairro] = useState("");
    const [cidade, setCidade] = useState("");
    const [uf, setUf] = useState("");

    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);

    const redirectTo = searchParams.get("redirectTo") || "/pedidos";

    // Quando digitar o CEP (apenas números), ao alcançar 8 dígitos buscamos ViaCEP
    useEffect(() => {
        const d = onlyDigits(cep);
        let mounted = true;
        async function fetchCep() {
            if (d.length < 8) return;
            try {
                const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
                if (!mounted) return;
                if (!res.ok) return;
                const j = await res.json();
                if (j && !j.erro) {
                    setEndereco(j.logradouro ?? "");
                    setBairro(j.bairro ?? "");
                    setCidade(j.localidade ?? "");
                    setUf((j.uf ?? "").toUpperCase());
                }
            } catch (e) {
                // silenciar erro — usuário pode preencher manualmente
                console.warn("ViaCEP failure", e);
            }
        }
        fetchCep();
        return () => {
            mounted = false;
        };
    }, [cep]);

    // Funções de validação simples
    function isValidCNPJ(value: string) {
        const d = onlyDigits(value);
        return d.length === 14;
    }

    async function autoSelectCompany() {
        try {
            // Esta versão usa cookies server-side: o servidor deve conhecer a sessão
            // (sincronizada via /api/auth/sync-session). Mantemos comportamento igual.
            const res = await fetch("/api/workspace/list");
            if (!res.ok) return;
            const json = await res.json();
            const companies = Array.isArray(json.companies) ? json.companies : [];
            if (companies.length === 1) {
                await fetch("/api/workspace/select", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ company_id: companies[0].id }),
                });
            }
        } catch (e) {
            console.warn("autoSelectCompany failed", e);
        }
    }

    async function syncServerSession(session: Session | null) {
        if (!session) return false;
        try {
            const response = await fetch("/api/auth/sync-session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    access_token: session.access_token,
                    refresh_token: session.refresh_token,
                }),
            });
            if (!response.ok) {
                console.warn("syncServerSession failed", await response.text());
                return false;
            }
            return true;
        } catch (err) {
            console.warn("syncServerSession failed", err);
            return false;
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
        const { data, error } = await supabase.auth.signInWithPassword({
            email: e1,
            password,
        });
        setLoading(false);

        if (error) return setErr(error.message);

        if (data?.session) {
            await syncServerSession(data.session);
        }

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

        // validações mínimas para empresa/representante
        if (!repName || repName.trim().length < 2) return setErr("Informe o nome do representante.");
        if (!cnpj || !isValidCNPJ(cnpj)) return setErr("Informe um CNPJ válido (14 dígitos).");
        if (!razaoSocial || razaoSocial.trim().length < 2) return setErr("Informe a razão social da empresa.");
        if (!companyPhone || onlyDigits(companyPhone).length < 8) return setErr("Informe um telefone da empresa.");

        setLoading(true);

        try {
            // Monta o objeto company para gravar no user_metadata (temporário)
            const companyMeta = {
                // Adicionado `name` exigido por app/api/companies/create/route.ts
                // Preferimos nomeFantasia quando preenchido, senão razaoSocial
                name: (nomeFantasia.trim() || razaoSocial.trim()),
                cnpj: onlyDigits(cnpj),
                razao_social: razaoSocial.trim(),
                nome_fantasia: nomeFantasia.trim() || razaoSocial.trim(),
                phone: companyPhone.trim(),
                address: {
                    cep: onlyDigits(cep),
                    endereco: endereco.trim(),
                    numero: numero.trim(),
                    bairro: bairro.trim(),
                    cidade: cidade.trim(),
                    uf: uf.trim().toUpperCase(),
                },
            };

            // Criar usuário no supabase auth com user_metadata contendo os dados
            // OBS: se preferir criar a company na tabela `companies` e associar o user
            // (company_users), implemente um endpoint server-side que execute essas inserts
            // com a service role. Aqui guardamos os dados no user_metadata.company.
            const { data, error } = await supabase.auth.signUp({
                email: e1,
                password,
                options: {
                    data: {
                        // nome do usuário/representante
                        name: repName.trim() || null,
                        // salva company nos user_metadata (json)
                        company: companyMeta,
                    },
                },
            });

            setLoading(false);

            if (error) {
                return setErr(error.message);
            }

            // Se não há session (ex.: confirmação de e-mail ativa), saímos
            if (!data.session) {
                setMsg("Conta criada! Confirme seu e-mail para entrar.");
                return;
            }

            // logado automaticamente (se a política do supabase permitir)
            if (data?.session) {
                // 1) sincroniza sessão no servidor (grava cookie)
                await syncServerSession(data.session);

                // 2) cria a company via endpoint server-side (RPC com service role)
                try {
                    const token = data.session.access_token;
                    const createResp = await fetch("/api/companies/create", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${token}`,
                        },
                        body: JSON.stringify({ company: companyMeta }),
                    });

                    if (!createResp.ok) {
                        const txt = await createResp.text();
                        console.warn("companies/create failed", txt || createResp.statusText);
                        setErr("Não foi possível criar a empresa: " + (txt || createResp.statusText));
                    } else {
                        const j = await createResp.json();
                        console.log("company created:", j);
                    }
                } catch (e: any) {
                    console.warn("companies/create error", e);
                    setErr("Erro ao criar empresa: " + (e?.message ?? String(e)));
                }
            }

            await autoSelectCompany();
            router.replace(redirectTo);
            router.refresh();
        } catch (e: any) {
            setLoading(false);
            setErr(e?.message ?? "Erro ao criar conta");
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
                    maxWidth: 720,
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

                <h1 style={{ fontSize: 20, margin: "4px 0 10px 0" }}>{isLogin ? "Acessar sua conta" : "Criar uma nova conta"}</h1>

                {msg ? <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "rgba(13,170,0,0.12)" }}>{msg}</div> : null}
                {err ? <div style={{ marginBottom: 10, padding: 10, borderRadius: 10, background: "rgba(255,0,0,0.10)" }}>{err}</div> : null}

                <form onSubmit={isLogin ? handleLogin : handleSignup}>
                    {!isLogin ? (
                        <>
                            {/* representante / usuário */}
                            <div style={{ marginBottom: 10 }}>
                                <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Nome do usuário / representante</label>
                                <input
                                    value={repName}
                                    onChange={(e) => setRepName(e.target.value)}
                                    disabled={loading}
                                    placeholder="Ex.: João Silva"
                                    style={{
                                        width: "100%",
                                        padding: 10,
                                        borderRadius: 10,
                                        border: "1px solid rgba(0,0,0,0.15)",
                                    }}
                                />
                            </div>

                            {/* empresa: CNPJ / razão / fantasia / telefone */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                <div>
                                    <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>CNPJ</label>
                                    <input
                                        value={cnpj}
                                        onChange={(e) => setCnpj(e.target.value)}
                                        disabled={loading}
                                        placeholder="00.000.000/0000-00"
                                        style={{
                                            width: "100%",
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Telefone (empresa)</label>
                                    <input
                                        value={companyPhone}
                                        onChange={(e) => setCompanyPhone(e.target.value)}
                                        disabled={loading}
                                        placeholder="(99) 99999-9999"
                                        style={{
                                            width: "100%",
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                </div>
                            </div>

                            <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                                <div>
                                    <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Razão social</label>
                                    <input
                                        value={razaoSocial}
                                        onChange={(e) => setRazaoSocial(e.target.value)}
                                        disabled={loading}
                                        placeholder="Razão social"
                                        style={{
                                            width: "100%",
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                </div>

                                <div>
                                    <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Nome fantasia</label>
                                    <input
                                        value={nomeFantasia}
                                        onChange={(e) => setNomeFantasia(e.target.value)}
                                        disabled={loading}
                                        placeholder="Nome fantasia (opcional)"
                                        style={{
                                            width: "100%",
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                </div>
                            </div>

                            <div style={{ marginTop: 10 }}>
                                <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Endereço (CEP)</label>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: 10 }}>
                                    <input
                                        value={cep}
                                        onChange={(e) => setCep(e.target.value)}
                                        disabled={loading}
                                        placeholder="CEP"
                                        style={{
                                            width: "100%",
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                    <input
                                        value={endereco}
                                        onChange={(e) => setEndereco(e.target.value)}
                                        disabled={loading}
                                        placeholder="Endereço"
                                        style={{
                                            width: "100%",
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                    <input
                                        value={numero}
                                        onChange={(e) => setNumero(e.target.value)}
                                        disabled={loading}
                                        placeholder="Nº"
                                        style={{
                                            width: "100%",
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
                                    <input
                                        value={bairro}
                                        onChange={(e) => setBairro(e.target.value)}
                                        disabled={loading}
                                        placeholder="Bairro"
                                        style={{
                                            width: "100%",
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                    <input
                                        value={cidade}
                                        onChange={(e) => setCidade(e.target.value)}
                                        disabled={loading}
                                        placeholder="Cidade"
                                        style={{
                                            width: "100%",
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                </div>

                                <div style={{ marginTop: 8 }}>
                                    <input
                                        value={uf}
                                        onChange={(e) => setUf(e.target.value)}
                                        disabled={loading}
                                        placeholder="UF"
                                        style={{
                                            width: 120,
                                            padding: 10,
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                        }}
                                    />
                                </div>
                            </div>
                        </>
                    ) : null}

                    {/* E-mail / senha (comum a login e signup) */}
                    <div style={{ marginTop: 12 }}>
                        <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>E-mail</label>
                        <input
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={loading}
                            placeholder="seu@exemplo.com"
                            style={{
                                width: "100%",
                                padding: 10,
                                borderRadius: 10,
                                border: "1px solid rgba(0,0,0,0.15)",
                            }}
                        />
                    </div>

                    <div style={{ marginTop: 10 }}>
                        <label style={{ display: "block", fontSize: 12, marginBottom: 6 }}>Senha</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={loading}
                            placeholder="Senha"
                            style={{
                                width: "100%",
                                padding: 10,
                                borderRadius: 10,
                                border: "1px solid rgba(0,0,0,0.15)",
                            }}
                        />
                    </div>

                    <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                padding: "10px 14px",
                                borderRadius: 10,
                                border: "none",
                                background: "#3B246B",
                                color: "#fff",
                                cursor: "pointer",
                                fontWeight: 700,
                            }}
                        >
                            {isLogin ? "Entrar" : "Criar conta"}
                        </button>

                        {isLogin ? (
                            <button
                                type="button"
                                disabled={loading}
                                onClick={() => handleResetPassword()}
                                style={{
                                    padding: "10px 14px",
                                    borderRadius: 10,
                                    border: "1px solid rgba(0,0,0,0.08)",
                                    background: "transparent",
                                    cursor: "pointer",
                                }}
                            >
                                Esqueci minha senha
                            </button>
                        ) : null}
                    </div>
                </form>

                <div style={{ marginTop: 12, fontSize: 13 }}>
                    {isLogin ? (
                        <div>
                            Não tem conta?{" "}
                            <a
                                onClick={() => setMode("signup")}
                                style={{ color: "#FF6600", cursor: "pointer", textDecoration: "underline" }}
                            >
                                Criar conta
                            </a>
                        </div>
                    ) : (
                        <div>
                            Já tem conta?{" "}
                            <a onClick={() => setMode("login")} style={{ color: "#3B246B", cursor: "pointer", textDecoration: "underline" }}>
                                Entrar
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
