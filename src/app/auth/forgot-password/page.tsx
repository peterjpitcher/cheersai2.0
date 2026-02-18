import { permanentRedirect } from "next/navigation";

export default function LegacyForgotPasswordRedirectPage() {
  permanentRedirect("/login#magic-link");
}
