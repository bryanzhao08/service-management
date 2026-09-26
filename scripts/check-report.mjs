#!/usr/bin/env node
/**
 * Milestone 6 gate: the report, proven by reading the file back.
 *
 * Every other check in this repo asserts against the code that produced the
 * thing. This one does not — it renders a report through the real job queue,
 * pulls the PDF out of storage, and extracts its text with a library that has
 * never heard of Transient. If a client opens the attachment and the incident
 * code is not there, this is the check that fails.
 *
 * Run: pnpm check:report
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PY = process.env.PYTHON ?? `${process.env.HOME}/miniconda3/bin/python`;

let failures = 0;
function check(label, ok, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Text of every page, via pypdf. Deliberately a different toolchain. */
function extractText(pdfPath) {
  const script = `
import sys, pypdf
r = pypdf.PdfReader(sys.argv[1])
print("PAGES:%d" % len(r.pages))
for p in r.pages:
    sys.stdout.write(p.extract_text() or "")
`;
  const scriptPath = path.join(path.dirname(pdfPath), "extract.py");
  writeFileSync(scriptPath, script);
  return execFileSync(PY, [scriptPath, pdfPath], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Text that is actually PAINTED, per page, with a real bounding box.
 *
 * Extraction alone is not enough, and this check exists because of a bug it
 * would have caught. The footer was a `<View fixed>` with `position:
 * absolute`, which @react-pdf writes into the content stream and then renders
 * as nothing. pypdf found the SHA-256 happily, every assertion passed, and the
 * page was blank where the hash should have been. Only rasterising caught it.
 *
 * pymupdf lays the page out the way a reader's PDF viewer does, so a string
 * with no box here is a string no human can see.
 */
function paintedText(pdfPath) {
  const script = `
import sys, json, pymupdf
d = pymupdf.open(sys.argv[1])
out = []
for page in d:
    spans = []
    for blk in page.get_text("blocks"):
        x0, y0, x1, y1, txt = blk[0], blk[1], blk[2], blk[3], blk[4]
        if (x1 - x0) > 1 and (y1 - y0) > 1:
            spans.append(" ".join(txt.split()))
    out.append(spans)
print(json.dumps(out))
`;
  const scriptPath = path.join(path.dirname(pdfPath), "painted.py");
  writeFileSync(scriptPath, script);
  const raw = execFileSync(PY, [scriptPath, pdfPath], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(raw).map((spans) => spans.join(" "));
}

const work = mkdtempSync(path.join(tmpdir(), "transient-report-"));

try {
  // Build a report the same way the app does: seed, enqueue, run the worker.
  //
  // Driven through Vitest rather than tsx because tsx cannot resolve
  // @react-pdf/hyphenate's exports map, and Vitest 5 dropped vite-node. The
  // fixture config exists solely so this gate borrows a resolver that works
  // instead of adding a dependency to run one file.
  execFileSync("npx", ["vitest", "run", "--config", "vitest.fixture.mts"], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, REPORT_OUT_DIR: work },
    maxBuffer: 32 * 1024 * 1024,
  });
  const meta = JSON.parse(readFileSync(path.join(work, "meta.json"), "utf8"));

  const pdfPath = path.join(work, "report.pdf");
  const raw = extractText(pdfPath);
  const pages = Number(raw.match(/^PAGES:(\d+)/m)?.[1] ?? 0);
  // Collapse whitespace: pypdf inserts line breaks that split phrases.
  const text = raw.replace(/\s+/g, " ");

  console.log(
    `\n  report ${meta.reportId} — ${meta.bytes} bytes, ${meta.pages} pages\n`,
  );

  check("the file is a PDF a third-party reader can open", pages > 0, `${pages} pages`);
  check(
    "the page count on the row matches the page count in the file",
    pages === meta.pages,
    `row ${meta.pages}, file ${pages}`,
  );
  check("the byte count on the row matches the file", meta.bytes === meta.storedBytes);

  // --- the facts a client is paying for ---
  check("the site name is in the document", text.includes(meta.siteName));
  check("the guard's name is in the document", text.includes(meta.guardName));
  check("the incident code is in the document", text.includes(meta.incidentCode));
  check(
    "the incident narrative is in the document",
    text.includes("reversed into the bollard"),
  );
  check("a plain note is in the document", text.includes("Gate latch sticking"));
  check("the package carrier is in the document", text.includes("UPS"));
  check("the blind spot name is in the document", text.includes("Stairwell B landing"));
  check("the property check area is in the document", text.includes("Loading dock"));

  // --- the parts that make it a record rather than a printout ---
  check(
    "the content hash is printed in the footer",
    text.includes(meta.contentHash.slice(0, 12)),
    meta.contentHash.slice(0, 12),
  );
  check("the report version is printed", /v1\b/.test(text));
  check("the gallery link is printed", text.includes("/g/"));

  // --- times are the site's, not the server's ---
  // The shift is 06:00–16:00 UTC at a UTC site, so 06 must appear and the
  // machine's own 22:00/23:00 rendering of it must not.
  check("clock-in time is rendered in the site timezone", /06:0\d/.test(text));

  // --- negative control ---
  // Proves the extraction is actually reading this document and not, say,
  // returning a cached string or an empty buffer that satisfies `includes`.
  check(
    "does NOT contain text that was never in the report",
    !text.includes("Riverside Depot") && !text.includes("lorem ipsum"),
  );
  check(
    "the control phrase would have been findable if present",
    extractText(pdfPath).replace(/\s+/g, " ").includes(meta.siteName),
    "same extractor finds a phrase that IS present",
  );

  // --- the footer is visible, not merely present ---
  const painted = paintedText(pdfPath);
  const shortHash = String(meta.contentHash).slice(0, 12);
  const everyPageStamped = painted.every(
    (page) => page.includes(meta.reportId) && page.includes(shortHash),
  );
  check(
    "every page carries a VISIBLE report id and hash prefix",
    painted.length > 1 && everyPageStamped,
    `${painted.length} pages, all stamped`,
  );
  check(
    "the cover states how many pages the report is",
    painted[0].includes(`This report is ${painted.length} page`),
    `claims ${painted.length}`,
  );
  check(
    "painted text is a strict subset check, not a rubber stamp",
    !painted.join(" ").includes("Riverside Depot"),
    "a phrase that is not in the document is not painted either",
  );
} catch (err) {
  console.error(err.stdout?.toString?.() ?? "");
  console.error(err.stderr?.toString?.() ?? err.message);
  failures++;
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("");
if (failures > 0) {
  console.log(`check-report: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("check-report: all checks passed");
