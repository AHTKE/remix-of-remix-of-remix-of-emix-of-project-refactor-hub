import { useEffect, useState } from "react";

const STORAGE_KEY = "amw_theme";
type Theme = "dark" | "light";

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (saved === "light" || saved === "dark") return saved;
  return "dark";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const t = readInitialTheme();
    setTheme(t);
    applyTheme(t);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="تبديل الوضع الليلي/النهاري"
      className={`inline-flex items-center gap-2 rounded-xl border border-border bg-secondary/60 backdrop-blur px-3 py-2 text-sm font-medium hover:bg-secondary transition ${className}`}
    >
      <span>{theme === "dark" ? "🌙" : "☀️"}</span>
      <span className="hidden sm:inline">{theme === "dark" ? "ليلي" : "نهاري"}</span>
    </button>
  );
}

// Inline script string for SSR: applies stored theme before paint to avoid flash.
export const THEME_INIT_SCRIPT = `(() => {
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    if (t !== 'light' && t !== 'dark') t = 'dark';
    var r = document.documentElement;
    r.classList.toggle('light', t === 'light');
    r.classList.toggle('dark', t === 'dark');
  } catch (e) {}
})();`;
