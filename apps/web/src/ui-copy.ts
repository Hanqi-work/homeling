export interface LocalizedCopy {
  readonly key: string;
  readonly params?: Record<string, string | number>;
}
/** Preserves technical error identity/message while supplying structured, reactive UI copy. */
export class LocalizedUIError extends Error {
  constructor(message: string, readonly copy: LocalizedCopy) { super(message); this.name = "LocalizedUIError"; }
}
