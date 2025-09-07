export type IconName = 
  | 'Send'
  | 'Plus'
  | 'Image'
  | 'Calendar'
  | 'BarChart3'
  | 'Activity'
  | 'Settings'
  | 'Home'
  | 'FileText'
  | 'Clock'
  | 'Palette'
  | 'Link2'
  | 'Mic'
  | 'MapPin'
  | 'Users'
  | 'CreditCard'
  | 'Shield'
  | 'Bell';

export type NavItem = {
  label: string;
  to: string; // Relative or absolute path
  icon?: IconName;
  badge?: string | number;
  requiresPlan?: 'starter' | 'professional' | 'enterprise';
  requiresRole?: 'admin' | 'editor' | 'viewer';
  requiresConnection?: boolean;
};

export type SubNavPreset = 
  | 'dashboard' 
  | 'campaignsRoot' 
  | 'campaignDetail' 
  | 'settings'
  | 'media'
  | 'admin';

export const subNavPresets: Record<SubNavPreset, NavItem[]> = {
  dashboard: [
    { label: 'Quick Post', to: '#quick-post', icon: 'Send' },
    { label: 'New Campaign', to: '/campaigns/new', icon: 'Plus' },
    { label: 'Media', to: '/media', icon: 'Image' },
    { label: 'Campaigns', to: '/campaigns', icon: 'Calendar' },
    { label: 'Settings', to: '/settings', icon: 'Settings' },
  ],
  campaignsRoot: [
    { label: 'All Campaigns', to: '' },
    { label: 'Create New', to: 'new', icon: 'Plus' },
  ],
  campaignDetail: [
    // Simplified: remove Overview/Generate to avoid duplicate nav
    { label: 'Publishing', to: 'publishing', icon: 'Send', requiresConnection: true },
  ],
  settings: [
    { label: 'Account', to: '', icon: 'Settings' },
    { label: 'Brand', to: 'brand', icon: 'Palette' },
    { label: 'Guardrails', to: 'guardrails', icon: 'Shield' },
    { label: 'Logo & Watermark', to: 'logo', icon: 'Image' },
    { label: 'Team', to: 'team', icon: 'Users' },
    { label: 'Security', to: 'security', icon: 'Shield' },
    { label: 'Billing', to: 'billing', icon: 'CreditCard' },
    { label: 'Connections', to: 'connections', icon: 'Link2' },
    { label: 'Posting Schedule', to: 'posting-schedule', icon: 'Clock' },
    { label: 'Notifications', to: 'notifications', icon: 'Bell' },
  ],
  media: [
    { label: 'Library', to: '', icon: 'Image' },
  ],
  admin: [
    { label: 'Dashboard', to: 'dashboard', icon: 'Home' },
    { label: 'Tenants', to: 'tenants', icon: 'Users' },
    { label: 'Content Settings', to: 'content-settings', icon: 'Settings' },
    { label: 'AI Prompts', to: 'ai-prompts', icon: 'Mic' },
  ],
};

// Permission checker
export function filterNavItems(
  items: NavItem[],
  context: {
    plan?: string;
    role?: string;
    hasConnections?: boolean;
  }
): NavItem[] {
  return items.filter(item => {
    // Check plan requirements
    if (item.requiresPlan) {
      const planHierarchy = ['starter', 'professional', 'enterprise'];
      const requiredIndex = planHierarchy.indexOf(item.requiresPlan);
      const userIndex = planHierarchy.indexOf(context.plan || 'starter');
      if (userIndex < requiredIndex) return false;
    }
    
    // Check role requirements
    if (item.requiresRole) {
      const roleHierarchy = ['viewer', 'editor', 'admin'];
      const requiredIndex = roleHierarchy.indexOf(item.requiresRole);
      const userIndex = roleHierarchy.indexOf(context.role || 'viewer');
      if (userIndex < requiredIndex) return false;
    }
    
    // Check connection requirements
    if (item.requiresConnection && !context.hasConnections) {
      return false;
    }
    
    return true;
  });
}

// Helper to get greeting based on timezone
export function getGreetingForTimezone(timezone: string = 'Europe/London'): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
  });
  
  const hour = parseInt(formatter.format(now));
  
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}
