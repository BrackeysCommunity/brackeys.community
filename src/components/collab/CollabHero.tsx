/**
 * "FIND YOUR CREW." headline + description. Pure typography — no
 * status bar or breadcrumb chrome (the rest of the page already
 * communicates state through its own surfaces).
 */
export function CollabHero() {
  return (
    <div className="flex flex-col">
      <h1 className="font-mono text-[clamp(2.5rem,5.5vw,7rem)] leading-[0.85] font-bold tracking-tighter text-foreground">
        FIND YOUR
        <br />
        <span className="text-transparent transition-colors duration-300 [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary">
          CREW.
        </span>
      </h1>
      <p className="mt-6 max-w-xl font-sans text-base text-muted-foreground lg:text-lg">
        Open roles, hobby crews, playtests, and mentors. Pinned, vetted, and updated every minute.
      </p>
    </div>
  );
}
