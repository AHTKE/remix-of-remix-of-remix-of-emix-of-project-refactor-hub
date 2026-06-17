// ============================================================
// Dynamic KV adapter
// ------------------------------------------------------------
// Resolution order, per call:
//   1) Cloudflare REST API (when CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_KV_NAMESPACE_ID
//      + CLOUDFLARE_API_TOKEN are all configured via /admin/settings).
//   2) Native Workers binding `AMW_KV` (when deployed with a kv_namespaces
//      binding in wrangler.toml).
//   3) In-memory Map fallback (Lovable preview / local dev).
// ============================================================

import { getOverrideSync } from "./telegram.server";
  get(key: string, type?: "text" | "json"): Promise<any>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list?(opts?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string; expiration?: number }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

// ----- in-memory fallback (Lovable preview / local dev) -----
type MemEntry = { value: string; expiresAt?: number };
const _mem = new Map<string, MemEntry>();

const memoryKV: KVNamespaceLike = {
  async get(key, type) {
    const e = _mem.get(key);
    if (!e) return null;
    if (e.expiresAt && Date.now() > e.expiresAt) {
      _mem.delete(key);
      return null;
    }
    if (type === "json") {
      try { return JSON.parse(e.value); } catch { return null; }
    }
    return e.value;
  },
  async put(key, value, opts) {
    const expiresAt = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : undefined;
    _mem.set(key, { value, expiresAt });
  },
  async delete(key) { _mem.delete(key); },
  async list(opts) {
    const prefix = opts?.prefix || "";
    const keys = [...(_mem.keys())]
      .filter((k) => k.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  },
};

// ----- Cloudflare REST API adapter -----
type CfCreds = { accountId: string; namespaceId: string; token: string };

function readCfCreds(): CfCreds | null {
  // Pull from runtime overrides (set via /admin/settings) or env.
  let accountId = "";
  let namespaceId = "";
  let token = "";
  try {
    // Lazy require to avoid circular imports during early bootstrap.
    // telegram.server keeps a sync cache populated by save/load of runtime overrides.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getOverrideSync } = require("./telegram.server") as typeof import("./telegram.server");
    accountId = getOverrideSync("CLOUDFLARE_ACCOUNT_ID");
    namespaceId = getOverrideSync("CLOUDFLARE_KV_NAMESPACE_ID");
    token = getOverrideSync("CLOUDFLARE_API_TOKEN");
  } catch {
    // ignore — fall through to env
  }
  accountId = accountId || process.env.CLOUDFLARE_ACCOUNT_ID || "";
  namespaceId = namespaceId || process.env.CLOUDFLARE_KV_NAMESPACE_ID || "";
  token = token || process.env.CLOUDFLARE_API_TOKEN || "";
  if (!accountId || !namespaceId || !token) return null;
  return { accountId: accountId.trim(), namespaceId: namespaceId.trim(), token: token.trim() };
}

function cfBase(c: CfCreds) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(c.accountId)}/storage/kv/namespaces/${encodeURIComponent(c.namespaceId)}`;
}

function cfHeaders(c: CfCreds, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${c.token}`, ...extra };
}

function makeCfKV(c: CfCreds): KVNamespaceLike {
  return {
    async get(key, type) {
      const res = await fetch(`${cfBase(c)}/values/${encodeURIComponent(key)}`, {
        method: "GET",
        headers: cfHeaders(c),
      });
      if (res.status === 404) return null;
      if (!res.ok) {
        console.warn("cfKV.get failed", key, res.status);
        return null;
      }
      const text = await res.text();
      if (type === "json") {
        try { return JSON.parse(text); } catch { return null; }
      }
      return text;
    },
    async put(key, value, opts) {
      const qs = opts?.expirationTtl ? `?expiration_ttl=${opts.expirationTtl}` : "";
      const res = await fetch(`${cfBase(c)}/values/${encodeURIComponent(key)}${qs}`, {
        method: "PUT",
        headers: cfHeaders(c, { "Content-Type": "text/plain" }),
        body: value,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn("cfKV.put failed", key, res.status, body);
      }
    },
    async delete(key) {
      const res = await fetch(`${cfBase(c)}/values/${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: cfHeaders(c),
      });
      if (!res.ok && res.status !== 404) {
        console.warn("cfKV.delete failed", key, res.status);
      }
    },
    async list(opts) {
      const params = new URLSearchParams();
      if (opts?.prefix) params.set("prefix", opts.prefix);
      if (opts?.limit) params.set("limit", String(opts.limit));
      if (opts?.cursor) params.set("cursor", opts.cursor);
      const res = await fetch(`${cfBase(c)}/keys?${params.toString()}`, {
        method: "GET",
        headers: cfHeaders(c),
      });
      if (!res.ok) return { keys: [], list_complete: true };
      const data: any = await res.json().catch(() => ({}));
      return {
        keys: (data?.result || []).map((k: any) => ({ name: k.name, expiration: k.expiration })),
        list_complete: !data?.result_info?.cursor,
        cursor: data?.result_info?.cursor,
      };
    },
  };
}

// ----- binding resolver -----
export function kv(): KVNamespaceLike {
  // 1) Cloudflare REST API takes priority — fully dynamic, controlled from admin UI.
  const creds = readCfCreds();
  if (creds) return makeCfKV(creds);
  // 2) Native binding (post-export deployments).
  const g = globalThis as any;
  const fromReq = g.__AMW_ENV?.AMW_KV;
  if (fromReq && typeof fromReq.get === "function") return fromReq as KVNamespaceLike;
  if (g.AMW_KV && typeof g.AMW_KV.get === "function") return g.AMW_KV as KVNamespaceLike;
  // 3) In-memory fallback.
  return memoryKV;
}

export function kvHasRealBinding(): boolean {
  if (readCfCreds()) return true;
  const g = globalThis as any;
  return !!(g.__AMW_ENV?.AMW_KV || g.AMW_KV);
}

/** Which backend is currently active — useful for diagnostics. */
export function kvBackend(): "cloudflare-rest" | "binding" | "memory" {
  if (readCfCreds()) return "cloudflare-rest";
  const g = globalThis as any;
  if (g.__AMW_ENV?.AMW_KV || g.AMW_KV) return "binding";
  return "memory";
}

// ----- typed helpers -----
export async function kvGetJSON<T = any>(key: string): Promise<T | null> {
  try { return (await kv().get(key, "json")) as T | null; }
  catch { return null; }
}

export async function kvPutJSON(key: string, value: any, ttlSeconds?: number) {
  try { await kv().put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined); }
  catch (e) { console.warn("kv.put failed", key, e); }
}

export async function kvDel(key: string) {
  try { await kv().delete(key); } catch {}
}

// ============================================================
// OTP helpers — 6-digit codes keyed by phone, with cooldown.
// ============================================================
const OTP_KEY = (phone: string) => `otp:${phone}`;
const OTP_COOLDOWN_KEY = (phone: string) => `otp_cd:${phone}`;
const OTP_TTL_SECONDS = 10 * 60; // 10 min validity
const OTP_COOLDOWN_SECONDS = 60; // 60s between sends

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** Returns { ok, retryAfter } — retryAfter in seconds when still in cooldown. */
export async function startOtp(phone: string): Promise<{ ok: true; code: string } | { ok: false; retryAfter: number }> {
  const cd = await kv().get(OTP_COOLDOWN_KEY(phone), "text");
  if (cd) {
    const until = Number(cd) || 0;
    const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    if (remaining > 0) return { ok: false, retryAfter: remaining };
  }
  const code = generateOtp();
  await kvPutJSON(OTP_KEY(phone), { code, createdAt: Date.now() }, OTP_TTL_SECONDS);
  await kv().put(OTP_COOLDOWN_KEY(phone), String(Date.now() + OTP_COOLDOWN_SECONDS * 1000), {
    expirationTtl: OTP_COOLDOWN_SECONDS,
  });
  return { ok: true, code };
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const rec = await kvGetJSON<{ code: string }>(OTP_KEY(phone));
  if (!rec || rec.code !== String(code).trim()) return false;
  await kvDel(OTP_KEY(phone));
  return true;
}
