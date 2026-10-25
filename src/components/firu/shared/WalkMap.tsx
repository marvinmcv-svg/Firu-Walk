"use client";

// Browser-only wrapper for Leaflet (SSR-safe).

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { WalkMapCanvasProps } from "./WalkMapCanvas";

export const WalkMap = dynamic<WalkMapCanvasProps>(
  () => import("./WalkMapCanvas").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 w-full rounded-2xl overflow-hidden border bg-muted">
        <div className="size-full grid place-items-center">
          <Skeleton className="h-8 w-40 rounded-full" />
        </div>
      </div>
    ),
  }
);
