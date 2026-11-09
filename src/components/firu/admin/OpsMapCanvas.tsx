"use client";

// Leaflet map of every walk in progress (Admin → Operaciones). Loaded
// browser-only through OpsMap. Walks with an open SOS are drawn in red.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { OpsLiveWalkDTO } from "@/lib/firu/types";

export interface OpsMapCanvasProps {
  walks: OpsLiveWalkDTO[];
  selectedId?: string | null;
  onSelect?: (walkId: string) => void;
  className?: string;
}

const GREEN = "#16a34a";
const RED = "#dc2626";
const SANTA_CRUZ: [number, number] = [-17.7833, -63.1821];

function dot(color: string, label: string, selected: boolean): L.DivIcon {
  const size = selected ? 34 : 28;
  const safe = label.replace(/[<>&"']/g, "");
  return L.divIcon({
    className: "firu-marker",
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};color:#fff;display:grid;place-items:center;font:800 12px/1 system-ui;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,.35)">${safe}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function OpsMapCanvas({ walks, selectedId, onSelect, className }: OpsMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, scrollWheelZoom: true }).setView(SANTA_CRUZ, 13);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 60);
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const points: L.LatLngExpression[] = [];
    for (const w of walks) {
      const color = w.openSos ? RED : GREEN;
      if (w.track.length > 1) {
        L.polyline(w.track, { color, weight: w.walkId === selectedId ? 5 : 3, opacity: 0.8 }).addTo(layer);
      }
      if (!w.last) continue;
      points.push(w.last);
      L.marker(w.last, {
        icon: dot(color, w.openSos ? "SOS" : w.dogName.slice(0, 2).toUpperCase(), w.walkId === selectedId),
        zIndexOffset: w.openSos ? 2000 : 1000,
      })
        .bindTooltip(`${w.dogName} · ${w.walkerName}`, { direction: "top" })
        .on("click", () => onSelect?.(w.walkId))
        .addTo(layer);
    }
    const selected = walks.find((w) => w.walkId === selectedId)?.last;
    if (selected) {
      map.panTo(selected, { animate: true });
    } else if (!fittedRef.current && points.length > 0) {
      if (points.length === 1) map.setView(points[0], 16);
      else map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
      fittedRef.current = true;
    }
  }, [walks, selectedId, onSelect]);

  return <div ref={containerRef} className={className ?? "h-80 w-full rounded-2xl overflow-hidden border"} />;
}
