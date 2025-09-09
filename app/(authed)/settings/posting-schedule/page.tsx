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
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <div className="flex items-center gap-3 mb-2">
          <Clock className="w-5 h-5 text-primary" />
          <h2 className="text-xl font-heading font-bold">Posting Schedule</h2>
        </div>
        <p className="text-text-secondary text-sm mb-6">
          Set your preferred times for publishing content to social media
        </p>
        
        <ScheduleEditor 
          initialSchedule={schedule} 
          tenantId={tenant.id}
          businessType={(tenant as any).business_type || 'pub'}
        />
      </div>
      
      <div className="bg-white rounded-large shadow-sm border border-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <Lightbulb className="w-5 h-5 text-warning" />
          <h3 className="text-lg font-heading font-bold">Optimal Posting Times</h3>
        </div>
        
        <div className="space-y-4">
          <div className="p-4 bg-primary/5 rounded-medium">
            <h4 className="font-semibold mb-2">UK Hospitality Best Practices</h4>
            <ul className="text-sm text-text-secondary space-y-1">
              <li>• <strong>Morning (8-10am):</strong> Breakfast promotions, daily specials</li>
              <li>• <strong>Lunch (11:30am-1pm):</strong> Lunch menu, midday offers</li>
              <li>• <strong>Evening (5-7pm):</strong> Dinner specials, events tonight</li>
              <li>• <strong>Weekend (10am-12pm):</strong> Brunch, Sunday roasts</li>
            </ul>
          </div>
          
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-3 border border-border rounded-medium">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-text-secondary" />
                <p className="font-medium text-sm">Peak Engagement Days</p>
              </div>
              <p className="text-sm text-text-secondary">
                Thursday & Friday for weekend planning, Sunday for family dining
              </p>
            </div>
            
            <div className="p-3 border border-border rounded-medium">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-text-secondary" />
                <p className="font-medium text-sm">Platform Timing</p>
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
