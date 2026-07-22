import { useId, type SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: readonly SelectOption[];
  error?: string;
}

/** A labelled native select that preserves keyboard and screen-reader behavior. */
export function Select({ label, options, error, id, className = '', ...props }: SelectProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = error ? `${fieldId}-error` : undefined;
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={fieldId}>{label}</label>
      <select id={fieldId} className={`ui-input ui-select ${error ? 'ui-input--invalid' : ''} ${className}`.trim()} aria-invalid={Boolean(error)} aria-describedby={errorId} {...props}>
        {options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
      </select>
      {error && <span id={errorId} className="ui-field__error">{error}</span>}
    </div>
  );
}
