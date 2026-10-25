"use client";

// Leaflet map canvas (loaded browser-only via WalkMap wrapper).
// Shows a walk polyline + live walker avatar marker + start pin.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useT } from "@/lib/firu/i18n";

export interface WalkMapCanvasProps {
  track: [number, number][];
  live?: boolean;
  walkerAvatar?: string | null;
  dogAvatar?: string | null;
  className?: string;
  fitPadding?: number;
  /** center zoom when track is empty (defaults to Santa Cruz) */
  center?: [number, number];
  zoom?: number;
}

const GREEN = "#16a34a";
const AMBER = "#f59e0b";

function avatarIcon(url: string | null | undefined, ring: string): L.DivIcon {
  const src = url && url.length > 0 ? url : "/images/brand/logo-mark-mint.png";
  return L.divIcon({
    className: "firu-marker",
    html: `<div style="width:40px;height:40px;border-radius:9999px;overflow:hidden;border:3px solid ${ring};box-shadow:0 4px 10px rgba(0,0,0,.35);background:#fff">
      <img src="${src}" style="width:100%;height:100%;object-fit:cover" alt=""/>
    </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

function pawIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: "firu-marker",
    html: `<div style="width:30px;height:30px;border-radius:9999px;background:${color};display:grid;place-items:center;box-shadow:0 3px 8px rgba(0,0,0,.3)">
      <svg width="16" height="16" viewBox="0 0 64 64"><ellipse cx="32" cy="42" rx="14" ry="11" fill="#fff"/><ellipse cx="14" cy="28" rx="6" ry="7.5" fill="#fff"/><ellipse cx="50" cy="28" rx="6" ry="7.5" fill="#fff"/><ellipse cx="23" cy="15" rx="5.5" ry="7" fill="#fff"/><ellipse cx="41" cy="15" rx="5.5" ry="7" fill="#fff"/></svg>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export default function WalkMapCanvas({
  track,
  live = false,
  walkerAvatar,
  dogAvatar,
  className,
  fitPadding = 40,
  center = [-17.7931, -63.1998],
  zoom = 16,
}: WalkMapCanvasProps) {
  const { t } = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const lineRef = useRef<L.Polyline | null>(null);
  const walkerRef = useRef<L.Marker | null>(null);
  const startRef = useRef<L.Marker | null>(null);
  const dogRef = useRef<L.Marker | null>(null);
  const didFitRef = useRef(false);

  // init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: true,
      scrollWheelZoom: live,
      dragging: true,
      attributionControl: true,
    }).setView(center, zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    // fix render inside flex layouts
    setTimeout(() => map.invalidateSize(), 60);
    return () => {
      map.remove();
      mapRef.current = null;
      lineRef.current = null;
      walkerRef.current = null;
      startRef.current = null;
      dogRef.current = null;
      didFitRef.current = false;
    };
  }, []);

  // update polyline & markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (track.length > 0) {
      if (!lineRef.current) {
        lineRef.current = L.polyline(track, {
          color: GREEN,
          weight: 5,
          opacity: 0.95,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(map);
      } else {
        lineRef.current.setLatLngs(track as L.LatLngExpression[]);
      }
      // start pin
      const [sLat, sLng] = track[0];
      if (!startRef.current) {
        startRef.current = L.marker([sLat, sLng], {
          icon: pawIcon(GREEN),
          zIndexOffset: 200,
        })
          .addTo(map)
          .bindTooltip(t("sh.map.start"), { direction: "top" });
      }
      // live walker + dog markers at latest point
      const [lat, lng] = track[track.length - 1];
      if (live) {
        if (!walkerRef.current) {
          walkerRef.current = L.marker([lat, lng], {
            icon: avatarIcon(walkerAvatar, GREEN),
            zIndexOffset: 1000,
          }).addTo(map);
        } else {
          walkerRef.current.setLatLng([lat, lng]);
        }
        if (dogAvatar) {
          if (!dogRef.current) {
            dogRef.current = L.marker([lat + 0.00012, lng + 0.00012], {
              icon: avatarIcon(dogAvatar, AMBER),
              zIndexOffset: 900,
            }).addTo(map);
          } else {
            dogRef.current.setLatLng([lat + 0.00012, lng + 0.00012]);
          }
        }
      }
      // camera
      if (!didFitRef.current && track.length > 1) {
        map.fitBounds(L.latLngBounds(track as L.LatLngExpression[]), {
          padding: [fitPadding, fitPadding],
        });
        didFitRef.current = true;
      } else if (live) {
        map.panTo([lat, lng], { animate: true, duration: 0.8 });
      }
    }
  }, [track, live, walkerAvatar, dogAvatar, fitPadding, t]);

  // keep the start-pin tooltip in the active language
  useEffect(() => {
    startRef.current?.setTooltipContent(t("sh.map.start"));
  }, [t]);

  return (
    <div
      ref={containerRef}
      className={className ?? "h-64 w-full rounded-2xl overflow-hidden border"}
      role="img"
      aria-label={t("sh.map.aria")}
    />
  );
}
