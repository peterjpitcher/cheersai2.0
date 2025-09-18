import { getUserAndTenant, getPostingSchedule } from '@/lib/settings/service'
import { ScheduleEditor } from './schedule-editor'
import { Clock, Calendar, Lightbulb } from 'lucide-react'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PostingScheduleSettingsPage() {
  const { tenant } = await getUserAndTenant()
  const schedule = await getPostingSchedule(tenant.id)
  
  return (
    <div className="space-y-6">
      <div className="rounded-large border border-border bg-white p-6 shadow-sm">
        <div className="mb-2 flex items-center gap-3">
          <Clock className="size-5 text-primary" />
          <h2 className="font-heading text-xl font-bold">Posting Schedule</h2>
        </div>
        <p className="mb-6 text-sm text-text-secondary">
          Set your preferred times for publishing content to social media
        </p>
        
        <ScheduleEditor 
          initialSchedule={schedule} 
          tenantId={tenant.id}
          businessType={(tenant as any).business_type || 'pub'}
        />
      </div>
      
      <div className="rounded-large border border-border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <Lightbulb className="size-5 text-warning" />
          <h3 className="font-heading text-lg font-bold">Optimal Posting Times</h3>
        </div>
        
        <div className="space-y-4">
          <div className="rounded-medium bg-primary/5 p-4">
            <h4 className="mb-2 font-semibold">UK Hospitality Best Practices</h4>
            <ul className="space-y-1 text-sm text-text-secondary">
              <li>• <strong>Morning (8-10am):</strong> Breakfast promotions, daily specials</li>
              <li>• <strong>Lunch (11:30am-1pm):</strong> Lunch menu, midday offers</li>
              <li>• <strong>Evening (5-7pm):</strong> Dinner specials, events tonight</li>
              <li>• <strong>Weekend (10am-12pm):</strong> Brunch, Sunday roasts</li>
            </ul>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-medium border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Calendar className="size-4 text-text-secondary" />
                <p className="text-sm font-medium">Peak Engagement Days</p>
              </div>
              <p className="text-sm text-text-secondary">
                Thursday & Friday for weekend planning, Sunday for family dining
              </p>
            </div>
            
            <div className="rounded-medium border border-border p-3">
              <div className="mb-2 flex items-center gap-2">
                <Clock className="size-4 text-text-secondary" />
                <p className="text-sm font-medium">Platform Timing</p>
              </div>
              <p className="text-sm text-text-secondary">
                Facebook: Lunch & evening, Instagram: Visual content at dinner time
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
