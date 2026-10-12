export interface PushBodyTemplate {
  readonly key: 'push.approval' | 'push.taskCompleted' | 'push.taskFailed' | 'push.test';
  /** Agent/user text stays literal; only surrounding system copy is localized. */
  readonly params: Readonly<Record<string, string>>;
}
export interface PushPayload {
  readonly version: 1;
  readonly type: 'notification';
  readonly title: string;
  readonly body: string;
  readonly bodyTemplate?: PushBodyTemplate;
  readonly titleTemplate?: { readonly key: 'push.agentsNeedYou'; readonly params: { readonly count: number } };
  readonly summaryTemplate?: {
    readonly key: 'push.agentsSummary';
    readonly params: { readonly count: number };
    readonly questions: readonly { readonly personaName: string; readonly question: string }[];
  };
  readonly tag: string;
  readonly url: string;
  readonly occurrenceKey: string;
}
export interface PushPreferences { readonly enabled: boolean }
