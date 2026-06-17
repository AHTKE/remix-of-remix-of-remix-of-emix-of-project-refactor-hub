// ============================================================
// Student/Teacher web portal — server functions.
// Pulls from the same Telegram-channel-backed store the bot uses.
// ============================================================
import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import type {
  Attempt,
  Book,
  BookPurchase,
  BroadcastRecord,
  Course,
  Homework,
  HomeworkSubmission,
  Lesson,
  PendingRegistration,
  Quiz,
  Student,
  SupportMessage,
  SupportTicket,
  TopupRequest,
  Voucher,
  WalletTransaction,
} from "./types";

const STUDENT_COOKIE = "amw_student_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function cookieSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.ADMIN_PASSWORD ||
    "amw-lms-student-cookie-secret-v1"
  );
}

async function sign(value: string) {
  const { createHmac } = await import("crypto");
  return createHmac("sha256", cookieSecret()).update(value).digest("base64url");
}

async function makeCookie(uid: number) {
  const expires = Date.now() + COOKIE_MAX_AGE * 1000;
  const payload = `${uid}.${expires}`;
  return `${payload}.${await sign(payload)}`;
}

async function readCookie(): Promise<number | null> {
  const raw = getCookie(STUDENT_COOKIE) || "";
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [uid, expires, signature] = parts;
  if (!uid || !expires || !signature) return null;
  if (Number(expires) < Date.now()) return null;
  const expected = await sign(`${uid}.${expires}`);
  if (expected !== signature) return null;
  const n = Number(uid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function requireStudent(): Promise<Student> {
  const uid = await readCookie();
  if (!uid) throw new Error("غير مسجل. الرجاء تسجيل الدخول.");
  const { getCollection } = await import("./repo.server");
  const s = (await getCollection<Student>("students")).find((x) => x.id === uid);
  if (!s) throw new Error("الحساب غير موجود.");
  if (s.banned) throw new Error("تم تعليق الحساب.");
  return s;
}

// ============================================================
// Phone-verified registration
//   1) Student fills the form on /login → studentStartRegistration
//      → server stores PendingRegistration + 6-digit code, keyed by phone.
//   2) Student opens the bot in Telegram and shares their contact.
//      The bot matches the phone → records telegram_id on the pending row
//      and replies with the code (handled in bot-handler.server.ts).
//   3) Student types the code on /login → studentConfirmCode
//      → server creates/updates Student record, sets session cookie.
// ============================================================

function normalizeDigits(raw: string): string {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const easternArabic = "۰۱۲۳۴۵۶۷۸۹";
  return String(raw || "")
    .replace(/[٠-٩]/g, (d) => String(arabicIndic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternArabic.indexOf(d)));
}

export function normalizePhone(raw: string): string {
  const digits = normalizeDigits(raw).replace(/\D/g, "");
  if (!digits) return "";
  // Strip international "00" prefix
  let d = digits.startsWith("00") ? digits.slice(2) : digits;
  // Egyptian local form "01xxxxxxxxx" → "201xxxxxxxxx"
  if (d.startsWith("0") && d.length === 11) d = "20" + d.slice(1);
  // Bare "1xxxxxxxxx" (10 digits) → "201xxxxxxxxx"
  else if (d.length === 10 && d.startsWith("1")) d = "20" + d;
  return d;
}

function isValidEgyptPhone(normalized: string): boolean {
  // e.g. 201012345678
  return /^201[0125]\d{8}$/.test(normalized);
}

const PENDING_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_RESENDS = 3;
const RESEND_COOLDOWN_MS = 30 * 1000;

function isStudentCookieSecure() {
  return process.env.NODE_ENV === "production";
}

function normalizeFullArabicName(raw: string): string {
  return String(raw || "").replace(/ـ/g, "").trim().replace(/\s+/g, " ");
}

function validateFullArabicName(raw: string): string {
  const name = normalizeFullArabicName(raw);
  const parts = name.split(" ").filter(Boolean);
  const validPart = /^[\u0621-\u064A\u0671-\u06D3]{2,}$/u;
  if (parts.length !== 4 || parts.some((p) => !validPart.test(p) || /[\d٠-٩۰-۹]/.test(p))) {
    throw new Error("اكتب الاسم رباعي: أربع كلمات عربية بدون أرقام أو رموز.");
  }
  return parts.join(" ");
}

function gen6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function genToken() {
  // 16-char URL-safe token (Telegram /start payload limit is 64 chars).
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
}

function resendCooldownRemaining(p: PendingRegistration): number {
  if (!p.last_resent_at) return 0;
  const elapsed = Date.now() - new Date(p.last_resent_at).getTime();
  return Math.max(0, RESEND_COOLDOWN_MS - elapsed);
}

const RegisterSchema = z.object({
  full_name: z.string().trim(),
  grade: z.enum(["g1", "g2", "g3"]),
  track: z.enum(["general", "azhar"]),
  student_phone: z.string(),
  parent_phone: z.string(),
  password: z.string().min(6, "كلمة المرور لازم تكون 6 أحرف على الأقل").max(128),
});

// ---------- Password hashing (scrypt) ----------
async function hashPassword(plain: string): Promise<string> {
  const { scryptSync, randomBytes } = await import("crypto");
  const salt = randomBytes(16);
  const derived = scryptSync(plain, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  try {
    const { scryptSync, timingSafeEqual } = await import("crypto");
    const salt = Buffer.from(parts[1], "base64url");
    const expected = Buffer.from(parts[2], "base64url");
    const actual = scryptSync(plain, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function normalizeNameKey(raw: string): string {
  return normalizeFullArabicName(raw).toLowerCase();
}

export const studentStartRegistration = createServerFn({ method: "POST" })
  .inputValidator((d) => RegisterSchema.parse(d))
  .handler(async ({ data }) => {
    const fullName = validateFullArabicName(data.full_name);
    const student_phone = normalizePhone(data.student_phone);
    const parent_phone = normalizePhone(data.parent_phone);
    if (!isValidEgyptPhone(student_phone)) {
      throw new Error("رقم الطالب غير صحيح (11 رقم يبدأ بـ 01).");
    }
    if (!isValidEgyptPhone(parent_phone)) {
      throw new Error("رقم ولي الأمر غير صحيح (11 رقم يبدأ بـ 01).");
    }
    if (student_phone === parent_phone) {
      throw new Error("رقم ولي الأمر لازم يختلف عن رقم الطالب.");
    }
    const now = Date.now();
    const { getCollection, upsert } = await import("./repo.server");

    // Hash password fresh every time the form is submitted so updates take effect.
    const password_hash = await hashPassword(data.password);

    // Preserve an existing, still-valid pending row so the user can recover the
    // same code on refresh instead of getting a brand-new one each submit.
    const existing = (await getCollection<PendingRegistration>("pending_registrations"))
      .find((x) => x.id === student_phone);
    const stillValid = existing && new Date(existing.expires_at).getTime() > now;

    const pending: PendingRegistration = {
      id: student_phone,
      full_name: fullName,
      grade: data.grade,
      track: data.track,
      student_phone,
      parent_phone,
      code: stillValid ? existing!.code : gen6(),
      attempts: stillValid ? (existing!.attempts || 0) : 0,
      telegram_id: stillValid ? (existing!.telegram_id ?? null) : null,
      expires_at: stillValid ? existing!.expires_at : new Date(now + PENDING_TTL_MS).toISOString(),
      created_at: stillValid ? existing!.created_at : new Date(now).toISOString(),
      resend_count: stillValid ? (existing!.resend_count || 0) : 0,
      last_resent_at: stillValid ? existing!.last_resent_at : new Date(now).toISOString(),
      token: stillValid && existing!.token ? existing!.token : genToken(),
      password_hash,
    };
    await upsert<PendingRegistration>("pending_registrations", pending);

    // Try to surface a Telegram bot deep-link so the UI can show "Open bot".
    let bot_username = "";
    try {
      const { tg } = await import("./telegram.server");
      const me = await tg<any>("getMe");
      bot_username = me?.username || "";
    } catch {}
    const bot_link = bot_username
      ? `https://t.me/${bot_username}?start=${pending.token}`
      : "";
    return { ok: true, phone: student_phone, bot_username, bot_link, token: pending.token };
  });

export const studentPendingStatus = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ phone: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    if (!phone) return { status: "not_found" as const, message: "ابدأ طلب التسجيل من جديد." };
    const { getCollectionFresh } = await import("./repo.server");
    const p = (await getCollectionFresh<PendingRegistration>("pending_registrations")).find((x) => x.id === phone);
    if (!p) {
      return { status: "not_found" as const, message: "لا يوجد طلب تسجيل مفتوح لهذا الرقم أو تم تسجيل الدخول بالفعل." };
    }
    const expiresAt = new Date(p.expires_at).getTime();
    if (expiresAt < Date.now()) {
      return { status: "expired" as const, expires_at: p.expires_at, message: "انتهت صلاحية الطلب. ابدأ تسجيل الطالب من جديد." };
    }
    const attempts_remaining = Math.max(0, MAX_CODE_ATTEMPTS - (p.attempts || 0));
    const resends_remaining = Math.max(0, MAX_RESENDS - (p.resend_count || 0));
    const cooldown_ms = resendCooldownRemaining(p);
    if (p.telegram_id) {
      return {
        status: "verified" as const,
        expires_at: p.expires_at,
        attempts_remaining,
        resends_remaining,
        cooldown_ms,
        message: "تم استلام رقمك من البوت. اكتب الكود الذي وصلك في تيليجرام.",
      };
    }
    return {
      status: "waiting" as const,
      expires_at: p.expires_at,
      attempts_remaining,
      resends_remaining,
      cooldown_ms,
      message: "اضغط زر «فتح البوت في تيليجرام» علشان البوت يبعتلك الكود.",
    };
  });

export const studentResendCode = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ phone: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    if (!phone) throw new Error("رقم الهاتف غير صحيح.");
    const { getCollectionFresh, setCollection } = await import("./repo.server");
    const pendings = await getCollectionFresh<PendingRegistration>("pending_registrations");
    const p = pendings.find((x) => x.id === phone);
    if (!p) throw new Error("لا يوجد طلب تسجيل مفتوح. ابدأ من جديد.");
    if (new Date(p.expires_at).getTime() < Date.now()) {
      throw new Error("انتهت صلاحية الطلب. ابدأ من جديد.");
    }
    if ((p.resend_count || 0) >= MAX_RESENDS) {
      throw new Error("تجاوزت الحد الأقصى لإعادة إرسال الكود. ابدأ تسجيل جديد.");
    }
    const cooldown = resendCooldownRemaining(p);
    if (cooldown > 0) {
      throw new Error(`انتظر ${Math.ceil(cooldown / 1000)} ثانية قبل إعادة الإرسال.`);
    }
    p.code = gen6();
    p.attempts = 0;
    p.resend_count = (p.resend_count || 0) + 1;
    p.last_resent_at = new Date().toISOString();
    // Extend the TTL by another full window so the new code is usable.
    p.expires_at = new Date(Date.now() + PENDING_TTL_MS).toISOString();
    const idx = pendings.findIndex((x) => x.id === p.id);
    if (idx >= 0) pendings[idx] = p;
    await setCollection("pending_registrations", pendings);

    // If we already know the telegram_id, push the new code through the bot.
    let delivered = false;
    if (p.telegram_id) {
      try {
        const { tg } = await import("./telegram.server");
        await tg("sendMessage", {
          chat_id: p.telegram_id,
          text: `🔐 كود الدخول الجديد: <code>${p.code}</code>\n\nاكتب الكود في صفحة تسجيل الدخول خلال 15 دقيقة.`,
          parse_mode: "HTML",
        });
        delivered = true;
      } catch (e) {
        console.error("studentResendCode: failed to push new code via Telegram", e);
      }
    }
    return {
      ok: true,
      delivered,
      expires_at: p.expires_at,
      resends_remaining: Math.max(0, MAX_RESENDS - p.resend_count),
      cooldown_ms: RESEND_COOLDOWN_MS,
    };
  });


const ConfirmSchema = z.object({
  phone: z.string(),
  code: z.string().regex(/^\d{6}$/),
});

export const studentConfirmCode = createServerFn({ method: "POST" })
  .inputValidator((d) => ConfirmSchema.parse(d))
  .handler(async ({ data }) => {
    const phone = normalizePhone(data.phone);
    const { getCollection, getCollectionFresh, setCollection, upsert, removeById } = await import("./repo.server");
    const pendings = await getCollectionFresh<PendingRegistration>("pending_registrations");
    const p = pendings.find((x) => x.id === phone);
    if (!p) throw new Error("لا يوجد طلب تسجيل لهذا الرقم. ابدأ من جديد.");
    if (new Date(p.expires_at).getTime() < Date.now()) {
      await removeById<PendingRegistration>("pending_registrations", p.id);
      throw new Error("انتهت صلاحية الكود. ابدأ من جديد.");
    }
    if (!p.telegram_id) console.warn(`[student-confirm] code matched pending phone=${phone} but telegram_id is missing; continuing registration`);
    const { timingSafeEqual } = await import("crypto");
    const a = Buffer.from(p.code);
    const b = Buffer.from(data.code);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      p.attempts = (p.attempts || 0) + 1;
      if (p.attempts >= MAX_CODE_ATTEMPTS) {
        await removeById<PendingRegistration>("pending_registrations", p.id);
        throw new Error("تم تجاوز عدد المحاولات. ابدأ من جديد.");
      }
      const idx = pendings.findIndex((x) => x.id === p.id);
      if (idx >= 0) pendings[idx] = p;
      await setCollection("pending_registrations", pendings);
      throw new Error(`كود غير صحيح. باقي ${MAX_CODE_ATTEMPTS - p.attempts} محاولات.`);
    }

    // Create / update the student record
    const students = await getCollection<Student>("students");
    const studentId = p.telegram_id || Number(phone);
    let s = students.find((x) => x.id === studentId || x.phone_number === p.student_phone);
    const now = new Date().toISOString();
    if (!s) {
      s = {
        id: studentId,
        student_code: "STD-" + studentId.toString(36).toUpperCase().slice(-6),
        first_name: p.full_name.split(/\s+/)[0],
        joined_at: now,
        subscriptions: [],
        device: null,
        locked: false,
        banned: false,
        points: 0,
        last_active: now,
      };
    }
    s.full_name = p.full_name;
    s.grade = p.grade;
    s.track = p.track;
    s.phone_number = p.student_phone;
    s.parent_phone = p.parent_phone;
    s.last_active = now;
    if (p.password_hash) s.password_hash = p.password_hash;
    await upsert<Student>("students", s);
    await removeById<PendingRegistration>("pending_registrations", p.id);

    setCookie(STUDENT_COOKIE, await makeCookie(s.id), {
      httpOnly: true,
      secure: isStudentCookieSecure(),
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    const { getAdminIds } = await import("./bot-features.server");
    const isTeacher = getAdminIds().includes(s.id);
    return { ok: true, isTeacher, studentCode: s.student_code };
  });

// ---------- Name + password login for returning students ----------
const PasswordLoginSchema = z.object({
  full_name: z.string().trim().min(3),
  password: z.string().min(1),
});

export const studentPasswordLogin = createServerFn({ method: "POST" })
  .inputValidator((d) => PasswordLoginSchema.parse(d))
  .handler(async ({ data }) => {
    const nameKey = normalizeNameKey(data.full_name);
    if (!nameKey) throw new Error("اكتب الاسم بشكل صحيح.");
    const { getCollection, upsert } = await import("./repo.server");
    const students = await getCollection<Student>("students");
    const matches = students.filter(
      (x) => x.full_name && normalizeNameKey(x.full_name) === nameKey,
    );
    if (matches.length === 0) {
      throw new Error("لا يوجد حساب بهذا الاسم. أنشئ حساب جديد أولاً.");
    }
    // Try each match (handles rare name collisions); first password match wins.
    let s: Student | null = null;
    for (const candidate of matches) {
      if (candidate.password_hash && (await verifyPassword(data.password, candidate.password_hash))) {
        s = candidate;
        break;
      }
    }
    if (!s) {
      throw new Error("كلمة المرور غير صحيحة، أو الحساب اتسجل قبل ما يتم تفعيل كلمات السر.");
    }
    if (s.banned) throw new Error("الحساب موقوف. تواصل مع الدعم.");
    s.last_active = new Date().toISOString();
    await upsert<Student>("students", s);
    setCookie(STUDENT_COOKIE, await makeCookie(s.id), {
      httpOnly: true,
      secure: isStudentCookieSecure(),
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
    const { getAdminIds } = await import("./bot-features.server");
    const isTeacher = getAdminIds().includes(s.id);
    return { ok: true, isTeacher, studentCode: s.student_code };
  });

// ---------- Forgot password: re-verify via Telegram, then set a new password ----------
const ResetSchema = z.object({
  student_phone: z.string(),
  password: z.string().min(6, "كلمة المرور لازم تكون 6 أحرف على الأقل").max(128),
});

export const studentStartPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((d) => ResetSchema.parse(d))
  .handler(async ({ data }) => {
    const student_phone = normalizePhone(data.student_phone);
    if (!isValidEgyptPhone(student_phone)) {
      throw new Error("رقم الطالب غير صحيح (11 رقم يبدأ بـ 01).");
    }
    const { getCollection, getCollectionFresh, upsert } = await import("./repo.server");
    const students = await getCollection<Student>("students");
    const s = students.find((x) => x.phone_number === student_phone);
    if (!s) {
      throw new Error("لا يوجد حساب مسجَّل بهذا الرقم. أنشئ حساب جديد.");
    }
    if (s.banned) throw new Error("الحساب موقوف. تواصل مع الدعم.");

    const now = Date.now();
    const password_hash = await hashPassword(data.password);
    const existing = (await getCollectionFresh<PendingRegistration>("pending_registrations"))
      .find((x) => x.id === student_phone);
    const stillValid = existing && new Date(existing.expires_at).getTime() > now;

    const pending: PendingRegistration = {
      id: student_phone,
      full_name: s.full_name || (s.first_name || "") + (s.last_name ? " " + s.last_name : ""),
      grade: (s.grade as any) || "g1",
      track: (s.track as any) || "general",
      student_phone,
      parent_phone: s.parent_phone || student_phone,
      code: stillValid ? existing!.code : gen6(),
      attempts: 0,
      telegram_id: s.id, // bind to known student account so bot can deliver immediately
      expires_at: new Date(now + PENDING_TTL_MS).toISOString(),
      created_at: stillValid ? existing!.created_at : new Date(now).toISOString(),
      resend_count: stillValid ? (existing!.resend_count || 0) : 0,
      last_resent_at: new Date(now).toISOString(),
      token: stillValid && existing!.token ? existing!.token : genToken(),
      password_hash,
    };
    await upsert<PendingRegistration>("pending_registrations", pending);

    // Try to push the code immediately if we already have a telegram chat with them.
    let delivered = false;
    try {
      const { tg } = await import("./telegram.server");
      await tg("sendMessage", {
        chat_id: s.id,
        text: `🔁 طلب استعادة كلمة المرور\n\n🔐 الكود: <code>${pending.code}</code>\n\nاكتب الكود في صفحة استعادة كلمة المرور خلال 15 دقيقة. لو ما طلبتش ده، تجاهل الرسالة.`,
        parse_mode: "HTML",
      });
      delivered = true;
    } catch {}

    let bot_username = "";
    try {
      const { tg } = await import("./telegram.server");
      const me = await tg<any>("getMe");
      bot_username = me?.username || "";
    } catch {}
    const bot_link = bot_username
      ? `https://t.me/${bot_username}?start=${pending.token}`
      : "";
    return { ok: true, phone: student_phone, bot_username, bot_link, delivered };
  });

export const studentLogout = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(STUDENT_COOKIE, { path: "/" });
  return { ok: true };
});

export const studentStatus = createServerFn({ method: "GET" }).handler(async () => {
  const uid = await readCookie();
  if (!uid) return { loggedIn: false as const };
  const { getCollection } = await import("./repo.server");
  const s = (await getCollection<Student>("students")).find((x) => x.id === uid);
  if (!s) return { loggedIn: false as const };
  const { getAdminIds } = await import("./bot-features.server");
  return {
    loggedIn: true as const,
    student: {
      id: s.id,
      student_code: s.student_code,
      first_name: s.first_name,
      last_name: s.last_name,
      username: s.username,
      wallet_balance: Number(s.wallet_balance || 0),
      points: s.points || 0,
      banned: !!s.banned,
    },
    isTeacher: getAdminIds().includes(s.id),
  };
});

export const getBotUsername = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { tg } = await import("./telegram.server");
    const me = await tg<any>("getMe");
    return { username: me.username as string };
  } catch (e: any) {
    return { username: "", error: e.message };
  }
});

// ============================================================
// COURSES / LESSONS
// ============================================================

export const getMyCourses = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireStudent();
  const { getCollection, getCollectionFresh } = await import("./repo.server");
  let [courses, lessons] = await Promise.all([
    getCollection<Course>("courses"),
    getCollection<Lesson>("lessons"),
  ]);
  // Stale per-isolate cache fallback: when student has subscriptions but
  // courses/lessons aren't visible (recently added via bot/admin in another
  // worker), force a fresh read from the data channel.
  if (s.subscriptions.length > 0 && (courses.length === 0 || lessons.length === 0)) {
    [courses, lessons] = await Promise.all([
      getCollectionFresh<Course>("courses"),
      getCollectionFresh<Lesson>("lessons"),
    ]);
  }
  const counts: Record<string, number> = {};
  for (const l of lessons) counts[l.course_id] = (counts[l.course_id] || 0) + 1;
  const now = Date.now();
  return s.subscriptions
    .map((sub) => {
      const c = courses.find((x) => x.id === sub.course_id);
      if (!c) return null;
      return {
        id: c.id,
        title: c.title,
        subtitle: c.subtitle,
        cover_file_id: c.cover_file_id,
        cover_url: c.cover_url,
        lesson_count: counts[c.id] || 0,
        expires_at: sub.expires_at,
        active: new Date(sub.expires_at).getTime() > now,
      };
    })
    .filter(Boolean) as Array<any>;
});

export const getCourseLessons = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ courseId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const sub = s.subscriptions.find((x) => x.course_id === data.courseId);
    if (!sub || new Date(sub.expires_at).getTime() < Date.now()) {
      throw new Error("الاشتراك غير نشط لهذا الكورس.");
    }
    const { getCollection, getCollectionFresh } = await import("./repo.server");
    let [courses, lessons, homework] = await Promise.all([
      getCollection<Course>("courses"),
      getCollection<Lesson>("lessons"),
      getCollection<Homework>("homework"),
    ]);
    let course = courses.find((c) => c.id === data.courseId);
    let courseLessons = lessons.filter((l) => l.course_id === data.courseId);
    // Stale-cache fallback: bot/admin may have added the course or lessons
    // in another isolate. Re-fetch from source before reporting "empty".
    if (!course || courseLessons.length === 0) {
      [courses, lessons, homework] = await Promise.all([
        getCollectionFresh<Course>("courses"),
        getCollectionFresh<Lesson>("lessons"),
        getCollectionFresh<Homework>("homework"),
      ]);
      course = courses.find((c) => c.id === data.courseId);
      courseLessons = lessons.filter((l) => l.course_id === data.courseId);
    }
    if (!course) throw new Error("الكورس غير موجود.");
    const items = courseLessons
      .sort((a, b) => a.order - b.order)
      .map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        resource_count: l.resources?.length || 0,
        has_quiz: !!l.quiz_id,
        homework_count: homework.filter((h) => h.lesson_id === l.id).length,
      }));
    return { course, lessons: items, expires_at: sub.expires_at };
  });

export const getLesson = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ lessonId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const { getCollection, getCollectionFresh } = await import("./repo.server");
    let lesson = (await getCollection<Lesson>("lessons")).find((l) => l.id === data.lessonId);
    if (!lesson) {
      lesson = (await getCollectionFresh<Lesson>("lessons")).find((l) => l.id === data.lessonId);
    }
    if (!lesson) throw new Error("الحصة غير موجودة.");
    const sub = s.subscriptions.find((x) => x.course_id === lesson.course_id);
    if (!sub || new Date(sub.expires_at).getTime() < Date.now()) {
      throw new Error("الاشتراك غير نشط لهذا الكورس.");
    }
    const [homework, submissions, quizzes] = await Promise.all([
      getCollection<Homework>("homework"),
      getCollection<HomeworkSubmission>("homework_submissions"),
      getCollection<Quiz>("quizzes"),
    ]);
    const lessonHomework = homework
      .filter((h) => h.lesson_id === lesson!.id)
      .map((h) => {
        const last = submissions
          .filter((x) => x.homework_id === h.id && x.student_id === s.id)
          .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
        return {
          id: h.id,
          title: h.title,
          instructions: h.instructions,
          due_at: h.due_at,
          max_score: h.max_score,
          last_submission: last ? {
            submitted_at: last.submitted_at,
            graded_at: last.graded_at,
            score: last.score,
            feedback: last.feedback,
          } : null,
        };
      });
    return { ...lesson, homework: lessonHomework, quiz_title: quizzes.find((q) => q.id === lesson!.quiz_id)?.title || null };
  });

// ============================================================
// WALLET / REDEEM / TOPUP
// ============================================================

export const getMyWallet = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireStudent();
  const { getCollection } = await import("./repo.server");
  const [txs, topups] = await Promise.all([
    getCollection<WalletTransaction>("wallet_tx"),
    getCollection<TopupRequest>("topup_requests"),
  ]);
  return {
    balance: Number(s.wallet_balance || 0),
    transactions: txs
      .filter((t) => t.student_id === s.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50),
    topups: topups
      .filter((t) => t.student_id === s.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 20),
  };
});

export const redeemVoucher = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: z.string().min(4).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const { getCollection, setCollection, upsert } = await import("./repo.server");
    const code = data.code.toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z0-9-]{6,40}$/.test(code)) throw new Error("صيغة الكود غير صحيحة.");
    const vouchers = await getCollection<Voucher>("vouchers");
    const v = vouchers.find((x) => x.code === code);
    if (!v) throw new Error("كود غير صحيح.");
    if (v.used_by && v.used_by !== s.id) throw new Error("هذا الكود مستخدم بالفعل.");
    const now = new Date();
    const existing = s.subscriptions.find((x) => x.course_id === v.course_id);
    const base = existing && new Date(existing.expires_at) > now ? new Date(existing.expires_at) : now;
    const expires = new Date(base.getTime() + v.duration_days * 86_400_000);
    if (existing) {
      existing.expires_at = expires.toISOString();
      existing.voucher_code = v.code;
    } else {
      s.subscriptions.push({
        course_id: v.course_id,
        voucher_code: v.code,
        started_at: now.toISOString(),
        expires_at: expires.toISOString(),
      });
    }
    v.used_by = s.id;
    v.used_at = now.toISOString();
    const all = await getCollection<Voucher>("vouchers");
    const idx = all.findIndex((x) => x.code === v.code);
    if (idx >= 0) all[idx] = v;
    await setCollection("vouchers", all);
    await upsert<Student>("students", s);
    const courses = await getCollection<Course>("courses");
    const c = courses.find((x) => x.id === v.course_id);
    try {
      const { tg } = await import("./telegram.server");
      const { getAdminIds } = await import("./bot-features.server");
      await tg("sendMessage", {
        chat_id: s.id,
        text: `✅ تم فتح الكورس على المنصة\n📚 ${c?.title || v.course_id}\n⏰ صالح حتى ${expires.toLocaleDateString("ar-EG")}`,
      }).catch(() => {});
      for (const aid of getAdminIds()) {
        await tg("sendMessage", {
          chat_id: aid,
          text: `🎟️ تفعيل اشتراك من المنصة\nالطالب: ${s.student_code}\nالكورس: ${c?.title || v.course_id}\nالكود: ${v.code}`,
        }).catch(() => {});
      }
    } catch {}
    return { ok: true, course_id: v.course_id, course_title: c?.title || v.course_id, expires_at: expires.toISOString() };
  });

export const requestTopup = createServerFn({ method: "POST" })
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("FormData مطلوب");
    return d;
  })
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const amount = Number(String(data.get("amount") || "0").replace(/[^\d.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("مبلغ غير صحيح.");
    const file = data.get("receipt");
    if (!(file instanceof File) || file.size === 0) throw new Error("صورة الإيصال مطلوبة.");
    const { uploadMediaToChannel } = await import("./telegram.server");
    const uploaded = await uploadMediaToChannel(
      file,
      (file.type || "").startsWith("image/") ? "photo" : "document",
    );
    const { upsert } = await import("./repo.server");
    const req: TopupRequest = {
      id: `tu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      student_id: s.id,
      amount,
      method: "manual",
      receipt_file_id: uploaded.file_id,
      note: String(data.get("note") || "") || undefined,
      status: "pending",
      created_at: new Date().toISOString(),
    };
    await upsert<TopupRequest>("topup_requests", req);
    // notify admins
    try {
      const { tg } = await import("./telegram.server");
      const { getAdminIds } = await import("./bot-features.server");
      for (const aid of getAdminIds()) {
        await tg("sendMessage", {
          chat_id: aid,
          text: `💳 طلب شحن جديد من الويب\nالطالب: ${s.student_code}\nالمبلغ: ${amount} ج\nID: ${req.id}`,
        }).catch(() => {});
      }
    } catch {}
    return { ok: true };
  });

// ============================================================
// HOMEWORK
// ============================================================

export const listMyHomework = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireStudent();
  const { getCollection } = await import("./repo.server");
  const [hws, subs, courses, lessons] = await Promise.all([
    getCollection<Homework>("homework"),
    getCollection<HomeworkSubmission>("homework_submissions"),
    getCollection<Course>("courses"),
    getCollection<Lesson>("lessons"),
  ]);
  const now = Date.now();
  const myCourseIds = new Set(
    s.subscriptions
      .filter((x) => new Date(x.expires_at).getTime() > now)
      .map((x) => x.course_id),
  );
  return hws
    .filter((h) => myCourseIds.has(h.course_id))
    .map((h) => {
      const mySubs = subs
        .filter((x) => x.homework_id === h.id && x.student_id === s.id)
        .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
      const last = mySubs[0];
      return {
        id: h.id,
        title: h.title,
        instructions: h.instructions,
        due_at: h.due_at,
        max_score: h.max_score,
        course_title: courses.find((c) => c.id === h.course_id)?.title || "",
        lesson_title: lessons.find((l) => l.id === h.lesson_id)?.title || "",
        last_submission: last
          ? {
              submitted_at: last.submitted_at,
              graded_at: last.graded_at,
              score: last.score,
              feedback: last.feedback,
            }
          : null,
      };
    })
    .sort((a, b) => (a.due_at || "").localeCompare(b.due_at || ""));
});

export const submitHomework = createServerFn({ method: "POST" })
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("FormData مطلوب");
    return d;
  })
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const hwId = String(data.get("homework_id") || "");
    const text = String(data.get("text") || "").trim();
    if (!hwId) throw new Error("الواجب غير محدد.");
    const { findById, upsert } = await import("./repo.server");
    const hw = await findById<Homework>("homework", hwId);
    if (!hw) throw new Error("الواجب غير موجود.");
    if (hw.due_at && new Date(hw.due_at).getTime() < Date.now()) {
      throw new Error("انتهى موعد التسليم.");
    }
    let file_id: string | null = null;
    let file_kind: "photo" | "document" | null = null;
    const file = data.get("file");
    if (file instanceof File && file.size > 0) {
      const { uploadMediaToChannel } = await import("./telegram.server");
      const up = await uploadMediaToChannel(
        file,
        (file.type || "").startsWith("image/") ? "photo" : "document",
      );
      file_id = up.file_id;
      file_kind = up.kind === "photo" ? "photo" : "document";
    }
    if (!text && !file_id) throw new Error("اكتب إجابة أو ارفع ملف.");
    const sub: HomeworkSubmission = {
      id: `hs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      homework_id: hwId,
      student_id: s.id,
      text: text || undefined,
      file_id,
      file_kind,
      submitted_at: new Date().toISOString(),
    };
    await upsert<HomeworkSubmission>("homework_submissions", sub);
    try {
      const { tg } = await import("./telegram.server");
      const { getAdminIds } = await import("./bot-features.server");
      for (const aid of getAdminIds()) {
        await tg("sendMessage", {
          chat_id: aid,
          text: `📥 تسليم واجب من الويب\nالطالب: ${s.student_code}\nالواجب: ${hw.title}\nالتصحيح: /grade ${sub.id} <score> <feedback>`,
        }).catch(() => {});
      }
    } catch {}
    return { ok: true };
  });

// ============================================================
// QUIZZES
// ============================================================

export const listMyQuizzes = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireStudent();
  const { getCollection } = await import("./repo.server");
  const [quizzes, attempts, lessons, courses] = await Promise.all([
    getCollection<Quiz>("quizzes"),
    getCollection<Attempt>("attempts"),
    getCollection<Lesson>("lessons"),
    getCollection<Course>("courses"),
  ]);
  const now = Date.now();
  const myCourseIds = new Set(
    s.subscriptions
      .filter((x) => new Date(x.expires_at).getTime() > now)
      .map((x) => x.course_id),
  );
  return quizzes
    .filter((q) => {
      if (q.course_id && myCourseIds.has(q.course_id)) return true;
      if (q.lesson_id) {
        const l = lessons.find((x) => x.id === q.lesson_id);
        return l ? myCourseIds.has(l.course_id) : false;
      }
      return false;
    })
    .map((q) => {
      const myAttempts = attempts
        .filter((a) => a.quiz_id === q.id && a.student_id === s.id && a.ended_at)
        .sort((a, b) => (b.ended_at || "").localeCompare(a.ended_at || ""));
      const best = myAttempts.reduce(
        (acc, a) => (Number(a.score || 0) > Number(acc?.score || -1) ? a : acc),
        null as Attempt | null,
      );
      const courseId =
        q.course_id || lessons.find((l) => l.id === q.lesson_id)?.course_id || "";
      return {
        id: q.id,
        title: q.title,
        duration_seconds: q.duration_seconds,
        question_count: q.questions.length,
        course_title: courses.find((c) => c.id === courseId)?.title || "",
        best_score: best?.score ?? null,
        total: best?.total ?? q.questions.length,
        attempts: myAttempts.length,
      };
    });
});

export const getQuizForTaking = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ quizId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const { findById, getCollection } = await import("./repo.server");
    const q = await findById<Quiz>("quizzes", data.quizId);
    if (!q) throw new Error("الامتحان غير موجود.");
    // verify access
    let courseId = q.course_id;
    if (!courseId && q.lesson_id) {
      const lessons = await getCollection<Lesson>("lessons");
      courseId = lessons.find((l) => l.id === q.lesson_id)?.course_id;
    }
    if (courseId) {
      const sub = s.subscriptions.find((x) => x.course_id === courseId);
      if (!sub || new Date(sub.expires_at).getTime() < Date.now()) {
        throw new Error("الاشتراك غير نشط لهذا الكورس.");
      }
    }
    // strip correct answers
    return {
      id: q.id,
      title: q.title,
      duration_seconds: q.duration_seconds,
      questions: q.questions.map((qq) => ({
        id: qq.id,
        text: qq.text,
        image_file_id: qq.image_file_id,
        options: qq.options,
      })),
    };
  });

export const submitQuizAttempt = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        quiz_id: z.string(),
        answers: z.array(z.object({ qid: z.string(), chosen_index: z.number() })),
        started_at: z.string(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const { findById, upsert } = await import("./repo.server");
    const q = await findById<Quiz>("quizzes", data.quiz_id);
    if (!q) throw new Error("الامتحان غير موجود.");
    let score = 0;
    for (const ans of data.answers) {
      const qq = q.questions.find((x) => x.id === ans.qid);
      if (qq && qq.correct_index === ans.chosen_index) score++;
    }
    const attempt: Attempt = {
      id: `at_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      quiz_id: q.id,
      student_id: s.id,
      started_at: data.started_at,
      ended_at: new Date().toISOString(),
      score,
      total: q.questions.length,
      answers: data.answers,
    };
    await upsert<Attempt>("attempts", attempt);
    return {
      ok: true,
      score,
      total: q.questions.length,
      review: q.questions.map((qq) => {
        const a = data.answers.find((x) => x.qid === qq.id);
        return {
          id: qq.id,
          text: qq.text,
          options: qq.options,
          correct_index: qq.correct_index,
          chosen_index: a?.chosen_index ?? -1,
          explanation: qq.explanation,
        };
      }),
    };
  });

// ============================================================
// SUPPORT — single rolling thread per student
// ============================================================

const SUPPORT_DEFAULT_SUBJECT = "محادثة الدعم الفني";

async function ensureSupportTicket(student: Student): Promise<SupportTicket> {
  const { getCollection, upsert } = await import("./repo.server");
  const tickets = await getCollection<SupportTicket>("support_tickets");
  let t = tickets
    .filter((x) => x.student_id === student.id && x.status === "open")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (!t) {
    t = {
      id: `tk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      student_id: student.id,
      subject: SUPPORT_DEFAULT_SUBJECT,
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await upsert<SupportTicket>("support_tickets", t);
  }
  return t;
}

export const getMySupport = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireStudent();
  const t = await ensureSupportTicket(s);
  const { getCollection } = await import("./repo.server");
  const msgs = (await getCollection<SupportMessage>("support_messages"))
    .filter((m) => m.ticket_id === t.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    ticket: t,
    messages: msgs.map((m) => ({
      id: m.id,
      role: m.author_role,
      text: m.text,
      file_id: m.file_id,
      file_kind: m.file_kind,
      created_at: m.created_at,
    })),
  };
});

export const sendSupportMessage = createServerFn({ method: "POST" })
  .inputValidator((d) => {
    if (!(d instanceof FormData)) throw new Error("FormData مطلوب");
    return d;
  })
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const text = String(data.get("text") || "").trim();
    let file_id: string | null = null;
    let file_kind: "photo" | "document" | null = null;
    const file = data.get("file");
    if (file instanceof File && file.size > 0) {
      const { uploadMediaToChannel } = await import("./telegram.server");
      const up = await uploadMediaToChannel(
        file,
        (file.type || "").startsWith("image/") ? "photo" : "document",
      );
      file_id = up.file_id;
      file_kind = up.kind === "photo" ? "photo" : "document";
    }
    if (!text && !file_id) throw new Error("اكتب رسالة أو ارفق ملف.");
    const t = await ensureSupportTicket(s);
    const { upsert } = await import("./repo.server");
    const sm: SupportMessage = {
      id: `sm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      ticket_id: t.id,
      author_id: s.id,
      author_role: "student",
      text: text || undefined,
      file_id,
      file_kind,
      created_at: new Date().toISOString(),
    };
    await upsert<SupportMessage>("support_messages", sm);
    t.updated_at = new Date().toISOString();
    t.status = "open";
    await upsert<SupportTicket>("support_tickets", t);
    try {
      const { tg } = await import("./telegram.server");
      const { getAdminIds } = await import("./bot-features.server");
      for (const aid of getAdminIds()) {
        await tg("sendMessage", {
          chat_id: aid,
          text: `🆘 رسالة دعم (ويب)\nالطالب: ${s.student_code}\nالتذكرة: ${t.id}\n\n${text || "(ملف مرفق)"}`,
        }).catch(() => {});
        if (file_id) {
          const m = file_kind === "photo" ? "sendPhoto" : "sendDocument";
          const k = file_kind === "photo" ? "photo" : "document";
          await tg(m, { chat_id: aid, [k]: file_id }).catch(() => {});
        }
      }
    } catch {}
    return { ok: true };
  });

// ============================================================
// DASHBOARD SUMMARY
// ============================================================

export const getStudentDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireStudent();
  const { getCollection } = await import("./repo.server");
  const [courses, attempts, hws, books, purchases, broadcasts] = await Promise.all([
    getCollection<Course>("courses"),
    getCollection<Attempt>("attempts"),
    getCollection<Homework>("homework"),
    getCollection<Book>("books"),
    getCollection<BookPurchase>("book_purchases"),
    getCollection<BroadcastRecord>("broadcasts"),
  ]);
  const now = Date.now();
  const active = s.subscriptions.filter((x) => new Date(x.expires_at).getTime() > now);
  const myAttempts = attempts.filter((a) => a.student_id === s.id && a.ended_at);
  const myBooks = purchases
    .filter((p) => p.student_id === s.id)
    .map((p) => books.find((b) => b.id === p.book_id)?.title)
    .filter(Boolean);
  const readSet = new Set(s.read_broadcasts || []);
  const unread_notifications = broadcasts.filter((b) => !readSet.has(b.id)).length;
  return {
    student: {
      student_code: s.student_code,
      first_name: s.first_name,
      full_name: s.full_name,
      grade: s.grade,
      track: s.track,
      phone_number: s.phone_number,
      parent_phone: s.parent_phone,
      points: s.points || 0,
      wallet_balance: Number(s.wallet_balance || 0),
      banned: !!s.banned,
      locked: !!s.locked,
    },
    active_courses: active.map((x) => ({
      course_id: x.course_id,
      title: courses.find((c) => c.id === x.course_id)?.title || x.course_id,
      expires_at: x.expires_at,
    })),
    attempts_count: myAttempts.length,
    homework_count: hws.filter((h) =>
      active.some((sub) => sub.course_id === h.course_id),
    ).length,
    books_count: myBooks.length,
    unread_notifications,
  };
});

// ============================================================
// NOTIFICATIONS (broadcasts targeted at all students)
// ============================================================

export const getMyNotifications = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireStudent();
  const { getCollection } = await import("./repo.server");
  const broadcasts = await getCollection<BroadcastRecord>("broadcasts");
  const readSet = new Set(s.read_broadcasts || []);
  return broadcasts
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((b) => ({
      id: b.id,
      text: b.text,
      created_at: b.created_at,
      read: readSet.has(b.id),
    }));
});

export const markNotificationsRead = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ ids: z.array(z.string()).optional() }).parse(d))
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const { getCollection, upsert } = await import("./repo.server");
    const broadcasts = await getCollection<BroadcastRecord>("broadcasts");
    const toMark = data.ids?.length ? data.ids : broadcasts.map((b) => b.id);
    const set = new Set(s.read_broadcasts || []);
    for (const id of toMark) set.add(id);
    s.read_broadcasts = Array.from(set);
    await upsert<Student>("students", s);
    return { ok: true, read_count: set.size };
  });

// ============================================================
// PROFILE UPDATE
// ============================================================

const UpdateProfileSchema = z.object({
  full_name: z.string().min(4).max(120).optional(),
  grade: z.enum(["g1", "g2", "g3"]).optional(),
  track: z.enum(["general", "azhar"]).optional(),
  parent_phone: z.string().optional(),
});

export const studentUpdateProfile = createServerFn({ method: "POST" })
  .inputValidator((d) => UpdateProfileSchema.parse(d))
  .handler(async ({ data }) => {
    const s = await requireStudent();
    const { upsert } = await import("./repo.server");
    if (data.full_name) {
      s.full_name = validateFullArabicName(data.full_name);
      s.first_name = s.full_name.split(/\s+/)[0];
    }
    if (data.grade) s.grade = data.grade;
    if (data.track) s.track = data.track;
    if (data.parent_phone) {
      const p = normalizePhone(data.parent_phone);
      if (!isValidEgyptPhone(p)) throw new Error("رقم ولي الأمر غير صحيح.");
      if (p === s.phone_number) throw new Error("رقم ولي الأمر لازم يختلف عن رقم الطالب.");
      s.parent_phone = p;
    }
    s.last_active = new Date().toISOString();
    await upsert<Student>("students", s);
    return { ok: true };
  });

// ============================================================
// ACTIVITY LOG (composite from existing collections)
// ============================================================

export const getMyActivity = createServerFn({ method: "GET" }).handler(async () => {
  const s = await requireStudent();
  const { getCollection } = await import("./repo.server");
  const [txs, subs, atts, quizzes, hws, courses] = await Promise.all([
    getCollection<WalletTransaction>("wallet_tx"),
    getCollection<HomeworkSubmission>("homework_submissions"),
    getCollection<Attempt>("attempts"),
    getCollection<Quiz>("quizzes"),
    getCollection<Homework>("homework"),
    getCollection<Course>("courses"),
  ]);
  type Event = { id: string; kind: string; icon: string; title: string; detail?: string; at: string };
  const events: Event[] = [];
  for (const t of txs.filter((x) => x.student_id === s.id)) {
    events.push({
      id: t.id,
      kind: "wallet",
      icon: t.amount >= 0 ? "💰" : "💳",
      title: t.amount >= 0 ? `إضافة ${t.amount} ج للمحفظة` : `خصم ${Math.abs(t.amount)} ج`,
      detail: t.reason,
      at: t.created_at,
    });
  }
  for (const sub of subs.filter((x) => x.student_id === s.id)) {
    const hw = hws.find((h) => h.id === sub.homework_id);
    events.push({
      id: sub.id,
      kind: "homework",
      icon: "📝",
      title: `سلّمت واجب: ${hw?.title || sub.homework_id}`,
      detail: sub.graded_at ? `الدرجة: ${sub.score}/${hw?.max_score ?? "-"}` : "بانتظار التصحيح",
      at: sub.submitted_at,
    });
  }
  for (const a of atts.filter((x) => x.student_id === s.id && x.ended_at)) {
    const q = quizzes.find((x) => x.id === a.quiz_id);
    events.push({
      id: a.id,
      kind: "quiz",
      icon: "🧪",
      title: `امتحان: ${q?.title || a.quiz_id}`,
      detail: `النتيجة ${a.score}/${a.total}`,
      at: a.ended_at!,
    });
  }
  for (const sub of s.subscriptions) {
    const c = courses.find((x) => x.id === sub.course_id);
    events.push({
      id: `sub_${sub.course_id}_${sub.started_at}`,
      kind: "subscription",
      icon: "🎓",
      title: `فعّلت اشتراك: ${c?.title || sub.course_id}`,
      detail: `ينتهي ${new Date(sub.expires_at).toLocaleDateString("ar-EG")}`,
      at: sub.started_at,
    });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  return events.slice(0, 100);
});
