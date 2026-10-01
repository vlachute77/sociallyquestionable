import Link from "next/link";

export default function Home() {
  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[var(--background)]">
      {/* Decorative background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--accent)] opacity-[0.08] blur-3xl"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-[var(--danger)] opacity-[0.07] blur-3xl"
      />

      <section className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-8 sm:px-8">
        {/* Brand */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black tracking-[-0.08em] text-[var(--accent-foreground)]">
              SQ
            </div>

            <span className="text-sm font-bold uppercase tracking-[0.16em]">
              Socially Questionable
            </span>
          </div>

          <button
            type="button"
            aria-label="Open menu"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-xl text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          >
            •••
          </button>
        </header>

        {/* Hero */}
        <div className="flex flex-1 flex-col justify-center py-14">
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            Your friends seemed normal.
          </p>

          <h1 className="max-w-sm text-[clamp(3.5rem,16vw,5.5rem)] font-black leading-[0.84] tracking-[-0.075em]">
            LET&apos;S
            <br />
            FIX
            <br />
            THAT.
          </h1>

          <p className="mt-7 max-w-sm text-lg leading-7 text-[var(--muted)]">
            The party game that turns good friends into questionable people.
          </p>
        </div>

        {/* Actions */}
        <div className="space-y-3 pb-4">
          <Link
            href="/host"
            className="flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99]"
          >
            <span>HOST A GAME</span>
            <span aria-hidden="true">→</span>
          </Link>

          <Link
            href="/join"
            className="flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-6 text-lg font-black transition hover:bg-[var(--surface-hover)] active:scale-[0.99]"
          >
            <span>JOIN A GAME</span>
            <span aria-hidden="true">#</span>
          </Link>

          <p className="pt-3 text-center text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
            Good friends. Questionable behavior.
          </p>
        </div>
      </section>
    </main>
  );
}
