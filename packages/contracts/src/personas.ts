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
  readonly paused?: boolean;
  readonly needsAttention?: string;
}

export type PersonaStatus = "thinking" | "active" | "idle" | "blocked";

/** Runtime state is a projection of the latest Herdr snapshot, not persisted registry data. */
export interface PersonaView extends PersonaRecord {
  readonly status: PersonaStatus;
  /** Missing pane / unreported agent status are explicit, never fabricated thinking. */
  readonly statusSource?: "agent" | "pane" | "missing";
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
