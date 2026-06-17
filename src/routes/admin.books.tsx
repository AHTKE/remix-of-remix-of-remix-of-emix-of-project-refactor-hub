import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteBookAdmin, listBooksAdmin, saveBookAdmin, uploadMedia } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/books")({ component: BooksPage });

function BooksPage() {
  const qc = useQueryClient();
  const books = useQuery({ queryKey: ["books"], queryFn: useServerFn(listBooksAdmin) });
  const save = useServerFn(saveBookAdmin);
  const del = useServerFn(deleteBookAdmin);
  const upload = useServerFn(uploadMedia);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState(0);
  const [fileId, setFileId] = useState("");
  const [coverId, setCoverId] = useState("");
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>, kind: "file" | "cover") {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (kind === "cover") fd.set("kind", "photo");
      const res = await upload({ data: fd });
      if (kind === "cover") setCoverId(res.file_id);
      else setFileId(res.file_id);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function create() {
    if (!title.trim() || !fileId) return alert("أدخل العنوان وارفع ملف الكتاب");
    await save({ data: {
      id: "bk_" + Date.now().toString(36),
      title: title.trim(), description: description.trim(), price,
      file_id: fileId, file_kind: "document", cover_file_id: coverId || null, is_published: true,
    } });
    setTitle(""); setDescription(""); setPrice(0); setFileId(""); setCoverId("");
    await qc.invalidateQueries({ queryKey: ["books"] });
  }

  async function togglePublish(b: any) {
    await save({ data: { ...b, is_published: !b.is_published } });
    await qc.invalidateQueries({ queryKey: ["books"] });
  }
  async function remove(id: string) {
    if (!confirm("حذف الكتاب؟")) return;
    await del({ data: { id } });
    await qc.invalidateQueries({ queryKey: ["books"] });
  }

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold">المكتبة والمتجر</h1><p className="text-sm text-muted-foreground mt-1">ارفع الكتب والملفات للبيع أو مجانًا عبر البوت.</p></div>

      <section className="surface-card p-5 space-y-4">
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-muted-foreground mb-1 block">عنوان الكتاب</span><input value={title} onChange={(e) => setTitle(e.target.value)} className="input-dark" /></label>
          <label className="block"><span className="text-xs text-muted-foreground mb-1 block">السعر (0 = مجاني)</span><input type="number" min={0} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="input-dark" /></label>
        </div>
        <label className="block"><span className="text-xs text-muted-foreground mb-1 block">الوصف</span><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className="input-dark" /></label>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block"><span className="text-xs text-muted-foreground mb-1 block">ملف الكتاب (PDF) {fileId && "✅"}</span><input type="file" onChange={(e) => handleFile(e, "file")} className="input-dark" /></label>
          <label className="block"><span className="text-xs text-muted-foreground mb-1 block">صورة الغلاف (اختياري) {coverId && "✅"}</span><input type="file" accept="image/*" onChange={(e) => handleFile(e, "cover")} className="input-dark" /></label>
        </div>
        <button onClick={create} disabled={uploading} className="rounded-xl brand-gradient text-primary-foreground px-5 py-2.5 font-semibold glow-ring disabled:opacity-50">{uploading ? "جارٍ الرفع..." : "إضافة الكتاب"}</button>
      </section>

      <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(books.data ?? []).map((b) => (
          <div key={b.id} className="surface-card overflow-hidden">
            <div className="aspect-[3/4] bg-secondary/40 relative">
              {b.cover_file_id ? <img src={`/api/public/media/${b.cover_file_id}`} alt={b.title} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-5xl">📕</div>}
              {!b.is_published && <span className="absolute top-2 right-2 text-[10px] bg-destructive text-destructive-foreground px-2 py-0.5 rounded-full">مخفي</span>}
            </div>
            <div className="p-4 space-y-2">
              <div className="font-semibold line-clamp-1">{b.title}</div>
              <div className="text-xs text-muted-foreground">{b.price === 0 ? "مجاني" : `${b.price} ج.م`} · {b.sales} مبيعات · {b.revenue} ج.م</div>
              <div className="flex gap-2 text-xs">
                <button onClick={() => togglePublish(b)} className="text-primary hover:underline">{b.is_published ? "إخفاء" : "نشر"}</button>
                <button onClick={() => remove(b.id)} className="text-destructive hover:underline">حذف</button>
              </div>
            </div>
          </div>
        ))}
        {books.data?.length === 0 && <div className="text-muted-foreground text-sm">لا توجد كتب بعد.</div>}
      </section>
    </div>
  );
}
