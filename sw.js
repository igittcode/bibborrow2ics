const CACHE_PREFIX = "medienrueckgabe-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/app-192.png",
  "./icons/app-512.png",
  "./icons/app.svg",
];
const APP_SHELL_URLS = new Set(
  APP_SHELL.map((asset) => new URL(asset, self.registration.scope).href)
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const oldCacheNames = (await caches.keys())
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
    await Promise.all(oldCacheNames.map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);
  const appScope = new URL(self.registration.scope);
  const appRoot = new URL("./", appScope);
  const indexUrl = new URL("./index.html", appScope);
  if (
    request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    !requestUrl.pathname.startsWith(appScope.pathname)
  ) {
    return;
  }

  const isAppShellNavigation = request.mode === "navigate" && (
    requestUrl.pathname === appRoot.pathname ||
    requestUrl.pathname === indexUrl.pathname
  );
  if (!isAppShellNavigation && !APP_SHELL_URLS.has(requestUrl.href)) return;

  const cacheRequest = isAppShellNavigation
    ? new Request(requestUrl.pathname === appRoot.pathname ? appRoot.href : indexUrl.href)
    : request;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(cacheRequest);
    const fallbackResponse = async () =>
      cachedResponse ??
      (request.mode === "navigate" ? await cache.match(indexUrl.href) : undefined);
    let response;
    try {
      response = await fetch(request);
    } catch (error) {
      const fallback = await fallbackResponse();
      if (fallback) return fallback;
      throw error;
    }

    if (!response.ok) {
      const fallback = await fallbackResponse();
      if (fallback) return fallback;
      return response;
    }

    try {
      await cache.put(cacheRequest, response.clone());
    } catch (error) {
      console.error("Unable to update the offline app cache.", error);
    }
    return response;
  })());
});
