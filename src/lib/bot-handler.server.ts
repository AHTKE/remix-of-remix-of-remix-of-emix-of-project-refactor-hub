import { sendProtected, tg } from "./telegram.server";
import { DEFAULT_DATA } from "./types";
import type { Attempt, BotData, Course, Lesson, PendingRegistration, Poll, Question, Quiz, Student, Vote, Voucher } from "./types";
import { getCollection, setCollection, upsert } from "./repo.server";
import {
  buyBook,
  closeTicket,
  endSupportConversation,
  getPending,
  handleAdminCommand,
  handleAdminPending,
  handleHomeworkMessage,
  handleSupportReply,
  handleSupportSubject,
  handleTopupAmount,
  handleTopupReceipt,
  isAdmin,
  listHomeworkForLesson,
  sendBookFile,
  showBook,
  showBooks,
  showHomework,
  showSupport,
  showTicket,
  showWallet,
  startHomeworkSubmit,
  startNewTicket,
  startTicketReply,
  startTopup,
} from "./bot-features.server";

const BACK = "__back__";
const HOME = "__home__";
const INQUIRY = "__inquiry__";
const COURSES = "__courses__";
const REDEEM = "__redeem__";
const PROFILE = "__profile__";
const SHARE_PHONE = "📱 مشاركة رقم الهاتف";
// ============================================================
// LMS helpers
// ============================================================

async function ensureStudent(from: any): Promise<Student> {
  const id = Number(from.id);
  const students = await getCollection<Student>("students");
  let s = students.find((x) => x.id === id);
  const now = new Date().toISOString();
  if (!s) {
    s = {
      id,
      student_code: "STD-" + id.toString(36).toUpperCase().slice(-6),
      first_name: from.first_name,
      last_name: from.last_name,
      username: from.username,
      joined_at: now,
      subscriptions: [],
      device: null,
      locked: false,
      banned: false,
      points: 0,
      last_active: now,
    };
    await upsert<Student>("students", s);
  } else {
    s.last_active = now;
    s.first_name = from.first_name ?? s.first_name;
    s.last_name = from.last_name ?? s.last_name;
    s.username = from.username ?? s.username;
    await upsert<Student>("students", s);
  }
  return s;
}

// Normalize a phone like normalizePhone() in student.functions.ts.
// Kept local to avoid pulling that module's full graph into the bot handler.
function normalizePhoneLocal(raw: string): string {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const easternArabic = "۰۱۲۳۴۵۶۷۸۹";
  const digits = String(raw || "")
    .replace(/[٠-٩]/g, (d) => String(arabicIndic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternArabic.indexOf(d)))
    .replace(/\D/g, "");
  if (!digits) return "";
  let d = digits.startsWith("00") ? digits.slice(2) : digits;
  if (d.startsWith("0") && d.length === 11) d = "20" + d.slice(1);
  else if (d.length === 10 && d.startsWith("1")) d = "20" + d;
  return d;
}

/**
 * If a web /login flow is waiting on this phone, record the user's telegram_id
 * on the pending row and reply with the 6-digit code. Returns true if matched.
 */
async function fulfilPendingRegistration(chatId: number, userId: number, rawPhone: string): Promise<boolean> {
  const phone = normalizePhoneLocal(rawPhone);
  console.log(`[telegram-verify] contact received chatId=${chatId} userId=${userId} raw="${rawPhone}" normalized="${phone}"`);
  if (!phone) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "❌ لم أستطع قراءة رقم الهاتف. اضغط /verify ثم شارك رقمك من الزر الموجود في تيليجرام نفسه.",
      reply_markup: { remove_keyboard: true },
    });
    return true;
  }
  const pendings = await getCollection<PendingRegistration>("pending_registrations");
  const p = pendings.find((x) => x.id === phone);
  const activeForSameUser = pendings.find(
    (x) => x.telegram_id === userId && new Date(x.expires_at).getTime() >= Date.now(),
  );
  if (!p) {
    console.warn(`[telegram-verify] no pending row for phone=${phone}. activeForSameUser=${activeForSameUser?.id || "none"}`);
    await tg("sendMessage", {
      chat_id: chatId,
      text: activeForSameUser
        ? "❌ الرقم الذي شاركته لا يطابق رقم الطالب المكتوب في الموقع. ارجع للموقع واكتب نفس رقم تيليجرام، أو ابدأ طلب تسجيل جديد بالرقم الصحيح."
        : "❌ لا يوجد طلب تسجيل مفتوح لهذا الرقم. اكتب بيانات الطالب في صفحة تسجيل الدخول أولًا، ثم ارجع للبوت واضغط /verify وشارك رقمك.",
      reply_markup: { remove_keyboard: true },
    });
    return true;
  }
  if (p.telegram_id && p.telegram_id !== userId) {
    console.warn(`[telegram-verify] phone=${phone} bound to telegram_id=${p.telegram_id} but contact came from ${userId}`);
    await tg("sendMessage", {
      chat_id: chatId,
      text: "❌ طلب التسجيل لهذا الرقم مرتبط بحساب تيليجرام آخر. ابدأ طلبًا جديدًا من الموقع أو شارك رقم حسابك الصحيح من تيليجرام.",
      reply_markup: { remove_keyboard: true },
    });
    return true;
  }
  if (new Date(p.expires_at).getTime() < Date.now()) {
    console.warn(`[telegram-verify] pending expired for phone=${phone}`);
    await tg("sendMessage", {
      chat_id: chatId,
      text: "⌛ انتهت صلاحية طلب التسجيل. ارجع للموقع وابدأ من جديد.",
      reply_markup: { remove_keyboard: true },
    });
    return true;
  }
  p.telegram_id = userId;
  const idx = pendings.findIndex((x) => x.id === p.id);
  if (idx >= 0) pendings[idx] = p;
  await setCollection("pending_registrations", pendings);
  console.log(`[telegram-verify] bound telegram_id=${userId} to phone=${phone}, sending code`);
  await tg("sendMessage", {
    chat_id: chatId,
    text: `✅ تم التحقق من رقمك.\n\n🔐 كود الدخول: <code>${p.code}</code>\n\nاكتب الكود في صفحة تسجيل الدخول خلال 15 دقيقة لإكمال التسجيل.`,
    parse_mode: "HTML",
    reply_markup: { remove_keyboard: true },
  });
  return true;
}

/**
 * Deep-link verification: /start <token>. Looks up the pending registration
 * by token (no phone match required), binds telegram_id, and sends the code.
 * Returns true if a pending row was matched (caller should NOT fall through).
 */
async function fulfilPendingByToken(chatId: number, userId: number, token: string): Promise<boolean> {
  const t = String(token || "").trim();
  if (!t || t.length < 6) return false;
  console.log(`[telegram-verify] /start token=${t.slice(0, 6)}… from userId=${userId}`);
  const pendings = await getCollection<PendingRegistration>("pending_registrations");
  const p = pendings.find((x) => x.token === t);
  if (!p) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "❌ رابط التفعيل غير صالح أو انتهت صلاحيته. ارجع للموقع وابدأ التسجيل من جديد.",
    });
    return true;
  }
  if (new Date(p.expires_at).getTime() < Date.now()) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "⌛ انتهت صلاحية طلب التسجيل. ارجع للموقع وابدأ من جديد.",
    });
    return true;
  }
  if (p.telegram_id && p.telegram_id !== userId) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "❌ طلب التسجيل ده مرتبط بحساب تيليجرام تاني. ابدأ تسجيل جديد من الموقع.",
    });
    return true;
  }
  p.telegram_id = userId;
  const idx = pendings.findIndex((x) => x.id === p.id);
  if (idx >= 0) pendings[idx] = p;
  await setCollection("pending_registrations", pendings);
  console.log(`[telegram-verify] bound telegram_id=${userId} to pending phone=${p.id} via token`);
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      `✅ تم التحقق من حسابك.\n\n` +
      `🔐 كود الدخول: <code>${p.code}</code>\n\n` +
      `ارجع لصفحة تسجيل الدخول واكتب الكود ده خلال 15 دقيقة لإكمال التسجيل.`,
    parse_mode: "HTML",
  });
  return true;
}

async function getBotData(): Promise<BotData> {
  const settings = (await getCollection<Partial<BotData> & { id?: string }>("bot_settings"))[0] || {};
  const questions = await getCollection<Question>("questions");
  return { ...DEFAULT_DATA, ...settings, questions, updated_at: settings.updated_at || DEFAULT_DATA.updated_at };
}

function isSubscribed(s: Student, courseId: string): boolean {
  const now = Date.now();
  return s.subscriptions.some(
    (sub) => sub.course_id === courseId && new Date(sub.expires_at).getTime() > now,
  );
}

function activeStudent(s: Student): boolean {
  return !s.banned && !s.locked;
}

function rowsOf<T>(items: T[], make: (x: T) => { text: string; callback_data: string }, perRow = 1) {
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < items.length; i += perRow) {
    rows.push(items.slice(i, i + perRow).map(make));
  }
  return rows;
}

function homeRow() {
  return [
    { text: "📚 الكورسات", callback_data: COURSES },
    { text: "🎟️ تفعيل كود", callback_data: REDEEM },
    { text: "👤 حسابي", callback_data: PROFILE },
    { text: "🏠 الرئيسية", callback_data: HOME },
  ];
}

function mainKeyboard(data: BotData) {
  return {
    inline_keyboard: [
      [{ text: "📚 الكورسات", callback_data: COURSES }, { text: "🎟️ تفعيل كود", callback_data: REDEEM }],
      [{ text: "👤 حسابي", callback_data: PROFILE }, { text: "💰 محفظتي", callback_data: "menu:wallet" }],
      [{ text: "📚 المكتبة", callback_data: "menu:books" }, { text: "🆘 الدعم الفني", callback_data: "menu:support" }],
      ...buildKeyboard(data.questions, null).inline_keyboard.slice(0, -1),
      [{ text: "📞 للاستفسار", callback_data: INQUIRY }],
    ],
  };
}

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function phoneKeyboard(student: Student) {
  if (student.phone_number) return undefined;
  return {
    keyboard: [[{ text: SHARE_PHONE, request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

function resourceButtonText(kind: string, name?: string) {
  const label = kind === "video" ? "📺 مشاهدة الفيديو" : kind === "document" ? "📘 فتح الملف" : kind === "photo" ? "🖼️ فتح الصورة" : kind === "audio" ? "🎧 تشغيل الصوت" : "🔗 فتح الرابط";
  return name ? `${label} — ${name.slice(0, 28)}` : label;
}

async function showCourses(chatId: number) {
  const courses = (await getCollection<Course>("courses"))
    .filter((c) => c.is_published !== false)
    .sort((a, b) => (b.is_pinned ? 1 : 0) - (a.is_pinned ? 1 : 0) || a.order - b.order);
  if (!courses.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: "لا توجد كورسات منشورة حاليًا.",
      reply_markup: { inline_keyboard: [[{ text: "🏠 الرئيسية", callback_data: HOME }]] },
    });
    return;
  }
  const rows = rowsOf(courses, (c) => ({
    text: (c.is_pinned ? "📌 " : "") + c.title,
    callback_data: `course:${c.id}`,
  }));
  rows.push([{ text: "🏠 الرئيسية", callback_data: HOME }]);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "اختر كورس:",
    reply_markup: { inline_keyboard: rows },
  });
}

async function showCourse(chatId: number, courseId: string, student: Student) {
  const courses = await getCollection<Course>("courses");
  const course = courses.find((c) => c.id === courseId);
  if (!course) return;
  const subscribed = isSubscribed(student, courseId);
  if (!subscribed) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `🔒 الكورس مقفل: <b>${course.title}</b>\n\n${course.subtitle || ""}\n\nأرسل كود التفعيل أو اضغط 🎟️ لتفعيل اشتراكك.`,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎟️ تفعيل كود", callback_data: `redeem:${courseId}` }],
          [{ text: "◀️ رجوع", callback_data: COURSES }],
        ],
      },
    });
    return;
  }
  const lessons = (await getCollection<Lesson>("lessons"))
    .filter((l) => l.course_id === courseId)
    .sort((a, b) => a.order - b.order);
  if (!lessons.length) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: `<b>${course.title}</b>\n\nلا توجد حصص بعد.`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "◀️ رجوع", callback_data: COURSES }]] },
    });
    return;
  }
  const rows = rowsOf(lessons, (l) => ({
    text: "🎬 " + l.title,
    callback_data: `lesson:${l.id}`,
  }));
  rows.push([{ text: "◀️ الكورسات", callback_data: COURSES }, { text: "🏠 الرئيسية", callback_data: HOME }]);
  const sub = student.subscriptions.find((s) => s.course_id === courseId);
  const expires = sub ? new Date(sub.expires_at).toLocaleDateString("ar-EG") : "";
  await tg("sendMessage", {
    chat_id: chatId,
    text: `✅ <b>${course.title}</b>\nاشتراكك ساري حتى: <b>${expires}</b>\n\nاختر حصة:`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

async function sendLesson(chatId: number, lessonId: string, student: Student) {
  const lessons = await getCollection<Lesson>("lessons");
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) return;
  if (!isSubscribed(student, lesson.course_id)) {
    await tg("sendMessage", { chat_id: chatId, text: "🔒 اشتراكك في هذا الكورس انتهى." });
    return;
  }
  const header = `🎓 <b>${lesson.title}</b>${lesson.description ? "\n\n" + lesson.description : ""}`;
  const resourceRows = lesson.resources.map((r) => ([{
    text: resourceButtonText(r.kind, r.file_name),
    callback_data: `res:${lesson.id}:${r.id}`,
  }]));
  const lessonActions = [
    ...resourceRows,
    lesson.quiz_id ? [{ text: "📝 بدء الامتحان التقييمي", callback_data: `quiz:${lesson.quiz_id}` }] : [],
    [{ text: "📝 واجبات الحصة", callback_data: `hwlist:${lesson.id}` }],
    [{ text: "◀️ حصص الكورس", callback_data: `course:${lesson.course_id}` }],
    [{ text: "🏠 الرئيسية", callback_data: HOME }],
  ].filter((row) => row.length);
  await tg("sendMessage", {
    chat_id: chatId,
    text: `${header}\n\nاختر نوع المحتوى المطلوب:`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: lessonActions },
  });
}

async function sendLessonResource(chatId: number, lessonId: string, resourceId: string, student: Student) {
  const lesson = (await getCollection<Lesson>("lessons")).find((l) => l.id === lessonId);
  if (!lesson) return;
  if (!activeStudent(student) || !isSubscribed(student, lesson.course_id)) {
    await tg("sendMessage", { chat_id: chatId, text: "🔒 اشتراكك غير نشط أو انتهت صلاحيته." });
    return;
  }
  const r = lesson.resources.find((x) => x.id === resourceId);
  if (!r) return;
  if (r.kind === "link") {
    if (!r.url) {
      await tg("sendMessage", { chat_id: chatId, text: "⚠️ الرابط غير متاح حالياً." });
      return;
    }
    await tg("sendMessage", {
      chat_id: chatId,
      text: `🔗 ${esc(r.file_name || "رابط الحصة")}${r.caption ? `\n${esc(r.caption)}` : ""}`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "فتح الرابط", url: r.url }]] },
    });
    return;
  }
  const method = r.kind === "video" ? "sendVideo" : r.kind === "photo" ? "sendPhoto" : r.kind === "audio" ? "sendAudio" : "sendDocument";
  const key = r.kind === "document" ? "document" : r.kind;
  await sendProtected(method, {
    chat_id: chatId,
    [key]: r.file_id,
    caption: r.caption || r.file_name || undefined,
  }).catch((e) => tg("sendMessage", { chat_id: chatId, text: `⚠️ تعذّر إرسال ${r.file_name || r.kind}: ${e.message}` }));
}

async function tryRedeem(chatId: number, student: Student, codeRaw: string): Promise<boolean> {
  const code = codeRaw.toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{6,40}$/.test(code)) return false;
  const vouchers = await getCollection<Voucher>("vouchers");
  const v = vouchers.find((x) => x.code === code);
  if (!v) {
    await tg("sendMessage", { chat_id: chatId, text: "❌ كود غير صحيح." });
    return true;
  }
  if (v.used_by && v.used_by !== student.id) {
    await tg("sendMessage", { chat_id: chatId, text: "❌ هذا الكود مستخدم بالفعل." });
    return true;
  }
  const now = new Date();
  const existing = student.subscriptions.find((s) => s.course_id === v.course_id);
  const base = existing && new Date(existing.expires_at) > now ? new Date(existing.expires_at) : now;
  const expires = new Date(base.getTime() + v.duration_days * 86_400_000);
  if (existing) {
    existing.expires_at = expires.toISOString();
    existing.voucher_code = v.code;
  } else {
    student.subscriptions.push({
      course_id: v.course_id,
      voucher_code: v.code,
      started_at: now.toISOString(),
      expires_at: expires.toISOString(),
    });
  }
  v.used_by = student.id;
  v.used_at = now.toISOString();
  // persist both
  const allVouchers = await getCollection<Voucher>("vouchers");
  const idx = allVouchers.findIndex((x) => x.code === v.code);
  if (idx >= 0) allVouchers[idx] = v;
  await setCollection("vouchers", allVouchers);
  await upsert<Student>("students", student);

  const courses = await getCollection<Course>("courses");
  const course = courses.find((c) => c.id === v.course_id);
  await tg("sendMessage", {
    chat_id: chatId,
    text: `✅ تم تفعيل الكود!\n\nالكورس: <b>${course?.title || v.course_id}</b>\nصالح حتى: <b>${expires.toLocaleDateString("ar-EG")}</b>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "▶️ ابدأ الكورس", callback_data: `course:${v.course_id}` }]],
    },
  });
  try {
    const { getAdminIds } = await import("./bot-features.server");
    for (const aid of getAdminIds()) {
      await tg("sendMessage", {
        chat_id: aid,
        text: `🎟️ تفعيل اشتراك من البوت\nالطالب: ${student.student_code}\nالكورس: ${course?.title || v.course_id}\nالكود: ${v.code}`,
      }).catch(() => {});
    }
  } catch {}
  return true;
}

async function showProfile(chatId: number, student: Student) {
  const courses = await getCollection<Course>("courses");
  const attempts = await getCollection<Attempt>("attempts");
  const active = student.subscriptions
    .filter((s) => new Date(s.expires_at).getTime() > Date.now())
    .map((s) => {
      const course = courses.find((c) => c.id === s.course_id);
      const days = Math.max(0, Math.ceil((new Date(s.expires_at).getTime() - Date.now()) / 86_400_000));
      return `• ${course?.title || s.course_id}: ${days} يوم`;
    });
  const completed = attempts.filter((a) => a.student_id === student.id && a.ended_at);
  await tg("sendMessage", {
    chat_id: chatId,
    text: `👤 <b>بطاقة الطالب</b>\n\nالاسم: <b>${esc(student.first_name || "طالب")}</b>\nالكود: <code>${esc(student.student_code)}</code>\nالنقاط: <b>${student.points || 0}</b>\nامتحانات مكتملة: <b>${completed.length}</b>\n\n<b>الاشتراكات النشطة</b>\n${active.map(esc).join("\n") || "لا توجد اشتراكات نشطة"}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "📚 الكورسات", callback_data: COURSES }, { text: "🏠 الرئيسية", callback_data: HOME }]] },
  });
}

function pollSummary(poll: Poll, votes: Vote[]) {
  const latest = new Map<number, Vote>();
  for (const vote of votes.filter((v) => v.poll_id === poll.id)) latest.set(vote.student_id, vote);
  const finalVotes = [...latest.values()];
  const total = finalVotes.length;
  return poll.options
    .map((option, i) => {
      const count = finalVotes.filter((v) => v.option_index === i).length;
      const pct = total ? Math.round((count / total) * 100) : 0;
      return `${option}: ${pct}% (${count})`;
    })
    .join("\n") + `\n\nإجمالي المصوتين: ${total}`;
}

async function handlePollVote(chatId: number, student: Student, pollId: string, optionIndex: number) {
  const polls = await getCollection<Poll>("polls");
  const poll = polls.find((p) => p.id === pollId && p.is_open);
  if (!poll || optionIndex < 0 || optionIndex >= poll.options.length) {
    await tg("sendMessage", { chat_id: chatId, text: "هذا الاستطلاع غير متاح الآن." });
    return;
  }
  const votes = await getCollection<Vote>("votes");
  const next = votes.filter((v) => !(v.poll_id === pollId && v.student_id === student.id));
  next.push({ poll_id: pollId, student_id: student.id, option_index: optionIndex, voted_at: new Date().toISOString() });
  await setCollection("votes", next);
  await tg("sendMessage", {
    chat_id: chatId,
    text: `✅ تم تسجيل صوتك\n\n📊 النتائج الحية:\n${pollSummary(poll, next)}`,
  });
}

function shuffleWithSeed<T>(items: T[], seed: string) {
  const out = [...items];
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function startQuiz(chatId: number, student: Student, quizId: string) {
  const quiz = (await getCollection<Quiz>("quizzes")).find((q) => q.id === quizId);
  if (!quiz) return tg("sendMessage", { chat_id: chatId, text: "الامتحان غير موجود." });
  const attempt: Attempt = {
    id: `at_${student.id}_${quiz.id}_${Date.now().toString(36)}`,
    quiz_id: quiz.id,
    student_id: student.id,
    started_at: new Date().toISOString(),
    answers: [],
  };
  await upsert<Attempt>("attempts", attempt);
  await sendQuizQuestion(chatId, student, attempt.id, 0);
}

async function sendQuizQuestion(chatId: number, student: Student, attemptId: string, index: number) {
  const attempt = (await getCollection<Attempt>("attempts")).find((a) => a.id === attemptId && a.student_id === student.id);
  if (!attempt || attempt.ended_at) return;
  const quiz = (await getCollection<Quiz>("quizzes")).find((q) => q.id === attempt.quiz_id);
  if (!quiz) return;
  if (Date.now() - new Date(attempt.started_at).getTime() > quiz.duration_seconds * 1000) {
    await submitQuiz(chatId, student, attempt.id);
    return;
  }
  const questions = quiz.shuffle_questions ? shuffleWithSeed(quiz.questions, attempt.id) : quiz.questions;
  const q = questions[index];
  if (!q) { await submitQuiz(chatId, student, attempt.id); return; }
  const options = quiz.shuffle_options
    ? shuffleWithSeed(q.options.map((text, original) => ({ text, original })), `${attempt.id}:${q.id}`)
    : q.options.map((text, original) => ({ text, original }));
  const remaining = Math.max(0, quiz.duration_seconds - Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000));
  const rows = options.map((o) => [{ text: o.text, callback_data: `ans:${attempt.id}:${index}:${q.id}:${o.original}` }]);
  const text = `📝 <b>${esc(quiz.title)}</b>\nالسؤال ${index + 1}/${questions.length} — الوقت المتبقي ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}\n\n${esc(q.text)}`;
  if (q.image_file_id) {
    await sendProtected("sendPhoto", { chat_id: chatId, photo: q.image_file_id, caption: text, parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
  } else {
    await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
  }
}

async function answerQuiz(chatId: number, student: Student, attemptId: string, index: number, qid: string, chosen: number) {
  const attempts = await getCollection<Attempt>("attempts");
  const attempt = attempts.find((a) => a.id === attemptId && a.student_id === student.id);
  if (!attempt || attempt.ended_at) return;
  attempt.answers = attempt.answers.filter((a) => a.qid !== qid);
  attempt.answers.push({ qid, chosen_index: chosen });
  await upsert<Attempt>("attempts", attempt);
  await sendQuizQuestion(chatId, student, attemptId, index + 1);
}

async function submitQuiz(chatId: number, student: Student, attemptId: string) {
  const attempts = await getCollection<Attempt>("attempts");
  const attempt = attempts.find((a) => a.id === attemptId && a.student_id === student.id);
  if (!attempt || attempt.ended_at) return;
  const quiz = (await getCollection<Quiz>("quizzes")).find((q) => q.id === attempt.quiz_id);
  if (!quiz) return;
  let score = 0;
  const wrong: string[] = [];
  for (const q of quiz.questions) {
    const answer = attempt.answers.find((a) => a.qid === q.id);
    if (answer?.chosen_index === q.correct_index) score++;
    else wrong.push(`• ${esc(q.text)}\nإجابتك: ${esc(answer ? q.options[answer.chosen_index] : "لم تجب")}\nالصحيح: ${esc(q.options[q.correct_index])}\n${esc(q.explanation || "")}`);
  }
  attempt.ended_at = new Date().toISOString();
  attempt.score = score;
  attempt.total = quiz.questions.length;
  await upsert<Attempt>("attempts", attempt);
  const all = (await getCollection<Attempt>("attempts")).filter((a) => a.quiz_id === quiz.id && typeof a.score === "number");
  const rank = [...all].sort((a, b) => (b.score || 0) - (a.score || 0)).findIndex((a) => a.id === attempt.id) + 1;
  await tg("sendMessage", {
    chat_id: chatId,
    text: `🏆 <b>نتيجة الامتحان</b>\n${esc(quiz.title)}\n\nدرجتك: <b>${score}/${quiz.questions.length}</b>\nترتيبك: <b>${rank}/${all.length}</b>\n\n${wrong.length ? "الأخطاء:\n" + wrong.slice(0, 5).join("\n\n") : "ممتاز، لا توجد أخطاء."}`,
    parse_mode: "HTML",
  });
}

function buildKeyboard(questions: Question[], parentId: string | null) {
  const items = questions
    .filter((q) => (q.parent_id ?? null) === parentId)
    .sort((a, b) => a.order - b.order);
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < items.length; i += 2) {
    const row = [{ text: items[i].title, callback_data: `q:${items[i].id}` }];
    if (items[i + 1])
      row.push({ text: items[i + 1].title, callback_data: `q:${items[i + 1].id}` });
    rows.push(row);
  }
  if (parentId !== null) {
    rows.push([{ text: "🔙 رجوع", callback_data: BACK }]);
  } else {
    rows.push([{ text: "📞 للاستفسار", callback_data: INQUIRY }]);
  }
  return { inline_keyboard: rows };
}

export async function handleUpdate(update: any) {
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = String(update.message.text || "").trim();
    const from = update.message.from || {};
    const contact = update.message.contact;

    // ============================================================
    // 🎬 Forward → file_id extractor
    // Forward (or directly send) any media to the bot and it replies
    // with the clean file_id, ready to paste into the lessons panel.
    // ============================================================
    const msg = update.message;
    const isForwarded = !!(msg.forward_from || msg.forward_from_chat || msg.forward_origin || msg.forward_sender_name || msg.forward_date);
    let mediaInfo: { kind: string; file_id: string; name?: string; size?: number; mime?: string; isVideo?: boolean } | null = null;
    if (msg.video) mediaInfo = { kind: "🎬 video", file_id: msg.video.file_id, name: msg.video.file_name, size: msg.video.file_size, mime: msg.video.mime_type, isVideo: true };
    else if (msg.document) {
      const isVideoDocument = String(msg.document.mime_type || "").startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(String(msg.document.file_name || ""));
      mediaInfo = { kind: isVideoDocument ? "🎬 video" : "📄 document", file_id: msg.document.file_id, name: msg.document.file_name, size: msg.document.file_size, mime: msg.document.mime_type, isVideo: isVideoDocument };
    }
    else if (msg.audio) mediaInfo = { kind: "🎵 audio", file_id: msg.audio.file_id, name: msg.audio.file_name, size: msg.audio.file_size, mime: msg.audio.mime_type };
    else if (msg.voice) mediaInfo = { kind: "🎤 voice", file_id: msg.voice.file_id, size: msg.voice.file_size, mime: msg.voice.mime_type };
    else if (msg.animation) mediaInfo = { kind: "🎞️ animation", file_id: msg.animation.file_id, name: msg.animation.file_name, size: msg.animation.file_size, mime: msg.animation.mime_type };
    else if (msg.photo && Array.isArray(msg.photo) && msg.photo.length) {
      const best = msg.photo[msg.photo.length - 1];
      mediaInfo = { kind: "🖼️ photo", file_id: best.file_id, size: best.file_size };
    }
    if (mediaInfo && (isForwarded || isAdmin(from.id))) {
      const sizeMb = mediaInfo.size ? (mediaInfo.size / 1024 / 1024).toFixed(2) + " MB" : "—";
      const videoProxy = mediaInfo.isVideo ? `/api/public/media/${encodeURIComponent(mediaInfo.file_id)}?kind=video` : "";
      const lines = [
        `✅ تم استخراج <b>file_id</b> بنجاح:`,
        ``,
        `<code>${mediaInfo.file_id}</code>`,
        videoProxy ? `` : null,
        videoProxy ? `🔗 رابط تشغيل الفيديو داخل الموقع:` : null,
        videoProxy ? `<code>${videoProxy}</code>` : null,
        ``,
        `النوع: ${mediaInfo.kind}`,
        mediaInfo.name ? `الاسم: ${mediaInfo.name}` : null,
        `الحجم: ${sizeMb}`,
        mediaInfo.mime ? `MIME: <code>${mediaInfo.mime}</code>` : null,
        ``,
        mediaInfo.isVideo ? `📋 انسخ الـ file_id أو الرابط والصقه في خانة فيديوهات الشرح داخل لوحة التحكم.` : `📋 انسخ الـ file_id والصقه في خانة الملف المناسبة داخل لوحة التحكم.`,
      ].filter(Boolean).join("\n");
      try {
        await tg("sendMessage", { chat_id: chatId, text: lines, parse_mode: "HTML" });
      } catch (e) {
        console.error("[forward-extract] sendMessage failed", e);
      }
      // For forwarded media we stop here — user just wanted the id.
      if (isForwarded) return;
    }

    if (contact?.phone_number && contact?.user_id && Number(contact.user_id) !== Number(from.id)) {
      console.warn(`[telegram-verify] contact rejected — contact.user_id=${contact.user_id} !== from.id=${from.id}`);
      await tg("sendMessage", {
        chat_id: chatId,
        text: "❌ لازم تشارك رقمك أنت من زر «مشاركة رقم الهاتف» داخل تيليجرام، وليس رقم شخص آخر.",
        reply_markup: { remove_keyboard: true },
      });
      return;
    }
    if (contact?.phone_number) {
      // Try to fulfil a pending web-portal registration with this phone.
      let matched = true;
      try {
        matched = await fulfilPendingRegistration(chatId, Number(from.id), contact.phone_number);
      } catch (e) {
        console.error("[telegram-verify] failed while fulfilling pending registration", e);
        await tg("sendMessage", {
          chat_id: chatId,
          text: "❌ حصل خطأ أثناء إرسال كود التفعيل. جرّب مرة أخرى بعد لحظات أو تواصل مع الإدارة.",
          reply_markup: { remove_keyboard: true },
        }).catch(() => {});
        return;
      }
      const student = await ensureStudent(from);
      student.phone_number = normalizePhoneLocal(contact.phone_number) || contact.phone_number;
      await upsert<Student>("students", student);
      if (!matched) {
        await tg("sendMessage", { chat_id: chatId, text: "✅ تم ربط رقم تيليجرام بحسابك.", reply_markup: { remove_keyboard: true } });
        await showProfile(chatId, student);
      }
      return;
    }
    if (text === "/verify" || text.startsWith("/start verify")) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "📲 لتأكيد حسابك على الموقع، اضغط الزر بالأسفل لمشاركة رقم الهاتف.",
        reply_markup: {
          keyboard: [[{ text: SHARE_PHONE, request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      return;
    }

    // /start <token> — primary verification path (web → bot deep-link).
    if (text.startsWith("/start ")) {
      const arg = text.slice("/start ".length).trim();
      if (arg && arg !== "verify") {
        try {
          const matched = await fulfilPendingByToken(chatId, Number(from.id), arg);
          if (matched) {
            await ensureStudent(from); // record student in our store
            return;
          }
        } catch (e) {
          console.error("[telegram-verify] /start <token> failed", e);
        }
      }
    }

    // Plain /start from a user with an active pending tied to their account →
    // resend the existing code so they can copy it again without re-registering.
    if (text === "/start") {
      try {
        const pendings = await getCollection<PendingRegistration>("pending_registrations");
        const linked = pendings.find(
          (x) => x.telegram_id === Number(from.id) && new Date(x.expires_at).getTime() >= Date.now(),
        );
        if (linked) {
          await tg("sendMessage", {
            chat_id: chatId,
            text:
              `🔐 الكود الحالي للتسجيل: <code>${linked.code}</code>\n\n` +
              `اكتبه في صفحة تسجيل الدخول لإكمال الحساب.`,
            parse_mode: "HTML",
          });
          // fall through so they still see the main menu
        }
      } catch (e) {
        console.error("[telegram-verify] /start lookup failed", e);
      }
    }

    const student = await ensureStudent(from);
    const data = await getBotData();
    if (student.banned) {
      await tg("sendMessage", { chat_id: chatId, text: "تم حظر هذا الحساب. تواصل مع الإدارة." });
      return;
    }
    if (student.locked) {
      await tg("sendMessage", { chat_id: chatId, text: "تم رصد محاولة غش أو مشاركة للحساب، يرجى التواصل مع الإدارة لتفعيل الجهاز الجديد" });
      return;
    }

    // Admin commands take priority (only valid for admin telegram IDs)
    if (text.startsWith("/") && isAdmin(from.id) && (await handleAdminCommand(chatId, from.id, text))) return;

    // Pending multi-step flows (homework submit, topup, support)
    const pending = await getPending(student.id);
    if (pending) {
      // admin multi-step flows
      if (pending.kind.startsWith("admin_") && isAdmin(from.id)) {
        if (await handleAdminPending(chatId, from.id, update.message, pending)) return;
      }
      if (pending.kind === "homework_submit") {
        await handleHomeworkMessage(chatId, student, update.message, pending.payload);
        return;
      }
      if (pending.kind === "topup_amount") {
        await handleTopupAmount(chatId, student, text);
        return;
      }
      if (pending.kind === "topup_receipt") {
        await handleTopupReceipt(chatId, student, update.message, pending.payload);
        return;
      }
      if (pending.kind === "support_subject") {
        await handleSupportSubject(chatId, student, text);
        return;
      }
      if (pending.kind === "support_reply") {
        await handleSupportReply(chatId, student, update.message, pending.payload);
        return;
      }
    }

    if (text === "/webhook" || text === "/status") {
      const info = await tg<any>("getWebhookInfo");
      await tg("sendMessage", {
        chat_id: chatId,
        text: `حالة الـ Webhook:\n${info.url ? `✅ مفعّل\n${info.url}` : "❌ غير مفعّل"}\nآخر خطأ: ${info.last_error_message || "لا يوجد"}`,
      });
      return;
    }
    if (text === "/courses" || text === "📚 الكورسات") {
      await showCourses(chatId);
      return;
    }
    if (text === "/profile" || text === "👤 حسابي") {
      await showProfile(chatId, student);
      return;
    }
    if (text === "/redeem" || text === "🎟️ تفعيل كود") {
      await tg("sendMessage", {
        chat_id: chatId,
        text: "أرسل كود التفعيل (مثال: AMW-XXXX-XXXX)",
      });
      return;
    }
    // Auto-detect a voucher code in any plain message
    if (/^[A-Za-z0-9-]{6,40}$/.test(text)) {
      if (await tryRedeem(chatId, student, text)) return;
    }
    if (text === "/start" || text === "/home" || text === "/menu") {
      await tg("sendMessage", {
        chat_id: chatId,
        text: data.welcome_text,
        reply_markup: mainKeyboard(data),
      });
      if (!student.phone_number) {
        await tg("sendMessage", { chat_id: chatId, text: "لإكمال التسجيل، شارك رقم الهاتف المرتبط بحساب تيليجرام.", reply_markup: phoneKeyboard(student) });
      }
      return;
    }
    await tg("sendMessage", {
      chat_id: chatId,
      text: data.welcome_text,
      reply_markup: mainKeyboard(data),
    });
    return;
  }

  if (update.callback_query) {
    const data = await getBotData();
    const cb = update.callback_query;
    const chatId = cb.message.chat.id;
    const cbId = cb.id;
    const dataStr = cb.data as string;
    const student = await ensureStudent(cb.from || {});
    if (student.banned) {
      await tg("answerCallbackQuery", { callback_query_id: cbId, text: "الحساب محظور", show_alert: true }).catch(() => {});
      return;
    }
    if (student.locked) {
      await tg("answerCallbackQuery", { callback_query_id: cbId, text: "تم قفل الحساب. تواصل مع الإدارة لتفعيل الجهاز الجديد", show_alert: true }).catch(() => {});
      return;
    }

    await tg("answerCallbackQuery", { callback_query_id: cbId }).catch(() => {});

    if (dataStr === COURSES) { await showCourses(chatId); return; }
    if (dataStr === PROFILE) { await showProfile(chatId, student); return; }
    if (dataStr === REDEEM || dataStr.startsWith("redeem:")) {
      await tg("sendMessage", { chat_id: chatId, text: "أرسل كود التفعيل (مثال: AMW-XXXX-XXXX)" });
      return;
    }
    // ---- Wallet ----
    if (dataStr === "menu:wallet") { await showWallet(chatId, student); return; }
    if (dataStr === "wallet:topup") { await startTopup(chatId, student); return; }
    // ---- Books ----
    if (dataStr === "menu:books") { await showBooks(chatId, student); return; }
    if (dataStr.startsWith("book:")) { await showBook(chatId, dataStr.slice(5), student); return; }
    if (dataStr.startsWith("bookbuy:")) { await buyBook(chatId, dataStr.slice(8), student); return; }
    if (dataStr.startsWith("bookget:")) {
      const b = (await getCollection<any>("books")).find((x: any) => x.id === dataStr.slice(8));
      if (b) await sendBookFile(chatId, b, student);
      return;
    }
    // ---- Support ----
    if (dataStr === "menu:support") { await showSupport(chatId, student); return; }
    if (dataStr === "ticket:new") { await startNewTicket(chatId, student); return; }
    if (dataStr.startsWith("ticket:")) { await showTicket(chatId, student, dataStr.slice(7)); return; }
    if (dataStr.startsWith("treply:")) { await startTicketReply(chatId, student, dataStr.slice(7)); return; }
    if (dataStr.startsWith("tdone:")) { await endSupportConversation(chatId, student); return; }
    if (dataStr.startsWith("tclose:")) { await closeTicket(chatId, student, dataStr.slice(7), false); await showSupport(chatId, student); return; }
    if (dataStr.startsWith("treopen:")) { await closeTicket(chatId, student, dataStr.slice(8), true); await showSupport(chatId, student); return; }
    // ---- Homework ----
    if (dataStr.startsWith("hwlist:")) { await listHomeworkForLesson(chatId, dataStr.slice(7)); return; }
    if (dataStr.startsWith("hw:")) { await showHomework(chatId, dataStr.slice(3), student); return; }
    if (dataStr.startsWith("hwsub:")) { await startHomeworkSubmit(chatId, dataStr.slice(6), student); return; }
    if (dataStr.startsWith("poll:")) {
      const [, pollId, rawIndex] = dataStr.split(":");
      await handlePollVote(chatId, student, pollId, Number(rawIndex));
      return;
    }
    if (dataStr.startsWith("quiz:")) {
      await startQuiz(chatId, student, dataStr.slice("quiz:".length));
      return;
    }
    if (dataStr.startsWith("ans:")) {
      const [, attemptId, rawIndex, qid, rawChosen] = dataStr.split(":");
      await answerQuiz(chatId, student, attemptId, Number(rawIndex), qid, Number(rawChosen));
      return;
    }
    if (dataStr.startsWith("course:")) {
      await showCourse(chatId, dataStr.slice("course:".length), student);
      return;
    }
    if (dataStr.startsWith("lesson:")) {
      await sendLesson(chatId, dataStr.slice("lesson:".length), student);
      return;
    }
    if (dataStr.startsWith("res:")) {
      const [, lessonId, resourceId] = dataStr.split(":");
      await sendLessonResource(chatId, lessonId, resourceId, student);
      return;
    }

    if (dataStr === HOME || dataStr === BACK) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: data.welcome_text,
        reply_markup: mainKeyboard(data),
      });
      return;
    }

    if (dataStr === INQUIRY) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: data.inquiry_text,
        reply_markup: { inline_keyboard: [[{ text: "🏠 الرئيسية", callback_data: HOME }]] },
      });
      return;
    }

    if (dataStr.startsWith("q:")) {
      const id = dataStr.slice(2);
      const q = data.questions.find((x) => x.id === id);
      if (!q) return;
      const hasChildren = data.questions.some((x) => x.parent_id === id);

      // ALL media to students is PROTECTED
      if (q.media.length === 1) {
        const m = q.media[0];
        const method = m.type === "photo" ? "sendPhoto" : "sendVideo";
        await sendProtected(method, {
          chat_id: chatId,
          [m.type]: m.file_id,
          caption: q.answer || undefined,
          parse_mode: "HTML",
        });
      } else if (q.media.length > 1) {
        const media = q.media.map((m, i) => ({
          type: m.type,
          media: m.file_id,
          ...(i === 0 && q.answer ? { caption: q.answer, parse_mode: "HTML" } : {}),
        }));
        for (let i = 0; i < media.length; i += 10) {
          await sendProtected("sendMediaGroup", {
            chat_id: chatId,
            media: media.slice(i, i + 10),
          });
        }
      } else if (q.answer) {
        await tg("sendMessage", { chat_id: chatId, text: q.answer, parse_mode: "HTML" });
      }

      await tg("sendMessage", {
        chat_id: chatId,
        text: hasChildren ? "اختر:" : "هل تريد المزيد؟",
        reply_markup: hasChildren
          ? buildKeyboard(data.questions, id)
          : {
              inline_keyboard: [
                [{ text: "🔙 رجوع", callback_data: BACK }, { text: "🏠 الرئيسية", callback_data: HOME }],
              ],
            },
      });
    }
  }
}
