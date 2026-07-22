export interface ToastProps {
  message: string;
  tone?: 'success' | 'error' | 'info';
  onDismiss?: () => void;
}

/** Announces transient application feedback without interrupting the user. */
export function Toast({ message, tone = 'info', onDismiss }: ToastProps): React.JSX.Element {
  return (
    <div className={`ui-toast ui-toast--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss notification">×</button>}
    </div>
  );
}
