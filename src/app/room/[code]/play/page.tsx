"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";
import MostLikelyToPlay from "./MostLikelyToPlay";
import QuestionableAnswersPlay from "./QuestionableAnswersPlay";

type Mode = "questionable-answers" | "most-likely";

export default function PlayPage() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const roomCode = decodeURIComponent(params.code).toUpperCase();

  const [mode, setMode] = useState<Mode | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadMode() {
      const { data, error: roomError } = await supabase
        .from("rooms")
        .select("status, game_mode")
        .eq("code", roomCode)
        .single();

      if (cancelled) return;

      if (roomError || !data) {
        setError("We couldn't find this game.");
        return;
      }

      if (data.status !== "playing" && data.status !== "finished") {
        router.replace(`/room/${roomCode}`);
        return;
      }

      if (
        data.game_mode !== "questionable-answers" &&
        data.game_mode !== "most-likely"
      ) {
        router.replace(`/room/${roomCode}`);
        return;
      }

      setMode(data.game_mode);
    }

    void loadMode();

    return () => {
      cancelled = true;
    };
  }, [roomCode, router]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <p className="text-center text-lg font-black text-[var(--danger)]">
          {error}
        </p>
      </main>
    );
  }

  if (!mode) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">
          Loading questionable decisions...
        </p>
      </main>
    );
  }

  return mode === "most-likely" ? (
    <MostLikelyToPlay />
  ) : (
    <QuestionableAnswersPlay />
  );
}
