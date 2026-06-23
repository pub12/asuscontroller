'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Lightweight theme context (replaces next-themes).
 *
 * next-themes renders its anti-flash <script> inside its client-component
 * ThemeProvider, which trips React 19 / Next 16's "script tag while rendering
 * a React component" warning (a client-rendered script never executes). Here
 * the blocking script lives in the server-rendered <head> (see app/layout.tsx),
 * the legitimate place for it, and this context only carries runtime state for
 * the toggle. API mirrors the slice of next-themes we used: { resolvedTheme, setTheme }.
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';
const DEFAULT_THEME: Theme = 'dark';

type ThemeContextValue = {
  theme: Theme;
  resolvedTheme: Theme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

/**
 * The inline script that runs in <head> before paint to set the theme class,
 * preventing a flash of the wrong theme. Kept in sync with applyTheme/DEFAULT_THEME.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark')t='${DEFAULT_THEME}';var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(t);r.style.colorScheme=t;}catch(e){}})();`;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Initialize from storage so the client's first render already matches what the
  // head script painted. On the server readStoredTheme() returns DEFAULT_THEME;
  // the theme value isn't rendered into the DOM (ThemeToggle gates on mount and
  // the <html> class is managed imperatively), so there's no hydration mismatch.
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, t);
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, []);

  // Single authoritative DOM sync — runs on mount and on every theme change.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
        setThemeState(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme: theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return { theme: DEFAULT_THEME, resolvedTheme: DEFAULT_THEME, setTheme: () => {} };
  }
  return ctx;
}
