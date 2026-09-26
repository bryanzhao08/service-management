import { AppChrome } from "@/components/app-chrome";

export default function ShiftLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <AppChrome />
      {children}
    </>
  );
}
