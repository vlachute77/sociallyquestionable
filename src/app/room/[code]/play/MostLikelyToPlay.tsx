"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

type Room = {
  id: string;
  code: string;
  status: string;
  game_mode: string | null;
  current_round: number;
  mlt_round_limit: number | null;
};

type Player = {
  id: string;
  name: string;
  is_host: boolean;
  score: number;
};

type SavedPlayer = {
  playerId: string;
  roomCode: string;
};

type RoundStateRow = {
  round_id: string;
  round_number: number;
  round_status: string;
  prompt_id: string;
  prompt_text: string;
  votes_cast: number;
  votes_needed: number;
  player_has_voted: boolean;
  voter_id: string | null;
  target_id: string | null;
  target_name: string | null;
  target_vote_count: number | null;
};

export default function MostLikelyToPlay() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const roomCode = decodeURIComponent(params.code).toUpperCase();

  const [room, setRoom] = useState<Room | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [roundRows, setRoundRows] = useState<RoundStateRow[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [error, setError] = useState("");

  const loadPlayers = useCallback(async (roomId: string) => {
    const { data, error: playersError } = await supabase
      .from("players")
      .select("id, name, is_host, score")
      .eq("room_id", roomId)
      .eq("connected", true)
      .order("joined_at", { ascending: true });

    if (playersError) {
      console.error("Failed to load MLT players:", playersError);
      return null;
    }

    setPlayers(data ?? []);
    return data ?? [];
  }, []);

  const loadRoundState = useCallback(
    async (roomId: string, playerId: string) => {
      const { data, error: stateError } = await supabase.rpc(
        "get_most_likely_to_round_state",
        {
          p_room_id: roomId,
          p_player_id: playerId,
        },
      );

      if (stateError) {
        console.error("Failed to load MLT round state:", stateError);
        setError(stateError.message || "We couldn't load this round.");
        return null;
      }

      const rows = (
        Array.isArray(data) ? data : data ? [data] : []
      ) as RoundStateRow[];
      setRoundRows(rows);
      setSelectedTargetId(null);
      return rows;
    },
    [],
  );

  const loadGame = useCallback(
    async (showLoader = true) => {
      if (showLoader) setLoading(true);
      setError("");

      const savedRaw = localStorage.getItem("sq-player");
      if (!savedRaw) {
        router.replace("/");
        return;
      }

      let saved: SavedPlayer;
      try {
        saved = JSON.parse(savedRaw) as SavedPlayer;
      } catch {
        localStorage.removeItem("sq-player");
        router.replace("/");
        return;
      }

      if (saved.roomCode !== roomCode) {
        router.replace("/");
        return;
      }

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, code, status, game_mode, current_round, mlt_round_limit")
        .eq("code", roomCode)
        .single();

      if (roomError || !roomData) {
        setError("We couldn't find this game.");
        setLoading(false);
        return;
      }

      if (roomData.game_mode !== "most-likely") {
        router.replace(`/room/${roomCode}`);
        return;
      }

      if (roomData.status !== "playing" && roomData.status !== "finished") {
        router.replace(`/room/${roomCode}`);
        return;
      }

      const loadedPlayers = await loadPlayers(roomData.id);
      if (!loadedPlayers) {
        setError("We lost track of the questionable people.");
        setLoading(false);
        return;
      }

      const me = loadedPlayers.find((player) => player.id === saved.playerId);
      if (!me) {
        router.replace(`/room/${roomCode}`);
        return;
      }

      setRoom(roomData);
      setCurrentPlayer(me);
      await loadRoundState(roomData.id, me.id);
      setLoading(false);
      setAdvancing(false);
    },
    [loadPlayers, loadRoundState, roomCode, router],
  );

  useEffect(() => {
    void loadGame();
  }, [loadGame]);

  useEffect(() => {
    if (!room || !currentPlayer) return;

    const channel = supabase
      .channel(`mlt-room-${room.id}-rounds`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "mlt_rounds",
          filter: `room_id=eq.${room.id}`,
        },
        () => {
          void loadRoundState(room.id, currentPlayer.id);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room?.id, currentPlayer?.id, loadRoundState]);

  useEffect(() => {
    if (!room || !currentPlayer) return;

    const currentRound = room.current_round;
    const channel = supabase
      .channel(`mlt-room-${room.id}-state`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        (payload) => {
          const updated = payload.new as Room;

          if (updated.status === "lobby") {
            setRoom(null);
            setRoundRows([]);
            router.replace(`/room/${updated.code}`);
            return;
          }

          if (
            updated.status === "finished" ||
            updated.current_round !== currentRound
          ) {
            setAdvancing(updated.status !== "finished");
            void loadGame(false);
            return;
          }

          setRoom(updated);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room?.id, room?.current_round, currentPlayer?.id, loadGame, router]);

  useEffect(() => {
    if (!room || !currentPlayer) return;

    const channel = supabase
      .channel(`mlt-room-${room.id}-players`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${room.id}`,
        },
        async () => {
          const { data: latestRoom, error: latestRoomError } = await supabase
            .from("rooms")
            .select("status, game_mode")
            .eq("id", room.id)
            .single();

          if (
            latestRoomError ||
            !latestRoom ||
            latestRoom.game_mode !== "most-likely" ||
            (latestRoom.status !== "playing" &&
              latestRoom.status !== "finished")
          ) {
            return;
          }

          await loadPlayers(room.id);
          await loadRoundState(room.id, currentPlayer.id);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room?.id, currentPlayer?.id, loadPlayers, loadRoundState]);

  async function handleVote() {
    if (
      !room ||
      !currentPlayer ||
      !selectedTargetId ||
      submitting ||
      roundRows[0]?.player_has_voted ||
      roundRows[0]?.round_status !== "voting"
    ) {
      return;
    }

    setSubmitting(true);
    setError("");

    const { error: voteError } = await supabase.rpc(
      "submit_most_likely_to_vote",
      {
        p_room_id: room.id,
        p_player_id: currentPlayer.id,
        p_target_id: selectedTargetId,
      },
    );

    if (voteError) {
      console.error("Failed to submit MLT vote:", voteError);
      setError(voteError.message || "Your vote refused to be questionable.");
      setSubmitting(false);
      return;
    }

    await Promise.all([
      loadRoundState(room.id, currentPlayer.id),
      loadPlayers(room.id),
    ]);
    setSubmitting(false);
  }

  async function handleNextRound() {
    if (
      !room ||
      !currentPlayer?.is_host ||
      advancing ||
      roundRows[0]?.round_status !== "revealed"
    ) {
      return;
    }

    setAdvancing(true);
    setError("");

    const { error: advanceError } = await supabase.rpc(
      "advance_most_likely_to_round",
      {
        p_room_id: room.id,
        p_player_id: currentPlayer.id,
      },
    );

    if (advanceError) {
      console.error("Failed to advance MLT round:", advanceError);
      setError(advanceError.message || "The next round got lost.");
      setAdvancing(false);
      return;
    }

    await loadGame(false);
  }

  async function handleLeaveGame() {
    if (!room || !currentPlayer || leaving) return;

    setLeaving(true);
    setError("");

    const { error: leaveError } = await supabase.rpc("leave_room", {
      p_room_id: room.id,
      p_player_id: currentPlayer.id,
    });

    if (leaveError) {
      console.error("Failed to leave MLT game:", leaveError);
      setError(leaveError.message || "We couldn't get you out of this mess.");
      setLeaving(false);
      return;
    }

    localStorage.removeItem("sq-player");
    router.replace("/");
  }

  async function handlePlayAgain() {
    if (!room || !currentPlayer?.is_host || advancing) return;

    setAdvancing(true);
    setError("");

    const { error: resetError } = await supabase.rpc("reset_room_for_rematch", {
      p_room_id: room.id,
      p_host_id: currentPlayer.id,
    });

    if (resetError) {
      console.error("Failed to reset MLT game:", resetError);
      setError(resetError.message || "We couldn't reset the room.");
      setAdvancing(false);
      return;
    }

    setRoom(null);
    setRoundRows([]);
    router.replace(`/room/${room.code}`);
  }

  const state = roundRows[0] ?? null;
  const revealed =
    state?.round_status === "revealed" || state?.round_status === "complete";

  const voteTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of roundRows) {
      if (row.target_id && row.target_vote_count != null) {
        totals.set(row.target_id, Number(row.target_vote_count));
      }
    }
    return totals;
  }, [roundRows]);

  const maxVotes = voteTotals.size
    ? Math.max(...Array.from(voteTotals.values()))
    : 0;

  const winners = players.filter(
    (player) => maxVotes > 0 && voteTotals.get(player.id) === maxVotes,
  );

  const standings = [...players].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
  const topScore = standings[0]?.score ?? 0;
  const finalWinners = standings.filter((player) => player.score === topScore);

  const selectedPlayer = players.find(
    (player) => player.id === selectedTargetId,
  );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Counting questionable opinions...
        </p>
      </main>
    );
  }

  if (!room || !currentPlayer || !state) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <div className="w-full max-w-md text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--danger)]">
            Well, that&apos;s awkward.
          </p>
          <h1 className="mt-5 text-5xl font-black tracking-[-0.06em]">
            GAME
            <br />
            MALFUNCTION.
          </h1>
          <p className="mt-5 text-lg text-[var(--muted)]">
            {error || "Something questionable happened."}
          </p>
        </div>
      </main>
    );
  }

  const leaveControls = (
    <>
      <button
        type="button"
        onClick={() => setShowLeaveConfirm(true)}
        className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]"
      >
        Leave Game
      </button>

      {showLeaveConfirm ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] p-6">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--danger)]">
              Abandon questionable behavior?
            </p>
            <h2 className="mt-3 text-3xl font-black">LEAVE THIS GAME?</h2>
            <button
              type="button"
              disabled={leaving}
              onClick={() => void handleLeaveGame()}
              className="mt-6 min-h-14 w-full rounded-[var(--radius-md)] bg-[var(--danger)] px-5 text-sm font-black uppercase text-white disabled:opacity-50"
            >
              {leaving ? "LEAVING..." : "YES, LEAVE GAME"}
            </button>
            <button
              type="button"
              disabled={leaving}
              onClick={() => setShowLeaveConfirm(false)}
              className="mt-3 min-h-12 w-full rounded-[var(--radius-md)] border border-[var(--border)] px-5 text-xs font-black uppercase text-[var(--muted)]"
            >
              Never Mind
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  if (advancing) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
            SQ
          </div>
          <p className="mt-8 text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
            Questionable opinions counted
          </p>
          <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-[-0.05em]">
            NEXT ROUND
            <br />
            INCOMING.
          </h1>
        </div>
      </main>
    );
  }

  if (room.status === "finished") {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[var(--background)] px-6 py-10">
        <section className="relative mx-auto w-full max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
            SQ
          </div>
          <div className="mt-5">{leaveControls}</div>
          <p className="mt-10 text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
            The people have spoken
          </p>
          <h1 className="mt-4 break-words text-[clamp(2.35rem,11vw,3rem)] font-black leading-[0.9] tracking-[-0.06em]">
            {finalWinners.length === 1 ? finalWinners[0].name : "IT'S A TIE"}
            <br />
            MOST QUESTIONABLE.
          </h1>
          <p className="mt-6 text-lg leading-7 text-[var(--muted)]">
            {finalWinners.length === 1
              ? "Your friends have rendered their verdict."
              : `${finalWinners.map((player) => player.name).join(" & ")} share the questionable honor.`}
          </p>

          <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-left">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              Final standings
            </p>
            <div className="mt-4 space-y-3">
              {standings.map((player, index) => (
                <div
                  key={player.id}
                  className={`flex items-center justify-between rounded-[var(--radius-md)] border px-4 py-4 ${
                    player.score === topScore
                      ? "border-[var(--accent)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  <p
                    className={`font-black ${player.score === topScore ? "text-[var(--accent)]" : ""}`}
                  >
                    {index + 1}. {player.name}
                    {player.id === currentPlayer.id ? " (YOU)" : ""}
                  </p>
                  <p className="text-2xl font-black">{player.score}</p>
                </div>
              ))}
            </div>
          </div>

          {currentPlayer.is_host ? (
            <button
              type="button"
              onClick={() => void handlePlayAgain()}
              className="mt-8 flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)]"
            >
              <span>PLAY AGAIN</span>
              <span>→</span>
            </button>
          ) : (
            <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                Waiting for the host
              </p>
            </div>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--background)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--accent)] opacity-[0.08] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-[var(--danger)] opacity-[0.07] blur-3xl"
      />

      <section className="relative mx-auto min-h-screen w-full max-w-md px-6 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              Round {state.round_number} of {room.mlt_round_limit ?? 10}
            </p>
            <p className="mt-1 text-sm font-black text-[var(--accent)]">
              MOST LIKELY TO
            </p>
          </div>
          <div className="flex items-center gap-4">
            {leaveControls}
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
              SQ
            </div>
          </div>
        </header>

        <div className="mt-8 flex flex-wrap gap-2">
          {players.map((player) => (
            <div
              key={player.id}
              className="rounded-full border border-[var(--border)] px-3 py-2 text-xs font-black text-[var(--muted)]"
            >
              {player.name} · {player.score}
            </div>
          ))}
        </div>

        <div className="mt-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
            WHO IS MOST LIKELY TO...
          </p>
          <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--accent)] p-6 text-[var(--accent-foreground)]">
            <h1 className="text-[clamp(2rem,9vw,3rem)] font-black leading-[1.02] tracking-[-0.045em]">
              {state.prompt_text}
            </h1>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--surface)] p-4">
            <p className="text-sm font-bold text-[var(--danger)]">{error}</p>
          </div>
        ) : null}

        {revealed ? (
          <div className="mt-10 pb-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              The votes are in
            </p>
            <h2 className="mt-2 text-4xl font-black leading-[0.95] tracking-[-0.05em]">
              {winners.length > 1 ? "QUESTIONABLE TIE." : "WE HAVE A VERDICT."}
            </h2>

            <div className="mt-7 space-y-3">
              {players
                .slice()
                .sort(
                  (a, b) =>
                    (voteTotals.get(b.id) ?? 0) - (voteTotals.get(a.id) ?? 0),
                )
                .map((player) => {
                  const votes = voteTotals.get(player.id) ?? 0;
                  const won = maxVotes > 0 && votes === maxVotes;
                  return (
                    <div
                      key={player.id}
                      className={`flex items-center justify-between rounded-[var(--radius-md)] border p-5 ${
                        won
                          ? "border-[var(--accent)]"
                          : "border-[var(--border)]"
                      } bg-[var(--surface)]`}
                    >
                      <div>
                        <p
                          className={`text-lg font-black ${won ? "text-[var(--accent)]" : ""}`}
                        >
                          {player.name}
                          {player.id === currentPlayer.id ? " (YOU)" : ""}
                        </p>
                        {won ? (
                          <p className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
                            +1 point
                          </p>
                        ) : null}
                      </div>
                      <p className="text-3xl font-black">{votes}</p>
                    </div>
                  );
                })}
            </div>

            <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                Who voted for whom
              </p>
              <div className="mt-4 space-y-2">
                {roundRows.map((vote, index) => {
                  const voter = players.find(
                    (player) => player.id === vote.voter_id,
                  );
                  return (
                    <p
                      key={`${vote.voter_id}-${index}`}
                      className="text-sm leading-6"
                    >
                      <span className="font-black">
                        {voter?.name ?? "Someone"}
                      </span>
                      <span className="text-[var(--muted)]"> voted for </span>
                      <span className="font-black text-[var(--accent)]">
                        {vote.target_name ?? "someone questionable"}
                      </span>
                    </p>
                  );
                })}
              </div>
            </div>

            {currentPlayer.is_host ? (
              <button
                type="button"
                disabled={advancing}
                onClick={() => void handleNextRound()}
                className="mt-8 flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] disabled:opacity-50"
              >
                <span>
                  {state.round_number === (room.mlt_round_limit ?? 10)
                    ? "SEE RESULTS"
                    : "NEXT ROUND"}
                </span>
                <span>→</span>
              </button>
            ) : (
              <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    Waiting for the host to start the next round
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : state.player_has_voted ? (
          <div className="mt-10 pb-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              Vote locked in
            </p>
            <h2 className="mt-2 text-4xl font-black leading-[0.95] tracking-[-0.05em]">
              NO TAKING
              <br />
              IT BACK.
            </h2>
            <p className="mt-5 text-base leading-7 text-[var(--muted)]">
              Your vote stays secret until everyone has made their questionable
              decision.
            </p>
            <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    Waiting for votes
                  </p>
                  <p className="mt-2 text-xl font-black">
                    {state.votes_cast} OF {state.votes_needed} VOTED
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-10 pb-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              Point the finger
            </p>
            <h2 className="mt-2 text-3xl font-black leading-none tracking-[-0.04em]">
              PICK A<br />
              PLAYER.
            </h2>
            <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
              Yes, you can vote for yourself. We&apos;re not here to judge. Yet.
            </p>

            <div className="mt-6 space-y-3">
              {players.map((player, index) => {
                const selected = selectedTargetId === player.id;
                return (
                  <button
                    key={player.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setSelectedTargetId(player.id);
                      setError("");
                    }}
                    className={`w-full rounded-[var(--radius-md)] border p-5 text-left transition active:scale-[0.99] disabled:opacity-50 ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--surface-hover)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                          selected
                            ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                            : "bg-[var(--surface-hover)] text-[var(--muted)]"
                        }`}
                      >
                        {selected ? "✓" : index + 1}
                      </span>
                      <div>
                        <p
                          className={`text-lg font-black ${selected ? "text-[var(--accent)]" : ""}`}
                        >
                          {player.name}
                          {player.id === currentPlayer.id ? " (YOU)" : ""}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedPlayer ? (
              <div className="sticky bottom-4 mt-6 rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--background)] p-4 shadow-2xl">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  Your questionable vote
                </p>
                <p className="mt-2 text-lg font-black">{selectedPlayer.name}</p>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleVote()}
                  className="mt-4 flex min-h-14 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-5 text-base font-black !text-[var(--accent-foreground)] disabled:opacity-50"
                >
                  <span>
                    {submitting ? "LOCKING IT IN..." : "LOCK IN VOTE"}
                  </span>
                  <span>→</span>
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setSelectedTargetId(null)}
                  className="mt-2 min-h-11 w-full text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]"
                >
                  Pick someone else
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
