import { Select } from './Select';
import { useTheme, type SchemeId, type ThemeId } from '../lib/theme';
import styles from './ThemeToggle.module.css';

export const ThemeToggle = () => {
  const { theme, scheme, setTheme, setScheme } = useTheme();
  return (
    <div class={styles.controls}>
      <Select<ThemeId>
        aria-label="Theme"
        value={theme()}
        onChange={setTheme}
        options={[
          { value: 'rime', label: 'Rime' },
          { value: 'ledger', label: 'Ledger' },
        ]}
      />
      <button
        type="button"
        class={styles.schemeButton}
        aria-pressed={scheme() === 'light'}
        onClick={() => setScheme(scheme() === 'dark' ? 'light' : 'dark')}
        title={`Switch to ${scheme() === 'dark' ? 'light' : 'dark'} scheme`}
      >
        {schemeGlyph(scheme())}
        <span class={styles.srOnly}>Toggle light/dark scheme</span>
      </button>
    </div>
  );
};

const schemeGlyph = (scheme: SchemeId): string => (scheme === 'dark' ? '☾' : '☀');
