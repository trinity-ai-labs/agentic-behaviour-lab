import { useTheme, type SchemeId, type ThemeId } from "../lib/theme"
import styles from "./ThemeToggle.module.css"

export const ThemeToggle = () => {
  const { theme, scheme, setTheme, setScheme } = useTheme()
  return (
    <div class={styles.controls}>
      <label class={styles.control}>
        <span class={styles.srOnly}>Theme</span>
        <select
          class={styles.select}
          value={theme()}
          onChange={(e) => setTheme(e.currentTarget.value as ThemeId)}
        >
          <option value="rime">Rime</option>
          <option value="ledger">Ledger</option>
        </select>
      </label>
      <button
        type="button"
        class={styles.schemeButton}
        aria-pressed={scheme() === "light"}
        onClick={() => setScheme(scheme() === "dark" ? "light" : "dark")}
        title={`Switch to ${scheme() === "dark" ? "light" : "dark"} scheme`}
      >
        {schemeGlyph(scheme())}
        <span class={styles.srOnly}>Toggle light/dark scheme</span>
      </button>
    </div>
  )
}

const schemeGlyph = (scheme: SchemeId): string => (scheme === "dark" ? "☾" : "☀")
