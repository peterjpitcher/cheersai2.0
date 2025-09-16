import { SidebarNav } from './_components/SidebarNav';
import { AppShell } from './_components/AppShell';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SidebarNav base="/dashboard" preset="dashboard" />
      <AppShell>
        {children}
      </AppShell>
    </>
  );
}
