// ============================================================
// LMS Schema v2 — stored in Telegram channel as chunked JSON
// ============================================================

// ---------- Legacy FAQ ----------
export type MediaItem = { type: "photo" | "video"; file_id: string };

export type Question = {
  id: string;
  title: string;
  answer: string;
  media: MediaItem[];
  parent_id?: string | null;
  order: number;
};

export type BotData = {
  welcome_text: string;
  inquiry_text: string;
  questions: Question[];
  updated_at: string;
};

export type IndexState = {
  index_message_id: number | null;
  data: BotData;
};

export const DEFAULT_DATA: BotData = {
  welcome_text:
    "👋 أهلاً بك في المنصة!\n\nاضغط /courses لاستعراض الكورسات، أو /redeem لشحن كود حصة.",
  inquiry_text: "📞 للاستفسار تواصل مع الإدارة.",
  questions: [],
  updated_at: new Date(0).toISOString(),
};

// ---------- LMS Core Entities ----------

/** Course — top-level container shown as a card */
export type Course = {
  id: string;
  title: string;                 // "الشهر الثاني — كيمياء"
  subtitle?: string;             // "مراجعة ليالي الامتحان"
  cover_file_id?: string | null; // photo file_id (from MEDIA channel)
  cover_url?: string | null;     // optional fallback URL
  is_pinned?: boolean;           // shows "كورس مثبت" badge
  is_published?: boolean;
  order: number;
  created_at: string;
  updated_at: string;
};

/** Resource attached to a lesson */
export type LessonResource = {
  id: string;
  kind: "video" | "document" | "photo" | "audio" | "link";
  file_id?: string;           // Telegram file_id from MEDIA channel
  url?: string;               // External lesson link, e.g. Google Drive video
  provider?: "google_drive" | "external";
  file_name?: string;
  caption?: string;
  size_bytes?: number;
  mime?: string;
};

/** Lesson — child of a course (e.g. "شرح حمادة", "الامتحان التقييمي") */
export type Lesson = {
  id: string;
  course_id: string;
  title: string;
  description?: string;
  resources: LessonResource[];   // [video], [pdf], etc.
  quiz_id?: string | null;       // optional linked quiz
  order: number;
  created_at: string;
  updated_at: string;
};

// ---------- Vouchers ----------
export type VoucherBatch = {
  id: string;
  prefix: string;             // e.g. "AMW"
  course_id: string;          // course this batch unlocks
  duration_days: number;      // subscription days granted
  count: number;
  created_at: string;
  note?: string;
};

export type Voucher = {
  code: string;               // "AMW-XXXX-XXXX"
  batch_id: string;
  course_id: string;
  duration_days: number;
  used_by?: number | null;    // telegram user id
  used_at?: string | null;
  created_at: string;
};

// ---------- Students ----------
export type StudentSubscription = {
  course_id: string;
  voucher_code: string;
  started_at: string;
  expires_at: string;          // ISO
};

export type StudentDevice = {
  fingerprint: string;         // sha256(ua + lang + ip-prefix)
  user_agent?: string;
  first_seen: string;
  last_seen: string;
};

export type Student = {
  id: number;                  // telegram user_id
  student_code: string;        // human-friendly e.g. "STD-7F3A"
  first_name?: string;
  last_name?: string;
  username?: string;
  phone_number?: string | null;
  full_name?: string;          // 4-word legal name entered on web sign-up
  grade?: "g1" | "g2" | "g3";
  track?: "general" | "azhar";
  parent_phone?: string | null;
  joined_at: string;
  subscriptions: StudentSubscription[];
  device?: StudentDevice | null;
  locked?: boolean;            // device mismatch lock
  banned?: boolean;
  points: number;
  last_active?: string;
  wallet_balance?: number;     // EGP
  read_broadcasts?: string[];  // broadcast ids the student has marked as read
  password_hash?: string;      // scrypt hash for name+password login
};

// ---------- Quizzes (MCQ) ----------
export type QuizQuestion = {
  id: string;
  text: string;
  image_file_id?: string | null;
  options: string[];           // 2..6 options
  correct_index: number;
  explanation?: string;
};

export type Quiz = {
  id: string;
  lesson_id?: string | null;
  course_id?: string | null;
  title: string;
  duration_seconds: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  questions: QuizQuestion[];
  created_at: string;
};

export type Attempt = {
  id: string;
  quiz_id: string;
  student_id: number;
  started_at: string;
  ended_at?: string | null;
  score?: number;
  total?: number;
  answers: { qid: string; chosen_index: number }[];
};

// ---------- Polls ----------
export type Poll = {
  id: string;
  question: string;
  options: string[];
  type?: "choice" | "rating" | "feedback";
  target_course_id?: string | null;
  sent_message_count?: number;
  is_open: boolean;
  created_at: string;
};

export type Vote = {
  poll_id: string;
  student_id: number;
  option_index: number;
  voted_at: string;
};

// ---------- App Settings (mirror of secrets) ----------
export type AppSettings = {
  data_channel_id?: string;
  media_channel_id?: string;
  brand_name?: string;
  updated_at: string;
};

export const COLLECTIONS = {
  settings: "settings",
  courses: "courses",
  lessons: "lessons",
  vouchers: "vouchers",
  voucher_batches: "voucher_batches",
  students: "students",
  quizzes: "quizzes",
  attempts: "attempts",
  polls: "polls",
  votes: "votes",
  homework: "homework",
  homework_submissions: "homework_submissions",
  topup_requests: "topup_requests",
  wallet_tx: "wallet_tx",
  support_tickets: "support_tickets",
  support_messages: "support_messages",
  books: "books",
  book_purchases: "book_purchases",
  pending_actions: "pending_actions",
  broadcasts: "broadcasts",
  pending_registrations: "pending_registrations",
} as const;

export type CollectionName = keyof typeof COLLECTIONS;

// ---------- Homework ----------
export type Homework = {
  id: string;
  lesson_id: string;
  course_id: string;
  title: string;
  instructions: string;
  due_at?: string | null;
  max_score: number;
  created_at: string;
};

export type HomeworkSubmission = {
  id: string;
  homework_id: string;
  student_id: number;
  text?: string;
  file_id?: string | null;
  file_kind?: "photo" | "document" | null;
  submitted_at: string;
  graded_at?: string | null;
  score?: number | null;
  feedback?: string | null;
  graded_by?: number | null;
};

// ---------- Wallet / Topups ----------
export type WalletTransaction = {
  id: string;
  student_id: number;
  amount: number;            // positive = credit, negative = debit
  reason: string;            // "topup_approved" | "book_purchase" | "subscription" | "admin_adjust"
  ref_id?: string | null;
  created_at: string;
  balance_after: number;
};

export type TopupRequest = {
  id: string;
  student_id: number;
  amount: number;
  method: string;           // "vodafone" | "instapay" | "fawry" | "manual"
  receipt_file_id?: string | null;
  note?: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at?: string | null;
  reviewed_by?: number | null;
  review_note?: string | null;
};

// ---------- Support ----------
export type SupportTicket = {
  id: string;
  student_id: number;
  subject: string;
  status: "open" | "closed";
  created_at: string;
  updated_at: string;
  last_admin_id?: number | null;
};

export type SupportMessage = {
  id: string;
  ticket_id: string;
  author_id: number;       // student id or admin telegram id
  author_role: "student" | "admin";
  text?: string;
  file_id?: string | null;
  file_kind?: "photo" | "document" | null;
  created_at: string;
};

// ---------- Books ----------
export type Book = {
  id: string;
  title: string;
  description?: string;
  price: number;                 // EGP; 0 = free
  cover_file_id?: string | null;
  file_id: string;               // PDF/document file_id from media channel
  file_kind: "document" | "photo";
  is_published: boolean;
  created_at: string;
};

export type BookPurchase = {
  id: string;
  book_id: string;
  student_id: number;
  price_paid: number;
  purchased_at: string;
};

// ---------- Pending action state for multi-step bot flows ----------
export type PendingAction = {
  id: string;                    // == student id (as string)
  student_id: number;
  kind:
    | "homework_submit"
    | "topup_amount"
    | "topup_receipt"
    | "support_subject"
    | "support_reply"
    | "admin_reply_ticket"
    | "admin_grade_homework"
    | "admin_broadcast"
    | "admin_add_book_title"
    | "admin_add_book_price"
    | "admin_add_book_file";
  payload?: Record<string, any>;
  created_at: string;
};

export type BroadcastRecord = {
  id: string;
  by: number;
  text: string;
  sent: number;
  failed: number;
  created_at: string;
};

// ---------- Phone-verification registration ----------
export type PendingRegistration = {
  id: string;              // normalized phone, e.g. "201234567890"
  full_name: string;       // 4 words
  grade: "g1" | "g2" | "g3";
  track: "general" | "azhar";
  student_phone: string;   // normalized
  parent_phone: string;    // normalized
  code: string;            // 6 digits
  attempts: number;        // failed attempts on code entry
  expires_at: string;      // ISO
  telegram_id?: number | null;
  created_at: string;
  resend_count?: number;   // how many times the code has been resent
  last_resent_at?: string; // ISO of last resend (or initial issue)
  token?: string;          // short deep-link token: /start <token>
  password_hash?: string;  // scrypt hash carried from signup form
};
