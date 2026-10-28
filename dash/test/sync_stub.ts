(window as any).__sync = 0;
export const startExtensionSync = () => { (window as any).__sync++; return () => {}; };
