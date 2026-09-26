import { AppChrome } from "@/components/app-chrome";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <AppChrome />
      {children}
    </>
  );
}
