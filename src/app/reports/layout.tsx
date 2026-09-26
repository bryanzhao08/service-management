import { AppChrome } from "@/components/app-chrome";

export default function ReportsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <AppChrome />
      {children}
    </>
  );
}
