import { useState } from "react";

type Theme = "dark" | "light";
const KEY = "operator-board-theme";

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* ignore */
  }
  return "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="icon-btn motion-press"
      aria-pressed={theme === "light"}
      aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
      title={theme === "dark" ? "浅色" : "深色"}
      onClick={() => {
        setTheme(next);
        applyTheme(next);
      }}
    >
      <span className="motion-count">
        <span key={theme} className="motion-count-inner">
          {theme === "dark" ? "浅色" : "深色"}
        </span>
      </span>
    </button>
  );
}
