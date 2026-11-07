/** Sidebar map. `href` null = not built yet: the link goes to the "Coming soon" page instead of a 404. */
export interface NavItem { label: string; href: string | null; icon: string; external?: boolean }
export interface NavGroup { title: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { title: 'Product', items: [
    { label: 'Overview', href: '/dashboard/overview', icon: 'grid' },
    { label: 'Landing page', href: '/', icon: 'globe', external: true },
    { label: 'Dashboard & Ask', href: '/dashboard', icon: 'chat' },
    { label: 'Notes', href: '/dashboard/notes', icon: 'doc' },
    { label: 'Stacks & Remix', href: '/m/stacks', icon: 'layers' },
  ] },
  { title: 'Onboarding', items: [
    { label: 'Instant import', href: '/dashboard/import/resume', icon: 'download' },
  ] },
  { title: 'Tabs & Teams', items: [
    { label: 'Flush session', href: '/dashboard/sessions', icon: 'tabs' },
    { label: 'Team invites', href: '/dashboard/teams', icon: 'users' },
    { label: 'Friday After-Hours', href: '/dashboard/friday', icon: 'star' },
    { label: 'Vault Studio', href: '/dashboard/studio', icon: 'monitor' },
    { label: 'Link health', href: '/dashboard/link-health', icon: 'link' },
    { label: 'Privacy & Terms', href: '/privacy', icon: 'shield' },
    { label: 'Browser extension', href: '/dashboard/extension', icon: 'puzzle' },
  ] },
  { title: 'AI & Growth', items: [
    { label: 'Connect Claude / Cursor', href: '/dashboard/connect', icon: 'plug' },
    { label: 'Topic briefs (MCP)', href: '/dashboard/briefs', icon: 'doc' },
    { label: 'Weekly digest', href: '/dashboard/digest', icon: 'mail' },
  ] },
  { title: 'Account', items: [
    { label: 'Profile', href: '/settings/profile', icon: 'user' },
    { label: 'Account & delete', href: '/settings/account', icon: 'gear' },
  ] },
];

export const soonHref = (label: string) => `/dashboard/soon?f=${encodeURIComponent(label)}`;
