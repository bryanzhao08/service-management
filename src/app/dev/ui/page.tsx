"use client";

import {
  Activity,
  Camera,
  FileText,
  Flashlight,
  Mic,
  Plus,
  Trash2,
} from "lucide-react";
import * as React from "react";

import { Logo, Mark, Wordmark } from "@/components/brand";
import { Badge, StatusChip, type ReportStatus } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checklist, type ChecklistItem } from "@/components/ui/checklist";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { OfflineBanner } from "@/components/ui/offline-banner";
import { PhotoGrid, type PhotoTile } from "@/components/ui/photo-grid";
import { BottomSheet, Dialog, SheetRoot, SheetTrigger } from "@/components/ui/sheet";
import { StatusTracker } from "@/components/ui/status-tracker";
import { Timeline } from "@/components/ui/timeline";
import { Countdown, ElapsedTimer } from "@/components/ui/timer";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { Checkbox, SegmentedControl, Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

const ALL_STATUSES: ReportStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "SENDING",
  "DELIVERED",
  "OPENED",
  "BOUNCED",
  "FAILED",
];

/** Fixed instants so the gallery renders identically on every load. */
const T0 = new Date("2026-03-14T22:04:00Z");
const T1 = new Date("2026-03-14T22:41:00Z");
const T2 = new Date("2026-03-14T23:18:00Z");

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold tracking-wide uppercase">{title}</h2>
        {note ? <p className="text-xs text-text-muted">{note}</p> : null}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="md"
        variant="secondary"
        onClick={() =>
          toast({
            title: "Checkpoint logged",
            tone: "success",
            description: "Dock B, 23:18",
          })
        }
      >
        Success
      </Button>
      <Button
        size="md"
        variant="ghost"
        onClick={() =>
          toast({
            title: "Saved offline",
            tone: "attention",
            description: "Will sync when you're back.",
          })
        }
      >
        Attention
      </Button>
      <Button
        size="md"
        variant="ghost"
        onClick={() =>
          toast({
            title: "Upload failed",
            tone: "danger",
            action: { label: "Retry", onClick: () => undefined },
          })
        }
      >
        Danger
      </Button>
    </div>
  );
}

function Gallery() {
  // Anchored once, not per render. `Date.now()` in the render body is
  // re-evaluated on every tick, which would slide the countdown targets
  // forward a second at a time so they never actually reach zero.
  const [anchor] = React.useState(() => Date.now());
  const [checklist, setChecklist] = React.useState<ChecklistItem[]>([
    { id: "a", label: "Main lobby doors", done: true, doneAt: T0 },
    {
      id: "b",
      label: "Loading dock B",
      done: false,
      requiresPhoto: true,
      photoCount: 0,
    },
    { id: "c", label: "Roof access", done: false, requiresPhoto: true, photoCount: 2 },
    { id: "d", label: "Parking level 2", done: false },
  ]);
  const [segment, setSegment] = React.useState<"all" | "mine" | "flagged">("all");
  const [toggled, setToggled] = React.useState(true);
  const [checked, setChecked] = React.useState(false);
  const [text, setText] = React.useState("");

  const photos: PhotoTile[] = [
    { id: "p1", src: null, alt: "Dock B door", status: "uploaded" },
    { id: "p2", src: null, alt: "Broken light", status: "uploading", progress: 0.45 },
    { id: "p3", src: null, alt: "Gate latch", status: "failed" },
  ];

  return (
    <div className="flex flex-col gap-10 p-5">
      <Section title="Brand" note="Wordmark, mark, lockup">
        <div className="flex flex-wrap items-center gap-6">
          <Wordmark className="text-3xl" />
          <Mark className="size-10" />
          <Mark className="size-10" inverted />
          <Logo />
        </div>
      </Section>

      <Section title="Buttons" note="Variants x sizes. Every one clears 48px.">
        {(["primary", "secondary", "ghost", "danger"] as const).map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-2">
            {(["md", "lg", "xl"] as const).map((size) => (
              <Button key={size} variant={variant} size={size}>
                {variant} {size}
              </Button>
            ))}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button busy>Submitting</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Add entry" variant="primary">
            <Plus className="size-5" aria-hidden="true" />
          </IconButton>
          <IconButton label="Take photo">
            <Camera className="size-5" aria-hidden="true" />
          </IconButton>
          <IconButton label="Dictate note">
            <Mic className="size-5" aria-hidden="true" />
          </IconButton>
          <IconButton label="Delete" variant="danger">
            <Trash2 className="size-5" aria-hidden="true" />
          </IconButton>
        </div>
        <Button fullWidth size="xl">
          End shift &amp; send report
        </Button>
      </Section>

      <Section title="Status" note="Colour plus a shape, never colour alone.">
        <div className="flex flex-wrap gap-2">
          {ALL_STATUSES.map((status) => (
            <StatusChip key={status} status={status} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="neutral">Neutral</Badge>
          <Badge tone="primary">Primary</Badge>
          <Badge tone="attention">Attention</Badge>
          <Badge tone="danger">Danger</Badge>
          <Badge tone="outline">Outline</Badge>
        </div>
      </Section>

      <Section title="Card">
        <Card>
          <CardHeader>
            <CardTitle>Harbour Point — Night patrol</CardTitle>
            <CardDescription>Thu 14 Mar · 22:00–06:00</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            4 checkpoints, 1 incident, 6 photos.
          </CardContent>
          <CardFooter>
            <Button size="md" variant="secondary">
              Open
            </Button>
            <Button size="md" variant="ghost">
              Export PDF
            </Button>
          </CardFooter>
        </Card>
      </Section>

      <Section title="Form">
        <Field label="Site" required hint="Where this shift is posted.">
          <Select defaultValue="harbour">
            <option value="harbour">Harbour Point</option>
            <option value="rail">Rail Yard 4</option>
          </Select>
        </Field>
        <Field label="Badge number" required>
          <Input inputMode="numeric" placeholder="e.g. 4417" />
        </Field>
        <Field
          label="Incident note"
          hint="Plain language is fine. This goes straight into the report."
          error={
            text.length > 0 && text.length < 10 ? "Give at least a sentence." : null
          }
        >
          <Textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="What happened, where, and what you did."
          />
        </Field>
        <Toggle
          label="Push reminders"
          description="Nudge me if a checkpoint is overdue."
          checked={toggled}
          onCheckedChange={setToggled}
        />
        <div className="flex items-center gap-3">
          <Checkbox
            id="gallery-checkbox"
            checked={checked}
            onCheckedChange={(next) => setChecked(next === true)}
          />
          <label htmlFor="gallery-checkbox" className="text-[15px]">
            Include photos in the client PDF
          </label>
        </div>
        <SegmentedControl
          label="Report filter"
          value={segment}
          onValueChange={setSegment}
          options={[
            { value: "all", label: "All" },
            { value: "mine", label: "Mine" },
            { value: "flagged", label: "Flagged" },
          ]}
        />
      </Section>

      <Section
        title="Checklist"
        note="A photo-required row cannot be ticked without one."
      >
        <Checklist
          items={checklist}
          onToggle={(id, next) =>
            setChecklist((current) =>
              current.map((item) =>
                item.id === id
                  ? { ...item, done: next, doneAt: next ? new Date() : null }
                  : item,
              ),
            )
          }
          onAddPhoto={(id) =>
            setChecklist((current) =>
              current.map((item) =>
                item.id === id
                  ? { ...item, photoCount: (item.photoCount ?? 0) + 1 }
                  : item,
              ),
            )
          }
        />
      </Section>

      <Section title="Photos">
        <PhotoGrid
          photos={photos}
          max={8}
          onAdd={() => undefined}
          onRemove={() => undefined}
        />
      </Section>

      <Section title="Timeline">
        <Timeline
          entries={[
            {
              id: "1",
              at: T0,
              title: "Shift started",
              tone: "primary",
              icon: Activity,
            },
            {
              id: "2",
              at: T1,
              title: "Checkpoint: Main lobby",
              detail: "All doors secure.",
            },
            {
              id: "3",
              at: T2,
              title: "Incident logged",
              tone: "attention",
              detail: "Exterior light out at Dock B. Reported to facilities.",
              icon: Flashlight,
            },
          ]}
        />
      </Section>

      <Section title="Delivery" note="Section 12: proof it arrived.">
        <StatusTracker
          steps={[
            { id: "s1", label: "Report submitted", state: "done", at: T0 },
            { id: "s2", label: "Email sent", state: "done", at: T1 },
            {
              id: "s3",
              label: "Delivered",
              state: "active",
              detail: "Waiting on the provider.",
            },
            { id: "s4", label: "Opened", state: "pending" },
          ]}
        />
        <StatusTracker
          steps={[
            { id: "f1", label: "Email sent", state: "done", at: T0 },
            {
              id: "f2",
              label: "Bounced",
              state: "failed",
              at: T1,
              detail: "Mailbox full.",
            },
          ]}
        />
      </Section>

      <Section title="Time">
        <div className="flex flex-wrap items-baseline gap-6 text-2xl">
          <ElapsedTimer since={anchor - 2 * 60 * 60 * 1000 - 14 * 60 * 1000} />
          <Countdown target={anchor + 12 * 60 * 1000} />
          <Countdown target={anchor + 90 * 1000} />
          <Countdown target={anchor - 4 * 60 * 1000} />
        </div>
      </Section>

      <Section title="Table" note="Table on desktop, cards on mobile. Resize to see.">
        <DataTable
          caption="Recent reports"
          getRowKey={(row) => row.id}
          rows={[
            {
              id: "r1",
              site: "Harbour Point",
              date: "14 Mar",
              status: "DELIVERED" as const,
              photos: 6,
            },
            {
              id: "r2",
              site: "Rail Yard 4",
              date: "13 Mar",
              status: "BOUNCED" as const,
              photos: 2,
            },
            {
              id: "r3",
              site: "Harbour Point",
              date: "13 Mar",
              status: "DRAFT" as const,
              photos: 0,
            },
          ]}
          columns={[
            { key: "site", header: "Site", primary: true, cell: (row) => row.site },
            { key: "date", header: "Date", cell: (row) => row.date },
            {
              key: "status",
              header: "Status",
              cell: (row) => <StatusChip status={row.status} />,
            },
            {
              key: "photos",
              header: "Photos",
              align: "end",
              cell: (row) => row.photos,
            },
          ]}
        />
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <SheetRoot>
            <SheetTrigger asChild>
              <Button variant="secondary">Bottom sheet</Button>
            </SheetTrigger>
            <BottomSheet
              title="Log an incident"
              description="This goes into tonight's report."
              footer={
                <Button size="xl" fullWidth>
                  Save incident
                </Button>
              }
            >
              <div className="flex flex-col gap-3 py-2">
                <Field label="What happened">
                  <Textarea placeholder="Describe it plainly." />
                </Field>
                <PhotoGrid photos={[]} max={4} onAdd={() => undefined} />
              </div>
            </BottomSheet>
          </SheetRoot>

          <SheetRoot>
            <SheetTrigger asChild>
              <Button variant="ghost">Dialog</Button>
            </SheetTrigger>
            <Dialog
              title="Discard this draft?"
              description="The entries you logged tonight stay on the shift."
              footer={
                <>
                  <Button variant="ghost">Keep</Button>
                  <Button variant="danger">Discard</Button>
                </>
              }
            >
              <p className="py-2 text-sm text-text-muted">This cannot be undone.</p>
            </Dialog>
          </SheetRoot>
        </div>
        <ToastDemo />
      </Section>

      <Section
        title="Connectivity"
        note="Offline is normal, so it is attention, not danger."
      >
        {/* Forced-visible copy of the banner; the live one below only renders
            when the browser actually reports offline or a queue exists. */}
        <div className="flex items-center gap-2.5 rounded-[var(--radius-card)] bg-attention px-4 py-2.5 text-sm text-on-attention">
          Offline. 3 entries saved, will sync when you&apos;re back.
        </div>
        <OfflineBanner pendingCount={0} />
      </Section>

      <Section title="Loading &amp; empty">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-20 w-full" />
        </div>
        <Card>
          <EmptyState
            icon={FileText}
            title="No reports yet"
            description="Finish a shift and the report lands here, with proof it was delivered."
            action={<Button size="lg">Start a shift</Button>}
          />
        </Card>
      </Section>
    </div>
  );
}

function ThemePane({ theme }: { theme: "dark" | "light" }) {
  return (
    <div
      data-pane={theme}
      className={cn(
        `theme-${theme}`,
        "min-w-0 flex-1 border border-border bg-bg text-text",
      )}
    >
      <div className="sticky top-0 z-10 border-b border-border bg-[var(--bg)] px-5 py-3">
        <p className="text-sm font-semibold">{theme} theme</p>
      </div>
      <Gallery />
    </div>
  );
}

/**
 * Both themes, side by side, on one page.
 *
 * This is the check that the `@theme inline` bridge in globals.css actually
 * works: the panes differ only by a class on a wrapper div, so if the
 * generated utilities had frozen their values at build time instead of
 * pointing at `var(--x)`, both panes would render identically.
 */
export default function DevUiPage() {
  return (
    <ToastProvider>
      <main className="min-h-dvh">
        <div className="flex flex-col lg:flex-row">
          <ThemePane theme="dark" />
          <ThemePane theme="light" />
        </div>
      </main>
    </ToastProvider>
  );
}
