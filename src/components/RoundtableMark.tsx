/** Original archival table mark. Not official character art. */
export function RoundtableMark({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `roundtable-mark ${className}` : "roundtable-mark"}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="5.15" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle
        cx="12"
        cy="12"
        r="2.15"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.8"
        opacity="0.5"
      />
      <circle cx="12" cy="3.55" r="1.2" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="19.35" cy="8.15" r="1.2" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="16.85" cy="17.85" r="1.2" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="7.15" cy="17.85" r="1.2" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="4.65" cy="8.15" r="1.2" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
