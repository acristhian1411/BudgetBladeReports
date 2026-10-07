import { build, files, version } from '$service-worker';

const CACHE_PREFIX = 'budgetblade-reports-';
const CACHE_NAME = `${CACHE_PREFIX}${version}`;
const ASSETS = [...build, ...files];
const ASSET_PATHS = new Set(
	ASSETS.map((asset) => new URL(asset, self.location.origin).pathname)
);

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(
				keys
					.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
					.map((key) => caches.delete(key))
			)
		)
	);
});

self.addEventListener('fetch', (event) => {
	const requestUrl = new URL(event.request.url);
	if (
		event.request.method !== 'GET' ||
		requestUrl.origin !== self.location.origin ||
		!ASSET_PATHS.has(requestUrl.pathname)
	) {
		return;
	}

	event.respondWith(
		caches.open(CACHE_NAME).then(async (cache) => {
			const cached = await cache.match(event.request, { ignoreSearch: true });
			return cached || fetch(event.request);
		})
	);
});