/** Shared secret and PII protection for model prompts and local learning data. */

const SENSITIVE_PATTERNS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b(?:gh[pousr]_|github_pat_)[a-z0-9_]{8,}\b/gi, replacement: '[REDACTED_TOKEN]' },
  { pattern: /\bsk-[a-z0-9_-]{8,}\b/gi, replacement: '[REDACTED_TOKEN]' },
  { pattern: /\bBearer\s+[a-z0-9._~+/=-]{8,}\b/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { pattern: /\b(password|passwd|token|api[_ -]?key)\s*[:=]\s*\S+/gi, replacement: '$1=[REDACTED]' },
  { pattern: /\b[A-Z0-9._%+-]+@(?!example\.(?:com|org|net)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: '[REDACTED_EMAIL]' },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  { pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: '[REDACTED_PAYMENT_CARD]' }
];

/** Replaces recognized credentials and PII with stable non-sensitive markers. */
export function redactSensitiveData(value: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (sanitized, entry) => sanitized.replace(entry.pattern, entry.replacement),
    value
  );
}

/** Returns true when a value contains recognized credentials or PII. */
export function containsSensitiveData(value: string): boolean {
  return redactSensitiveData(value) !== value;
}
