"use client";

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
};

type SavedPlayer = {
  playerId: string;
  roomCode: string;
};

type Deck = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  seasonal: boolean;
  sort_order: number;
  promptCount: number;
  answerCount: number;
};

export default function ThemesPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const roomCode = decodeURIComponent(params.code).toUpperCase();

  const [room, setRoom] = useState<Room | null>(null);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadSelections = useCallback(
    async (roomId: string, gameMode: string | null) => {
      const selectionTable =
        gameMode === "most-likely" ? "room_mlt_decks" : "room_qa_decks";

      const { data, error: selectionError } = await supabase
        .from(selectionTable)
        .select("deck_id")
        .eq("room_id", roomId);

      if (selectionError) {
        throw selectionError;
      }

      setSelectedDeckIds((data ?? []).map((row) => row.deck_id));
    },
    [],
  );

  const loadPage = useCallback(async () => {
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
      .select("id, code, status, game_mode")
      .eq("code", roomCode)
      .single();

    if (roomError || !roomData) {
      setError("We couldn't find this questionable gathering.");
      setLoading(false);
      return;
    }

    if (
      roomData.game_mode !== "questionable-answers" &&
      roomData.game_mode !== "most-likely"
    ) {
      router.replace(`/room/${roomCode}`);
      return;
    }

    if (roomData.status === "setup") {
      router.replace(`/room/${roomCode}/setup`);
      return;
    }

    if (roomData.status === "playing") {
      router.replace(`/room/${roomCode}/play`);
      return;
    }

    if (roomData.status !== "choosing-theme") {
      router.replace(`/room/${roomCode}`);
      return;
    }

    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .select("id, name, is_host")
      .eq("id", savedPlayer.playerId)
      .eq("room_id", roomData.id)
      .eq("connected", true)
      .single();

    if (playerError || !playerData) {
      router.replace(`/room/${roomCode}`);
      return;
    }

    const isMostLikely = roomData.game_mode === "most-likely";
    const deckTable = isMostLikely ? "mlt_decks" : "qa_decks";

    const { data: deckData, error: deckError } = await supabase
      .from(deckTable)
      .select("id, slug, name, description, seasonal, sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (deckError) {
      setError("We couldn't load the questionable themes.");
      setLoading(false);
      return;
    }

    const loadedDecks = await Promise.all(
      (deckData ?? []).map(async (deck) => {
        if (isMostLikely) {
          const { count: promptCount, error: promptError } = await supabase
            .from("mlt_prompt_decks")
            .select("*", { count: "exact", head: true })
            .eq("deck_id", deck.id);

          if (promptError) {
            throw promptError;
          }

          return {
            ...deck,
            promptCount: promptCount ?? 0,
            answerCount: 1,
          };
        }

        const [
          { count: promptCount, error: promptError },
          { count: answerCount, error: answerError },
        ] = await Promise.all([
          supabase
            .from("qa_prompt_decks")
            .select("*", { count: "exact", head: true })
            .eq("deck_id", deck.id),
          supabase
            .from("qa_answer_decks")
            .select("*", { count: "exact", head: true })
            .eq("deck_id", deck.id),
        ]);

        if (promptError || answerError) {
          throw promptError ?? answerError;
        }

        return {
          ...deck,
          promptCount: promptCount ?? 0,
          answerCount: answerCount ?? 0,
        };
      }),
    );

    setRoom(roomData);
    setCurrentPlayer(playerData);
    setDecks(loadedDecks);

    try {
      if (roomData.game_mode === "most-likely") {
        const { data: existingSelections, error: existingError } =
          await supabase
            .from("room_mlt_decks")
            .select("deck_id")
            .eq("room_id", roomData.id);

        if (existingError) {
          throw existingError;
        }

        if ((existingSelections ?? []).length === 0 && playerData.is_host) {
          const classicDeck = loadedDecks.find(
            (deck) => deck.slug === "classic",
          );

          if (classicDeck) {
            const { error: defaultError } = await supabase
              .from("room_mlt_decks")
              .insert({
                room_id: roomData.id,
                deck_id: classicDeck.id,
              });

            if (defaultError) {
              throw defaultError;
            }
          }
        }
      }

      await loadSelections(roomData.id, roomData.game_mode);
    } catch {
      setError("We couldn't load the selected themes.");
    }

    setLoading(false);
  }, [loadSelections, roomCode, router]);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    if (!room) {
      return;
    }

    const roomId = room.id;

    const roomChannel = supabase
      .channel(`room-${roomId}-themes-state`)
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

          if (updatedRoom.status === "setup") {
            router.push(`/room/${updatedRoom.code}/setup`);
            return;
          }

          if (updatedRoom.status === "playing") {
            router.push(`/room/${updatedRoom.code}/play`);
            return;
          }

          if (updatedRoom.status === "lobby") {
            router.push(`/room/${updatedRoom.code}`);
          }
        },
      )
      .subscribe();

    const selectionTable =
      room.game_mode === "most-likely" ? "room_mlt_decks" : "room_qa_decks";

    const selectionChannel = supabase
      .channel(`room-${roomId}-themes-selection`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: selectionTable,
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          void loadSelections(roomId, room.game_mode);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(roomChannel);
      void supabase.removeChannel(selectionChannel);
    };
  }, [loadSelections, room, router]);

  async function toggleDeck(deck: Deck) {
    if (!room || !currentPlayer?.is_host || saving) {
      return;
    }

    const available =
      room.game_mode === "most-likely"
        ? deck.promptCount > 0
        : deck.promptCount > 0 && deck.answerCount > 0;

    if (!available) {
      return;
    }

    const selected = selectedDeckIds.includes(deck.id);

    if (selected && selectedDeckIds.length === 1) {
      setError("Pick at least one theme. Chaos needs material.");
      return;
    }

    setSaving(true);
    setError("");

    const selectionTable =
      room.game_mode === "most-likely" ? "room_mlt_decks" : "room_qa_decks";

    if (selected) {
      const { error: deleteError } = await supabase
        .from(selectionTable)
        .delete()
        .eq("room_id", room.id)
        .eq("deck_id", deck.id);

      if (deleteError) {
        setError("We couldn't remove that theme.");
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from(selectionTable)
        .insert({
          room_id: room.id,
          deck_id: deck.id,
        });

      if (insertError) {
        setError("We couldn't add that theme.");
        setSaving(false);
        return;
      }
    }

    await loadSelections(room.id, room.game_mode);
    setSaving(false);
  }

  async function handleContinue() {
    if (!room || !currentPlayer?.is_host || saving) {
      return;
    }

    if (selectedDeckIds.length === 0) {
      setError("Pick at least one theme before continuing.");
      return;
    }

    setSaving(true);
    setError("");

    const { error: updateError } = await supabase
      .from("rooms")
      .update({ status: "setup" })
      .eq("id", room.id);

    if (updateError) {
      setError("We couldn't save the vibe. Try again.");
      setSaving(false);
      return;
    }

    router.push(`/room/${room.code}/setup`);
  }

  async function handleBack() {
    if (!room || !currentPlayer?.is_host || saving) {
      return;
    }

    setSaving(true);
    setError("");

    const { error: updateError } = await supabase
      .from("rooms")
      .update({
        status: "choosing-mode",
        game_mode: null,
      })
      .eq("id", room.id);

    if (updateError) {
      setError("We couldn't go back to game selection.");
      setSaving(false);
      return;
    }

    router.push(`/room/${room.code}/modes`);
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Picking questionable vibes...
        </p>
      </main>
    );
  }

  if (error && !room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <div className="w-full max-w-md text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--danger)]">
            Well, that's awkward.
          </p>

          <h1 className="mt-5 text-5xl font-black tracking-[-0.06em]">
            THEMES
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
          {isHost ? (
            <button
              type="button"
              onClick={() => void handleBack()}
              disabled={saving}
              aria-label="Back to game modes"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] text-xl font-bold text-[var(--foreground)] transition hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              ←
            </button>
          ) : (
            <div className="h-11 w-11" />
          )}

          <div className="flex items-center gap-3">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
              {room.code}
            </span>

            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--accent)] text-sm font-black text-[var(--accent-foreground)]">
              SQ
            </div>
          </div>
        </header>

        <div className="pt-14">
          <p className="text-sm font-bold uppercase tracking-[0.22em] text-[var(--accent)]">
            {room.game_mode === "most-likely"
              ? "Most Likely To"
              : "Questionable Answers"}
          </p>

          <h1 className="mt-4 text-[clamp(2.8rem,13vw,4.5rem)] font-black leading-[0.86] tracking-[-0.07em]">
            CHOOSE
            <br />
            YOUR
            <br />
            VIBE.
          </h1>

          <p className="mt-7 text-lg leading-7 text-[var(--muted)]">
            {isHost
              ? "Pick one or mix a few. Different themes, same questionable people."
              : `${currentPlayer.name}, the host is choosing what kind of trouble you're getting into.`}
          </p>
        </div>

        <div className="flex-1 py-10">
          <div className="space-y-3">
            {decks.map((deck) => {
              const available =
                room.game_mode === "most-likely"
                  ? deck.promptCount > 0
                  : deck.promptCount > 0 && deck.answerCount > 0;
              const selected = selectedDeckIds.includes(deck.id);

              return (
                <button
                  key={deck.id}
                  type="button"
                  disabled={!isHost || !available || saving}
                  onClick={() => void toggleDeck(deck)}
                  className={`w-full rounded-[var(--radius-md)] border p-5 text-left transition ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--surface)]"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  } ${
                    isHost && available
                      ? "hover:scale-[1.01] active:scale-[0.99]"
                      : "cursor-default"
                  } ${!available ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2
                          className={`text-xl font-black ${
                            selected ? "text-[var(--accent)]" : ""
                          }`}
                        >
                          {deck.name.toUpperCase()}
                        </h2>

                        {deck.seasonal ? (
                          <span className="rounded-full bg-[var(--surface-hover)] px-2.5 py-1 text-[0.6rem] font-black uppercase tracking-[0.12em] text-[var(--muted)]">
                            Seasonal
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {deck.description}
                      </p>

                      {!available ? (
                        <p className="mt-3 text-xs font-black uppercase tracking-[0.14em] text-[var(--muted)]">
                          Coming soon
                        </p>
                      ) : null}
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

          {error ? (
            <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--danger)] bg-[var(--surface)] p-4">
              <p className="text-sm font-bold text-[var(--danger)]">{error}</p>
            </div>
          ) : null}
        </div>

        <div className="pb-4">
          {isHost ? (
            <button
              type="button"
              disabled={saving || selectedDeckIds.length === 0}
              onClick={() => void handleContinue()}
              className="flex min-h-16 w-full items-center justify-between rounded-[var(--radius-md)] bg-[var(--accent)] px-6 text-lg font-black !text-[var(--accent-foreground)] transition hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
            >
              <span>{saving ? "HOLD ON..." : "SET THE RULES"}</span>
              <span aria-hidden="true">→</span>
            </button>
          ) : (
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 text-center">
              <div className="flex items-center justify-center gap-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--accent)]" />

                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--muted)]">
                  Waiting for the host to pick the vibe
                </p>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
