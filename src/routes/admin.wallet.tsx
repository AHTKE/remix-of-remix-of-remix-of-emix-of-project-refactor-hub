import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { adjustWalletAdmin, listStudentsAdmin, listTopupsAdmin, reviewTopupAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/wallet")({ component: WalletPage });

function WalletPage() {
  const qc = useQueryClient();
  const topups = useQuery({ queryKey: ["topups"], queryFn: useServerFn(listTopupsAdmin) });
  const students = useQuery({ queryKey: ["students"], queryFn: useServerFn(listStudentsAdmin) });
  const review = useServerFn(reviewTopupAdmin);
  const adjust = useServerFn(adjustWalletAdmin);

  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState("");

  async function decide(id: string, decision: "approve" | "reject") {
    const n = decision === "reject" ? prompt("سبب الرفض (اختياري)") || "" : "";
    await review({ data: { id, decision, note: n } });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["topups"] }),
      qc.invalidateQueries({ queryKey: ["students"] }),
    ]);
  }

  async function manualAdjust() {
    if (!studentId || !amount) return alert("اختر طالبًا وأدخل مبلغًا");
    await adjust({ data: { student_id: Number(studentId), amount, note: note.trim() } });
    setAmount(0); setNote("");
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["topups"] }),
      qc.invalidateQueries({ queryKey: ["students"] }),
    ]);
    alert("تم تعديل الرصيد");
  }

  const pending = (topups.data ?? []).filter((t) => t.status === "pending");
  const history = (topups.data ?? []).filter((t) => t.status !== "pending");

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">المحفظة والشحن</h1><p className="text-sm text-muted-foreground mt-1">راجع طلبات الشحن واعتمدها، أو عدّل أرصدة الطلاب يدويًا.</p></div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">طلبات بانتظار المراجعة <span className="text-sm text-muted-foreground">({pending.length})</span></h2>
        {pending.length === 0 && <div className="surface-card p-5 text-sm text-muted-foreground">لا توجد طلبات معلّقة.</div>}
        <div className="grid md:grid-cols-2 gap-4">
          {pending.map((t) => (
            <div key={t.id} className="surface-card p-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold">{t.student_name}</span>
                <span className="text-lg font-bold text-gradient">{t.amount} ج.م</span>
              </div>
              <div className="text-xs text-muted-foreground">طريقة: {t.method} · {new Date(t.created_at).toLocaleString("ar-EG")}</div>
              {t.note && <div className="text-xs text-muted-foreground">ملاحظة الطالب: {t.note}</div>}
              {t.receipt_file_id && <a href={`/api/public/media/${t.receipt_file_id}`} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs">🧾 عرض الإيصال</a>}
              <div className="flex gap-2 pt-1">
                <button onClick={() => decide(t.id, "approve")} className="rounded-lg bg-green-600 text-white px-4 py-1.5 text-sm font-medium">اعتماد</button>
                <button onClick={() => decide(t.id, "reject")} className="rounded-lg bg-destructive text-destructive-foreground px-4 py-1.5 text-sm font-medium">رفض</button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-card p-5 space-y-3">
        <h2 className="text-lg font-semibold">تعديل رصيد يدوي</h2>
        <div className="grid md:grid-cols-[1fr_140px_1fr_auto] gap-2 items-end">
          <label className="block"><span className="text-xs text-muted-foreground mb-1 block">الطالب</span>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className="input-dark"><option value="">اختر</option>{(students.data ?? []).map((s) => <option key={s.id} value={s.id}>{(s.first_name || "") + " " + (s.last_name || "")} ({s.student_code}) — {s.wallet_balance || 0} ج.م</option>)}</select>
          </label>
          <label className="block"><span className="text-xs text-muted-foreground mb-1 block">المبلغ (± )</span><input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="input-dark" /></label>
          <label className="block"><span className="text-xs text-muted-foreground mb-1 block">ملاحظة</span><input value={note} onChange={(e) => setNote(e.target.value)} className="input-dark" /></label>
          <button onClick={manualAdjust} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium">تطبيق</button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">سجل الطلبات</h2>
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-muted-foreground text-xs border-b border-border"><th className="text-right p-3">الطالب</th><th className="text-right p-3">المبلغ</th><th className="text-right p-3">الحالة</th><th className="text-right p-3">التاريخ</th></tr></thead>
            <tbody>
              {history.map((t) => (
                <tr key={t.id} className="border-b border-border/50">
                  <td className="p-3">{t.student_name}</td>
                  <td className="p-3">{t.amount} ج.م</td>
                  <td className="p-3">{t.status === "approved" ? <span className="text-green-500">معتمد</span> : <span className="text-destructive">مرفوض</span>}</td>
                  <td className="p-3 text-xs text-muted-foreground">{new Date(t.reviewed_at || t.created_at).toLocaleDateString("ar-EG")}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted-foreground text-sm">لا يوجد سجل بعد.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
