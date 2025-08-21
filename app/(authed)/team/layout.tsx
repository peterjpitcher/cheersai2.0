import SubNav from '@/components/navigation/sub-nav';

export default function TeamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SubNav base="/team" preset="team" />
      <main className="container mx-auto px-4 py-6 max-w-screen-2xl">
        {children}
      </main>
    </>
  );
}