"use client";

import { useEffect, useState } from "react";

type StartPolicyLineProps = {
    className?: string;
};

export function StartPolicyLine({ className }: StartPolicyLineProps) {
    const [text, setText] = useState("Paga e usa · cancela quando quiser");

    useEffect(() => {
        let cancelled = false;
        fetch("/api/billing/trial-policy", { cache: "no-store" })
            .then((response) => response.json())
            .then((data: { trial_days?: number; payment_required?: boolean }) => {
                if (cancelled) return;
                if (
                    data.payment_required === false &&
                    typeof data.trial_days === "number" &&
                    data.trial_days > 0
                ) {
                    setText(
                        `${data.trial_days} dias de teste · depois a mensalidade · cancela quando quiser`
                    );
                    return;
                }
                setText("Paga e usa · cancela quando quiser");
            })
            .catch(() => {
                /* mantém paga e usa */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return <p className={className}>{text}</p>;
}
