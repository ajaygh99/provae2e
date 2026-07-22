import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}

/** An accessible modal dialog with Escape and backdrop dismissal. */
export function Modal({ open, title, children, onClose, closeLabel = 'Close' }: ModalProps): React.JSX.Element | null {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ui-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="ui-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="ui-modal__header"><h2 id={titleId}>{title}</h2><Button ref={closeButtonRef} variant="secondary" onClick={onClose} aria-label={closeLabel}>×</Button></header>
        <div className="ui-modal__body">{children}</div>
      </section>
    </div>
  );
}
