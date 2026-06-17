// ============================================================
// Cloudflare KV adapter — `AMW_KV` binding
// ------------------------------------------------------------
// • At runtime on Cloudflare Workers the binding is reachable via
//   `globalThis.__AMW_ENV.AMW_KV` (populated by src/server.ts on each
//   request) or, when deployed with `nodejs_compat`, via the per-isolate
//   global `AMW_KV`.
// • Inside Lovable's managed preview the binding does NOT exist — every
//   call transparently falls back to an in-memory Map with TTL support
//   so the app keeps working. After `wrangler deploy` the real KV takes
//   over automatically; no code changes required.
// ============================================================

export interface KVNamespaceLike {
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

// ----- binding resolver -----
export function kv(): KVNamespaceLike {
  const g = globalThis as any;
  const fromReq = g.__AMW_ENV?.AMW_KV;
  if (fromReq && typeof fromReq.get === "function") return fromReq as KVNamespaceLike;
  if (g.AMW_KV && typeof g.AMW_KV.get === "function") return g.AMW_KV as KVNamespaceLike;
  return memoryKV;
}

export function kvHasRealBinding(): boolean {
  const g = globalThis as any;
  return !!(g.__AMW_ENV?.AMW_KV || g.AMW_KV);
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
