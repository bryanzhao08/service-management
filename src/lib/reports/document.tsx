import * as React from "react";
/* eslint-disable jsx-a11y/alt-text -- @react-pdf's <Image> renders into a PDF,
   not the DOM. It takes no alt prop and PDF accessibility is expressed through
   the surrounding text, which every photo here already has (a caption with the
   capture time and the entry it belongs to). */
import { Document, Image, Page, Text, View } from "@react-pdf/renderer";
import {
  EntryType,
  IncidentStatus,
  PropertyCheckResult,
} from "@/generated/prisma/enums";
import type { ReportSource } from "@/lib/db/reports";
import { formatDateTimeArchival, formatClock } from "@/lib/time";
import { COLORS, styles } from "./theme";

/**
 * The report document. Section 11.
 *
 * Every photo is passed in as an already-decoded data URI rather than a URL.
 * @react-pdf can fetch a URL itself, but ours are signed, short-lived and
 * behind auth, so a fetch from inside the renderer would race the expiry and
 * fail silently as a blank box. Resolving the bytes first also means the
 * size-budget algorithm can swap variants without re-plumbing the document.
 */

export type EmbeddedPhoto = {
  id: string;
  dataUri: string;
  capturedAt: Date;
  caption?: string | null;
};

export type ReportDocProps = {
  shift: ReportSource;
  /** Photos keyed by the entry they hang off. */
  photosByEntry: Map<string, EmbeddedPhoto[]>;
  /** Photos from clock-in blind-spot checks, keyed by check id. */
  photosByCheck: Map<string, EmbeddedPhoto[]>;
  gallery: {
    photos: number;
    videos: number;
    url: string;
    qrDataUri: string | null;
    expiresAt: Date;
  };
  meta: {
    reportId: string;
    version: number;
    generatedAt: Date;
    contentHash: string;
    /** Settled by a second render pass; null on the pass that measures it. */
    totalPages?: number | null;
    /** Set when the size budget had to step down; printed so a thin report is explained. */
    sizeNote: string | null;
  };
  /** Per-template caps, already resolved. */
  caps: { perEntry: number; perIncident: number };
};

const TYPE_LABEL: Record<EntryType, string> = {
  CLOCK_IN: "Clock in",
  CLOCK_OUT: "Clock out",
  NOTE: "Note",
  MEDIA: "Photo",
  INCIDENT: "Incident",
  PACKAGE: "Package",
  PATROL: "Patrol",
  PROPERTY_CHECK: "Check",
  BLIND_SPOT_CHECK: "Blind spot",
  BREAK_COVER_START: "Break start",
  BREAK_COVER_END: "Break end",
  HANDOFF_GIVEN: "Handoff out",
  HANDOFF_RECEIVED: "Handoff in",
  VISITOR: "Visitor",
  CUSTOM: "Custom",
};

export function ReportDocument(props: ReportDocProps) {
  const { shift, meta } = props;
  const tz = shift.site.timezone;
  const sections = enabledSections(shift);

  const title = `Shift report — ${formatDateTimeArchival(shift.clockInAt ?? shift.scheduledStart, tz)}${
    shift.template ? ` · ${shift.template.name}` : ""
  }`;

  return (
    <Document
      title={`${shift.site.name} — ${title}`}
      author={shift.site.company.name}
      subject="Shift report"
      creator="Transient"
      producer="Transient"
    >
      <Page size="LETTER" style={styles.page} wrap>
        <Header shift={shift} title={title} />
        <Footer
          meta={meta}
          disclaimer={shift.site.reportTemplate?.headerText ?? null}
        />

        {sections.cover ? <Cover {...props} /> : null}
        {sections.checks ? <ClockInChecks {...props} /> : null}
        {sections.timeline ? <Timeline {...props} /> : null}
        {sections.incidents ? <IncidentDetail {...props} /> : null}
        {sections.packages ? <Packages {...props} /> : null}
        {sections.gallery ? <Gallery {...props} /> : null}
      </Page>
    </Document>
  );
}

/**
 * Section toggles come from the site's `ReportTemplate.sections` JSON.
 *
 * Anything absent from the JSON defaults to **on**. A site configured before a
 * section existed should gain it, not silently lose it — the opposite default
 * means shipping a new section quietly excludes it from every existing site and
 * nobody finds out until a client asks where the package log went.
 */
function enabledSections(shift: ReportSource) {
  const raw = shift.site.reportTemplate?.sections;
  const on = (key: string) => {
    if (!Array.isArray(raw)) return true;
    const found = (raw as Array<{ key?: string; enabled?: boolean }>).find(
      (s) => s?.key === key,
    );
    return found ? found.enabled !== false : true;
  };
  return {
    cover: shift.site.reportTemplate?.coverPage !== false && on("cover"),
    checks: on("checks"),
    timeline: on("timeline"),
    incidents: on("incidents"),
    packages: on("packages"),
    gallery: on("gallery"),
  };
}

// --- chrome -----------------------------------------------------------------

function Header({ shift, title }: { shift: ReportSource; title: string }) {
  return (
    <View style={styles.header} fixed>
      <View style={styles.headerMark}>
        <View style={styles.headerDot} />
        <Text style={styles.headerWord}>TRANSIENT</Text>
      </View>
      <View style={styles.headerRight}>
        <Text style={styles.headerTitle}>
          {shift.site.company.name} · {shift.site.name}
        </Text>
        <Text style={styles.headerMeta}>
          {title} · {shift.guard.name ?? shift.guard.email}
        </Text>
      </View>
    </View>
  );
}

function Footer({
  meta,
  disclaimer,
}: {
  meta: ReportDocProps["meta"];
  disclaimer: string | null;
}) {
  return (
    <>
      <View style={styles.footerRule} fixed />
      <Text style={[styles.footerLeft, styles.footerText]} fixed>
        Report {meta.reportId} v{meta.version} · content SHA-256{" "}
        {meta.contentHash.slice(0, 12)}
        {meta.sizeNote ? ` · ${meta.sizeNote}` : ""}
        {disclaimer ? ` · ${disclaimer}` : ""}
      </Text>
    </>
  );
}

// --- 2. cover ---------------------------------------------------------------

function Cover({ shift, gallery, meta }: ReportDocProps) {
  const tz = shift.site.timezone;
  const live = shift.entries.filter((e) => !e.deletedAt);
  const incidents = live.filter((e) => e.incident).map((e) => e.incident!);
  const blind = shift.blindSpotChecks;
  const counts = countByType(live);

  return (
    <View>
      <Text style={styles.h1}>{shift.site.name}</Text>
      <Text style={styles.muted}>
        {formatDateTimeArchival(shift.clockInAt ?? shift.scheduledStart, tz)}
        {shift.isEventNight ? " · Event night" : ""}
      </Text>

      <View style={styles.factGrid}>
        <Fact
          label="Scheduled"
          value={span(shift.scheduledStart, shift.scheduledEnd, tz)}
        />
        <Fact label="Actual" value={span(shift.clockInAt, shift.clockOutAt, tz)} />
        <Fact
          label="Blind spots"
          value={`${blind.length} of ${shift.site.areas.length || blind.length} checked`}
        />
        <Fact label="Incidents" value={String(incidents.length)} />
      </View>

      {/*
        The integrity block. The footer carries a 12-character prefix on every
        page so a reader can eyeball that pages belong together; the full
        digest lives here once, because it is the value someone actually
        recomputes years later and a truncated hash cannot be verified.
      */}
      <View style={styles.integrity}>
        <Text style={styles.small}>
          Generated {meta.generatedAt.toISOString()} · report {meta.reportId} v
          {meta.version}
        </Text>
        <Text style={styles.hashLine}>Content SHA-256 {meta.contentHash}</Text>
        {meta.totalPages ? (
          <Text style={styles.small}>
            This report is {meta.totalPages} page{meta.totalPages === 1 ? "" : "s"}{" "}
            long. Every page carries the same report id and hash prefix in its footer.
          </Text>
        ) : null}
        <Text style={styles.small}>
          This digest covers the logged facts, not the file. It is recomputable from the
          record and will not change if this report is re-rendered.
        </Text>
      </View>

      {counts.length > 0 ? (
        <View style={styles.countRow}>
          {counts.map((c) => (
            <View key={c.type} style={styles.countChip}>
              <Text style={styles.small}>
                {TYPE_LABEL[c.type]} {c.n}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {incidents.length > 0 ? (
        <>
          <Text style={styles.h2}>Incidents</Text>
          <View style={styles.th}>
            <Text style={[styles.thText, { width: 70 }]}>Code</Text>
            <Text style={[styles.thText, { width: 40 }]}>Time</Text>
            <Text style={[styles.thText, styles.grow]}>Category</Text>
            <Text style={[styles.thText, { width: 62 }]}>Severity</Text>
            <Text style={[styles.thText, { width: 56 }]}>Status</Text>
          </View>
          {live
            .filter((e) => e.incident)
            .map((e) => (
              <View key={e.id} style={styles.tr}>
                <Text style={{ width: 70, fontWeight: 600 }}>{e.incident!.code}</Text>
                <Text style={{ width: 40 }}>{formatClock(e.occurredAt, tz)}</Text>
                <Text style={styles.grow}>
                  {e.incident!.siteEntryType?.label ?? e.incident!.categoryKey}
                </Text>
                <Text
                  style={[
                    { width: 62 },
                    e.incident!.severity
                      ? { color: COLORS.ember, fontWeight: 600 }
                      : {},
                  ]}
                >
                  {e.incident!.severity ?? "—"}
                </Text>
                <Text style={{ width: 56 }}>{statusLabel(e.incident!.status)}</Text>
              </View>
            ))}
        </>
      ) : null}

      {shift.handoffFrom || shift.handoffTo.length > 0 ? (
        <>
          <Text style={styles.h2}>Handoff</Text>
          {shift.handoffFrom ? (
            <Text>
              From {shift.handoffFrom.guard.name ?? shift.handoffFrom.guard.email},
              clocked out {formatClock(shift.handoffFrom.clockOutAt, tz)}.
            </Text>
          ) : null}
          {shift.handoffTo.map((to) => (
            <Text key={to.id}>
              To {to.guard.name ?? to.guard.email}, clocked in{" "}
              {formatClock(to.clockInAt, tz)}.
            </Text>
          ))}
          {shift.handoffNote ? (
            <Text style={{ marginTop: 3 }}>{shift.handoffNote}</Text>
          ) : null}
        </>
      ) : null}

      {shift.summary ? (
        <>
          <Text style={styles.h2}>Shift summary</Text>
          <Text>{shift.summary}</Text>
        </>
      ) : null}

      {gallery.photos + gallery.videos > 0 ? (
        <Text style={[styles.small, styles.muted, { marginTop: 10 }]}>
          {gallery.photos} photo{gallery.photos === 1 ? "" : "s"}
          {gallery.videos > 0
            ? ` and ${gallery.videos} video${gallery.videos === 1 ? "" : "s"}`
            : ""}{" "}
          captured on this shift.
        </Text>
      ) : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

// --- 3. clock-in checks -----------------------------------------------------

function ClockInChecks({ shift, photosByCheck }: ReportDocProps) {
  const tz = shift.site.timezone;
  if (shift.propertyChecks.length === 0 && shift.blindSpotChecks.length === 0)
    return null;

  return (
    <View break={false}>
      <Text style={styles.h2}>Clock-in checks</Text>

      {shift.propertyChecks.length > 0 ? (
        <View style={{ marginBottom: 8 }}>
          <View style={styles.th}>
            <Text style={[styles.thText, styles.grow]}>Property check</Text>
            <Text style={[styles.thText, { width: 70 }]}>Result</Text>
          </View>
          {shift.propertyChecks.map((c) => (
            <View key={c.id} style={styles.tr}>
              <View style={styles.grow}>
                <Text>{c.area.name}</Text>
                {c.note ? (
                  <Text style={[styles.small, styles.muted]}>{c.note}</Text>
                ) : null}
              </View>
              <Text
                style={[
                  { width: 70, fontWeight: 600 },
                  c.result === PropertyCheckResult.CLEAR ? {} : { color: COLORS.ember },
                ]}
              >
                {checkLabel(c.result)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {shift.blindSpotChecks.map((c) => {
        const photos = photosByCheck.get(c.id) ?? [];
        return (
          <View key={c.id} wrap={false} style={{ marginBottom: 6 }}>
            <Text style={styles.h3}>{c.blindSpot.name}</Text>
            <Text style={[styles.small, styles.muted]}>
              {c.verifiedBy
                ? `Verified via ${methodLabel(c.method).toLowerCase()} by ${c.verifiedBy.name ?? c.verifiedBy.email} at ${formatClock(c.at, tz)}`
                : `${methodLabel(c.method)} at ${formatClock(c.at, tz)}`}
            </Text>
            {c.reason ? <Text style={styles.small}>{c.reason}</Text> : null}
            <PhotoGrid photos={photos} tz={tz} />
          </View>
        );
      })}
    </View>
  );
}

// --- 4. timeline ------------------------------------------------------------

function Timeline({ shift, photosByEntry, caps }: ReportDocProps) {
  const tz = shift.site.timezone;
  if (shift.entries.length === 0) return null;

  return (
    <View>
      <Text style={styles.h2}>Timeline</Text>
      {shift.entries.map((e) => {
        const all = photosByEntry.get(e.id) ?? [];
        const shown = all.slice(0, caps.perEntry);
        const hidden = (e.media?.length ?? 0) - shown.length;
        return (
          <View key={e.id} wrap={false}>
            <View style={styles.entry}>
              <Text style={styles.entryTime}>{formatClock(e.occurredAt, tz)}</Text>
              <Text style={styles.entryType}>
                {e.incident ? e.incident.code : TYPE_LABEL[e.type]}
              </Text>
              <View style={styles.entryBody}>
                <Text style={e.deletedAt ? styles.deleted : undefined}>
                  {e.text?.trim() || fallbackText(e.type)}
                </Text>
                {e.area ? (
                  <Text style={[styles.small, styles.muted]}>{e.area.name}</Text>
                ) : null}
                {e.deletedAt ? (
                  <Text style={[styles.small, { color: COLORS.ember }]}>
                    Deleted{e.deleteReason ? `: ${e.deleteReason}` : ""}
                  </Text>
                ) : null}
                {e.revisions.length > 0 ? (
                  <Text style={[styles.small, styles.muted]}>
                    Edited {e.revisions.length} time
                    {e.revisions.length === 1 ? "" : "s"}
                  </Text>
                ) : null}
                <PhotoGrid photos={shown} tz={tz} />
                {hidden > 0 ? (
                  <Text style={[styles.small, styles.muted]}>
                    + {hidden} more in the gallery
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// --- 5. incident detail -----------------------------------------------------

function IncidentDetail({ shift, photosByEntry, caps }: ReportDocProps) {
  const tz = shift.site.timezone;
  const rows = shift.entries.filter((e) => e.incident && !e.deletedAt);
  if (rows.length === 0) return null;

  return (
    <View break>
      <Text style={styles.h2}>Incident detail</Text>
      {rows.map((e) => {
        const inc = e.incident!;
        const photos = (photosByEntry.get(e.id) ?? []).slice(0, caps.perIncident);
        return (
          <View key={e.id} style={styles.incident} wrap={false}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={{ fontWeight: 700 }}>{inc.code}</Text>
              <Text style={styles.sevChip}>
                {inc.severity ?? "unrated"} · {statusLabel(inc.status)}
              </Text>
            </View>
            <Text style={[styles.small, styles.muted]}>
              {inc.siteEntryType?.label ?? inc.categoryKey} ·{" "}
              {formatDateTimeArchival(e.occurredAt, tz)}
              {e.area ? ` · ${e.area.name}` : ""}
            </Text>
            <Text style={{ marginTop: 4 }}>
              {e.text?.trim() || "No description recorded."}
            </Text>
            {inc.ongoingSince ? (
              <Text style={[styles.small, { marginTop: 3 }]}>
                Ongoing since {formatClock(inc.ongoingSince, tz)}.
              </Text>
            ) : null}
            {inc.resolvedAt ? (
              <Text style={[styles.small, { marginTop: 3 }]}>
                Resolved {formatDateTimeArchival(inc.resolvedAt, tz)}
                {inc.resolutionNote ? `: ${inc.resolutionNote}` : "."}
              </Text>
            ) : null}
            <PhotoGrid photos={photos} tz={tz} />
          </View>
        );
      })}
    </View>
  );
}

// --- 6. packages ------------------------------------------------------------

function Packages({ shift }: ReportDocProps) {
  const tz = shift.site.timezone;
  const rows = shift.entries.filter((e) => e.packageInfo && !e.deletedAt);
  if (rows.length === 0) return null;

  return (
    <View>
      <Text style={styles.h2}>Packages</Text>
      <View style={styles.th}>
        <Text style={[styles.thText, { width: 40 }]}>Time</Text>
        <Text style={[styles.thText, styles.grow]}>Recipient</Text>
        <Text style={[styles.thText, styles.cell, { width: 60 }]}>Carrier</Text>
        <Text style={[styles.thText, styles.cell, { width: 118 }]}>Tracking</Text>
        <Text style={[styles.thText, { width: 52 }]}>Released</Text>
      </View>
      {rows.map((e) => (
        <View key={e.id} style={styles.tr}>
          <Text style={{ width: 40 }}>{formatClock(e.occurredAt, tz)}</Text>
          <Text style={styles.grow}>{e.packageInfo!.recipientName ?? "—"}</Text>
          <Text style={[styles.cell, { width: 60 }]}>
            {e.packageInfo!.carrier ?? "—"}
          </Text>
          <Text style={[styles.cell, { width: 118 }]}>
            {e.packageInfo!.trackingNumber ?? "—"}
          </Text>
          <Text style={{ width: 52 }}>
            {e.packageInfo!.deliveredAt
              ? formatClock(e.packageInfo!.deliveredAt, tz)
              : "held"}
          </Text>
        </View>
      ))}
    </View>
  );
}

// --- 7. gallery -------------------------------------------------------------

function Gallery({ shift, gallery }: ReportDocProps) {
  const tz = shift.site.timezone;
  if (gallery.photos + gallery.videos === 0) return null;

  return (
    <View wrap={false} style={{ marginTop: 14 }}>
      <Text style={styles.h2}>Full gallery</Text>
      <View style={[styles.row, { gap: 12, alignItems: "flex-start" }]}>
        {gallery.qrDataUri ? (
          <Image src={gallery.qrDataUri} style={{ width: 64, height: 64 }} />
        ) : null}
        <View style={styles.grow}>
          <Text>
            All {gallery.photos} photo{gallery.photos === 1 ? "" : "s"}
            {gallery.videos > 0
              ? ` and ${gallery.videos} video${gallery.videos === 1 ? "" : "s"}`
              : ""}{" "}
            at full resolution.
          </Text>
          <Text style={[styles.small, { color: COLORS.forest }]}>{gallery.url}</Text>
          <Text style={[styles.small, styles.muted]}>
            Link expires {formatDateTimeArchival(gallery.expiresAt, tz)}.
          </Text>
        </View>
      </View>
    </View>
  );
}

// --- shared -----------------------------------------------------------------

/**
 * A 3-up grid. Rows are chunked rather than wrapped because @react-pdf's
 * `flexWrap` does not cooperate with `wrap={false}`, so a wrapped grid can
 * split one photo's image from its caption across a page break.
 */
function PhotoGrid({ photos, tz }: { photos: EmbeddedPhoto[]; tz: string }) {
  if (photos.length === 0) return null;
  const rows: EmbeddedPhoto[][] = [];
  for (let i = 0; i < photos.length; i += 3) rows.push(photos.slice(i, i + 3));

  return (
    <>
      {rows.map((row, i) => (
        <View key={i} style={styles.photoRow} wrap={false}>
          {row.map((p) => (
            <View key={p.id} style={styles.photoCell}>
              <Image src={p.dataUri} style={[styles.photo, { height: 78 }]} />
              <Text style={styles.caption}>
                {formatClock(p.capturedAt, tz)}
                {p.caption ? ` · ${p.caption}` : ""}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

function countByType(entries: ReportSource["entries"]) {
  const map = new Map<EntryType, number>();
  for (const e of entries) map.set(e.type, (map.get(e.type) ?? 0) + 1);
  return [...map.entries()].map(([type, n]) => ({ type, n }));
}

function span(a: Date | null, b: Date | null, tz: string): string {
  if (!a) return "—";
  return `${formatClock(a, tz)}–${b ? formatClock(b, tz) : "open"}`;
}

function statusLabel(s: IncidentStatus): string {
  return s === IncidentStatus.OPEN
    ? "Open"
    : s === IncidentStatus.ONGOING
      ? "Ongoing"
      : "Resolved";
}

function checkLabel(r: PropertyCheckResult): string {
  return r === PropertyCheckResult.CLEAR
    ? "Clear"
    : r === PropertyCheckResult.DAMAGE
      ? "Damage"
      : "Skipped";
}

function methodLabel(m: string): string {
  return m === "CAMERA_ROOM"
    ? "Camera room"
    : m === "PHOTO"
      ? "Photographed"
      : "Walked";
}

/** An entry with no text still needs a line, or the timeline has a silent gap. */
function fallbackText(type: EntryType): string {
  switch (type) {
    case EntryType.CLOCK_IN:
      return "Clocked in.";
    case EntryType.CLOCK_OUT:
      return "Clocked out.";
    case EntryType.PATROL:
      return "Patrol completed.";
    case EntryType.MEDIA:
      return "Photo logged.";
    case EntryType.HANDOFF_GIVEN:
      return "Handoff given.";
    case EntryType.HANDOFF_RECEIVED:
      return "Handoff received.";
    case EntryType.PROPERTY_CHECK:
      return "Property check recorded.";
    case EntryType.BLIND_SPOT_CHECK:
      return "Blind spot checked.";
    default:
      return "—";
  }
}
