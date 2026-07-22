import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldChromeProps {
  label: string;
  error?: string;
  hint?: string;
  id?: string;
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement>, FieldChromeProps {}
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldChromeProps {}

/** A labelled text input with hint and validation messaging. */
export function TextField({ label, error, hint, id, className = '', ...props }: TextFieldProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = error || hint ? `${fieldId}-description` : undefined;
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={fieldId}>{label}</label>
      <input id={fieldId} className={`ui-input ${error ? 'ui-input--invalid' : ''} ${className}`.trim()} aria-invalid={Boolean(error)} aria-describedby={descriptionId} {...props} />
      {(error || hint) && <span id={descriptionId} className={error ? 'ui-field__error' : 'ui-field__hint'}>{error ?? hint}</span>}
    </div>
  );
}

/** A labelled multiline input with hint and validation messaging. */
export function Textarea({ label, error, hint, id, className = '', ...props }: TextareaProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const descriptionId = error || hint ? `${fieldId}-description` : undefined;
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={fieldId}>{label}</label>
      <textarea id={fieldId} className={`ui-input ui-textarea ${error ? 'ui-input--invalid' : ''} ${className}`.trim()} aria-invalid={Boolean(error)} aria-describedby={descriptionId} {...props} />
      {(error || hint) && <span id={descriptionId} className={error ? 'ui-field__error' : 'ui-field__hint'}>{error ?? hint}</span>}
    </div>
  );
}
