// Register from the app:  navigator.serviceWorker.register('/sw-push.js')  then  registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: <VAPID public key> })
self.addEventListener('push', (event) => {
  let d = {}; try { d = event.data ? event.data.json() : {}; } catch { /* ignore malformed payloads */ }
  const url = typeof d.url === 'string' && d.url.startsWith(self.location.origin) ? d.url : self.location.origin + '/dashboard';     // never open a URL from another origin
  event.waitUntil(self.registration.showNotification(String(d.title || 'Price drop').slice(0, 80), { body: String(d.body || '').slice(0, 200), tag: String(d.tag || 'price'), data: { url } }));
});
self.addEventListener('notificationclick', (event) => { event.notification.close(); event.waitUntil(self.clients.openWindow(event.notification.data.url)); });
