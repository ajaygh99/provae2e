/**
 * PROVA structured logger
 * Replaces all console.log in production code
 */
import chalk from 'chalk';

type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'success';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

function format(level: LogLevel, message: string, data?: Record<string, unknown>): LogEntry {
  return { level, message, timestamp: new Date().toISOString(), data };
}

export const log = {
  /** Log an informational message to stdout. */
  info:    (msg: string, data?: Record<string, unknown>): LogEntry => {
    const entry = format('info', msg, data);
    process.stdout.write(chalk.blue('ℹ ') + msg + (data ? ' ' + JSON.stringify(data) : '') + '\n');
    return entry;
  },
  /** Log a success message to stdout. */
  success: (msg: string, data?: Record<string, unknown>): LogEntry => {
    const entry = format('success', msg, data);
    process.stdout.write(chalk.green('✓ ') + msg + (data ? ' ' + JSON.stringify(data) : '') + '\n');
    return entry;
  },
  /** Log a warning message to stderr. */
  warn:    (msg: string, data?: Record<string, unknown>): LogEntry => {
    const entry = format('warn', msg, data);
    process.stderr.write(chalk.yellow('⚠ ') + msg + (data ? ' ' + JSON.stringify(data) : '') + '\n');
    return entry;
  },
  /** Log an error message to stderr, extracting the message from an Error if given. */
  error:   (msg: string, error?: unknown): LogEntry => {
    const entry = format('error', msg);
    const errMsg = error instanceof Error ? error.message : String(error ?? '');
    process.stderr.write(chalk.red('✗ ') + msg + (errMsg ? ': ' + errMsg : '') + '\n');
    return entry;
  },
  /** Log a debug message to stdout, only when PROVA_DEBUG is set. */
  debug:   (msg: string, data?: Record<string, unknown>): void => {
    if (process.env['PROVA_DEBUG']) {
      process.stdout.write(chalk.gray('· ') + msg + (data ? ' ' + JSON.stringify(data) : '') + '\n');
    }
  }
};
