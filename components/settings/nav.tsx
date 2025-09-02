'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  User,
  Palette,
  Image,
  Lock,
  CreditCard,
  Share2,
  Calendar,
  Bell,
  Users,
  ChevronLeft
} from 'lucide-react'

const settingsNavItems = [
  {
    name: 'Account',
    href: '/settings/account',
    icon: User,
    description: 'Personal information and preferences'
  },
  {
    name: 'Brand',
    href: '/settings/brand',
    icon: Palette,
    description: 'Brand voice and identity'
  },
  {
    name: 'Logo & Watermark',
    href: '/settings/logo',
    icon: Image,
    description: 'Logos and watermark settings'
  },
  {
    name: 'Team',
    href: '/settings/team',
    icon: Users,
    description: 'Team members and permissions'
  },
  {
    name: 'Security',
    href: '/settings/security',
    icon: Lock,
    description: 'Password and security settings'
  },
  {
    name: 'Billing',
    href: '/settings/billing',
    icon: CreditCard,
    description: 'Subscription and payment'
  },
  {
    name: 'Social Connections',
    href: '/settings/connections',
    icon: Share2,
    description: 'Connected social media accounts'
  },
  {
    name: 'Posting Schedule',
    href: '/settings/posting-schedule',
    icon: Calendar,
    description: 'Default posting times'
  },
  {
    name: 'Notifications',
    href: '/settings/notifications',
    icon: Bell,
    description: 'Email and notification preferences'
  }
]

export function SettingsNav() {
  const pathname = usePathname()
  
  return (
    <nav className="w-full md:w-64 flex-shrink-0">
      <div className="bg-white rounded-large shadow-sm border border-border p-2">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors mb-2"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        
        <div className="border-t border-border my-2" />
        
        <div className="space-y-1">
          {settingsNavItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-start gap-3 px-3 py-2.5 rounded-medium transition-colors
                  ${isActive 
                    ? 'bg-primary/10 text-primary' 
                    : 'hover:bg-gray-50 text-text-secondary hover:text-text-primary'
                  }
                `}
              >
                <Icon className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${isActive ? 'text-primary' : ''}`}>
                    {item.name}
                  </div>
                  <div className="text-xs text-text-secondary mt-0.5 hidden lg:block">
                    {item.description}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}