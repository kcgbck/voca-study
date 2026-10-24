// 보카 스터디 PWA Service Worker (v8.0.0 - Canonical Main & Fresh Update)
const CACHE_NAME = 'voca-study-cache-v8';

// 오프라인 실행을 위한 필수 앱 셸 에셋
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon.svg',
  '/data/builtin_words_v1.json',
  '/data/maritime_smcp_v1.json',
  '/data/builtin_japanese_exam.json',
  '/data/builtin_japanese_life.json'
];

// 설치 단계: 필수 에셋 프리캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching offline app shell');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 활성화 단계: 구버전 캐시 정리 (voca-study-cache- 접두사 구버전만 정리)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key.startsWith('voca-study-cache-') && key !== CACHE_NAME) {
            console.log('[ServiceWorker] Removing old cache', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 외부 제어 메시지 (캐시 강제 정리 및 즉시 교체)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keyList) => {
        return Promise.all(keyList.map((key) => caches.delete(key)));
      })
    );
  }
});

// 네트워크 요청 수신: API 요청은 실시간 직통, HTML 탐색은 Network-First, 정적 에셋은 Stale-While-Revalidate
self.addEventListener('fetch', (event) => {
  // GET 요청만 캐싱
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // API 요청은 항상 실시간 네트워크 통신 (캐싱 제외)
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 동일 출처 요청 처리
  if (url.origin === location.origin) {
    const isNavigation =
      event.request.mode === 'navigate' ||
      Boolean(event.request.headers && event.request.headers.get('accept')?.includes('text/html'));

    // HTML 탐색 요청: Network-First (5초 상한 AbortController, 최신 배포 즉시 반영 및 오프라인 폴백)
    if (isNavigation) {
      event.respondWith(
        (async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          try {
            const networkResponse = await fetch(event.request, {
              cache: 'no-cache',
              signal: controller.signal,
            });

            const contentType = networkResponse.headers ? networkResponse.headers.get('content-type') : null;
            const isHtml = Boolean(contentType && contentType.includes('text/html'));

            // 정상 200, 비리다이렉트 HTML 응답만 캐시에 저장
            if (networkResponse.status === 200 && !networkResponse.redirected && isHtml) {
              const responseToCache = networkResponse.clone();
              if (event.waitUntil) {
                event.waitUntil(
                  caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache))
                );
              } else {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
              }
            }
            return networkResponse;
          } catch {
            const cachedRequest = await caches.match(event.request);
            if (cachedRequest) return cachedRequest;
            const cachedRoot = await caches.match('/');
            if (cachedRoot) return cachedRoot;
            return new Response('Offline / Service Unavailable', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            });
          } finally {
            clearTimeout(timer);
          }
        })()
      );
      return;
    }

    // 나머지 정적 에셋: Stale-While-Revalidate 유지
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // 캐시가 있으면 즉시 반환하고, 백그라운드에서 최신화 (Stale-While-Revalidate)
          const revalidatePromise = fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                return caches.open(CACHE_NAME).then((cache) => {
                  return cache.put(event.request, networkResponse);
                });
              }
            })
            .catch(() => {
              // 오프라인일 때는 백그라운드 fetch 실패 무시
            });
          if (event.waitUntil) {
            event.waitUntil(revalidatePromise);
          }
          return cachedResponse;
        }

        // 캐시에 없으면 네트워크 fetch
        return fetch(event.request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // 새로운 정적 리소스 캐시에 보관
            const responseToCache = networkResponse.clone();
            if (event.waitUntil) {
              event.waitUntil(
                caches.open(CACHE_NAME).then((cache) => {
                  return cache.put(event.request, responseToCache);
                })
              );
            } else {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }

            return networkResponse;
          })
          .catch(() => {
            // 오프라인이고 HTML 요청인 경우 루트 페이지 반환
            if (event.request.headers.get('accept')?.includes('text/html')) {
              return caches.match('/');
            }
          });
      })
    );
  }
});
