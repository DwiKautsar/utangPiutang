import { useLayoutEffect, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'credit';
  busy?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  children?: ComponentChildren;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmVariant = 'primary',
  busy = false,
  onClose,
  onConfirm,
  children
}: ConfirmDialogProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    cardRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      class="dialog-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        class="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <h2 id="dialog-title">{title}</h2>
        <p class="ledger-desc">{description}</p>
        {children}
        <div class="dialog-actions">
          <button type="button" class="btn btn-secondary" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button
            type="button"
            class={`btn ${confirmVariant === 'credit' ? 'btn-credit' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
