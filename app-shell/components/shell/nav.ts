/** Sidebar map. `href` null = not built yet: the link goes to the "Coming soon" page instead of a 404. */
export interface NavItem { label: string; href: string | null; icon: string; external?: boolean }
export interface NavGroup { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { title: 'Product', items: [
    { label: 'Overview', href: '/dashboard/overview', icon: 'grid' },
    { label: 'Landing page', href: '/', icon: 'globe', external: true },
    { label: 'Dashboard & Ask', href: '/dashboard', icon: 'chat' },
    { label: 'Stacks & Remix', href: '/m/stacks', icon: 'layers' },
  ] },
  { title: 'Onboarding', items: [
    { label: 'Instant import', href: '/dashboard/import/resume', icon: 'download' },
  ] },
  { title: 'Tabs & Teams', items: [
    { label: 'Flush session', href: null, icon: 'tabs' },
    { label: 'Team invites', href: null, icon: 'users' },
    { label: 'Friday After-Hours', href: null, icon: 'star' },
    { label: 'Vault Studio', href: '/dashboard/studio', icon: 'monitor' },
    { label: 'Link health', href: null, icon: 'link' },
    { label: 'Privacy & Terms', href: '/privacy', icon: 'shield' },
    { label: 'Browser extension', href: null, icon: 'puzzle' },
  ] },
  { title: 'AI & Growth', items: [
    { label: 'Connect Claude / Cursor', href: null, icon: 'plug' },
    { label: 'Topic briefs (MCP)', href: null, icon: 'doc' },
    { label: 'Weekly digest', href: null, icon: 'mail' },
  ] },
  { title: 'Account', items: [
    { label: 'Profile', href: '/settings/profile', icon: 'user' },
    { label: 'Account & delete', href: '/settings/account', icon: 'gear' },
  ] },
];

export const soonHref = (label: string) => `/dashboard/soon?f=${encodeURIComponent(label)}`;
