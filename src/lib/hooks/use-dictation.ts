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

/**
 * A recognition that ends sooner than this did not hear speech; it failed to
 * run. Used only to tell a real utterance apart from an engine that cannot
 * start, so the restart-while-held loop has a floor.
 */
const RESTART_FLOOR_MS = 400;
const MAX_SHORT_ENDS = 3;

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
  /** True from press to release. Survives the engine ending under us. */
  const heldRef = React.useRef(false);
  /** Set when the failure is one restarting cannot fix, like a blocked mic. */
  const fatalRef = React.useRef(false);
  const attemptStartedRef = React.useRef(0);
  const shortEndsRef = React.useRef(0);

  /**
   * Drops a recognition without letting it run its handlers. `abort()` still
   * fires `onend`, and that handler restarts dictation, so replacing an engine
   * without unhooking it first would restart the very session being discarded.
   */
  const discard = React.useCallback((recognition: SpeechRecognitionLike | null) => {
    if (!recognition) return;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;
    recognition.abort();
  }, []);

  React.useEffect(() => {
    return () => {
      // A recognition still running when the sheet unmounts keeps the
      // microphone indicator lit, which on a phone reads as the app spying.
      heldRef.current = false;
      discard(ref.current);
      ref.current = null;
    };
  }, [discard]);

  const start = React.useCallback(() => {
    if (!getConstructor()) {
      setError("Dictation is not available here. You can type instead.");
      return;
    }
    heldRef.current = true;
    fatalRef.current = false;
    shortEndsRef.current = 0;
    setError(null);
    setListening(true);

    const begin = () => {
      const Ctor = getConstructor();
      if (!Ctor) return;
      discard(ref.current);
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
        // guard needs told; "aborted" is us swapping engines mid-hold.
        if (event.error === "no-speech" || event.error === "aborted") return;
        // Anything else is worth saying, and worth not restarting into.
        fatalRef.current = true;
        heldRef.current = false;
        setError(
          event.error === "not-allowed"
            ? "Microphone blocked. Allow it in your browser settings, or type instead."
            : "Dictation stopped. You can type instead.",
        );
        setListening(false);
      };

      recognition.onend = () => {
        setInterim("");
        if (!heldRef.current || fatalRef.current) {
          setListening(false);
          return;
        }
        // The engine ended while the guard is still holding. Chrome does this
        // on a network timeout and iOS Safari after a single utterance, both
        // regardless of `continuous`, so honouring it would silently swallow
        // the rest of the sentence. Start a fresh one instead.
        //
        // Bounded: an engine that cannot run at all ends immediately every
        // time, and restarting that in a loop would spin. Three consecutive
        // sub-second sessions is not speech, it is a broken engine.
        const lasted = Date.now() - attemptStartedRef.current;
        shortEndsRef.current = lasted < RESTART_FLOOR_MS ? shortEndsRef.current + 1 : 0;
        if (shortEndsRef.current >= MAX_SHORT_ENDS) {
          heldRef.current = false;
          setListening(false);
          setError("Dictation keeps stopping here. You can type instead.");
          return;
        }
        begin();
      };

      ref.current = recognition;
      attemptStartedRef.current = Date.now();
      try {
        recognition.start();
      } catch {
        // start() throws if called twice; the guard's finger is faster than the
        // engine's teardown, and that is not a failure worth surfacing.
        heldRef.current = false;
        setListening(false);
      }
    };

    begin();
  }, [discard]);

  const stop = React.useCallback(() => {
    // Order matters: clearing the flag first means the `onend` that `stop()`
    // triggers sees a released button and does not restart.
    heldRef.current = false;
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
