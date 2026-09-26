import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DictateField } from "@/components/shift/dictate-field";

/**
 * Press-and-hold dictation had no tests, and shipped with a hole big enough to
 * strand the microphone on.
 *
 * The engine is stubbed rather than mocked away, because what failed was never
 * the speech recognition — it was the wiring around it. The stub records the
 * calls the component makes, so a test can assert "the app asked it to stop"
 * without needing a real one.
 */

type Handler = ((...args: never[]) => void) | null;

interface Instance {
  id: number;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: Handler;
  onerror: Handler;
  onend: Handler;
  start(): void;
  stop(): void;
  abort(): void;
}

let calls: string[] = [];
let instances: Instance[] = [];
/** When true the stub ends the moment it starts, like an engine that cannot run. */
let endsImmediately = false;

function installEngine() {
  calls = [];
  instances = [];
  endsImmediately = false;
  let nextId = 0;

  class StubRecognition {
    id = (nextId += 1);
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: Handler = null;
    onerror: Handler = null;
    onend: Handler = null;

    constructor() {
      instances.push(this as unknown as Instance);
      calls.push(`new#${this.id}`);
    }
    start() {
      calls.push(`start#${this.id}`);
      if (endsImmediately) this.onend?.();
    }
    stop() {
      calls.push(`stop#${this.id}`);
      this.onend?.();
    }
    abort() {
      calls.push(`abort#${this.id}`);
      this.onend?.();
    }
  }

  (window as unknown as Record<string, unknown>).SpeechRecognition = StubRecognition;
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition =
    StubRecognition;
}

function removeEngine() {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
}

function renderField() {
  let value = "";
  const view = render(
    <DictateField
      label="What happened?"
      value={value}
      onValueChange={(next) => {
        value = next;
      }}
      onRawChange={() => {}}
    />,
  );
  return { view, read: () => value };
}

const holdButton = () =>
  screen.getByRole("button", { name: /hold to dictate|listening/i });

beforeEach(() => installEngine());
afterEach(() => removeEngine());

describe("press-and-hold dictation", () => {
  it("starts on press and stops on release", () => {
    renderField();
    const button = holdButton();

    fireEvent.pointerDown(button, { pointerId: 1 });
    expect(calls).toEqual(["new#1", "start#1"]);
    expect(holdButton()).toHaveTextContent(/listening/i);

    fireEvent.pointerUp(button, { pointerId: 1 });
    expect(calls).toContain("stop#1");
    expect(
      screen.getByRole("button", { name: /hold to dictate/i }),
    ).toBeInTheDocument();
  });

  /**
   * The bug that started this. The button lives inside the sheet's
   * `overflow-y-auto` body, so a thumb drifting while held lets the browser
   * claim the gesture for scrolling. It fires `pointercancel` and, per spec,
   * NO `pointerup` follows — so a handler on release alone never runs and the
   * microphone stays live with the label stuck on "Listening".
   */
  it("stops when the browser takes the gesture away", () => {
    renderField();
    const button = holdButton();

    fireEvent.pointerDown(button, { pointerId: 1 });
    expect(holdButton()).toHaveTextContent(/listening/i);

    fireEvent.pointerCancel(button, { pointerId: 1 });

    expect(calls).toContain("stop#1");
    expect(
      screen.getByRole("button", { name: /hold to dictate/i }),
    ).toBeInTheDocument();
  });

  /**
   * Chrome ends a session on a network timeout and iOS Safari after a single
   * utterance, both regardless of `continuous`. Honouring that mid-hold drops
   * the rest of the sentence on the floor while the guard is still speaking.
   */
  it("keeps listening when the engine ends itself mid-hold", () => {
    renderField();
    const button = holdButton();

    fireEvent.pointerDown(button, { pointerId: 1 });
    expect(instances).toHaveLength(1);

    // The engine gives up on its own while the button is still down.
    act(() => instances[0].onend?.());

    expect(instances.length).toBeGreaterThan(1);
    expect(calls).toContain("start#2");
    expect(holdButton()).toHaveTextContent(/listening/i);
  });

  it("does not restart after the guard lets go", () => {
    renderField();
    const button = holdButton();

    fireEvent.pointerDown(button, { pointerId: 1 });
    fireEvent.pointerUp(button, { pointerId: 1 });
    const settled = instances.length;

    // A late `onend` from the engine must not revive it.
    act(() => instances[0].onend?.());

    expect(instances).toHaveLength(settled);
    expect(
      screen.getByRole("button", { name: /hold to dictate/i }),
    ).toBeInTheDocument();
  });

  /**
   * The restart above is a loop, so it needs a floor. An engine that cannot run
   * at all ends the instant it starts; restarting that forever would spin the
   * tab rather than telling the guard to type.
   */
  it("gives up instead of spinning when the engine cannot run", () => {
    endsImmediately = true;
    renderField();

    fireEvent.pointerDown(holdButton(), { pointerId: 1 });

    expect(instances.length).toBeLessThanOrEqual(5);
    expect(screen.getByRole("alert")).toHaveTextContent(/type instead/i);
    expect(
      screen.getByRole("button", { name: /hold to dictate/i }),
    ).toBeInTheDocument();
  });

  /**
   * The preventative half. `touch-action: none` is what stops the browser
   * deciding the hold was a scroll in the first place.
   */
  it("opts the button out of browser gesture handling", () => {
    renderField();
    expect(holdButton().className).toContain("touch-none");
  });
});

describe("without a speech engine", () => {
  it("offers typing instead of a mic that cannot work", () => {
    removeEngine();
    renderField();

    expect(screen.getByRole("button", { name: /^type$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /hold to dictate/i }),
    ).not.toBeInTheDocument();
  });
});
