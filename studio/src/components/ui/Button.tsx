import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual priority of the action. */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Shows progress and prevents duplicate activation. */
  loading?: boolean;
}

/** A consistent, accessible Studio action button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', loading = false, disabled, children, className = '', ...props },
  ref
): React.JSX.Element {
  return <button ref={ref} className={`ui-button ui-button--${variant} ${className}`.trim()} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>{loading ? 'Working…' : children}</button>;
});
