"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabase";

type Room = {
  id: string;
  code: string;
  status: string;
  game_mode: string | null;
};

export default function JoinPage() {
  const router = useRouter();

  const [roomCode, setRoomCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState("");

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedCode = roomCode.trim().toUpperCase();
    const trimmedName = playerName.trim();

    if (!normalizedCode) {
      setError("We need a room code. Telepathy isn't ready yet.");
      return;
    }

    if (!trimmedName) {
      setError("Tell us who you are before making questionable decisions.");
      return;
    }

    setIsJoining(true);
    setError("");

    try {
      /*
       * FIND ROOM
       */
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, code, status, game_mode")
        .eq("code", normalizedCode)
        .single();

      if (roomError || !roomData) {
        setError("That room doesn't exist. Check the code and try again.");
        setIsJoining(false);
        return;
      }

      const room = roomData as Room;

      /*
       * BLOCK DUPLICATE CONNECTED NAMES
       *
       * Disconnected players are intentionally allowed through during an
       * active Questionable Answers game so the rejoin RPC can restore them.
       */
      const { data: connectedPlayers, error: connectedPlayersError } =
        await supabase
          .from("players")
          .select("id, name")
          .eq("room_id", room.id)
          .eq("connected", true);

      if (connectedPlayersError) {
        throw connectedPlayersError;
      }

      const duplicateConnectedName = (connectedPlayers ?? []).some(
        (player) =>
          player.name.trim().toLocaleLowerCase() ===
          trimmedName.toLocaleLowerCase(),
      );

      if (duplicateConnectedName) {
        setError("That name is already taken. Try another one.");
        setIsJoining(false);
        return;
      }

      /*
       * LOBBY
       *
       * Normal join behavior.
       */
      if (room.status === "lobby") {
        const { data: player, error: playerError } = await supabase
          .from("players")
          .insert({
            room_id: room.id,
            name: trimmedName,
            is_host: false,
            connected: true,
            score: 0,
          })
          .select("id")
          .single();

        if (playerError || !player) {
          throw playerError ?? new Error("Could not create player.");
        }

        localStorage.setItem(
          "sq-player",
          JSON.stringify({
            playerId: player.id,
            roomId: room.id,
            roomCode: room.code,
            name: trimmedName,
            isHost: false,
          }),
        );

        router.push(`/room/${room.code}`);
        return;
      }

      /*
       * ACTIVE QUESTIONABLE ANSWERS GAME
       *
       * The RPC will either:
       *
       * - reconnect a disconnected player with this name, or
       * - create a new late-joining player.
       *
       * It also makes sure the player has a full hand.
       */
      if (
        room.status === "playing" &&
        room.game_mode === "questionable-answers"
      ) {
        const { data: playerId, error: rejoinError } = await supabase.rpc(
          "rejoin_questionable_answers_game",
          {
            p_room_id: room.id,
            p_player_name: trimmedName,
          },
        );

        if (rejoinError || !playerId) {
          setError(
            rejoinError?.message ||
              "We couldn't get you back into the questionable decisions.",
          );

          setIsJoining(false);
          return;
        }

        /*
         * Read the player back after the RPC.
         *
         * This matters because the returning player may now
         * be the host if host responsibilities were transferred.
         */
        const { data: player, error: playerError } = await supabase
          .from("players")
          .select("id, name, is_host")
          .eq("id", playerId)
          .eq("room_id", room.id)
          .single();

        if (playerError || !player) {
          throw playerError ?? new Error("Could not restore player.");
        }

        localStorage.setItem(
          "sq-player",
          JSON.stringify({
            playerId: player.id,
            roomId: room.id,
            roomCode: room.code,
            name: player.name,
            isHost: player.is_host,
          }),
        );

        router.push(`/room/${room.code}/play`);
        return;
      }

      /*
       * FINISHED GAME
       */
      if (room.status === "finished") {
        setError(
          "That game already ended. Apparently you missed some questionable decisions.",
        );

        setIsJoining(false);
        return;
      }

      /*
       * MODE SELECTION / SETUP / UNSUPPORTED ACTIVE MODE
       */
      setError(
        "That game is already getting started. Try again when the room is ready.",
      );

      setIsJoining(false);
    } catch (caughtError) {
      console.error("Failed to join room:", caughtError);

      setError("Something went sideways while joining. Try again.");
      setIsJoining(false);
    }
  }

  function handleRoomCodeChange(value: string) {
    let formatted = value.toUpperCase().replace(/[^A-Z0-9-]/g, "");

    if (
      formatted.length > 0 &&
      !formatted.startsWith("SQ-") &&
      !formatted.startsWith("S")
    ) {
      formatted = `SQ-${formatted.replace(/-/g, "")}`;
    }

    setRoomCode(formatted.slice(0, 7));
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
            Well, look who showed up.
          </p>

          <h1 className="text-[clamp(3rem,14vw,4.75rem)] font-black leading-[0.88] tracking-[-0.07em]">
            YOU WERE
            <br />
            INVITED?
          </h1>

          <p className="mt-7 text-lg leading-7 text-[var(--muted)]">
            Questionable choice. Enter the room code and tell us who you are.
          </p>

          <form className="mt-10 space-y-5" onSubmit={handleJoinRoom}>
            <div>
              <label
                htmlFor="room-code"
                className="mb-3 block text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]"
              >
                Room code
              </label>

              <input
                id="room-code"
                name="roomCode"
                type="text"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={7}
                placeholder="SQ-MP8G"
                value={roomCode}
                onChange={(event) => handleRoomCodeChange(event.target.value)}
                disabled={isJoining}
                className="h-16 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-5 text-xl font-black uppercase tracking-[0.12em] text-[var(--foreground)] outline-none transition placeholder:font-bold placeholder:text-[var(--muted)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="player-name"
                className="mb-3 block text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]"
              >
                Your name
              </label>

              <input
                id="player-name"
                name="playerName"
                type="text"
                autoComplete="nickname"
                maxLength={24}
                placeholder="Enter your name"
                value={playerName}
                onChange={(event) => setPlayerName(event.target.value)}
                disabled={isJoining}
                className="h-16 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-5 text-lg font-bold text-[var(--foreground)] outline-none transition placeholder:font-medium placeholder:text-[var(--muted)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="text-sm font-bold leading-5 text-[var(--danger)]"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isJoining}
              className="flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
            >
              <span>{isJoining ? "JOINING..." : "JOIN THE CHAOS"}</span>
              <span aria-hidden="true">{isJoining ? "…" : "→"}</span>
            </button>
          </form>
        </div>

        <p className="pb-4 text-center text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
          No judgment. Probably.
        </p>
      </section>
    </main>
  );
}
