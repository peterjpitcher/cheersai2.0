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
  | 'analytics'
  | 'monitoring'
  | 'media'
  | 'team';

export const subNavPresets: Record<SubNavPreset, NavItem[]> = {
  dashboard: [
    { label: 'Quick Post', to: '#quick-post', icon: 'Send' },
    { label: 'New Campaign', to: '/campaigns/new', icon: 'Plus' },
    { label: 'Media', to: '/media', icon: 'Image' },
    { label: 'Campaigns', to: '/campaigns', icon: 'Calendar' },
    { label: 'Analytics', to: '/analytics', icon: 'BarChart3', requiresConnection: true },
    { label: 'Monitoring', to: '/monitoring', icon: 'Activity', requiresPlan: 'professional' },
    { label: 'Settings', to: '/settings', icon: 'Settings' },
  ],
  campaignsRoot: [
    { label: 'All Campaigns', to: '' },
    { label: 'Active', to: 'active' },
    { label: 'Scheduled', to: 'scheduled' },
    { label: 'Completed', to: 'completed' },
    { label: 'Create New', to: 'new', icon: 'Plus' },
  ],
  campaignDetail: [
    { label: 'Overview', to: '', icon: 'Home' },
    { label: 'Posts', to: 'posts', icon: 'FileText' },
    { label: 'Generate', to: 'generate', icon: 'Send' },
    { label: 'Schedule', to: 'schedule', icon: 'Calendar' },
    { label: 'Publishing', to: 'publishing', icon: 'Send', requiresConnection: true },
    { label: 'Analytics', to: 'analytics', icon: 'BarChart3', requiresConnection: true },
    { label: 'Settings', to: 'settings', icon: 'Settings', requiresRole: 'admin' },
  ],
  settings: [
    { label: 'Brand & Logo', to: '', icon: 'Palette' },
    { label: 'Logo', to: 'logo', icon: 'Image' },
    { label: 'Connections', to: 'connections', icon: 'Link2' },
    { label: 'Voice Training', to: 'voice', icon: 'Mic', requiresPlan: 'professional' },
    { label: 'Locations', to: 'locations', icon: 'MapPin', requiresPlan: 'professional' },
    { label: 'Posting Schedule', to: 'posting-schedule', icon: 'Clock' },
    { label: 'Team', to: 'team', icon: 'Users', requiresRole: 'admin' },
    { label: 'Billing', to: 'billing', icon: 'CreditCard', requiresRole: 'admin' },
    { label: 'Security', to: 'security', icon: 'Shield' },
    { label: 'Notifications', to: 'notifications', icon: 'Bell' },
    { label: 'Change Password', to: 'change-password', icon: 'Shield' },
  ],
  analytics: [
    { label: 'Overview', to: '' },
    { label: 'Engagement', to: 'engagement' },
    { label: 'Reach', to: 'reach' },
    { label: 'Conversions', to: 'conversions' },
    { label: 'Export', to: 'export' },
  ],
  monitoring: [
    { label: 'System Health', to: '' },
    { label: 'Performance', to: 'performance' },
    { label: 'Errors', to: 'errors' },
    { label: 'Usage', to: 'usage' },
    { label: 'Logs', to: 'logs', requiresRole: 'admin' },
  ],
  media: [
    { label: 'All Media', to: '' },
    { label: 'Images', to: 'images' },
    { label: 'Videos', to: 'videos' },
    { label: 'Upload', to: 'upload', icon: 'Plus' },
  ],
  team: [
    { label: 'Members', to: '' },
    { label: 'Invite', to: 'invite', icon: 'Plus' },
    { label: 'Roles', to: 'roles', requiresRole: 'admin' },
    { label: 'Activity', to: 'activity' },
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
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: timezone,
  });
  
  const hour = parseInt(formatter.format(now));
  
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}