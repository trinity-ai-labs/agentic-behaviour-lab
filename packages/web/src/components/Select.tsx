/**
 * The canonical picker: one controlled, house-styled dropdown that replaces
 * every native <select> in the dashboard so the popup lives inside our
 * tokenised surfaces (both themes × light/dark) instead of the OS chrome.
 *
 * A button trigger owns focus the whole time; the open listbox is a floating
 * <ul> and the active row is tracked via aria-activedescendant (roving
 * active-descendant model) rather than moving DOM focus. Keyboard behaviour
 * mirrors a native select: arrows/Home/End move the active option (skipping
 * disabled ones), Enter/Space select, Esc closes, typeahead jumps to a label
 * prefix. Positioning is a plain absolute popup under the trigger — no
 * floating-ui/collision library (deliberately out of scope).
 */
import { createEffect, createMemo, createSignal, createUniqueId, For, onCleanup, Show } from "solid-js"
import styles from "./Select.module.css"

export type SelectOption<T extends string> = {
  value: T
  label: string
  disabled?: boolean
}

export type SelectProps<T extends string> = {
  value: T // "" means nothing chosen → placeholder shown
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: string // trigger text when value is ""
  label?: string // visible label text (optional)
  "aria-label"?: string // for label-less / sr-only cases
  disabled?: boolean
  class?: string | undefined // optional extra class on the wrapper
}

/** Join truthy class names — CSS-module lookups are `string | undefined` under noUncheckedIndexedAccess. */
const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(" ")

export function Select<T extends string>(props: SelectProps<T>) {
  const baseId = createUniqueId()
  const listboxId = `${baseId}-listbox`
  const labelId = `${baseId}-label`
  const optionId = (index: number) => `${baseId}-opt-${index}`

  const [open, setOpen] = createSignal(false)
  const [activeIndex, setActiveIndex] = createSignal(-1)

  let rootRef: HTMLDivElement | undefined
  let triggerRef: HTMLButtonElement | undefined
  let listRef: HTMLUListElement | undefined

  // Call sites pass a freshly-built array (`scenarios().map(...)`); memoising it
  // once keeps every reader — the memos below, <For>, the handlers — off a
  // per-read re-map and gives <For> a stable identity between reads.
  const options = createMemo(() => props.options)

  const selectedIndex = createMemo(() => options().findIndex((o) => o.value === props.value))
  const selectedLabel = createMemo(() => options()[selectedIndex()]?.label)

  /** First enabled index reached from `from` stepping by `dir`, stopping (not wrapping) at the ends; -1 if none. */
  const nextEnabled = (from: number, dir: 1 | -1) => {
    const opts = options()
    for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (!opts[i]?.disabled) return i
    return -1
  }
  const firstEnabled = () => nextEnabled(-1, 1)
  const lastEnabled = () => nextEnabled(options().length, -1)

  /** The row a fresh open should land on: the current value if selectable, else the first enabled option. */
  const initialActive = () => {
    const sel = selectedIndex()
    if (sel >= 0 && !options()[sel]?.disabled) return sel
    return firstEnabled()
  }

  const scrollActiveIntoView = () => {
    const el = listRef?.children[activeIndex()] as HTMLElement | undefined
    // jsdom has no scrollIntoView; the optional call keeps tests from throwing.
    el?.scrollIntoView?.({ block: "nearest" })
  }

  /** Move the active row to `index` (a no-op for -1, i.e. "nowhere to go"). */
  const setActive = (index: number) => {
    if (index < 0) return
    setActiveIndex(index)
    scrollActiveIntoView()
  }

  const openList = () => {
    if (props.disabled) return
    setActiveIndex(initialActive())
    setOpen(true)
    scrollActiveIntoView()
  }

  const close = () => {
    setOpen(false)
    triggerRef?.focus()
  }

  const selectActive = () => {
    const opt = options()[activeIndex()]
    if (opt && !opt.disabled) props.onChange(opt.value)
    close()
  }

  // Arrows step one enabled option and stop (not wrap) at the ends, like a native select; Home/End jump.
  const moveActive = (dir: 1 | -1) => setActive(nextEnabled(activeIndex(), dir))
  const moveToEnd = (which: "first" | "last") => setActive(which === "first" ? firstEnabled() : lastEnabled())

  let typeaheadBuffer = ""
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(typeaheadTimer))

  const typeahead = (char: string) => {
    typeaheadBuffer += char.toLowerCase()
    clearTimeout(typeaheadTimer)
    typeaheadTimer = setTimeout(() => {
      typeaheadBuffer = ""
    }, 500)
    const match = options().findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typeaheadBuffer))
    if (match >= 0) {
      if (!open()) setOpen(true)
      setActive(match)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (props.disabled) return
    const key = e.key
    if (open()) {
      switch (key) {
        case "ArrowDown":
          e.preventDefault()
          moveActive(1)
          return
        case "ArrowUp":
          e.preventDefault()
          moveActive(-1)
          return
        case "Home":
          e.preventDefault()
          moveToEnd("first")
          return
        case "End":
          e.preventDefault()
          moveToEnd("last")
          return
        case "Enter":
        case " ":
          e.preventDefault()
          selectActive()
          return
        case "Escape":
          e.preventDefault()
          close()
          return
        case "Tab":
          setOpen(false)
          return
      }
    } else {
      switch (key) {
        case "ArrowDown":
        case "ArrowUp":
        case "Enter":
        case " ":
          e.preventDefault()
          openList()
          return
      }
    }
    if (key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      typeahead(key)
    }
  }

  // Click-outside closes — capture-phase so it fires before the target's own
  // handlers, and only wired while open so it costs nothing at rest.
  const onDocPointerDown = (e: PointerEvent) => {
    if (rootRef && !rootRef.contains(e.target as Node)) close()
  }
  createEffect(() => {
    if (!open()) return
    document.addEventListener("pointerdown", onDocPointerDown, true)
    onCleanup(() => document.removeEventListener("pointerdown", onDocPointerDown, true))
  })

  return (
    <div class={cx(styles.wrapper, props.class)} ref={rootRef}>
      <Show when={props.label}>
        <span class={styles.label} id={labelId}>
          {props.label}
        </span>
      </Show>
      <div class={styles.field}>
        <button
          type="button"
          ref={triggerRef}
          class={styles.trigger}
          disabled={props.disabled}
          aria-haspopup="listbox"
          aria-expanded={open()}
          aria-controls={open() ? listboxId : undefined}
          aria-activedescendant={open() && activeIndex() >= 0 ? optionId(activeIndex()) : undefined}
          aria-label={props["aria-label"]}
          aria-labelledby={props.label ? labelId : undefined}
          onClick={() => (open() ? close() : openList())}
          onKeyDown={onKeyDown}
        >
          <span class={cx(styles.value, selectedLabel() === undefined && styles.placeholder)}>
            {selectedLabel() ?? props.placeholder ?? ""}
          </span>
          <span class={styles.arrow} aria-hidden="true">
            ▾
          </span>
        </button>
        <Show when={open()}>
          <ul ref={listRef} class={styles.listbox} id={listboxId} role="listbox" aria-label={props["aria-label"] ?? props.label}>
            <For each={options()}>
              {(option, index) => (
                <li
                  id={optionId(index())}
                  role="option"
                  class={cx(
                    styles.option,
                    index() === activeIndex() && styles.active,
                    option.value === props.value && styles.selected,
                    option.disabled && styles.optionDisabled,
                  )}
                  aria-selected={option.value === props.value}
                  aria-disabled={option.disabled ? "true" : undefined}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (option.disabled) return
                    props.onChange(option.value)
                    close()
                  }}
                  onMouseEnter={() => {
                    if (!option.disabled) setActiveIndex(index())
                  }}
                >
                  <span class={styles.optionLabel}>{option.label}</span>
                  <Show when={option.value === props.value}>
                    <span class={styles.check} aria-hidden="true">
                      ✓
                    </span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}
