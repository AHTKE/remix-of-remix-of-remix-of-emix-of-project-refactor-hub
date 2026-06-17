import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getMyWallet, redeemVoucher, requestTopup } from "@/lib/student.functions";

export const Route = createFileRoute("/student/wallet")({
  component: WalletPage,
});

function WalletPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["wallet"], queryFn: () => getMyWallet() });
  const redeem = useServerFn(redeemVoucher);
  const topup = useServerFn(requestTopup);

  const [code, setCode] = useState("");
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [topupMsg, setTopupMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const redeemMut = useMutation({
    mutationFn: async () => redeem({ data: { code } }),
    onSuccess: (r) => {
      setRedeemMsg({ ok: true, text: `✅ تم تفعيل: ${r.course_title} (حتى ${new Date(r.expires_at).toLocaleDateString("ar-EG")})` });
      setCode("");
      qc.invalidateQueries({ queryKey: ["wallet"] });
      qc.invalidateQueries({ queryKey: ["my-courses"] });
      qc.invalidateQueries({ queryKey: ["student-dashboard"] });
    },
    onError: (e: any) => setRedeemMsg({ ok: false, text: e.message || "خطأ" }),
  });

  const topupMut = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set("amount", amount);
      if (note) fd.set("note", note);
      if (receipt) fd.set("receipt", receipt);
      return topup({ data: fd });
    },
    onSuccess: () => {
      setTopupMsg({ ok: true, text: "✅ تم إرسال طلب الشحن. سيتم مراجعته." });
      setAmount(""); setNote(""); setReceipt(null);
      qc.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (e: any) => setTopupMsg({ ok: false, text: e.message || "خطأ" }),
  });

  return (
    <div className="max-w-4xl mx-auto px-5 md:px-8 py-6 md:py-10 space-y-6">
      <header className="surface-card p-6 brand-gradient text-primary-foreground">
        <div className="text-sm opacity-90">💰 رصيدك الحالي</div>
        <div className="text-4xl font-extrabold mt-1">{q.data?.balance ?? 0} ج</div>
      </header>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Redeem */}
        <section className="surface-card p-5">
          <h2 className="font-bold text-lg mb-3">🎟️ تفعيل كود كورس</h2>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="AMW-XXXX-XXXX"
            className="w-full rounded-lg bg-input border border-border px-3 py-2.5 font-mono uppercase tracking-wider focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={() => redeemMut.mutate()}
            disabled={redeemMut.isPending || !code.trim()}
            className="w-full mt-3 rounded-xl brand-gradient text-primary-foreground py-2.5 font-semibold disabled:opacity-50"
          >
            {redeemMut.isPending ? "..." : "فعّل الكود"}
          </button>
          {redeemMsg && (
            <div className={`mt-3 text-sm rounded-md px-3 py-2 ${redeemMsg.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
              {redeemMsg.text}
            </div>
          )}
        </section>

        {/* Topup */}
        <section className="surface-card p-5">
          <h2 className="font-bold text-lg mb-3">💳 شحن المحفظة</h2>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="المبلغ بالجنيه"
            inputMode="numeric"
            className="w-full rounded-lg bg-input border border-border px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ملاحظة (اختياري)"
            className="w-full mt-2 rounded-lg bg-input border border-border px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <label className="mt-2 block rounded-lg border border-dashed border-border bg-secondary/40 p-3 text-sm cursor-pointer hover:bg-secondary/60">
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setReceipt(e.target.files?.[0] || null)}
              className="hidden"
            />
            📎 {receipt ? receipt.name : "ارفع صورة الإيصال"}
          </label>
          <button
            onClick={() => topupMut.mutate()}
            disabled={topupMut.isPending || !amount || !receipt}
            className="w-full mt-3 rounded-xl border border-primary/40 bg-primary/10 text-primary py-2.5 font-semibold disabled:opacity-50"
          >
            {topupMut.isPending ? "..." : "إرسال الطلب"}
          </button>
          {topupMsg && (
            <div className={`mt-3 text-sm rounded-md px-3 py-2 ${topupMsg.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
              {topupMsg.text}
            </div>
          )}
        </section>
      </div>

      {/* Topup history */}
      {q.data?.topups.length ? (
        <section className="surface-card p-5">
          <h2 className="font-bold text-lg mb-3">📋 طلبات الشحن</h2>
          <div className="space-y-2">
            {q.data.topups.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm border-b border-border last:border-0 py-2">
                <span>{t.amount} ج — {new Date(t.created_at).toLocaleDateString("ar-EG")}</span>
                <span className={
                  t.status === "approved" ? "text-primary" :
                  t.status === "rejected" ? "text-destructive" : "text-muted-foreground"
                }>
                  {t.status === "approved" ? "✅ مقبول" : t.status === "rejected" ? "❌ مرفوض" : "⏳ قيد المراجعة"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Transactions */}
      <section className="surface-card p-5">
        <h2 className="font-bold text-lg mb-3">📜 آخر المعاملات</h2>
        {!q.data?.transactions.length ? (
          <div className="text-sm text-muted-foreground text-center py-6">لا توجد معاملات.</div>
        ) : (
          <div className="space-y-2">
            {q.data.transactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm border-b border-border last:border-0 py-2">
                <div>
                  <div className="font-medium">{t.reason}</div>
                  <div className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString("ar-EG")}</div>
                </div>
                <div className="text-left">
                  <div className={t.amount >= 0 ? "text-primary font-bold" : "text-destructive font-bold"}>
                    {t.amount >= 0 ? "+" : ""}{t.amount} ج
                  </div>
                  <div className="text-xs text-muted-foreground">رصيد: {t.balance_after}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
