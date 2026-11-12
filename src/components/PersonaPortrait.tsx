import type { ReactNode } from "react";
import { AI_DIVISION } from "../lib/copy";
import { monogramFor, PERSONA_PORTRAITS, portraitById } from "../lib/personas";
import { ArchiveText } from "./ArchiveText";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.15,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect x="1.2" y="1.2" width="45.6" height="45.6" {...stroke} />
      {children}
    </svg>
  );
}

const MARKS: Record<string, ReactNode> = {
  iris: (
    <Frame>
      <circle cx="24" cy="24" r="13.5" {...stroke} />
      <circle cx="24" cy="24" r="7.5" {...stroke} />
      <circle cx="24" cy="24" r="2.1" fill="currentColor" stroke="none" />
      <line x1="24" y1="10.5" x2="24" y2="37.5" {...stroke} strokeWidth={0.9} />
    </Frame>
  ),
  quill: (
    <Frame>
      <path d="M14.5 34.5c6-1.5 12.5-8.5 16.5-16.5 1.6-3.2 2.4-6.2 2.2-8.2-2.2.1-5.4 1.2-8.6 3.4C17 19 12.8 27 14.5 34.5z" {...stroke} />
      <path d="M16 32.5c3.2-4.2 7.4-8.8 12.4-12.2" {...stroke} strokeWidth={0.9} />
      <path d="M18.5 36.5h11" {...stroke} strokeWidth={0.9} />
    </Frame>
  ),
  compass: (
    <Frame>
      <circle cx="24" cy="24" r="12.5" {...stroke} />
      <path d="M24 13.5 L26.2 24 L24 34.5 L21.8 24 Z" {...stroke} />
      <line x1="24" y1="9.5" x2="24" y2="12" {...stroke} strokeWidth={0.9} />
      <line x1="24" y1="36" x2="24" y2="38.5" {...stroke} strokeWidth={0.9} />
      <line x1="9.5" y1="24" x2="12" y2="24" {...stroke} strokeWidth={0.9} />
      <line x1="36" y1="24" x2="38.5" y2="24" {...stroke} strokeWidth={0.9} />
    </Frame>
  ),
  lantern: (
    <Frame>
      <path d="M19 16h10l2.5 4v12.5H16.5V20z" {...stroke} />
      <path d="M21 16V13h6v3" {...stroke} />
      <path d="M22.5 24.5c0-2 1.5-3.5 1.5-3.5s1.5 1.5 1.5 3.5c0 1.3-3 1.3-3 0z" {...stroke} strokeWidth={0.9} />
      <line x1="18" y1="36" x2="30" y2="36" {...stroke} strokeWidth={0.9} />
    </Frame>
  ),
  folio: (
    <Frame>
      <rect x="13" y="14" width="18" height="22" {...stroke} />
      <path d="M17 14V12h18v22h-2" {...stroke} />
      <line x1="17" y1="20" x2="27" y2="20" {...stroke} strokeWidth={0.9} />
      <line x1="17" y1="24.5" x2="27" y2="24.5" {...stroke} strokeWidth={0.9} />
      <line x1="17" y1="29" x2="24" y2="29" {...stroke} strokeWidth={0.9} />
    </Frame>
  ),
  anchor: (
    <Frame>
      <circle cx="24" cy="15" r="2.6" {...stroke} />
      <line x1="24" y1="17.6" x2="24" y2="33" {...stroke} />
      <line x1="18" y1="21.5" x2="30" y2="21.5" {...stroke} strokeWidth={0.9} />
      <path d="M15 28.5c1.5 5 4.8 7.5 9 7.5s7.5-2.5 9-7.5" {...stroke} />
    </Frame>
  ),
  orbit: (
    <Frame>
      <ellipse cx="24" cy="24" rx="14" ry="7.5" transform="rotate(-28 24 24)" {...stroke} />
      <ellipse cx="24" cy="24" rx="14" ry="7.5" transform="rotate(32 24 24)" {...stroke} />
      <circle cx="24" cy="24" r="2" fill="currentColor" stroke="none" />
    </Frame>
  ),
  key: (
    <Frame>
      <circle cx="19" cy="20" r="5.2" {...stroke} />
      <circle cx="19" cy="20" r="1.6" fill="currentColor" stroke="none" />
      <path d="M23.6 22.6 L34 33.2 31.2 36 28.6 33.4 27.2 34.8 25.6 33.2 27 31.8 23.6 28.4" {...stroke} />
    </Frame>
  ),
  leaf: (
    <Frame>
      <path d="M24 12.5c8 6 12 13.5 9.5 22-6.5 1.8-14.5-3.2-17.5-11.5C14.5 17 19 13.5 24 12.5z" {...stroke} />
      <path d="M24 12.5c-1.2 8-1 16.5 1.2 22" {...stroke} strokeWidth={0.9} />
      <path d="M21 20.5c2.2 0.8 4.4 1 6.6.4M19.8 25.5c2.4 1 5 1.2 7.4.3" {...stroke} strokeWidth={0.85} />
    </Frame>
  ),
  column: (
    <Frame>
      <path d="M15 14h18l-1.5 3H16.5z" {...stroke} />
      <path d="M16.5 17h15v16h-15z" {...stroke} />
      <line x1="21" y1="17" x2="21" y2="33" {...stroke} strokeWidth={0.9} />
      <line x1="27" y1="17" x2="27" y2="33" {...stroke} strokeWidth={0.9} />
      <path d="M14.5 33h19v3h-19z" {...stroke} />
    </Frame>
  ),
  wave: (
    <Frame>
      <path d="M12 20.5c3.5-4 7.5-4 10.5 0s7 4 11 0" {...stroke} />
      <path d="M12 26c3.5-4 7.5-4 10.5 0s7 4 11 0" {...stroke} />
      <path d="M12 31.5c3.5-4 7.5-4 10.5 0s7 4 11 0" {...stroke} />
    </Frame>
  ),
  aster: (
    <Frame>
      <path d="M24 11.5 L25.6 21.2 34.8 17.2 27.4 24 34.8 30.8 25.6 26.8 24 36.5 22.4 26.8 13.2 30.8 20.6 24 13.2 17.2 22.4 21.2 Z" {...stroke} />
      <circle cx="24" cy="24" r="1.8" fill="currentColor" stroke="none" />
    </Frame>
  ),
  crest: (
    <Frame>
      <path d="M14 16.5 L18 13.5 24 16 30 13.5 34 16.5 32.5 21.5 H15.5 Z" {...stroke} />
      <path d="M17 21.5 L17 29.5 24 33.5 31 29.5 31 21.5" {...stroke} />
      <line x1="24" y1="16" x2="24" y2="33.5" {...stroke} strokeWidth={0.9} />
      <circle cx="24" cy="13.2" r="1.35" fill="currentColor" stroke="none" />
    </Frame>
  ),
};

export function PersonaPortrait({
  portraitId,
  name,
  className,
  title,
}: {
  portraitId?: string | null;
  name?: string | null;
  className?: string;
  title?: string;
}) {
  const def = portraitById(portraitId);
  const label = title ?? (def ? `${def.zh} / ${def.en}` : `${AI_DIVISION.monogram.zh} / ${AI_DIVISION.monogram.en}`);
  return (
    <span className={className ? `persona-portrait ${className}` : "persona-portrait"} title={label}>
      {def ? MARKS[def.id] : <span className="persona-monogram">{monogramFor(name)}</span>}
    </span>
  );
}

export function PortraitPicker({
  value,
  name,
  onChange,
}: {
  value?: string | null;
  name?: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <fieldset className="portrait-picker">
      <legend>
        <ArchiveText zh={AI_DIVISION.portrait.zh} en={AI_DIVISION.portrait.en} />
      </legend>
      <div className="portrait-picker-row" role="radiogroup" aria-label={AI_DIVISION.portrait.zh}>
        <button
          type="button"
          className={`portrait-pick ${value ? "" : "is-selected"}`.trim()}
          aria-pressed={!value}
          title={`${AI_DIVISION.monogram.zh} / ${AI_DIVISION.monogram.en}`}
          onClick={() => onChange(null)}
        >
          <PersonaPortrait name={name} />
        </button>
        {PERSONA_PORTRAITS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`portrait-pick ${value === item.id ? "is-selected" : ""}`.trim()}
            aria-pressed={value === item.id}
            title={`${item.zh} / ${item.en}`}
            onClick={() => onChange(item.id)}
          >
            <PersonaPortrait portraitId={item.id} name={name} title={`${item.zh} / ${item.en}`} />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
