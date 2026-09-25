import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Section 5: two real sites configured differently, side by side.
 *
 * The switches here are **not** the interactive `Toggle`. A control on a
 * marketing page that moves but changes nothing is a lie to a sighted user and
 * a dead end to a keyboard one — it takes a tab stop, announces as a switch,
 * and does nothing. These are pictures of state: `aria-hidden` visuals carrying
 * the shape, with the value in text that a screen reader actually reads.
 *
 * Server component, no client JS. It matches `Toggle`'s geometry (h-7 w-12,
 * size-5 thumb) so the illustration and the product agree.
 */

function SwitchGlyph({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block h-7 w-12 shrink-0 rounded-[var(--radius-pill)] border",
        on ? "border-transparent bg-primary" : "border-border bg-surface",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 block size-5 -translate-y-1/2 rounded-full",
          on ? "translate-x-6 bg-on-primary" : "translate-x-1 bg-text",
        )}
      />
    </span>
  );
}

function SettingRow({
  label,
  on,
  value,
}: {
  label: string;
  on: boolean;
  value: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="text-[15px] font-medium">{label}</span>
        <span className="text-sm text-text-muted">{value}</span>
      </span>
      <SwitchGlyph on={on} />
    </li>
  );
}

function SiteCard({
  name,
  kind,
  settings,
}: {
  name: string;
  kind: string;
  settings: readonly { label: string; on: boolean; value: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        <p className="text-sm text-text-muted">{kind}</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {settings.map((setting) => (
            <SettingRow key={setting.label} {...setting} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function SiteConfigMock() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SiteCard
        name="Westside Hotel"
        kind="Hospitality · 24/7 · 4 report recipients"
        settings={[
          {
            label: "Emailed report",
            on: true,
            value: "On — GM, AGM, security director, owner",
          },
          { label: "Photos required", on: true, value: "On — every incident entry" },
          {
            label: "Blind-spot checklist",
            on: true,
            value: "On — 5 points per patrol",
          },
          { label: "Verbal handoff only", on: false, value: "Off" },
        ]}
      />
      <SiteCard
        name="Hillcrest Middle School"
        kind="Education · overnight · verbal handoff"
        settings={[
          {
            label: "Emailed report",
            on: false,
            value: "Off — district handles its own log",
          },
          {
            label: "Photos required",
            on: false,
            value: "Off — no photography on campus",
          },
          {
            label: "Blind-spot checklist",
            on: true,
            value: "On — 3 points per patrol",
          },
          {
            label: "Verbal handoff only",
            on: true,
            value: "On — to the 6am custodian",
          },
        ]}
      />
    </div>
  );
}
