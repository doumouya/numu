/* numu-sim · numu-client.js — the swappable client seam.
   NumuClient.local()  → in-process engine (browser): localStorage persistence,
                         blob refetch-by-src (derive-don't-store survives reload).
   NumuClient.http(url)→ same interface over fetch, for the Node server.
   Console code talks ONLY to this interface.                                  */
(function (root, factory) {
  var Eng = (typeof module !== "undefined" && typeof require === "function") ? require("./numu-engine.js") : root.NumuEngine;
  var Nacl = (typeof module !== "undefined" && typeof require === "function") ? require("./numu-nacl.js") : root.NumuNacl;
  var mod = factory(Eng, Nacl, root);
  if (typeof module !== "undefined" && module.exports) module.exports = mod;
  root.NumuClient = mod;
})(typeof window !== "undefined" ? window : globalThis, function (Eng, Nacl, root) {

  var LS_KEY = "numu_sim_v2";
  var BLOB_LIMIT = 250 * 1024;             // persist small blobs only; big ones refetch from src

  function localClient() {
    var blobMem = {}, blobIdx = {};
    try { blobIdx = JSON.parse(root.localStorage.getItem(LS_KEY + "_blobs") || "{}"); } catch (e) { blobIdx = {}; }
    var blobStore = {
      save: function (k, v) {
        blobMem[k] = v;
        if (v.length <= BLOB_LIMIT) { try { root.localStorage.setItem(LS_KEY + "_b_" + k, v); blobIdx[k] = 1; root.localStorage.setItem(LS_KEY + "_blobs", JSON.stringify(blobIdx)); } catch (e) {} }
      },
      load: function (k) {
        if (blobMem[k] != null) return blobMem[k];
        if (blobIdx[k]) { try { var v = root.localStorage.getItem(LS_KEY + "_b_" + k); if (v != null) { blobMem[k] = v; return v; } } catch (e) {} }
        return null;
      },
      has: function (k) { return this.load(k) != null; }
    };
    var persist = {
      load: function () { try { return JSON.parse(root.localStorage.getItem(LS_KEY) || "null"); } catch (e) { return null; } },
      save: function (st) { root.localStorage.setItem(LS_KEY, JSON.stringify(st)); }
    };
    var engine = new Eng.Engine({ persist: persist, blobStore: blobStore });

    var api = {
      kind: "local", engine: engine, actor: "USR_jm",
      /* re-fetch an original blob by the src recorded on the file entity (derive-don't-store) */
      ensureBlob: function (fileId) {
        var e = engine.state.entities[fileId];
        if (!e) return Promise.resolve(false);
        if (engine.blobs.has(e.data.blob_ref)) return Promise.resolve(true);
        var src = e.data.attributes && e.data.attributes.src;
        if (!src) return Promise.resolve(false);
        return fetch(src).then(function (r) { return r.text(); }).then(function (txt) {
          engine.blobs.save(e.data.blob_ref, txt); delete engine.tables[fileId]; return true;
        }).catch(function () { return false; });
      },
      request: function (method, path, opts) {
        opts = opts || {};
        var res = engine.handle({ method: method, path: path, query: opts.query || {}, body: opts.body || {}, headers: Object.assign({ "x-numu-actor": api.actor }, opts.headers || {}) });
        return Promise.resolve(res);
      },
      nacl: function (text, ctx) {
        ctx = Object.assign({ actor: api.actor }, ctx || {});
        var needsFile = /file\.|^unwrap|^clean|^repair|^rename|^dedupe|^sort|^group|^on:|^read:[a-z_]+,|^new:chart|^new:dashboard/i.test(text.trim());
        var pre = needsFile && ctx.itFileId ? api.ensureBlob(ctx.itFileId) : Promise.resolve(true);
        return pre.then(function () { return Nacl.exec(engine, ctx, text); });
      },
      uploadCsv: function (projectId, filename, csvText, srcUrl) {
        var res = engine.uploadCsv(api.actor, projectId, filename, csvText, "csv");
        if (res.status === 201 && srcUrl) {
          var e = engine.state.entities[res.body.rid];
          e.data.attributes = Object.assign({}, e.data.attributes, { src: srcUrl });
          engine.save();
        }
        return Promise.resolve(res);
      },
      feed: function (key) { return Promise.resolve(engine.feedOf(key).slice()); },
      appendFeed: function (key, blocks) { engine.appendFeed(key, blocks); return Promise.resolve(true); },
      setFeed: function (key, blocks) { engine.state.feeds[key] = blocks.slice(); engine.save(); return Promise.resolve(true); },
      manifest: function (workspace) { return api.request("GET", "/api/manifest", { query: { workspace: workspace } }).then(function (r) { return r.body; }); },
      values: function (fileId, col) { return api.request("GET", "/api/values", { query: { file: fileId, col: col } }).then(function (r) { return r.body; }); },
      reset: function () { try { root.localStorage.removeItem(LS_KEY); Object.keys(root.localStorage).forEach(function (k) { if (k.indexOf(LS_KEY) === 0) root.localStorage.removeItem(k); }); } catch (e) {} }
    };
    return api;
  }

  function httpClient(base) {
    base = (base || "").replace(/\/$/, "");
    var actor = "USR_jm";
    function req(method, path, opts) {
      opts = opts || {};
      var q = opts.query ? "?" + Object.keys(opts.query).map(function (k) { return k + "=" + encodeURIComponent(opts.query[k]); }).join("&") : "";
      return fetch(base + path + q, {
        method: method,
        headers: Object.assign({ "content-type": "application/json", "x-numu-actor": actor }, opts.headers || {}),
        body: opts.body && method !== "GET" && method !== "HEAD" ? JSON.stringify(opts.body) : undefined
      }).then(function (r) {
        return r.text().then(function (txt) {
          var body = null; try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = txt; }
          return { status: r.status, body: body, headers: { ETag: r.headers.get("etag") } };
        });
      });
    }
    return {
      kind: "http", actor: actor, request: req,
      ensureBlob: function () { return Promise.resolve(true); },  // server owns the blobs
      nacl: function (text, ctx) { return req("POST", "/api/nacl", { body: { text: text, ctx: ctx } }).then(function (r) { return r.body; }); },
      uploadCsv: function (projectId, filename, csvText) { return req("POST", "/api/files", { body: { project_id: projectId, filename: filename, csv: csvText } }); },
      feed: function (key) { return req("GET", "/api/conversations/" + key + "/feed").then(function (r) { return r.body || []; }); },
      appendFeed: function (key, blocks) { return req("POST", "/api/conversations/" + key + "/feed", { body: { blocks: blocks } }); },
      setFeed: function (key, blocks) { return req("POST", "/api/conversations/" + key + "/feed", { body: { blocks: blocks, replace: true } }); },
      manifest: function (workspace) { return req("GET", "/api/manifest", { query: { workspace: workspace } }).then(function (r) { return r.body; }); },
      values: function (fileId, col) { return req("GET", "/api/values", { query: { file: fileId, col: col } }).then(function (r) { return r.body; }); }
    };
  }

  return { local: localClient, http: httpClient };
});
