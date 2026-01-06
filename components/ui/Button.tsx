"use client";
import React from "react";
import clsx from "clsx";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  icon?: React.ReactNode;
};

export default function Button({ variant = "primary", size = "md", icon, children, className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(
        variant === "primary" && "btn-primary",
        variant === "outline" && "btn-outline",
        variant === "ghost" && "btn-ghost",
        size === "sm" && "text-sm",
        size === "lg" && "text-base px-5 py-3",
        "inline-flex items-center",
        className
      )}
    >
      {icon && <span className="mr-2 text-lg">{icon}</span>}
      {children}
    </button>
  );
}
