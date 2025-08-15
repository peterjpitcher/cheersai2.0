import TrialBanner from "@/components/trial-banner";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TrialBanner />
      {children}
    </>
  );
}