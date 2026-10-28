var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// web/syncLoginToExtension.ts
var syncLoginToExtension_exports = {};
__export(syncLoginToExtension_exports, {
  startExtensionSync: () => startExtensionSync
});
function request(type, payload, timeoutMs = 2e3) {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const done = (v) => {
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      resolve(v);
    };
    const onMsg = (e) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data;
      if (d?.channel === CHANNEL && d?.from === "extension" && d?.requestId === requestId) done(d);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    window.addEventListener("message", onMsg);
    window.postMessage({ channel: CHANNEL, from: "page", type, requestId, payload }, window.location.origin);
  });
}
function startExtensionSync(supabase) {
  let lastSent = null;
  let chain = Promise.resolve();
  const push = (session) => {
    chain = chain.then(async () => {
      if (!session) {
        if (lastSent === "") return;
        const ack2 = await request("AUTH_LOGOUT");
        if (ack2?.ok) lastSent = "";
        return;
      }
      if (session.access_token === lastSent) return;
      const ack = await request("AUTH_LOGIN", { accessToken: session.access_token });
      if (ack?.ok) lastSent = session.access_token;
    }).catch(() => void 0);
  };
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") setTimeout(() => push(null), 0);
    else if (SHARE.has(event)) setTimeout(() => push(session), 0);
  });
  const onReady = (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    if (e.data?.channel === CHANNEL && e.data?.from === "extension" && e.data?.type === "READY") {
      lastSent = null;
      void supabase.auth.getSession().then(({ data }) => push(data.session));
    }
  };
  window.addEventListener("message", onReady);
  let lastAsk = 0;
  const onRefreshAsk = (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    if (e.data?.channel !== CHANNEL || e.data?.from !== "extension" || e.data?.type !== "REFRESH_REQUEST") return;
    const t = Date.now();
    if (t - lastAsk < 1e4) return;
    lastAsk = t;
    lastSent = null;
    void supabase.auth.getSession().then(({ data }) => push(data.session));
  };
  window.addEventListener("message", onRefreshAsk);
  return () => {
    subscription.unsubscribe();
    window.removeEventListener("message", onReady);
    window.removeEventListener("message", onRefreshAsk);
  };
}
var CHANNEL, SHARE;
var init_syncLoginToExtension = __esm({
  "web/syncLoginToExtension.ts"() {
    "use strict";
    CHANNEL = "bukmarkz.bridge.v1";
    SHARE = /* @__PURE__ */ new Set(["INITIAL_SESSION", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"]);
  }
});

// test/sync.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
function setup(opts = { extension: "ok" }) {
  const listeners = [];
  const log = [];
  const win = {
    location: { origin: "https://www.bukmarkz.com" },
    addEventListener: (_, f) => listeners.push(f),
    removeEventListener: (_, f) => {
      listeners.splice(listeners.indexOf(f), 1);
    },
    postMessage: (data, origin) => {
      log.push({ data, origin });
      if (data.from !== "page" || opts.extension === "absent") return;
      setTimeout(() => [...listeners].forEach((l) => l({ source: win, origin: win.location.origin, data: { channel: "bukmarkz.bridge.v1", from: "extension", type: "ACK", requestId: data.requestId, ok: opts.extension === "ok" } })), 0);
    }
  };
  globalThis.window = win;
  const emit = (data, over = {}) => [...listeners].forEach((l) => l({ source: win, origin: win.location.origin, data, ...over }));
  let cb = () => {
  };
  let current = null;
  let unsub = 0;
  const supabase = { auth: {
    onAuthStateChange: (f) => {
      cb = f;
      return { data: { subscription: { unsubscribe: () => unsub++ } } };
    },
    getSession: async () => ({ data: { session: current } })
  } };
  return { win, log, emit, supabase, fire: (e, s) => {
    current = s;
    cb(e, s);
  }, unsub: () => unsub, sent: () => log.filter((l) => l.data.from === "page").map((l) => l.data) };
}
var sess = (t) => ({ access_token: t, refresh_token: "REFRESH-SECRET", user: { id: "u" } });
var tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
globalThis.crypto ??= __require("node:crypto").webcrypto;
test("sign-in posts only the ACCESS token to our own origin; refresh token never leaves; sign-out is relayed", async () => {
  const { startExtensionSync: startExtensionSync2 } = await Promise.resolve().then(() => (init_syncLoginToExtension(), syncLoginToExtension_exports));
  const t = setup();
  const stop = startExtensionSync2(t.supabase);
  t.fire("SIGNED_IN", sess("AT1"));
  await tick();
  assert.deepEqual(t.sent().map((m) => [m.type, m.payload?.accessToken]), [["AUTH_LOGIN", "AT1"]]);
  assert.ok(t.log.every((l) => l.origin === "https://www.bukmarkz.com"));
  assert.ok(!JSON.stringify(t.log).includes("REFRESH-SECRET"));
  t.fire("TOKEN_REFRESHED", sess("AT2"));
  await tick();
  t.fire("TOKEN_REFRESHED", sess("AT2"));
  await tick();
  t.fire("SIGNED_OUT", null);
  await tick();
  t.fire("SIGNED_OUT", null);
  await tick();
  assert.deepEqual(t.sent().map((m) => [m.type, m.payload?.accessToken]), [["AUTH_LOGIN", "AT1"], ["AUTH_LOGIN", "AT2"], ["AUTH_LOGOUT", void 0]]);
  stop();
  assert.equal(t.unsub(), 1);
});
test("a password-recovery session is never shared", async () => {
  const { startExtensionSync: startExtensionSync2 } = await Promise.resolve().then(() => (init_syncLoginToExtension(), syncLoginToExtension_exports));
  const t = setup();
  startExtensionSync2(t.supabase);
  t.fire("PASSWORD_RECOVERY", sess("RECOVERY"));
  await tick();
  assert.equal(t.sent().length, 0);
});
test("no extension installed: quiet, no retry storm", async () => {
  const { startExtensionSync: startExtensionSync2 } = await Promise.resolve().then(() => (init_syncLoginToExtension(), syncLoginToExtension_exports));
  const t = setup({ extension: "absent" });
  startExtensionSync2(t.supabase);
  t.fire("SIGNED_IN", sess("AT"));
  await tick(2300);
  assert.equal(t.sent().length, 1);
});
test("extension refuses (e.g. another account connected): not retried in a loop", async () => {
  const { startExtensionSync: startExtensionSync2 } = await Promise.resolve().then(() => (init_syncLoginToExtension(), syncLoginToExtension_exports));
  const t = setup({ extension: "refuse" });
  startExtensionSync2(t.supabase);
  t.fire("SIGNED_IN", sess("AT"));
  await tick();
  assert.equal(t.sent().length, 1);
});
test("extension that loads late announces READY and receives the current session", async () => {
  const { startExtensionSync: startExtensionSync2 } = await Promise.resolve().then(() => (init_syncLoginToExtension(), syncLoginToExtension_exports));
  const t = setup();
  startExtensionSync2(t.supabase);
  t.fire("SIGNED_IN", sess("AT"));
  await tick();
  t.emit({ channel: "bukmarkz.bridge.v1", from: "extension", type: "READY", requestId: "announce" });
  await tick(40);
  assert.equal(t.sent().filter((m) => m.type === "AUTH_LOGIN").length, 2);
  t.emit({ channel: "bukmarkz.bridge.v1", from: "extension", type: "READY", requestId: "x" }, { origin: "https://evil.test" });
  await tick(40);
  assert.equal(t.sent().filter((m) => m.type === "AUTH_LOGIN").length, 2);
});
test("REFRESH_REQUEST from the extension re-sends the (renewed) session, once per 10 s, never from another origin", async () => {
  const { startExtensionSync: startExtensionSync2 } = await Promise.resolve().then(() => (init_syncLoginToExtension(), syncLoginToExtension_exports));
  const t = setup();
  startExtensionSync2(t.supabase);
  t.fire("SIGNED_IN", sess("AT1"));
  await tick();
  assert.equal(t.sent().length, 1);
  t.fire("TOKEN_REFRESHED", sess("AT2"));
  await tick();
  const ask = { channel: "bukmarkz.bridge.v1", from: "extension", type: "REFRESH_REQUEST", requestId: "r1" };
  t.emit(ask, { origin: "https://evil.test" });
  await tick();
  assert.equal(t.sent().length, 2);
  t.emit(ask);
  await tick();
  t.emit(ask);
  await tick();
  assert.deepEqual(t.sent().map((m) => m.payload?.accessToken), ["AT1", "AT2", "AT2"]);
});
