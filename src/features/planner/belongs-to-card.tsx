interface BelongsToCardProps {
  campaignName: string | null | undefined;
}

// Shows which content campaign (v1 `campaigns` table) a post belongs to.
// Deliberately no link: `/campaigns/[id]` is the paid Meta campaigns page
// (`meta_campaigns`), and content campaigns have no page of their own.
export function BelongsToCard({ campaignName }: BelongsToCardProps): React.JSX.Element {
  return (
    <div
      style={{
        backgroundColor: "var(--c-card)",
        border: "1px solid var(--c-line)",
        borderRadius: "var(--r-xl)",
        padding: 18,
      }}
    >
      <span className="eyebrow" style={{ color: "var(--c-ink-3)" }}>Belongs to</span>
      <p className="text-[14px] font-medium mt-2" style={{ color: "var(--c-ink)" }}>
        {campaignName ?? "Instant post"}
      </p>
      {!campaignName && (
        <p className="text-[12px] mt-0.5" style={{ color: "var(--c-ink-3)" }}>
          Not part of a campaign
        </p>
      )}
    </div>
  );
}
