var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
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

// src/shared/config.ts
var WEB_ORIGINS, API_BASE, SUPABASE_URL, SIGN_IN_URL, OCR_AVAILABLE, DASHBOARD_URL, BRIDGE_CHANNEL, EXTENSION_VERSION, LIMITS;
var init_config = __esm({
  "src/shared/config.ts"() {
    "use strict";
    WEB_ORIGINS = typeof __WEB_ORIGINS__ !== "undefined" ? __WEB_ORIGINS__ : ["https://www.bukmarkz.com", "https://bukmarkz.com"];
    API_BASE = (typeof __API_BASE__ !== "undefined" ? __API_BASE__ : WEB_ORIGINS[0]).replace(/\/+$/, "");
    SUPABASE_URL = (typeof __SUPABASE_URL__ !== "undefined" ? __SUPABASE_URL__ : "https://YOUR_PROJECT.supabase.co").replace(/\/+$/, "");
    SIGN_IN_URL = `${WEB_ORIGINS[0]}/login?source=extension`;
    OCR_AVAILABLE = false;
    DASHBOARD_URL = `${WEB_ORIGINS[0]}/`;
    BRIDGE_CHANNEL = "bukmarkz.bridge.v1";
    EXTENSION_VERSION = "0.3.0";
    LIMITS = {
      recentSaves: 8,
      note: 2e3,
      richNote: 1e4,
      imageUrl: 2048,
      tag: 24,
      tags: 8,
      title: 100,
      description: 300,
      faviconUrl: 2048,
      bridgePayloadBytes: 8192,
      reminderMaxDays: 365
    };
  }
});

// src/shared/jwt.ts
function jwtExp(token) {
  try {
    const b642 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b642.padEnd(Math.ceil(b642.length / 4) * 4, "=")), (c) => c.charCodeAt(0)));
    const exp = JSON.parse(json).exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}
var JWT_RE, looksLikeJwt;
var init_jwt = __esm({
  "src/shared/jwt.ts"() {
    "use strict";
    JWT_RE = /^[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}$/;
    looksLikeJwt = (t) => typeof t === "string" && t.length <= 4096 && JWT_RE.test(t);
  }
});

// src/content/bridge.ts
var bridge_exports = {};
__export(bridge_exports, {
  createBridge: () => createBridge
});
function parse(data) {
  if (!data || typeof data !== "object") return null;
  const d = data;
  if (d.channel !== BRIDGE_CHANNEL || d.from !== "page") return null;
  if (typeof d.type !== "string" || !TYPES.has(d.type)) return null;
  if (typeof d.requestId !== "string" || d.requestId.length === 0 || d.requestId.length > 64) return null;
  let size = 0;
  try {
    size = JSON.stringify(d).length;
  } catch {
    return null;
  }
  if (size > LIMITS.bridgePayloadBytes) return null;
  return d;
}
function createBridge({ win, sendToWorker, now = Date.now }) {
  const origin = win.location.origin;
  let stamps = [];
  const reply = (body) => win.postMessage({ channel: BRIDGE_CHANNEL, from: "extension", version: EXTENSION_VERSION, ...body }, origin);
  const allowed = () => {
    const t = now();
    stamps = stamps.filter((s) => t - s < WINDOW_MS);
    if (stamps.length >= MAX_PER_WINDOW) return false;
    stamps.push(t);
    return true;
  };
  async function relay(msg2) {
    switch (msg2.type) {
      case "AUTH_LOGIN": {
        const { accessToken } = msg2.payload ?? {};
        if (!looksLikeJwt(accessToken)) return { ok: false, error: "Bad token.", code: "bad_input" };
        return sendToWorker({ type: "bridge:login", accessToken });
      }
      case "AUTH_LOGOUT":
        return sendToWorker({ type: "bridge:logout" });
      default:
        return sendToWorker({ type: "session:get" });
    }
  }
  async function onMessage(event) {
    if (event.source !== win) return;
    if (event.origin !== origin) return;
    const msg2 = parse(event.data);
    if (!msg2) return;
    if (!allowed()) return reply({ type: "ACK", requestId: msg2.requestId, ok: false, code: "rate_limited" });
    if (msg2.type === "HELLO") return reply({ type: "READY", requestId: msg2.requestId, ok: true });
    try {
      const res = await relay(msg2);
      const user = res.ok && res.session ? { id: res.session.user.id, email: res.session.user.email } : null;
      reply({ type: "ACK", requestId: msg2.requestId, ok: res.ok, code: res.ok ? void 0 : res.code ?? "error", connected: Boolean(user), user });
    } catch {
      reply({ type: "ACK", requestId: msg2.requestId, ok: false, code: "extension_unavailable" });
    }
  }
  function onWorkerMessage(message, senderId, ownId) {
    if (!ownId || senderId !== ownId) return false;
    if (message?.type !== "bridge:refresh-request") return false;
    reply({ type: "REFRESH_REQUEST", requestId: "refresh-" + now() });
    return true;
  }
  win.addEventListener("message", (e) => void onMessage(e));
  reply({ type: "READY", requestId: "announce", ok: true });
  return { onMessage, onWorkerMessage };
}
var TYPES, WINDOW_MS, MAX_PER_WINDOW;
var init_bridge = __esm({
  "src/content/bridge.ts"() {
    "use strict";
    init_config();
    init_jwt();
    TYPES = /* @__PURE__ */ new Set(["HELLO", "AUTH_LOGIN", "AUTH_LOGOUT", "STATUS"]);
    WINDOW_MS = 1e4;
    MAX_PER_WINDOW = 10;
    if (typeof chrome !== "undefined" && chrome.runtime?.id) {
      const bridge = createBridge({ win: window, sendToWorker: (m) => chrome.runtime.sendMessage(m) });
      chrome.runtime.onMessage.addListener((m, sender) => {
        bridge.onWorkerMessage(m, sender.id, chrome.runtime.id);
      });
    }
  }
});

// test/unit.test.ts
init_bridge();
init_config();
import assert from "node:assert/strict";
import { test } from "node:test";

// src/shared/reminders.ts
function at(base, addDays, hour) {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
}
function reminderPresets(now = /* @__PURE__ */ new Date()) {
  const nextMonday = (() => {
    const d = new Date(now);
    const add = (8 - d.getDay()) % 7 || 7;
    return at(d, add, 9);
  })();
  return [
    { id: "none", label: "No reminder", at: null },
    { id: "1h", label: "In 1 hour", at: now.getTime() + 36e5 },
    { id: "tonight", label: "This evening (8 pm)", at: now.getHours() < 20 ? at(now, 0, 20) : at(now, 1, 20) },
    { id: "tomorrow", label: "Tomorrow morning (9 am)", at: at(now, 1, 9) },
    { id: "3d", label: "In 3 days", at: at(now, 3, 9) },
    { id: "week", label: "Next Monday (9 am)", at: nextMonday }
  ];
}

// test/unit.test.ts
init_jwt();

// src/shared/menu.ts
init_config();

// src/shared/validate.ts
init_config();
function isSavableUrl(raw) {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
function normalizeUrl(raw) {
  const u = new URL(raw);
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_eid$|ref_src$)/i.test(key)) u.searchParams.delete(key);
  }
  return u.toString();
}
function cleanTag(raw) {
  return raw.trim().toLowerCase().replace(/^#+/, "").replace(/[^\p{L}\p{N}_ -]/gu, "").replace(/\s+/g, "-").slice(0, LIMITS.tag);
}
function cleanTags(tags) {
  const out = [];
  for (const t of tags) {
    const c = cleanTag(t);
    if (c && !out.includes(c)) out.push(c);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}
var KINDS = ["page", "selection", "image"];
function sanitizeSave(input) {
  if (!input || typeof input !== "object") return null;
  const i = input;
  if (typeof i.url !== "string" || !isSavableUrl(i.url)) return null;
  const kind = KINDS.includes(i.kind) ? i.kind : "page";
  let imageUrl;
  if (kind === "image") {
    if (typeof i.imageUrl !== "string" || !isSavableUrl(i.imageUrl) || i.imageUrl.length > LIMITS.imageUrl) return null;
    imageUrl = i.imageUrl;
  }
  const favicon = typeof i.favicon === "string" && i.favicon.length <= LIMITS.faviconUrl && isSavableUrl(i.favicon) ? i.favicon : void 0;
  const description = typeof i.description === "string" ? i.description.replace(/\s+/g, " ").trim().slice(0, LIMITS.description) : "";
  const remind = typeof i.remindAt === "number" && Number.isFinite(i.remindAt) ? i.remindAt : null;
  const maxAt = Date.now() + LIMITS.reminderMaxDays * 864e5;
  return {
    url: normalizeUrl(i.url),
    title: String(i.title ?? "").trim().slice(0, LIMITS.title),
    note: String(i.note ?? "").slice(0, kind === "page" ? LIMITS.note : LIMITS.richNote),
    tags: cleanTags(Array.isArray(i.tags) ? i.tags.map(String) : []),
    remindAt: remind !== null && remind > Date.now() && remind <= maxAt ? remind : null,
    private: i.private === true,
    kind,
    ...imageUrl ? { imageUrl } : {},
    ...favicon ? { favicon } : {},
    ...description ? { description } : {}
  };
}

// src/shared/menu.ts
var MENU = {
  page: { id: "bukmarkz-save-page", title: "Save Page to Bukmarkz", contexts: ["page", "link"] },
  selection: { id: "bukmarkz-save-selection", title: "Save Selection as Rich Note", contexts: ["selection"] },
  image: { id: "bukmarkz-save-image", title: OCR_AVAILABLE ? "Save Image and Extract Text (OCR)" : "Save Image to Bukmarkz", contexts: ["image"] }
};
var esc = (s) => s.replace(/[\[\]\\]/g, "\\$&");
var mdUrl = (u) => u.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
function selectionNote(text, title, url) {
  const quote = text.trim().slice(0, LIMITS.richNote - 400).split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n");
  return `${quote}

\u2014 [${esc(title || new URL(url).hostname)}](${mdUrl(url)})`;
}
function buildSaveFromMenu(info, tab2) {
  const pageUrl = info.pageUrl ?? tab2?.url;
  const title = tab2?.title ?? "";
  const priv = tab2?.incognito === true;
  const base = { tags: [], remindAt: null, private: priv };
  if (info.menuItemId === MENU.page.id) {
    const target = info.linkUrl ?? pageUrl;
    if (!isSavableUrl(target)) return { ok: false, reason: "Bukmarkz can only save regular web pages (http or https)." };
    return { ok: true, input: { ...base, kind: "page", url: target, title: info.linkUrl ? "" : title, note: "" } };
  }
  if (!isSavableUrl(pageUrl)) return { ok: false, reason: "Bukmarkz can only save from regular web pages (http or https)." };
  if (info.menuItemId === MENU.selection.id) {
    const text = info.selectionText?.trim();
    if (!text) return { ok: false, reason: "Select some text first." };
    return { ok: true, input: { ...base, kind: "selection", url: pageUrl, title, note: selectionNote(text, title, pageUrl) } };
  }
  if (info.menuItemId === MENU.image.id) {
    if (!isSavableUrl(info.srcUrl)) return { ok: false, reason: "This image cannot be saved (it is embedded in the page, not a web address)." };
    return { ok: true, input: { ...base, kind: "image", url: pageUrl, title, note: `![image](${mdUrl(info.srcUrl)})`, imageUrl: info.srcUrl } };
  }
  return { ok: false, reason: "Unknown action." };
}

// test/unit.test.ts
function setup(reply, now = () => 1e6) {
  const posted = [];
  const listeners = [];
  const sent = [];
  const win = {
    location: { origin: "https://www.bukmarkz.com" },
    addEventListener: (_, cb) => listeners.push(cb),
    postMessage: (data, origin) => posted.push({ data, origin })
  };
  const bridge = createBridge({ win, now, sendToWorker: async (m) => {
    sent.push(m);
    return reply(m);
  } });
  const fire = async (data, over = {}) => {
    await bridge.onMessage({ source: "source" in over ? over.source : win, origin: over.origin ?? "https://www.bukmarkz.com", data });
  };
  return { win, posted, sent, fire };
}
var msg = (type, payload, requestId = "r1") => ({ channel: BRIDGE_CHANNEL, from: "page", type, requestId, payload });
var b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
var makeJwt = (exp) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", exp })}.c2lnbmF0dXJl`;
var TOKEN = makeJwt(4e9);
var okLogin = () => ({ ok: true, session: { user: { id: "u-7", email: "k@example.com" }, expiresAt: 4e9 } });
test("bridge announces READY when it loads", () => {
  const { posted } = setup(okLogin);
  assert.equal(posted[0].data.type, "READY");
  assert.equal(posted[0].origin, "https://www.bukmarkz.com");
});
test("login is relayed once and the reply never contains the token", async () => {
  const { fire, sent, posted } = setup(okLogin);
  await fire(msg("AUTH_LOGIN", { accessToken: TOKEN }));
  assert.deepEqual(sent, [{ type: "bridge:login", accessToken: TOKEN }]);
  const ack = posted.at(-1).data;
  assert.equal(ack.ok, true);
  assert.deepEqual(ack.user, { id: "u-7", email: "k@example.com" });
  assert.ok(!JSON.stringify(posted).includes(TOKEN));
});
test("messages from another window or origin are ignored", async () => {
  const { fire, sent, posted } = setup(okLogin);
  const before = posted.length;
  await fire(msg("AUTH_LOGIN", { accessToken: TOKEN }), { source: {} });
  await fire(msg("AUTH_LOGIN", { accessToken: TOKEN }), { origin: "https://evil.example" });
  assert.equal(sent.length, 0);
  assert.equal(posted.length, before);
});
test("malformed, unknown and oversized messages are dropped", async () => {
  const { fire, sent } = setup(okLogin);
  await fire(null);
  await fire("hello");
  await fire({ ...msg("AUTH_LOGIN", { accessToken: TOKEN }), channel: "other" });
  await fire({ ...msg("AUTH_LOGIN", { accessToken: TOKEN }), from: "extension" });
  await fire(msg("DELETE_EVERYTHING"));
  await fire(msg("AUTH_LOGIN", { accessToken: TOKEN }, ""));
  await fire(msg("AUTH_LOGIN", { accessToken: TOKEN, junk: "x".repeat(9e3) }));
  assert.equal(sent.length, 0);
});
test("bad tokens are rejected before reaching the worker", async () => {
  const { fire, sent, posted } = setup(okLogin);
  for (const accessToken of [void 0, 123, "", "short", "x".repeat(300), "a.b.c", "Token abc.def.ghi", `${TOKEN}${"x".repeat(5e3)}`, { toString: 1 }]) await fire(msg("AUTH_LOGIN", { accessToken }));
  assert.equal(sent.length, 0);
  assert.ok(posted.slice(1).every((p) => p.data.ok === false && p.data.code === "bad_input"));
});
test("rate limit: 10 messages per 10 seconds, then it recovers", async () => {
  let t = 0;
  const { fire, sent, posted } = setup(okLogin, () => t);
  for (let i = 0; i < 12; i++) await fire(msg("STATUS", void 0, `r${i}`));
  assert.equal(sent.length, 10);
  assert.equal(posted.at(-1).data.code, "rate_limited");
  t = 11e3;
  await fire(msg("STATUS", void 0, "later"));
  assert.equal(sent.length, 11);
});
test("a dead extension context gives a clear failure instead of throwing", async () => {
  const { fire, posted } = setup(() => {
    throw new Error("Extension context invalidated.");
  });
  await fire(msg("AUTH_LOGOUT"));
  assert.equal(posted.at(-1).data.code, "extension_unavailable");
});
test("worker errors are passed on as codes", async () => {
  const { fire, posted } = setup(() => ({ ok: false, error: "nope", code: "invalid_token" }));
  await fire(msg("AUTH_LOGIN", { accessToken: TOKEN }));
  assert.equal(posted.at(-1).data.ok, false);
  assert.equal(posted.at(-1).data.code, "invalid_token");
});
test("only http(s) pages are savable", () => {
  assert.equal(isSavableUrl("https://a.com/x"), true);
  for (const bad of ["chrome://settings", "file:///etc/passwd", "javascript:alert(1)", "about:blank", "", void 0, "not a url", "data:text/html,hi"]) assert.equal(isSavableUrl(bad), false, String(bad));
});
test("URLs are normalised: no fragment, no tracking params, real params kept", () => {
  assert.equal(normalizeUrl("https://a.com/p?id=3&utm_source=x&fbclid=y#top"), "https://a.com/p?id=3");
});
test("tags are cleaned, de-duplicated and capped", () => {
  assert.equal(cleanTag("  #Machine Learning!! "), "machine-learning");
  assert.deepEqual(cleanTags(["AI", "ai", "#ai", "", "  "]), ["ai"]);
  assert.equal(cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 8);
  assert.equal(cleanTag("x".repeat(100)).length, 24);
});
test("sanitizeSave rejects bad input and bounds good input", () => {
  assert.equal(sanitizeSave(null), null);
  assert.equal(sanitizeSave({ url: "chrome://x" }), null);
  const now = Date.now();
  const ok = sanitizeSave({ url: "https://a.com/#x", title: "T".repeat(300), note: "n".repeat(5e3), tags: ["A"], remindAt: now + 6e4, private: true });
  assert.equal(ok.url, "https://a.com/");
  assert.equal(ok.title.length, 100);
  assert.equal(ok.note.length, 2e3);
  assert.equal(ok.private, true);
  assert.equal(ok.remindAt, now + 6e4);
  assert.equal(sanitizeSave({ url: "https://a.com", remindAt: now - 1 }).remindAt, null);
  assert.equal(sanitizeSave({ url: "https://a.com", remindAt: now + 400 * 864e5 }).remindAt, null);
  assert.equal(sanitizeSave({ url: "https://a.com", remindAt: NaN }).remindAt, null);
  assert.equal(sanitizeSave({ url: "https://a.com", private: "yes" }).private, false);
});
test("reminder presets are in the future and ordered sensibly", () => {
  const now = new Date(2026, 9, 20, 15, 0, 0);
  const p = Object.fromEntries(reminderPresets(now).map((x) => [x.id, x.at]));
  assert.equal(p.none, null);
  assert.equal(p["1h"], now.getTime() + 36e5);
  assert.equal(new Date(p.tonight).getHours(), 20);
  assert.equal(new Date(p.tonight).getDate(), 20);
  assert.equal(new Date(p.tomorrow).getDate(), 21);
  assert.equal(new Date(p["3d"]).getDate(), 23);
  assert.equal(new Date(p.week).getDay(), 1);
  assert.equal(new Date(p.week).getDate(), 26);
  for (const k of ["1h", "tonight", "tomorrow", "3d", "week"]) assert.ok(p[k] > now.getTime(), k);
  const late = reminderPresets(new Date(2026, 9, 20, 22, 0, 0)).find((x) => x.id === "tonight");
  assert.equal(new Date(late.at).getDate(), 21);
  const monday = reminderPresets(new Date(2026, 9, 19, 10, 0, 0)).find((x) => x.id === "week");
  assert.equal(new Date(monday.at).getDate(), 26);
});
test("jwtExp reads the exp claim and survives garbage", () => {
  assert.equal(jwtExp(makeJwt(19e8)), 19e8);
  for (const bad of ["", "a.b", "a.b.c", "x.!!!.z", `x.${b64({ exp: "soon" })}.z`]) assert.equal(jwtExp(bad), null, bad);
  assert.equal(looksLikeJwt(TOKEN), true);
  for (const bad of [null, 5, "abc", "a.b.c", "Bearer x.y.z", `${TOKEN}.extra`]) assert.equal(looksLikeJwt(bad), false, String(bad));
});
var tab = { url: "https://site.test/article", title: "How [vector] search works", incognito: false };
test("three menu items with the contexts they need", () => {
  assert.deepEqual(Object.values(MENU).map((m) => [m.title, m.contexts.join("+")]), [
    ["Save Page to Bukmarkz", "page+link"],
    ["Save Selection as Rich Note", "selection"],
    ["Save Image to Bukmarkz", "image"]
  ]);
  assert.equal(new Set(Object.values(MENU).map((m) => m.id)).size, 3);
});
test("menu: page, link, selection and image become the right save request", () => {
  const page = buildSaveFromMenu({ menuItemId: MENU.page.id, pageUrl: tab.url }, tab);
  assert.deepEqual(page.ok && [page.input.kind, page.input.url, page.input.title], ["page", tab.url, tab.title]);
  const link = buildSaveFromMenu({ menuItemId: MENU.page.id, pageUrl: tab.url, linkUrl: "https://other.test/x" }, tab);
  assert.deepEqual(link.ok && [link.input.url, link.input.title], ["https://other.test/x", ""]);
  const sel = buildSaveFromMenu({ menuItemId: MENU.selection.id, pageUrl: tab.url, selectionText: "  line one\nline two  " }, tab);
  assert.ok(sel.ok && sel.input.kind === "selection" && sel.input.url === tab.url);
  assert.equal(sel.ok && sel.input.note, "> line one\n> line two\n\n\u2014 [How \\[vector\\] search works](https://site.test/article)");
  const img = buildSaveFromMenu({ menuItemId: MENU.image.id, pageUrl: tab.url, srcUrl: "https://cdn.test/a (1).png" }, tab);
  assert.ok(img.ok && img.input.kind === "image" && img.input.imageUrl === "https://cdn.test/a (1).png");
  assert.equal(img.ok && img.input.note, "![image](https://cdn.test/a%20%281%29.png)");
});
test("menu: refuses what cannot be saved, with a reason", () => {
  for (const [info, t] of [
    [{ menuItemId: MENU.page.id, pageUrl: "chrome://settings" }, { url: "chrome://settings" }],
    [{ menuItemId: MENU.selection.id, pageUrl: tab.url, selectionText: "   " }, tab],
    [{ menuItemId: MENU.image.id, pageUrl: tab.url, srcUrl: "data:image/png;base64,AAAA" }, tab],
    [{ menuItemId: MENU.image.id, pageUrl: tab.url, srcUrl: "blob:https://site.test/1" }, tab],
    [{ menuItemId: MENU.selection.id, pageUrl: "file:///x", selectionText: "x" }, { url: "file:///x" }],
    [{ menuItemId: "something-else", pageUrl: tab.url }, tab]
  ]) {
    const r = buildSaveFromMenu(info, t);
    assert.equal(r.ok, false, JSON.stringify(info));
    assert.ok(!r.ok && r.reason.length > 5);
  }
});
test("menu: incognito is decided by the browser tab, so the save is private", () => {
  const r = buildSaveFromMenu({ menuItemId: MENU.page.id, pageUrl: tab.url }, { ...tab, incognito: true });
  assert.ok(r.ok && r.input.private === true);
  assert.ok(selectionNote("x".repeat(5e4), "t", tab.url).length <= 1e4);
});
test("sanitizeSave: kinds, image URL rules and rich-note length", () => {
  const sel = sanitizeSave({ url: "https://a.com", kind: "selection", note: "n".repeat(9e3) });
  assert.equal([sel.kind, sel.note.length].join(), "selection,9000");
  assert.equal(sanitizeSave({ url: "https://a.com", note: "n".repeat(9e3) }).note.length, 2e3);
  assert.equal(sanitizeSave({ url: "https://a.com", kind: "bogus" }).kind, "page");
  assert.equal(sanitizeSave({ url: "https://a.com", kind: "image" }), null);
  assert.equal(sanitizeSave({ url: "https://a.com", kind: "image", imageUrl: "javascript:alert(1)" }), null);
  assert.equal(sanitizeSave({ url: "https://a.com", kind: "image", imageUrl: "https://c.test/a.png" }).imageUrl, "https://c.test/a.png");
});
test("bridge: a refresh request from our own worker becomes a REFRESH_REQUEST for the page; others are ignored", async () => {
  const { createBridge: createBridge2 } = await Promise.resolve().then(() => (init_bridge(), bridge_exports));
  const posted = [];
  const win = { location: { origin: "https://www.bukmarkz.com" }, addEventListener() {
  }, postMessage: (d, o) => posted.push({ d, o }) };
  const b = createBridge2({ win, sendToWorker: async () => ({ ok: true }) });
  posted.length = 0;
  assert.equal(b.onWorkerMessage({ type: "bridge:refresh-request" }, "ext-id", "ext-id"), true);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].d.type, "REFRESH_REQUEST");
  assert.equal(posted[0].o, "https://www.bukmarkz.com");
  assert.ok(!JSON.stringify(posted).match(/token/i), "no token in the message");
  assert.equal(b.onWorkerMessage({ type: "bridge:refresh-request" }, "other-ext", "ext-id"), false);
  assert.equal(b.onWorkerMessage({ type: "bridge:login" }, "ext-id", "ext-id"), false);
  assert.equal(b.onWorkerMessage(null, "ext-id", "ext-id"), false);
  assert.equal(posted.length, 1);
});
