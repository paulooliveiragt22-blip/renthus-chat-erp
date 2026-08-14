"use client";

export function Skeleton({ className = "" }: { className?: string }) {
    return <div className={`animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-700 ${className}`} />;
}
