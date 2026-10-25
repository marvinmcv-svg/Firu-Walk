"use client";

// Socket.io singleton — connects through the Caddy gateway.
// NEVER hardcode ports: only the XTransformPort query param (per gateway rules).

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io("/?XTransformPort=3003", {
      path: "/",
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      timeout: 8000,
    });
  }
  return socket;
}

export interface LivePoint {
  seq: number;
  lat: number;
  lng: number;
  ts: number;
  distMeters: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  fromId: string;
  fromName: string;
  role: "OWNER" | "WALKER" | "ADMIN";
  body: string;
  ts: number;
}

/** Join a live-walk room; server simulates GPS while the walk is IN_PROGRESS. */
export function joinLiveWalk(opts: {
  walkId: string;
  status: string;
  startLat?: number;
  startLng?: number;
}) {
  getSocket().emit("walk:join", opts);
}

export function leaveLiveWalk(walkId: string) {
  getSocket().emit("walk:leave", { walkId });
}

export function stopLiveWalkSim(walkId: string) {
  getSocket().emit("walk:stop", { walkId });
}

export function joinChat(opts: {
  threadId: string;
  userId: string;
  userName: string;
  role: string;
}) {
  getSocket().emit("chat:join", opts);
}

export function leaveChat(threadId: string) {
  getSocket().emit("chat:leave", { threadId });
}

export function sendChat(opts: {
  threadId: string;
  fromId: string;
  fromName: string;
  role: string;
  body: string;
}) {
  getSocket().emit("chat:message", opts);
}
