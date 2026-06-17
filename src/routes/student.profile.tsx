import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getStudentDashboard, studentUpdateProfile } from "@/lib/student.functions";

export const Route = createFileRoute("/student/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ["student-dashboard"], queryFn: () => getStudentDashboard() });
  const updateFn = useServerFn(studentUpdateProfile);

  const [fullName, setFullName] = useState("");
  const [grade, setGrade] = useState<"g1" | "g2" | "g3">("g1");
  const [track, setTrack] = useState<"general" | "azhar">("general");
  const [parentPhone, setParentPhone] = useState("");
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const s = dash.data?.student;
    if (!s) return;
    setFullName(s.full_name || "");
    setGrade((s.grade as any) || "g1");
    setTrack((s.track as any) || "general");
    setParentPhone(s.parent_phone || "");
  }, [dash.data]);

  const mut = useMutation({
    mutationFn: (vars: any) => updateFn({ data: vars }),
    onSuccess: async () => {
      setMsg({ type: "ok", text: "تم حفظ التعديلات بنجاح ✅" });
      await qc.invalidateQueries({ queryKey: ["student-dashboard"] });
      await qc.invalidateQueries({ queryKey: ["student-me"] });
    },
    onError: (e: any) => setMsg({ type: "err", text: e.message || "حصلت مشكلة." }),
  });

  if (dash.isLoading) {
    return <div className="p-10 text-center text-muted-foreground">جاري التحميل...</div>;
  }
  const s = dash.data?.student;

  return (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-6 md:py-10 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold">👤 حسابك الشخصي</h1>
        <p className="text-sm text-muted-foreground mt-1">عدّل بياناتك متى احتجت.</p>
      </header>

      <div className="surface-card p-5 md:p-6 grid grid-cols-2 gap-4 text-sm">
        <Info label="الكود" value={s?.student_code} mono />
        <Info label="رقم الطالب" value={s?.phone_number || "—"} mono />
        <Info label="النقاط" value={s?.points ?? 0} />
        <Info label="الرصيد" value={`${s?.wallet_balance ?? 0} ج`} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          mut.mutate({ full_name: fullName, grade, track, parent_phone: parentPhone });
        }}
        className="surface-card p-5 md:p-6 space-y-4"
      >
        <h2 className="font-bold text-lg">تعديل البيانات</h2>

        <label className="block">
          <span className="text-sm font-medium">الاسم رباعي</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="مثال: محمد أحمد عبد الله علي"
            className="mt-1 w-full px-3 py-2.5 rounded-lg bg-background border border-border focus:ring-2 focus:ring-primary outline-none"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">الصف</span>
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value as any)}
              className="mt-1 w-full px-3 py-2.5 rounded-lg bg-background border border-border"
            >
              <option value="g1">الأول الثانوي</option>
              <option value="g2">الثاني الثانوي</option>
              <option value="g3">الثالث الثانوي</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">القسم</span>
            <select
              value={track}
              onChange={(e) => setTrack(e.target.value as any)}
              className="mt-1 w-full px-3 py-2.5 rounded-lg bg-background border border-border"
            >
              <option value="general">عام</option>
              <option value="azhar">أزهري</option>
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium">رقم ولي الأمر</span>
          <input
            value={parentPhone}
            onChange={(e) => setParentPhone(e.target.value)}
            inputMode="tel"
            placeholder="01xxxxxxxxx"
            className="mt-1 w-full px-3 py-2.5 rounded-lg bg-background border border-border focus:ring-2 focus:ring-primary outline-none"
          />
        </label>

        {msg && (
          <div
            className={`text-sm p-3 rounded-lg ${
              msg.type === "ok"
                ? "bg-green-500/10 text-green-700 dark:text-green-300"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={mut.isPending}
          className="w-full py-3 rounded-xl brand-gradient text-primary-foreground font-bold hover:opacity-90 disabled:opacity-60"
        >
          {mut.isPending ? "جاري الحفظ..." : "💾 حفظ التعديلات"}
        </button>
      </form>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-bold mt-1 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
