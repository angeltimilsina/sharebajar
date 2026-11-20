"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** Applies a saved theme before first paint. Default is dark (set on <html>); a saved choice wins. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('sb.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`;

const effective = (): "dark" | "light" => {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  useEffect(() => {
    setTheme(effective());
    // Follow the device when the user hasn't picked a theme (charts listen for "sb-theme").
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (!document.documentElement.dataset.theme) { setTheme(effective()); window.dispatchEvent(new Event("sb-theme")); } };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("sb.theme", next); } catch { /* ignore */ }
    setTheme(next);
    window.dispatchEvent(new Event("sb-theme"));
  };
  return (
    <button onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className="h-10 w-10 grid place-items-center rounded-full text-muted hover:text-fg hover:bg-surface-2 transition-colors">
      {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
