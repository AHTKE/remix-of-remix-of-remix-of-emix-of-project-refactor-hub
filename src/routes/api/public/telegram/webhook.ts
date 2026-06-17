import { createFileRoute } from "@tanstack/react-router";
import { createHash, timingSafeEqual } from "crypto";

async function expectedSecret() {
  const { getRuntimeSettings } = await import("@/lib/repo.server");
  let runtime: Record<string, string> = {};
  try { runtime = await getRuntimeSettings(); } catch {}
  const token = String(runtime.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "")
    .trim()
    .replace(/^['\"]+|['\"]+$/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim();
  if (!token) return "";
  return createHash("sha256").update("telegram-webhook:" + token).digest("base64url");
}

function safeEq(a: string, b: string) {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export const Route = createFileRoute("/api/public/telegram/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const hdr = request.headers.get("x-telegram-bot-api-secret-token") || "";
        const expected = await expectedSecret();
        if (!expected) return new Response("Telegram bot token is not configured", { status: 503 });
        if (!safeEq(hdr, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }
        const update = await request.json();
        try {
          const { handleUpdate } = await import("@/lib/bot-handler.server");
          await handleUpdate(update);
        } catch (e) {
          console.error("Webhook handler error", e);
        }
        return Response.json({ ok: true });
      },
      GET: async () => new Response("Telegram webhook endpoint", { status: 200 }),
    },
  },
});
