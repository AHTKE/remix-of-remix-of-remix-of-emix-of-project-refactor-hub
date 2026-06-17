import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { listCourses, listStudentsAdmin, updateStudentAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/students")({ component: StudentsPage });

function StudentsPage() {
  const qc = useQueryClient();
  const students = useQuery({ queryKey: ["students"], queryFn: useServerFn(listStudentsAdmin) });
  const courses = useQuery({ queryKey: ["courses"], queryFn: useServerFn(listCourses) });
  const updateStudent = useServerFn(updateStudentAdmin);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const rows = useMemo(() => (students.data ?? []).filter((s) => `${s.id} ${s.student_code} ${s.first_name || ""} ${s.username || ""}`.toLowerCase().includes(query.toLowerCase())), [students.data, query]);
  const selected = rows.find((s) => s.id === selectedId) || rows[0];

  async function action(student_id: number, action: "ban" | "unban" | "reset_device" | "extend") {
    await updateStudent({ data: { student_id, action, days: 30 } });
    await qc.invalidateQueries({ queryKey: ["students"] });
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">Student CRM</h1><p className="text-sm text-muted-foreground mt-1">بحث، سجل أكاديمي، أكواد مفعّلة، درجات، وتحكم سريع.</p></div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث بالاسم أو ID أو كود الطالب" className="input-dark max-w-xl" />
      <div className="grid lg:grid-cols-[360px_1fr] gap-5">
        <section className="surface-card overflow-hidden">
          {(rows.length ? rows : []).map((s) => (
            <button key={s.id} onClick={() => setSelectedId(s.id)} className={`w-full text-right p-4 border-b border-border hover:bg-secondary/50 ${selected?.id === s.id ? "bg-secondary/60" : ""}`}>
              <div className="font-semibold">{s.first_name || "طالب"} <span className="text-xs text-muted-foreground">@{s.username || s.id}</span></div>
              <div className="mt-1 text-xs text-muted-foreground">{s.student_code} · {s.subscriptions.length} اشتراك · {s.attempts.length} امتحان</div>
            </button>
          ))}
          {!rows.length && <div className="p-6 text-center text-muted-foreground">لا يوجد طلاب.</div>}
        </section>
        {selected && (
          <section className="surface-card p-5 space-y-5">
            <div className="flex justify-between gap-3 flex-wrap">
              <div><h2 className="text-xl font-bold">{selected.first_name || "طالب"}</h2><p className="text-sm text-muted-foreground font-mono">{selected.student_code} · {selected.id}</p></div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => action(selected.id, selected.banned ? "unban" : "ban")} className="rounded-lg bg-destructive/15 text-destructive px-3 py-1.5 text-sm">{selected.banned ? "فك الحظر" : "حظر"}</button>
                <button onClick={() => action(selected.id, "extend")} className="rounded-lg bg-primary/15 text-primary px-3 py-1.5 text-sm">تمديد 30 يوم</button>
                <button onClick={() => action(selected.id, "reset_device")} className="rounded-lg bg-secondary px-3 py-1.5 text-sm">Reset Device</button>
              </div>
            </div>
            <div className="grid md:grid-cols-3 gap-3"><Info label="تاريخ الانضمام" value={new Date(selected.joined_at).toLocaleDateString("ar-EG")} /><Info label="آخر نشاط" value={selected.last_active ? new Date(selected.last_active).toLocaleString("ar-EG") : "—"} /><Info label="الحالة" value={selected.banned ? "محظور" : selected.locked ? "مقفل" : "نشط"} /></div>
            <Block title="الاشتراكات">{selected.subscriptions.map((sub) => <div key={sub.voucher_code} className="text-sm py-2 border-b border-border last:border-0">{courses.data?.find((c) => c.id === sub.course_id)?.title || sub.course_id} · ينتهي {new Date(sub.expires_at).toLocaleDateString("ar-EG")}</div>) || "—"}</Block>
            <Block title="الأكواد المستخدمة">{selected.vouchers.map((v) => <div key={v.code} className="font-mono text-xs py-1">{v.code} · {v.used_at ? new Date(v.used_at).toLocaleString("ar-EG") : "—"}</div>)}</Block>
            <Block title="نتائج الامتحانات">{selected.attempts.map((a) => <div key={a.id} className="text-sm py-1">{a.quiz_id}: {a.score ?? "—"}/{a.total ?? "—"}</div>)}</Block>
            <Block title="الأجهزة"><pre className="text-xs whitespace-pre-wrap text-muted-foreground">{JSON.stringify(selected.device || {}, null, 2)}</pre></Block>
          </section>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-secondary/40 p-3"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 font-semibold">{value}</div></div>; }
function Block({ title, children }: { title: string; children: React.ReactNode }) { return <div><h3 className="font-semibold mb-2">{title}</h3><div className="rounded-xl border border-border bg-background/40 p-3">{children}</div></div>; }