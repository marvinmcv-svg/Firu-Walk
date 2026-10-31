// Local dev/e2e gateway — stands in for the old Caddy setup.
// Routes any request whose query has `XTransformPort=<port>` (the socket.io
// client in src/lib/firu/socket.ts) to that localhost port, everything else to
// the Next.js app. Handles WebSocket upgrades.
//
//   node scripts/dev-gateway.mjs            # :81 → app :3000, live :3003
//   GATEWAY_PORT=8081 APP_PORT=3100 node scripts/dev-gateway.mjs

import http from "node:http";
import net from "node:net";

const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 81);
const APP_PORT = Number(process.env.APP_PORT ?? 3000);
const ALLOWED_PORTS = new Set([APP_PORT, 3003]);

function targetPort(url = "/") {
  const port = Number(new URL(url, "http://x").searchParams.get("XTransformPort"));
  return ALLOWED_PORTS.has(port) ? port : APP_PORT;
}

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: "127.0.0.1", port: targetPort(req.url), path: req.url, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    }
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end("bad gateway");
  });
  req.pipe(upstream);
});

// WebSocket: replay the raw upgrade request to the target and pipe both ways.
server.on("upgrade", (req, socket, head) => {
  const up = net.connect(targetPort(req.url), "127.0.0.1", () => {
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\r\n");
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket).pipe(up);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(GATEWAY_PORT, () => {
  console.log(`gateway :${GATEWAY_PORT} → app :${APP_PORT}, live :3003`);
});
