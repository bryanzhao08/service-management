import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  LoggingMode,
  RecipientStatus,
  Role,
  SubscriptionStatus,
} from "../src/generated/prisma/enums";

/**
 * Seed — section 20. Users, sites and configuration only.
 *
 * The sample shift with its entries, incidents, media and report belongs to
 * milestone 12: it depends on the media pipeline and the PDF renderer, neither
 * of which exists yet, and a seed that half-creates a report is worse than one
 * that does not try.
 *
 * Idempotent, as section 20 requires. Every write is an upsert keyed on a real
 * unique constraint, never on a generated id, so re-running is a no-op rather
 * than a duplicate. That is also why `code` and `email` carry `@unique` in the
 * schema — the seed leans on the same constraints the app does.
 */

import { queueSampleReport, seedSampleShift } from "./sample-shift";

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

/** Incident categories offered as one-tap chips in the quick-incident sheet. */
const DEFAULT_ENTRY_TYPES = [
  { key: "transient", label: "Transient / trespass", icon: "user-x", color: "ember" },
  { key: "intoxicated", label: "Intoxicated guest", icon: "wine", color: "ember" },
  { key: "noise", label: "Noise complaint", icon: "volume-2", color: "olive" },
  { key: "dispute", label: "Guest dispute", icon: "users", color: "olive" },
  { key: "damage", label: "Property damage", icon: "hammer", color: "copper" },
  { key: "medical", label: "Medical", icon: "heart-pulse", color: "copper" },
  { key: "suspicious", label: "Suspicious activity", icon: "eye", color: "ember" },
  { key: "alarm", label: "Alarm", icon: "bell-ring", color: "copper" },
  { key: "other", label: "Other", icon: "circle-dot", color: "khaki" },
] as const;

/** Section 11's PDF layout, one entry per section, in render order. */
const REPORT_SECTIONS = [
  { key: "cover", label: "Cover summary", enabled: true },
  { key: "clockInChecks", label: "Clock-in checks", enabled: true },
  { key: "timeline", label: "Timeline", enabled: true },
  { key: "incidents", label: "Incidents detail", enabled: true },
  { key: "packages", label: "Packages", enabled: true },
  { key: "gallery", label: "Gallery link", enabled: true },
];

async function main() {
  // Meridian sits on a real plan so the billing screen, the gated push alert
  // and the audit export are all exercised by the demo rather than being
  // dead code nobody clicks. TRIALING with a future end date is also the
  // state a real new customer is in on day one, which is the state most
  // worth having a screenshot of.
  const trialEndsAt = new Date(Date.now() + 18 * 24 * 60 * 60 * 1000);
  const subscription = {
    planId: "operations",
    subscriptionStatus: SubscriptionStatus.TRIALING,
    trialEndsAt,
    currentPeriodEnd: trialEndsAt,
  } as const;

  const company = await prisma.company.upsert({
    where: { slug: "meridian" },
    update: { name: "Meridian Protective Services", ...subscription },
    create: {
      name: "Meridian Protective Services",
      slug: "meridian",
      ...subscription,
    },
  });

  const users = await Promise.all(
    (
      [
        { email: "owner@meridian.test", name: "Dana Okafor", role: Role.OWNER },
        {
          email: "sup.westside@meridian.test",
          name: "Marisol Rivera",
          role: Role.SUPERVISOR,
        },
        {
          email: "guard.night@meridian.test",
          name: "Terrence Boyd",
          role: Role.GUARD,
        },
        {
          email: "guard.swing@meridian.test",
          name: "Priya Raman",
          role: Role.GUARD,
        },
      ] as const
    ).map((u) =>
      prisma.user.upsert({
        where: { email: u.email },
        update: { name: u.name, role: u.role, companyId: company.id },
        create: { ...u, companyId: company.id },
      }),
    ),
  );

  const byEmail = new Map(users.map((u) => [u.email, u]));
  const userId = (email: string) => {
    const user = byEmail.get(email);
    if (!user) throw new Error(`seed: user ${email} was not created`);
    return user.id;
  };

  // ---- Site 1: Westside Hotel ----------------------------------------------

  const hotel = await prisma.site.upsert({
    where: { companyId_code: { companyId: company.id, code: "WH" } },
    update: {},
    create: {
      companyId: company.id,
      name: "Westside Hotel — Sunset Strip",
      code: "WH",
      address: "8400 Sunset Boulevard, West Hollywood, CA 90069",
      timezone: "America/Los_Angeles",
      loggingMode: LoggingMode.FULL,
      footerDisclaimer:
        "This report is a contemporaneous record of observations by on-site security personnel. It is not a legal determination.",
      sendIndividually: true,
    },
  });

  await upsertAreas(hotel.id, [
    "Lobby",
    "Front entrance",
    "Pool deck",
    "Garage P1",
    "Garage P2",
    "Loading dock",
    "Rooftop bar (after hours)",
    "Stairwell A",
    "Stairwell B",
  ]);

  await upsertBlindSpots(hotel.id, [
    [
      "Garage P2 southwest corner",
      "Behind the support column, out of camera 14's arc.",
    ],
    ["Loading dock alcove", "Recessed doorway left of the roll-up door."],
    ["Stairwell A landing 3", "Landing between floors 3 and 4; no camera coverage."],
    ["Stairwell B roof door", "Alarmed door at the top of Stairwell B."],
    ["Pool equipment room", "Check the door is latched, not just closed."],
    ["Trash enclosure", "Gate on the alley side; a common overnight entry point."],
    ["East side gate", "Pedestrian gate; confirm the latch has re-seated."],
    ["Rooftop bar back hall", "Service corridor behind the bar, dark after close."],
    ["Employee entrance vestibule", "Between the two doors; badge reader side."],
  ]);

  await upsertShiftTemplates(hotel.id, [
    ["Graveyard 10 PM", "22:00", "08:00"],
    ["Graveyard 11:30 PM", "23:30", "08:00"],
    ["Swing", "15:00", "03:00"],
  ]);

  await upsertEntryTypes(hotel.id, [
    ...DEFAULT_ENTRY_TYPES,
    {
      key: "camera-room-call",
      label: "Camera room call",
      icon: "radio",
      color: "lime",
    },
  ]);

  await prisma.reportTemplate.upsert({
    where: { siteId: hotel.id },
    update: {},
    create: {
      siteId: hotel.id,
      sections: REPORT_SECTIONS,
      headerText: "Meridian Protective Services — nightly shift report",
      embedPhotos: true,
      coverPage: true,
    },
  });

  const verifiedAt = new Date("2026-01-08T17:00:00.000Z");
  await upsertRecipients(hotel.id, [
    {
      name: "Alice Nwosu",
      email: "ops@westsidehotel.test",
      roleLabel: "Ops manager",
      required: true,
      status: RecipientStatus.VERIFIED,
      verifiedAt,
    },
    {
      name: "Grant Mbeki",
      email: "security.director@westsidehotel.test",
      roleLabel: "Hotel security director",
      required: true,
      status: RecipientStatus.VERIFIED,
      verifiedAt,
    },
    {
      name: "Sofia Lindqvist",
      email: "accounts@meridian.test",
      roleLabel: "Account manager",
      required: true,
      status: RecipientStatus.VERIFIED,
      verifiedAt,
    },
    {
      // Deliberately bad so the bounce alert has something to show on a fresh
      // database. A feature whose failure state is only reachable in production
      // does not get looked at.
      name: "Rowan Alderete",
      email: "regional.lead@meridian-regional.test",
      roleLabel: "Regional lead",
      required: false,
      status: RecipientStatus.BOUNCED,
      lastBounceAt: new Date("2026-01-19T09:14:00.000Z"),
      lastBounceReason: "550 5.1.1 mailbox does not exist",
    },
  ]);

  // ---- Assignments ---------------------------------------------------------

  const assignments: Array<[string, string]> = [
    ["sup.westside@meridian.test", hotel.id],
    ["guard.night@meridian.test", hotel.id],
    ["guard.swing@meridian.test", hotel.id],
  ];

  for (const [email, siteId] of assignments) {
    const id = userId(email);
    await prisma.siteAssignment.upsert({
      where: { userId_siteId: { userId: id, siteId } },
      update: {},
      create: { userId: id, siteId },
    });
  }

  // OWNER and ADMIN see every site in the company by rule, not by row, so they
  // deliberately get no assignments — see `visible.site()` in lib/db/scoped.ts.

  // ---- The sample shift ----------------------------------------------------
  // Everything above is configuration. This is the part that makes the seeded
  // app worth opening: a finished night, a real PDF, and one bounced delivery.
  const shiftId = await seedSampleShift({
    prisma,
    siteId: hotel.id,
    companyId: company.id,
    guardId: userId("guard.night@meridian.test"),
    supervisorId: userId("sup.westside@meridian.test"),
  });

  let reportLine = "no sample shift";
  if (shiftId) {
    const state = await queueSampleReport(
      {
        prisma,
        siteId: hotel.id,
        companyId: company.id,
        guardId: userId("guard.night@meridian.test"),
        supervisorId: userId("sup.westside@meridian.test"),
      },
      shiftId,
    );
    reportLine = {
      queued: "report queued — run `pnpm jobs:sweep` with the app running",
      "send-queued": "report built; delivery queued — run `pnpm jobs:sweep` again",
      "already-built": "report built and delivered",
    }[state];
  }

  const siteCount = await prisma.site.count({ where: { companyId: company.id } });

  console.log(
    `Seeded ${company.name}: ${users.length} users, ${siteCount} ${siteCount === 1 ? "site" : "sites"}, ${assignments.length} assignments.`,
  );
  console.log(`Sample shift: ${reportLine}.`);
}

async function upsertAreas(siteId: string, names: readonly string[]) {
  for (const [order, name] of names.entries()) {
    const existing = await prisma.area.findFirst({ where: { siteId, name } });
    if (existing) {
      await prisma.area.update({ where: { id: existing.id }, data: { order } });
    } else {
      await prisma.area.create({ data: { siteId, name, order } });
    }
  }
}

async function upsertBlindSpots(
  siteId: string,
  spots: ReadonlyArray<readonly [string, string]>,
) {
  for (const [order, [name, description]] of spots.entries()) {
    const existing = await prisma.blindSpot.findFirst({
      where: { siteId, name },
    });
    if (existing) {
      await prisma.blindSpot.update({
        where: { id: existing.id },
        data: { description, order },
      });
    } else {
      await prisma.blindSpot.create({
        data: { siteId, name, description, order, requiredAtClockIn: true },
      });
    }
  }
}

async function upsertShiftTemplates(
  siteId: string,
  templates: ReadonlyArray<readonly [string, string, string]>,
) {
  for (const [order, [name, startTime, endTime]] of templates.entries()) {
    const existing = await prisma.shiftTemplate.findFirst({
      where: { siteId, name },
    });
    if (existing) {
      await prisma.shiftTemplate.update({
        where: { id: existing.id },
        data: { startTime, endTime, order },
      });
    } else {
      await prisma.shiftTemplate.create({
        data: { siteId, name, startTime, endTime, order },
      });
    }
  }
}

async function upsertEntryTypes(
  siteId: string,
  types: ReadonlyArray<{
    key: string;
    label: string;
    icon: string;
    color: string;
  }>,
) {
  for (const [order, type] of types.entries()) {
    await prisma.siteEntryType.upsert({
      where: { siteId_key: { siteId, key: type.key } },
      update: { ...type, order },
      create: { siteId, ...type, order },
    });
  }
}

async function upsertRecipients(
  siteId: string,
  recipients: ReadonlyArray<{
    name: string;
    email: string;
    roleLabel: string;
    required: boolean;
    status: RecipientStatus;
    verifiedAt?: Date;
    lastBounceAt?: Date;
    lastBounceReason?: string;
  }>,
) {
  for (const recipient of recipients) {
    await prisma.recipient.upsert({
      where: { siteId_email: { siteId, email: recipient.email } },
      update: recipient,
      create: { siteId, ...recipient },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
