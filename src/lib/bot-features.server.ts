// ============================================================
// Extended bot features: Homework, Wallet/Topups, Support, Books
// All data persisted via the Telegram-channel-as-DB repo.
// ============================================================
import { sendProtected, tg, getOverrideSync } from "./telegram.server";
import { getCollection, setCollection, upsert, findById, removeById } from "./repo.server";
import type {
  Book,
  BookPurchase,
  Course,
  Homework,
  HomeworkSubmission,
  Lesson,
  PendingAction,
  Student,
  SupportMessage,
  SupportTicket,
  TopupRequest,
  WalletTransaction,
  BroadcastRecord,
} from "./types";

// ---------- helpers ----------
const esc = (v: string) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function nid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function balance(s: Student) {
  return Number(s.wallet_balance || 0);
}

export function getAdminIds(): number[] {
  const raw =
    getOverrideSync("ADMIN_TELEGRAM_IDS") ||
    process.env.ADMIN_TELEGRAM_IDS ||
    "";
  return raw
    .split(/[,\s]+/)
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function isAdmin(uid: number) {
  return getAdminIds().includes(Number(uid));
}

// ---------- Pending action (per-user state machine) ----------
export async function setPending(student_id: number, kind: PendingAction["kind"], payload?: Record<string, any>) {
  await upsert<PendingAction>("pending_actions", {
    id: String(student_id),
    student_id,
    kind,
    payload,
    created_at: new Date().toISOString(),
  });
}

export async function getPending(student_id: number) {
  return findById<PendingAction>("pending_actions", String(student_id));
}

export async function clearPending(student_id: number) {
  await removeById("pending_actions", String(student_id));
}

// ============================================================
// HOMEWORK
// ============================================================
export async function listHomeworkForLesson(chatId: number, lessonId: string) {
  const hws = (await getCollection<Homework>("homework")).filter((h) => h.lesson_id === lessonId);
  if (!hws.length) {
    await tg("sendMessage", { chat_id: chatId, text: "📝 لا توجد واجبات لهذه الحصة." });
    return;
  }
  const rows = hws.map((h) => [{ text: `📝 ${h.title}`, callback_data: `hw:${h.id}` }]);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "اختر واجبًا:",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showHomework(chatId: number, hwId: string, student: Student) {
  const hw = await findById<Homework>("homework", hwId);
  if (!hw) return;
  const subs = (await getCollection<HomeworkSubmission>("homework_submissions")).filter(
    (s) => s.homework_id === hwId && s.student_id === student.id,
  );
  const last = subs.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0];
  const due = hw.due_at ? `\n⏰ آخر موعد: <b>${new Date(hw.due_at).toLocaleString("ar-EG")}</b>` : "";
  const statusLine = last
    ? last.graded_at
      ? `\n\n✅ تم التصحيح: <b>${last.score}/${hw.max_score}</b>\n${esc(last.feedback || "")}`
      : "\n\n⏳ تم التسليم وفي انتظار التصحيح."
    : "";
  await tg("sendMessage", {
    chat_id: chatId,
    text: `📝 <b>${esc(hw.title)}</b>${due}\n\n${esc(hw.instructions)}${statusLine}`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "📤 تسليم الواجب", callback_data: `hwsub:${hw.id}` }]],
    },
  });
}

export async function startHomeworkSubmit(chatId: number, hwId: string, student: Student) {
  const hw = await findById<Homework>("homework", hwId);
  if (!hw) return;
  if (hw.due_at && new Date(hw.due_at).getTime() < Date.now()) {
    await tg("sendMessage", { chat_id: chatId, text: "❌ انتهى موعد تسليم هذا الواجب." });
    return;
  }
  await setPending(student.id, "homework_submit", { homework_id: hwId });
  await tg("sendMessage", {
    chat_id: chatId,
    text: "📤 أرسل إجابتك الآن:\n• نص، أو\n• صورة، أو\n• ملف PDF.",
  });
}

export async function handleHomeworkMessage(chatId: number, student: Student, message: any, payload: any) {
  const hwId = payload?.homework_id as string;
  if (!hwId) {
    await clearPending(student.id);
    return;
  }
  const sub: HomeworkSubmission = {
    id: nid("hs"),
    homework_id: hwId,
    student_id: student.id,
    submitted_at: new Date().toISOString(),
    text: message.text || message.caption || null,
    file_id: null,
    file_kind: null,
  };
  if (message.photo) {
    const photos = message.photo as Array<{ file_id: string }>;
    sub.file_id = photos[photos.length - 1].file_id;
    sub.file_kind = "photo";
  } else if (message.document) {
    sub.file_id = message.document.file_id;
    sub.file_kind = "document";
  }
  await upsert<HomeworkSubmission>("homework_submissions", sub);
  await clearPending(student.id);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "✅ تم استلام واجبك بنجاح. في انتظار التصحيح.",
  });
  // notify admins
  const hw = await findById<Homework>("homework", hwId);
  for (const aid of getAdminIds()) {
    await tg("sendMessage", {
      chat_id: aid,
      text: `📥 واجب جديد للتصحيح\nالطالب: <code>${student.student_code}</code> — ${esc(student.first_name || "")}\nالواجب: ${esc(hw?.title || "")}\n\nللتصحيح:\n<code>/grade ${sub.id} &lt;score&gt; &lt;feedback&gt;</code>`,
      parse_mode: "HTML",
    }).catch(() => {});
    if (sub.file_id) {
      const m = sub.file_kind === "photo" ? "sendPhoto" : "sendDocument";
      const key = sub.file_kind === "photo" ? "photo" : "document";
      await tg(m, { chat_id: aid, [key]: sub.file_id, caption: sub.text || undefined }).catch(() => {});
    } else if (sub.text) {
      await tg("sendMessage", { chat_id: aid, text: `📝 ${esc(sub.text)}` }).catch(() => {});
    }
  }
}

// ============================================================
// WALLET
// ============================================================
export async function showWallet(chatId: number, student: Student) {
  const txs = (await getCollection<WalletTransaction>("wallet_tx"))
    .filter((t) => t.student_id === student.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6);
  const hist = txs.length
    ? "\n\n<b>آخر العمليات:</b>\n" +
      txs
        .map((t) => `${t.amount >= 0 ? "➕" : "➖"} ${Math.abs(t.amount)} ج — ${esc(t.reason)}`)
        .join("\n")
    : "";
  await tg("sendMessage", {
    chat_id: chatId,
    text: `💰 <b>محفظتك</b>\nالرصيد: <b>${balance(student)} ج.م</b>${hist}`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "➕ شحن المحفظة", callback_data: "wallet:topup" }],
        [{ text: "🏠 الرئيسية", callback_data: "__home__" }],
      ],
    },
  });
}

export async function startTopup(chatId: number, student: Student) {
  await setPending(student.id, "topup_amount");
  await tg("sendMessage", {
    chat_id: chatId,
    text: "💵 أدخل المبلغ الذي تريد شحنه (بالجنيه):",
  });
}

export async function handleTopupAmount(chatId: number, student: Student, text: string) {
  const amount = Number(String(text).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    await tg("sendMessage", { chat_id: chatId, text: "❌ مبلغ غير صحيح. حاول مجدداً." });
    return;
  }
  await setPending(student.id, "topup_receipt", { amount });
  await tg("sendMessage", {
    chat_id: chatId,
    text: `💳 المبلغ: ${amount} ج\nأرسل الآن صورة إيصال التحويل (Vodafone Cash / InstaPay / Fawry…) مع رقم العملية.`,
  });
}

export async function handleTopupReceipt(chatId: number, student: Student, message: any, payload: any) {
  const amount = Number(payload?.amount || 0);
  if (!amount) {
    await clearPending(student.id);
    return;
  }
  let receipt_file_id: string | null = null;
  if (message.photo) {
    const photos = message.photo as Array<{ file_id: string }>;
    receipt_file_id = photos[photos.length - 1].file_id;
  } else if (message.document) {
    receipt_file_id = message.document.file_id;
  }
  if (!receipt_file_id) {
    await tg("sendMessage", { chat_id: chatId, text: "❌ من فضلك أرسل صورة إيصال." });
    return;
  }
  const req: TopupRequest = {
    id: nid("tu"),
    student_id: student.id,
    amount,
    method: "manual",
    receipt_file_id,
    note: message.caption || undefined,
    status: "pending",
    created_at: new Date().toISOString(),
  };
  await upsert<TopupRequest>("topup_requests", req);
  await clearPending(student.id);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "✅ تم استلام طلب الشحن. سيتم مراجعته خلال أقرب وقت.",
  });
  // notify admins
  for (const aid of getAdminIds()) {
    await tg("sendPhoto", {
      chat_id: aid,
      photo: receipt_file_id,
      caption: `💳 طلب شحن جديد\nالطالب: <code>${student.student_code}</code>\nالمبلغ: <b>${amount}</b> ج\n\nللموافقة:\n<code>/topup_approve ${req.id}</code>\nللرفض:\n<code>/topup_reject ${req.id} &lt;سبب&gt;</code>`,
      parse_mode: "HTML",
    }).catch(() => {});
  }
}

export async function adjustWallet(student: Student, amount: number, reason: string, ref_id?: string) {
  // Idempotency: if a transaction with the same (reason, ref_id) already exists,
  // skip the credit/debit to prevent double-processing from race conditions
  // between the web admin panel and the bot /topup_approve command.
  if (ref_id) {
    const existing = await getCollection<WalletTransaction>("wallet_tx");
    const dup = existing.find((t) => t.ref_id === ref_id && t.reason === reason && t.student_id === student.id);
    if (dup) {
      return Number(student.wallet_balance || 0);
    }
  }
  const newBalance = balance(student) + amount;
  if (newBalance < 0) throw new Error("الرصيد غير كافٍ");
  student.wallet_balance = newBalance;
  await upsert<Student>("students", student);
  await upsert<WalletTransaction>("wallet_tx", {
    id: nid("wt"),
    student_id: student.id,
    amount,
    reason,
    ref_id: ref_id || null,
    created_at: new Date().toISOString(),
    balance_after: newBalance,
  });
  return newBalance;
}

// ============================================================
// SUPPORT TICKETS
// ============================================================
export async function showSupport(chatId: number, student: Student) {
  const tickets = (await getCollection<SupportTicket>("support_tickets"))
    .filter((t) => t.student_id === student.id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const rows = tickets.slice(0, 8).map((t) => [
    {
      text: `${t.status === "open" ? "🟢" : "⚪"} ${t.subject.slice(0, 40)}`,
      callback_data: `ticket:${t.id}`,
    },
  ]);
  rows.push([{ text: "➕ تذكرة جديدة", callback_data: "ticket:new" }]);
  rows.push([{ text: "🏠 الرئيسية", callback_data: "__home__" }]);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "🆘 <b>الدعم الفني</b>\nاختر تذكرة أو ابدأ تذكرة جديدة.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function startNewTicket(chatId: number, student: Student) {
  await setPending(student.id, "support_subject");
  await tg("sendMessage", { chat_id: chatId, text: "✍️ اكتب موضوع التذكرة (سطر واحد):" });
}

export async function handleSupportSubject(chatId: number, student: Student, text: string) {
  const subject = (text || "").trim().slice(0, 120);
  if (!subject) {
    await tg("sendMessage", { chat_id: chatId, text: "❌ موضوع فارغ." });
    return;
  }
  const ticket: SupportTicket = {
    id: nid("tk"),
    student_id: student.id,
    subject,
    status: "open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await upsert<SupportTicket>("support_tickets", ticket);
  await setPending(student.id, "support_reply", { ticket_id: ticket.id });
  await tg("sendMessage", {
    chat_id: chatId,
    text: `✅ تم إنشاء التذكرة <code>${ticket.id}</code>\nالآن اكتب رسالتك:`,
    parse_mode: "HTML",
  });
}

export async function showTicket(chatId: number, student: Student, ticketId: string) {
  const t = await findById<SupportTicket>("support_tickets", ticketId);
  if (!t || t.student_id !== student.id) return;
  const msgs = (await getCollection<SupportMessage>("support_messages"))
    .filter((m) => m.ticket_id === ticketId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-10);
  const body =
    msgs
      .map(
        (m) =>
          `${m.author_role === "admin" ? "🛠️ الدعم" : "👤 أنت"}: ${esc(m.text || (m.file_id ? "[ملف]" : ""))}`,
      )
      .join("\n") || "لا توجد رسائل بعد.";
  await tg("sendMessage", {
    chat_id: chatId,
    text: `🎫 <b>${esc(t.subject)}</b>\n${t.status === "open" ? "🟢 مفتوحة" : "⚪ مغلقة"}\n\n${body}`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard:
        t.status === "open"
          ? [
              [{ text: "✍️ رد على هذه التذكرة", callback_data: `treply:${ticketId}` }],
              [{ text: "🔒 إغلاق التذكرة", callback_data: `tclose:${ticketId}` }],
            ]
          : [[{ text: "↩️ إعادة فتح", callback_data: `treopen:${ticketId}` }]],
    },
  });
}

export async function startTicketReply(chatId: number, student: Student, ticketId: string) {
  await setPending(student.id, "support_reply", { ticket_id: ticketId });
  await tg("sendMessage", { chat_id: chatId, text: "✍️ اكتب ردك:" });
}

export async function handleSupportReply(chatId: number, student: Student, message: any, payload: any) {
  const ticketId = payload?.ticket_id as string;
  const t = await findById<SupportTicket>("support_tickets", ticketId);
  if (!t) {
    await clearPending(student.id);
    return;
  }
  const sm: SupportMessage = {
    id: nid("sm"),
    ticket_id: ticketId,
    author_id: student.id,
    author_role: "student",
    text: message.text || message.caption || undefined,
    file_id: null,
    file_kind: null,
    created_at: new Date().toISOString(),
  };
  if (message.photo) {
    const photos = message.photo as Array<{ file_id: string }>;
    sm.file_id = photos[photos.length - 1].file_id;
    sm.file_kind = "photo";
  } else if (message.document) {
    sm.file_id = message.document.file_id;
    sm.file_kind = "document";
  }
  await upsert<SupportMessage>("support_messages", sm);
  t.updated_at = new Date().toISOString();
  t.status = "open";
  await upsert<SupportTicket>("support_tickets", t);
  // Keep the conversation open — student stays in reply mode until they
  // explicitly tap "إنهاء المحادثة" or close the ticket. No more single-shot messaging.
  await setPending(student.id, "support_reply", { ticket_id: ticketId });
  await tg("sendMessage", {
    chat_id: chatId,
    text: "✅ تم إرسال رسالتك. اكتب رسالة أخرى للمتابعة، أو أنهِ المحادثة:",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔚 إنهاء المحادثة", callback_data: `tdone:${ticketId}` }],
        [{ text: "🔒 إغلاق التذكرة", callback_data: `tclose:${ticketId}` }],
      ],
    },
  });
  // notify admins
  for (const aid of getAdminIds()) {
    await tg("sendMessage", {
      chat_id: aid,
      text: `🆘 رسالة جديدة\nالطالب: <code>${student.student_code}</code>\nالتذكرة: <code>${ticketId}</code>\nالموضوع: ${esc(t.subject)}\n\n${esc(sm.text || "(ملف)")}\n\nللرد:\n<code>/reply ${ticketId} &lt;الرسالة&gt;</code>`,
      parse_mode: "HTML",
    }).catch(() => {});
    if (sm.file_id) {
      const m = sm.file_kind === "photo" ? "sendPhoto" : "sendDocument";
      const key = sm.file_kind === "photo" ? "photo" : "document";
      await tg(m, { chat_id: aid, [key]: sm.file_id }).catch(() => {});
    }
  }
}

export async function endSupportConversation(chatId: number, student: Student) {
  await clearPending(student.id);
  await tg("sendMessage", {
    chat_id: chatId,
    text: "✅ تم إنهاء المحادثة. التذكرة لا تزال مفتوحة — يمكنك العودة في أي وقت من قائمة الدعم.",
    reply_markup: { inline_keyboard: [[{ text: "🆘 قائمة الدعم", callback_data: "menu:support" }], [{ text: "🏠 الرئيسية", callback_data: "__home__" }]] },
  });
}

export async function closeTicket(chatId: number, student: Student, ticketId: string, reopen = false) {
  const t = await findById<SupportTicket>("support_tickets", ticketId);
  if (!t || t.student_id !== student.id) return;
  t.status = reopen ? "open" : "closed";
  t.updated_at = new Date().toISOString();
  await upsert<SupportTicket>("support_tickets", t);
  await tg("sendMessage", { chat_id: chatId, text: reopen ? "↩️ تم إعادة فتح التذكرة." : "🔒 تم إغلاق التذكرة." });
}

// ============================================================
// BOOKS
// ============================================================
export async function showBooks(chatId: number, student: Student) {
  const books = (await getCollection<Book>("books")).filter((b) => b.is_published);
  if (!books.length) {
    await tg("sendMessage", { chat_id: chatId, text: "📚 لا توجد كتب متاحة حاليًا." });
    return;
  }
  const rows = books.map((b) => [
    { text: `${b.price === 0 ? "🆓" : "💰"} ${b.title} — ${b.price === 0 ? "مجاني" : b.price + " ج"}`, callback_data: `book:${b.id}` },
  ]);
  rows.push([{ text: "🏠 الرئيسية", callback_data: "__home__" }]);
  await tg("sendMessage", {
    chat_id: chatId,
    text: `📚 <b>المكتبة</b>\nرصيدك: ${balance(student)} ج`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showBook(chatId: number, bookId: string, student: Student) {
  const b = await findById<Book>("books", bookId);
  if (!b) return;
  const owned = (await getCollection<BookPurchase>("book_purchases")).some(
    (p) => p.book_id === bookId && p.student_id === student.id,
  );
  const text = `📘 <b>${esc(b.title)}</b>\n\n${esc(b.description || "")}\n\nالسعر: <b>${b.price === 0 ? "مجاني" : b.price + " ج"}</b>\nرصيدك: ${balance(student)} ج`;
  const rows = owned || b.price === 0
    ? [[{ text: "📥 استلام الكتاب", callback_data: `bookget:${bookId}` }]]
    : [[{ text: `💰 شراء (${b.price} ج)`, callback_data: `bookbuy:${bookId}` }]];
  rows.push([{ text: "◀️ المكتبة", callback_data: "menu:books" }]);
  if (b.cover_file_id) {
    await sendProtected("sendPhoto", {
      chat_id: chatId,
      photo: b.cover_file_id,
      caption: text,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows },
    }).catch(async () => {
      await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
    });
  } else {
    await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", reply_markup: { inline_keyboard: rows } });
  }
}

export async function buyBook(chatId: number, bookId: string, student: Student) {
  const b = await findById<Book>("books", bookId);
  if (!b) return;
  const already = (await getCollection<BookPurchase>("book_purchases")).some(
    (p) => p.book_id === bookId && p.student_id === student.id,
  );
  if (already) return sendBookFile(chatId, b, student);
  if (b.price > 0) {
    if (balance(student) < b.price) {
      await tg("sendMessage", {
        chat_id: chatId,
        text: `❌ رصيدك (${balance(student)} ج) غير كافٍ. اشحن المحفظة أولاً.`,
        reply_markup: { inline_keyboard: [[{ text: "💰 شحن المحفظة", callback_data: "wallet:topup" }]] },
      });
      return;
    }
    await adjustWallet(student, -b.price, `book_purchase:${b.id}`, b.id);
  }
  await upsert<BookPurchase>("book_purchases", {
    id: nid("bp"),
    book_id: b.id,
    student_id: student.id,
    price_paid: b.price,
    purchased_at: new Date().toISOString(),
  });
  await tg("sendMessage", { chat_id: chatId, text: "✅ تم الشراء بنجاح." });
  await sendBookFile(chatId, b, student);
}

export async function sendBookFile(chatId: number, b: Book, student: Student) {
  const owned = b.price === 0 ||
    (await getCollection<BookPurchase>("book_purchases")).some(
      (p) => p.book_id === b.id && p.student_id === student.id,
    );
  if (!owned) {
    await tg("sendMessage", { chat_id: chatId, text: "❌ يجب شراء الكتاب أولاً." });
    return;
  }
  const method = b.file_kind === "photo" ? "sendPhoto" : "sendDocument";
  const key = b.file_kind === "photo" ? "photo" : "document";
  await sendProtected(method, {
    chat_id: chatId,
    [key]: b.file_id,
    caption: `📘 ${b.title}\n— ${student.student_code}`,
  }).catch((e) =>
    tg("sendMessage", { chat_id: chatId, text: `⚠️ تعذر إرسال الكتاب: ${e.message}` }),
  );
}

// ============================================================
// ADMIN COMMANDS (text-based in DM with the bot)
// ============================================================
export async function handleAdminCommand(chatId: number, fromId: number, text: string): Promise<boolean> {
  if (!isAdmin(fromId)) return false;
  const trim = text.trim();

  // /admin
  if (trim === "/admin") {
    await tg("sendMessage", {
      chat_id: chatId,
      text:
        "🛠️ <b>لوحة الأدمن</b>\n\n" +
        "<code>/grade &lt;submission_id&gt; &lt;score&gt; &lt;feedback&gt;</code>\n" +
        "<code>/topup_approve &lt;req_id&gt;</code>\n" +
        "<code>/topup_reject &lt;req_id&gt; &lt;سبب&gt;</code>\n" +
        "<code>/reply &lt;ticket_id&gt; &lt;الرسالة&gt;</code>\n" +
        "<code>/broadcast &lt;الرسالة&gt;</code>\n" +
        "<code>/addbook</code> — إضافة كتاب جديد\n" +
        "<code>/addhw &lt;lesson_id&gt; | &lt;title&gt; | &lt;instructions&gt; | &lt;max_score&gt;</code>\n" +
        "<code>/stats</code> — إحصائيات سريعة\n" +
        "<code>/credit &lt;student_code&gt; &lt;amount&gt;</code> — تعديل رصيد",
      parse_mode: "HTML",
    });
    return true;
  }

  // /stats
  if (trim === "/stats") {
    const [students, courses, lessons, books, tickets, topups, subs] = await Promise.all([
      getCollection("students"),
      getCollection("courses"),
      getCollection("lessons"),
      getCollection("books"),
      getCollection<SupportTicket>("support_tickets"),
      getCollection<TopupRequest>("topup_requests"),
      getCollection<HomeworkSubmission>("homework_submissions"),
    ]);
    await tg("sendMessage", {
      chat_id: chatId,
      text: `📊 إحصائيات\n👥 طلاب: ${students.length}\n📚 كورسات: ${courses.length}\n🎬 حصص: ${lessons.length}\n📘 كتب: ${books.length}\n🎫 تذاكر مفتوحة: ${tickets.filter((t) => t.status === "open").length}\n💳 طلبات شحن معلقة: ${topups.filter((t) => t.status === "pending").length}\n📝 واجبات بانتظار التصحيح: ${subs.filter((s) => !s.graded_at).length}`,
    });
    return true;
  }

  // /grade <id> <score> <feedback...>
  if (trim.startsWith("/grade ")) {
    const m = trim.match(/^\/grade\s+(\S+)\s+(-?\d+(?:\.\d+)?)\s*(.*)$/s);
    if (!m) {
      await tg("sendMessage", { chat_id: chatId, text: "صيغة خاطئة." });
      return true;
    }
    const [, sid, scoreStr, feedback] = m;
    const sub = await findById<HomeworkSubmission>("homework_submissions", sid);
    if (!sub) {
      await tg("sendMessage", { chat_id: chatId, text: "تسليم غير موجود." });
      return true;
    }
    sub.score = Number(scoreStr);
    sub.feedback = feedback || null;
    sub.graded_at = new Date().toISOString();
    sub.graded_by = fromId;
    await upsert<HomeworkSubmission>("homework_submissions", sub);
    const hw = await findById<Homework>("homework", sub.homework_id);
    await tg("sendMessage", { chat_id: chatId, text: "✅ تم التصحيح." });
    // notify student
    await tg("sendMessage", {
      chat_id: sub.student_id,
      text: `✅ تم تصحيح واجبك "${esc(hw?.title || "")}":\nالدرجة: <b>${sub.score}/${hw?.max_score ?? "?"}</b>\n${esc(feedback || "")}`,
      parse_mode: "HTML",
    }).catch(() => {});
    return true;
  }

  // /topup_approve <id>
  if (trim.startsWith("/topup_approve ")) {
    const id = trim.slice("/topup_approve ".length).trim();
    const req = await findById<TopupRequest>("topup_requests", id);
    if (!req || req.status !== "pending") {
      await tg("sendMessage", { chat_id: chatId, text: "طلب غير موجود/تمت معالجته." });
      return true;
    }
    const stu = await findById<Student>("students", req.student_id);
    if (!stu) {
      await tg("sendMessage", { chat_id: chatId, text: "الطالب غير موجود." });
      return true;
    }
    await adjustWallet(stu, req.amount, "topup_approved", req.id);
    req.status = "approved";
    req.reviewed_at = new Date().toISOString();
    req.reviewed_by = fromId;
    await upsert<TopupRequest>("topup_requests", req);
    await tg("sendMessage", { chat_id: chatId, text: `✅ تمت إضافة ${req.amount} ج لرصيد ${stu.student_code}.` });
    await tg("sendMessage", {
      chat_id: req.student_id,
      text: `✅ تم اعتماد طلب الشحن (${req.amount} ج). رصيدك الجديد: ${stu.wallet_balance} ج.`,
    }).catch(() => {});
    return true;
  }

  // /topup_reject <id> <reason>
  if (trim.startsWith("/topup_reject ")) {
    const m = trim.match(/^\/topup_reject\s+(\S+)\s*(.*)$/s);
    if (!m) return (await tg("sendMessage", { chat_id: chatId, text: "صيغة خاطئة." }), true);
    const [, id, reason] = m;
    const req = await findById<TopupRequest>("topup_requests", id);
    if (!req || req.status !== "pending") {
      await tg("sendMessage", { chat_id: chatId, text: "طلب غير صالح." });
      return true;
    }
    req.status = "rejected";
    req.review_note = reason || null;
    req.reviewed_at = new Date().toISOString();
    req.reviewed_by = fromId;
    await upsert<TopupRequest>("topup_requests", req);
    await tg("sendMessage", { chat_id: chatId, text: "❌ تم الرفض." });
    await tg("sendMessage", {
      chat_id: req.student_id,
      text: `❌ تم رفض طلب الشحن (${req.amount} ج).\n${reason ? "السبب: " + esc(reason) : ""}`,
      parse_mode: "HTML",
    }).catch(() => {});
    return true;
  }

  // /reply <ticket_id> <message>
  if (trim.startsWith("/reply ")) {
    const m = trim.match(/^\/reply\s+(\S+)\s+([\s\S]+)$/);
    if (!m) return (await tg("sendMessage", { chat_id: chatId, text: "صيغة خاطئة." }), true);
    const [, tid, body] = m;
    const t = await findById<SupportTicket>("support_tickets", tid);
    if (!t) {
      await tg("sendMessage", { chat_id: chatId, text: "تذكرة غير موجودة." });
      return true;
    }
    await upsert<SupportMessage>("support_messages", {
      id: nid("sm"),
      ticket_id: tid,
      author_id: fromId,
      author_role: "admin",
      text: body,
      created_at: new Date().toISOString(),
    });
    t.updated_at = new Date().toISOString();
    t.last_admin_id = fromId;
    await upsert<SupportTicket>("support_tickets", t);
    await tg("sendMessage", {
      chat_id: t.student_id,
      text: `🛠️ رد جديد على تذكرتك "${esc(t.subject)}":\n\n${esc(body)}`,
      parse_mode: "HTML",
    }).catch(() => {});
    await tg("sendMessage", { chat_id: chatId, text: "✅ تم الإرسال." });
    return true;
  }

  // /broadcast <message>
  if (trim.startsWith("/broadcast ")) {
    const body = trim.slice("/broadcast ".length).trim();
    if (!body) return true;
    const students = await getCollection<Student>("students");
    let sent = 0, failed = 0;
    for (const s of students) {
      try {
        await tg("sendMessage", { chat_id: s.id, text: body });
        sent++;
      } catch { failed++; }
    }
    await upsert<BroadcastRecord>("broadcasts", {
      id: nid("bc"),
      by: fromId,
      text: body,
      sent,
      failed,
      created_at: new Date().toISOString(),
    });
    await tg("sendMessage", { chat_id: chatId, text: `📢 تم الإرسال: ${sent} نجح، ${failed} فشل.` });
    return true;
  }

  // /credit <student_code> <amount>
  if (trim.startsWith("/credit ")) {
    const m = trim.match(/^\/credit\s+(\S+)\s+(-?\d+(?:\.\d+)?)$/);
    if (!m) return (await tg("sendMessage", { chat_id: chatId, text: "صيغة خاطئة." }), true);
    const [, code, amt] = m;
    const students = await getCollection<Student>("students");
    const stu = students.find((s) => s.student_code === code);
    if (!stu) {
      await tg("sendMessage", { chat_id: chatId, text: "طالب غير موجود." });
      return true;
    }
    await adjustWallet(stu, Number(amt), "admin_adjust");
    await tg("sendMessage", { chat_id: chatId, text: `✅ الرصيد الجديد لـ ${code}: ${stu.wallet_balance} ج` });
    return true;
  }

  // /addhw lesson_id | title | instructions | max_score
  if (trim.startsWith("/addhw ")) {
    const parts = trim.slice("/addhw ".length).split("|").map((s) => s.trim());
    if (parts.length < 4) {
      await tg("sendMessage", { chat_id: chatId, text: "صيغة: /addhw <lesson_id> | <title> | <instructions> | <max_score>" });
      return true;
    }
    const [lessonId, title, instr, maxScore] = parts;
    const lesson = await findById<Lesson>("lessons", lessonId);
    if (!lesson) {
      await tg("sendMessage", { chat_id: chatId, text: "حصة غير موجودة." });
      return true;
    }
    const hw: Homework = {
      id: nid("hw"),
      lesson_id: lessonId,
      course_id: lesson.course_id,
      title,
      instructions: instr,
      max_score: Number(maxScore) || 100,
      created_at: new Date().toISOString(),
    };
    await upsert<Homework>("homework", hw);
    await tg("sendMessage", { chat_id: chatId, text: `✅ تم إنشاء الواجب: <code>${hw.id}</code>`, parse_mode: "HTML" });
    return true;
  }

  // /addbook  → multi-step flow
  if (trim === "/addbook") {
    await setPending(fromId, "admin_add_book_title");
    await tg("sendMessage", { chat_id: chatId, text: "📘 أرسل عنوان الكتاب:" });
    return true;
  }

  return false;
}

// Multi-step admin pending state (book creation)
export async function handleAdminPending(
  chatId: number,
  fromId: number,
  message: any,
  pending: PendingAction,
): Promise<boolean> {
  if (!isAdmin(fromId)) return false;

  if (pending.kind === "admin_add_book_title") {
    const title = (message.text || "").trim();
    if (!title) return true;
    await setPending(fromId, "admin_add_book_price", { title });
    await tg("sendMessage", { chat_id: chatId, text: "💰 أرسل سعر الكتاب (0 = مجاني):" });
    return true;
  }

  if (pending.kind === "admin_add_book_price") {
    const price = Number((message.text || "").trim());
    if (!Number.isFinite(price) || price < 0) {
      await tg("sendMessage", { chat_id: chatId, text: "❌ سعر غير صحيح." });
      return true;
    }
    await setPending(fromId, "admin_add_book_file", { ...pending.payload, price });
    await tg("sendMessage", { chat_id: chatId, text: "📎 الآن أرسل ملف الكتاب (PDF أو صورة):" });
    return true;
  }

  if (pending.kind === "admin_add_book_file") {
    let file_id: string | null = null;
    let kind: "document" | "photo" = "document";
    if (message.document) {
      file_id = message.document.file_id;
      kind = "document";
    } else if (message.photo) {
      const photos = message.photo as Array<{ file_id: string }>;
      file_id = photos[photos.length - 1].file_id;
      kind = "photo";
    }
    if (!file_id) {
      await tg("sendMessage", { chat_id: chatId, text: "❌ أرسل ملفًا." });
      return true;
    }
    const book: Book = {
      id: nid("bk"),
      title: pending.payload?.title || "كتاب",
      description: "",
      price: Number(pending.payload?.price || 0),
      file_id,
      file_kind: kind,
      cover_file_id: null,
      is_published: true,
      created_at: new Date().toISOString(),
    };
    await upsert<Book>("books", book);
    await clearPending(fromId);
    await tg("sendMessage", { chat_id: chatId, text: `✅ تم إضافة الكتاب: ${book.title} (${book.price} ج)` });
    return true;
  }

  return false;
}