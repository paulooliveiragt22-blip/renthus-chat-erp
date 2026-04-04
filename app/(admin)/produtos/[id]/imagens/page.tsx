// app/(admin)/produtos/[id]/imagens/page.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace/useWorkspace";
import { ArrowLeft, ImageIcon, Loader2, Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

type ProductImage = {
    id:            string;
    url:           string;
    thumbnail_url: string;
    is_primary:    boolean;
    file_size:     number;
    created_at:    string;
};

function formatFileSize(bytes: number): string {
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProdutoImagensPage() {
    const { id: productId }             = useParams<{ id: string }>();
    const router                        = useRouter();
    const { currentCompanyId: companyId } = useWorkspace();
    const supabase                      = createClient();

    const [images,     setImages]     = useState<ProductImage[]>([]);
    const [loading,    setLoading]    = useState(true);
    const [uploading,  setUploading]  = useState(false);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const fileInputRef                = useRef<HTMLInputElement>(null);
    const dragCounterRef              = useRef(0);
    const [dragging,   setDragging]   = useState(false);

    // ── Fetch images ──────────────────────────────────────────────────────────

    const fetchImages = useCallback(async () => {
        if (!productId) return;
        setLoading(true);
        const { data, error } = await supabase
            .from("product_images")
            .select("id, url, thumbnail_url, is_primary, file_size, created_at")
            .eq("product_id", productId)
            .order("is_primary", { ascending: false })
            .order("created_at", { ascending: true });

        if (error) {
            toast.error("Erro ao carregar imagens");
        } else {
            setImages((data ?? []) as ProductImage[]);
        }
        setLoading(false);
    }, [productId, supabase]);

    useEffect(() => { fetchImages(); }, [fetchImages]);

    // ── Upload ────────────────────────────────────────────────────────────────

    async function uploadFile(file: File, isPrimary = false) {
        if (!productId) return;

        const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
        if (file.size > MAX_SIZE) {
            toast.error("Arquivo muito grande (máx. 10 MB)");
            return;
        }
        if (!file.type.startsWith("image/")) {
            toast.error("Apenas imagens são aceitas");
            return;
        }

        setUploading(true);
        const formData = new FormData();
        formData.append("product_id", productId);
        formData.append("file",       file);
        formData.append("is_primary", String(isPrimary));

        try {
            const res  = await fetch("/api/products/upload-image", { method: "POST", body: formData });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json?.error ?? "Erro no upload");
            } else {
                toast.success("Imagem enviada com sucesso!");
                await fetchImages();
            }
        } catch {
            toast.error("Erro de conexão");
        } finally {
            setUploading(false);
        }
    }

    function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
        const files = Array.from(e.target.files ?? []);
        const isFirst = images.length === 0;
        files.forEach((f, i) => uploadFile(f, isFirst && i === 0));
        e.target.value = "";
    }

    // ── Drag & drop ───────────────────────────────────────────────────────────

    function onDragEnter(e: React.DragEvent) {
        e.preventDefault();
        dragCounterRef.current++;
        setDragging(true);
    }
    function onDragLeave(e: React.DragEvent) {
        e.preventDefault();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setDragging(false);
    }
    function onDrop(e: React.DragEvent) {
        e.preventDefault();
        dragCounterRef.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
        const isFirst = images.length === 0;
        files.forEach((f, i) => uploadFile(f, isFirst && i === 0));
    }

    // ── Set primary ───────────────────────────────────────────────────────────

    async function setPrimary(imageId: string) {
        if (!productId) return;
        // Clear all primaries then set selected
        await supabase.from("product_images").update({ is_primary: false }).eq("product_id", productId);
        const { error } = await supabase.from("product_images").update({ is_primary: true }).eq("id", imageId);
        if (error) {
            toast.error("Erro ao definir imagem principal");
        } else {
            toast.success("Imagem principal atualizada");
            setImages((prev) => prev.map((img) => ({ ...img, is_primary: img.id === imageId })));
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    async function deleteImage(imageId: string) {
        setDeletingId(imageId);
        const { error } = await supabase.from("product_images").delete().eq("id", imageId);
        if (error) {
            toast.error("Erro ao remover imagem");
        } else {
            toast.success("Imagem removida");
            setImages((prev) => prev.filter((img) => img.id !== imageId));
        }
        setDeletingId(null);
    }

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <main className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <button
                    onClick={() => router.back()}
                    className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                    <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                        <ImageIcon className="w-5 h-5 text-violet-600" />
                        Imagens do produto
                    </h1>
                    <p className="text-xs text-zinc-400">Gerencie as fotos exibidas no catálogo WhatsApp</p>
                </div>
            </div>

            {/* Drop zone */}
            <div
                role="button"
                tabIndex={uploading ? -1 : 0}
                aria-disabled={uploading}
                aria-label="Arraste imagens ou pressione Enter ou Espaço para escolher arquivos"
                onDragEnter={onDragEnter}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => !uploading && fileInputRef.current?.click()}
                onKeyDown={(e) => {
                    if (uploading) return;
                    if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                    }
                }}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                    dragging
                        ? "border-violet-400 bg-violet-50 dark:bg-violet-900/20"
                        : "border-zinc-200 dark:border-zinc-700 hover:border-violet-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                }`}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleFileInput}
                />
                {uploading ? (
                    <div className="flex flex-col items-center gap-2 text-violet-600">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <p className="text-sm font-medium">Enviando imagem...</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                        <Upload className="w-8 h-8" />
                        <p className="text-sm font-medium">
                            {dragging ? "Solte para enviar" : "Arraste imagens ou clique para selecionar"}
                        </p>
                        <p className="text-xs">PNG, JPG, WEBP — máx. 10 MB por arquivo</p>
                    </div>
                )}
            </div>

            {/* Image grid */}
            {loading ? (
                <div className="text-center py-8 text-zinc-400">Carregando imagens...</div>
            ) : images.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                    <ImageIcon className="w-10 h-10 text-zinc-300 mx-auto" />
                    <p className="text-zinc-500 text-sm">Nenhuma imagem cadastrada ainda</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {images.map((img) => (
                        <div
                            key={img.id}
                            className={`relative group rounded-xl overflow-hidden border-2 transition-colors ${
                                img.is_primary
                                    ? "border-violet-500"
                                    : "border-zinc-200 dark:border-zinc-700"
                            }`}
                        >
                            {/* Image */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={img.thumbnail_url || img.url}
                                alt="Produto"
                                className="w-full aspect-square object-cover"
                                loading="lazy"
                            />

                            {/* Primary badge */}
                            {img.is_primary && (
                                <div className="absolute top-1.5 left-1.5 bg-violet-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                    <Star className="w-2.5 h-2.5 fill-current" />
                                    Principal
                                </div>
                            )}

                            {/* Overlay actions */}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                {!img.is_primary && (
                                    <button
                                        onClick={() => setPrimary(img.id)}
                                        title="Definir como principal"
                                        className="p-1.5 bg-violet-600 rounded-lg text-white hover:bg-violet-700 transition-colors"
                                    >
                                        <Star className="w-3.5 h-3.5" />
                                    </button>
                                )}
                                <button
                                    onClick={() => deleteImage(img.id)}
                                    disabled={deletingId === img.id}
                                    title="Remover imagem"
                                    className="p-1.5 bg-red-600 rounded-lg text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                                >
                                    {deletingId === img.id
                                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                        : <Trash2 className="w-3.5 h-3.5" />
                                    }
                                </button>
                            </div>

                            {/* File size */}
                            <div className="px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border-t border-zinc-100 dark:border-zinc-700">
                                <p className="text-[10px] text-zinc-400">{formatFileSize(img.file_size)}</p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </main>
    );
}
