"use client";

import { useParams, useRouter } from "next/navigation";

import { useCallback, useEffect, useMemo, useState } from "react";

import { supabase } from "@/lib/supabase";

type Room = {
  id: string;

  code: string;

  status: string;

  game_mode: string | null;

  winning_score: number;

  current_round: number;

  current_judge_id: string | null;
};

type Player = {
  id: string;

  name: string;

  is_host: boolean;

  score: number;
};

type Round = {
  id: string;

  round_number: number;

  judge_id: string;

  status: string;

  prompt_id: string;

  winner_id: string | null;
};

type Prompt = {
  id: string;

  text: string;
};

type AnswerCard = {
  hand_id: string;

  answer_id: string;

  text: string;
};

type Submission = {
  id: string;

  player_id: string;

  answer_id: string;
};

type JudgeAnswer = {
  submission_id: string;

  answer_id: string;

  text: string;
};

type SavedPlayer = {
  playerId: string;

  roomCode: string;
};

export default function PlayPage() {
  const router = useRouter();

  const params = useParams<{ code: string }>();

  const roomCode = decodeURIComponent(params.code).toUpperCase();

  const [room, setRoom] = useState<Room | null>(null);

  const [players, setPlayers] = useState<Player[]>([]);

  // Includes disconnected players for winner reveals and final standings.
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);

  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);

  const [round, setRound] = useState<Round | null>(null);

  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const [hand, setHand] = useState<AnswerCard[]>([]);

  const [submissions, setSubmissions] = useState<Submission[]>([]);

  const [judgeAnswers, setJudgeAnswers] = useState<JudgeAnswer[]>([]);

  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);

  const [submittedAnswerId, setSubmittedAnswerId] = useState<string | null>(
    null,
  );

  const [selectedSubmissionId, setSelectedSubmissionId] = useState<
    string | null
  >(null);

  const [loading, setLoading] = useState(true);

  const [submitting, setSubmitting] = useState(false);

  const [choosingWinner, setChoosingWinner] = useState(false);

  const [advancingRound, setAdvancingRound] = useState(false);

  const [showFinalResults, setShowFinalResults] = useState(false);

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);

  const [leavingGame, setLeavingGame] = useState(false);

  const [error, setError] = useState("");

  /*







   * LOAD PLAYERS







   */

  const loadPlayers = useCallback(async (roomId: string) => {
    const { data, error: playersError } = await supabase

      .from("players")

      .select("id, name, is_host, score")

      .eq("room_id", roomId)

      .eq("connected", true)

      .order("joined_at", { ascending: true });

    if (playersError) {
      console.error("Failed to load players:", playersError);

      return null;
    }

    setPlayers(data ?? []);

    return data ?? [];
  }, []);

  /*







   * LOAD SUBMISSIONS







   */

  const loadSubmissions = useCallback(async (roundId: string) => {
    const { data, error: submissionError } = await supabase

      .from("qa_submissions")

      .select("id, player_id, answer_id")

      .eq("round_id", roundId);

    if (submissionError) {
      console.error("Failed to load submissions:", submissionError);

      return [];
    }

    setSubmissions(data ?? []);

    return data ?? [];
  }, []);

  /*







   * LOAD ANSWERS FOR JUDGING / REVEAL







   *







   * We deliberately do not include player_id here.







   */

  const loadJudgeAnswers = useCallback(async (roundId: string) => {
    const { data, error: submissionError } = await supabase

      .from("qa_submissions")

      .select(
        `







        id,







        answer_id,







        qa_answers (







          id,







          text







        )







      `,
      )

      .eq("round_id", roundId);

    if (submissionError) {
      console.error("Failed to load judge answers:", submissionError);

      return [];
    }

    const normalizedAnswers: JudgeAnswer[] = (data ?? [])

      .map((submission) => {
        const answer = Array.isArray(submission.qa_answers)
          ? submission.qa_answers[0]
          : submission.qa_answers;

        if (!answer) {
          return null;
        }

        return {
          submission_id: submission.id,

          answer_id: submission.answer_id,

          text: answer.text,
        };
      })

      .filter((answer): answer is JudgeAnswer => answer !== null);

    setJudgeAnswers(normalizedAnswers);

    return normalizedAnswers;
  }, []);

  /*







   * LOAD GAME







   */

  const loadGame = useCallback(
    async (showLoader = true) => {
      if (showLoader) {
        setLoading(true);
      }

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

      /*







       * ROOM







       */

      const { data: roomData, error: roomError } = await supabase

        .from("rooms")

        .select(
          "id, code, status, game_mode, winning_score, current_round, current_judge_id",
        )

        .eq("code", roomCode)

        .single();

      if (roomError || !roomData) {
        setError("We couldn't find this game.");

        setLoading(false);

        return;
      }

      if (roomData.status !== "playing" && roomData.status !== "finished") {
        router.replace(`/room/${roomCode}`);

        return;
      }

      if (roomData.game_mode !== "questionable-answers") {
        router.replace(`/room/${roomCode}`);

        return;
      }

      /*







       * PLAYERS







       */

      const { data: playerData, error: playersError } = await supabase

        .from("players")

        .select("id, name, is_host, score")

        .eq("room_id", roomData.id)

        .eq("connected", true)

        .order("joined_at", { ascending: true });

      if (playersError || !playerData) {
        setError("We lost track of the questionable people.");

        setLoading(false);

        return;
      }

      const me = playerData.find(
        (player) => player.id === savedPlayer.playerId,
      );

      if (!me) {
        router.replace(`/room/${roomCode}`);

        return;
      }

      /*







       * CURRENT ROUND







       */

      const { data: roundData, error: roundError } = await supabase

        .from("qa_rounds")

        .select("id, round_number, judge_id, status, prompt_id, winner_id")

        .eq("room_id", roomData.id)

        .eq("round_number", roomData.current_round)

        .single();

      if (roundError || !roundData) {
        setError("Round data went missing. That's impressively questionable.");

        setLoading(false);

        return;
      }

      /*







       * PROMPT







       */

      const { data: promptData, error: promptError } = await supabase

        .from("qa_prompts")

        .select("id, text")

        .eq("id", roundData.prompt_id)

        .single();

      if (promptError || !promptData) {
        setError("We somehow lost the question.");

        setLoading(false);

        return;
      }

      /*







       * CURRENT PLAYER'S ACTIVE HAND







       */

      const { data: handData, error: handError } = await supabase

        .from("qa_hands")

        .select(
          `







          id,







          answer_id,







          qa_answers (







            id,







            text







          )







        `,
        )

        .eq("room_id", roomData.id)

        .eq("player_id", me.id)

        .eq("used", false);

      if (handError) {
        console.error("Failed to load hand:", handError);

        setError("Your cards wandered off somewhere.");

        setLoading(false);

        return;
      }

      const normalizedHand: AnswerCard[] = (handData ?? [])

        .map((card) => {
          const answer = Array.isArray(card.qa_answers)
            ? card.qa_answers[0]
            : card.qa_answers;

          if (!answer) {
            return null;
          }

          return {
            hand_id: card.id,

            answer_id: card.answer_id,

            text: answer.text,
          };
        })

        .filter((card): card is AnswerCard => card !== null);

      /*







       * SUBMISSIONS







       */

      const { data: submissionData, error: submissionError } = await supabase

        .from("qa_submissions")

        .select("id, player_id, answer_id")

        .eq("round_id", roundData.id);

      if (submissionError) {
        console.error("Failed to load submissions:", submissionError);

        setError("We lost track of the answers.");

        setLoading(false);

        return;
      }

      const mySubmission = (submissionData ?? []).find(
        (submission) => submission.player_id === me.id,
      );

      setRoom(roomData);

      setPlayers(playerData);

      setCurrentPlayer(me);

      setRound(roundData);

      setPrompt(promptData);

      setHand(normalizedHand);

      setSubmissions(submissionData ?? []);

      setSubmittedAnswerId(mySubmission?.answer_id ?? null);

      setSelectedAnswerId(null);

      setSelectedSubmissionId(null);

      /*







       * Answers are needed during judging AND during the







       * completed-round reveal.







       */

      if (roundData.status === "judging" || roundData.status === "complete") {
        await loadJudgeAnswers(roundData.id);
      } else {
        setJudgeAnswers([]);
      }

      setLoading(false);

      setAdvancingRound(false);
    },

    [loadJudgeAnswers, roomCode, router],
  );

  useEffect(() => {
    void loadGame();
  }, [loadGame]);

  /*







   * SUBMISSION REALTIME







   */

  useEffect(() => {
    if (!round) {
      return;
    }

    const roundId = round.id;

    const channel = supabase

      .channel(`qa-round-${roundId}-submissions`)

      .on(
        "postgres_changes",

        {
          event: "*",

          schema: "public",

          table: "qa_submissions",

          filter: `round_id=eq.${roundId}`,
        },

        () => {
          void loadSubmissions(roundId);
        },
      )

      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [round?.id, loadSubmissions]);

  /*







   * ROUND REALTIME







   *







   * submitting -> judging -> complete







   */

  useEffect(() => {
    if (!round) {
      return;
    }

    const roundId = round.id;

    const channel = supabase

      .channel(`qa-round-${roundId}-state`)

      .on(
        "postgres_changes",

        {
          event: "UPDATE",

          schema: "public",

          table: "qa_rounds",

          filter: `id=eq.${roundId}`,
        },

        async (payload) => {
          const updatedRound = payload.new as Round;

          setRound(updatedRound);

          // A round update can also be a mid-round judge transfer.
          // The backend may remove the promoted judge's old submission,
          // so refresh submissions even when the round stays "submitting".
          await loadSubmissions(updatedRound.id);

          if (updatedRound.status === "judging") {
            if (currentPlayer?.id === updatedRound.judge_id) {
              await loadJudgeAnswers(updatedRound.id);
            }
          }

          if (updatedRound.status === "complete") {
            /*







             * Everybody now needs:







             * - winner_id







             * - updated scores







             * - answer text







             */

            await Promise.all([
              loadSubmissions(updatedRound.id),

              loadJudgeAnswers(updatedRound.id),

              room ? loadPlayers(room.id) : Promise.resolve(null),
            ]);

            setChoosingWinner(false);
          }
        },
      )

      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [
    round?.id,

    currentPlayer?.id,

    room?.id,

    loadJudgeAnswers,

    loadPlayers,

    loadSubmissions,
  ]);

  /*







   * ROOM REALTIME







   *







   * current_round changing means NEXT ROUND was pressed.







   */

  useEffect(() => {
    if (!room) {
      return;
    }

    const roomId = room.id;

    const currentRoundNumber = room.current_round;

    const channel = supabase

      .channel(`qa-room-${roomId}-play`)

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

          /*







           * A rematch reset sends the existing room back to the lobby.







           * Every connected player follows automatically.







           */

          if (updatedRoom.status === "lobby") {
            router.replace(`/room/${updatedRoom.code}`);

            return;
          }

          if (updatedRoom.status === "finished") {
            void loadGame(false);

            return;
          }

          if (updatedRoom.current_round !== currentRoundNumber) {
            setAdvancingRound(true);

            void loadGame(false);

            return;
          }

          setRoom(updatedRoom);
        },
      )

      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room?.id, room?.current_round, loadGame, router]);

  /*







   * PLAYER REALTIME







   *







   * Makes the scoreboard update when the winning point is awarded.







   */

  useEffect(() => {
    if (!room) {
      return;
    }

    const roomId = room.id;

    const channel = supabase

      .channel(`qa-room-${roomId}-players`)

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







   * SUBMIT ANSWER







   */

  async function handleSubmitAnswer() {
    if (
      !round ||
      !currentPlayer ||
      !selectedAnswerId ||
      submittedAnswerId ||
      submitting
    ) {
      return;
    }

    if (currentPlayer.id === round.judge_id) {
      return;
    }

    setSubmitting(true);

    setError("");

    const answerId = selectedAnswerId;

    const { error: submitError } = await supabase.rpc(
      "submit_questionable_answer",

      {
        p_round_id: round.id,

        p_player_id: currentPlayer.id,

        p_answer_id: answerId,
      },
    );

    if (submitError) {
      console.error("Failed to submit answer:", submitError);

      setError(
        submitError.message || "Your answer refused to be questionable.",
      );

      setSubmitting(false);

      return;
    }

    setSubmittedAnswerId(answerId);

    setSelectedAnswerId(null);

    setHand((currentHand) =>
      currentHand.filter((card) => card.answer_id !== answerId),
    );

    await loadSubmissions(round.id);

    setSubmitting(false);
  }

  /*







   * CHOOSE WINNER







   *







   * This now STOPS on round complete.







   */

  async function handleChooseWinner() {
    if (!round || !currentPlayer || !selectedSubmissionId || choosingWinner) {
      return;
    }

    if (currentPlayer.id !== round.judge_id) {
      return;
    }

    if (round.status !== "judging") {
      return;
    }

    setChoosingWinner(true);

    setError("");

    const { data, error: winnerError } = await supabase.rpc(
      "choose_questionable_answer_winner",

      {
        p_round_id: round.id,

        p_judge_id: currentPlayer.id,

        p_submission_id: selectedSubmissionId,
      },
    );

    if (winnerError) {
      console.error("Failed to choose winner:", winnerError);

      setError(
        winnerError.message || "The winner refused to accept responsibility.",
      );

      setChoosingWinner(false);

      return;
    }

    if (data === "finished") {
      await loadGame(false);

      setChoosingWinner(false);

      return;
    }

    /*







     * Realtime should receive the completed round immediately.







     * Reload as a fallback as well.







     */

    await loadGame(false);

    setChoosingWinner(false);
  }

  /*







   * ADVANCE TO NEXT ROUND







   */

  async function handleNextRound() {
    if (
      !round ||
      !currentPlayer ||
      advancingRound ||
      round.status !== "complete"
    ) {
      return;
    }

    if (currentPlayer.id !== round.judge_id) {
      return;
    }

    setAdvancingRound(true);

    setError("");

    const { error: advanceError } = await supabase.rpc(
      "advance_questionable_answers_round",

      {
        p_round_id: round.id,

        p_player_id: currentPlayer.id,
      },
    );

    if (advanceError) {
      console.error("Failed to advance round:", advanceError);

      setError(
        advanceError.message || "The next round got lost on the way here.",
      );

      setAdvancingRound(false);

      return;
    }

    /*







     * Room Realtime will see current_round change and reload







     * everybody into the newly-created round.







     */
  }

  /* LEAVE GAME */

  async function handleLeaveGame() {
    if (!room || !currentPlayer || leavingGame) return;

    setLeavingGame(true);

    setError("");

    const { error: leaveError } = await supabase.rpc("leave_room", {
      p_room_id: room.id,

      p_player_id: currentPlayer.id,
    });

    if (leaveError) {
      console.error("Failed to leave game:", leaveError);

      setError(leaveError.message || "We couldn't get you out of this mess.");

      setLeavingGame(false);

      return;
    }

    localStorage.removeItem("sq-player");

    setShowLeaveConfirm(false);

    router.replace("/");
  }

  /*







   * PLAY AGAIN







   *







   * The host resets the finished game and returns the







   * existing room to the lobby.







   */

  async function handlePlayAgain() {
    if (!room || !currentPlayer || advancingRound) {
      return;
    }

    if (!currentPlayer.is_host) {
      return;
    }

    setAdvancingRound(true);

    setError("");

    const { error: rematchError } = await supabase.rpc(
      "reset_room_for_rematch",

      {
        p_room_id: room.id,

        p_host_id: currentPlayer.id,
      },
    );

    if (rematchError) {
      console.error("Failed to reset room:", rematchError);

      setError(
        rematchError.message ||
          "Apparently one questionable game wasn't enough.",
      );

      setAdvancingRound(false);

      return;
    }

    /*







     * Send the host back immediately.







     * We'll also make the room Realtime listener send







     * everyone else back when it sees status = lobby.







     */

    router.replace(`/room/${room.code}`);
  }

  /*
   * RESULT PLAYERS
   *
   * Active scoreboards intentionally show connected players only.
   * Completed-round reveals and final standings also need players who
   * disconnected after submitting, because their retained answer can win.
   */
  useEffect(() => {
    if (
      !room?.id ||
      (round?.status !== "complete" && room.status !== "finished")
    ) {
      return;
    }

    let cancelled = false;

    async function loadResultPlayers() {
      const { data, error: resultPlayersError } = await supabase
        .from("players")
        .select("id, name, is_host, score")
        .eq("room_id", room!.id)
        .order("joined_at", { ascending: true });

      if (resultPlayersError) {
        console.error("Failed to load result players:", resultPlayersError);
        return;
      }

      if (!cancelled) {
        setAllPlayers(data ?? []);
      }
    }

    void loadResultPlayers();

    return () => {
      cancelled = true;
    };
  }, [room?.id, room?.status, round?.status, round?.winner_id]);

  /*







   * Stable anonymous display order.







   *







   * This does not use player_id or submission order.







   */

  const randomizedJudgeAnswers = useMemo(() => {
    return [...judgeAnswers].sort((a, b) =>
      b.submission_id.localeCompare(a.submission_id),
    );
  }, [judgeAnswers]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Dealing questionable decisions...
        </p>
      </main>
    );
  }

  if (error && (!room || !currentPlayer || !round || !prompt)) {
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

  if (!room || !currentPlayer || !round || !prompt) {
    return null;
  }

  const isJudge = currentPlayer.id === round.judge_id;

  const judge = players.find((player) => player.id === round.judge_id);

  const requiredSubmissionCount = Math.max(players.length - 1, 0);

  const currentSubmissionCount = submissions.length;

  const mySubmission = submissions.find(
    (submission) => submission.player_id === currentPlayer.id,
  );

  const hasSubmitted = Boolean(submittedAnswerId || mySubmission);

  const selectedCard = hand.find((card) => card.answer_id === selectedAnswerId);

  const selectedJudgeAnswer = randomizedJudgeAnswers.find(
    (answer) => answer.submission_id === selectedSubmissionId,
  );

  const judgingReady = round.status === "judging";

  const roundComplete = round.status === "complete";

  /*







   * ROUND WINNER







   */

  const resultPlayers = allPlayers.length > 0 ? allPlayers : players;

  const roundWinner = round.winner_id
    ? resultPlayers.find((player) => player.id === round.winner_id)
    : null;

  const winningSubmission = round.winner_id
    ? submissions.find((submission) => submission.player_id === round.winner_id)
    : null;

  const winningAnswer = winningSubmission
    ? judgeAnswers.find(
        (answer) => answer.submission_id === winningSubmission.id,
      )
    : null;

  /*







   * GAME WINNER







   */

  const gameWinner =
    room.status === "finished"
      ? [...resultPlayers].sort((a, b) => b.score - a.score)[0]
      : null;

  const finalStandings =
    room.status === "finished"
      ? [...resultPlayers].sort((a, b) => b.score - a.score)
      : [];

  const leaveGameControls = (
    <>
      <button
        type="button"
        onClick={() => setShowLeaveConfirm(true)}
        className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)] transition hover:text-[var(--foreground)]"
      >
        Leave Game
      </button>

      {showLeaveConfirm ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--background)] p-6 text-left shadow-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--danger)]">
              Abandon questionable behavior?
            </p>

            <h2 className="mt-3 text-3xl font-black tracking-[-0.04em]">
              LEAVE THIS GAME?
            </h2>

            <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
              You&apos;ll leave this room intentionally. You can join again
              later with the room code.
            </p>

            {error ? (
              <p className="mt-4 text-sm font-bold text-[var(--danger)]">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={leavingGame}
              onClick={() => void handleLeaveGame()}
              className="mt-6 min-h-14 w-full rounded-[var(--radius-md)] bg-[var(--danger)] px-5 text-sm font-black uppercase tracking-[0.12em] text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {leavingGame ? "LEAVING..." : "YES, LEAVE GAME"}
            </button>

            <button
              type="button"
              disabled={leavingGame}
              onClick={() => setShowLeaveConfirm(false)}
              className="mt-3 min-h-12 w-full rounded-[var(--radius-md)] border border-[var(--border)] px-5 text-xs font-black uppercase tracking-[0.12em] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Never Mind
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  /*

   * PAUSED — NOT ENOUGH PLAYERS

   *

   * A Questionable Answers game needs at least two connected

   * players. The room remains alive so somebody can rejoin

   * using the existing room code.

   */

  if (room.status === "playing" && players.length < 2) {
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
          <header className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                Room {room.code}
              </p>

              <p className="mt-1 text-sm font-black text-[var(--accent)]">
                GAME PAUSED
              </p>
            </div>

            <div className="flex items-center gap-4">
              {leaveGameControls}

              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
                SQ
              </div>
            </div>
          </header>

          <div className="flex flex-1 flex-col justify-center py-12 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
              Well, this got awkward.
            </p>

            <h1 className="mt-5 text-[clamp(3rem,14vw,4.75rem)] font-black leading-[0.88] tracking-[-0.07em]">
              THE PARTY
              <br />
              GOT SMALL.
            </h1>

            <p className="mx-auto mt-7 max-w-sm text-lg leading-7 text-[var(--muted)]">
              You need at least one more questionable person before the chaos
              can continue.
            </p>

            <div className="mt-10 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-6">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
                Room code
              </p>

              <p className="mt-3 text-4xl font-black tracking-[0.08em] text-[var(--accent)]">
                {room.code}
              </p>

              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                Give this code to someone and have them choose{" "}
                <span className="font-black text-[var(--foreground)]">
                  Join Game
                </span>
                . They can join this game while it&apos;s in progress.
              </p>
            </div>

            <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-left">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-[var(--accent)]" />

                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    Waiting for another player
                  </p>

                  <p className="mt-2 font-black">
                    The game will continue automatically when someone joins.
                  </p>
                </div>
              </div>
            </div>

            {currentPlayer.is_host ? (
              <p className="mt-6 text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                You&apos;re currently the host.
              </p>
            ) : null}
          </div>

          <p className="pb-4 text-center text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted)]">
            Good friends. Questionable behavior.
          </p>
        </section>
      </main>
    );
  }

  /*







   * GAME OVER







   */

  if (room.status === "finished" && (!roundComplete || showFinalResults)) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--background)] px-6 py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--accent)] opacity-[0.08] blur-3xl"
        />

        <section className="relative w-full max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
            SQ
          </div>

          <div className="mt-5">{leaveGameControls}</div>

          <p className="mt-10 text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
            We have a winner
          </p>

          <h1 className="mt-4 text-6xl font-black leading-[0.9] tracking-[-0.06em]">
            {gameWinner?.name ?? "SOMEONE"}
            <br />
            WINS.
          </h1>

          <p className="mt-6 text-lg leading-7 text-[var(--muted)]">
            Congratulations. This is apparently something to be proud of.
          </p>

          <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-left">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              Final standings
            </p>

            <div className="mt-4 space-y-3">
              {finalStandings.map((player, index) => (
                <div
                  key={player.id}
                  className={`flex items-center justify-between rounded-[var(--radius-md)] border px-4 py-4 ${
                    index === 0
                      ? "border-[var(--accent)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                        index === 0
                          ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                          : "bg-[var(--surface-hover)] text-[var(--muted)]"
                      }`}
                    >
                      {index + 1}
                    </span>

                    <div className="min-w-0">
                      <p
                        className={`truncate font-black ${
                          index === 0 ? "text-[var(--accent)]" : ""
                        }`}
                      >
                        {player.name}

                        {player.id === currentPlayer.id ? " (YOU)" : ""}
                      </p>

                      {index === 0 ? (
                        <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                          Questionable champion
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="ml-4 text-right">
                    <p className="text-2xl font-black">{player.score}</p>

                    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
                      {player.score === 1 ? "Point" : "Points"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Final game actions */}

          {currentPlayer.is_host ? (
            <button
              type="button"
              disabled={advancingRound}
              onClick={() => void handlePlayAgain()}
              className="mt-8 flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>
                {advancingRound ? "RESETTING THE CHAOS..." : "PLAY AGAIN"}
              </span>

              <span aria-hidden="true">→</span>
            </button>
          ) : (
            <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-left">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />

                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    Want another?
                  </p>

                  <p className="mt-2 text-base font-black">
                    Waiting for the host to decide whether you people deserve
                    another round.
                  </p>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => router.replace("/")}
            className="mt-3 min-h-14 w-full rounded-[var(--radius-md)] border border-[var(--border)] px-5 text-sm font-black uppercase tracking-[0.12em] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--foreground)]"
          >
            BACK TO HOME
          </button>
        </section>
      </main>
    );
  }

  /*







   * ROUND WINNER REVEAL







   */

  if (roundComplete) {
    return (
      <main className="relative min-h-screen overflow-hidden bg-[var(--background)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[var(--accent)] opacity-[0.09] blur-3xl"
        />

        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-[var(--danger)] opacity-[0.07] blur-3xl"
        />

        <section className="relative mx-auto min-h-screen w-full max-w-md px-6 py-8 sm:px-8">
          <header className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                Round {round.round_number}
              </p>

              <p className="mt-1 text-sm font-black text-[var(--accent)]">
                WINNER REVEAL
              </p>
            </div>

            <div className="flex items-center gap-4">
              {leaveGameControls}

              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
                {" "}
                SQ{" "}
              </div>
            </div>
          </header>

          {/* Scoreboard */}

          <div className="mt-8 flex flex-wrap gap-2">
            {players.map((player) => (
              <div
                key={player.id}
                className={`rounded-full border px-3 py-2 text-xs font-black ${
                  player.id === round.winner_id
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {player.name} · {player.score}
                {player.id === round.winner_id ? " · +1" : ""}
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
              Questionable choice.
            </p>

            <h1 className="mt-3 text-5xl font-black leading-[0.9] tracking-[-0.055em]">
              WE HAVE
              <br />A WINNER.
            </h1>
          </div>

          {/* Prompt */}

          <div className="mt-9 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              The prompt
            </p>

            <p className="mt-3 text-lg font-black leading-6">{prompt.text}</p>
          </div>

          {/* Winning answer */}

          <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--accent)] p-6 text-[var(--accent-foreground)]">
            <p className="text-xs font-black uppercase tracking-[0.16em] opacity-70">
              Winning answer
            </p>

            <p className="mt-4 text-2xl font-black leading-7">
              {winningAnswer?.text ?? "Revealing questionable evidence..."}
            </p>
          </div>

          {/* Player reveal */}

          <div className="mt-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              Who&apos;s responsible?
            </p>

            <p className="mt-3 text-4xl font-black tracking-[-0.05em] text-[var(--accent)]">
              {roundWinner?.name ?? "??? "}
            </p>

            <p className="mt-2 text-xl font-black">+1 POINT</p>

            <p className="mt-3 text-sm text-[var(--muted)]">
              {roundWinner
                ? `${roundWinner.name} now has ${roundWinner.score} ${
                    roundWinner.score === 1 ? "point" : "points"
                  }.`
                : "Updating the score..."}
            </p>
          </div>

          {error ? (
            <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--surface)] p-4">
              <p className="text-sm font-bold text-[var(--danger)]">{error}</p>
            </div>
          ) : null}

          {/* Round controls */}

          {room.status === "finished" ? (
            <button
              type="button"
              onClick={() => setShowFinalResults(true)}
              className="mt-10 flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99]"
            >
              <span>SEE FINAL RESULTS</span>

              <span aria-hidden="true">→</span>
            </button>
          ) : isJudge ? (
            <button
              type="button"
              disabled={advancingRound}
              onClick={() => void handleNextRound()}
              className="mt-10 flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span>
                {advancingRound ? "DEALING THE NEXT MESS..." : "NEXT ROUND"}
              </span>

              <span aria-hidden="true">→</span>
            </button>
          ) : (
            <div className="mt-10 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />

                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    Enjoy the shame
                  </p>

                  <p className="mt-2 text-lg font-black">
                    {judge?.name ?? "The judge"} controls the next round.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    );
  }

  /*







   * TRANSITIONING TO NEXT ROUND







   */

  if (advancingRound) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
            SQ
          </div>

          <p className="mt-8 text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
            Questionable decision accepted
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

      <section className="relative mx-auto min-h-screen w-full max-w-md px-6 py-8 sm:px-8">
        {/* Header */}

        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              Round {round.round_number}
            </p>

            <p className="mt-1 text-sm font-black text-[var(--accent)]">
              FIRST TO {room.winning_score}
            </p>
          </div>

          <div className="flex items-center gap-4">
            {leaveGameControls}

            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
              {" "}
              SQ{" "}
            </div>
          </div>
        </header>

        {/* Scoreboard */}

        <div className="mt-8 flex flex-wrap gap-2">
          {players.map((player) => (
            <div
              key={player.id}
              className={`rounded-full border px-3 py-2 text-xs font-black ${
                player.id === round.judge_id
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted)]"
              }`}
            >
              {player.name} · {player.score}
              {player.id === round.judge_id ? " · JUDGE" : ""}
            </div>
          ))}
        </div>

        {/* Prompt */}

        <div className="mt-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
            {isJudge
              ? "Your questionable authority begins now."
              : `${judge?.name ?? "Someone"} is judging you.`}
          </p>

          <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--accent)] p-6 text-[var(--accent-foreground)]">
            <p className="text-xs font-black uppercase tracking-[0.16em] opacity-70">
              The prompt
            </p>

            <h1 className="mt-5 text-[clamp(2rem,9vw,3rem)] font-black leading-[1.02] tracking-[-0.045em]">
              {prompt.text}
            </h1>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--surface)] p-4">
            <p className="text-sm font-bold text-[var(--danger)]">{error}</p>
          </div>
        ) : null}

        {isJudge ? (
          /*







           * JUDGE VIEW







           */

          <div className="mt-10 pb-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              You&apos;re the judge
            </p>

            {judgingReady ? (
              <>
                <h2 className="mt-2 text-3xl font-black leading-none tracking-[-0.04em]">
                  PICK THE
                  <br />
                  WINNER.
                </h2>

                <p className="mt-5 text-base leading-7 text-[var(--muted)]">
                  The names are hidden. Judge the answer, not the questionable
                  person who submitted it.
                </p>

                {randomizedJudgeAnswers.length === 0 ? (
                  <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
                    <div className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />

                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                        Loading anonymous answers...
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-7 space-y-3">
                    {randomizedJudgeAnswers.map((answer, index) => {
                      const selected =
                        selectedSubmissionId === answer.submission_id;

                      return (
                        <button
                          key={answer.submission_id}
                          type="button"
                          disabled={choosingWinner}
                          onClick={() => {
                            setSelectedSubmissionId(answer.submission_id);

                            setError("");
                          }}
                          className={`w-full rounded-[var(--radius-md)] border p-5 text-left transition active:scale-[0.99] disabled:cursor-not-allowed ${
                            selected
                              ? "border-[var(--accent)] bg-[var(--surface-hover)]"
                              : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:bg-[var(--surface-hover)]"
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            <span
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                                selected
                                  ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                                  : "bg-[var(--surface-hover)] text-[var(--muted)]"
                              }`}
                            >
                              {selected ? "✓" : index + 1}
                            </span>

                            <p
                              className={`pt-1 text-lg font-black leading-6 ${
                                selected ? "text-[var(--accent)]" : ""
                              }`}
                            >
                              {answer.text}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedJudgeAnswer ? (
                  <div className="sticky bottom-4 mt-6 rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--background)] p-4 shadow-2xl">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                      Crown this disaster?
                    </p>

                    <p className="mt-2 text-lg font-black">
                      {selectedJudgeAnswer.text}
                    </p>

                    <button
                      type="button"
                      disabled={choosingWinner}
                      onClick={() => void handleChooseWinner()}
                      className="mt-4 flex min-h-14 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-5 text-base font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span>
                        {choosingWinner
                          ? "MAKING IT OFFICIAL..."
                          : "PICK THIS WINNER"}
                      </span>

                      <span aria-hidden="true">→</span>
                    </button>

                    <button
                      type="button"
                      disabled={choosingWinner}
                      onClick={() => setSelectedSubmissionId(null)}
                      className="mt-2 min-h-11 w-full text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]"
                    >
                      Pick something else
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <h2 className="mt-2 text-3xl font-black leading-none tracking-[-0.04em]">
                  SIT BACK.
                  <br />
                  JUDGE HARSHLY.
                </h2>

                <p className="mt-5 text-base leading-7 text-[var(--muted)]">
                  Everyone else is choosing the answer they think will make you
                  question why you&apos;re friends with them.
                </p>

                <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
                  <div className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />

                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                        Waiting for answers
                      </p>

                      <p className="mt-2 text-xl font-black">
                        {currentSubmissionCount} OF {requiredSubmissionCount}{" "}
                        SUBMITTED
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : hasSubmitted ? (
          /*







           * PLAYER — SUBMITTED







           */

          <div className="mt-10 pb-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              No taking it back now.
            </p>

            <h2 className="mt-2 text-4xl font-black leading-[0.95] tracking-[-0.05em]">
              ANSWER
              <br />
              LOCKED IN.
            </h2>

            <p className="mt-5 text-base leading-7 text-[var(--muted)]">
              Your terrible decision has been submitted anonymously.
            </p>

            <div className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />

                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                    {judgingReady
                      ? "The judge has the answers"
                      : "Waiting for everyone else"}
                  </p>

                  <p className="mt-2 text-lg font-black">
                    {judgingReady
                      ? `${judge?.name ?? "The judge"} is judging you now.`
                      : `${currentSubmissionCount} of ${requiredSubmissionCount} submitted`}
                  </p>
                </div>
              </div>
            </div>

            <p className="mt-5 text-center text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              Try not to look suspicious
            </p>
          </div>
        ) : (
          /*







           * PLAYER — CHOOSING







           */

          <div className="mt-10 pb-10">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--muted)]">
              Your hand
            </p>

            <h2 className="mt-2 text-3xl font-black leading-none tracking-[-0.04em]">
              PICK YOUR
              <br />
              WORST ANSWER.
            </h2>

            <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
              Choose the card that completes the prompt best. Or worst.
              Preferably both.
            </p>

            <div className="mt-6 space-y-3">
              {hand.map((card, index) => {
                const selected = selectedAnswerId === card.answer_id;

                return (
                  <button
                    key={card.hand_id}
                    type="button"
                    disabled={submitting || round.status !== "submitting"}
                    onClick={() => {
                      setSelectedAnswerId(card.answer_id);

                      setError("");
                    }}
                    className={`group w-full rounded-[var(--radius-md)] border p-5 text-left transition active:scale-[0.99] disabled:cursor-not-allowed ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--surface-hover)]"
                        : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${
                          selected
                            ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                            : "bg-[var(--surface-hover)] text-[var(--muted)]"
                        }`}
                      >
                        {selected ? "✓" : index + 1}
                      </span>

                      <p
                        className={`pt-1 text-lg font-black leading-6 ${
                          selected ? "text-[var(--accent)]" : ""
                        }`}
                      >
                        {card.text}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-5 text-center text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
              {hand.length} questionable options
            </p>

            {selectedCard ? (
              <div className="sticky bottom-4 mt-6 rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--background)] p-4 shadow-2xl">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  Your questionable choice
                </p>

                <p className="mt-2 text-lg font-black">{selectedCard.text}</p>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSubmitAnswer()}
                  className="mt-4 flex min-h-14 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-5 text-base font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span>
                    {submitting ? "LOCKING IT IN..." : "LOCK IN ANSWER"}
                  </span>

                  <span aria-hidden="true">→</span>
                </button>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setSelectedAnswerId(null)}
                  className="mt-2 min-h-11 w-full text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]"
                >
                  Pick something else
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
