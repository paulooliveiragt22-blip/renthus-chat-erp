"use client";

/**
 * Input de senha com botão de visualizar/ocultar (ícone de olho).
 * Recebe `style` como o `<input>` normal — o componente só adiciona
 * `paddingRight` pro espaço do ícone e controla o `type`.
 */

import { useState, type InputHTMLAttributes, type CSSProperties } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
    wrapperStyle?: CSSProperties;
}

export default function PasswordInput({ style, wrapperStyle, ...inputProps }: PasswordInputProps) {
    const [visible, setVisible] = useState(false);

    return (
        <div style={{ position: "relative", width: "100%", ...wrapperStyle }}>
            <input
                {...inputProps}
                type={visible ? "text" : "password"}
                style={{ ...style, paddingRight: 40 }}
            />
            <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                tabIndex={-1}
                aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
                title={visible ? "Ocultar senha" : "Mostrar senha"}
                style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    color: "#9ca3af",
                }}
            >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
        </div>
    );
}
