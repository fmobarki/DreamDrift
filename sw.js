/* ============================================================
   DreamDrift — Service Worker
   • تخزين مؤقت (Cache) للعمل دون إنترنت
   • جدولة تذكير الاسترخاء ومنبّه الاستيقاظ عبر IndexedDB
     (لأن SW يُنهى ويُعاد تشغيله كثيراً، فذاكرته العادية لا تكفي)
   ============================================================ */

const CACHE_VERSION = "dreamdrift-v1.1.4";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

/* ---------------- تثبيت + تفعيل ---------------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  // فعّل النسخة الجديدة فوراً بدل الانتظار حتى تُغلق كل التبويبات —
  // بدونها لن يظهر شريط "تحديث الآن" أبداً أثناء الاستخدام العادي
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const oldKeys = keys.filter((k) => k !== CACHE_VERSION);
      await Promise.all(oldKeys.map((k) => caches.delete(k)));
      await self.clients.claim();
      // أبلغ الصفحات المفتوحة بوجود نسخة جديدة — فقط إن كان هناك تخزين قديم
      // (أي أن هذا تحديث لا أول تثبيت)
      if (oldKeys.length) {
        const clientsList = await self.clients.matchAll();
        clientsList.forEach((c) => c.postMessage({ type: "SW_UPDATED" }));
      }
    })()
  );
});

/* ---------------- الشبكة والتخزين المؤقت ---------------- */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // اترك الخطوط الخارجية للمتصفح

  const isNav = req.mode === "navigate" || url.pathname.endsWith("index.html");
  event.respondWith(isNav ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_VERSION);
    cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    return (await caches.match(req)) || (await caches.match("./index.html"));
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_VERSION);
    cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    return cached; // undefined إن لم يوجد — يفشل الطلب بصمت، مقبول لأصل غير أساسي
  }
}

/* ---------------- تخزين الجدول عبر IndexedDB ---------------- */
const DB_NAME = "dreamdrift-sw";
const STORE = "schedule";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const rq = tx.objectStore(STORE).get(key);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}
async function idbSet(key, val) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- منطق الجدولة والفحص ---------------- */
const MSG = {
  windDown: {
    ar: { title: "وقت التهدئة اقترب 🌙", body: "ابدأ روتين الاسترخاء الآن لتنام في وقتك المعتاد." },
    en: { title: "Wind-down time 🌙", body: "Start your relax routine now to sleep on schedule." },
  },
  alarm: {
    ar: { title: "صباح الخير ☀️", body: "حان وقت استيقاظك — ابدأ يومك." },
    en: { title: "Good morning ☀️", body: "It's your wake-up time — start your day." },
  },
};

// "HH:MM" الحالية بتوقيت الجهاز
function nowHM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}
// فرق دقائق بين وقتين "HH:MM" (0..1439، يتعامل مع التفاف منتصف الليل)
function minutesDiff(target, current) {
  const [th, tm] = target.split(":").map(Number);
  const [ch, cm] = current.split(":").map(Number);
  let diff = (ch * 60 + cm) - (th * 60 + tm);
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff; // موجب = الوقت الحالي بعد الهدف
}

// طابور تسلسلي: يضمن تنفيذ كل عملية حفظ (قراءة ثم كتابة) بالكامل قبل بدء
// التالية، حتى لو وصلت عدة رسائل SCHEDULE_* في نفس اللحظة. بدونه، عمليتا
// قراءة-ثم-كتابة متزامنتان قد تتسابقان: الثانية تقرأ الحالة القديمة قبل أن
// تكتب الأولى تعديلها، فتكتب فوقه وتُفقِد التعديل الأول بصمت.
let scheduleWriteQueue = Promise.resolve();
async function saveSchedule(patch) {
  scheduleWriteQueue = scheduleWriteQueue
    .then(async () => {
      const cur = (await idbGet("schedule")) || {};
      await idbSet("schedule", { ...cur, ...patch });
    })
    .catch(() => {}); // فشل عملية واحدة لا يوقف الطابور عن معالجة البقية
  return scheduleWriteQueue;
}
async function clearSchedule() {
  await idbClear();
}

async function fireIfDue(kind, time, lang) {
  if (!time) return;
  const diff = minutesDiff(time, nowHM());
  // نافذة ٥ دقائق بعد الموعد (تغطي فحص فتح التطبيق + كل ١٥ دقيقة عبر periodicSync)
  if (diff < 0 || diff > 5) return;

  const firedKey = "fired_" + kind;
  const sched = (await idbGet("schedule")) || {};
  if (sched[firedKey] === todayKey()) return; // أُطلق اليوم بالفعل

  const m = MSG[kind][lang === "en" ? "en" : "ar"];
  await self.registration.showNotification(m.title, {
    body: m.body,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: "dreamdrift-" + kind,
    dir: lang === "en" ? "ltr" : "rtl",
    lang: lang === "en" ? "en" : "ar",
  });
  await idbSet("schedule", { ...sched, [firedKey]: todayKey() });
}

async function checkAndFireNotifications() {
  const sched = (await idbGet("schedule")) || {};
  const lang = sched.lang || "ar";
  await fireIfDue("windDown", sched.windDownTime, lang);
  await fireIfDue("alarm", sched.alarmTime, lang);
}

/* ---------------- استقبال الرسائل من التطبيق ---------------- */
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SCHEDULE_ALL") {
    // المسار الحالي المستخدم فعلياً: يجدول التهدئة والاستيقاظ في كتابة واحدة ذرية
    event.waitUntil(saveSchedule({ windDownTime: data.windDownTime, alarmTime: data.alarmTime, lang: data.lang }));
  } else if (data.type === "SCHEDULE_WIND_DOWN") {
    event.waitUntil(saveSchedule({ windDownTime: data.time, lang: data.lang }));
  } else if (data.type === "SCHEDULE_ALARM") {
    event.waitUntil(saveSchedule({ alarmTime: data.time, lang: data.lang }));
  } else if (data.type === "CHECK_NOTIFICATIONS_NOW") {
    event.waitUntil(checkAndFireNotifications());
  } else if (data.type === "CANCEL_ALL") {
    event.waitUntil(clearSchedule());
  } else if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (data.type === "GET_STATUS") {
    // تشخيص حي: يُعيد حالة الجدول الفعلية عبر MessageChannel
    event.waitUntil(
      (async () => {
        const sched = (await idbGet("schedule")) || {};
        const port = event.ports && event.ports[0];
        if (port) {
          port.postMessage({
            type: "STATUS",
            schedule: sched,
            nowHM: nowHM(),
            todayKey: todayKey(),
            cacheVersion: CACHE_VERSION,
          });
        }
      })()
    );
  }
});

/* ---------------- الفحص الدوري (إن كان periodicSync مدعوماً ومسموحاً) ---------------- */
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "dd-notif-check") {
    event.waitUntil(checkAndFireNotifications());
  }
});

/* ---------------- فتح/تركيز التطبيق عند الضغط على الإشعار ---------------- */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clientsList) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })()
  );
});
