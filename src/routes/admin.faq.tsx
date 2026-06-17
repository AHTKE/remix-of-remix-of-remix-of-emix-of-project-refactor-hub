import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/faq")({
  component: FaqLayout,
});

function FaqLayout() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">FAQ القديمة</h1>
        <Link
          to="/admin/new"
          className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
        >
          + سؤال جديد
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        هذا القسم يحتفظ بنظام الأسئلة القديم (يستخدم رسالة مثبتة واحدة).
      </p>
      <FaqList />
      <Outlet />
    </div>
  );
}

function FaqList() {
  return (
    <div className="surface-card p-6 text-center text-muted-foreground text-sm">
      افتح{" "}
      <Link to="/admin" className="text-primary hover:underline">
        لوحة الأسئلة القديمة
      </Link>{" "}
      عبر الرابط المخصص لكل سؤال (تم استبدالها بنظام الكورسات الجديد).
    </div>
  );
}
