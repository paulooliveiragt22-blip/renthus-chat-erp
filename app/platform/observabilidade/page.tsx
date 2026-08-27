"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { platformApi } from "@/lib/platform/clientApi";
import PlatformObservabilityConsole from "@/components/platform/observability/PlatformObservabilityConsole";
import { companiesOptionsQueryString } from "@/lib/platform/companiesFilters";

export default function PlatformObservabilidadePage() {
    const { data: companiesData } = useQuery({
        queryKey: ["platform", "companies", "options"],
        queryFn: () => platformApi.companies(companiesOptionsQueryString()),
        staleTime: 60_000,
    });

    const companies = (
        (companiesData?.companies ?? []) as Array<{ id: string; name: string }>
    ).map((c) => ({ id: c.id, name: c.name ?? c.id }));

    return (
        <div className="space-y-5">
            <div>
                <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
                    Observabilidade
                </h1>
                <p className="text-xs text-zinc-500">
                    Fila inbound, outbound proativo, pipeline PRO e alertas — cruzado com o motor{" "}
                    <code className="rounded bg-zinc-100 px-1 text-[10px] dark:bg-zinc-800">
                        runProPipeline
                    </code>
                </p>
            </div>

            <PlatformObservabilityConsole companies={companies} />
        </div>
    );
}
