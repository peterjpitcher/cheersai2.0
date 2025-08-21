import SubNav from '@/components/navigation/sub-nav';

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SubNav base="/analytics" preset="analytics" />
      <main className="container mx-auto px-4 py-6 max-w-screen-2xl">
        {children}
      </main>
    </>
  );
}