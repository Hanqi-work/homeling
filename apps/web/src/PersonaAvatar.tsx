import type { PersonaAvatar as Avatar, PersonaView } from "@homeling/contracts";

export interface PersonaAvatarProps {
  avatar: Avatar;
  size?: "card" | "detail" | "conversation";
  /** Only a fresh daemon projection may opt into the single thinking orb. */
  persona?: PersonaView;
  stale?: boolean;
}

const sizes = { card: "size-14", detail: "size-28", conversation: "size-10" };

export function PersonaAvatar({ avatar, size = "card", persona, stale = false }: PersonaAvatarProps) {
  const character = avatar.character ?? "smile";
  const pet = avatar.pet ?? "none";
  const thinking = !stale && persona?.status === "thinking" && persona.statusSource !== "missing" && persona.statusSource !== "pane" && !persona.paused && !persona.needsAttention;
  return <span className="relative inline-flex shrink-0 items-center justify-center">
    <span aria-hidden="true" data-character={character} data-pet={pet} className={`relative inline-flex items-center justify-center rounded-[45%] ring-1 ring-white/15 ${sizes[size]} ${thinking ? "persona-thinking-orb" : ""}`} style={{ backgroundColor: avatar.color }}>
      <svg viewBox="0 0 64 64" className="h-3/4 w-3/4" fill="none" stroke="#171717" strokeLinecap="round">
        {character === "sleepy" ? <path d="M17 30q4 4 8 0m14 0q4 4 8 0" strokeWidth="4" />
          : character === "curious" ? <><path d="M18 23q4-4 8 0" strokeWidth="3" /><circle cx="22" cy="31" r="3" fill="#171717" stroke="none" /><circle cx="42" cy="29" r="5" strokeWidth="3" /></>
          : <path d="M21 28v5m22-5v5" strokeWidth="5" />}
        <path d={character === "curious" ? "M29 43q3-3 6 0" : character === "sleepy" ? "M28 42h8" : "M26 41q6 5 12 0"} strokeWidth="3" />
      </svg>
      {pet === "cat" || pet === "dog" ? <svg viewBox="0 0 32 32" className="absolute -right-2 -bottom-1 size-[45%]" fill="#fef3c7" stroke="#171717" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
        {pet === "cat" ? <path d="M6 12V4l8 5h4l8-5v8q3 3 2 8-1 8-12 8S2 23 4 17q0-3 2-5Z" /> : <><path d="M9 9q7-6 14 0l3 11q0 9-10 9T6 20Z" /><path d="M9 9Q1 4 2 17q1 5 5 3m16-11q8-5 7 8-1 5-5 3" /></>}
        <path d="M11 17v1m10-1v1m-7 4 2 2 2-2" />
      </svg> : null}
    </span>
    {thinking ? <span role="status" className="sr-only">Thinking</span> : null}
  </span>;
}
