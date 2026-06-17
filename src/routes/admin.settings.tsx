import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  getData,
  saveSettings,
  setupWebhook,
  getDiagnostics,
  testDataChannel,
  getRuntimeSettingsAdmin,
  saveRuntimeSettingsAdmin,
  testMediaChannel,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/settings")({
  component: Settings,
});

function getStableWebhookUrl() {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  const idPreviewMatch = host.match(/^id-preview--([a-f0-9-]{36})\.(.+)$/);
  if (idPreviewMatch) {
    return `https://project--${idPreviewMatch[1]}-dev.${idPreviewMatch[2]}/api/public/telegram/webhook`;
  }

  const lovableProjectMatch = host.match(/^([a-f0-9-]{36})\.lovableproject\.com$/);
  if (lovableProjectMatch) {
    return `https://project--${lovableProjectMatch[1]}-dev.lovable.app/api/public/telegram/webhook`;
  }

  const current = new URL(window.location.href);
  const previewToken = current.searchParams.get("__lovable_token");
  if (previewToken) {
    try {
      const payloadBase64 = previewToken.split(".")[1];
      const normalized = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
      const payload = JSON.parse(atob(padded));
      const projectId = payload?.project_id;
      if (projectId) {
        return `https://project--${projectId}-dev.lovable.app/api/public/telegram/webhook`;
      }
    } catch {
      // fall back below
    }
  }

  const url = new URL(window.location.origin);
  url.pathname = "/api/public/telegram/webhook";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function Settings() {
  const fetchData = useServerFn(getData);
  const saveFn = useServerFn(saveSettings);
  const setupFn = useServerFn(setupWebhook);
  const diagFn = useServerFn(getDiagnostics);
  const testChannelFn = useServerFn(testDataChannel);
  const testMediaFn = useServerFn(testMediaChannel);
  const getSecrets = useServerFn(getRuntimeSettingsAdmin);
  const saveSecrets = useServerFn(saveRuntimeSettingsAdmin);

  const { data, refetch } = useQuery({ queryKey: ["bot-data"], queryFn: () => fetchData() });
  const { data: diag, refetch: refetchDiag } = useQuery({
    queryKey: ["diag"],
    queryFn: () => diagFn(),
  });
  const { data: secrets, refetch: refetchSecrets } = useQuery({
    queryKey: ["secrets"],
    queryFn: () => getSecrets(),
  });

  const [welcome, setWelcome] = useState("");
  const [inquiry, setInquiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [whBusy, setWhBusy] = useState(false);
  const [whMsg, setWhMsg] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [secretBusy, setSecretBusy] = useState(false);
  const [secretMsg, setSecretMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setWelcome(data.welcome_text);
      setInquiry(data.inquiry_text);
    }
  }, [data]);

  async function saveSecretsAll() {
    setSecretBusy(true);
    setSecretMsg(null);
    try {
      const patch: Record<string, string> = {};
      for (const [k, v] of Object.entries(secretInputs)) {
        if (v && v.trim()) patch[k] = v.trim();
      }
      if (!Object.keys(patch).length) {
        setSecretMsg("لا توجد تغييرات.");
        return;
      }
      await saveSecrets({ data: { patch } });
      setSecretInputs({});
      await refetchSecrets();
      await refetchDiag();
      setSecretMsg("✅ تم الحفظ والتطبيق فورًا — لا حاجة لإعادة النشر.");
    } catch (e: any) {
      setSecretMsg("❌ " + e.message);
    } finally {
      setSecretBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await saveFn({ data: { welcome_text: welcome, inquiry_text: inquiry } });
      await refetch();
      setMsg("✅ تم الحفظ");
    } catch (e: any) {
      setMsg("❌ " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function registerWebhook() {
    setWhBusy(true);
    setWhMsg(null);
    try {
      const res = await setupFn({ data: { webhook_url: getStableWebhookUrl() } });
      setWhMsg("✅ تم التسجيل: " + res.webhook_url);
      await refetchDiag();
    } catch (e: any) {
      setWhMsg("❌ " + e.message);
    } finally {
      setWhBusy(false);
    }
  }

  async function sendChannelTest() {
    setTestBusy(true);
    setTestMsg(null);
    try {
      const res = await testChannelFn();
      setTestMsg(`✅ تم إرسال الاختبار للقناة (${res.chat_id}) — رسالة رقم ${res.message_id} — البوت @${res.bot?.username || "—"}`);
    } catch (e: any) {
      setTestMsg("❌ " + e.message);
    } finally {
      setTestBusy(false);
    }
  }

  const configuredChannelId = diag?.chat?.forced_id || diag?.chat?.id || "غير محدد";
  const botStatus = diag?.chat?.bot_member?.status || "غير معروف";
  const mediaBotStatus = diag?.mediaChat?.bot_member?.status || "غير معروف";
  const botCanPost = botStatus === "administrator" || botStatus === "creator";
  const botCanPostMedia = mediaBotStatus === "administrator" || mediaBotStatus === "creator";
  const webhookReady = Boolean(diag?.webhook?.url);
  const allSecretsReady = diag ? [diag.env.TELEGRAM_BOT_TOKEN, diag.env.TELEGRAM_DATA_CHANNEL_ID, diag.env.TELEGRAM_MEDIA_CHANNEL_ID, diag.env.ADMIN_PASSWORD, diag.env.SESSION_SECRET].every(Boolean) : false;
  const readyChecks = [allSecretsReady, Boolean(diag?.bot?.username), botCanPost, botCanPostMedia, webhookReady];
  const readyCount = readyChecks.filter(Boolean).length;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">الإعدادات</h1>

      <section className="surface-card p-6 max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-semibold text-lg">🔐 المفاتيح السرية (Runtime)</h2>
            <p className="text-xs text-muted-foreground mt-1">
              تُحفظ مشفّرة داخل قناة تيليجرام وتُطبَّق فورًا على كل الاستدعاءات بدون إعادة نشر.
            </p>
          </div>
          <button
            onClick={saveSecretsAll}
            disabled={secretBusy}
            className="rounded-xl brand-gradient text-primary-foreground px-5 py-2 font-semibold glow-ring disabled:opacity-50"
          >
            {secretBusy ? "..." : "حفظ التغييرات"}
          </button>
        </div>
        {secretMsg && <div className="text-sm">{secretMsg}</div>}
        <div className="space-y-3">
          {(secrets?.rows || []).map((row) => (
            <div key={row.key} className="rounded-xl border border-border bg-background/40 p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-mono text-sm font-semibold">{row.key}</div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={
                      "px-2 py-0.5 rounded-full " +
                      (row.source === "runtime"
                        ? "bg-success/15 text-success"
                        : row.source === "env"
                        ? "bg-primary/15 text-primary"
                        : "bg-destructive/15 text-destructive")
                    }
                  >
                    {row.source === "runtime" ? "Runtime override" : row.source === "env" ? "Env" : "غير معرّف"}
                  </span>
                  <span className="text-muted-foreground font-mono">{row.masked || "—"}</span>
                </div>
              </div>
              <input
                type="password"
                placeholder={row.has_override || row.has_env ? "اترك فارغًا للاحتفاظ بالقيمة الحالية" : "أدخل القيمة الجديدة"}
                value={secretInputs[row.key] || ""}
                onChange={(e) => setSecretInputs({ ...secretInputs, [row.key]: e.target.value })}
                className="mt-3 w-full rounded-lg bg-input border border-border px-3 py-2 font-mono text-sm"
                autoComplete="off"
              />
              {row.key === "TELEGRAM_DATA_CHANNEL_ID" && (
                <p className="mt-1 text-[11px] text-warning">
                  ⚠️ ضع المعرف الرقمي للقناة. يقبل النظام 3852788136 أو 1003852788136 ويحوّله تلقائيًا إلى ‎-1003852788136.
                </p>
              )}
              {row.key === "TELEGRAM_MEDIA_CHANNEL_ID" && (
                <p className="mt-1 text-[11px] text-success">
                  قناة منفصلة للملفات الثقيلة: فيديو، PDF، ZIP، صور، صوت. يمكن أن تكون نفس قناة البيانات مؤقتًا.
                </p>
              )}
              {row.key === "ADMIN_TELEGRAM_IDS" && (
                <p className="mt-1 text-[11px] text-primary">
                  🔑 معرّفات أدمن البوت على تيليجرام. ضع رقمك من @userinfobot، وأضف زملاءك بفواصل: 123456789,987654321 — التحديث فوري بدون إعادة نشر.
                </p>
              )}
            </div>
          ))}
          {!secrets && <div className="text-muted-foreground text-sm">جاري التحميل...</div>}
        </div>
      </section>

      <section className="max-w-3xl surface-card p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-success">قناة البيانات الحالية</div>
            <div className="mt-1 font-mono text-xl font-bold tracking-normal">{configuredChannelId}</div>
            <div className="mt-1 text-sm text-muted-foreground">القيم المحفوظة هنا تُطبّق فورًا على البوت والـ Webhook بدون تصفير القيم القديمة.</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 px-4 py-3 text-center">
            <div className="text-2xl font-bold">{readyCount}/5</div>
            <div className="text-xs text-muted-foreground">جاهزية النظام</div>
          </div>
        </div>
      </section>

      <section className="surface-card p-6 space-y-4 max-w-3xl">
        <h2 className="font-semibold">نصوص البوت</h2>
        <div>
          <label className="block text-sm text-muted-foreground mb-1.5">رسالة الترحيب</label>
          <textarea
            value={welcome}
            onChange={(e) => setWelcome(e.target.value)}
            rows={4}
            className="input-dark"
          />
        </div>
        <div>
          <label className="block text-sm text-muted-foreground mb-1.5">نص الاستفسار</label>
          <textarea
            value={inquiry}
            onChange={(e) => setInquiry(e.target.value)}
            rows={3}
            className="input-dark"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-primary text-primary-foreground px-5 py-2 font-medium disabled:opacity-50"
          >
            {busy ? "..." : "حفظ"}
          </button>
          {msg && <span className="text-sm">{msg}</span>}
        </div>
      </section>

      <section className="surface-card p-6 space-y-4 max-w-3xl">
        <h2 className="font-semibold">ربط البوت بالخادم (Webhook)</h2>
        <p className="text-sm text-muted-foreground">
          اضغط الزر بعد رفع الموقع على Vercel / النشر، لربط البوت بالـ Webhook الحالي.
        </p>
        <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground break-all">
          {diag?.expectedWebhookUrl || getStableWebhookUrl() || "—"}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={registerWebhook}
            disabled={whBusy}
            className="rounded-lg bg-primary text-primary-foreground px-5 py-2 font-medium disabled:opacity-50"
          >
            {whBusy ? "..." : "تفعيل الـ Webhook"}
          </button>
          {whMsg && <span className="text-sm">{whMsg}</span>}
        </div>
      </section>

      <section className="surface-card p-6 space-y-3 max-w-3xl">
        <h2 className="font-semibold">تشخيص الإعدادات</h2>
        {diag ? (
          <div className="space-y-2 text-sm">
            <div>
              <strong>متغيرات البيئة:</strong>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(diag.env).map(([k, v]) => (
                  <li key={k} className={v ? "text-success" : "text-destructive"}>
                    {v ? "✓" : "✗"} {k}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <strong>البوت:</strong>{" "}
              {diag.bot?.username ? (
                <span className="text-success">@{diag.bot.username}</span>
              ) : (
                <span className="text-destructive">{diag.bot?.error || "غير متاح"}</span>
              )}
            </div>
            <div>
              <strong>القناة:</strong>{" "}
              {diag.chat?.title ? (
                <span className="text-success">{diag.chat.title}</span>
              ) : (
                <span className="text-destructive">{diag.chat?.error || "غير متاحة"}</span>
              )}
            </div>
            <div>
              <strong>قناة الوسائط:</strong>{" "}
              {diag.mediaChat?.title ? (
                <span className="text-success">{diag.mediaChat.title}</span>
              ) : (
                <span className="text-destructive">{diag.mediaChat?.error || "غير متاحة"}</span>
              )}
            </div>
            <div>
              <strong>Webhook:</strong>{" "}
              <span className={diag.webhook?.url ? "text-success" : "text-muted-foreground"}>
                {diag.webhook?.url || "غير مفعّل"}
              </span>
            </div>
            <div>
              <strong>الرابط المتوقع:</strong>{" "}
              <span className="text-muted-foreground break-all">{diag.expectedWebhookUrl}</span>
            </div>
            {diag.chat?.error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive">
                القناة غير مربوطة فعليًا. المشكلة غالبًا ليست في صلاحيات الصورة؛ إما التوكن لبوت مختلف أو المعرف ليس بالصيغة الرقمية. ضع ID القناة كرقم، والنظام سيحوّله تلقائيًا إلى ‎-100 عند الحاجة.
              </div>
            )}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={sendChannelTest}
                disabled={testBusy}
                className="rounded-lg bg-primary text-primary-foreground px-5 py-2 font-medium hover:bg-primary/90 disabled:opacity-50"
              >
                {testBusy ? "جاري الإرسال..." : "إرسال اختبار للقناة"}
              </button>
              {testMsg && <span className="text-sm">{testMsg}</span>}
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={async () => {
                  setTestBusy(true);
                  setTestMsg(null);
                  try {
                    const res = await testMediaFn();
                    setTestMsg(`✅ تم إرسال اختبار لقناة الوسائط (${res.chat_id}) — رسالة رقم ${res.message_id}`);
                  } catch (e: any) {
                    setTestMsg("❌ " + e.message);
                  } finally {
                    setTestBusy(false);
                  }
                }}
                disabled={testBusy}
                className="rounded-lg bg-secondary text-foreground px-5 py-2 font-medium hover:bg-accent disabled:opacity-50"
              >
                اختبار قناة الوسائط
              </button>
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground">جاري التحميل...</div>
        )}
      </section>

      <section className="surface-card p-5 max-w-3xl text-sm space-y-2 border-warning/30">
        <h3 className="font-semibold text-warning">📌 خطوات الإعداد لأول مرة</h3>
        <ol className="list-decimal mr-5 space-y-1 text-muted-foreground">
          <li>أنشئ بوت في @BotFather واحصل على التوكن.</li>
          <li>أنشئ قناة تيليجرام <strong>خاصة</strong>، وأضف البوت كأدمن (مع صلاحيات Edit Messages و Pin Messages).</li>
          <li>أرسل رسالة في القناة، ثم احصل على معرّفها (يبدأ بـ -100...).</li>
          <li>أدخل القيم هنا داخل اللوحة: <code className="bg-secondary px-1 rounded">TELEGRAM_BOT_TOKEN</code>، <code className="bg-secondary px-1 rounded">TELEGRAM_DATA_CHANNEL_ID</code>، <code className="bg-secondary px-1 rounded">TELEGRAM_MEDIA_CHANNEL_ID</code>، <code className="bg-secondary px-1 rounded">ADMIN_PASSWORD</code>، <code className="bg-secondary px-1 rounded">SESSION_SECRET</code>.</li>
          <li>اضغط "تفعيل الـ Webhook" بالأعلى.</li>
        </ol>
      </section>
    </div>
  );
}
