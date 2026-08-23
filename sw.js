/* Service worker da Estação Sapatão — só para as notificações push.
   Sem cache: as páginas continuam vindo sempre frescas da rede. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var dados = {};
  try { dados = e.data ? e.data.json() : {}; } catch (err) { dados = { body: e.data && e.data.text() }; }
  var titulo = dados.title || 'Estação Sapatão';
  var opcoes = {
    body: dados.body || 'Novidade nos painéis.',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: dados.url || './estrategia/#notificacoes' }
  };
  e.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  var painel = url.indexOf('roadmap') >= 0 ? 'roadmap' : 'estrategia';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].url.indexOf(painel) >= 0 && 'focus' in lista[i]) return lista[i].focus();
    }
    return clients.openWindow(url);
  }));
});
