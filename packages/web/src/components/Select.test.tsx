// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select, type SelectOption } from './Select';

afterEach(cleanup);

const FRUITS: SelectOption<string>[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana', disabled: true },
  { value: 'cherry', label: 'Cherry' },
];

/** Controlled harness: onChange feeds a signal back into value, mirroring real call sites. */
const renderSelect = (opts?: { value?: string; options?: SelectOption<string>[] }) => {
  const onChange = vi.fn();
  const [value, setValue] = createSignal(opts?.value ?? '');
  const view = render(() => (
    <Select
      aria-label="Fruit"
      placeholder="Pick one"
      value={value()}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
      options={opts?.options ?? FRUITS}
    />
  ));
  const trigger = view.getByRole('button', { name: 'Fruit' }) as HTMLButtonElement;
  const activeId = () => trigger.getAttribute('aria-activedescendant');
  return { ...view, trigger, onChange, value, activeId };
};

describe('Select — ARIA wiring', () => {
  it('exposes the listbox trigger contract, closed and open', () => {
    const { trigger, queryByRole, getAllByRole } = renderSelect();
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const listbox = queryByRole('listbox');
    expect(listbox).not.toBeNull();
    expect(trigger.getAttribute('aria-controls')).toBe(listbox!.id);
    expect(trigger.getAttribute('aria-activedescendant')).not.toBeNull();

    const options = getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]!.getAttribute('aria-selected')).toBe('false');
  });
});

describe('Select — opening', () => {
  it('opens on trigger click', () => {
    const { trigger, queryByRole } = renderSelect();
    fireEvent.click(trigger);
    expect(queryByRole('listbox')).not.toBeNull();
  });

  it('opens on ArrowDown when focused', () => {
    const { trigger, queryByRole } = renderSelect();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(queryByRole('listbox')).not.toBeNull();
  });

  it('opens on Enter when focused', () => {
    const { trigger, queryByRole } = renderSelect();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(queryByRole('listbox')).not.toBeNull();
  });
});

describe('Select — selecting', () => {
  it('selects on option click and closes', () => {
    const { trigger, onChange, queryByRole, getAllByRole } = renderSelect();
    fireEvent.click(trigger);
    fireEvent.click(getAllByRole('option')[2]!);
    expect(onChange).toHaveBeenCalledWith('cherry');
    expect(queryByRole('listbox')).toBeNull();
  });

  it('selects the active option on Enter', () => {
    const { trigger, onChange } = renderSelect();
    // Closed → ArrowDown opens with active = first enabled (apple); Enter selects it.
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('apple');
  });

  it('ignores clicks on disabled options', () => {
    const { trigger, onChange, queryByRole, getAllByRole } = renderSelect();
    fireEvent.click(trigger);
    fireEvent.click(getAllByRole('option')[1]!); // banana, disabled
    expect(onChange).not.toHaveBeenCalled();
    expect(queryByRole('listbox')).not.toBeNull();
  });
});

describe('Select — keyboard navigation', () => {
  it('ArrowDown / ArrowUp skip disabled options', () => {
    const { trigger, activeId } = renderSelect();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // open, active = apple (0)
    expect(activeId()).toMatch(/opt-0$/);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' }); // skip banana (1) → cherry (2)
    expect(activeId()).toMatch(/opt-2$/);
    fireEvent.keyDown(trigger, { key: 'ArrowUp' }); // skip banana → apple (0)
    expect(activeId()).toMatch(/opt-0$/);
  });

  it('Home / End jump to first / last enabled option', () => {
    const { trigger, activeId } = renderSelect();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'End' });
    expect(activeId()).toMatch(/opt-2$/);
    fireEvent.keyDown(trigger, { key: 'Home' });
    expect(activeId()).toMatch(/opt-0$/);
  });

  it('Esc closes without selecting and returns focus to the trigger', () => {
    const { trigger, onChange, queryByRole } = renderSelect();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(queryByRole('listbox')).not.toBeNull();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it('typeahead jumps to the matching option', () => {
    const { trigger, activeId, queryByRole } = renderSelect();
    fireEvent.keyDown(trigger, { key: 'c' }); // opens and jumps to Cherry
    expect(queryByRole('listbox')).not.toBeNull();
    expect(activeId()).toMatch(/opt-2$/);
  });
});

describe('Select — controlled value', () => {
  it('renders the selected label on the trigger', () => {
    const { trigger } = renderSelect({ value: 'cherry' });
    expect(trigger.textContent).toContain('Cherry');
  });

  it('shows the placeholder when nothing is chosen', () => {
    const { trigger } = renderSelect({ value: '' });
    expect(trigger.textContent).toContain('Pick one');
  });

  it('marks the current value with aria-selected', () => {
    const { trigger, getAllByRole } = renderSelect({ value: 'cherry' });
    fireEvent.click(trigger);
    const options = getAllByRole('option');
    expect(options[0]!.getAttribute('aria-selected')).toBe('false');
    expect(options[2]!.getAttribute('aria-selected')).toBe('true');
  });
});
