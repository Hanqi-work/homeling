import type { ReactNode } from "react";

export interface PersonaShellSlots {
  readonly homeSummary?: ReactNode;
  readonly memory?: (personaId: string) => ReactNode;
  readonly activity?: (personaId: string) => ReactNode;
  readonly customize?: (personaId: string) => ReactNode;
  /** A fragment can compose push, lock and locale settings without replacing another slot. */
  readonly settings?: ReactNode;
}
