import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  deleteCourse,
  deleteLesson,
  listCourses,
  listLessons,
  listQuizzesAdmin,
  saveCourse,
  saveLesson,
  uploadMedia,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/courses")({
  component: CoursesPage,
});

type CourseRow = Awaited<ReturnType<typeof listCourses>>[number];

function CoursesPage() {
  const list = useServerFn(listCourses);
  const save = useServerFn(saveCourse);
  const del = useServerFn(deleteCourse);
  const upload = useServerFn(uploadMedia);
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ["courses"], queryFn: list });
  const [editing, setEditing] = useState<Partial<CourseRow> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  function newCourse() {
    setEditing({
      id: "c_" + Date.now().toString(36),
      title: "",
      subtitle: "",
      cover_url: "",
      is_pinned: false,
      is_published: true,
      order: (courses.data?.length ?? 0) + 1,
    });
  }

  async function onSave() {
    if (!editing?.title) return;
    await save({ data: editing as any });
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["courses"] });
  }

  async function onDelete(id: string, title: string) {
    if (!confirm(`حذف الكورس "${title}" وكل حصصه؟`)) return;
    await del({ data: { id } });
    qc.invalidateQueries({ queryKey: ["courses"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">الكورسات</h1>
          <p className="text-sm text-muted-foreground mt-1">
            إجمالي: {courses.data?.length ?? 0}
          </p>
        </div>
        <button
          onClick={newCourse}
          className="rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold glow-ring"
        >
          + كورس جديد
        </button>
      </div>

      {courses.isLoading ? (
        <div className="text-muted-foreground">جاري التحميل...</div>
      ) : courses.error ? (
        <div className="surface-card p-4 text-destructive">{(courses.error as Error).message}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {(courses.data ?? []).map((c) => (
            <CourseCard
              key={c.id}
              course={c}
              isOpen={openId === c.id}
              onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              onEdit={() => setEditing(c)}
              onDelete={() => onDelete(c.id, c.title)}
            />
          ))}
        </div>
      )}

      {editing && (
        <CourseEditor
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={onSave}
          upload={upload}
        />
      )}
    </div>
  );
}

function CourseCard({
  course,
  isOpen,
  onToggle,
  onEdit,
  onDelete,
}: {
  course: CourseRow;
  isOpen: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const coverSrc = course.cover_file_id
    ? `/api/public/media/${course.cover_file_id}`
    : course.cover_url || "";
  return (
    <div className="surface-card overflow-hidden flex flex-col">
      <button onClick={onToggle} className="text-right">
        <div className="aspect-video relative bg-secondary/40">
          {coverSrc ? (
            <img src={coverSrc} alt={course.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full brand-gradient opacity-80 flex items-center justify-center text-5xl">📖</div>
          )}
          {course.is_pinned && (
            <span className="absolute top-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full pin-badge">
              📌 كورس مثبت
            </span>
          )}
        </div>
        <div className="p-4">
          <div className="font-semibold">{course.title}</div>
          {course.subtitle && (
            <div className="text-xs text-muted-foreground mt-0.5">{course.subtitle}</div>
          )}
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-3">
            <span>📚 {course.lesson_count} حصة</span>
            <span className="ms-auto">{isOpen ? "▲ إغلاق" : "▼ الحصص"}</span>
          </div>
        </div>
      </button>
      {isOpen && <LessonsPanel courseId={course.id} />}
      <div className="px-4 pb-4 pt-2 flex gap-2 border-t border-border mt-auto">
        <button onClick={onEdit} className="flex-1 rounded-lg bg-secondary px-3 py-1.5 text-sm hover:bg-accent">
          تعديل
        </button>
        <button onClick={onDelete} className="rounded-lg px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10">
          حذف
        </button>
      </div>
    </div>
  );
}

function LessonsPanel({ courseId }: { courseId: string }) {
  const list = useServerFn(listLessons);
  const listQuizzes = useServerFn(listQuizzesAdmin);
  const save = useServerFn(saveLesson);
  const del = useServerFn(deleteLesson);
  const upload = useServerFn(uploadMedia);
  const qc = useQueryClient();
  const lessons = useQuery({
    queryKey: ["lessons", courseId],
    queryFn: () => list({ data: { course_id: courseId } }),
  });
  const quizzes = useQuery({ queryKey: ["quizzes"], queryFn: listQuizzes });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [quizId, setQuizId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [linkDrafts, setLinkDrafts] = useState<Record<string, { url: string; title: string }>>({});
  const [videoDrafts, setVideoDrafts] = useState<Record<string, { value: string; title: string }>>({});

  async function addVideoResource(lesson: any) {
    const draft = videoDrafts[lesson.id] || { value: "", title: "" };
    const raw = draft.value.trim();
    if (!raw) return alert("ضع Telegram file_id أو رابط فيديو");
    const isUrl = /^https?:\/\//i.test(raw);
    const resource: any = {
      id: "r_" + Date.now().toString(36),
      kind: "video",
      file_name: draft.title.trim() || "فيديو الحصة",
    };
    if (isUrl) {
      resource.url = raw;
      resource.provider = "external";
    } else {
      // Telegram file_id — served via /api/public/media proxy
      resource.file_id = raw;
    }
    await save({ data: { ...lesson, resources: [...lesson.resources, resource] } as any });
    setVideoDrafts({ ...videoDrafts, [lesson.id]: { value: "", title: "" } });
    qc.invalidateQueries({ queryKey: ["lessons", courseId] });
  }

  async function add() {
    if (!title.trim()) return;
    await save({
      data: {
        id: "l_" + Date.now().toString(36),
        course_id: courseId,
        title: title.trim(),
        description: description.trim(),
        resources: [],
        quiz_id: quizId || null,
        order: (lessons.data?.length ?? 0) + 1,
      },
    });
    setTitle("");
    setDescription("");
    setQuizId("");
    setAdding(false);
    qc.invalidateQueries({ queryKey: ["lessons", courseId] });
    qc.invalidateQueries({ queryKey: ["courses"] });
  }

  async function addResource(lessonId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await upload({ data: fd });
      const lesson = lessons.data!.find((l) => l.id === lessonId)!;
      const resource = {
        id: "r_" + Date.now().toString(36),
        kind: res.kind,
        file_id: res.file_id,
        file_name: res.file_name,
        mime: res.mime,
        size_bytes: res.size_bytes,
      };
      await save({
        data: { ...lesson, resources: [...lesson.resources, resource] } as any,
      });
      qc.invalidateQueries({ queryKey: ["lessons", courseId] });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function removeLesson(id: string, t: string) {
    if (!confirm(`حذف الحصة "${t}"؟`)) return;
    await del({ data: { id } });
    qc.invalidateQueries({ queryKey: ["lessons", courseId] });
    qc.invalidateQueries({ queryKey: ["courses"] });
  }

  async function patchLesson(lesson: any, patch: Record<string, any>) {
    await save({ data: { ...lesson, ...patch } });
    qc.invalidateQueries({ queryKey: ["lessons", courseId] });
  }

  async function removeResource(lesson: any, resourceId: string) {
    await patchLesson(lesson, { resources: lesson.resources.filter((r: any) => r.id !== resourceId) });
  }

  async function addLinkResource(lesson: any) {
    const draft = linkDrafts[lesson.id] || { url: "", title: "" };
    const url = draft.url.trim();
    if (!/^https?:\/\//i.test(url)) return alert("ضع رابط صحيح يبدأ بـ https://");
    const resource = {
      id: "r_" + Date.now().toString(36),
      kind: "link",
      url,
      provider: /drive\.google\.com/i.test(url) ? "google_drive" : "external",
      file_name: draft.title.trim() || (/drive\.google\.com/i.test(url) ? "فيديو Google Drive" : "رابط شرح"),
    };
    await save({ data: { ...lesson, resources: [...lesson.resources, resource] } as any });
    setLinkDrafts({ ...linkDrafts, [lesson.id]: { url: "", title: "" } });
    qc.invalidateQueries({ queryKey: ["lessons", courseId] });
  }

  return (
    <div className="border-t border-border bg-background/40 p-3 space-y-2">
      {lessons.isLoading ? (
        <div className="text-xs text-muted-foreground">تحميل الحصص...</div>
      ) : (
        (lessons.data ?? []).map((l) => (
          <div key={l.id} className="rounded-lg bg-secondary/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <input
                defaultValue={l.title}
                onBlur={(e) => e.target.value !== l.title && patchLesson(l, { title: e.target.value })}
                className="min-w-0 flex-1 rounded-md bg-input border border-border px-2 py-1 text-sm font-medium"
              />
              <button onClick={() => removeLesson(l.id, l.title)} className="text-xs text-destructive hover:underline">
                حذف
              </button>
            </div>
            <input
              defaultValue={l.description || ""}
              onBlur={(e) => e.target.value !== (l.description || "") && patchLesson(l, { description: e.target.value })}
              placeholder="وصف مختصر للحصة"
              className="w-full rounded-md bg-input border border-border px-2 py-1 text-xs"
            />
            <select
              value={l.quiz_id || ""}
              onChange={(e) => patchLesson(l, { quiz_id: e.target.value || null })}
              className="w-full rounded-md bg-input border border-border px-2 py-1 text-xs"
            >
              <option value="">بدون امتحان تقييمي</option>
              {(quizzes.data ?? []).map((q) => (
                <option key={q.id} value={q.id}>{q.title}</option>
              ))}
            </select>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {l.resources.map((r) => (
                <button key={r.id} onClick={() => removeResource(l, r.id)} className="text-[10px] px-2 py-0.5 rounded-full bg-accent/60 hover:bg-destructive/20">
                  {r.kind === "video" ? "📺" : r.kind === "document" ? "📘" : r.kind === "photo" ? "🖼️" : r.kind === "audio" ? "🎵" : "🔗"}{" "}
                  {r.file_name || r.kind}
                </button>
              ))}
              <label className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary cursor-pointer hover:bg-primary/30">
                + ملف
                <input
                  type="file"
                  className="hidden"
                  onChange={(e) => addResource(l.id, e)}
                  disabled={uploading}
                />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-1.5">
              <input
                value={linkDrafts[l.id]?.url || ""}
                onChange={(e) => setLinkDrafts({ ...linkDrafts, [l.id]: { ...(linkDrafts[l.id] || { title: "" }), url: e.target.value } })}
                placeholder="رابط شرح Google Drive أو أي رابط فيديو"
                className="rounded-md bg-input border border-border px-2 py-1 text-xs"
              />
              <input
                value={linkDrafts[l.id]?.title || ""}
                onChange={(e) => setLinkDrafts({ ...linkDrafts, [l.id]: { ...(linkDrafts[l.id] || { url: "" }), title: e.target.value } })}
                placeholder="اسم الرابط (اختياري)"
                className="rounded-md bg-input border border-border px-2 py-1 text-xs"
              />
              <button onClick={() => addLinkResource(l)} className="rounded-md bg-primary/15 text-primary px-3 py-1 text-xs font-semibold">
                + رابط
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-1.5">
              <input
                value={videoDrafts[l.id]?.value || ""}
                onChange={(e) => setVideoDrafts({ ...videoDrafts, [l.id]: { ...(videoDrafts[l.id] || { title: "" }), value: e.target.value } })}
                placeholder="🎬 Telegram file_id أو رابط فيديو (للحلقات الكبيرة)"
                className="rounded-md bg-input border border-border px-2 py-1 text-xs font-mono"
                dir="ltr"
              />
              <input
                value={videoDrafts[l.id]?.title || ""}
                onChange={(e) => setVideoDrafts({ ...videoDrafts, [l.id]: { ...(videoDrafts[l.id] || { value: "" }), title: e.target.value } })}
                placeholder="عنوان الفيديو (اختياري)"
                className="rounded-md bg-input border border-border px-2 py-1 text-xs"
              />
              <button onClick={() => addVideoResource(l)} className="rounded-md bg-primary/15 text-primary px-3 py-1 text-xs font-semibold">
                + فيديو
              </button>
            </div>
          </div>
        ))
      )}
      {adding ? (
        <div className="space-y-2 rounded-lg border border-border bg-background/40 p-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="عنوان الحصة"
            className="w-full rounded-lg bg-input border border-border px-3 py-1.5 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="وصف الحصة"
            rows={2}
            className="w-full rounded-lg bg-input border border-border px-3 py-1.5 text-sm"
          />
          <select value={quizId} onChange={(e) => setQuizId(e.target.value)} className="w-full rounded-lg bg-input border border-border px-3 py-1.5 text-sm">
            <option value="">بدون امتحان</option>
            {(quizzes.data ?? []).map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={add} className="rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm">إضافة</button>
            <button onClick={() => setAdding(false)} className="text-xs text-muted-foreground px-2">إلغاء</button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full rounded-lg border border-dashed border-border text-xs text-muted-foreground py-2 hover:text-foreground hover:bg-secondary/40"
        >
          + إضافة حصة
        </button>
      )}
    </div>
  );
}

function CourseEditor({
  value,
  onChange,
  onClose,
  onSave,
  upload,
}: {
  value: Partial<CourseRow>;
  onChange: (v: Partial<CourseRow>) => void;
  onClose: () => void;
  onSave: () => void;
  upload: (args: { data: FormData }) => Promise<{ kind: string; file_id: string }>;
}) {
  const [uploading, setUploading] = useState(false);
  const coverSrc = value.cover_file_id
    ? `/api/public/media/${value.cover_file_id}`
    : value.cover_url || "";
  async function onPickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kind", "photo");
      const res = await upload({ data: fd });
      onChange({ ...value, cover_file_id: res.file_id, cover_url: "" });
    } catch (err: any) {
      alert("فشل رفع الصورة: " + (err?.message || err));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }
  return (
    <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur flex items-center justify-center p-4">
      <div className="surface-card w-full max-w-lg p-6 space-y-4" dir="rtl">
        <h2 className="text-lg font-semibold">{value.created_at ? "تعديل الكورس" : "كورس جديد"}</h2>
        <Field label="العنوان">
          <input
            value={value.title || ""}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            className="w-full rounded-lg bg-input border border-border px-3 py-2"
          />
        </Field>
        <Field label="العنوان الفرعي">
          <input
            value={value.subtitle || ""}
            onChange={(e) => onChange({ ...value, subtitle: e.target.value })}
            className="w-full rounded-lg bg-input border border-border px-3 py-2"
          />
        </Field>
        <Field label="صورة الغلاف">
          <div className="space-y-2">
            {coverSrc && (
              <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-secondary/40">
                <img src={coverSrc} alt="cover" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <label className="rounded-lg bg-primary/20 text-primary px-3 py-1.5 text-sm font-medium cursor-pointer hover:bg-primary/30">
                {uploading ? "جاري الرفع..." : coverSrc ? "تغيير الصورة" : "⬆️ رفع صورة"}
                <input type="file" accept="image/*" className="hidden" onChange={onPickCover} disabled={uploading} />
              </label>
              {coverSrc && (
                <button
                  type="button"
                  onClick={() => onChange({ ...value, cover_file_id: null, cover_url: "" })}
                  className="text-xs text-destructive hover:underline px-2"
                >
                  إزالة
                </button>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              ارفع الصورة مباشرة من جهازك — هتتخزن في قناة الميديا وتظهر فوراً.
            </div>
          </div>
        </Field>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!value.is_pinned}
              onChange={(e) => onChange({ ...value, is_pinned: e.target.checked })}
            />
            📌 كورس مثبت
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.is_published !== false}
              onChange={(e) => onChange({ ...value, is_published: e.target.checked })}
            />
            منشور
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm">
            إلغاء
          </button>
          <button
            onClick={onSave}
            disabled={!value.title}
            className="rounded-lg brand-gradient text-primary-foreground px-5 py-2 text-sm font-semibold disabled:opacity-50"
          >
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
