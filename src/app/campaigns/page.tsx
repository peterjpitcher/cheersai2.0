import { permanentRedirect } from "next/navigation";

export default function LegacyCampaignsRedirectPage() {
  permanentRedirect("/planner");
}
