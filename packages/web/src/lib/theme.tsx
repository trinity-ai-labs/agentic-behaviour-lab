/**
 * Owns the two independent axes stamped on <html> (docs/DESIGN.md: theme and
 * scheme are separate attributes, never a combined class). Local UI state —
 * never round-trips to the server, so it's a signal/context, not a query
 * (see the solid skill's architecture chapter). Dark is the default scheme;
 * `prefers-color-scheme` is followed live until the user manually overrides
 * it, at which point the override is persisted and wins from then on. The
 * inline script in index.html applies the same persisted/OS-derived values
 * before first paint so there is no flash; this module takes over afterward
 * for in-app toggling.
 */
import { createContext, createEffect, createSignal, onCleanup, useContext, type JSX } from "solid-js"

export type ThemeId = "rime" | "ledger"
export type SchemeId = "dark" | "light"

const THEME_KEY = "abl-theme"
const SCHEME_KEY = "abl-scheme"

const readStoredTheme = (): ThemeId => {
  const stored = localStorage.getItem(THEME_KEY)
  return stored === "rime" || stored === "ledger" ? stored : "rime"
}

/** `undefined` means "no explicit override yet — follow the OS". */
const readStoredScheme = (): SchemeId | undefined => {
  const stored = localStorage.getItem(SCHEME_KEY)
  return stored === "dark" || stored === "light" ? stored : undefined
}

const systemPrefersLight = (): boolean => window.matchMedia("(prefers-color-scheme: light)").matches

export interface ThemeContextValue {
  readonly theme: () => ThemeId
  readonly scheme: () => SchemeId
  readonly setTheme: (theme: ThemeId) => void
  readonly setScheme: (scheme: SchemeId) => void
}

const ThemeContext = createContext<ThemeContextValue>()

export const useTheme = (): ThemeContextValue => {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}

export const ThemeProvider = (props: { children?: JSX.Element }) => {
  const [theme, setThemeSignal] = createSignal<ThemeId>(readStoredTheme())
  const [explicitScheme, setExplicitScheme] = createSignal<SchemeId | undefined>(readStoredScheme())
  const [systemScheme, setSystemScheme] = createSignal<SchemeId>(systemPrefersLight() ? "light" : "dark")

  const media = window.matchMedia("(prefers-color-scheme: light)")
  const onSystemChange = (e: MediaQueryListEvent) => setSystemScheme(e.matches ? "light" : "dark")
  media.addEventListener("change", onSystemChange)
  onCleanup(() => media.removeEventListener("change", onSystemChange))

  const scheme = (): SchemeId => explicitScheme() ?? systemScheme()

  createEffect(() => document.documentElement.setAttribute("data-theme", theme()))
  createEffect(() => document.documentElement.setAttribute("data-scheme", scheme()))

  const setTheme = (next: ThemeId) => {
    setThemeSignal(next)
    localStorage.setItem(THEME_KEY, next)
  }
  const setScheme = (next: SchemeId) => {
    setExplicitScheme(next)
    localStorage.setItem(SCHEME_KEY, next)
  }

  return (
    <ThemeContext.Provider value={{ theme, scheme, setTheme, setScheme }}>{props.children}</ThemeContext.Provider>
  )
}
