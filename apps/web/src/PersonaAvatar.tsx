import type { PersonaAvatar as Avatar } from "@homeling/contracts";

/** Shared static avatar seam; customization and runtime animation belong to ticket #18. */
export function PersonaAvatar({ avatar, size = "card" }: { avatar: Avatar; size?: "card" | "detail" }) {
  return <span aria-hidden="true" className={`relative inline-flex shrink-0 items-center justify-center rounded-[45%] ring-1 ring-white/15 ${size === "detail" ? "size-28" : "size-14"}`} style={{ backgroundColor: avatar.color }}>
    <svg viewBox="0 0 64 64" className="h-3/4 w-3/4" fill="none">
      <path d="M21 28v5m22-5v5" stroke="#171717" strokeWidth="5" strokeLinecap="round" />
      <path d="M26 41q6 5 12 0" stroke="#171717" strokeWidth="3" strokeLinecap="round" />
    </svg>
  </span>;
}
