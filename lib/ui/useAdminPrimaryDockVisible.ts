"use client";

import { useEffect, useState } from "react";

/** Diferença visualViewport × innerHeight acima disso ⇒ teclado virtual aberto. */
const KEYBOARD_OPEN_THRESHOLD_PX = 120;

const NON_TEXT_INPUT_TYPES = new Set([
    "button",
    "submit",
    "reset",
    "checkbox",
    "radio",
    "file",
    "hidden",
    "image",
    "color",
]);

function isTextEntryElement(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (el.isContentEditable) return true;
    if (tag === "INPUT") {
        const type = (el as HTMLInputElement).type.toLowerCase() || "text";
        return !NON_TEXT_INPUT_TYPES.has(type);
    }
    return false;
}

function isKeyboardLikelyOpen(): boolean {
    if (typeof window === "undefined") return false;
    const vv = window.visualViewport;
    if (!vv) return false;
    return window.innerHeight - vv.height > KEYBOARD_OPEN_THRESHOLD_PX;
}

/**
 * Controla visibilidade do dock mobile de atalhos.
 * Oculta enquanto o usuário digita (foco em campo) ou o teclado virtual está aberto.
 */
export function useAdminPrimaryDockVisible(): boolean {
    const [visible, setVisible] = useState(true);

    useEffect(() => {
        let textFieldFocused = false;

        const sync = () => {
            setVisible(!textFieldFocused && !isKeyboardLikelyOpen());
        };

        const onFocusIn = (event: FocusEvent) => {
            if (isTextEntryElement(event.target)) {
                textFieldFocused = true;
                sync();
            }
        };

        const onFocusOut = () => {
            window.setTimeout(() => {
                textFieldFocused = isTextEntryElement(document.activeElement);
                sync();
            }, 80);
        };

        const onViewportChange = () => {
            sync();
        };

        document.addEventListener("focusin", onFocusIn);
        document.addEventListener("focusout", onFocusOut);
        window.visualViewport?.addEventListener("resize", onViewportChange);
        window.visualViewport?.addEventListener("scroll", onViewportChange);

        return () => {
            document.removeEventListener("focusin", onFocusIn);
            document.removeEventListener("focusout", onFocusOut);
            window.visualViewport?.removeEventListener("resize", onViewportChange);
            window.visualViewport?.removeEventListener("scroll", onViewportChange);
        };
    }, []);

    return visible;
}
