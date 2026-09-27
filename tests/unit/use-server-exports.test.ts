import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A "use server" module may only export async functions.
 *
 * Next.js enforces this, but it enforces it *when the module is loaded to
 * handle a request* -- not at compile time. That distinction cost a working
 * feature here. `settings/team/actions.ts` exported its initial form state as
 * a plain object:
 *
 *     export const INVITE_INITIAL: InviteState = { ok: false, ... };
 *
 * Every gate this repo has went green on it. `tsc --noEmit` exits 0, because
 * the export is perfectly valid TypeScript. ESLint exits 0. `next build` exits
 * 0 on a cold build with `.next` deleted, and never prints the words "use
 * server". The db tests exit 0, because they import the data layer directly
 * and never load the action module through Next's compiler at all.
 *
 * The page still 500'd on every single submit:
 *
 *     Error: A "use server" file can only export async functions, found object.
 *
 * So the feature was broken in the one way that no automated check in the
 * repository could see, and only opening it in a browser found it. That is
 * what this test exists to replace. The three other forms in this app all get
 * it right by declaring their initial state locally in the client component
 * (`sign-in-form.tsx`, `pin-forms.tsx`, `contact-form.tsx`) -- the convention
 * was already correct and simply undocumented and unenforced.
 *
 * The check keys on the leading directive rather than on the presence of the
 * string, because a client component that merely *mentions* "use server" in a
 * comment is not a server module. `invite-form.tsx` does exactly that and is a
 * legitimate non-async export, so matching on text alone reports it falsely.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** True only when "use server" is the file's leading directive. */
function isServerModule(text: string): boolean {
  let body = text;
  // Strip leading blank lines, line comments and block comments.
  for (;;) {
    const trimmed = body.replace(/^\s+/, "");
    if (trimmed.startsWith("//")) {
      body = trimmed.slice(trimmed.indexOf("\n") + 1);
      continue;
    }
    if (trimmed.startsWith("/*")) {
      body = trimmed.slice(trimmed.indexOf("*/") + 2);
      continue;
    }
    body = trimmed;
    break;
  }
  return /^["']use server["']\s*;?/.test(body);
}

/** Exports that are legal in a server module. */
const ALLOWED = [
  // Types are erased before the module ever runs.
  /^export\s+(type|interface)\b/,
  /^export\s+async\s+function\b/,
  // `export const foo = async () => {}` is an async function too.
  /^export\s+(const|let|var)\s+\w+(\s*:[^=]+)?=\s*async\b/,
];

describe('"use server" modules', () => {
  it("export nothing but async functions", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      if (!isServerModule(text)) continue;

      const rel = relative(SRC, file);
      text.split("\n").forEach((line, i) => {
        if (!/^export\b/.test(line)) return;
        if (ALLOWED.some((p) => p.test(line))) return;
        offenders.push(`${rel}:${i + 1} ${line.trim().slice(0, 80)}`);
      });
    }

    // Named rather than counted, so a failure says which line to open.
    expect(offenders).toEqual([]);
  });

  it("is looking at the files it claims to, and not at client components", () => {
    // A guard against the check silently passing because it matched nothing.
    const serverModules = sourceFiles(SRC).filter((f) =>
      isServerModule(readFileSync(f, "utf8")),
    );
    expect(serverModules.length).toBeGreaterThan(5);

    // invite-form.tsx is a client component whose comment mentions "use
    // server". Matching on the string instead of the directive flags it.
    const inviteForm = join(SRC, "app/settings/team/invite-form.tsx");
    const inviteText = readFileSync(inviteForm, "utf8");
    expect(inviteText).toContain("use server");
    expect(isServerModule(inviteText)).toBe(false);
  });
});
