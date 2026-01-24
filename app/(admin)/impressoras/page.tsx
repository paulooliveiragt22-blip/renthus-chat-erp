// app/(admin)/impressoras/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

// se você colocou o componente na mesma pasta de components com alias @
import DownloadAgentButton from "@/components/DownloadAgentButton";

type PrinterRow = {
    id: string;
    company_id: string;
    name: string;
    type: string;
    format: string;
    auto_print: boolean;
    interval_seconds: number;
    is_active: boolean;
    config?: any;
    created_at?: string;
};

type PrintJobRow = {
    id: string;
    company_id: string;
    order_id: string | null;
    status: string;
    error?: string | null;
    payload?: any;
    created_at?: string;
    processed_at?: string | null;
};

function simpleBtn(style: React.CSSProperties = {}) {
    return {
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(0,0,0,0.08)",
        background: "#3B246B",
        color: "#fff",
        cursor: "pointer",
        ...style,
    } as React.CSSProperties;
}

export default function PrintersAdminPage() {
    const supabase = useMemo(() => createClient(), []);
    const { currentCompanyId, currentCompany, loading: loadingWorkspace, reload } = useWorkspace();
    const router = useRouter();

    const [loading, setLoading] = useState(false);
    const [printers, setPrinters] = useState<PrinterRow[]>([]);
    const [jobs, setJobs] = useState<PrintJobRow[]>([]);
    const [msg, setMsg] = useState<string | null>(null);

    const [openForm, setOpenForm] = useState(false);
    const [editing, setEditing] = useState<PrinterRow | null>(null);

    // local printers modal state
    const [localPrinters, setLocalPrinters] = useState<{ id: string; name: string }[]>([]);
    const [loadingLocalPrinters, setLoadingLocalPrinters] = useState(false);
    const [showLocalModal, setShowLocalModal] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    // form fields
    const emptyForm = {
        name: "",
        type: "network",
        format: "receipt",
        auto_print: true,
        interval_seconds: 0,
        is_active: true,
        config: {},
    };
    const [form, setForm] = useState<any>(emptyForm);

    useEffect(() => {
        if (!currentCompanyId) return;
        loadPrinters();
        loadJobs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentCompanyId]);

    async function loadPrinters() {
        if (!currentCompanyId) return;
        setLoading(true);
        setMsg(null);
        try {
            const { data, error } = await supabase
                .from("printers")
                .select("*")
                .eq("company_id", currentCompanyId)
                .order("created_at", { ascending: false });
            if (error) {
                setMsg("Erro ao carregar impressoras: " + error.message);
                setPrinters([]);
            } else {
                setPrinters(Array.isArray(data) ? (data as PrinterRow[]) : []);
            }
        } catch (e: any) {
            setMsg("Erro inesperado: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    async function loadJobs() {
        if (!currentCompanyId) return;
        try {
            const { data, error } = await supabase
                .from("print_jobs")
                .select("*")
                .eq("company_id", currentCompanyId)
                .order("created_at", { ascending: false })
                .limit(50);
            if (!error) {
                setJobs(Array.isArray(data) ? (data as PrintJobRow[]) : []);
            }
        } catch (e) {
            // ignore
        }
    }

    function openNewForm() {
        setEditing(null);
        setForm({ ...emptyForm, config: {} });
        setOpenForm(true);
    }

    function openEditForm(p: PrinterRow) {
        setEditing(p);
        setForm({
            name: p.name ?? "",
            type: p.type ?? "network",
            format: p.format ?? "receipt",
            auto_print: !!p.auto_print,
            interval_seconds: p.interval_seconds ?? 0,
            is_active: p.is_active ?? true,
            config: p.config ?? {},
        });
        setOpenForm(true);
    }

    function updateFormField<K extends string>(k: K, v: any) {
        setForm((prev: any) => ({ ...prev, [k]: v }));
    }

    async function createPrinter(payload: {
        name: string;
        type: string;
        format: string;
        auto_print: boolean;
        interval_seconds: number;
        is_active: boolean;
        config: Record<string, any>;
    }) {
        if (!currentCompanyId) {
            throw new Error("Company não selecionada.");
        }
        const res = await fetch(`/api/print/companies/${currentCompanyId}/printers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) {
            throw new Error(json?.error || "Erro ao criar impressora.");
        }
        return json?.printer ?? null;
    }

    async function savePrinter() {
        if (!currentCompanyId) {
            setMsg("Company não selecionada.");
            return;
        }
        if (!form.name || !form.type || !form.format) {
            setMsg("Preencha nome, tipo e formato.");
            return;
        }
        setLoading(true);
        setMsg(null);
        try {
            if (editing) {
                const { error } = await supabase
                    .from("printers")
                    .update({
                        name: form.name,
                        type: form.type,
                        format: form.format,
                        auto_print: !!form.auto_print,
                        interval_seconds: Number(form.interval_seconds || 0),
                        is_active: !!form.is_active,
                        config: form.config || {},
                    })
                    .eq("id", editing.id);
                if (error) {
                    setMsg("Erro ao atualizar: " + error.message);
                } else {
                    setMsg("Atualizado com sucesso.");
                    setOpenForm(false);
                    loadPrinters();
                }
            } else {
                await createPrinter({
                    name: form.name,
                    type: form.type,
                    format: form.format,
                    auto_print: !!form.auto_print,
                    interval_seconds: Number(form.interval_seconds || 0),
                    is_active: !!form.is_active,
                    config: form.config || {},
                });
                setMsg("Criado com sucesso.");
                setOpenForm(false);
                loadPrinters();
            }
        } catch (e: any) {
            setMsg("Erro inesperado: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    async function deletePrinter(id: string) {
        if (!confirm("Confirmar exclusão da impressora?")) return;
        setLoading(true);
        try {
            const { error } = await supabase.from("printers").delete().eq("id", id);
            if (error) setMsg("Erro ao excluir: " + error.message);
            else {
                setMsg("Excluído.");
                loadPrinters();
            }
        } catch (e: any) {
            setMsg("Erro inesperado: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    // Create a test order so the agent prints it
    async function testPrint(printerId?: string) {
        if (!currentCompanyId) {
            setMsg("Selecione a empresa (workspace) primeiro.");
            return;
        }
        setLoading(true);
        setMsg(null);
        try {
            const { data: ord, error: ordErr } = await supabase
                .from("orders")
                .insert([
                    {
                        company_id: currentCompanyId,
                        channel: "admin",
                        customer_name: "Teste Impressão",
                        customer_phone: "000000000",
                        delivery_address: null,
                        total_amount: 0,
                        status: "new",
                        notes: "Pedido de teste gerado pela UI de impressoras",
                    },
                ])
                .select("id")
                .single();
            if (ordErr) {
                setMsg("Erro ao criar pedido de teste: " + ordErr.message);
                setLoading(false);
                return;
            }
            const orderId = ord.id;
            await supabase.from("order_items").insert([
                {
                    order_id: orderId,
                    product_name: "Teste Cupom",
                    quantity: 1,
                    unit_price: 0
                    // NÃO incluir line_total — é gerado pelo banco
                },
            ]);


            setMsg("Pedido de teste criado (id: " + orderId + "). O agent deve imprimir automaticamente.");
            setTimeout(() => loadJobs(), 1500);
        } catch (e: any) {
            setMsg("Erro ao gerar teste: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    // ----------------- LOCAL PRINTERS (agent) integration -----------------
    async function fetchLocalPrinters() {
        setLoadingLocalPrinters(true);
        setLocalError(null);
        setLocalPrinters([]);
        try {
            // call agent local API
            const res = await fetch("http://localhost:4001/local/printers", { method: "GET" });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(txt || `Status ${res.status}`);
            }
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || "No printers");
            setLocalPrinters(json.printers || []);
            setShowLocalModal(true);
        } catch (e: any) {
            setLocalPrinters([]);
            setLocalError(e.message || String(e));
            setShowLocalModal(true);
        } finally {
            setLoadingLocalPrinters(false);
        }
    }

    async function addLocalPrinterAsCompanyPrinter(printerName: string) {
        if (!currentCompanyId) {
            setMsg("Selecione a empresa primeiro.");
            return;
        }
        setLoading(true);
        try {
            await createPrinter({
                name: `Impressora local - ${printerName}`,
                type: "a4",
                format: "a4",
                auto_print: false,
                interval_seconds: 0,
                is_active: true,
                config: { printerName },
            });
            setMsg("Impressora local adicionada com sucesso.");
            loadPrinters();
            setShowLocalModal(false);
        } catch (e: any) {
            setMsg("Erro ao registrar impressora local: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    // ----------------- render -----------------
    return (
        <div style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 22 }}>Impressoras</h1>
                    <div style={{ marginTop: 6, color: "#666" }}>
                        Gerencie as impressoras da sua empresa. Adicione impressoras (network, USB, Bluetooth ou A4), escolha o formato e se a impressão é automática.
                    </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => reload().then(loadPrinters)} style={simpleBtn({ background: "#666" })}>Atualizar</button>
                    <button onClick={openNewForm} style={simpleBtn()}>Nova impressora</button>

                    {/* Botão que busca impressoras locais via agent */}
                    <button onClick={() => fetchLocalPrinters()} style={simpleBtn({ background: "#5a2" })}>
                        {loadingLocalPrinters ? "Buscando..." : "Buscar impressoras do PC"}
                    </button>

                    {/* Download agent button */}
                    <DownloadAgentButton />
                </div>
            </div>

            <div style={{ marginTop: 16 }}>
                {msg ? <div style={{ padding: 10, borderRadius: 8, background: "#fff3", marginBottom: 12 }}>{msg}</div> : null}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 18 }}>
                    {/* Left: printers list */}
                    <div>
                        <h3>Impressoras configuradas</h3>
                        {loading ? <div>Carregando...</div> : null}
                        {printers.length === 0 && !loading ? <div style={{ color: "#666" }}>Nenhuma impressora configurada.</div> : null}
                        <div style={{ marginTop: 8 }}>
                            {printers.map((p) => (
                                <div key={p.id} style={{ padding: 12, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)", marginBottom: 8, background: "#fff" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div>
                                            <div style={{ fontWeight: 800 }}>{p.name}</div>
                                            <div style={{ color: "#666", fontSize: 13 }}>{p.type} • {p.format} • {p.is_active ? "Ativa" : "Inativa"}</div>
                                            <div style={{ color: "#666", fontSize: 12, marginTop: 6 }}>Intervalo: {p.interval_seconds}s • Auto: {p.auto_print ? "Sim" : "Não"}</div>
                                            {p.config && p.config.printerName ? <div style={{ color: "#444", fontSize: 12, marginTop: 6 }}>Impressora local: {p.config.printerName}</div> : null}
                                        </div>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <button onClick={() => openEditForm(p)} style={simpleBtn({ background: "#0b74de" })}>Editar</button>
                                            <button onClick={() => deletePrinter(p.id)} style={simpleBtn({ background: "#de1f1f" })}>Excluir</button>
                                            <button onClick={() => testPrint(p.id)} style={simpleBtn({ background: "#2e7d32" })}>Testar</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Right: print jobs / form */}
                    <div>
                        <div style={{ marginBottom: 12 }}>
                            <h3>Histórico (print_jobs)</h3>
                            <div style={{ color: "#666", fontSize: 13, marginBottom: 8 }}>Últimos 50 jobs</div>
                            <div style={{ maxHeight: 420, overflow: "auto" }}>
                                {jobs.length === 0 ? <div style={{ color: "#666" }}>Nenhum job.</div> : null}
                                {jobs.map((j) => (
                                    <div key={j.id} style={{ padding: 10, borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)", marginBottom: 8, background: "#fff" }}>
                                        <div style={{ fontWeight: 800 }}>{j.status.toUpperCase()} {j.order_id ? `• ${j.order_id}` : ""}</div>
                                        <div style={{ color: "#666", fontSize: 13, marginTop: 6 }}>{j.error ? String(j.error).slice(0, 180) : (j.payload ? JSON.stringify(j.payload) : "")}</div>
                                        <div style={{ marginTop: 6, color: "#999", fontSize: 12 }}>{j.created_at} {j.processed_at ? ` • processed: ${j.processed_at}` : ""}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginTop: 8 }}>
                            <h3>Ações</h3>
                            <div style={{ display: "flex", gap: 8 }}>
                                <button onClick={() => testPrint()} style={simpleBtn({ background: "#2e7d32" })}>Criar pedido de teste</button>
                                <button onClick={() => loadJobs()} style={simpleBtn({ background: "#666" })}>Atualizar histórico</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal/Form for creating/editing printers */}
            {openForm ? (
                <div style={{ position: "fixed", left: 0, top: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: 740, background: "#fff", padding: 16, borderRadius: 8 }}>
                        <h3>{editing ? "Editar impressora" : "Nova impressora"}</h3>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            <div>
                                <label>Nome</label>
                                <input value={form.name} onChange={(e) => updateFormField("name", e.target.value)} style={{ width: "100%", padding: 8, marginTop: 6 }} />
                            </div>
                            <div>
                                <label>Tipo</label>
                                <select value={form.type} onChange={(e) => updateFormField("type", e.target.value)} style={{ width: "100%", padding: 8, marginTop: 6 }}>
                                    <option value="network">Network</option>
                                    <option value="usb">USB</option>
                                    <option value="bluetooth">Bluetooth</option>
                                    <option value="a4">A4 / PDF</option>
                                </select>
                            </div>
                            <div>
                                <label>Formato</label>
                                <select value={form.format} onChange={(e) => updateFormField("format", e.target.value)} style={{ width: "100%", padding: 8, marginTop: 6 }}>
                                    <option value="receipt">Receipt</option>
                                    <option value="a4">A4 / PDF</option>
                                    <option value="zpl">ZPL</option>
                                </select>
                            </div>
                            <div>
                                <label>Intervalo (s)</label>
                                <input type="number" value={form.interval_seconds} onChange={(e) => updateFormField("interval_seconds", Number(e.target.value || 0))} style={{ width: "100%", padding: 8, marginTop: 6 }} />
                            </div>
                            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <input type="checkbox" checked={!!form.auto_print} onChange={(e) => updateFormField("auto_print", !!e.target.checked)} /> Impressão automática
                                </label>
                                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <input type="checkbox" checked={!!form.is_active} onChange={(e) => updateFormField("is_active", !!e.target.checked)} /> Ativa
                                </label>
                            </div>

                            {/* config editor (JSON) */}
                            <div style={{ gridColumn: "1 / -1", marginTop: 8 }}>
                                <label>Config (JSON)</label>
                                <textarea value={JSON.stringify(form.config || {}, null, 2)} onChange={(e) => {
                                    try {
                                        const v = JSON.parse(e.target.value);
                                        updateFormField("config", v);
                                    } catch {
                                        // ignore parse errors until save
                                        updateFormField("config", form.config);
                                    }
                                }} style={{ width: "100%", minHeight: 120, marginTop: 6 }} />
                                <div style={{ marginTop: 8, color: "#666", fontSize: 12 }}>Ex.: {"{ \"host\":\"192.168.0.20\",\"port\":9100 }"} ou {"{ \"printerName\":\"Microsoft Print to PDF\" }"}</div>
                            </div>
                        </div>

                        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <button onClick={() => { setOpenForm(false); }} style={simpleBtn({ background: "#666" })}>Fechar</button>
                            <button onClick={() => savePrinter()} style={simpleBtn({ background: "#0b74de" })}>Salvar</button>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* Local printers modal */}
            {showLocalModal && (
                <div style={{ position: "fixed", left: 0, top: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: 640, background: "#fff", padding: 16, borderRadius: 8 }}>
                        <h3>Impressoras no computador</h3>
                        {loadingLocalPrinters ? <div>Buscando impressoras locais...</div> : null}
                        {localError ? <div style={{ color: "red" }}>Erro: {localError}</div> : null}
                        <div style={{ maxHeight: 340, overflow: "auto", marginTop: 8 }}>
                            {localPrinters.length === 0 && !loadingLocalPrinters ? <div style={{ color: "#666" }}>Nenhuma impressora encontrada.</div> : null}
                            {localPrinters.map((lp) => (
                                <div key={lp.id} style={{ display: "flex", justifyContent: "space-between", padding: 8, borderBottom: "1px solid #eee" }}>
                                    <div>{lp.name}</div>
                                    <div>
                                        <button onClick={() => addLocalPrinterAsCompanyPrinter(lp.name)} style={simpleBtn({ background: "#0b74de" })}>Usar esta impressora</button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div style={{ marginTop: 12, textAlign: "right" }}>
                            <button onClick={() => setShowLocalModal(false)} style={simpleBtn({ background: "#666" })}>Fechar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
