"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { generateRoomCode } from "@/lib/room-code";
import { supabase } from "@/lib/supabase";

export default function HostPage() {
  const router = useRouter();

  const [hostName, setHostName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedName = hostName.trim();

    if (!trimmedName) {
      setError("We need a name before we can blame you for anything.");
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      let roomId: string | null = null;
      let roomCode: string | null = null;

      /*
       * Room codes are unique in the database.
       * If we somehow generate one that's already in use,
       * try again a few times.
       */
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidateCode = generateRoomCode();

        const { data: room, error: roomError } = await supabase
          .from("rooms")
          .insert({
            code: candidateCode,
            status: "lobby",
          })
          .select("id, code")
          .single();

        if (!roomError && room) {
          roomId = room.id;
          roomCode = room.code;
          break;
        }

        if (roomError?.code !== "23505") {
          throw roomError;
        }
      }

      if (!roomId || !roomCode) {
        throw new Error("Could not generate a unique room code.");
      }

      const { data: player, error: playerError } = await supabase
        .from("players")
        .insert({
          room_id: roomId,
          name: trimmedName,
          is_host: true,
          connected: true,
          score: 0,
        })
        .select("id")
        .single();

      if (playerError || !player) {
        /*
         * Don't leave an empty room behind if creating
         * the host player fails.
         */
        await supabase.from("rooms").delete().eq("id", roomId);

        throw playerError ?? new Error("Could not create host player.");
      }

      localStorage.setItem(
        "sq-player",
        JSON.stringify({
          playerId: player.id,
          roomId,
          roomCode,
          name: trimmedName,
          isHost: true,
        }),
      );

      router.push(`/room/${roomCode}`);
    } catch (caughtError) {
      console.error("Failed to create room:", caughtError);

      setError("Something went sideways while creating the room. Try again.");

      setIsCreating(false);
    }
  }

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
        {/* Header */}
        <header className="flex items-center justify-between">
          <Link
            href="/"
            aria-label="Go back"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-xl font-bold text-[var(--foreground)] transition hover:bg-[var(--surface)]"
          >
            ←
          </Link>

          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black tracking-[-0.08em] text-[var(--accent-foreground)]">
            SQ
          </div>
        </header>

        {/* Content */}
        <div className="flex flex-1 flex-col justify-center py-12">
          <p className="mb-5 text-sm font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            You&apos;re in charge.
          </p>

          <h1 className="text-[clamp(3rem,14vw,4.75rem)] font-black leading-[0.88] tracking-[-0.07em]">
            LET&apos;S MAKE
            <br />
            SOME BAD
            <br />
            DECISIONS.
          </h1>

          <p className="mt-7 text-lg leading-7 text-[var(--muted)]">
            First things first. What should your questionable friends call you?
          </p>

          <form className="mt-10" onSubmit={handleCreateRoom}>
            <label
              htmlFor="host-name"
              className="mb-3 block text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]"
            >
              Your name
            </label>

            <input
              id="host-name"
              name="hostName"
              type="text"
              autoComplete="nickname"
              maxLength={24}
              placeholder="Enter your name"
              value={hostName}
              onChange={(event) => setHostName(event.target.value)}
              disabled={isCreating}
              className="h-16 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-5 text-lg font-bold text-[var(--foreground)] outline-none transition placeholder:font-medium placeholder:text-[var(--muted)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            />

            {error ? (
              <p
                role="alert"
                className="mt-3 text-sm font-bold leading-5 text-[var(--danger)]"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isCreating}
              className="mt-4 flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
            >
              <span>{isCreating ? "CREATING ROOM..." : "CREATE ROOM"}</span>
              <span aria-hidden="true">{isCreating ? "…" : "→"}</span>
            </button>
          </form>
        </div>

        <p className="pb-4 text-center text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
          With great power comes questionable decisions.
        </p>
      </section>
    </main>
  );
}
