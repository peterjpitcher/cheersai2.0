import { CONTACT } from '@/lib/legal/company';

/** What the /signup form shows. Kept apart from the server action, which may export only functions. */
export const SIGNUP_MESSAGES = {
  notOpen: `Sign-up is not open yet. Talk to us: email ${CONTACT.email} or WhatsApp ${CONTACT.whatsappDisplay}.`,
  preview: 'Sign-up is switched off on preview deployments, because they share the live database.',
  couldNotFinish: `We could not finish this. Please try again in a few minutes, or email ${CONTACT.email}.`,
  botCheckFailed: 'The security check did not pass. Please try it again.',
  invalidEmail: 'Please enter a valid email address.',
} as const;

/** What /signup/venue and the /no-access entry show (spec §4.4). */
export const VENUE_MESSAGES = {
  notOpen: SIGNUP_MESSAGES.notOpen,
  preview: 'Setting up a venue is switched off on preview deployments, because they share the live database.',
  couldNotFinish: SIGNUP_MESSAGES.couldNotFinish,
  signedOut: 'You are not signed in any more. Open the link in your email again, or ask for a new one on the sign-up page.',
  unconfirmed: 'Please confirm your email first: open the link in the email we sent you.',
  weakPassword: 'Please choose a stronger password: longer, and not one used on other websites.',
  member: `You already belong to a venue on Cheers. To add another venue, email ${CONTACT.email}.`,
  venueClosed: `The venue you set up with this login has been closed. To start again, email ${CONTACT.email}.`,
  memberNoBrand: `Your login belongs to a venue on Cheers that has been closed. To get access again or set up a new venue, email ${CONTACT.email}.`,
  removed: `You no longer have access to the venue you set up with this login. To get access again, email ${CONTACT.email}.`,
  invited: `You have been invited to join a venue on Cheers. Accept the invitation to get started, or email ${CONTACT.email}.`,
  admin: 'Admin logins cannot set up a self-serve venue. Use Admin, Create brand instead.',
  tooManyAttempts: (minutes: number): string =>
    `Too many attempts. Please try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`,
  emailMismatch: (signedInAs: string): string =>
    `That is not the email address you signed up with. You are signed in as ${signedInAs}; if that is not you, sign out.`,
} as const;
