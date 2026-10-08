export interface PersonaMemorySession {
  readonly paneId: string;
  readonly strategy: "pi-append-system-prompt" | "first-message-prefix";
  readonly unsupported: boolean;
  readonly notice: string;
  /** Frozen launch context for unsupported kinds; never recomputed after edits. */
  readonly prefix: string;
}

export interface PersonaAvatar {
  readonly color: string;
  readonly character?: string;
  readonly pet?: string;
}

/** Durable persona identity and Herdr association stored by the daemon. */
export interface PersonaRecord {
  readonly id: string;
  readonly name: string;
  readonly avatar: PersonaAvatar;
  readonly spaceId: string;
  readonly mainPaneId: string;
  readonly systemPrompt: string;
  readonly createdAt: string;
  readonly launcherCommand?: string;
  readonly systemPromptInjected?: boolean;
  readonly memorySession?: PersonaMemorySession;
  /** A dispatched injection with uncertain outcome is never automatically replayed. */
  readonly memoryDeliveryUnknown?: boolean;
  readonly paused?: boolean;
  readonly needsAttention?: string;
}

export type PersonaStatus = "thinking" | "active" | "idle" | "blocked";

/** Runtime state is a projection of the latest Herdr snapshot, not persisted registry data. */
export interface PersonaView extends PersonaRecord {
  readonly status: PersonaStatus;
}

export interface PersonaListResponse {
  readonly personas: readonly PersonaView[];
}

export interface CreatePersonaRequest {
  readonly name: string;
  readonly avatar: PersonaAvatar;
  readonly systemPrompt?: string;
  readonly launcherCommand?: string;
}

export interface PersonaMessageRequest {
  readonly text: string;
}
