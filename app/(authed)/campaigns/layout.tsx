import SubNav from '@/components/navigation/sub-nav';
import Container from '@/components/layout/container';

export default function CampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SubNav base="/campaigns" preset="campaignsRoot" />
      <main>
        <Container className="section-y">{children}</Container>
      </main>
    </>
  );
}
