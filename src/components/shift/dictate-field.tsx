"use client";

import { Mic, Square } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { useDictation } from "@/lib/hooks/use-dictation";

/**
 * Section 9.3's "Dictate or type" control: a textarea with a press-and-hold
 * mic under it, or — when `SpeechRecognition` is missing — the same-sized
 * button labelled "Type" that focuses the textarea.
 *
 * Shared rather than copied into each sheet because the subtle parts are the
 * ones that would drift: interim results must render without being committed
 * to state (otherwise a correction is overwritten mid-sentence), finalised
 * speech must *append* to whatever was typed by hand, and `transcriptRaw` must
 * keep accumulating even after the guard edits the text, because section 9.3
 * requires the original words to survive the edit.
 */
export function DictateField({
  label,
  hint,
  rows = 4,
  placeholder = "Type, or hold the mic",
  value,
  onValueChange,
  onRawChange,
}: {
  label: string;
  hint?: string;
  rows?: number;
  placeholder?: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Receives the untouched transcript so the caller can store it verbatim. */
  onRawChange: (raw: string) => void;
}) {
  const dictation = useDictation();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const lastTranscript = React.useRef("");

  React.useEffect(() => {
    if (!dictation.transcript) return;
    if (dictation.transcript === lastTranscript.current) return;
    const addition = dictation.transcript.slice(lastTranscript.current.length);
    lastTranscript.current = dictation.transcript;
    const trimmed = addition.trim();
    if (!trimmed) return;
    onValueChange(value ? `${value} ${trimmed}` : trimmed);
    onRawChange(dictation.raw);
    // `value` is read, not depended on: re-running when the guard types would
    // re-append the same phrase. There is no reset path because the parent
    // sheets remount on open, which discards this hook's state with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.transcript]);

  return (
    <div className="space-y-3">
      {dictation.error ? (
        <p role="alert" className="text-sm text-text-muted">
          {dictation.error}
        </p>
      ) : null}

      <Field label={label} hint={hint}>
        <Textarea
          ref={textareaRef}
          value={dictation.interim ? `${value} ${dictation.interim}`.trim() : value}
          onChange={(event) => onValueChange(event.target.value)}
          rows={rows}
          placeholder={placeholder}
        />
      </Field>

      <Button
        variant={dictation.listening ? "danger" : "secondary"}
        size="lg"
        // `touch-none` is load-bearing, not styling. This button sits inside the
        // sheet's `overflow-y-auto` body, so without it a thumb that drifts a
        // few pixels while holding reads as a scroll, the browser claims the
        // gesture and fires `pointercancel` — and per spec no `pointerup`
        // follows. That is a held mic that never stops.
        className="w-full touch-none select-none [-webkit-touch-callout:none]"
        onPointerDown={
          dictation.supported
            ? (event) => {
                event.preventDefault();
                // Route the rest of this finger's events here no matter where
                // it wanders, so release always lands on the button.
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dictation.start();
              }
            : undefined
        }
        onPointerUp={dictation.supported ? () => dictation.stop() : undefined}
        // The gesture being taken away still ends the recording. Without this
        // the mic stays live and the label stays on "Listening" forever.
        onPointerCancel={dictation.supported ? () => dictation.stop() : undefined}
        onClick={dictation.supported ? undefined : () => textareaRef.current?.focus()}
      >
        {dictation.supported ? (
          <>
            {dictation.listening ? (
              <Square aria-hidden="true" className="size-4" />
            ) : (
              <Mic aria-hidden="true" className="size-4" />
            )}
            {dictation.listening ? "Listening — release to stop" : "Hold to dictate"}
          </>
        ) : (
          "Type"
        )}
      </Button>
    </div>
  );
}
