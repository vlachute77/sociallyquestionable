"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

type Room = {
  id: string;
  code: string;
  status: string;
  game_mode: string | null;
};

type SavedPlayer = {
  playerId: string;
  roomCode: string;
};

const gameModes = [
  {
    id: "questionable-answers",
    number: "01",
    title: "QUESTIONABLE ANSWERS",
    description:
      "Complete ridiculous prompts with the funniest, worst, or most inappropriate answer in your hand.",
    players: "3+ players",
    status: "READY",
  },
  {
    id: "most-likely",
    number: "02",
    title: "MOST LIKELY TO",
    description:
      "Vote for the friend most likely to fit the accusation. Then find out what everyone really thinks.",
    players: "3+ players",
    status: "READY",
  },
  {
    id: "hot-seat",
    number: "03",
    title: "HOT SEAT",
    description:
      "One questionable person takes center stage while everyone else answers questions about them.",
    players: "3+ players",
    status: "COMING SOON",
  },
  {
    id: "would-you-rather",
    number: "04",
    title: "WOULD YOU RATHER?",
    description:
      "Choose between two terrible options and discover which friends are somehow worse than you.",
    players: "2+ players",
    status: "COMING SOON",
  },
  {
    id: "truth-or-bs",
    number: "05",
    title: "TRUTH OR BS",
    description:
      "Separate suspicious truths from convincing nonsense before your friends fool you.",
    players: "3+ players",
    status: "COMING SOON",
  },
];

export default function GameModesPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();

  const roomCode = decodeURIComponent(params.code).toUpperCase();

  const [room, setRoom] = useState<Room | null>(null);
  const [isHost, setIsHost] = useState(false);

  const [loading, setLoading] = useState(true);
  const [selectingMode, setSelectingMode] = useState<string | null>(null);
  const [error, setError] = useState("");

  /*
   * LOAD ROOM + VERIFY HOST
   */
  useEffect(() => {
    async function loadPage() {
      setLoading(true);
      setError("");

      const savedPlayerRaw = localStorage.getItem("sq-player");

      if (!savedPlayerRaw) {
        router.replace(`/room/${roomCode}`);
        return;
      }

      let savedPlayer: SavedPlayer;

      try {
        savedPlayer = JSON.parse(savedPlayerRaw) as SavedPlayer;
      } catch {
        localStorage.removeItem("sq-player");
        router.replace(`/room/${roomCode}`);
        return;
      }

      if (savedPlayer.roomCode !== roomCode) {
        router.replace(`/room/${roomCode}`);
        return;
      }

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, code, status, game_mode")
        .eq("code", roomCode)
        .single();

      if (roomError || !roomData) {
        setError("We couldn't find this questionable gathering.");
        setLoading(false);
        return;
      }

      setRoom(roomData);

      const { data: playerData, error: playerError } = await supabase
        .from("players")
        .select("id, is_host")
        .eq("id", savedPlayer.playerId)
        .eq("room_id", roomData.id)
        .single();

      if (playerError || !playerData) {
        router.replace(`/room/${roomCode}`);
        return;
      }

      if (!playerData.is_host) {
        router.replace(`/room/${roomCode}`);
        return;
      }

      setIsHost(true);
      setLoading(false);
    }

    void loadPage();
  }, [roomCode, router]);

  /*
   * SELECT GAME MODE
   */
  async function handleSelectMode(modeId: string) {
    if (!room || !isHost || selectingMode) {
      return;
    }

    setSelectingMode(modeId);
    setError("");

    const { error: updateError } = await supabase
      .from("rooms")
      .update({
        game_mode: modeId,
        status: "choosing-theme",
      })
      .eq("id", room.id);

    if (updateError) {
      console.error("Failed to select game mode:", updateError);
      setError("That choice was apparently too questionable. Try again.");
      setSelectingMode(null);
      return;
    }

    router.push(`/room/${room.code}/themes`);
  }

  /*
   * RETURN TO LOBBY
   *
   * Because entering mode selection changed the shared room state,
   * going back should also restore the shared state.
   */
  async function handleBackToLobby() {
    if (!room || !isHost || selectingMode) {
      return;
    }

    const { error: updateError } = await supabase
      .from("rooms")
      .update({
        status: "lobby",
        game_mode: null,
      })
      .eq("id", room.id);

    if (updateError) {
      console.error("Failed to return to lobby:", updateError);
      setError("We couldn't get everyone back to the lobby.");
      return;
    }

    router.push(`/room/${room.code}`);
  }

  /*
   * LOADING
   */
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Preparing bad decisions...
        </p>
      </main>
    );
  }

  /*
   * ROOM ERROR
   */
  if (error && !room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <div className="w-full max-w-md text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--danger)]">
            Well, that&apos;s awkward.
          </p>

          <h1 className="mt-5 text-5xl font-black tracking-[-0.06em]">
            SOMETHING
            <br />
            WENT WRONG.
          </h1>

          <p className="mt-5 text-lg text-[var(--muted)]">{error}</p>

          <Link
            href="/"
            className="mt-8 flex min-h-16 w-full items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)]"
          >
            BACK HOME
          </Link>
        </div>
      </main>
    );
  }

  if (!room || !isHost) {
    return null;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--background)]">
      {/* Decorative background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--accent)] opacity-[0.08] blur-3xl"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-[var(--danger)] opacity-[0.07] blur-3xl"
      />

      <section className="relative mx-auto w-full max-w-md px-6 py-8 sm:px-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => void handleBackToLobby()}
            disabled={selectingMode !== null}
            aria-label="Back to lobby"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-xl font-bold text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ←
          </button>

          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              {roomCode}
            </span>

            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
              SQ
            </div>
          </div>
        </header>

        {/* Intro */}
        <div className="pb-8 pt-14">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            Pick your particular brand of chaos.
          </p>

          <h1 className="mt-4 text-[clamp(3rem,14vw,4.75rem)] font-black leading-[0.86] tracking-[-0.07em]">
            CHOOSE
            <br />
            YOUR
            <br />
            POISON.
          </h1>

          <p className="mt-7 text-lg leading-7 text-[var(--muted)]">
            Different ways to discover things about your friends you probably
            didn&apos;t need to know.
          </p>

          {error ? (
            <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--surface)] p-4">
              <p className="text-sm font-bold text-[var(--danger)]">{error}</p>
            </div>
          ) : null}
        </div>

        {/* Modes */}
        <div className="space-y-4 pb-10">
          {gameModes.map((mode) => {
            const available = mode.status === "READY";
            const isSelecting = selectingMode === mode.id;
            const anotherModeSelecting =
              selectingMode !== null && selectingMode !== mode.id;

            return (
              <button
                key={mode.id}
                type="button"
                disabled={!available || isSelecting || anotherModeSelecting}
                onClick={() => {
                  if (available) {
                    void handleSelectMode(mode.id);
                  }
                }}
                className={`group w-full rounded-[var(--radius-md)] border p-5 text-left transition ${
                  available
                    ? "border-[var(--accent)] bg-[var(--surface)] hover:scale-[1.01] active:scale-[0.99] disabled:hover:scale-100"
                    : "cursor-not-allowed border-[var(--border)] bg-[var(--surface)] opacity-50"
                } ${anotherModeSelecting ? "opacity-40" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <span
                    className={`text-xs font-black tracking-[0.16em] ${
                      available ? "text-[var(--accent)]" : "text-[var(--muted)]"
                    }`}
                  >
                    {mode.number}
                  </span>

                  <span
                    className={`rounded-full px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.12em] ${
                      available
                        ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                        : "bg-[var(--surface-hover)] text-[var(--muted)]"
                    }`}
                  >
                    {isSelecting ? "SELECTING..." : mode.status}
                  </span>
                </div>

                <h2 className="mt-5 text-2xl font-black leading-none tracking-[-0.04em]">
                  {mode.title}
                </h2>

                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  {mode.description}
                </p>

                <div className="mt-5 flex items-center justify-between border-t border-[var(--border)] pt-4">
                  <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    {mode.players}
                  </span>

                  {available ? (
                    <span className="text-lg font-black text-[var(--accent)]">
                      →
                    </span>
                  ) : (
                    <span className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                      Later
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
