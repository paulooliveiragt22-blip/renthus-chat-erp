"use client";
import React from "react";
import { FiMenu, FiPlus } from "react-icons/fi";
import Button from "@/components/ui/Button";

export default function Header({ onOpenMobile }: { onOpenMobile?: () => void }) {
  return (
    <header className="w-full border-b border-gray-200 bg-white sticky top-0 z-20">
      <div className="container-max flex items-center gap-4 py-4">
        <button className="md:hidden mr-2" onClick={onOpenMobile}>
          <FiMenu size={20} />
        </button>

        <div className="hidden md:block text-lg font-bold">Disk Bebidas</div>

        <div className="flex-1" />

        <div className="w-full max-w-md">
          <input className="w-full p-2 rounded-md border border-gray-200" placeholder="Prodify Finder" />
        </div>

        <div className="ml-3">
          <Button variant="outline" icon={<FiPlus />}>Add new product</Button>
        </div>
      </div>
    </header>
  );
}
