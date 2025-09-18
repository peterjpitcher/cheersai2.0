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
    <nav className="w-full shrink-0 md:w-64">
      <div className="rounded-large border border-border bg-white p-2 shadow-sm">
        <Link
          href="/dashboard"
          className="mb-2 flex items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          <ChevronLeft className="size-4" />
          Back to Dashboard
        </Link>
        
        <div className="my-2 border-t border-border" />
        
        <div className="space-y-1">
          {settingsNavItems.map((item) => {
            const Icon = item.icon
            const isActive = pathname === item.href
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-start gap-3 rounded-medium px-3 py-2.5 transition-colors
                  ${isActive 
                    ? 'bg-primary/10 text-primary' 
                    : 'text-text-secondary hover:bg-gray-50 hover:text-text-primary'
                  }
                `}
              >
                <Icon className="mt-0.5 size-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm font-medium ${isActive ? 'text-primary' : ''}`}>
                    {item.name}
                  </div>
                  <div className="mt-0.5 hidden text-xs text-text-secondary lg:block">
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