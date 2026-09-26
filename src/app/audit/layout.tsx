import type { ReactNode } from "react";

import { AppChrome } from "@/components/app-chrome";

export default function AuditLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppChrome />
      {children}
    </>
  );
}
