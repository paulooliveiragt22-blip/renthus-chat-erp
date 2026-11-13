"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

type LandingRevealProps = {
    children: ReactNode;
    className?: string;
};

export function LandingReveal({ children, className }: LandingRevealProps) {
    return (
        <motion.div
            className={className}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45, ease: "easeOut" }}
        >
            {children}
        </motion.div>
    );
}
