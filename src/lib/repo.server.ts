// ============================================================
// Telegram-as-Database — multi-message collection store
// ============================================================
// Architecture:
//   • One PINNED "master index" message in DATA channel containing
//     { schema_version, collections: { name: [message_id, ...] } }.
//   • Each collection persisted as 1+ chunk messages. Each chunk holds
//     a JSON array slice. Header: `LMS_COL:<name>:<seq>\n<json>`.
//   • Writes: chunk → edit existing messages in place (atomic per chunk),
//     append new ones if collection grew, delete tail if it shrank,
//     then edit master index pointing to the new layout.
//   • In-memory cache per collection with TTL invalidation on write.
// ============================================================

import { tg, dataChannelId } from "./telegram.server";
import { kvGetJSON, kvPutJSON, kvDel, kvHasRealBinding } from "./kv.server";

const KV_COL = (name: string) => `col:${name}`;
const KV_COL_TTL = 24 * 60 * 60; // 24h — Telegram remains source of truth

const SCHEMA_VERSION = 1;
const INDEX_HEADER = "LMS_INDEX_V1\n";
const COL_PREFIX = "LMS_COL:";
const MAX_CHUNK_CHARS = 3500; // leave room for header + Telegram 4096 cap
// Short TTL so reads after cross-isolate writes (bot worker → web worker)
// don't show stale data for several minutes. Writes still invalidate explicitly.
const CACHE_TTL_MS = 15_000;
// Per-chunk cache by Telegram message_id. Each chunk is read once per worker
// lifetime (Telegram fwd+delete is expensive) and reused until a write
// updates the chunk and we invalidate by id.
const _chunkCache = new Map<number, any[]>();

type MasterIndex = {
  schema_version: number;
  collections: Record<string, number[]>; // collection name → ordered message_ids
  settings?: Record<string, string>;    // runtime-overridable secrets (TOKEN/PASSWORD/SESSION)
  updated_at: string;
};

type IndexLocation = {
  message_id: number | null;
  index: MasterIndex;
};

// ---------- module-level cache ----------
let _indexCache: IndexLocation | null = null;
let _indexFetchedAt = 0;
const _colCache = new Map<string, { items: any[]; at: number }>();

function emptyIndex(): MasterIndex {
  return { schema_version: SCHEMA_VERSION, collections: {}, settings: {}, updated_at: new Date(0).toISOString() };
}

// ---------- master index load/save ----------
async function loadMasterIndex(force = false): Promise<IndexLocation> {
  if (!force && _indexCache && Date.now() - _indexFetchedAt < CACHE_TTL_MS) {
    return _indexCache;
  }
  const chatId = dataChannelId();
  try {
    const chat = await tg<any>("getChat", { chat_id: chatId });
    const pinned = chat.pinned_message;
    if (pinned && typeof pinned.text === "string" && pinned.text.startsWith(INDEX_HEADER)) {
      try {
        const idx = JSON.parse(pinned.text.slice(INDEX_HEADER.length)) as MasterIndex;
        if (!idx.collections) idx.collections = {};
        _indexCache = { message_id: pinned.message_id, index: idx };
        _indexFetchedAt = Date.now();
        return _indexCache;
      } catch {
        /* fall through */
      }
    }
    // Try to look for any LMS_INDEX_V1 in recent admin messages — but Telegram
    // doesn't allow chat history fetch for bots; rely on pinned message only.
  } catch (e) {
    console.warn("loadMasterIndex: getChat failed", e);
  }
  _indexCache = { message_id: null, index: emptyIndex() };
  _indexFetchedAt = Date.now();
  return _indexCache;
}

async function saveMasterIndex(loc: IndexLocation) {
  const chatId = dataChannelId();
  loc.index.updated_at = new Date().toISOString();
  loc.index.schema_version = SCHEMA_VERSION;
  const text = INDEX_HEADER + JSON.stringify(loc.index);

  if (loc.message_id) {
    try {
      await tg("editMessageText", { chat_id: chatId, message_id: loc.message_id, text });
      _indexCache = loc;
      _indexFetchedAt = Date.now();
      return loc;
    } catch (e: any) {
      if (String(e.message).includes("message is not modified")) {
        _indexCache = loc;
        _indexFetchedAt = Date.now();
        return loc;
      }
      if (!String(e.message).includes("message to edit not found")) throw e;
    }
  }
  const msg = await tg<any>("sendMessage", { chat_id: chatId, text, disable_notification: true });
  try {
    await tg("pinChatMessage", { chat_id: chatId, message_id: msg.message_id, disable_notification: true });
  } catch (e) {
    console.warn("pinChatMessage(masterIndex) failed", e);
  }
  loc.message_id = msg.message_id;
  _indexCache = loc;
  _indexFetchedAt = Date.now();
  return loc;
}

// ---------- chunk message helpers ----------
function chunkHeader(name: string, seq: number) {
  return `${COL_PREFIX}${name}:${seq}\n`;
}

async function readChunk(message_id: number): Promise<any[] | null> {
  const chatId = dataChannelId();
  try {
    // Telegram bots cannot read arbitrary historic messages directly.
    // Workaround: forwardMessage to ourselves (the channel) to read text.
    // Simpler: use `copyMessage` returns only message_id, not content.
    // Best portable approach: use `editMessageText` "no-op" detection won't return text.
    // We rely on a side-channel: store the JSON also via a getChat call when the
    // chunk is the pinned message — which it isn't.
    //
    // Pragmatic workaround used here: fetch the chunk by forwarding it to the
    // same channel with `disable_notification` and reading the resulting message
    // via the side-effect (Telegram returns the forwarded message including .text).
    const fwd = await tg<any>("forwardMessage", {
      chat_id: chatId,
      from_chat_id: chatId,
      message_id,
      disable_notification: true,
    });
    const text: string = fwd.text || "";
    // Immediately delete the forward to avoid clutter
    tg("deleteMessage", { chat_id: chatId, message_id: fwd.message_id }).catch(() => {});
    const newlineIdx = text.indexOf("\n");
    if (newlineIdx < 0) return null;
    const body = text.slice(newlineIdx + 1);
    try {
      const parsed = JSON.parse(body);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return null;
    }
  } catch (e) {
    console.warn("readChunk failed for", message_id, e);
    return null;
  }
}

function splitIntoChunks(name: string, items: any[]): string[] {
  // Greedy pack as JSON arrays under MAX_CHUNK_CHARS (incl. header).
  const out: string[] = [];
  let current: any[] = [];
  let currentLen = chunkHeader(name, 0).length + 2; // "[]"
  for (const it of items) {
    const serialized = JSON.stringify(it);
    const add = serialized.length + (current.length ? 1 : 0); // comma
    if (currentLen + add > MAX_CHUNK_CHARS && current.length > 0) {
      out.push(chunkHeader(name, out.length) + JSON.stringify(current));
      current = [];
      currentLen = chunkHeader(name, out.length).length + 2;
    }
    current.push(it);
    currentLen += add;
  }
  out.push(chunkHeader(name, out.length) + JSON.stringify(current));
  return out;
}

// ---------- public collection API ----------

export async function getCollection<T = any>(name: string): Promise<T[]> {
  const cached = _colCache.get(name);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.items as T[];

  const loc = await loadMasterIndex();
  const ids = loc.index.collections[name] || [];
  // Parallel chunk reads with per-chunk cache so we avoid a Telegram
  // fwd+delete round-trip whenever the chunk content is already cached.
  const chunks = await Promise.all(
    ids.map(async (id) => {
      const c = _chunkCache.get(id);
      if (c) return c;
      const fresh = (await readChunk(id)) || [];
      _chunkCache.set(id, fresh);
      return fresh;
    }),
  );
  const items: T[] = [];
  for (const arr of chunks) items.push(...(arr as T[]));
  _colCache.set(name, { items: items as any[], at: Date.now() });
  return items;
}

export async function getCollectionFresh<T = any>(name: string): Promise<T[]> {
  _colCache.delete(name);
  const loc = await loadMasterIndex(true);
  const ids = loc.index.collections[name] || [];
  const chunks = await Promise.all(
    ids.map(async (id) => {
      const fresh = (await readChunk(id)) || [];
      _chunkCache.set(id, fresh);
      return fresh;
    }),
  );
  const items: T[] = [];
  for (const arr of chunks) items.push(...(arr as T[]));
  _colCache.set(name, { items: items as any[], at: Date.now() });
  return items;
}

export async function setCollection<T = any>(name: string, items: T[]): Promise<void> {
  const chatId = dataChannelId();
  const loc = await loadMasterIndex(true);
  const existingIds = [...(loc.index.collections[name] || [])];
  const chunks = splitIntoChunks(name, items as any[]);

  const newIds: number[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    const existingId = existingIds[i];
    if (existingId) {
      try {
        await tg("editMessageText", { chat_id: chatId, message_id: existingId, text });
        newIds.push(existingId);
        // refresh chunk cache for this id
        try { _chunkCache.set(existingId, JSON.parse(text.slice(text.indexOf("\n") + 1))); } catch { _chunkCache.delete(existingId); }
        continue;
      } catch (e: any) {
        if (String(e.message).includes("message is not modified")) {
          newIds.push(existingId);
          try { _chunkCache.set(existingId, JSON.parse(text.slice(text.indexOf("\n") + 1))); } catch { _chunkCache.delete(existingId); }
          continue;
        }
        if (!String(e.message).includes("message to edit not found")) throw e;
        // fall through to send new
      }
    }
    const msg = await tg<any>("sendMessage", { chat_id: chatId, text, disable_notification: true });
    newIds.push(msg.message_id);
    try { _chunkCache.set(msg.message_id, JSON.parse(text.slice(text.indexOf("\n") + 1))); } catch {}
  }

  // delete tail chunks no longer needed
  for (let i = chunks.length; i < existingIds.length; i++) {
    const oldId = existingIds[i];
    _chunkCache.delete(oldId);
    tg("deleteMessage", { chat_id: chatId, message_id: oldId }).catch(() => {});
  }

  loc.index.collections[name] = newIds;
  await saveMasterIndex(loc);
  _colCache.set(name, { items: items as any[], at: Date.now() });
}

export function invalidateCollection(name: string) {
  _colCache.delete(name);
}

export function invalidateAll() {
  _colCache.clear();
  _chunkCache.clear();
  _indexCache = null;
  _indexFetchedAt = 0;
}

// ---------- typed helpers ----------
export async function upsert<T extends { id: string | number }>(name: string, item: T) {
  const items = await getCollection<T>(name);
  const idx = items.findIndex((x) => String(x.id) === String(item.id));
  if (idx >= 0) items[idx] = item;
  else items.push(item);
  await setCollection(name, items);
  return item;
}

export async function removeById<T extends { id: string | number }>(name: string, id: string | number) {
  const items = await getCollection<T>(name);
  const next = items.filter((x) => String(x.id) !== String(id));
  if (next.length !== items.length) await setCollection(name, next);
}

export async function findById<T extends { id: string | number }>(name: string, id: string | number) {
  const items = await getCollection<T>(name);
  return items.find((x) => String(x.id) === String(id)) || null;
}

// ---------- diagnostics ----------
export async function repoDiagnostics() {
  const loc = await loadMasterIndex(true);
  return {
    schema_version: SCHEMA_VERSION,
    master_message_id: loc.message_id,
    updated_at: loc.index.updated_at,
    collections: Object.fromEntries(
      Object.entries(loc.index.collections).map(([k, v]) => [k, { chunks: v.length, message_ids: v }])
    ),
  };
}

// ---------- runtime settings (overrides for secrets) ----------
let _settingsCache: Record<string, string> | null = null;
let _settingsAt = 0;
const SETTINGS_TTL = 15_000;

export async function getRuntimeSettings(force = false): Promise<Record<string, string>> {
  if (!force && _settingsCache && Date.now() - _settingsAt < SETTINGS_TTL) return _settingsCache;
  try {
    const loc = await loadMasterIndex(force);
    _settingsCache = { ...(loc.index.settings || {}) };
  } catch {
    _settingsCache = _settingsCache || {};
  }
  _settingsAt = Date.now();
  return _settingsCache;
}

export function peekRuntimeSettings(): Record<string, string> {
  return _settingsCache || {};
}

export async function setRuntimeSettings(patch: Record<string, string | null | undefined>): Promise<void> {
  const loc = await loadMasterIndex(true);
  const current = { ...(loc.index.settings || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") delete current[k];
    else current[k] = String(v);
  }
  loc.index.settings = current;
  await saveMasterIndex(loc);
  _settingsCache = current;
  _settingsAt = Date.now();
}
