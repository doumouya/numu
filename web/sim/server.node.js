/* numu-sim · server.node.js — the SAME engine over HTTP (zero dependencies).
   Run:  node sim/server.node.js  [--port 8787]
   Serves: the JSON API (identical routes to the browser driver), the nacl
   endpoint, and the project directory as static files — so opening
   http://localhost:8787/ui_kits/console/index.html runs the console against
   this server (set window.NUMU_HTTP = true, see README).
   State persists to sim/data/state.json; blobs to sim/data/files/.           */
"use strict";
var http = require("http"), fs = require("fs"), path = require("path"), url = require("url");
var EngMod = require("./numu-engine.js");
var Nacl = require("./numu-nacl.js");

var ROOT = path.resolve(__dirname, "..");
var DATA = path.join(__dirname, "data");
var FILES = path.join(DATA, "files");
fs.mkdirSync(FILES, { recursive: true });

var blobStore = {
  save: function (k, v) { fs.writeFileSync(path.join(FILES, k.replace(/[\/\\]/g, "_")), v, "utf8"); },
  load: function (k) { var p = path.join(FILES, k.replace(/[\/\\]/g, "_")); return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; },
  has: function (k) { return fs.existsSync(path.join(FILES, k.replace(/[\/\\]/g, "_"))); }
};
var persist = {
  load: function () { var p = path.join(DATA, "state.json"); try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } },
  save: function (st) { fs.writeFileSync(path.join(DATA, "state.json"), JSON.stringify(st)); }
};
var engine = new EngMod.Engine({ persist: persist, blobStore: blobStore });

/* seed the demo blob on first boot so read:file.name=dossier works server-side */
(function seedBlob() {
  var src = path.join(ROOT, "uploads", "dossier.csv");
  if (fs.existsSync(src) && !engine.reachable("USR_jm", "file").length) {
    var txt = fs.readFileSync(src, "utf8");
    var r = engine.uploadCsv("USR_jm", "PRJ_a1", "dossier.csv", txt, "csv");
    console.log("[seed] dossier.csv →", r.status === 201 ? r.body.rid + " · cleanness " + r.body.cleanness + "%" : r.status);
  }
})();

var MIME = { ".html": "text/html", ".js": "text/javascript", ".jsx": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".csv": "text/csv", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff": "font/woff", ".woff2": "font/woff2", ".md": "text/markdown" };

var port = 8787;
process.argv.forEach(function (a, i) { if (a === "--port") port = parseInt(process.argv[i + 1], 10) || port; });

http.createServer(function (req, res) {
  var u = url.parse(req.url, true);
  var send = function (status, body, headers) {
    var h = Object.assign({ "content-type": "application/json", "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, if-match, x-numu-actor",
      "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS" }, headers || {});
    res.writeHead(status, h);
    res.end(body == null ? "" : typeof body === "string" ? body : JSON.stringify(body));
  };

  if (u.pathname.indexOf("/api/") === 0) {
    if (req.method === "OPTIONS" && !/\/api\/objects\/[^/]+\/[^/]+$/.test(u.pathname)) return send(204, null); // CORS preflight
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      var body = {};
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}; } catch (e) { body = {}; }
      /* extra HTTP-only routes: nacl + feed append */
      if (u.pathname === "/api/nacl" && req.method === "POST") {
        var out = Nacl.exec(engine, Object.assign({ actor: req.headers["x-numu-actor"] || "USR_jm" }, body.ctx || {}), body.text || "");
        return send(200, out);
      }
      var fm = /^\/api\/conversations\/([^/]+)\/feed$/.exec(u.pathname);
      if (fm && req.method === "POST") {
        if (body.replace) { engine.state.feeds[fm[1]] = (body.blocks || []).slice(); engine.save(); }
        else engine.appendFeed(fm[1], body.blocks || []);
        return send(200, { ok: true });
      }
      var r = engine.handle({ method: req.method, path: u.pathname, query: u.query, body: body, headers: req.headers });
      send(r.status, r.body, Object.assign({}, r.headers, r.headers && r.headers.ETag ? { etag: r.headers.ETag } : {}));
    });
    return;
  }

  /* static file serving (project root) */
  var fp = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
  if (fp.indexOf(ROOT) !== 0) return send(403, { error: "forbidden" });
  if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
  fs.readFile(fp, function (err, buf) {
    if (err) return send(404, { error: "not_found", path: u.pathname });
    res.writeHead(200, { "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream", "access-control-allow-origin": "*" });
    res.end(buf);
  });
}).listen(port, function () {
  console.log("numu-sim listening on http://localhost:" + port);
  console.log("console:  http://localhost:" + port + "/ui_kits/console/index.html");
  console.log("api:      curl http://localhost:" + port + "/api/objects/case -H 'x-numu-actor: USR_jm'");
});
