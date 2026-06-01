/**
 * Plans-style header used by every Messages screen.
 * Same big display title + pen-tennis highlighter band as the Plans tab.
 */
export function MessagesHeader({ subtitle }: { subtitle?: string }) {
  return (
    <>
      <p className="font-display text-[40px] font-black leading-[1.08] tracking-tight text-text-primary">
        <span
          className="px-[0.15em]"
          style={{
            backgroundImage:
              "linear-gradient(to bottom, transparent 55%, color-mix(in oklab, var(--pen-tennis) 70%, transparent) 55%, color-mix(in oklab, var(--pen-tennis) 70%, transparent) 92%, transparent 92%)",
          }}
        >
          Messages
        </span>
      </p>
      {subtitle ? (
        <p className="mt-2 font-hand text-xl text-text-secondary">{subtitle}</p>
      ) : null}
    </>
  );
}
