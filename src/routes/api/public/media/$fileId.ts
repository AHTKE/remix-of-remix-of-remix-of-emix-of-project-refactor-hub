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

export const Route = createFileRoute("/api/public/media/$fileId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        try {
          const { tg, ensureOverridesLoaded } = await import("@/lib/telegram.server");

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

          const token = (process.env.TELEGRAM_BOT_TOKEN || "")
            .trim()
            .replace(/^bot/i, "");
          // Pull token from runtime overrides if env is unset
          const finalToken = token || (await (async () => {
            const { getRuntimeSettings } = await import("@/lib/repo.server");
            const rs = await getRuntimeSettings();
            return String(rs.TELEGRAM_BOT_TOKEN || "").trim().replace(/^bot/i, "");
          })());

          const url = `https://api.telegram.org/file/bot${finalToken}/${entry.file_path}`;
          const range = request.headers.get("range");
          const upstreamHeaders: Record<string, string> = {};
          if (range) upstreamHeaders["range"] = range;

          const upstream = await fetch(url, { headers: upstreamHeaders });
          if (!upstream.ok && upstream.status !== 206) {
            // file_path may have expired — purge and retry once
            PATH_CACHE.delete(params.fileId);
            return new Response(`Upstream ${upstream.status}`, { status: 502 });
          }

          const ext = entry.file_path.split(".").pop()?.toLowerCase() || "";
          const contentType =
            upstream.headers.get("content-type") || CT_MAP[ext] || "application/octet-stream";

          const headers = new Headers();
          headers.set("content-type", contentType);
          headers.set("accept-ranges", "bytes");
          headers.set("cache-control", "public, max-age=86400, immutable");
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
