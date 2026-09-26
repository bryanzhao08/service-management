import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import sharp from "sharp";
import {
  embeddableMedia,
  galleryCounts,
  reportSource,
  type ReportSource,
} from "@/lib/db/reports";
import { storage } from "@/lib/storage/driver";
import {
  accept,
  budgetLadder,
  countPages,
  describeSteps,
  type BudgetStep,
} from "./budget";
import { ReportDocument, type EmbeddedPhoto, type ReportDocProps } from "./document";
import { contentHash, sha256 } from "./hash";
import { registerFonts } from "./theme";

export type RenderedReport = {
  buffer: Buffer;
  bytes: number;
  pages: number;
  /** SHA-256 of the finished file. See the note in `hash.ts`. */
  fileHash: string;
  /** SHA-256 of the facts, printed inside the document. */
  contentHash: string;
  steps: string[];
};

type MediaRow = Awaited<ReturnType<typeof embeddableMedia>>[number];

export async function renderReport(input: {
  shiftId: string;
  reportId: string;
  version: number;
  galleryUrl: string;
  galleryExpiresAt: Date;
}): Promise<RenderedReport> {
  registerFonts();

  const shift = await reportSource(input.shiftId);
  if (!shift) throw new Error(`shift ${input.shiftId} is gone`);

  const [media, gallery] = await Promise.all([
    embeddableMedia(input.shiftId),
    galleryCounts(input.shiftId),
  ]);

  const caps = {
    perEntry: shift.site.reportTemplate?.maxPhotosPerEntry ?? 3,
    perIncident: shift.site.reportTemplate?.maxPhotosPerIncident ?? 6,
  };
  const embedPhotos = shift.site.reportTemplate?.embedPhotos !== false;

  const qrDataUri = await qr(input.galleryUrl);
  const digest = contentHash(shift);
  const generatedAt = new Date();

  const ladder = budgetLadder(caps);
  const steps: BudgetStep[] = [];
  let out: Buffer | null = null;
  let note: string | null = null;
  // Carried between passes so the cover can state how long the document is.
  // See `settlePageCount` below for why this is not @react-pdf's `render`.
  // Null on every ladder pass: the length is not knowable until the document
  // exists. `settlePageCount` supplies the real number to the final pass.
  const totalPages: number | null = null;
  let chosen: ReportDocProps | null = null;

  for (let rung = 0; rung < ladder.length; rung++) {
    const plan = ladder[rung];

    // `embedPhotos: false` is a site choice, not a budget outcome. It short
    // circuits the ladder rather than walking it: there is nothing to step
    // down when there is nothing embedded.
    const photos = embedPhotos
      ? await loadPhotos(media, plan)
      : new Map<string, Buffer>();

    const props: ReportDocProps = {
      shift,
      photosByEntry: groupByEntry(media, photos),
      photosByCheck: groupByCheck(shift, media, photos),
      gallery: {
        ...gallery,
        url: input.galleryUrl,
        qrDataUri,
        expiresAt: input.galleryExpiresAt,
      },
      meta: {
        reportId: input.reportId,
        version: input.version,
        generatedAt,
        contentHash: digest,
        sizeNote: plan.note,
        totalPages,
      },
      caps: { perEntry: plan.perEntry, perIncident: plan.perIncident },
    };
    const buffer = await renderToBuffer(ReportDocument(props));

    const underCap = accept(buffer.length, rung, ladder.length);
    steps.push({
      step: rung + 1,
      plan: {
        variant: plan.variant,
        reencode: plan.reencode,
        perEntry: plan.perEntry,
        perIncident: plan.perIncident,
      },
      bytes: buffer.length,
      underCap,
    });

    if (underCap || !embedPhotos) {
      out = buffer;
      note = plan.note;
      chosen = props;
      break;
    }
  }

  if (!out) throw new Error("size budget ladder produced nothing, which cannot happen");
  void note;

  if (!chosen)
    throw new Error("ladder chose a buffer without props, which cannot happen");
  const settled = chosen;
  out = await settlePageCount(out, (pages) =>
    renderToBuffer(
      ReportDocument({ ...settled, meta: { ...settled.meta, totalPages: pages } }),
    ),
  );

  return {
    buffer: out,
    bytes: out.length,
    pages: countPages(out),
    fileHash: sha256(out),
    contentHash: digest,
    steps: describeSteps(steps),
  };
}

/**
 * Stamp the document's own length onto its cover, in at most two extra passes.
 *
 * @react-pdf's `render` prop is the documented way to do `Page N of M`, and it
 * does not work in 7.0.x. Four variants were tried against real renders —
 * absolute, nested inside a laid-out Text, right/bottom with no width, and a
 * plain sibling in a row — and all four painted nothing. Worse, the broken
 * child takes its parent with it: the same footer rendered correctly the
 * moment the `render` sibling was deleted and vanished again when it was put
 * back. So `render` is not used anywhere in this document.
 *
 * So the length is settled by rendering, counting the pages in the finished
 * bytes, and rendering once more with that number in hand. Adding the text can
 * in principle change the pagination, so the count is re-checked and the pass
 * repeated once; if it still disagrees the un-numbered document is kept,
 * because a report that understates its own length is worse than one that does
 * not claim a length at all.
 */
async function settlePageCount(
  first: Buffer,
  again: (pages: number) => Promise<Buffer>,
): Promise<Buffer> {
  let current = first;
  for (let attempt = 0; attempt < 2; attempt++) {
    const want = countPages(current);
    const next = await again(want);
    if (countPages(next) === want) return next;
    current = next;
  }
  return first;
}

/**
 * Pull the bytes for one rung of the ladder.
 *
 * Failures are swallowed per photo on purpose. One unreadable object should
 * cost the report that one image, not the whole document — the guard's night
 * still needs to reach the client. A missing photo shows as a gap the gallery
 * line already accounts for.
 */
async function loadPhotos(
  media: MediaRow[],
  plan: {
    variant: "pdf" | "medium" | "thumb";
    reencode: { longEdge: number; quality: number } | null;
  },
): Promise<Map<string, Buffer>> {
  const s = storage();
  const out = new Map<string, Buffer>();

  await Promise.all(
    media.map(async (m) => {
      const key =
        plan.variant === "thumb"
          ? (m.storageKeyThumb ?? m.storageKeyPdf ?? m.storageKeyOriginal)
          : (m.storageKeyPdf ?? m.storageKeyOriginal);
      try {
        const raw = await s.get(key);
        if (!plan.reencode) {
          out.set(m.id, raw);
          return;
        }
        const shrunk = await sharp(raw)
          .rotate()
          .resize({
            width: plan.reencode.longEdge,
            height: plan.reencode.longEdge,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: plan.reencode.quality })
          .toBuffer();
        out.set(m.id, shrunk);
      } catch {
        // Deliberate: see the doc comment.
      }
    }),
  );

  return out;
}

function toDataUri(buf: Buffer): string {
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

function groupByEntry(media: MediaRow[], bytes: Map<string, Buffer>) {
  const out = new Map<string, EmbeddedPhoto[]>();
  for (const m of media) {
    if (!m.entryId) continue;
    const buf = bytes.get(m.id);
    if (!buf) continue;
    const list = out.get(m.entryId) ?? [];
    list.push({ id: m.id, dataUri: toDataUri(buf), capturedAt: m.capturedAt });
    out.set(m.entryId, list);
  }
  return out;
}

function groupByCheck(
  shift: ReportSource,
  media: MediaRow[],
  bytes: Map<string, Buffer>,
) {
  const byId = new Map(media.map((m) => [m.id, m]));
  const out = new Map<string, EmbeddedPhoto[]>();
  for (const check of shift.blindSpotChecks) {
    if (!check.mediaId) continue;
    const m = byId.get(check.mediaId);
    const buf = m ? bytes.get(m.id) : undefined;
    if (!m || !buf) continue;
    out.set(check.id, [
      { id: m.id, dataUri: toDataUri(buf), capturedAt: m.capturedAt },
    ]);
  }
  return out;
}

async function qr(url: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(url, {
      margin: 1,
      width: 256,
      errorCorrectionLevel: "M",
      color: { dark: "#030701ff", light: "#ffffffff" },
    });
  } catch {
    return null;
  }
}
