"use client";

import * as React from "react";

import { resolveDictationLanguage } from "@/lib/dictation";

/**
 * Section 9.3's press-and-hold dictation.
 *
 * `SpeechRecognition` is a browser API with no polyfill worth shipping, so the
 * hook's contract is that it always works, just not always by voice: when the
 * API is missing, `supported` is false and the caller renders a "Type" button
 * that focuses the textarea. A guard on desktop Firefox is not locked out of
 * taking a note.
 *
 * `raw` is returned separately from the editable text and is stored alongside
 * it, because an edit must never destroy what was actually said — that is the
 * difference between a note and evidence.
 */

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Sentence-cases a raw transcript and puts a full stop on the end.
 *
 * Deliberately shallow. A guard dictating "male subject northeast corner
 * refused to leave" wants it readable, not rewritten — anything cleverer
 * risks changing the words in a document that may be read back in court.
 */
export function autoPunctuate(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const cased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(cased) ? cased : `${cased}.`;
}

export interface DictationState {
  /** False when the browser has no SpeechRecognition; render "Type" instead. */
  supported: boolean;
  listening: boolean;
  /** Stable text from finalised results, punctuated. */
  transcript: string;
  /** The in-flight phrase, shown greyed so the guard sees it landing. */
  interim: string;
  /** Everything heard, unedited. Store this as `transcriptRaw`. */
  raw: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

/**
 * Never notifies: whether `SpeechRecognition` exists is fixed for the life of
 * the document. `useSyncExternalStore` is still the right tool because it is
 * the one hook that lets the server render a different value from the client
 * without a hydration mismatch — React renders the server snapshot, then
 * swaps to the client snapshot in a way it knows about.
 */
const NEVER_CHANGES = () => () => {};

export function useDictation(): DictationState {
  // The server has no `window`, so it must answer `false`; reading the real
  // value during a client render instead would make the first paint disagree
  // with the HTML and React would throw the tree away.
  const supported = React.useSyncExternalStore(
    NEVER_CHANGES,
    () => getConstructor() !== null,
    () => false,
  );
  const [listening, setListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState("");
  const [interim, setInterim] = React.useState("");
  const [raw, setRaw] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const ref = React.useRef<SpeechRecognitionLike | null>(null);

  React.useEffect(() => {
    return () => {
      // A recognition still running when the sheet unmounts keeps the
      // microphone indicator lit, which on a phone reads as the app spying.
      ref.current?.abort();
      ref.current = null;
    };
  }, []);

  const start = React.useCallback(() => {
    const Ctor = getConstructor();
    if (!Ctor) {
      setError("Dictation is not available here. You can type instead.");
      return;
    }
    ref.current?.abort();
    const recognition = new Ctor();
    // The guard's saved choice, falling back to the browser locale. Read at
    // start rather than captured once, so changing it in settings takes
    // effect on the next press without a reload.
    recognition.lang = resolveDictationLanguage();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalChunk = "";
      let interimChunk = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalChunk += text;
        else interimChunk += text;
      }
      if (finalChunk.trim()) {
        setRaw((prev) => (prev ? `${prev} ${finalChunk.trim()}` : finalChunk.trim()));
        setTranscript((prev) =>
          prev ? `${prev} ${autoPunctuate(finalChunk)}` : autoPunctuate(finalChunk),
        );
      }
      setInterim(interimChunk);
    };

    recognition.onerror = (event) => {
      // "no-speech" fires constantly on a quiet night and is not something the
      // guard needs told; "not-allowed" is, because it needs a settings fix.
      if (event.error === "no-speech" || event.error === "aborted") return;
      setError(
        event.error === "not-allowed"
          ? "Microphone blocked. Allow it in your browser settings, or type instead."
          : "Dictation stopped. You can type instead.",
      );
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };

    ref.current = recognition;
    setError(null);
    setListening(true);
    try {
      recognition.start();
    } catch {
      // start() throws if called twice; the guard's finger is faster than the
      // engine's teardown, and that is not a failure worth surfacing.
      setListening(false);
    }
  }, []);

  const stop = React.useCallback(() => {
    ref.current?.stop();
    setListening(false);
  }, []);

  const reset = React.useCallback(() => {
    setTranscript("");
    setInterim("");
    setRaw("");
    setError(null);
  }, []);

  return {
    supported,
    listening,
    transcript,
    interim,
    raw,
    error,
    start,
    stop,
    reset,
  };
}
