"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

type Room = {
  id: string;
  code: string;
  status: string;
  game_mode: string | null;
};

type Player = {
  id: string;
  name: string;
  is_host: boolean;
  connected: boolean;
  score: number;
};

export default function RoomPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();

  const roomCode = decodeURIComponent(params.code).toUpperCase();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayerId, setCurrentPlayerId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const loadPlayers = useCallback(async (roomId: string) => {
    const { data, error: playersError } = await supabase
      .from("players")
      .select("id, name, is_host, connected, score")
      .eq("room_id", roomId)
      .eq("connected", true)
      .order("joined_at", { ascending: true });

    if (playersError) {
      throw playersError;
    }

    setPlayers(data ?? []);
  }, []);

  useEffect(() => {
    const savedPlayer = localStorage.getItem("sq-player");

    if (savedPlayer) {
      try {
        const parsedPlayer = JSON.parse(savedPlayer);

        if (parsedPlayer.roomCode === roomCode) {
          setCurrentPlayerId(parsedPlayer.playerId);
        }
      } catch {
        localStorage.removeItem("sq-player");
      }
    }

    async function loadRoom() {
      setLoading(true);
      setError("");

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, code, status, game_mode")
        .eq("code", roomCode)
        .single();

      if (roomError || !roomData) {
        setError("That room doesn't exist. Questionable code?");
        setLoading(false);
        return;
      }

      setRoom(roomData);

      try {
        await loadPlayers(roomData.id);
      } catch (caughtError) {
        console.error("Failed to load players:", caughtError);
        setError("We found the room, but lost the people. Impressive.");
      }

      setLoading(false);
    }

    void loadRoom();
  }, [roomCode, loadPlayers]);

  /*
   * PLAYER REALTIME
   *
   * Keeps the player list synchronized when somebody joins,
   * leaves, or changes.
   */
  useEffect(() => {
    if (!room) {
      return;
    }

    const roomId = room.id;

    const channel = supabase
      .channel(`room-${roomId}-players`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          void loadPlayers(roomId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room?.id, loadPlayers]);

  /*
   * ROOM REALTIME
   *
   * Keeps every player's copy of the room synchronized when
   * the host changes the game state.
   */
  useEffect(() => {
    if (!room) {
      return;
    }

    const roomId = room.id;

    const channel = supabase
      .channel(`room-${roomId}-state`)
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

          /*
           * Once Questionable Answers is selected, every player follows
           * the shared room through theme selection and setup.
           */
          if (
            updatedRoom.status === "choosing-theme" &&
            updatedRoom.game_mode === "questionable-answers"
          ) {
            router.push(`/room/${updatedRoom.code}/themes`);
            return;
          }

          if (
            updatedRoom.status === "setup" &&
            updatedRoom.game_mode === "questionable-answers"
          ) {
            router.push(`/room/${updatedRoom.code}/setup`);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room?.id, router]);

  const currentPlayer = players.find((player) => player.id === currentPlayerId);

  const isHost = currentPlayer?.is_host ?? false;

  async function handleCopyRoomCode() {
    if (!room) {
      return;
    }

    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch (caughtError) {
      console.error("Failed to copy room code:", caughtError);
    }
  }

  async function handleStartChaos() {
    if (!room || !isHost || players.length < 2) {
      return;
    }

    const { error: updateError } = await supabase
      .from("rooms")
      .update({
        status: "choosing-mode",
        game_mode: null,
      })
      .eq("id", room.id);

    if (updateError) {
      console.error("Failed to enter mode selection:", updateError);
      return;
    }

    router.push(`/room/${room.code}/modes`);
  }

  /*
   * LOADING
   */
  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Gathering questionable people...
        </p>
      </main>
    );
  }

  /*
   * ROOM ERROR
   */
  if (error || !room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <div className="w-full max-w-md text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--danger)]">
            Well, that&apos;s awkward.
          </p>

          <h1 className="mt-5 text-5xl font-black tracking-[-0.06em]">
            ROOM NOT FOUND
          </h1>

          <p className="mt-5 text-lg text-[var(--muted)]">
            {error || "We couldn't find that room."}
          </p>

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

  /*
   * NON-HOST WAITING SCREEN
   *
   * When the host begins choosing a game mode, everyone else
   * automatically sees this screen.
   */
  if (room.status === "choosing-mode" && !isHost) {
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
          <header className="flex items-center justify-end">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
              SQ
            </div>
          </header>

          {/* Waiting message */}
          <div className="flex flex-1 flex-col justify-center">
            <p className="text-sm font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
              This seems like a terrible idea.
            </p>

            <h1 className="mt-5 text-[2.5rem] font-black leading-[0.86] tracking-[-0.07em] sm:text-[3.5rem]">
              THE HOST
              <br />
              IS MAKING
              <br />
              QUESTIONABLE
              <br />
              DECISIONS.
            </h1>

            <p className="mt-7 max-w-sm text-lg leading-7 text-[var(--muted)]">
              Choosing what you&apos;re about to regret...
            </p>

            <div className="mt-10 flex items-center gap-3">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />

              <span className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                Waiting for the host
              </span>
            </div>
          </div>

          {/* Room */}
          <div className="pb-4 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              Room {room.code}
            </p>
          </div>
        </section>
      </main>
    );
  }

  /*
   * NORMAL GAME LOBBY
   */
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
            aria-label="Leave room"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-xl font-bold text-[var(--foreground)] transition hover:bg-[var(--surface)]"
          >
            ←
          </Link>

          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
            SQ
          </div>
        </header>

        {/* Room info */}
        <div className="pt-14">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            The questionable are gathering.
          </p>

          <h1 className="mt-4 text-5xl font-black leading-none tracking-[-0.06em]">
            GAME
            <br />
            LOBBY
          </h1>

          <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              Room code
            </p>

            <div className="mt-2 flex items-center justify-between gap-4">
              <p className="text-4xl font-black tracking-[0.08em] text-[var(--accent)]">
                {room.code}
              </p>

              <button
                type="button"
                onClick={() => void handleCopyRoomCode()}
                className="shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-hover)] px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-[var(--foreground)] transition hover:border-[var(--accent)]"
                aria-label={`Copy room code ${room.code}`}
              >
                {copied ? "✓ COPIED" : "COPY"}
              </button>
            </div>

            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              Give this code to your friends. Assuming you still want them here.
            </p>
          </div>
        </div>

        {/* Players */}
        <div className="flex-1 py-8">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                Questionable people
              </p>

              <h2 className="mt-1 text-2xl font-black">
                {players.length} {players.length === 1 ? "PLAYER" : "PLAYERS"}
              </h2>
            </div>

            <span className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
              Live
            </span>
          </div>

          <div className="space-y-3">
            {players.map((player) => (
              <div
                key={player.id}
                className="flex min-h-16 items-center justify-between rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-5"
              >
                <div>
                  <p className="text-lg font-black">
                    {player.name}
                    {player.id === currentPlayerId ? " (YOU)" : ""}
                  </p>

                  <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                    {player.is_host
                      ? "Host · Questionable authority"
                      : "Player"}
                  </p>
                </div>

                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-hover)] text-sm font-black uppercase">
                  {player.name.charAt(0)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Host controls */}
        <div className="pb-4">
          {isHost ? (
            <>
              <button
                type="button"
                disabled={players.length < 2}
                onClick={() => void handleStartChaos()}
                className="flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
              >
                <span>START THE CHAOS</span>
                <span aria-hidden="true">→</span>
              </button>

              {players.length < 2 ? (
                <p className="mt-3 text-center text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Apparently this game requires friends.
                </p>
              ) : null}
            </>
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                Waiting for the host to make another bad decision...
              </p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
