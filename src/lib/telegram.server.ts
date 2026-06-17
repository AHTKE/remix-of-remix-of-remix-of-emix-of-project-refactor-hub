import type { BotData, IndexState } from "./types";
import { DEFAULT_DATA } from "./types";

const API = "https://api.telegram.org/bot";

// In-memory cache of secret overrides, populated lazily by tg() / token().
// Avoids circular dep with repo.server (which itself calls tg()).
let _overrideCache: Record<string, string> = {};
let _overrideAt = 0;
let _overrideLoading = false;
const OVERRIDE_TTL = 15_000;

async function loadOverrides() {
  if (Date.now() - _overrideAt < OVERRIDE_TTL) return _overrideCache;
  if (_overrideLoading) return _overrideCache;
  _overrideLoading = true;
  _overrideAt = Date.now(); // prevent re-entrancy from nested tg() calls
  try {
    const { getRuntimeSettings } = await import("./repo.server");
    _overrideCache = await getRuntimeSettings();
  } catch {
    // ignore — token() will fall back to env
  } finally {
    _overrideLoading = false;
  }
  return _overrideCache;
}

export function getOverrideSync(key: string): string {
  return _overrideCache[key] || "";
}

export function setRuntimeOverridesSync(patch: Record<string, string | null | undefined>) {
  _overrideCache = { ..._overrideCache };
  for (const [key, value] of Object.entries(patch)) {
    const normalized = normalizeSecretValue(value == null ? "" : String(value));
    if (normalized) _overrideCache[key] = normalized;
  }
  _overrideAt = Date.now();
}

export async function ensureOverridesLoaded() {
  return loadOverrides();
}

function token() {
  const t = normalizeSecretValue(_overrideCache.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN).replace(/^bot/i, "");
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN غير معرّف");
  return t;
}

function normalizeDigits(value: string) {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const easternArabic = "۰۱۲۳۴۵۶۷۸۹";
  return value
    .replace(/[٠-٩]/g, (d) => String(arabicIndic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternArabic.indexOf(d)))
    .replace(/[−–—]/g, "-");
}

function normalizeSecretValue(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/^['\"]+|['\"]+$/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim();
}

export function getTelegramDataChannelId() {
  return normalizeDigits(
    normalizeSecretValue(_overrideCache.TELEGRAM_DATA_CHANNEL_ID || process.env.TELEGRAM_DATA_CHANNEL_ID),
  );
}

/** Media channel (CDN) — falls back to data channel if not configured */
export function getTelegramMediaChannelId() {
  const v = normalizeDigits(
    normalizeSecretValue(_overrideCache.TELEGRAM_MEDIA_CHANNEL_ID || process.env.TELEGRAM_MEDIA_CHANNEL_ID),
  );
  return v || getTelegramDataChannelId();
}

export function isNegativeNumericChatId(raw = getTelegramDataChannelId()) {
  return /^-\d{5,}$/.test(normalizeDigits(normalizeSecretValue(String(raw))));
}

export function normalizeTelegramChatId(raw: string) {
  const value = normalizeSecretValue(String(raw || ""));
  if (!value) throw new Error("TELEGRAM_DATA_CHANNEL_ID غير معرّف");

  const cleaned = normalizeDigits(value)
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, "")
    .replace(/^tg:\/\/resolve\?domain=/i, "")
    .replace(/^\/+/, "")
    .replace(/^c\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\s+/g, "")
    .trim();

  if (/^-100\d{5,}$/.test(cleaned)) return cleaned;
  if (/^100\d{5,}$/.test(cleaned)) return `-${cleaned}`;
  if (/^\d{7,}$/.test(cleaned)) return `-100${cleaned}`;
  if (/^-?\d+$/.test(cleaned)) return cleaned;
  if (cleaned.startsWith("@")) return cleaned;
  if (/^[A-Za-z0-9_]{5,32}$/.test(cleaned)) return `@${cleaned}`;
  return cleaned;
}

function telegramHint(method: string, description: string) {
  const msg = description.toLowerCase();
  if (msg.includes("chat not found") || msg.includes("not enough rights") || msg.includes("forbidden")) {
    return `\nتأكد أن TELEGRAM_DATA_CHANNEL_ID رقمي صحيح ويبدأ بـ -100، وأن نفس البوت الموجود في TELEGRAM_BOT_TOKEN مضاف كأدمن في القناة بصلاحيات إرسال/تعديل/تثبيت الرسائل.`;
  }
  if (method === "sendMessage" && msg.includes("bad request")) {
    return `\nفشل الحفظ داخل قناة البيانات. غالبًا Channel ID غير صحيح أو البوت ليس أدمن.`;
  }
  return "";
}

function channelId() {
  return normalizeTelegramChatId(getTelegramDataChannelId());
}

function mediaChannelId() {
  return normalizeTelegramChatId(getTelegramMediaChannelId());
}

export function getForcedTelegramDataChannelId() {
  const raw = getTelegramDataChannelId();
  return raw ? normalizeTelegramChatId(raw) : "";
}

// ============================================================
// Low-level Telegram API
// ============================================================

export async function tg<T = any>(method: string, body?: any): Promise<T> {
  // Lazily load runtime overrides (token/admin password/etc) before each request.
  // Skipped if token() already works from env, but the fetch is cheap (cached).
  if (Date.now() - _overrideAt > OVERRIDE_TTL) {
    try { await loadOverrides(); } catch {}
  }
  const res = await fetch(`${API}${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ ok: false, description: String(res.status) }));
  if (!json.ok) {
    const description = json.description || String(res.status);
    throw new Error(`Telegram ${method} failed: ${description}${telegramHint(method, description)}`);
  }
  return json.result as T;
}

export async function tgUpload(method: string, form: FormData): Promise<any> {
  if (Date.now() - _overrideAt > OVERRIDE_TTL) {
    try { await loadOverrides(); } catch {}
  }
  const res = await fetch(`${API}${token()}/${method}`, { method: "POST", body: form });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result;
}

// ============================================================
// PROTECTED send helpers — all student-facing media uses protect_content=true
// ============================================================

export async function sendProtected(method: string, params: Record<string, any>) {
  return tg(method, { ...params, protect_content: true });
}

// ============================================================
// MEDIA channel upload (CDN tier)
// Supports: photo / video / document (PDF, ZIP, etc.) / audio
// ============================================================

export type UploadedMedia = {
  kind: "photo" | "video" | "document" | "audio";
  file_id: string;
  file_name?: string;
  size_bytes?: number;
  mime?: string;
};

export async function uploadMediaToChannel(
  file: File,
  kindHint?: "photo" | "video" | "document" | "audio"
): Promise<UploadedMedia> {
  const chatId = mediaChannelId();
  const mime = (file.type || "").toLowerCase();
  const name = file.name || "file";

  const kind: UploadedMedia["kind"] =
    kindHint ||
    (mime.startsWith("image/")
      ? "photo"
      : mime.startsWith("video/")
      ? "video"
      : mime.startsWith("audio/")
      ? "audio"
      : "document");

  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("disable_notification", "true");

  const method =
    kind === "photo"
      ? "sendPhoto"
      : kind === "video"
      ? "sendVideo"
      : kind === "audio"
      ? "sendAudio"
      : "sendDocument";

  form.set(kind, file, name);

  const msg = await tgUpload(method, form);

  let file_id: string;
  if (kind === "photo") {
    const photos = msg.photo as Array<{ file_id: string; file_size?: number }>;
    file_id = photos[photos.length - 1].file_id;
  } else if (kind === "video") {
    file_id = msg.video.file_id;
  } else if (kind === "audio") {
    file_id = msg.audio.file_id;
  } else {
    file_id = msg.document.file_id;
  }

  return {
    kind,
    file_id,
    file_name: name,
    size_bytes: file.size,
    mime,
  };
}

// ============================================================
// LEGACY single-message FAQ index (kept for migration / read)
// New collection-based storage lives in repo.server.ts
// ============================================================

const HEADER = "BOT_INDEX_V1\n";

export async function loadIndex(): Promise<IndexState> {
  const chatId = channelId();
  try {
    const chat = await tg<any>("getChat", { chat_id: chatId });
    const pinned = chat.pinned_message;
    if (pinned && typeof pinned.text === "string" && pinned.text.startsWith(HEADER)) {
      const json = pinned.text.slice(HEADER.length);
      try {
        const data = JSON.parse(json) as BotData;
        return { index_message_id: pinned.message_id, data };
      } catch {
        /* fall through */
      }
    }
  } catch (e) {
    console.error("loadIndex getChat error", e);
  }
  return { index_message_id: null, data: DEFAULT_DATA };
}

export async function saveIndex(data: BotData): Promise<IndexState> {
  const chatId = channelId();
  data.updated_at = new Date().toISOString();
  const text = HEADER + JSON.stringify(data);
  if (text.length > 4000) {
    throw new Error(
      `حجم بيانات الـ FAQ (${text.length} حرف) تجاوز الحد. استخدم قسم الكورسات بدلاً منه.`
    );
  }
  const current = await loadIndex();
  if (current.index_message_id) {
    try {
      await tg("editMessageText", {
        chat_id: chatId,
        message_id: current.index_message_id,
        text,
      });
      return { index_message_id: current.index_message_id, data };
    } catch (e: any) {
      if (!String(e.message).includes("message to edit not found")) throw e;
    }
  }
  const msg = await tg<any>("sendMessage", {
    chat_id: chatId,
    text,
    disable_notification: true,
  });
  try {
    await tg("pinChatMessage", {
      chat_id: chatId,
      message_id: msg.message_id,
      disable_notification: true,
    });
  } catch (e) {
    console.warn("pinChatMessage failed", e);
  }
  return { index_message_id: msg.message_id, data };
}

export { channelId as dataChannelId, mediaChannelId };

// ============================================================
// Fetch a Telegram file as a streaming Response (for /api/public/media proxy)
// ============================================================
export async function fetchTelegramFile(fileId: string): Promise<Response> {
  await ensureOverridesLoaded();
  const info = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!info.file_path) throw new Error("file_path not returned by Telegram");
  const url = `https://api.telegram.org/file/bot${token()}/${info.file_path}`;
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Telegram file fetch failed: ${upstream.status}`);
  }
  // Guess content-type from extension
  const ext = info.file_path.split(".").pop()?.toLowerCase() || "";
  const ctMap: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav",
    pdf: "application/pdf", zip: "application/zip",
  };
  const contentType = upstream.headers.get("content-type") || ctMap[ext] || "application/octet-stream";
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400, immutable",
      "content-length": String(info.file_size || upstream.headers.get("content-length") || ""),
    },
  });
}

// ============================================================
// Secondary "Auth & Notifications" bot — used for OTP delivery and
// transactional alerts. Falls back to the main bot when not configured.
// ============================================================

function authBotToken() {
  const t = normalizeSecretValue(
    _overrideCache.TELEGRAM_AUTH_BOT_TOKEN || process.env.TELEGRAM_AUTH_BOT_TOKEN,
  ).replace(/^bot/i, "");
  return t || "";
}

export function getAuthChatId(): string {
  return normalizeDigits(
    normalizeSecretValue(_overrideCache.TELEGRAM_AUTH_CHAT_ID || process.env.TELEGRAM_AUTH_CHAT_ID),
  );
}

export function hasAuthBotConfigured(): boolean {
  return !!authBotToken();
}

/** Send a message via the auth bot if configured, else via the main bot. */
export async function sendAuthMessage(chatId: string | number, text: string, extra: Record<string, any> = {}) {
  try {
    // Always refresh overrides so the auth bot picks up new tokens from KV instantly.
    await loadOverrides();
  } catch (e) {
    console.error("[auth-bot] loadOverrides failed", e);
  }
  const authToken = authBotToken();
  if (!authToken) {
    console.warn("[auth-bot] TELEGRAM_AUTH_BOT_TOKEN not set — falling back to main bot");
    try {
      return await tg("sendMessage", { chat_id: chatId, text, ...extra });
    } catch (e: any) {
      console.error(`[auth-bot] main-bot fallback sendMessage failed chat=${chatId}:`, e?.message || e);
      throw e;
    }
  }
  try {
    const res = await fetch(`${API}${authToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...extra }),
    });
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (!json.ok) {
      console.error(`[auth-bot] sendMessage failed status=${res.status} chat=${chatId} desc=${json.description}`);
      throw new Error(`Auth bot sendMessage failed: ${json.description}`);
    }
    return json.result;
  } catch (e: any) {
    console.error(`[auth-bot] network/transport error chat=${chatId}:`, e?.message || e);
    throw e;
  }
}

