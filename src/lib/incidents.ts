import { formatInTimeZone } from "date-fns-tz";

/**
 * Incident codes: `WH-0924-03` — site code, date, daily sequence (section 9.3).
 *
 * The date part is computed **in the site's timezone**, not the server's. A
 * graveyard shift runs across midnight UTC while still being one night's work
 * at the property, so a UTC date would split a single night's incidents across
 * two code prefixes and make the code useless for the thing it exists for:
 * a manager reading "WH-0924-03" and knowing which night that was.
 */

export function incidentDatePart(when: Date, timezone: string): string {
  return formatInTimeZone(when, timezone, "MMdd");
}

export function formatIncidentCode(
  siteCode: string,
  when: Date,
  timezone: string,
  sequence: number,
): string {
  const date = incidentDatePart(when, timezone);
  return `${siteCode.toUpperCase()}-${date}-${String(sequence).padStart(2, "0")}`;
}

/** The `WH-0924-` stem every incident that night shares, for a prefix count. */
export function incidentCodePrefix(
  siteCode: string,
  when: Date,
  timezone: string,
): string {
  return `${siteCode.toUpperCase()}-${incidentDatePart(when, timezone)}-`;
}

/**
 * The next free sequence given the codes already issued that night.
 *
 * Deliberately `max + 1` rather than `count + 1`. Counting would re-issue a
 * code after an entry is soft-deleted, and two different incidents sharing
 * `WH-0924-03` in the same night's report is exactly the ambiguity the code
 * exists to remove. Sequences may therefore have gaps, which is correct.
 */
export function nextSequence(existingCodes: readonly string[]): number {
  let highest = 0;
  for (const code of existingCodes) {
    const tail = code.slice(code.lastIndexOf("-") + 1);
    const value = Number.parseInt(tail, 10);
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return highest + 1;
}
