const W = window as any; W.__replaced = []; W.__refreshed = 0;
export const usePathname = () => '/de/dashboard';
export const useSearchParams = () => new URLSearchParams('tab=tasks');
export const useRouter = () => ({ replace: (u: string, o: any) => W.__replaced.push([u, o]), refresh: () => { W.__refreshed++; } });
