import SubNav from '@/components/navigation/sub-nav';

export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SubNav base="/campaigns" preset="campaignsRoot" />
      <main className="container mx-auto px-4 py-6 max-w-screen-2xl">
        {children}
      </main>
    </>
  );
}