import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { DEFAULT_THEME_ID, type Theme, themes } from "@/lib/themes";

const STORAGE_KEY = "brackeys-theme";

interface ThemeContextValue {
  themeId: string;
  theme: Theme;
  setTheme: (id: string) => void;
  themes: Theme[];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getStoredTheme(): string {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useState(DEFAULT_THEME_ID);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const stored = getStoredTheme();
    setThemeId(stored);
    document.documentElement.setAttribute("data-theme", stored);
  }, []);

  const setTheme = useCallback((id: string) => {
    setThemeId(id);
    document.documentElement.setAttribute("data-theme", id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // storage full or unavailable
    }
  }, []);

  const theme = themes.find((t) => t.id === themeId) ?? themes[0];

  return (
    <ThemeContext.Provider value={{ themeId, theme, setTheme, themes }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within AppThemeProvider");
  return ctx;
}
