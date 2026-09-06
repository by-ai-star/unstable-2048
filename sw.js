// Service Worker：预缓存全部游戏文件，安装后完全离线可玩。
// ⚠️ 每次更新游戏代码后必须递增 CACHE_NAME 版本号（v1 → v2 → ...），
// 否则已安装的 PWA 可能继续读取旧缓存。
const CACHE_NAME = 'unstable-2048-v5';

// 全部使用相对路径（./），适配 GitHub Pages 的 /unstable-2048/ 子路径部署。
// 新增游戏文件时必须同步加入此清单并递增版本号。
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './vendor/matter.min.js',

  './js/config.js',
  './js/core/EventBus.js',
  './js/entities/Cell.js',
  './js/entities/RigidBody.js',
  './js/entities/Piece.js',
  './js/systems/PhysicsWorld.js',
  './js/systems/SpawnSystem.js',
  './js/systems/MergeSystem.js',
  './js/systems/LoseSystem.js',
  './js/systems/ScoreSystem.js',
  './js/systems/HistorySystem.js',
  './js/systems/IdleAI.js',
  './js/systems/InputSystem.js',
  './js/core/Game.js',
  './js/render/Renderer.js',
  './js/ui/ui.js',
  './js/main.js',

  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cacheAllWithRetry(cache))
      .then(() => self.skipWaiting())
  );
});

// 弱网容错缓存：逐文件下载，失败文件自动重试最多 3 轮。
// 旧版用 cache.addAll（全有全无），单个文件下载失败会导致整个离线缓存作废；
// 个别文件最终仍失败的，由 fetch 处理器的运行时缓存兜底（联网打开一次即补齐）
async function cacheAllWithRetry(cache) {
  let pending = APP_SHELL.slice();
  for (let round = 0; round < 3 && pending.length; round++) {
    const results = await Promise.all(pending.map(async url => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return false;
        await cache.put(url, resp);
        return true;
      } catch (e) {
        return false;
      }
    }));
    pending = pending.filter((url, i) => !results[i]);
  }
}

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// 页面查询离线缓存状态（主菜单底部的"离线缓存"指示）
self.addEventListener('message', event => {
  if (event.data !== 'GET_CACHE_STATUS') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const count = (await cache.keys()).length;
    const clients = await self.clients.matchAll();
    for (const client of clients) {
      client.postMessage({
        type: 'CACHE_STATUS',
        name: CACHE_NAME,
        count,
        total: APP_SHELL.length
      });
    }
  })());
});

// 缓存优先，未命中走网络；导航请求离线时回退到 index.html
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;

      return fetch(request).then(response => {
        // 同源成功响应写入缓存，便于后续离线访问
        if (response.ok && new URL(request.url).origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return Response.error();
      });
    })
  );
});
