import { formatInTimeZone } from "date-fns-tz";

/**
 * Time formatting for a product where the reader and the event are routinely
 * in different timezones.
 *
 * Every wall-clock string is rendered in the **site's** timezone, never the
 * server's and never the browser's. A supervisor in another state reading
 * "02:14" must see the time the guard saw on their watch, because that is the
 * time that will be quoted back in an insurance claim or a police report.
 */

/** e.g. `02:14` — 24-hour, so 2am and 2pm can never be confused in a log. */
export function formatClock(when: Date | null | undefined, timeZone: string): string {
  if (!when) return "—";
  return formatInTimeZone(when, timeZone, "HH:mm");
}

/** e.g. `Mon 24 Feb, 02:14` — for anything that may be read days later. */
export function formatDateTime(
  when: Date | null | undefined,
  timeZone: string,
): string {
  if (!when) return "—";
  return formatInTimeZone(when, timeZone, "EEE d MMM, HH:mm");
}

/**
 * e.g. `Mon 24 Feb 2026, 02:14` — the archival form, for the PDF.
 *
 * The year is redundant in the app, where you are looking at today's shift,
 * and it is the whole point in a report. These documents get pulled out of an
 * email thread by an insurance adjuster eighteen months after the shift, and a
 * date with no year is not evidence of anything.
 */
export function formatDateTimeArchival(
  when: Date | null | undefined,
  timeZone: string,
): string {
  if (!when) return "—";
  return formatInTimeZone(when, timeZone, "EEE d MMM yyyy, HH:mm");
}

/** The hour bucket a timeline entry belongs to, e.g. `02:00`. */
export function hourBucket(when: Date, timeZone: string): string {
  return formatInTimeZone(when, timeZone, "HH:00");
}

/**
 * Elapsed time as `3h 42m`, or `4m 12s` under an hour.
 *
 * Seconds are dropped above an hour deliberately: a shift timer that ticks
 * every second is movement in the corner of the eye all night, and the guard
 * does not need that precision. Under an hour, seconds are the whole point —
 * "clock-in checks complete in 4m 12s" is the number the product is selling.
 */
export function formatElapsed(from: Date, to: Date): string {
  const totalSeconds = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
