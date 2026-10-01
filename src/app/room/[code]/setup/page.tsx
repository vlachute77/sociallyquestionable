"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

type Room = {
  id: string;
  code: string;
  status: string;
  game_mode: string | null;
  winning_score: number;
  content_level: string;
};

type Player = {
  id: string;
  name: string;
  is_host: boolean;
};

type SavedPlayer = {
  playerId: string;
  roomCode: string;
};

const winningScores = [5, 7, 10];

const contentLevels = [
  {
    id: "mild",
    label: "MILD",
    description: "Funny without getting anybody disowned.",
  },
  {
    id: "spicy",
    label: "SPICY",
    description: "A little wrong. Probably the sweet spot.",
  },
  {
    id: "unhinged",
    label: "UNHINGED",
    description: "Good luck looking your friends in the eye tomorrow.",
  },
];

export default function SetupPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();

  const roomCode = decodeURIComponent(params.code).toUpperCase();

  const [room, setRoom] = useState<Room | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadSetup = useCallback(async () => {
    setLoading(true);
    setError("");

    const savedPlayerRaw = localStorage.getItem("sq-player");

    if (!savedPlayerRaw) {
      router.replace("/");
      return;
    }

    let savedPlayer: SavedPlayer;

    try {
      savedPlayer = JSON.parse(savedPlayerRaw) as SavedPlayer;
    } catch {
      localStorage.removeItem("sq-player");
      router.replace("/");
      return;
    }

    if (savedPlayer.roomCode !== roomCode) {
      router.replace("/");
      return;
    }

    const { data: roomData, error: roomError } = await supabase
      .from("rooms")
      .select("id, code, status, game_mode, winning_score, content_level")
      .eq("code", roomCode)
      .single();

    if (roomError || !roomData) {
      setError("We couldn't find this questionable gathering.");
      setLoading(false);
      return;
    }

    if (roomData.game_mode !== "questionable-answers") {
      router.replace(`/room/${roomCode}`);
      return;
    }

    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .select("id, name, is_host")
      .eq("id", savedPlayer.playerId)
      .eq("room_id", roomData.id)
      .single();

    if (playerError || !playerData) {
      router.replace(`/room/${roomCode}`);
      return;
    }

    setRoom(roomData);
    setCurrentPlayer(playerData);
    setLoading(false);
  }, [roomCode, router]);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  /*
   * ROOM REALTIME
   *
   * Everyone sees setup changes immediately.
   */
  useEffect(() => {
    if (!room) {
      return;
    }

    const roomId = room.id;

    const channel = supabase
      .channel(`room-${roomId}-setup`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          const updatedRoom = payload.new as Room;

          setRoom(updatedRoom);

          if (updatedRoom.status === "playing") {
            router.push(`/room/${updatedRoom.code}/play`);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room?.id, router]);

  async function updateWinningScore(score: number) {
    if (!room || !currentPlayer?.is_host || saving) {
      return;
    }

    setSaving(true);
    setError("");

    const { error: updateError } = await supabase
      .from("rooms")
      .update({
        winning_score: score,
      })
      .eq("id", room.id);

    if (updateError) {
      console.error("Failed to update winning score:", updateError);
      setError("We couldn't save that winning score.");
    }

    setSaving(false);
  }

  async function updateContentLevel(level: string) {
    if (!room || !currentPlayer?.is_host || saving) {
      return;
    }

    setSaving(true);
    setError("");

    const { error: updateError } = await supabase
      .from("rooms")
      .update({
        content_level: level,
      })
      .eq("id", room.id);

    if (updateError) {
      console.error("Failed to update content level:", updateError);
      setError("We couldn't save that content level.");
    }

    setSaving(false);
  }

  async function handleStartGame() {
    if (!room || !currentPlayer?.is_host || saving) {
      return;
    }

    setSaving(true);
    setError("");

    const { error: startError } = await supabase.rpc(
      "start_questionable_answers_game",
      {
        p_room_id: room.id,
        p_host_id: currentPlayer.id,
      },
    );

    if (startError) {
      console.error("Failed to start game:", startError);
      setError(startError.message || "The chaos refused to start. Try again.");
      setSaving(false);
      return;
    }

    router.push(`/room/${room.code}/play`);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Preparing the chaos...
        </p>
      </main>
    );
  }

  if (error && !room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <div className="w-full max-w-md text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--danger)]">
            Well, that&apos;s awkward.
          </p>

          <h1 className="mt-5 text-5xl font-black tracking-[-0.06em]">
            SETUP
            <br />
            FAILED.
          </h1>

          <p className="mt-5 text-lg text-[var(--muted)]">{error}</p>
        </div>
      </main>
    );
  }

  if (!room || !currentPlayer) {
    return null;
  }

  const isHost = currentPlayer.is_host;

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

      <section className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-8 sm:px-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              {room.code}
            </p>
          </div>

          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
            SQ
          </div>
        </header>

        {/* Intro */}
        <div className="pt-14">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            Questionable Answers
          </p>

          <h1 className="mt-4 text-[clamp(3rem,14vw,4.75rem)] font-black leading-[0.86] tracking-[-0.07em]">
            SET THE
            <br />
            BAD
            <br />
            EXAMPLE.
          </h1>

          <p className="mt-7 text-lg leading-7 text-[var(--muted)]">
            {isHost
              ? "Set the rules. Your friends have already made the mistake of trusting you."
              : `${currentPlayer.name}, the host is deciding how questionable this gets.`}
          </p>
        </div>

        {/* Winning score */}
        <div className="mt-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            First to
          </p>

          <h2 className="mt-2 text-2xl font-black">WINNING SCORE</h2>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {winningScores.map((score) => {
              const selected = room.winning_score === score;

              return (
                <button
                  key={score}
                  type="button"
                  disabled={!isHost || saving}
                  onClick={() => void updateWinningScore(score)}
                  className={`min-h-16 rounded-[var(--radius-md)] border text-2xl font-black transition ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]"
                  } ${
                    isHost
                      ? "hover:scale-[1.02] active:scale-[0.98]"
                      : "cursor-default"
                  }`}
                >
                  {score}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content level */}
        <div className="mt-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
            How bad are we making this?
          </p>

          <h2 className="mt-2 text-2xl font-black">CONTENT LEVEL</h2>

          <div className="mt-4 space-y-3">
            {contentLevels.map((level) => {
              const selected = room.content_level === level.id;

              return (
                <button
                  key={level.id}
                  type="button"
                  disabled={!isHost || saving}
                  onClick={() => void updateContentLevel(level.id)}
                  className={`w-full rounded-[var(--radius-md)] border p-5 text-left transition ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--surface)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  } ${
                    isHost
                      ? "hover:scale-[1.01] active:scale-[0.99]"
                      : "cursor-default"
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p
                        className={`text-lg font-black ${
                          selected ? "text-[var(--accent)]" : ""
                        }`}
                      >
                        {level.label}
                      </p>

                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {level.description}
                      </p>
                    </div>

                    <div
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent)]"
                          : "border-[var(--border)]"
                      }`}
                    >
                      {selected ? (
                        <span className="text-xs font-black text-[var(--accent-foreground)]">
                          ✓
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Error */}
        {error ? (
          <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--surface)] p-4">
            <p className="text-sm font-bold text-[var(--danger)]">{error}</p>
          </div>
        ) : null}

        {/* Bottom controls */}
        <div className="mt-auto pb-4 pt-10">
          {isHost ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleStartGame()}
              className="flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>{saving ? "HOLD ON..." : "START GAME"}</span>
              <span aria-hidden="true">→</span>
            </button>
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
              <div className="flex items-center justify-center gap-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />

                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  Waiting for the host to start
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
