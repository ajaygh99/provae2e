import type { Plugin, TestFailure, TestResult } from './plugin.js';

export interface IntegrationPlugin extends Plugin {
  readonly type: 'integration';
  sendTestResults(results: TestResult[]): Promise<void>;
  createIssue(failure: TestFailure): Promise<string>;
}

export interface NotificationPlugin extends Plugin {
  readonly type: 'notification';
  postNotification(message: string): Promise<void>;
}
