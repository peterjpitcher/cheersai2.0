/**
 * What the Google location picker renders. Built from the decrypted hand-off
 * on the server, field by field, so the Google tokens can never reach the
 * browser. Pure and browser-safe: no crypto, no database.
 */

import type { GoogleLocationChoiceFailure } from "@/lib/connections/google-choice";

export interface GoogleLocationOptionView {
  /** `accounts/{accountId}/locations/{locationId}`. */
  id: string;
  title: string;
  address: string | null;
  accountName: string | null;
  /** This brand is connected to this location now. */
  connectedNow: boolean;
}

export interface GoogleLocationChoiceView {
  /** The random reference already in the URL; not a secret on its own. */
  token: string;
  brandName: string | null;
  /** Some of the login's accounts could not be listed. */
  incomplete: boolean;
  options: GoogleLocationOptionView[];
}

/** Everything the picker screen can show, decided on the server. */
export type GoogleLocationChooserState =
  | { kind: "choose"; view: GoogleLocationChoiceView }
  | { kind: "unavailable"; message: string };

const NOT_FOUND = "We could not find this choice. Start again from the Connections screen.";

export const GOOGLE_LOCATION_CHOICE_FAILURE_MESSAGES: Record<GoogleLocationChoiceFailure, string> = {
  not_found: NOT_FOUND,
  invalid: NOT_FOUND,
  forbidden: NOT_FOUND,
  lookup_failed: "We could not load this choice. Please try again in a minute.",
  used: "This choice has already been used. If your location is not connected yet, start again from the Connections screen.",
  expired: "This choice has expired and nothing was saved. Start again from the Connections screen.",
};

interface ViewInput {
  token: string;
  brandName: string | null;
  payload: {
    incomplete: boolean;
    currentLocationId: string | null;
    locations: Array<{ id: string; title: string; address: string | null; accountName: string | null }>;
  };
}

export function buildGoogleLocationChoiceView({ token, brandName, payload }: ViewInput): GoogleLocationChoiceView {
  return {
    token,
    brandName,
    incomplete: payload.incomplete,
    options: payload.locations.map((location) => ({
      id: location.id,
      title: location.title,
      address: location.address,
      accountName: location.accountName,
      connectedNow: payload.currentLocationId === location.id,
    })),
  };
}
