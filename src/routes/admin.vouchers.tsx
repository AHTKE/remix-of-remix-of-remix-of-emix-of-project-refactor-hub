import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  generateVoucherBatch,
  listCourses,
  listVoucherBatches,
  listVouchersByBatch,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/vouchers")({
  component: VouchersPage,
});

function VouchersPage() {
  const gen = useServerFn(generateVoucherBatch);
  const listBatches = useServerFn(listVoucherBatches);
  const listCoursesFn = useServerFn(listCourses);
  const listCodes = useServerFn(listVouchersByBatch);
  const qc = useQueryClient();

  const batches = useQuery({ queryKey: ["vbatches"], queryFn: listBatches });
  const courses = useQuery({ queryKey: ["courses"], queryFn: listCoursesFn });

  const [prefix, setPrefix] = useState("AMW");
  const [courseId, setCourseId] = useState("");
  const [days, setDays] = useState(30);
  const [count, setCount] = useState(50);
  const [busy, setBusy] = useState(false);
  const [showCodes, setShowCodes] = useState<string | null>(null);
  const codes = useQuery({
    queryKey: ["vcodes", showCodes],
    queryFn: () => listCodes({ data: { batch_id: showCodes! } }),
    enabled: !!showCodes,
  });

  async function create() {
    if (!courseId) return alert("اختر كورس");
    setBusy(true);
    try {
      const res = await gen({ data: { prefix, course_id: courseId, duration_days: days, count } });
      qc.invalidateQueries({ queryKey: ["vbatches"] });
      alert(`تم توليد ${res.codes.length} كود.`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">الأكواد (Vouchers)</h1>

      <div className="surface-card p-5 space-y-4">
        <h2 className="font-semibold">توليد دفعة جديدة</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">البادئة</div>
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase().slice(0, 6))}
              className="w-full rounded-lg bg-input border border-border px-3 py-2"
            />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">الكورس</div>
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="w-full rounded-lg bg-input border border-border px-3 py-2"
            >
              <option value="">— اختر كورس —</option>
              {(courses.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">المدة (يوم)</div>
            <input
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full rounded-lg bg-input border border-border px-3 py-2"
            />
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">العدد</div>
            <input
              type="number"
              min={1}
              max={5000}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full rounded-lg bg-input border border-border px-3 py-2"
            />
          </div>
        </div>
        <button
          onClick={create}
          disabled={busy}
          className="rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold glow-ring disabled:opacity-50"
        >
          {busy ? "...جاري التوليد" : "🎫 توليد"}
        </button>
      </div>

      <div className="surface-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border font-semibold">الدفعات</div>
        {batches.isLoading ? (
          <div className="p-5 text-muted-foreground">جاري التحميل...</div>
        ) : (batches.data?.length ?? 0) === 0 ? (
          <div className="p-8 text-center text-muted-foreground">لا توجد دفعات بعد.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-secondary/40">
              <tr>
                <th className="text-right p-3">البادئة</th>
                <th className="text-right p-3">الكورس</th>
                <th className="text-right p-3">المدة</th>
                <th className="text-right p-3">مستخدم/إجمالي</th>
                <th className="text-right p-3">التاريخ</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {batches.data!.map((b) => {
                const course = courses.data?.find((c) => c.id === b.course_id);
                return (
                  <tr key={b.id} className="border-t border-border">
                    <td className="p-3 font-mono">{b.prefix}</td>
                    <td className="p-3">{course?.title || b.course_id}</td>
                    <td className="p-3">{b.duration_days} يوم</td>
                    <td className="p-3 tabular-nums">
                      {b.used}/{b.total}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {new Date(b.created_at).toLocaleDateString("ar-EG")}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => setShowCodes(b.id)}
                        className="text-primary text-xs hover:underline"
                      >
                        عرض الأكواد
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCodes && (
        <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur flex items-center justify-center p-4">
          <div className="surface-card w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <div className="px-5 py-3 border-b border-border flex justify-between">
              <span className="font-semibold">أكواد الدفعة</span>
              <button onClick={() => setShowCodes(null)} className="text-muted-foreground">
                ✕
              </button>
            </div>
            <div className="p-4 overflow-auto">
              {codes.isLoading ? (
                <div className="text-muted-foreground">تحميل...</div>
              ) : (
                <pre className="font-mono text-xs whitespace-pre-wrap break-all">
                  {(codes.data ?? [])
                    .map((v) => `${v.code}${v.used_by ? "  [مستخدم]" : ""}`)
                    .join("\n")}
                </pre>
              )}
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    (codes.data ?? []).map((v) => v.code).join("\n")
                  );
                }}
                className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm"
              >
                نسخ الكل
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
