import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, getRequest, getRequestHost, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { DEFAULT_DATA } from "./types";
import type { Attempt, BotData, Course, Homework, Lesson, LessonResource, Poll, Question, Quiz, Student, Vote, Voucher, VoucherBatch } from "./types";

const ADMIN_COOKIE = "amw_admin_session";
const TELEGRAM_WEBHOOK_PATH = "/api/public/telegram/webhook";
const DEFAULT_PROJECT_HOST = "project--632efead-8c0b-47a7-a10f-48874870ac9c-dev.lovable.app";

function normalizeHost(raw?: string | null) {
  const value = String(raw || "").trim();
  if (!value) return "";
  const host = value
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .trim();
  if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) return "";
  return host;
}

function toStableProjectHost(raw?: string | null) {
  let hostname = normalizeHost(raw);
  if (!hostname) return "";
  const previewMatch = hostname.match(/^id-preview--([a-f0-9-]{36})\.(.+)$/);
  if (previewMatch) hostname = `project--${previewMatch[1]}-dev.${previewMatch[2]}`;
  const legacyPreviewMatch = hostname.match(/^([a-f0-9-]{36})\.lovableproject\.com$/);
  if (legacyPreviewMatch) hostname = `project--${legacyPreviewMatch[1]}-dev.lovable.app`;
  return hostname;
}

function getIncomingHost() {
  const request = getRequest();
  return (
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    getRequestHost() ||
    ""
  );
}

function toStableWebhookUrl(candidateUrl?: string) {
  const candidateHost = candidateUrl ? toStableProjectHost(new URL(candidateUrl).host) : "";
  const requestHost = toStableProjectHost(getIncomingHost());
  const hostname = candidateHost || requestHost || DEFAULT_PROJECT_HOST;
  if (!hostname) throw new Error("تعذر تحديد رابط الـ Webhook الحالي");
  if (hostname.includes("id-preview--") || hostname.includes("lovableproject.com")) {
    throw new Error("رابط المعاينة الحالي مؤقت. افتح رابط project--...-dev ثم فعّل الربط.");
  }
  return `https://${hostname}${TELEGRAM_WEBHOOK_PATH}`;
}

async function deriveWebhookSecret() {
  const { createHash } = await import("crypto");
  const { getRuntimeSettings } = await import("./repo.server");
  let runtime: Record<string, string> = {};
  try { runtime = await getRuntimeSettings(); } catch {}
  const token = String(runtime.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "")
    .trim()
    .replace(/^['\"]+|['\"]+$/g, "")
    .replace(/[\u200e\u200f\u202a-\u202e]/g, "")
    .trim();
  return createHash("sha256").update("telegram-webhook:" + token).digest("base64url");
}

async function ensureWebhook(webhookUrl: string) {
  const { tg } = await import("./telegram.server");
  const info = await tg<any>("getWebhookInfo").catch(() => null);
  if (info?.url !== webhookUrl) {
    await tg("setWebhook", {
      url: webhookUrl,
      secret_token: await deriveWebhookSecret(),
      allowed_updates: ["message", "callback_query", "poll_answer"],
    });
  }
  return tg<any>("getWebhookInfo");
}

async function ensureTelegramRuntimeReady() {
  return ensureWebhook(toStableWebhookUrl());
}

async function verifyTelegramChannelAccess(kind: "data" | "media") {
  const { getTelegramDataChannelId, getTelegramMediaChannelId, normalizeTelegramChatId, tg } = await import("./telegram.server");
  const raw = kind === "data" ? getTelegramDataChannelId() : getTelegramMediaChannelId();
  const label = kind === "data" ? "TELEGRAM_DATA_CHANNEL_ID" : "TELEGRAM_MEDIA_CHANNEL_ID";
  const chatId = normalizeTelegramChatId(raw);
  const bot = await tg<any>("getMe");
  const chat = await tg<any>("getChat", { chat_id: chatId }).catch((e: any) => {
    throw new Error(`القناة غير متاحة لـ @${bot.username}. ${label}: ${chatId}. السبب: ${e.message}`);
  });
  const member = await tg<any>("getChatMember", { chat_id: chatId, user_id: bot.id }).catch((e: any) => {
    throw new Error(`تعذر التحقق من صلاحيات البوت @${bot.username}: ${e.message}`);
  });
  if (member.status !== "administrator" && member.status !== "creator") {
    throw new Error(`البوت @${bot.username} ليس Admin في القناة. الحالة: ${member.status}`);
  }
  return { chatId, bot, chat, member };
}

async function verifyDataChannelAccess() {
  return verifyTelegramChannelAccess("data");
}

async function verifyMediaChannelAccess() {
  return verifyTelegramChannelAccess("media");
}

function getAdminCookieSecret() {
  // Use env first (synchronous + always available). Runtime overrides for
  // SESSION_SECRET would invalidate existing cookies if rotated mid-session, so
  // we keep cookies signed against env to ensure stability. Admin can rotate by
  // setting env, while runtime overrides still apply to bot/admin password.
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "amw-lms-cookie-secret-v1";
}

async function signValue(value: string) {
  const { createHmac } = await import("crypto");
  return createHmac("sha256", getAdminCookieSecret()).update(value).digest("base64url");
}

async function createAdminCookie() {
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 30;
  const value = String(expires);
  return `${value}.${await signValue(value)}`;
}

async function hasValidAdminCookie() {
  const cookie = getCookie(ADMIN_COOKIE) || "";
  const [expires, signature] = cookie.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  return signature === (await signValue(expires));
}

async function requireAdmin() {
  if (!(await hasValidAdminCookie())) throw new Error("غير مصرح. سجّل دخول أولاً.");
}

// ============================================================
// AUTH
// ============================================================

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ password: z.string() }).parse(d))
  .handler(async ({ data }) => {
    // Ensure runtime overrides are loaded so an admin-set password from the UI
    // takes precedence over the env var.
    const { getRuntimeSettings } = await import("./repo.server");
    let runtime: Record<string, string> = {};
    try { runtime = await getRuntimeSettings(); } catch {}
    const clean = (v?: string | null) =>
      String(v ?? "")
        .replace(/[\u200e\u200f\u202a-\u202e\u200b-\u200d\ufeff]/g, "")
        .trim();
    const expected = clean(runtime.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD);
    const provided = clean(data.password);
    if (!expected) {
      // Bootstrap fallback so the admin can set a password from the UI on first run.
      if (provided !== "admin") {
        throw new Error("ADMIN_PASSWORD غير معرّف. ادخل بكلمة 'admin' مؤقتًا ثم غيّرها فورًا من الإعدادات.");
      }
    } else {
      if (provided !== expected) throw new Error("كلمة المرور غير صحيحة");
    }
    setCookie(ADMIN_COOKIE, await createAdminCookie(), {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(ADMIN_COOKIE, { path: "/" });
  return { ok: true };
});

export const adminStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { isAdmin: await hasValidAdminCookie() };
});

// ============================================================
// LEGACY FAQ (kept working)
// ============================================================

export const getData = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  try {
    const { getCollection } = await import("./repo.server");
    const settings = (await getCollection<Partial<BotData> & { id?: string }>("bot_settings"))[0] || {};
    const questions = await getCollection<Question>("questions");
    return { ...DEFAULT_DATA, ...settings, questions, updated_at: settings.updated_at || DEFAULT_DATA.updated_at };
  } catch {
    return DEFAULT_DATA;
  }
});

const QuestionSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(60),
  answer: z.string().max(3500),
  media: z.array(z.object({ type: z.enum(["photo", "video"]), file_id: z.string() })),
  parent_id: z.string().nullable().optional(),
  order: z.number(),
});

export const saveQuestion = createServerFn({ method: "POST" })
  .inputValidator((d) => QuestionSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const { getCollection, setCollection } = await import("./repo.server");
    const list = await getCollection<Question>("questions");
    const idx = list.findIndex((q) => q.id === data.id);
    if (idx >= 0) list[idx] = data as Question;
    else list.push(data as Question);
    await setCollection("questions", list);
    return { ok: true };
  });

export const deleteQuestion = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const { getCollection, setCollection } = await import("./repo.server");
    const questions = await getCollection<Question>("questions");
    const next = questions.filter(
      (q) => q.id !== data.id && q.parent_id !== data.id
    );
    await setCollection("questions", next);
    return { ok: true };
  });

const SettingsSchema = z.object({
  welcome_text: z.string().max(1000),
  inquiry_text: z.string().max(1000),
});

export const saveSettings = createServerFn({ method: "POST" })
  .inputValidator((d) => SettingsSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const { setCollection } = await import("./repo.server");
    await setCollection("bot_settings", [{ id: "main", ...data, updated_at: new Date().toISOString() }]);
    return { ok: true };
  });

// ============================================================
// MEDIA upload (CDN tier)
// ============================================================

export const uploadMedia = createServerFn({ method: "POST" })
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("FormData مطلوب");
    return d;
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    await ensureTelegramRuntimeReady();
    const file = data.get("file");
    const kindRaw = String(data.get("kind") || "");
    if (!(file instanceof File)) throw new Error("لم يتم إرسال ملف");
    const kindHint = (["photo", "video", "document", "audio"] as const).includes(kindRaw as any)
      ? (kindRaw as any)
      : undefined;
    await verifyMediaChannelAccess();
    const { uploadMediaToChannel } = await import("./telegram.server");
    const uploaded = await uploadMediaToChannel(file, kindHint);
    // Backward compat: also return .type
    return { ...uploaded, type: uploaded.kind };
  });

// ============================================================
// WEBHOOK + DIAGNOSTICS
// ============================================================

export const setupWebhook = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ webhook_url: z.string().url().optional() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const webhookUrl = toStableWebhookUrl(data.webhook_url);
    const info = await ensureWebhook(webhookUrl);
    return { ok: true, webhook_url: webhookUrl, info };
  });

export const testDataChannel = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  await ensureTelegramRuntimeReady();
  const { chatId, bot, member } = await verifyDataChannelAccess();
  const { tg } = await import("./telegram.server");
  const msg = await tg<any>("sendMessage", {
    chat_id: chatId,
    text: `✅ اختبار اتصال قناة البيانات\nالبوت: @${bot.username}\nالحالة: ${member.status}\n${new Date().toISOString()}`,
    disable_notification: true,
  });
  return { ok: true, chat_id: String(chatId), message_id: msg.message_id, bot, member };
});

export const testMediaChannel = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const { chatId, bot, member } = await verifyMediaChannelAccess();
  const { tg } = await import("./telegram.server");
  const msg = await tg<any>("sendMessage", {
    chat_id: chatId,
    text: `✅ اختبار اتصال قناة الوسائط\nالبوت: @${bot.username}\nالحالة: ${member.status}\n${new Date().toISOString()}`,
    disable_notification: true,
  });
  return { ok: true, chat_id: String(chatId), message_id: msg.message_id, bot, member };
});

export const getDiagnostics = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getRuntimeSettings } = await import("./repo.server");
  let runtime: Record<string, string> = {};
  try { runtime = await getRuntimeSettings(true); } catch {}
  const env = {
    TELEGRAM_BOT_TOKEN: !!(runtime.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN),
    TELEGRAM_DATA_CHANNEL_ID: !!(runtime.TELEGRAM_DATA_CHANNEL_ID || process.env.TELEGRAM_DATA_CHANNEL_ID),
    TELEGRAM_MEDIA_CHANNEL_ID: !!(runtime.TELEGRAM_MEDIA_CHANNEL_ID || process.env.TELEGRAM_MEDIA_CHANNEL_ID),
    ADMIN_PASSWORD: !!(runtime.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD),
    SESSION_SECRET: !!(runtime.SESSION_SECRET || process.env.SESSION_SECRET),
    ADMIN_TELEGRAM_IDS: !!(runtime.ADMIN_TELEGRAM_IDS || process.env.ADMIN_TELEGRAM_IDS),
  };
  let bot: any = null;
  let webhook: any = null;
  let chat: any = null;
  let mediaChat: any = null;
  let repo: any = null;
  try {
    const { tg } = await import("./telegram.server");
    bot = await tg("getMe");
    webhook = await ensureWebhook(toStableWebhookUrl());
    const { getForcedTelegramDataChannelId, getTelegramDataChannelId, normalizeTelegramChatId, getTelegramMediaChannelId } =
      await import("./telegram.server");
    const configuredChannelId = getTelegramDataChannelId();
    if (configuredChannelId) {
      try {
        chat = await tg("getChat", { chat_id: normalizeTelegramChatId(configuredChannelId) });
        const member = await tg("getChatMember", {
          chat_id: normalizeTelegramChatId(configuredChannelId),
          user_id: bot.id,
        });
        chat = {
          ...chat,
          forced_id: getForcedTelegramDataChannelId(),
          media_channel_id: getTelegramMediaChannelId(),
          bot_member: member,
        };
      } catch (e: any) {
        chat = { id: getForcedTelegramDataChannelId(), error: e.message };
      }
    }
    const configuredMediaChannelId = getTelegramMediaChannelId();
    if (configuredMediaChannelId) {
      try {
        mediaChat = await tg("getChat", { chat_id: normalizeTelegramChatId(configuredMediaChannelId) });
        const mediaMember = await tg("getChatMember", {
          chat_id: normalizeTelegramChatId(configuredMediaChannelId),
          user_id: bot.id,
        });
        mediaChat = { ...mediaChat, normalized_id: normalizeTelegramChatId(configuredMediaChannelId), bot_member: mediaMember };
      } catch (e: any) {
        mediaChat = { id: configuredMediaChannelId, error: e.message };
      }
    }
    try {
      const { repoDiagnostics } = await import("./repo.server");
      repo = await repoDiagnostics();
    } catch (e: any) {
      repo = { error: e.message };
    }
  } catch (e: any) {
    bot = { error: e.message };
  }
  return { env, bot, webhook, chat, mediaChat, repo, expectedWebhookUrl: toStableWebhookUrl() };
});

export const verifyEndToEndFlow = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const { getCollectionFresh } = await import("./repo.server");
  const [students, courses, lessons, homework, quizzes] = await Promise.all([
    getCollectionFresh<Student>("students"),
    getCollectionFresh<Course>("courses"),
    getCollectionFresh<Lesson>("lessons"),
    getCollectionFresh<Homework>("homework"),
    getCollectionFresh<Quiz>("quizzes"),
  ]);
  const now = Date.now();
  const student = students.find((s) => !s.banned && (s.subscriptions || []).some((sub) => new Date(sub.expires_at).getTime() > now));
  const sub = student?.subscriptions.find((x) => new Date(x.expires_at).getTime() > now);
  const course = sub ? courses.find((c) => c.id === sub.course_id) : null;
  const courseLessons = course ? lessons.filter((l) => l.course_id === course.id).sort((a, b) => a.order - b.order) : [];
  const lesson = courseLessons[0] || null;
  const lessonHomework = lesson ? homework.filter((h) => h.lesson_id === lesson.id) : [];
  const lessonQuiz = lesson?.quiz_id ? quizzes.find((q) => q.id === lesson.quiz_id) : null;

  const checks = [
    { key: "subscription", label: "اشتراك نشط لطالب", ok: !!student && !!sub, detail: student ? `${student.student_code} → ${sub?.course_id}` : "لا يوجد طالب باشتراك نشط" },
    { key: "course", label: "فتح الكورس من الاشتراك", ok: !!course, detail: course?.title || "الكورس المرتبط بالاشتراك غير موجود" },
    { key: "lessons", label: "عرض حصص الكورس", ok: courseLessons.length > 0, detail: `${courseLessons.length} حصة` },
    { key: "lesson", label: "تفاصيل أول حصة", ok: !!lesson, detail: lesson ? `${lesson.title} · ${lesson.resources?.length || 0} ملف/رابط` : "لا توجد حصة للاختبار" },
    { key: "homework", label: "واجبات الحصة", ok: lessonHomework.length > 0, detail: `${lessonHomework.length} واجب` },
    { key: "quiz", label: "امتحان الحصة", ok: !!lessonQuiz || !!lesson?.quiz_id, detail: lessonQuiz?.title || (lesson?.quiz_id ? "مربوط بامتحان" : "لا يوجد امتحان مرتبط") },
  ];

  let studentNotification = false;
  let adminNotifications = 0;
  try {
    const { tg } = await import("./telegram.server");
    if (student) {
      await tg("sendMessage", {
        chat_id: student.id,
        text: `✅ فحص المنصة نجح\nالكورس: ${course?.title || "—"}\nالحصص: ${courseLessons.length}\nالحصة: ${lesson?.title || "—"}`,
        disable_notification: true,
      });
      studentNotification = true;
    }
    const { getAdminIds } = await import("./bot-features.server");
    for (const aid of getAdminIds()) {
      await tg("sendMessage", {
        chat_id: aid,
        text: `🧪 فحص end-to-end\nطالب: ${student?.student_code || "—"}\nكورس: ${course?.title || "—"}\nحصص: ${courseLessons.length}\nواجبات أول حصة: ${lessonHomework.length}`,
        disable_notification: true,
      });
      adminNotifications++;
    }
  } catch {}

  checks.push(
    { key: "student_bot", label: "إشعار الطالب في البوت", ok: studentNotification, detail: studentNotification ? "تم الإرسال" : "تعذر الإرسال أو لا يوجد طالب" },
    { key: "admin_bot", label: "إشعار الأدمن في البوت", ok: adminNotifications > 0, detail: `${adminNotifications} أدمن` },
  );
  return { ok: checks.every((c) => c.ok), checks };
});

// ============================================================
// COURSES — CRUD
// ============================================================

const CourseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  subtitle: z.string().max(200).optional(),
  cover_file_id: z.string().nullable().optional(),
  cover_url: z.string().nullable().optional(),
  is_pinned: z.boolean().optional(),
  is_published: z.boolean().optional(),
  order: z.number(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const listCourses = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  const courses = await getCollection<Course>("courses");
  const lessons = await getCollection<Lesson>("lessons");
  // attach lesson counts
  const counts: Record<string, number> = {};
  for (const l of lessons) counts[l.course_id] = (counts[l.course_id] || 0) + 1;
  return courses
    .map((c) => ({ ...c, lesson_count: counts[c.id] || 0 }))
    .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || a.order - b.order);
});

export const saveCourse = createServerFn({ method: "POST" })
  .inputValidator((d) => CourseSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const now = new Date().toISOString();
    const { upsert, getCollection } = await import("./repo.server");
    const existing = (await getCollection<Course>("courses")).find((c) => c.id === data.id);
    const course: Course = {
      ...(existing || {}),
      ...data,
      created_at: existing?.created_at || now,
      updated_at: now,
    } as Course;
    await upsert<Course>("courses", course);
    return { ok: true, course };
  });

export const deleteCourse = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { removeById, getCollection, setCollection } = await import("./repo.server");
    await removeById("courses", data.id);
    // cascade delete lessons
    const lessons = await getCollection<Lesson>("lessons");
    const remaining = lessons.filter((l) => l.course_id !== data.id);
    if (remaining.length !== lessons.length) await setCollection("lessons", remaining);
    return { ok: true };
  });

// ============================================================
// LESSONS — CRUD
// ============================================================

const ResourceSchema = z.object({
  id: z.string(),
  kind: z.enum(["video", "document", "photo", "audio", "link"]),
  file_id: z.string().optional(),
  url: z.string().url().optional(),
  provider: z.enum(["google_drive", "external"]).optional(),
  file_name: z.string().optional(),
  caption: z.string().optional(),
  size_bytes: z.number().optional(),
  mime: z.string().optional(),
}).refine((r) => r.kind === "link" ? !!r.url : !!r.file_id, {
  message: "ملف أو رابط مطلوب للمورد",
});

const LessonSchema = z.object({
  id: z.string().min(1),
  course_id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  resources: z.array(ResourceSchema).default([]),
  quiz_id: z.string().nullable().optional(),
  order: z.number(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const listLessons = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ course_id: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection } = await import("./repo.server");
    const lessons = await getCollection<Lesson>("lessons");
    const filtered = data.course_id ? lessons.filter((l) => l.course_id === data.course_id) : lessons;
    return filtered.sort((a, b) => a.order - b.order);
  });

export const saveLesson = createServerFn({ method: "POST" })
  .inputValidator((d) => LessonSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const now = new Date().toISOString();
    const { upsert, getCollection } = await import("./repo.server");
    const existing = (await getCollection<Lesson>("lessons")).find((l) => l.id === data.id);
    const lesson: Lesson = {
      ...(existing || {}),
      ...data,
      resources: data.resources as LessonResource[],
      created_at: existing?.created_at || now,
      updated_at: now,
    } as Lesson;
    await upsert<Lesson>("lessons", lesson);
    return { ok: true, lesson };
  });

export const deleteLesson = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { removeById } = await import("./repo.server");
    await removeById("lessons", data.id);
    return { ok: true };
  });

// ============================================================
// VOUCHERS — batch generator
// ============================================================

function randCode(prefix: string) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const block = () => Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${prefix}-${block()}-${block()}`;
}

const VoucherBatchSchema = z.object({
  prefix: z.string().min(1).max(8).default("AMW"),
  course_id: z.string().min(1),
  duration_days: z.number().min(1).max(3650),
  count: z.number().min(1).max(5000),
  note: z.string().max(200).optional(),
});

export const generateVoucherBatch = createServerFn({ method: "POST" })
  .inputValidator((d) => VoucherBatchSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const { getCollection, setCollection, upsert } = await import("./repo.server");
    const now = new Date().toISOString();
    const batch: VoucherBatch = {
      id: "vb_" + Date.now().toString(36),
      prefix: data.prefix.toUpperCase(),
      course_id: data.course_id,
      duration_days: data.duration_days,
      count: data.count,
      created_at: now,
      note: data.note,
    };
    await upsert<VoucherBatch>("voucher_batches", batch);

    // generate codes, avoid duplicates across existing
    const existing = await getCollection<Voucher>("vouchers");
    const taken = new Set(existing.map((v) => v.code));
    const fresh: Voucher[] = [];
    while (fresh.length < data.count) {
      const code = randCode(batch.prefix);
      if (taken.has(code)) continue;
      taken.add(code);
      fresh.push({
        code,
        batch_id: batch.id,
        course_id: batch.course_id,
        duration_days: batch.duration_days,
        used_by: null,
        used_at: null,
        created_at: now,
      });
    }
    await setCollection("vouchers", [...existing, ...fresh]);
    return { ok: true, batch, codes: fresh.map((v) => v.code) };
  });

export const listVoucherBatches = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  const batches = await getCollection<VoucherBatch>("voucher_batches");
  const vouchers = await getCollection<Voucher>("vouchers");
  return batches
    .map((b) => {
      const codes = vouchers.filter((v) => v.batch_id === b.id);
      return {
        ...b,
        total: codes.length,
        used: codes.filter((v) => v.used_by).length,
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
});

export const listVouchersByBatch = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ batch_id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection } = await import("./repo.server");
    const vouchers = await getCollection<Voucher>("vouchers");
    return vouchers.filter((v) => v.batch_id === data.batch_id);
  });

// ============================================================
// STATS
// ============================================================

export const getStats = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const empty = { courses: 0, lessons: 0, vouchers_total: 0, vouchers_used: 0, students: 0, polls: 0, votes: 0, quizzes: 0, attempts: 0, pass_rate: 0 };
  try {
    const { getCollection } = await import("./repo.server");
    const [courses, lessons, vouchers, students, polls, votes, quizzes, attempts] = await Promise.all([
    getCollection<Course>("courses"),
    getCollection<Lesson>("lessons"),
    getCollection<Voucher>("vouchers"),
    getCollection<Student>("students"),
    getCollection<Poll>("polls"),
    getCollection<Vote>("votes"),
    getCollection<Quiz>("quizzes"),
    getCollection<Attempt>("attempts"),
  ]);
    const pass = attempts.filter((a) => typeof a.score === "number" && typeof a.total === "number" && a.total > 0 && (a.score / a.total) >= 0.5).length;
    return {
    courses: courses.length,
    lessons: lessons.length,
    vouchers_total: vouchers.length,
    vouchers_used: vouchers.filter((v) => v.used_by).length,
    students: students.length,
    polls: polls.length,
    votes: votes.length,
    quizzes: quizzes.length,
    attempts: attempts.length,
      pass_rate: attempts.length ? Math.round((pass / attempts.length) * 100) : 0,
    };
  } catch {
    return empty;
  }
});

// ============================================================
// TEACHER ANALYTICS — deep aggregations across collections
// ============================================================

export const getTeacherAnalytics = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  type HW = {
    id: string; lesson_id: string; course_id: string; title: string; max_score: number; created_at: string;
  };
  type HWS = {
    id: string; homework_id: string; student_id: number; submitted_at: string;
    score?: number | null; graded_at?: string | null;
  };
  type WTX = { student_id: number; amount: number; reason: string; created_at: string };

  const [courses, lessons, students, quizzes, attempts, homework, submissions, wallet] = await Promise.all([
    getCollection<Course>("courses").catch(() => []),
    getCollection<Lesson>("lessons").catch(() => []),
    getCollection<Student>("students").catch(() => []),
    getCollection<Quiz>("quizzes").catch(() => []),
    getCollection<Attempt>("attempts").catch(() => []),
    getCollection<HW>("homework").catch(() => []),
    getCollection<HWS>("homework_submissions").catch(() => []),
    getCollection<WTX>("wallet_tx").catch(() => []),
  ]);

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const within = (iso: string | undefined, ms: number) => !!iso && now - new Date(iso).getTime() < ms;

  // ---- Per-course aggregates ----
  const lessonsByCourse: Record<string, Lesson[]> = {};
  for (const l of lessons) (lessonsByCourse[l.course_id] ||= []).push(l);

  const subsByCourse: Record<string, { active: number; total: number }> = {};
  for (const s of students) {
    for (const sub of s.subscriptions || []) {
      const rec = (subsByCourse[sub.course_id] ||= { active: 0, total: 0 });
      rec.total += 1;
      if (new Date(sub.expires_at).getTime() > now) rec.active += 1;
    }
  }

  const courseRows = courses
    .map((c) => {
      const courseLessons = lessonsByCourse[c.id] || [];
      const lessonIds = new Set(courseLessons.map((l) => l.id));
      const courseQuizzes = quizzes.filter(
        (q) => q.course_id === c.id || (q.lesson_id && lessonIds.has(q.lesson_id))
      );
      const quizIds = new Set(courseQuizzes.map((q) => q.id));
      const courseAttempts = attempts.filter((a) => quizIds.has(a.quiz_id) && a.ended_at);
      const scored = courseAttempts.filter(
        (a) => typeof a.score === "number" && typeof a.total === "number" && a.total > 0
      );
      const avgPct = scored.length
        ? Math.round((scored.reduce((s, a) => s + (a.score! / a.total!) * 100, 0) / scored.length) * 10) / 10
        : 0;
      const hwIds = new Set(homework.filter((h) => h.course_id === c.id).map((h) => h.id));
      const courseSubs = submissions.filter((s) => hwIds.has(s.homework_id));
      return {
        id: c.id,
        title: c.title,
        lessons: courseLessons.length,
        active_students: subsByCourse[c.id]?.active || 0,
        total_subscriptions: subsByCourse[c.id]?.total || 0,
        quizzes: courseQuizzes.length,
        attempts: courseAttempts.length,
        avg_score_pct: avgPct,
        homework: hwIds.size,
        submissions: courseSubs.length,
      };
    })
    .sort((a, b) => b.active_students - a.active_students);

  // ---- Per-lesson quiz performance (top + worst) ----
  const lessonRows = lessons
    .map((l) => {
      const q = quizzes.find((q) => q.lesson_id === l.id);
      if (!q) return null;
      const lessonAttempts = attempts.filter((a) => a.quiz_id === q.id && a.ended_at);
      const scored = lessonAttempts.filter(
        (a) => typeof a.score === "number" && typeof a.total === "number" && a.total > 0
      );
      if (!scored.length) return null;
      const avgPct =
        Math.round((scored.reduce((s, a) => s + (a.score! / a.total!) * 100, 0) / scored.length) * 10) / 10;
      const passRate = Math.round(
        (scored.filter((a) => a.score! / a.total! >= 0.5).length / scored.length) * 100
      );
      const course = courses.find((c) => c.id === l.course_id);
      return {
        lesson_id: l.id,
        lesson_title: l.title,
        course_title: course?.title || "—",
        attempts: lessonAttempts.length,
        avg_score_pct: avgPct,
        pass_rate: passRate,
      };
    })
    .filter(Boolean) as Array<{
      lesson_id: string; lesson_title: string; course_title: string;
      attempts: number; avg_score_pct: number; pass_rate: number;
    }>;

  const topLessons = [...lessonRows].sort((a, b) => b.avg_score_pct - a.avg_score_pct).slice(0, 5);
  const worstLessons = [...lessonRows].sort((a, b) => a.avg_score_pct - b.avg_score_pct).slice(0, 5);

  // ---- Most active students ----
  const activity: Record<number, { name: string; attempts: number; submissions: number; spent: number }> = {};
  for (const s of students) {
    activity[s.id] = {
      name: [s.first_name, s.last_name].filter(Boolean).join(" ") || s.username || s.student_code,
      attempts: 0,
      submissions: 0,
      spent: 0,
    };
  }
  for (const a of attempts) {
    if (activity[a.student_id]) activity[a.student_id].attempts++;
  }
  for (const s of submissions) {
    if (activity[s.student_id]) activity[s.student_id].submissions++;
  }
  for (const w of wallet) {
    if (activity[w.student_id] && w.amount < 0) activity[w.student_id].spent += -w.amount;
  }
  const topStudents = Object.entries(activity)
    .map(([id, v]) => ({ id: Number(id), ...v, score: v.attempts * 2 + v.submissions * 3 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // ---- Students with pending homework (assigned but no submission) ----
  const submittedSet = new Set(submissions.map((s) => `${s.student_id}:${s.homework_id}`));
  const pendingByStudent: Record<number, number> = {};
  for (const s of students) {
    for (const sub of s.subscriptions || []) {
      if (new Date(sub.expires_at).getTime() <= now) continue;
      const hws = homework.filter((h) => h.course_id === sub.course_id);
      for (const h of hws) {
        if (!submittedSet.has(`${s.id}:${h.id}`)) {
          pendingByStudent[s.id] = (pendingByStudent[s.id] || 0) + 1;
        }
      }
    }
  }
  const pendingStudents = Object.entries(pendingByStudent)
    .map(([id, count]) => {
      const s = students.find((st) => st.id === Number(id));
      return {
        id: Number(id),
        name: s ? [s.first_name, s.last_name].filter(Boolean).join(" ") || s.username || s.student_code : String(id),
        pending: count,
      };
    })
    .sort((a, b) => b.pending - a.pending)
    .slice(0, 10);

  // ---- Pending grading queue ----
  const ungraded = submissions.filter((s) => s.score == null).length;

  // ---- Activity timeline (last 14 days) ----
  const buckets: { day: string; attempts: number; submissions: number; new_students: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = new Date(now - i * day);
    const key = date.toISOString().slice(0, 10);
    buckets.push({ day: key, attempts: 0, submissions: 0, new_students: 0 });
  }
  const bucketIndex = (iso?: string) => {
    if (!iso) return -1;
    const k = iso.slice(0, 10);
    return buckets.findIndex((b) => b.day === k);
  };
  for (const a of attempts) {
    const i = bucketIndex(a.ended_at || a.started_at);
    if (i >= 0) buckets[i].attempts++;
  }
  for (const sub of submissions) {
    const i = bucketIndex(sub.submitted_at);
    if (i >= 0) buckets[i].submissions++;
  }
  for (const s of students) {
    const i = bucketIndex(s.joined_at);
    if (i >= 0) buckets[i].new_students++;
  }

  // ---- Totals ----
  const totals = {
    courses: courses.length,
    lessons: lessons.length,
    students: students.length,
    active_subscriptions: Object.values(subsByCourse).reduce((s, r) => s + r.active, 0),
    new_students_7d: students.filter((s) => within(s.joined_at, 7 * day)).length,
    attempts_7d: attempts.filter((a) => within(a.ended_at || a.started_at, 7 * day)).length,
    submissions_7d: submissions.filter((s) => within(s.submitted_at, 7 * day)).length,
    revenue_7d: wallet
      .filter((w) => w.amount > 0 && w.reason === "topup_approved" && within(w.created_at, 7 * day))
      .reduce((s, w) => s + w.amount, 0),
    ungraded_submissions: ungraded,
  };

  return { totals, courses: courseRows, topLessons, worstLessons, topStudents, pendingStudents, timeline: buckets };
});

// ============================================================
// POLLS — generator + live analytics
// ============================================================

const PollSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(3).max(500),
  options: z.array(z.string().min(1).max(80)).min(2).max(8),
  type: z.enum(["choice", "rating", "feedback"]).default("choice"),
  target_course_id: z.string().nullable().optional(),
  is_open: z.boolean().default(true),
  created_at: z.string().optional(),
  sent_message_count: z.number().optional(),
});

function pollStats(poll: Poll, votes: Vote[]) {
  const related = votes.filter((v) => v.poll_id === poll.id);
  const unique = new Map<number, Vote>();
  for (const vote of related) unique.set(vote.student_id, vote);
  const finalVotes = [...unique.values()];
  const counts = poll.options.map((_, i) => finalVotes.filter((v) => v.option_index === i).length);
  const total = finalVotes.length;
  return { total, counts, percentages: counts.map((c) => (total ? Math.round((c / total) * 100) : 0)) };
}

export const listPollsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  const polls = await getCollection<Poll>("polls");
  const votes = await getCollection<Vote>("votes");
  return polls
    .map((p) => ({ ...p, analytics: pollStats(p, votes) }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
});

export const savePollAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => PollSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const { upsert, getCollection } = await import("./repo.server");
    const existing = (await getCollection<Poll>("polls")).find((p) => p.id === data.id);
    const poll: Poll = { ...(existing || {}), ...data, created_at: existing?.created_at || data.created_at || new Date().toISOString() };
    await upsert<Poll>("polls", poll);
    return { ok: true, poll };
  });

export const sendPollAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ poll_id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection, upsert } = await import("./repo.server");
    const { tg } = await import("./telegram.server");
    const polls = await getCollection<Poll>("polls");
    const poll = polls.find((p) => p.id === data.poll_id);
    if (!poll) throw new Error("الاستطلاع غير موجود");
    const students = (await getCollection<Student>("students")).filter((s) => !s.banned);
    let sent = 0;
    const keyboard = poll.options.map((opt, i) => [{ text: opt, callback_data: `poll:${poll.id}:${i}` }]);
    for (const student of students) {
      try {
        await tg("sendMessage", {
          chat_id: student.id,
          text: `📊 <b>استطلاع جديد</b>\n\n${poll.question}`,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard },
        });
        sent++;
      } catch {}
    }
    poll.sent_message_count = (poll.sent_message_count || 0) + sent;
    await upsert<Poll>("polls", poll);
    return { ok: true, sent };
  });

// ============================================================
// QUIZZES + STUDENT CRM
// ============================================================

const QuizQuestionSchema = z.object({
  id: z.string(),
  text: z.string().min(1).max(1000),
  image_file_id: z.string().nullable().optional(),
  options: z.array(z.string().min(1).max(300)).min(2).max(6),
  correct_index: z.number().min(0).max(5),
  explanation: z.string().max(1500).optional(),
});

const QuizSchema = z.object({
  id: z.string().min(1),
  lesson_id: z.string().nullable().optional(),
  course_id: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  duration_seconds: z.number().min(30).max(14400),
  shuffle_questions: z.boolean().default(true),
  shuffle_options: z.boolean().default(true),
  questions: z.array(QuizQuestionSchema).default([]),
  created_at: z.string().optional(),
});

export const listQuizzesAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  return (await getCollection<Quiz>("quizzes")).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
});

export const saveQuizAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => QuizSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const { upsert, getCollection } = await import("./repo.server");
    const existing = (await getCollection<Quiz>("quizzes")).find((q) => q.id === data.id);
    const quiz: Quiz = { ...(existing || {}), ...data, created_at: existing?.created_at || data.created_at || new Date().toISOString() };
    await upsert<Quiz>("quizzes", quiz);
    return { ok: true, quiz };
  });

export const listStudentsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  const [students, attempts, votes, vouchers] = await Promise.all([
    getCollection<Student>("students"),
    getCollection<Attempt>("attempts"),
    getCollection<Vote>("votes"),
    getCollection<Voucher>("vouchers"),
  ]);
  return students
    .map((s) => ({
      ...s,
      attempts: attempts.filter((a) => a.student_id === s.id),
      votes: votes.filter((v) => v.student_id === s.id),
      vouchers: vouchers.filter((v) => v.used_by === s.id),
    }))
    .sort((a, b) => ((b.last_active || b.joined_at) < (a.last_active || a.joined_at) ? -1 : 1));
});

export const updateStudentAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ student_id: z.number(), action: z.enum(["ban", "unban", "reset_device", "extend"]), days: z.number().optional() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection, upsert } = await import("./repo.server");
    const students = await getCollection<Student>("students");
    const student = students.find((s) => s.id === data.student_id);
    if (!student) throw new Error("الطالب غير موجود");
    if (data.action === "ban") student.banned = true;
    if (data.action === "unban") student.banned = false;
    if (data.action === "reset_device") { student.device = null; student.locked = false; }
    if (data.action === "extend") {
      const days = data.days || 30;
      const now = Date.now();
      student.subscriptions = student.subscriptions.map((sub) => ({
        ...sub,
        expires_at: new Date(Math.max(new Date(sub.expires_at).getTime(), now) + days * 86_400_000).toISOString(),
      }));
    }
    await upsert<Student>("students", student);
    return { ok: true, student };
  });

// ============================================================
// RUNTIME SETTINGS (mirror of secrets, stored in DATA channel)
// ============================================================

const SECRET_KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_DATA_CHANNEL_ID",
  "TELEGRAM_MEDIA_CHANNEL_ID",
  "ADMIN_PASSWORD",
  "SESSION_SECRET",
  "ADMIN_TELEGRAM_IDS",
  "KV_NAMESPACE_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_KV_NAMESPACE_ID",
  "CLOUDFLARE_API_TOKEN",
] as const;
type SecretKey = (typeof SECRET_KEYS)[number];

function mask(v?: string) {
  if (!v) return "";
  if (v.length <= 6) return "•".repeat(v.length);
  return v.slice(0, 3) + "•".repeat(Math.max(4, v.length - 6)) + v.slice(-3);
}

export const getRuntimeSettingsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getRuntimeSettings } = await import("./repo.server");
  let overrides: Record<string, string> = {};
  try { overrides = await getRuntimeSettings(true); } catch {}
  const rows = SECRET_KEYS.map((k) => {
    const env = process.env[k] || "";
    const ov = overrides[k] || "";
    const effective = ov || env;
    return {
      key: k,
      has_env: !!env,
      has_override: !!ov,
      masked: mask(effective),
      source: ov ? "runtime" : env ? "env" : "—",
    };
  });
  return { rows };
});

export const saveRuntimeSettingsAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        patch: z.record(z.string(), z.string()),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    await requireAdmin();
    // Only accept whitelisted keys; ignore unknown keys silently.
    const allowed = new Set<string>(SECRET_KEYS);
    const patch: Record<string, string> = {};
    const { normalizeTelegramChatId } = await import("./telegram.server");
    for (const [k, v] of Object.entries(data.patch)) {
      if (!allowed.has(k)) continue;
      const value = (v ?? "").trim();
      patch[k] = k === "TELEGRAM_DATA_CHANNEL_ID" || k === "TELEGRAM_MEDIA_CHANNEL_ID" ? normalizeTelegramChatId(value) : value;
    }
    const { setRuntimeOverridesSync } = await import("./telegram.server");
    setRuntimeOverridesSync(patch);
    const { setRuntimeSettings } = await import("./repo.server");
    await setRuntimeSettings(patch);
    return { ok: true };
  });

// ============================================================
// HOMEWORK MANAGEMENT (web admin)
// ============================================================
import type {
  Book,
  BookPurchase,
  BroadcastRecord,
  HomeworkSubmission,
  SupportMessage,
  SupportTicket,
  TopupRequest,
} from "./types";

async function notifyStudent(studentId: number, text: string) {
  try {
    const { tg } = await import("./telegram.server");
    await tg("sendMessage", { chat_id: studentId, text, parse_mode: "HTML" });
  } catch (e) {
    console.warn("notifyStudent failed", studentId, e);
  }
}

export const listHomeworkAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  const [homework, subs, courses, lessons] = await Promise.all([
    getCollection<Homework>("homework"),
    getCollection<HomeworkSubmission>("homework_submissions"),
    getCollection<Course>("courses"),
    getCollection<Lesson>("lessons"),
  ]);
  return homework
    .map((h) => {
      const related = subs.filter((s) => s.homework_id === h.id);
      return {
        ...h,
        course_title: courses.find((c) => c.id === h.course_id)?.title || "—",
        lesson_title: lessons.find((l) => l.id === h.lesson_id)?.title || "—",
        submissions_count: related.length,
        graded_count: related.filter((s) => s.graded_at).length,
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
});

const HomeworkSchema = z.object({
  id: z.string().min(1),
  lesson_id: z.string().min(1),
  course_id: z.string().min(1),
  title: z.string().min(1).max(200),
  instructions: z.string().max(4000).default(""),
  due_at: z.string().nullable().optional(),
  max_score: z.number().min(1).max(1000).default(100),
});

export const saveHomeworkAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => HomeworkSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const { upsert, getCollection } = await import("./repo.server");
    const existing = (await getCollection<Homework>("homework")).find((h) => h.id === data.id);
    const hw: Homework = {
      ...(existing || {}),
      ...data,
      due_at: data.due_at || null,
      created_at: existing?.created_at || new Date().toISOString(),
    };
    await upsert<Homework>("homework", hw);
    if (!existing) {
      const [students, lessons] = await Promise.all([
        getCollection<Student>("students"),
        getCollection<Lesson>("lessons"),
      ]);
      const lesson = lessons.find((l) => l.id === hw.lesson_id);
      const activeStudents = students.filter((s) =>
        (s.subscriptions || []).some((sub) => sub.course_id === hw.course_id && new Date(sub.expires_at).getTime() > Date.now()),
      );
      for (const s of activeStudents) {
        await notifyStudent(s.id, `📝 <b>واجب جديد</b>\n${hw.title}${lesson ? `\nالحصة: ${lesson.title}` : ""}`);
      }
      const { tg } = await import("./telegram.server");
      const { getAdminIds } = await import("./bot-features.server");
      for (const aid of getAdminIds()) {
        await tg("sendMessage", { chat_id: aid, text: `✅ تم إنشاء واجب من لوحة المنصة\n${hw.title}\nID: ${hw.id}` }).catch(() => {});
      }
    }
    return { ok: true, homework: hw };
  });

export const deleteHomeworkAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { removeById } = await import("./repo.server");
    await removeById("homework", data.id);
    return { ok: true };
  });

export const listSubmissionsAdmin = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ homework_id: z.string().optional(), only_ungraded: z.boolean().optional() }).parse(d ?? {}))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection } = await import("./repo.server");
    const [subs, students, homework] = await Promise.all([
      getCollection<HomeworkSubmission>("homework_submissions"),
      getCollection<Student>("students"),
      getCollection<Homework>("homework"),
    ]);
    return subs
      .filter((s) => (data.homework_id ? s.homework_id === data.homework_id : true))
      .filter((s) => (data.only_ungraded ? !s.graded_at : true))
      .map((s) => {
        const student = students.find((st) => st.id === s.student_id);
        const hw = homework.find((h) => h.id === s.homework_id);
        return {
          ...s,
          student_name: student ? `${student.first_name || ""} ${student.last_name || ""}`.trim() || student.student_code : String(s.student_id),
          student_code: student?.student_code,
          homework_title: hw?.title || "—",
          max_score: hw?.max_score || 100,
        };
      })
      .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1));
  });

export const gradeSubmissionAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string(), score: z.number().min(0).max(1000), feedback: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection, upsert } = await import("./repo.server");
    const subs = await getCollection<HomeworkSubmission>("homework_submissions");
    const sub = subs.find((s) => s.id === data.id);
    if (!sub) throw new Error("التسليم غير موجود");
    const hw = await (await import("./repo.server")).findById<Homework>("homework", sub.homework_id);
    sub.score = data.score;
    sub.feedback = data.feedback || null;
    sub.graded_at = new Date().toISOString();
    await upsert<HomeworkSubmission>("homework_submissions", sub);
    await notifyStudent(
      sub.student_id,
      `✅ <b>تم تصحيح واجبك</b>\n📝 ${hw?.title || ""}\n🏆 الدرجة: <b>${data.score}/${hw?.max_score || 100}</b>${data.feedback ? `\n💬 ${data.feedback}` : ""}`,
    );
    return { ok: true };
  });

// ============================================================
// WALLET / TOP-UP REQUESTS
// ============================================================
export const listTopupsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  const [topups, students] = await Promise.all([
    getCollection<TopupRequest>("topup_requests"),
    getCollection<Student>("students"),
  ]);
  return topups
    .map((t) => {
      const s = students.find((st) => st.id === t.student_id);
      return {
        ...t,
        student_name: s ? `${s.first_name || ""} ${s.last_name || ""}`.trim() || s.student_code : String(t.student_id),
        student_code: s?.student_code,
        balance: s?.wallet_balance || 0,
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
});

export const reviewTopupAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string(), decision: z.enum(["approve", "reject"]), note: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection, upsert } = await import("./repo.server");
    const topups = await getCollection<TopupRequest>("topup_requests");
    const req = topups.find((t) => t.id === data.id);
    if (!req) throw new Error("الطلب غير موجود");
    if (req.status !== "pending") throw new Error("تمت مراجعة هذا الطلب مسبقًا");
    req.status = data.decision === "approve" ? "approved" : "rejected";
    req.reviewed_at = new Date().toISOString();
    req.review_note = data.note || null;
    await upsert<TopupRequest>("topup_requests", req);

    if (data.decision === "approve") {
      const students = await getCollection<Student>("students");
      const student = students.find((s) => s.id === req.student_id);
      if (student) {
        const { adjustWallet } = await import("./bot-features.server");
        const newBalance = await adjustWallet(student, req.amount, "topup_approved", req.id);
        await notifyStudent(req.student_id, `✅ <b>تم شحن محفظتك</b>\n💰 +${req.amount} ج.م\n💳 رصيدك الآن: <b>${newBalance}</b> ج.م`);
      }
    } else {
      await notifyStudent(req.student_id, `❌ <b>تم رفض طلب الشحن</b>\n💰 ${req.amount} ج.م${data.note ? `\n💬 ${data.note}` : ""}`);
    }
    return { ok: true };
  });

export const adjustWalletAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ student_id: z.number(), amount: z.number(), note: z.string().max(300).optional() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection } = await import("./repo.server");
    const students = await getCollection<Student>("students");
    const student = students.find((s) => s.id === data.student_id);
    if (!student) throw new Error("الطالب غير موجود");
    const { adjustWallet } = await import("./bot-features.server");
    const newBalance = await adjustWallet(student, data.amount, "admin_adjust");
    await notifyStudent(
      data.student_id,
      `💳 <b>تعديل رصيد</b>\n${data.amount >= 0 ? "+" : ""}${data.amount} ج.م\nرصيدك الآن: <b>${newBalance}</b> ج.م${data.note ? `\n💬 ${data.note}` : ""}`,
    );
    return { ok: true, balance: newBalance };
  });

// ============================================================
// SUPPORT TICKETS
// ============================================================
export const listTicketsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  const [tickets, messages, students] = await Promise.all([
    getCollection<SupportTicket>("support_tickets"),
    getCollection<SupportMessage>("support_messages"),
    getCollection<Student>("students"),
  ]);
  return tickets
    .map((t) => {
      const s = students.find((st) => st.id === t.student_id);
      return {
        ...t,
        student_name: s ? `${s.first_name || ""} ${s.last_name || ""}`.trim() || s.student_code : String(t.student_id),
        messages: messages
          .filter((m) => m.ticket_id === t.id)
          .sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
      };
    })
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
});

export const replyTicketAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ ticket_id: z.string(), text: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection, upsert } = await import("./repo.server");
    const tickets = await getCollection<SupportTicket>("support_tickets");
    const ticket = tickets.find((t) => t.id === data.ticket_id);
    if (!ticket) throw new Error("التذكرة غير موجودة");
    const msg: SupportMessage = {
      id: "sm_" + Date.now().toString(36),
      ticket_id: ticket.id,
      author_id: 0,
      author_role: "admin",
      text: data.text,
      file_id: null,
      file_kind: null,
      created_at: new Date().toISOString(),
    };
    await upsert<SupportMessage>("support_messages", msg);
    ticket.status = "open";
    ticket.updated_at = new Date().toISOString();
    await upsert<SupportTicket>("support_tickets", ticket);
    await notifyStudent(ticket.student_id, `💬 <b>رد على تذكرتك</b>\n📋 ${ticket.subject}\n\n${data.text}`);
    return { ok: true };
  });

export const closeTicketAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ ticket_id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection, upsert } = await import("./repo.server");
    const tickets = await getCollection<SupportTicket>("support_tickets");
    const ticket = tickets.find((t) => t.id === data.ticket_id);
    if (!ticket) throw new Error("التذكرة غير موجودة");
    ticket.status = "closed";
    ticket.updated_at = new Date().toISOString();
    await upsert<SupportTicket>("support_tickets", ticket);
    await notifyStudent(ticket.student_id, `✅ تم إغلاق تذكرتك: ${ticket.subject}`);
    return { ok: true };
  });

// ============================================================
// BOOKS / STORE
// ============================================================
export const listBooksAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  const [books, purchases] = await Promise.all([
    getCollection<Book>("books"),
    getCollection<BookPurchase>("book_purchases"),
  ]);
  return books
    .map((b) => ({
      ...b,
      sales: purchases.filter((p) => p.book_id === b.id).length,
      revenue: purchases.filter((p) => p.book_id === b.id).reduce((s, p) => s + (p.price_paid || 0), 0),
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
});

const BookSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  price: z.number().min(0).max(100000).default(0),
  cover_file_id: z.string().nullable().optional(),
  file_id: z.string().min(1),
  file_kind: z.enum(["document", "photo"]).default("document"),
  is_published: z.boolean().default(true),
});

export const saveBookAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => BookSchema.parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    await verifyDataChannelAccess();
    const { upsert, getCollection } = await import("./repo.server");
    const existing = (await getCollection<Book>("books")).find((b) => b.id === data.id);
    const book: Book = {
      ...(existing || {}),
      ...data,
      created_at: existing?.created_at || new Date().toISOString(),
    };
    await upsert<Book>("books", book);
    return { ok: true, book };
  });

export const deleteBookAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { removeById } = await import("./repo.server");
    await removeById("books", data.id);
    return { ok: true };
  });

// ============================================================
// BROADCASTS
// ============================================================
export const listBroadcastsAdmin = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { getCollection } = await import("./repo.server");
  return (await getCollection<BroadcastRecord>("broadcasts")).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
});

export const sendBroadcastAdmin = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ text: z.string().min(1).max(4000), course_id: z.string().nullable().optional() }).parse(d))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { getCollection, upsert } = await import("./repo.server");
    const { tg } = await import("./telegram.server");
    let students = (await getCollection<Student>("students")).filter((s) => !s.banned);
    if (data.course_id) {
      students = students.filter((s) => (s.subscriptions || []).some((sub) => sub.course_id === data.course_id));
    }
    let sent = 0;
    let failed = 0;
    for (const s of students) {
      try {
        await tg("sendMessage", { chat_id: s.id, text: data.text, parse_mode: "HTML" });
        sent++;
      } catch {
        failed++;
      }
    }
    const record: BroadcastRecord = {
      id: "bc_" + Date.now().toString(36),
      by: 0,
      text: data.text,
      sent,
      failed,
      created_at: new Date().toISOString(),
    };
    await upsert<BroadcastRecord>("broadcasts", record);
    return { ok: true, sent, failed };
  });

// ============================================================
// SEED DEMO DATA — single click to populate a sample course
// with a lesson (video + PDF), a quiz, and a redeemable voucher.
// Safe to run multiple times: it skips entities that already exist.
// ============================================================
export const seedDemoData = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin();
  const { getCollection, upsert } = await import("./repo.server");
  const now = new Date().toISOString();

  const courses = await getCollection<Course>("courses");
  const demoCourseId = "demo-course-1";
  let course = courses.find((c) => c.id === demoCourseId);
  if (!course) {
    course = {
      id: demoCourseId,
      title: "كورس تجريبي — كيمياء الصف الثالث",
      subtitle: "مثال لاستعراض النظام بالكامل",
      cover_file_id: null,
      cover_url: null,
      is_pinned: true,
      is_published: true,
      order: 1,
      created_at: now,
      updated_at: now,
    };
    await upsert<Course>("courses", course);
  }

  const lessons = await getCollection<Lesson>("lessons");
  const demoLessonId = "demo-lesson-1";
  let lesson = lessons.find((l) => l.id === demoLessonId);
  if (!lesson) {
    lesson = {
      id: demoLessonId,
      course_id: demoCourseId,
      title: "الحصة الأولى — مقدمة",
      description: "حصة تجريبية بدون ملفات. أضف فيديو وPDF من /admin/courses.",
      resources: [],
      quiz_id: "demo-quiz-1",
      order: 1,
      created_at: now,
      updated_at: now,
    };
    await upsert<Lesson>("lessons", lesson);
  }

  const quizzes = await getCollection<Quiz>("quizzes");
  if (!quizzes.find((q) => q.id === "demo-quiz-1")) {
    const quiz: Quiz = {
      id: "demo-quiz-1",
      lesson_id: demoLessonId,
      course_id: demoCourseId,
      title: "امتحان الحصة الأولى",
      duration_seconds: 300,
      shuffle_questions: false,
      shuffle_options: false,
      questions: [
        {
          id: "q1",
          text: "ما هو العنصر الرئيسي في الماء؟",
          options: ["الهيدروجين", "الكربون", "النيتروجين", "الحديد"],
          correct_index: 0,
          explanation: "الماء = H₂O، الهيدروجين والأكسجين.",
        },
        {
          id: "q2",
          text: "كم عدد إلكترونات الكربون؟",
          options: ["4", "6", "8", "12"],
          correct_index: 1,
        },
      ],
      created_at: now,
    };
    await upsert<Quiz>("quizzes", quiz);
  }

  const vouchers = await getCollection<Voucher>("vouchers");
  const demoCode = "DEMO-1234-5678";
  if (!vouchers.find((v) => v.code === demoCode)) {
    const voucher: Voucher = {
      code: demoCode,
      batch_id: "demo-batch",
      course_id: demoCourseId,
      duration_days: 30,
      used_by: null,
      used_at: null,
      created_at: now,
    };
    vouchers.push(voucher);
    const { setCollection } = await import("./repo.server");
    await setCollection<Voucher>("vouchers", vouchers);
  }

  return {
    ok: true,
    course_id: demoCourseId,
    voucher_code: demoCode,
    message: `تم إنشاء كورس تجريبي + حصة + امتحان + كود تفعيل (${demoCode}) صالح 30 يوم.`,
  };
});
