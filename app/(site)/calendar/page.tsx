import { redirect } from 'next/navigation'

// This route has been consolidated into Publishing Queue.
// Keep a server redirect so bookmarks and old links continue to work.
export default function CalendarRedirect() {
  redirect('/publishing/queue?view=calendar')
}
