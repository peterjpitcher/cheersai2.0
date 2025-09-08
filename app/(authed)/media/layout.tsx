import SubNav from "@/components/navigation/sub-nav";
import Container from "@/components/layout/container";

export default function MediaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <SubNav base="/media" preset="media" />
      <main>
        <Container className="py-8">{children}</Container>
      </main>
    </div>
  );
}
