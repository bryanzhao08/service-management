import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import {
  GuardDashboardView,
  RecentReports,
} from "@/components/dashboard/guard-dashboard";
import { AppearanceSettings } from "@/components/settings/appearance";
import {
  ShiftTimeline,
  type TimelineEntryData,
} from "@/components/shift/shift-timeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "App preview" };
export const dynamic = "force-dynamic";

/** Development-only fixtures rendered by the same components as the app. */
export default async function AppPreview({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  const { screen = "shifts" } = await searchParams;
  const now = new Date();
  const started = new Date(now.getTime() - 3.5 * 60 * 60 * 1000);
  const site = { name: "Westside Hotel", timezone: "America/Los_Angeles" };
  const reports = [
    {
      id: "preview-1",
      createdAt: new Date(now.getTime() - 86400000),
      shift: { site },
      deliveries: [{ status: "DELIVERED" }],
    },
    {
      id: "preview-2",
      createdAt: new Date(now.getTime() - 172800000),
      shift: { site: { ...site, name: "Pacific Commerce Center" } },
      deliveries: [{ status: "DELIVERED" }],
    },
  ];
  const links = [
    { href: "/dev/app?screen=shifts", label: "Shifts" },
    { href: "/dev/app?screen=reports", label: "Reports" },
    { href: "/dev/app?screen=settings", label: "Settings" },
  ];
  const entries: TimelineEntryData[] = [
    {
      type: "NOTE",
      text: "Loading dock secure. All access doors checked.",
      minutes: 25,
    },
    {
      type: "PATROL",
      text: "Garage and stairwells clear. No issues found.",
      minutes: 75,
    },
    { type: "CLOCK_IN", text: "Shift started at Westside Hotel.", minutes: 210 },
  ].map(({ type, text, minutes }, index) => ({
    id: `preview-entry-${index}`,
    clientId: `preview-entry-${index}`,
    type: type as TimelineEntryData["type"],
    text,
    occurredAt: new Date(now.getTime() - minutes * 60000).toISOString(),
    deletedAt: null,
    areaName: null,
    revisionCount: 0,
    mediaCount: 0,
    incident: null,
    packageInfo: null,
  }));
  return (
    <>
      <p className="px-4 py-2 text-center text-xs text-text-muted">
        App preview · sample data · writes and downloads unavailable
      </p>
      {screen === "timeline" ? (
        <ShiftTimeline
          canWrite={false}
          backHref="/dev/app?screen=shifts"
          entryLinksEnabled={false}
          previewActions
          shift={{
            id: "preview-shift",
            clockInAt: started.toISOString(),
            clockOutAt: null,
            isEventNight: false,
            guardName: "Sample guard",
          }}
          site={{
            ...site,
            id: "preview-site",
            code: "WSH",
            loggingMode: "FULL",
            areas: [],
            entryTypes: [],
          }}
          initialEntries={entries}
        />
      ) : (
        <>
          <AppHeader links={links} activeHref={`/dev/app?screen=${screen}`} />
          <main className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-4 pb-28 sm:px-6">
            <header className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight">
                {screen === "settings"
                  ? "Settings"
                  : screen === "reports"
                    ? "Reports"
                    : "Your shifts"}
              </h1>
              <p className="text-sm text-text-muted">Sample guard · app interface</p>
            </header>
            {screen === "settings" ? (
              <Card>
                <CardHeader>
                  <CardTitle>Appearance</CardTitle>
                </CardHeader>
                <CardContent>
                  <AppearanceSettings
                    theme="dark"
                    largeText={false}
                    saveToAccount={false}
                  />
                </CardContent>
              </Card>
            ) : screen === "reports" ? (
              <RecentReports reports={reports} downloadEnabled={false} />
            ) : (
              <GuardDashboardView
                active={{
                  id: "preview-shift",
                  site,
                  clockInAt: started,
                  scheduledStart: started,
                }}
                startable={[]}
                recent={reports}
                pace={{ averageMs: 132000, shifts: 8 }}
                assignedSites={[]}
                shiftHref="/dev/app?screen=timeline"
                reportDownloads={false}
              />
            )}
          </main>
        </>
      )}
    </>
  );
}
