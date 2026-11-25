"use client";

import { useState, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import type { LandingLoop } from "@/lib/marketing/loops";
import { cn } from "@/lib/utils";

type MarketingLoopProps = {
    loop: LandingLoop;
    fallback: ReactNode;
    className?: string;
};

type Phase = "loading" | "ready" | "still";

function revealIfReady(node: HTMLVideoElement) {
    return node.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}

export function MarketingLoop({ loop, fallback, className }: MarketingLoopProps) {
    const reduced = useReducedMotion();
    const [phase, setPhase] = useState<Phase>("loading");
    const showVideo = reduced !== true && phase !== "still";

    function bindVideo(node: HTMLVideoElement | null) {
        if (!node || node.error) return;
        if (revealIfReady(node)) setPhase("ready");
    }

    return (
        <div className={cn("relative h-full w-full", className)}>
            {phase === "ready" ? null : fallback}
            {showVideo ? (
                <video
                    ref={bindVideo}
                    className={cn(
                        "h-full w-full object-contain object-center",
                        phase === "ready" ? "relative" : "pointer-events-none absolute inset-0 opacity-0"
                    )}
                    autoPlay
                    muted
                    loop
                    playsInline
                    preload={loop.preload}
                    poster={loop.poster}
                    aria-hidden
                    onLoadedData={(event) => {
                        if (revealIfReady(event.currentTarget)) setPhase("ready");
                    }}
                    onError={() => setPhase("still")}
                >
                    <source src={loop.src} type="video/mp4" />
                </video>
            ) : null}
        </div>
    );
}
