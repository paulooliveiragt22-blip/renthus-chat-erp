// app/(admin)/impressoras/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

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
        // normalize config
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
                const { data, error } = await supabase
                    .from("printers")
                    .insert([
                        {
                            company_id: currentCompanyId,
                            name: form.name,
                            type: form.type,
                            format: form.format,
                            auto_print: !!form.auto_print,
                            interval_seconds: Number(form.interval_seconds || 0),
                            is_active: !!form.is_active,
                            config: form.config || {},
                        },
                    ])
                    .select("*")
                    .single();
                if (error) {
                    setMsg("Erro ao criar: " + error.message);
                } else {
                    setMsg("Criado com sucesso.");
                    setOpenForm(false);
                    loadPrinters();
                }
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
            // create order
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
            // insert a simple item
            await supabase.from("order_items").insert([
                {
                    order_id: orderId,
                    product_name: "Teste Cupom",
                    quantity: 1,
                    unit_price: 0,
                    line_total: 0,
                },
            ]);

            setMsg("Pedido de teste criado (id: " + orderId + "). O agent deve imprimir automaticamente.");
            // reload jobs after small delay
            setTimeout(() => loadJobs(), 1500);
        } catch (e: any) {
            setMsg("Erro ao gerar teste: " + e.message);
        } finally {
            setLoading(false);
        }
    }

    // small helper render
    return (
        <div style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: 22 }}>Impressoras</h1>
                    <div style={{ marginTop: 6, color: "#666" }}>
                        Gerencie as impressoras da sua empresa. Adicione impressoras (network, USB, Bluetooth ou A4), escolha o formato e se a impressão é automática.
                    </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => reload().then(loadPrinters)} style={simpleBtn({ background: "#666" })}>Atualizar</button>
                    <button onClick={openNewForm} style={simpleBtn()}>Nova impressora</button>
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

            {/* Modal/Form */}
            {openForm ? (
                <div style={{
                    position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.4)", zIndex: 9999
                }}>
                    <div style={{ width: 840, maxWidth: "96%", background: "#fff", borderRadius: 10, padding: 18 }}>
                        <h2 style={{ marginTop: 0 }}>{editing ? "Editar impressora" : "Nova impressora"}</h2>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 12 }}>
                            <div>
                                <label style={{ display: "block", marginBottom: 6 }}>Nome</label>
                                <input value={form.name} onChange={(e) => updateFormField("name", e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ddd" }} />

                                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: "block", marginBottom: 6 }}>Tipo</label>
                                        <select value={form.type} onChange={(e) => updateFormField("type", e.target.value)} style={{ width: "100%", padding: 8 }}>
                                            <option value="network">Network (IP)</option>
                                            <option value="usb">USB</option>
                                            <option value="bluetooth">Bluetooth</option>
                                            <option value="system">Sistema (A4)</option>
                                        </select>
                                    </div>

                                    <div style={{ width: 160 }}>
                                        <label style={{ display: "block", marginBottom: 6 }}>Formato</label>
                                        <select value={form.format} onChange={(e) => updateFormField("format", e.target.value)} style={{ width: "100%", padding: 8 }}>
                                            <option value="receipt">Receipt / Cupom</option>
                                            <option value="a4">A4 (PDF)</option>
                                        </select>
                                    </div>
                                </div>

                                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                                    <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <input type="checkbox" checked={!!form.auto_print} onChange={(e) => updateFormField("auto_print", e.target.checked)} />
                                        Imprimir automaticamente
                                    </label>

                                    <div>
                                        <label style={{ display: "block", marginBottom: 6 }}>Intervalo (segundos)</label>
                                        <select value={Number(form.interval_seconds || 0)} onChange={(e) => updateFormField("interval_seconds", Number(e.target.value))} style={{ padding: 8 }}>
                                            <option value={0}>0 (imediato)</option>
                                            <option value={10}>10</option>
                                            <option value={15}>15</option>
                                            <option value={30}>30</option>
                                            <option value={60}>60</option>
                                        </select>
                                    </div>
                                </div>

                                <div style={{ marginTop: 12 }}>
                                    <label style={{ display: "block", marginBottom: 6 }}>Config (JSON) — campos conforme tipo</label>
                                    <textarea value={JSON.stringify(form.config || {}, null, 2)} onChange={(e) => {
                                        try {
                                            const json = JSON.parse(e.target.value);
                                            updateFormField("config", json);
                                            setMsg(null);
                                        } catch (err: any) {
                                            // keep raw string in config until saved; we keep form.config as raw
                                            updateFormField("config", {});
                                            setMsg("JSON inválido no campo Config. Corrija antes de salvar.");
                                        }
                                    }} rows={8} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #ddd", fontFamily: "monospace" }} />
                                    <div style={{ color: "#666", marginTop: 6, fontSize: 13 }}>
                                        Exemplos para <strong>network</strong>: {"{ \"host\": \"192.168.0.100\", \"port\": 9100 }"}<br />
                                        Para <strong>usb</strong>: {"{ \"usbVendorId\": 1155, \"usbProductId\": 22336 }"}<br />
                                        Para <strong>bluetooth</strong>: {"{ \"btAddress\": \"00:11:22:33:44:55\" }"}<br />
                                        Para <strong>system</strong> (A4): {"{ \"printerName\": \"HP_Laser_Office\" }"}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label style={{ display: "block", marginBottom: 6 }}>Ativar</label>
                                <div style={{ marginBottom: 12 }}>
                                    <label><input type="checkbox" checked={!!form.is_active} onChange={(e) => updateFormField("is_active", e.target.checked)} /> Ativa</label>
                                </div>

                                <div style={{ marginTop: 20 }}>
                                    <div style={{ marginBottom: 8, color: "#666" }}>Ações</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        <button onClick={savePrinter} style={simpleBtn()}>Salvar</button>
                                        <button onClick={() => { setOpenForm(false); setEditing(null); }} style={simpleBtn({ background: "#999" })}>Cancelar</button>
                                    </div>
                                </div>

                                <div style={{ marginTop: 24 }}>
                                    <div style={{ marginBottom: 8, color: "#666" }}>Ajuda</div>
                                    <div style={{ color: "#333", fontSize: 13 }}>
                                        - Informe as configurações corretas no campo <em>Config (JSON)</em> conforme o tipo.<br />
                                        - Salve e use o botão <strong>Criar pedido de teste</strong> na página principal para disparar uma impressão de teste.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
