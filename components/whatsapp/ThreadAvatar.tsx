"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/whatsapp/phone";

type ThreadAvatarProps = {
    src?: string | null;
    label: string;
    className?: string;
};

/** Foto do contato Meta, com a inicial se a URL falhar ou não existir. */
export function ThreadAvatar({ src, label, className }: ThreadAvatarProps) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const url = src?.trim() || null;
    const showPhoto = Boolean(url) && failedSrc !== url;

    return (
        <div
            className={cn("relative shrink-0 overflow-hidden rounded-full", className)}
            aria-hidden="true"
        >
            {showPhoto ? (
                // URL da Meta expira e o host muda; next/image exigiria remotePatterns instável.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={url ?? undefined}
                    alt=""
                    className="h-full w-full object-cover"
                    onError={() => setFailedSrc(url)}
                />
            ) : (
                <span className="flex h-full w-full items-center justify-center">
                    {getInitials(label)}
                </span>
            )}
        </div>
    );
}
