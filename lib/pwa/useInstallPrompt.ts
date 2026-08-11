"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Evento não padronizado do Chromium (Android/desktop). Safari/iOS nunca dispara isso —
 * lá o único caminho é a instrução manual (Compartilhar → Adicionar à Tela de Início).
 */
type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function detectIOS(): boolean {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/u.test(ua)) return true;
    // iPadOS 13+ se identifica como "Macintosh" — diferencia pelo touch.
    return /Macintosh/u.test(ua) && navigator.maxTouchPoints > 1;
}

function detectStandalone(): boolean {
    if (typeof window === "undefined") return false;
    const displayModeStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
    const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    return displayModeStandalone || iosStandalone;
}

/**
 * Estado de instalação como PWA (admin/PDV). Não usar no cardápio público (`/c/*`) —
 * ali não queremos oferecer instalação como app.
 */
export function useInstallPrompt() {
    const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
    const [isStandalone, setIsStandalone] = useState(false);
    const [isIOS, setIsIOS] = useState(false);

    useEffect(() => {
        setIsStandalone(detectStandalone());
        setIsIOS(detectIOS());

        function onBeforeInstallPrompt(e: Event) {
            e.preventDefault();
            setDeferredEvent(e as BeforeInstallPromptEvent);
        }
        function onAppInstalled() {
            setDeferredEvent(null);
            setIsStandalone(true);
        }
        window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
        window.addEventListener("appinstalled", onAppInstalled);
        return () => {
            window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
            window.removeEventListener("appinstalled", onAppInstalled);
        };
    }, []);

    const promptInstall = useCallback(async (): Promise<boolean> => {
        if (!deferredEvent) return false;
        await deferredEvent.prompt();
        const choice = await deferredEvent.userChoice;
        setDeferredEvent(null);
        return choice.outcome === "accepted";
    }, [deferredEvent]);

    const canInstallDirectly = deferredEvent !== null;
    const canShowIosInstructions = isIOS && !isStandalone && !canInstallDirectly;

    return {
        isStandalone,
        isIOS,
        canInstallDirectly,
        canShowIosInstructions,
        promptInstall,
    };
}
