import { ArrowUpRight, MapPin } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ElapsedTimer } from "@/components/ui/timer";

export function ShiftFocusCard({
  siteName,
  label,
  detail,
  clockInAt,
  href,
  action,
}: {
  siteName: string;
  label: string;
  detail: string;
  clockInAt?: string;
  href: string;
  action: string;
}) {
  return (
    <Card className="shift-focus overflow-hidden p-6 sm:p-8">
      <div className="mb-7 flex items-center justify-between gap-4">
        <span className="glass-icon">
          <MapPin aria-hidden="true" strokeWidth={1.75} className="size-6" />
        </span>
        <Badge tone="outline">{label}</Badge>
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-text sm:text-3xl">
        {siteName}
      </h2>
      <p className="mt-2 text-sm text-text-muted">{detail}</p>
      {clockInAt && (
        <div className="my-6">
          <ElapsedTimer
            since={clockInAt}
            className="text-4xl font-medium tracking-tight tabular-nums"
          />
          <p className="mt-1 text-sm text-text-muted">Time on shift</p>
        </div>
      )}
      <Button asChild size="xl" className="mt-6 w-full justify-between">
        <Link href={href}>
          {action}
          <ArrowUpRight aria-hidden="true" className="size-6" strokeWidth={1.75} />
        </Link>
      </Button>
    </Card>
  );
}
