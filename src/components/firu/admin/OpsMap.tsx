"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import type { OpsMapCanvasProps } from "./OpsMapCanvas";

export const OpsMap = dynamic<OpsMapCanvasProps>(() => import("./OpsMapCanvas").then((m) => m.default), {
  ssr: false,
  loading: () => <Skeleton className="h-80 w-full rounded-2xl" />,
});
