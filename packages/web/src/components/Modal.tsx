import { onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import styles from './Modal.module.css';

export const Modal = (props: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
}) => {
  let overlayRef!: HTMLDivElement;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
  };

  onMount(() => {
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
  });

  onCleanup(() => {
    document.removeEventListener('keydown', onKeyDown);
    document.body.style.overflow = '';
  });

  return (
    <Portal>
      <div
        ref={overlayRef}
        class={styles.overlay}
        classList={{ [styles.open]: props.open }}
        onClick={(e) => {
          if (e.target === overlayRef) props.onClose();
        }}
      >
        <div class={styles.modal}>
          <div class={styles.header}>
            <h2 class={styles.title}>{props.title ?? ''}</h2>
            <button class={styles.closeBtn} onClick={props.onClose} aria-label="Close">
              ×
            </button>
          </div>
          <div class={styles.body}>{props.children}</div>
        </div>
      </div>
    </Portal>
  );
};
