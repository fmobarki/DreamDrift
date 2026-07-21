// محاكاة دنيا لـ IndexedDB تكفي بالضبط ما يستخدمه sw.js:
// open(name, version) → onupgradeneeded/onsuccess، transaction → objectStore
// get/put/clear مع oncomplete. تُبقي البيانات في الذاكرة طوال عمر الكائن
// المُعاد من createFakeIndexedDB() — هذا يحاكي بقاء IndexedDB الحقيقي عبر
// إعادة تشغيل الـ Service Worker (بعكس متغيرات self.* العادية التي تُمسح).

export function createFakeIndexedDB() {
  const databases = new Map(); // name -> Map(storeName -> Map(key -> value))

  function getDB(name) {
    if (!databases.has(name)) databases.set(name, new Map());
    return databases.get(name);
  }

  return {
    _databases: databases,
    open(name) {
      const req = {};
      queueMicrotask(() => {
        const stores = getDB(name);
        const fakeDb = {
          createObjectStore(storeName) {
            if (!stores.has(storeName)) stores.set(storeName, new Map());
            return {};
          },
          transaction(storeName) {
            if (!stores.has(storeName)) stores.set(storeName, new Map());
            const store = stores.get(storeName);
            const tx = { oncomplete: null, onerror: null };
            tx.objectStore = () => ({
              get(key) {
                const rq = {};
                queueMicrotask(() => {
                  rq.result = store.get(key);
                  rq.onsuccess && rq.onsuccess();
                });
                return rq;
              },
              put(value, key) {
                store.set(key, value);
                queueMicrotask(() => tx.oncomplete && tx.oncomplete());
                return {};
              },
              clear() {
                store.clear();
                queueMicrotask(() => tx.oncomplete && tx.oncomplete());
                return {};
              },
            });
            return tx;
          },
        };
        req.result = fakeDb;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        req.onsuccess && req.onsuccess();
      });
      return req;
    },
  };
}
