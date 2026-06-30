var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/HexSession.ts
import { DurableObject } from "cloudflare:workers";

// ../shared/model/map.ts
var EMPTY_TERRAIN = "";
var DEFAULT_TILE = {
  terrain: EMPTY_TERRAIN,
  rotation: 0,
  fog: "hidden"
};
var ROTATIONS = [0, 60, 120, 180, 240, 300];
var FOGS = /* @__PURE__ */ new Set(["hidden", "explored", "visible"]);
var ROTATION_SET = new Set(ROTATIONS);
function isFogState(v) {
  return typeof v === "string" && FOGS.has(v);
}
__name(isFogState, "isFogState");
function isTileKey(v) {
  return typeof v === "string" && /^-?\d+,-?\d+$/.test(v);
}
__name(isTileKey, "isTileKey");
function isPathArray(v) {
  if (!Array.isArray(v)) return false;
  return v.every((p) => {
    if (typeof p !== "object" || p === null) return false;
    const o = p;
    return typeof o.kind === "string" && Array.isArray(o.edges) && o.edges.every((e) => Number.isInteger(e));
  });
}
__name(isPathArray, "isPathArray");
function isHexTile(v) {
  if (typeof v !== "object" || v === null) return false;
  const t = v;
  if (typeof t.terrain !== "string") return false;
  if (t.overlay !== void 0 && typeof t.overlay !== "string") return false;
  if (typeof t.rotation !== "number" || !ROTATION_SET.has(t.rotation)) return false;
  if (!isFogState(t.fog)) return false;
  if (t.paths !== void 0 && !isPathArray(t.paths)) return false;
  for (const flag of ["snow", "volcanic", "ice"]) {
    if (t[flag] !== void 0 && typeof t[flag] !== "boolean") return false;
  }
  return true;
}
__name(isHexTile, "isHexTile");
function isMapDocument(v) {
  if (typeof v !== "object" || v === null) return false;
  const m = v;
  return typeof m.schemaVersion === "number" && typeof m.id === "string" && typeof m.name === "string" && (m.orientation === "pointy" || m.orientation === "flat") && typeof m.hexSize === "number" && typeof m.width === "number" && typeof m.height === "number" && typeof m.tiles === "object" && m.tiles !== null;
}
__name(isMapDocument, "isMapDocument");

// src/validation.ts
function isRole(v) {
  return v === "gm" || v === "player";
}
__name(isRole, "isRole");
function parseClientMessage(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const m = data;
  switch (m.type) {
    case "join": {
      if (!isRole(m.role) || typeof m.sessionId !== "string") return null;
      if (m.name !== void 0 && typeof m.name !== "string") return null;
      const map = m.map === void 0 ? void 0 : isMapDocument(m.map) ? m.map : null;
      if (map === null) return null;
      return { type: "join", sessionId: m.sessionId, role: m.role, name: m.name, map };
    }
    case "patch":
      return isTileKey(m.tileKey) && isHexTile(m.tile) ? { type: "patch", tileKey: m.tileKey, tile: m.tile } : null;
    case "fogUpdate":
      return isTileKey(m.tileKey) && isFogState(m.fog) ? { type: "fogUpdate", tileKey: m.tileKey, fog: m.fog } : null;
    case "fullState":
      return isMapDocument(m.map) ? { type: "fullState", map: m.map } : null;
    case "requestFullState":
      return { type: "requestFullState" };
    default:
      return null;
  }
}
__name(parseClientMessage, "parseClientMessage");

// src/HexSession.ts
var HexSession = class extends DurableObject {
  static {
    __name(this, "HexSession");
  }
  /** Cache in memoria del documento; la fonte persistita è in `ctx.storage`.
   * Si ricarica pigramente dopo un'ibernazione (memoria azzerata). */
  map;
  loaded = false;
  /** Upgrade WebSocket: accetta il socket lato server in modalità hibernation. */
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Atteso un upgrade WebSocket.", { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }
  // ---- Hibernation handlers -------------------------------------------------
  async webSocketMessage(ws, message) {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const msg = parseClientMessage(text);
    if (!msg) {
      this.send(ws, { type: "error", message: "Messaggio non valido." });
      return;
    }
    await this.handle(ws, msg);
  }
  async webSocketClose(ws, code, reason, _wasClean) {
    try {
      ws.close(code, reason);
    } catch {
    }
    this.broadcastPresence();
  }
  // ---- logica di sessione ---------------------------------------------------
  async handle(ws, msg) {
    switch (msg.type) {
      case "join": {
        const prev = this.attachment(ws);
        if (msg.role === "gm" && msg.map) {
          await this.setMap(msg.map);
        }
        const map = await this.getMap();
        const attachment = {
          id: prev?.id ?? crypto.randomUUID(),
          role: msg.role,
          name: msg.name ?? (msg.role === "gm" ? "DM" : "Player")
        };
        ws.serializeAttachment(attachment);
        if (map) {
          this.send(ws, { type: "fullState", map });
        } else if (msg.role === "player") {
          this.send(ws, { type: "error", message: "La sessione non ha ancora una mappa." });
        }
        this.broadcastPresence();
        break;
      }
      case "patch": {
        if (!this.requireGm(ws)) return;
        const map = await this.getMap();
        if (!map) return;
        map.tiles[msg.tileKey] = msg.tile;
        await this.setMap(map);
        this.broadcast({ type: "patch", tileKey: msg.tileKey, tile: msg.tile }, ws);
        break;
      }
      case "fogUpdate": {
        if (!this.requireGm(ws)) return;
        const map = await this.getMap();
        if (!map) return;
        const prev = map.tiles[msg.tileKey] ?? { ...DEFAULT_TILE };
        map.tiles[msg.tileKey] = { ...prev, fog: msg.fog };
        await this.setMap(map);
        this.broadcast({ type: "fogUpdate", tileKey: msg.tileKey, fog: msg.fog }, ws);
        break;
      }
      case "fullState": {
        if (!this.requireGm(ws)) return;
        await this.setMap(msg.map);
        this.broadcast({ type: "fullState", map: msg.map }, ws);
        break;
      }
      case "requestFullState": {
        const map = await this.getMap();
        if (map) this.send(ws, { type: "fullState", map });
        break;
      }
    }
  }
  /** True se il socket è il GM; altrimenti rifiuta con un errore. */
  requireGm(ws) {
    if (this.attachment(ws)?.role === "gm") return true;
    this.send(ws, { type: "error", message: "Solo il DM pu\xF2 modificare la mappa." });
    return false;
  }
  attachment(ws) {
    return ws.deserializeAttachment() ?? null;
  }
  // ---- stato (memoria + storage) -------------------------------------------
  async getMap() {
    if (!this.loaded) {
      this.map = await this.ctx.storage.get("map");
      this.loaded = true;
    }
    return this.map;
  }
  async setMap(map) {
    this.map = map;
    this.loaded = true;
    await this.ctx.storage.put("map", map);
  }
  // ---- invio messaggi -------------------------------------------------------
  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
    }
  }
  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
      }
    }
  }
  broadcastPresence() {
    const players = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (att) players.push({ id: att.id, role: att.role, name: att.name });
    }
    this.broadcast({ type: "presence", players });
  }
};

// src/index.ts
var ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let code = "";
  for (let i = 0; i < len; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}
__name(genCode, "genCode");
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
__name(json, "json");
var SESSION_WS = /^\/session\/([^/]+)\/websocket$/;
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (path === "/health") {
      return json({ ok: true });
    }
    if (path === "/session" && request.method === "POST") {
      return json({ sessionId: genCode() });
    }
    const match = SESSION_WS.exec(path);
    if (match) {
      const sessionId = decodeURIComponent(match[1]);
      const id = env.HEX_SESSIONS.idFromName(sessionId);
      const stub = env.HEX_SESSIONS.get(id);
      return stub.fetch(request);
    }
    return new Response("Not found", { status: 404, headers: CORS });
  }
};

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-bT7V36/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-bT7V36/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  HexSession,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
