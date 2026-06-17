import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  studentStartRegistration,
  studentConfirmCode,
  studentPendingStatus,
  studentResendCode,
  studentStatus,
  studentPasswordLogin,
  studentStartPasswordReset,
} from "@/lib/student.functions";
import { adminLogin } from "@/lib/admin.functions";

export const Route = createFileRoute("/login")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => {
    const t = s.tab;
    const tab: Tab =
      t === "signup" || t === "login" || t === "teacher" || t === "support"
        ? (t as Tab)
        : "signup";
    return { tab };
  },
  head: () => ({ meta: [{ title: "تسجيل دخول — AMW LMS" }] }),
  component: LoginPage,
});

type Tab = "signup" | "login" | "teacher" | "support";
type PendingUiStatus = "idle" | "waiting" | "verified" | "expired" | "not_found";

function validateFullArabicName(value: string) {
  const normalized = value.replace(/ـ/g, "").trim().replace(/\s+/g, " ");
  const parts = normalized.split(" ").filter(Boolean);
  const validPart = /^[\u0621-\u064A\u0671-\u06D3]{2,}$/u;
  if (parts.length !== 4) return "اكتب الاسم رباعي بالضبط: أربع كلمات عربية.";
  if (parts.some((p) => !validPart.test(p) || /[\d٠-٩۰-۹]/.test(p))) {
    return "الاسم الرباعي لازم يكون حروف عربية فقط بدون أرقام أو رموز.";
  }
  return null;
}

function LoginPage() {
  const navigate = useNavigate();
  const status = useServerFn(studentStatus);
  const { tab: initialTab } = Route.useSearch();
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    status()
      .then((r) => {
        if (r.loggedIn) navigate({ to: "/student" });
      })
      .catch(() => {});
  }, []);

  return (
    <div dir="rtl" className="min-h-screen flex flex-col px-4 py-6 relative">
      <div className="absolute inset-0 -z-10 brand-gradient opacity-10 blur-3xl" />
      <div className="flex items-center justify-between mb-4 max-w-md mx-auto w-full">
        <BackButton fallback="/" />
        <ThemeToggle />
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md surface-card p-6 sm:p-8 space-y-6">
          <div className="text-center">
            <div className="text-4xl mb-2">
              {tab === "teacher" ? "👨‍🏫" : tab === "support" ? "🧑‍🔧" : "🎓"}
            </div>
            <h1 className="text-2xl font-bold">منصة AMW</h1>
            <p className="text-sm text-muted-foreground mt-1">سجّل دخولك للمتابعة</p>
          </div>

          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-secondary/50 text-[11px] sm:text-xs">
            <TabButton active={tab === "signup"} onClick={() => setTab("signup")}>
              🆕 إنشاء
            </TabButton>
            <TabButton active={tab === "login"} onClick={() => setTab("login")}>
              🔐 طالب
            </TabButton>
            <TabButton active={tab === "support"} onClick={() => setTab("support")}>
              🧑‍🔧 دعم
            </TabButton>
            <TabButton active={tab === "teacher"} onClick={() => setTab("teacher")}>
              👨‍🏫 معلم
            </TabButton>
          </div>

          {tab === "signup" && <StudentForm />}
          {tab === "login" && <ExistingStudentForm />}
          {tab === "support" && <SupportPlaceholder />}
          {tab === "teacher" && <TeacherForm />}
        </div>
      </div>
    </div>
  );
}

function SupportPlaceholder() {
  return (
    <div className="text-center space-y-4 py-4">
      <div className="text-5xl">🧑‍🔧</div>
      <h2 className="font-bold text-lg">دخول الدعم الفني</h2>
      <p className="text-sm text-muted-foreground leading-relaxed">
        لوحة الدعم الفني قيد الإعداد. هيتم تفعيلها في المرحلة القادمة بحساب
        اسم + كود يحدّدهم المعلم من لوحة التحكم.
      </p>
      <div className="rounded-xl border border-border bg-secondary/40 p-4 text-xs text-right text-muted-foreground">
        <strong className="text-foreground">المعلم:</strong> يقدر يضيف حسابات الدعم
        من <code className="text-primary">/admin/support</code> بعد تسجيل دخوله.
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg py-2 text-sm font-semibold transition ${
        active
          ? "bg-background shadow-sm text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ============================================================
// Teacher: simple password form
// ============================================================
function TeacherForm() {
  const login = useServerFn(adminLogin);
  const navigate = useNavigate();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login({ data: { password } });
      await router.invalidate();
      navigate({ to: "/admin" });
    } catch (e: any) {
      setError(e.message || "كلمة المرور غير صحيحة");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="كلمة المرور">
        <input
          type="password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
        />
      </Field>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "..." : "دخول لوحة التحكم"}
      </button>
    </form>
  );
}

// ============================================================
// Student: register → verify via bot → confirm code
// ============================================================
function StudentForm() {
  const navigate = useNavigate();
  const router = useRouter();
  const start = useServerFn(studentStartRegistration);
  const confirm = useServerFn(studentConfirmCode);
  const checkPending = useServerFn(studentPendingStatus);
  const resend = useServerFn(studentResendCode);

  const [step, setStep] = useState<"form" | "code">("form");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<PendingUiStatus>("idle");
  const [pendingMessage, setPendingMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [resendsRemaining, setResendsRemaining] = useState<number | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const [now, setNow] = useState<number>(() => Date.now());

  const [fullName, setFullName] = useState("");
  const [grade, setGrade] = useState<"g1" | "g2" | "g3">("g1");
  const [track, setTrack] = useState<"general" | "azhar">("general");
  const [studentPhone, setStudentPhone] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [pendingPhone, setPendingPhone] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [botLink, setBotLink] = useState("");
  const [code, setCode] = useState("");

  const nameError = fullName.trim() ? validateFullArabicName(fullName) : null;

  // Live ticking clock so the countdown re-renders each second.
  useEffect(() => {
    if (step !== "code") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (step !== "code" || !pendingPhone) return;
    let cancelled = false;
    async function refreshStatus() {
      try {
        const r = await checkPending({ data: { phone: pendingPhone } });
        if (cancelled) return;
        setPendingStatus(r.status);
        setPendingMessage(r.message);
        setExpiresAt("expires_at" in r ? (r.expires_at ?? null) : null);
        if ("resends_remaining" in r && typeof r.resends_remaining === "number") {
          setResendsRemaining(r.resends_remaining);
        }
        if ("cooldown_ms" in r && typeof r.cooldown_ms === "number" && r.cooldown_ms > 0) {
          setCooldownUntil(Date.now() + r.cooldown_ms);
        }
      } catch {
        if (!cancelled) setPendingMessage("تعذر تحديث حالة الطلب الآن.");
      }
    }
    refreshStatus();
    const timer = window.setInterval(refreshStatus, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [step, pendingPhone, checkPending]);

  const expiresInMs = expiresAt ? Math.max(0, new Date(expiresAt).getTime() - now) : 0;
  const cooldownMs = Math.max(0, cooldownUntil - now);
  const canResend =
    pendingStatus !== "expired" &&
    pendingStatus !== "not_found" &&
    cooldownMs === 0 &&
    (resendsRemaining === null || resendsRemaining > 0) &&
    !resending;

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    const clientNameError = validateFullArabicName(fullName);
    if (clientNameError) {
      setError(clientNameError);
      return;
    }
    if (password.length < 6) {
      setError("كلمة المرور لازم تكون 6 أحرف على الأقل.");
      return;
    }
    if (password !== confirmPassword) {
      setError("كلمة المرور وتأكيدها غير متطابقتين.");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const r = await start({
        data: {
          full_name: fullName,
          grade,
          track,
          student_phone: studentPhone,
          parent_phone: parentPhone,
          password,
        },
      });
      setPendingPhone(r.phone);
      setBotUsername(r.bot_username || "");
      setBotLink(r.bot_link || "");
      setPendingStatus("waiting");
      setPendingMessage("اضغط الزر بالأسفل لفتح البوت، البوت هيبعتلك الكود تلقائياً.");
      setExpiresAt(null);
      setResendsRemaining(null);
      setCooldownUntil(0);
      setCode("");
      setStep("code");
    } catch (e: any) {
      setError(e.message || "حصل خطأ");
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    if (!canResend) return;
    setResending(true);
    setError(null);
    setInfo(null);
    try {
      const r = await resend({ data: { phone: pendingPhone } });
      setExpiresAt(r.expires_at);
      setResendsRemaining(r.resends_remaining);
      setCooldownUntil(Date.now() + (r.cooldown_ms || 0));
      setInfo(
        r.delivered
          ? "تم إرسال كود جديد إلى تيليجرام. تحقق من المحادثة."
          : "تم توليد كود جديد. لازم تشارك رقمك من البوت أولاً علشان يوصلك.",
      );
      setCode("");
    } catch (e: any) {
      setError(e.message || "تعذر إعادة إرسال الكود.");
    } finally {
      setResending(false);
    }
  }

  async function onConfirm(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      await confirm({ data: { phone: pendingPhone, code } });
      await router.invalidate();
      navigate({ to: "/student" });
    } catch (e: any) {
      setError(e.message || "حصل خطأ");
      try {
        const s = await checkPending({ data: { phone: pendingPhone } });
        setPendingStatus(s.status);
        setPendingMessage(s.message);
        setExpiresAt("expires_at" in s ? (s.expires_at ?? null) : null);
        if ("resends_remaining" in s && typeof s.resends_remaining === "number") {
          setResendsRemaining(s.resends_remaining);
        }
      } catch {}
    } finally {
      setLoading(false);
    }
  }

  if (step === "code") {
    const link = botLink || (botUsername ? `https://t.me/${botUsername}` : "");
    return (
      <form onSubmit={onConfirm} className="space-y-4">
        <div className="rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border-2 border-primary/30 p-5 text-center space-y-3">
          <div className="text-3xl">📲</div>
          <p className="text-sm font-semibold text-foreground">
            اضغط الزر ده لفتح البوت — البوت هيبعتلك كود من 6 أرقام فورًا.
          </p>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-full rounded-xl bg-primary text-primary-foreground px-4 py-3 text-base font-bold shadow-lg shadow-primary/30 hover:shadow-xl hover:scale-[1.02] transition"
            >
              فتح البوت في تيليجرام ←
            </a>
          )}
          <p className="text-[11px] text-muted-foreground">
            لو الكود ما وصلش، ارجع للبوت وابعت <code className="font-mono bg-background px-1 rounded">/start</code> مرة تانية.
          </p>
        </div>

        <PendingStatusBox
          status={pendingStatus}
          message={pendingMessage}
          expiresInMs={expiresInMs}
        />

        <Field label="كود التحقق (6 أرقام)">
          <input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="input text-center text-xl tracking-[0.5em] font-mono"
            placeholder="------"
          />
        </Field>

        {error && <ErrorBox>{error}</ErrorBox>}
        {info && (
          <div className="text-sm text-success bg-success/10 rounded-md px-3 py-2" role="status">
            {info}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || code.length !== 6 || pendingStatus === "expired" || pendingStatus === "not_found"}
          className="btn-primary w-full"
        >
          {loading ? "..." : "تأكيد ودخول"}
        </button>

        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={onResend}
            disabled={!canResend}
            className="text-primary font-semibold disabled:text-muted-foreground disabled:cursor-not-allowed hover:underline"
          >
            {resending
              ? "جاري الإرسال..."
              : cooldownMs > 0
              ? `إعادة الإرسال خلال ${Math.ceil(cooldownMs / 1000)} ث`
              : resendsRemaining === 0
              ? "تم استنفاد محاولات الإعادة"
              : "إعادة إرسال الكود"}
          </button>
          {resendsRemaining !== null && resendsRemaining > 0 && cooldownMs === 0 && (
            <span className="text-muted-foreground">
              متبقي {resendsRemaining} إعادة إرسال
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setStep("form");
            setCode("");
            setError(null);
            setInfo(null);
            setPendingStatus("idle");
            setPendingMessage("");
            setExpiresAt(null);
            setResendsRemaining(null);
            setCooldownUntil(0);
          }}
          className="w-full text-xs text-muted-foreground hover:text-foreground"
        >
          ← تعديل البيانات
        </button>
      </form>
    );
  }


  return (
    <form onSubmit={onStart} className="space-y-4">
      <Field label="الاسم رباعي">
        <input
          required
          dir="rtl"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="input"
          aria-invalid={Boolean(nameError)}
          placeholder="مثال: محمد أحمد علي حسن"
        />
        {nameError && <span className="text-[11px] text-destructive">{nameError}</span>}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="الصف">
          <select
            value={grade}
            onChange={(e) => setGrade(e.target.value as any)}
            className="input"
          >
            <option value="g1">الأول الثانوي</option>
            <option value="g2">الثاني الثانوي</option>
            <option value="g3">الثالث الثانوي</option>
          </select>
        </Field>
        <Field label="النظام">
          <div className="flex gap-2 pt-1">
            {(["general", "azhar"] as const).map((t) => (
              <label
                key={t}
                className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center text-sm transition ${
                  track === t
                    ? "border-primary bg-primary/10 text-primary font-semibold"
                    : "border-border text-muted-foreground hover:bg-secondary/40"
                }`}
              >
                <input
                  type="radio"
                  name="track"
                  value={t}
                  checked={track === t}
                  onChange={() => setTrack(t)}
                  className="sr-only"
                />
                {t === "general" ? "عام" : "أزهر"}
              </label>
            ))}
          </div>
        </Field>
      </div>

      <Field label="رقم الطالب">
        <input
          required
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={studentPhone}
          onChange={(e) => setStudentPhone(e.target.value)}
          className="input"
          placeholder="01xxxxxxxxx"
        />
      </Field>

      <Field label="رقم ولي الأمر">
        <input
          required
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={parentPhone}
          onChange={(e) => setParentPhone(e.target.value)}
          className="input"
          placeholder="01xxxxxxxxx"
        />
      </Field>

      <Field label="كلمة المرور">
        <input
          required
          type="password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          placeholder="6 أحرف على الأقل"
          autoComplete="new-password"
        />
      </Field>

      <Field label="تأكيد كلمة المرور">
        <input
          required
          type="password"
          minLength={6}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="input"
          placeholder="اكتبها مرة أخرى"
          autoComplete="new-password"
        />
      </Field>

      {error && <ErrorBox>{error}</ErrorBox>}

      <button type="submit" disabled={loading || Boolean(nameError)} className="btn-primary w-full">
        {loading ? "..." : "متابعة"}
      </button>

      <p className="text-[11px] text-muted-foreground text-center">
        رقم الطالب لازم يكون نفس الرقم المرتبط بحساب تيليجرام بتاعه.
      </p>
    </form>
  );
}

// ============================================================
// Returning student: name + password (no Telegram round-trip)
// ============================================================
function ExistingStudentForm() {
  const navigate = useNavigate();
  const router = useRouter();
  const login = useServerFn(studentPasswordLogin);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "reset">("login");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login({ data: { full_name: fullName, password } });
      await router.invalidate();
      navigate({ to: "/student" });
    } catch (e: any) {
      setError(e.message || "تعذر تسجيل الدخول.");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "reset") {
    return <PasswordResetForm onBack={() => setMode("login")} />;
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="الاسم الرباعي">
        <input
          required
          dir="rtl"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className="input"
          placeholder="نفس الاسم اللي سجّلت بيه"
          autoComplete="username"
        />
      </Field>

      <Field label="كلمة المرور">
        <input
          required
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          autoComplete="current-password"
        />
      </Field>

      {error && <ErrorBox>{error}</ErrorBox>}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "..." : "دخول"}
      </button>

      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={() => {
            setMode("reset");
            setError(null);
          }}
          className="text-primary font-semibold hover:underline"
        >
          نسيت كلمة المرور؟
        </button>
        <span className="text-muted-foreground">لسه ما عندكش حساب؟ افتح تبويب «إنشاء حساب».</span>
      </div>
    </form>
  );
}

// ============================================================
// Forgot password: phone + new password → bot OTP → confirm
// ============================================================
function PasswordResetForm({ onBack }: { onBack: () => void }) {
  const navigate = useNavigate();
  const router = useRouter();
  const start = useServerFn(studentStartPasswordReset);
  const confirm = useServerFn(studentConfirmCode);
  const checkPending = useServerFn(studentPendingStatus);
  const resend = useServerFn(studentResendCode);

  const [step, setStep] = useState<"form" | "code">("form");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  const [pendingPhone, setPendingPhone] = useState("");
  const [botLink, setBotLink] = useState("");
  const [delivered, setDelivered] = useState(false);
  const [code, setCode] = useState("");

  const [pendingStatus, setPendingStatus] = useState<PendingUiStatus>("idle");
  const [pendingMessage, setPendingMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (step !== "code") return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [step]);

  useEffect(() => {
    if (step !== "code" || !pendingPhone) return;
    let cancelled = false;
    async function refresh() {
      try {
        const r = await checkPending({ data: { phone: pendingPhone } });
        if (cancelled) return;
        setPendingStatus(r.status);
        setPendingMessage(r.message);
        setExpiresAt("expires_at" in r ? (r.expires_at ?? null) : null);
      } catch {}
    }
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [step, pendingPhone, checkPending]);

  const expiresInMs = expiresAt ? Math.max(0, new Date(expiresAt).getTime() - now) : 0;

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      setError("كلمة المرور لازم تكون 6 أحرف على الأقل.");
      return;
    }
    if (password !== confirmPwd) {
      setError("كلمة المرور وتأكيدها غير متطابقتين.");
      return;
    }
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const r = await start({ data: { student_phone: phone, password } });
      setPendingPhone(r.phone);
      setBotLink(r.bot_link || "");
      setDelivered(r.delivered);
      setCode("");
      setStep("code");
    } catch (e: any) {
      setError(e.message || "حصل خطأ");
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setResending(true);
    setError(null);
    try {
      await resend({ data: { phone: pendingPhone } });
      setInfo("تم إرسال كود جديد إلى تيليجرام.");
      setCode("");
    } catch (e: any) {
      setError(e.message || "تعذر إعادة إرسال الكود.");
    } finally {
      setResending(false);
    }
  }

  async function onConfirm(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await confirm({ data: { phone: pendingPhone, code } });
      await router.invalidate();
      navigate({ to: "/student" });
    } catch (e: any) {
      setError(e.message || "حصل خطأ");
    } finally {
      setLoading(false);
    }
  }

  if (step === "code") {
    return (
      <form onSubmit={onConfirm} className="space-y-4">
        <div className="rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border-2 border-primary/30 p-5 text-center space-y-3">
          <div className="text-3xl">🔁</div>
          <p className="text-sm font-semibold text-foreground">
            {delivered
              ? "بعتنا كود تحقق على تيليجرام بتاعك. اكتبه تحت لتأكيد كلمة المرور الجديدة."
              : "افتح البوت من الزر تحت، البوت هيبعتلك الكود فورًا."}
          </p>
          {!delivered && botLink && (
            <a
              href={botLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center w-full rounded-xl bg-primary text-primary-foreground px-4 py-3 text-base font-bold shadow-lg shadow-primary/30 hover:shadow-xl hover:scale-[1.02] transition"
            >
              فتح البوت في تيليجرام ←
            </a>
          )}
        </div>

        <PendingStatusBox status={pendingStatus} message={pendingMessage} expiresInMs={expiresInMs} />

        <Field label="كود التحقق (6 أرقام)">
          <input
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="input text-center text-xl tracking-[0.5em] font-mono"
            placeholder="------"
          />
        </Field>

        {error && <ErrorBox>{error}</ErrorBox>}
        {info && (
          <div className="text-sm text-success bg-success/10 rounded-md px-3 py-2" role="status">
            {info}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || code.length !== 6 || pendingStatus === "expired"}
          className="btn-primary w-full"
        >
          {loading ? "..." : "تأكيد وتغيير كلمة المرور"}
        </button>

        <div className="flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={onResend}
            disabled={resending}
            className="text-primary font-semibold hover:underline disabled:text-muted-foreground"
          >
            {resending ? "جاري الإرسال..." : "إعادة إرسال الكود"}
          </button>
          <button
            type="button"
            onClick={() => setStep("form")}
            className="text-muted-foreground hover:text-foreground"
          >
            ← تعديل البيانات
          </button>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="w-full text-xs text-muted-foreground hover:text-foreground"
        >
          إلغاء والرجوع لتسجيل الدخول
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onStart} className="space-y-4">
      <div className="rounded-lg bg-secondary/40 border border-border px-4 py-3 text-xs text-muted-foreground">
        هنبعتلك كود تحقق على تيليجرام للتأكد إنك صاحب الحساب، وبعدها هنغيّر كلمة المرور للجديدة.
      </div>

      <Field label="رقم الطالب">
        <input
          required
          type="tel"
          inputMode="tel"
          dir="ltr"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="input"
          placeholder="01xxxxxxxxx"
        />
      </Field>

      <Field label="كلمة المرور الجديدة">
        <input
          required
          type="password"
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
          placeholder="6 أحرف على الأقل"
          autoComplete="new-password"
        />
      </Field>

      <Field label="تأكيد كلمة المرور الجديدة">
        <input
          required
          type="password"
          minLength={6}
          value={confirmPwd}
          onChange={(e) => setConfirmPwd(e.target.value)}
          className="input"
          autoComplete="new-password"
        />
      </Field>

      {error && <ErrorBox>{error}</ErrorBox>}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "..." : "إرسال كود التحقق"}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="w-full text-xs text-muted-foreground hover:text-foreground"
      >
        ← الرجوع لتسجيل الدخول
      </button>
    </form>
  );
}

function PendingStatusBox({
  status,
  message,
  expiresInMs,
}: {
  status: PendingUiStatus;
  message: string;
  expiresInMs: number;
}) {
  if (status === "idle" && !message) return null;
  const label =
    status === "verified"
      ? "تم التحقق من الرقم"
      : status === "expired"
      ? "انتهت صلاحية الطلب"
      : status === "not_found"
      ? "لا يوجد طلب نشط"
      : "بانتظار الكود";
  const tone =
    status === "verified"
      ? "border-success/40 bg-success/10 text-success"
      : status === "expired" || status === "not_found"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-warning/40 bg-warning/10 text-warning";
  const mins = Math.floor(expiresInMs / 60000);
  const secs = Math.floor((expiresInMs % 60000) / 1000);
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm space-y-1 ${tone}`} role="status" aria-live="polite">
      <div className="font-semibold">{label}</div>
      <div className="text-foreground/80">{message || "تابع الخطوة الحالية."}</div>
      {expiresInMs > 0 && status !== "expired" && (
        <div className="text-xs text-muted-foreground font-mono">
          الكود صالح لمدة {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
        </div>
      )}
    </div>
  );
}

// ---------- tiny styled helpers ----------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
      {children}
    </div>
  );
}
