import { CONTACT } from '@/lib/legal/company';

/** What the /signup form shows. Kept apart from the server action, which may export only functions. */
export const SIGNUP_MESSAGES = {
  notOpen: `Sign-up is not open yet. Talk to us: email ${CONTACT.email} or WhatsApp ${CONTACT.whatsappDisplay}.`,
  preview: 'Sign-up is switched off on preview deployments, because they share the live database.',
  couldNotFinish: `We could not finish this. Please try again in a few minutes, or email ${CONTACT.email}.`,
  botCheckFailed: 'The security check did not pass. Please try it again.',
  invalidEmail: 'Please enter a valid email address.',
} as const;
