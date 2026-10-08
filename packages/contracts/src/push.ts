export interface PushPayload {
  readonly version: 1;
  readonly type: 'notification';
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly url: string;
  readonly occurrenceKey: string;
}
export interface PushRetractPayload {
  readonly version: 1;
  readonly type: 'retract';
  readonly tag: string;
}
export interface PushPreferences { readonly enabled: boolean }
