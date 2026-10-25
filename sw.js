/*
  お届け先メモ ― サービスワーカー(オフライン担当)
  アプリ本体のファイルを端末に保存しておき、電波がなくても開けるようにする係です。
  ※ お客さんのデータはここでは扱いません(データは app.js が端末内に保存)。

  動き方:
    ・電波があるとき  … ネット上の最新版を使い、端末の保存分も最新に入れ替える
                        (= ファイルを差し替えたら、次に開いたときに反映される)
    ・電波がないとき  … 端末に保存しておいた版を使う
    ・電波が弱いとき  … 3秒待っても届かなければ、端末に保存しておいた版を使う
*/
const CACHE = "otodoke-app";
const WAIT_MS = 3000;
const FILES = [
  "./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];

// 初めて開いたとき:アプリ本体を端末に保存する
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });

// ファイルを読み込むたび:まずネットの最新版、だめなら端末の保存分
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const fromNet = fetch(req, { cache: "no-cache" }).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    const timeout = new Promise(r => setTimeout(r, WAIT_MS));
    try {
      const res = await Promise.race([fromNet, timeout]);
      if (res) return res;
    } catch (err) { /* オフライン */ }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fromNet; // 端末にもない場合は、ネットを待つ
  })());
});
