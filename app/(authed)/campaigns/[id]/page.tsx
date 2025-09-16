import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CampaignClientPage from "./client-page";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect("/");
  }

  const { id } = await params;

  // Get campaign with posts including approval status
  const { data: campaign } = await supabase
    .from("campaigns")
    .select(`
      *,
      hero_image:media_assets!campaigns_hero_image_id_fkey (
        file_url
      ),
      campaign_posts (
        *,
        approved_by:users!campaign_posts_approved_by_fkey (
          full_name
        )
      )
    `)
    .eq("id", id)
    .single();

  if (!campaign) {
    redirect("/campaigns");
  }

  return <CampaignClientPage campaign={campaign} />;
}
