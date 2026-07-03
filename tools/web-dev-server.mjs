#!/usr/bin/env node
/* web-dev-server.mjs — the console's dev front door: serves web/ statically and
   proxies the API surface (/api, /auth, /healthz, /readyz) to NUMU_URL so the
   session cookie is same-origin. Phase A needs no proxy at all (the console
   runs the in-browser sim); it exists so the SAME page flips to a real backend
   — the sim node server (node web/sim/server.node.js → :8787) or the Rust api —
   by setting window.NUMU_HTTP = true (see web/index.html).

   Run:  node tools/web-dev-server.mjs [port]          (default 8940)
         NUMU_URL=http://127.0.0.1:8787 node tools/web-dev-server.mjs           */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(fileURLToPath(new URL(".", import.meta.url)), "..", "web");
const PORT = Number(process.argv[2] || 8940);
const API = process.env.NUMU_URL || "http://127.0.0.1:8787";
const PROXY = ["/api/", "/auth/", "/healthz", "/readyz"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".csv": "text/csv",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (PROXY.some((p) => url.pathname === p.replace(/\/$/, "") || url.pathname.startsWith(p))) {
    try {
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await bytes(req);
      const upstream = await fetch(API + url.pathname + url.search, {
        method: req.method,
        headers: passHeaders(req.headers),
        body,
        redirect: "manual",
      });
      const headers = {};
      upstream.headers.forEach((v, k) => {
        if (k === "transfer-encoding" || k === "content-encoding" || k === "content-length") return;
        if (k === "set-cookie") return;
        headers[k] = v;
      });
      const cookies = upstream.headers.getSetCookie?.() ?? [];
      if (cookies.length) headers["set-cookie"] = cookies;
      res.writeHead(upstream.status, headers);
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "bad_gateway", message: String(e?.message || e) }));
    }
    return;
  }

  let path = normalize(url.pathname).replace(/^([/\\])+/, "");
  if (path === "" || path === ".") path = "index.html";
  const file = join(WEB, path);
  if (!file.startsWith(WEB)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

function passHeaders(h) {
  const out = {};
  for (const k of ["content-type", "cookie", "if-match", "accept", "x-numu-actor"]) {
    if (h[k]) out[k] = h[k];
  }
  return out;
}
function bytes(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

server.listen(PORT, () =>
  console.log(`numu web dev-server: http://localhost:${PORT}  (api → ${API})`),
);
