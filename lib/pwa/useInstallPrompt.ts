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

/**
 * Captura cedo: o Chrome dispara `beforeinstallprompt` uma vez. Se o hook montar depois,
 * o evento já passou e o botão some.
 */
let capturedPrompt: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (e: Event) => {
        e.preventDefault();
        capturedPrompt = e as BeforeInstallPromptEvent;
        window.dispatchEvent(new Event("renthusagent:beforeinstallprompt"));
    });
    window.addEventListener("appinstalled", () => {
        capturedPrompt = null;
    });
}

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
    const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(capturedPrompt);
    const [isStandalone, setIsStandalone] = useState(false);
    const [isIOS, setIsIOS] = useState(false);

    useEffect(() => {
        setIsStandalone(detectStandalone());
        setIsIOS(detectIOS());
        if (capturedPrompt) setDeferredEvent(capturedPrompt);

        function onCaptured() {
            setDeferredEvent(capturedPrompt);
        }
        function onAppInstalled() {
            capturedPrompt = null;
            setDeferredEvent(null);
            setIsStandalone(true);
        }
        window.addEventListener("renthusagent:beforeinstallprompt", onCaptured);
        window.addEventListener("appinstalled", onAppInstalled);
        return () => {
            window.removeEventListener("renthusagent:beforeinstallprompt", onCaptured);
            window.removeEventListener("appinstalled", onAppInstalled);
        };
    }, []);

    const promptInstall = useCallback(async (): Promise<boolean> => {
        const event = deferredEvent ?? capturedPrompt;
        if (!event) return false;
        await event.prompt();
        const choice = await event.userChoice;
        capturedPrompt = null;
        setDeferredEvent(null);
        return choice.outcome === "accepted";
    }, [deferredEvent]);

    const canInstallDirectly = deferredEvent !== null || capturedPrompt !== null;
    const canShowIosInstructions = isIOS && !isStandalone && !canInstallDirectly;
    /** Mostra o botão mesmo se o Chrome não disparar o evento nativo (recusa/cooldown). */
    const canOfferInstall = !isStandalone;

    return {
        isStandalone,
        isIOS,
        canInstallDirectly,
        canShowIosInstructions,
        canOfferInstall,
        promptInstall,
    };
}
