import { createFileRoute } from "@tanstack/react-router";

// In-memory cache of file_id → { file_path, file_size } to avoid hitting
// Telegram getFile on every request (e.g. each video Range chunk).
const PATH_CACHE = new Map<string, { file_path: string; file_size?: number; at: number }>();
const PATH_TTL = 50 * 60 * 1000; // Telegram file_path is valid ~1h

const CT_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mkv: "video/x-matroska", mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg",
  wav: "audio/wav", pdf: "application/pdf", zip: "application/zip",
};

function contentDispositionName(path: string) {
  const name = path.split("/").pop() || "media";
  return `inline; filename="${name.replace(/["\\]/g, "_")}"`;
}

export const Route = createFileRoute("/api/public/media/$fileId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const { tg, ensureOverridesLoaded, getTelegramBotToken } = await import("@/lib/telegram.server");

          let entry = PATH_CACHE.get(params.fileId);
          if (!entry || Date.now() - entry.at > PATH_TTL) {
            await ensureOverridesLoaded();
            const info = await tg<{ file_path?: string; file_size?: number }>(
              "getFile",
              { file_id: params.fileId },
            );
            if (!info.file_path) throw new Error("file_path missing");
            entry = { file_path: info.file_path, file_size: info.file_size, at: Date.now() };
            PATH_CACHE.set(params.fileId, entry);
          }

          const url = `https://api.telegram.org/file/bot${getTelegramBotToken()}/${entry.file_path}`;
          const range = request.headers.get("range");
          const upstreamHeaders: Record<string, string> = {};
          if (range) upstreamHeaders["range"] = range;

          const upstream = await fetch(url, { headers: upstreamHeaders });
          if (!upstream.ok && upstream.status !== 206) {
            // file_path may have expired — purge and retry once
            PATH_CACHE.delete(params.fileId);
            const fresh = await tg<{ file_path?: string; file_size?: number }>(
              "getFile",
              { file_id: params.fileId },
            );
            if (!fresh.file_path) throw new Error("file_path missing");
            entry = { file_path: fresh.file_path, file_size: fresh.file_size, at: Date.now() };
            PATH_CACHE.set(params.fileId, entry);
            const retry = await fetch(`https://api.telegram.org/file/bot${getTelegramBotToken()}/${entry.file_path}`, { headers: upstreamHeaders });
            if (!retry.ok && retry.status !== 206) return new Response(`Upstream ${retry.status}`, { status: 502 });
            const headers = new Headers();
            const retryExt = entry.file_path.split(".").pop()?.toLowerCase() || "";
            headers.set("content-type", retry.headers.get("content-type") || CT_MAP[retryExt] || "application/octet-stream");
            headers.set("accept-ranges", "bytes");
            headers.set("cache-control", "public, max-age=86400, immutable");
            headers.set("content-disposition", contentDispositionName(entry.file_path));
            headers.set("x-content-type-options", "nosniff");
            const retryCl = retry.headers.get("content-length");
            if (retryCl) headers.set("content-length", retryCl);
            const retryCr = retry.headers.get("content-range");
            if (retryCr) headers.set("content-range", retryCr);
            return new Response(retry.body, { status: retry.status, headers });
          }

          const ext = entry.file_path.split(".").pop()?.toLowerCase() || "";
          const kindHint = new URL(request.url).searchParams.get("kind");
          const upstreamType = upstream.headers.get("content-type") || "";
          const contentType =
            (kindHint === "video" && (!upstreamType || upstreamType === "application/octet-stream")
              ? "video/mp4"
              : upstreamType) || CT_MAP[ext] || "application/octet-stream";

          const headers = new Headers();
          headers.set("content-type", contentType);
          headers.set("accept-ranges", "bytes");
          headers.set("cache-control", "public, max-age=86400, immutable");
          headers.set("content-disposition", contentDispositionName(entry.file_path));
          headers.set("x-content-type-options", "nosniff");
          const cl = upstream.headers.get("content-length");
          if (cl) headers.set("content-length", cl);
          const cr = upstream.headers.get("content-range");
          if (cr) headers.set("content-range", cr);

          return new Response(upstream.body, {
            status: upstream.status,
            headers,
          });
        } catch (e: any) {
          return new Response(`Media error: ${e?.message || e}`, { status: 404 });
        }
      },
    },
  },
});
