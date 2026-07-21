// اختبارات sw.js — جدولة وإطلاق إشعارات التهدئة والاستيقاظ.
// نُشغّل sw.js الحقيقي كاملاً داخل vm بسياق (self/indexedDB) وهمي، ثم نحاكي
// أحداث 'message' كما يرسلها index.html فعلياً، ونتحقق من registration.showNotification.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readSw, runInContext } from "./helpers/extract.mjs";
import { createFakeIndexedDB } from "./helpers/fakeIndexedDB.mjs";

function makeSelfMock() {
  const listeners = {};
  const notifications = [];
  const self = {
    addEventListener(type, cb) {
      (listeners[type] = listeners[type] || []).push(cb);
    },
    skipWaiting: () => { self._skipWaitingCalled = true; },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
    },
    registration: {
      showNotification: async (title, opts) => {
        notifications.push({ title, ...opts });
      },
    },
    _skipWaitingCalled: false,
  };
  return { self, listeners, notifications };
}

// يبني دالة Date بديلة تُعيد دائماً تاريخاً ثابتاً عند الاستدعاء بلا وسائط
// (هكذا يستدعيها sw.js في nowHM/todayKey) — بدون class/extends لتفادي تعقيد
// دلالات إرجاع الكائن من مُنشئ فرعي لصنف مبني داخلياً.
function makeFixedDate(fixedDate) {
  const RealDate = Date;
  function FixedDate(...args) {
    if (args.length === 0) return new RealDate(fixedDate.getTime());
    return new RealDate(...args);
  }
  FixedDate.now = () => fixedDate.getTime();
  return FixedDate;
}

function buildSwContext({ nowDate } = {}) {
  const { self, listeners, notifications } = makeSelfMock();
  const idb = createFakeIndexedDB();
  const context = {
    console,
    self,
    indexedDB: idb,
    caches: {
      // غير مستخدم في اختبارات الإشعارات (اختبار دورة الحياة يستخدمها بشكل أساسي)
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
    fetch: async () => ({ clone: () => ({}) }),
    location: { origin: "https://example.github.io" },
    setTimeout, clearTimeout, queueMicrotask,
    Date: nowDate ? makeFixedDate(nowDate) : Date,
  };
  runInContext(readSw(), context, "sw.js");
  return { context, listeners, notifications, idb };
}

// يحاكي حدث message كما يُرسله navigator.serviceWorker + reg.active.postMessage في index.html
// ملاحظة مهمة: معالج 'message' في sw.js دالة غير متزامنة تستدعي event.waitUntil(promise)
// كأثر جانبي دون إرجاعه — تماماً كما تتطلبه واجهة ServiceWorker الحقيقية. لذا نلتقط
// الوعد عبر واجهة waitUntil الوهمية وننتظره صراحةً، بدل انتظار عائد الدالة نفسها.
async function sendMessage(listeners, data, ports) {
  const handlers = listeners["message"] || [];
  for (const h of handlers) {
    let pending;
    const event = { data, ports, waitUntil: (p) => { pending = p; } };
    h(event);
    if (pending) await pending;
  }
}

describe("sw.js — جدولة الإشعارات", () => {
  test("SCHEDULE_WIND_DOWN ثم CHECK_NOTIFICATIONS_NOW يُطلق إشعاراً ضمن نافذة 5 دقائق", async () => {
    const fixedNow = new Date(2026, 6, 20, 6, 2); // 06:02 محلياً
    const { listeners, notifications } = buildSwContext({ nowDate: fixedNow });

    await sendMessage(listeners, { type: "SCHEDULE_ALARM", time: "06:00", lang: "ar" });
    await sendMessage(listeners, { type: "CHECK_NOTIFICATIONS_NOW" });

    assert.equal(notifications.length, 1, "يجب أن يُطلق إشعاراً واحداً بالضبط");
    assert.match(notifications[0].title, /صباح/, "يجب استخدام نص عربي لأن lang=ar");
  });

  test("لا يُطلق إشعاراً قبل الموعد", async () => {
    const fixedNow = new Date(2026, 6, 20, 5, 58); // قبل الموعد بدقيقتين
    const { listeners, notifications } = buildSwContext({ nowDate: fixedNow });

    await sendMessage(listeners, { type: "SCHEDULE_ALARM", time: "06:00", lang: "ar" });
    await sendMessage(listeners, { type: "CHECK_NOTIFICATIONS_NOW" });

    assert.equal(notifications.length, 0);
  });

  test("لا يُطلق إشعاراً بعد انتهاء نافذة الـ5 دقائق", async () => {
    const fixedNow = new Date(2026, 6, 20, 6, 9); // بعد الموعد بـ9 دقائق
    const { listeners, notifications } = buildSwContext({ nowDate: fixedNow });

    await sendMessage(listeners, { type: "SCHEDULE_ALARM", time: "06:00", lang: "ar" });
    await sendMessage(listeners, { type: "CHECK_NOTIFICATIONS_NOW" });

    assert.equal(notifications.length, 0);
  });

  test("لا يتكرر الإشعار عند فحوصات متعددة في نفس اليوم (سيناريو المستخدم الفعلي)", async () => {
    const fixedNow = new Date(2026, 6, 20, 6, 1);
    const { listeners, notifications } = buildSwContext({ nowDate: fixedNow });

    await sendMessage(listeners, { type: "SCHEDULE_ALARM", time: "06:00", lang: "ar" });
    // المستخدم يفتح التطبيق عدة مرات قرب الموعد (كل فتح يرسل CHECK_NOTIFICATIONS_NOW)
    await sendMessage(listeners, { type: "CHECK_NOTIFICATIONS_NOW" });
    await sendMessage(listeners, { type: "CHECK_NOTIFICATIONS_NOW" });
    await sendMessage(listeners, { type: "CHECK_NOTIFICATIONS_NOW" });

    assert.equal(notifications.length, 1, "3 فحوصات في نفس النافذة يجب أن تُنتج إشعاراً واحداً فقط");
  });

  test("CANCEL_ALL يمسح الجدول فلا يُطلق شيئاً بعده", async () => {
    const fixedNow = new Date(2026, 6, 20, 6, 1);
    const { listeners, notifications } = buildSwContext({ nowDate: fixedNow });

    await sendMessage(listeners, { type: "SCHEDULE_ALARM", time: "06:00", lang: "ar" });
    await sendMessage(listeners, { type: "CANCEL_ALL" });
    await sendMessage(listeners, { type: "CHECK_NOTIFICATIONS_NOW" });

    assert.equal(notifications.length, 0);
  });

  test("بلا أي SCHEDULE سابق، CHECK_NOTIFICATIONS_NOW لا يفعل شيئاً ولا يرمي خطأً", async () => {
    const { listeners, notifications } = buildSwContext({ nowDate: new Date(2026, 6, 20, 6, 0) });
    await sendMessage(listeners, { type: "CHECK_NOTIFICATIONS_NOW" });
    assert.equal(notifications.length, 0);
  });

  test("يعمل بشكل صحيح عبر عبور منتصف الليل (موعد 23:58، الآن 00:02)", async () => {
    const fixedNow = new Date(2026, 6, 20, 0, 2);
    const { listeners, notifications } = buildSwContext({ nowDate: fixedNow });

    await sendMessage(listeners, { type: "SCHEDULE_WIND_DOWN", time: "23:58", lang: "en" });
    await sendMessage(listeners, { type: "CHECK_NOTIFICATIONS_NOW" });

    assert.equal(notifications.length, 1);
    assert.match(notifications[0].title, /Wind-down/);
  });

  test("GET_STATUS يعيد الجدول الفعلي عبر MessageChannel (يغذّي لوحة التشخيص في التطبيق)", async () => {
    const { listeners } = buildSwContext({ nowDate: new Date(2026, 6, 20, 6, 1) });
    await sendMessage(listeners, { type: "SCHEDULE_ALARM", time: "06:00", lang: "ar" });

    let received = null;
    const port1 = { onmessage: null };
    const port2 = { postMessage: (msg) => received = msg };
    await sendMessage(listeners, { type: "GET_STATUS" }, [port2]);

    assert.ok(received, "يجب أن يردّ SW على GET_STATUS");
    assert.equal(received.type, "STATUS");
    assert.equal(received.schedule.alarmTime, "06:00");
  });

  test("SCHEDULE_ALL يجدول التهدئة والاستيقاظ معاً في كتابة واحدة ذرية", async () => {
    const { listeners } = buildSwContext({ nowDate: new Date(2026, 6, 20, 6, 1) });
    await sendMessage(listeners, { type: "SCHEDULE_ALL", windDownTime: "21:30", alarmTime: "06:00", lang: "ar" });

    let received = null;
    const port2 = { postMessage: (msg) => received = msg };
    await sendMessage(listeners, { type: "GET_STATUS" }, [port2]);

    assert.equal(received.schedule.windDownTime, "21:30");
    assert.equal(received.schedule.alarmTime, "06:00");
  });

  test("اختبار انحدار: رسالتا SCHEDULE_WIND_DOWN وSCHEDULE_ALARM بلا انتظار بينهما لا تفقدان بعضهما (علّة تسابق حقيقية وُجدت ميدانياً)", async () => {
    // هذا يحاكي الشكل القديم لـ schedulePWANotifications في index.html، الذي
    // كان يرسل رسالتين متتاليتين دون انتظار الأولى — الاستخدام الفعلي أظهر أن
    // windDownTime كان يُفقَد باستمرار بينما alarmTime وحده ينجو، لأن كل رسالة
    // كانت تقرأ الجدول وتكتبه بشكل مستقل، فتكتب الثانية فوق تعديل الأولى.
    // الإصلاح الآن مزدوج: (1) رسالة واحدة ذرية SCHEDULE_ALL في التطبيق الفعلي،
    // (2) طابور تسلسلي داخل saveSchedule في sw.js كحماية عامة من أي تسابق مماثل.
    const { listeners } = buildSwContext({ nowDate: new Date(2026, 6, 20, 6, 1) });
    const handlers = listeners["message"] || [];

    // نُطلق الرسالتين بلا انتظار — كما كان يحدث فعلياً، لنتأكد أن الطابور
    // الجديد في saveSchedule يحمي حتى لو استُخدم المسار القديم يوماً
    const pendings = [];
    const capture = (data) => {
      let pending;
      handlers.forEach((h) => h({ data, waitUntil: (p) => { pending = p; } }));
      if (pending) pendings.push(pending);
    };
    capture({ type: "SCHEDULE_WIND_DOWN", time: "21:30", lang: "ar" });
    capture({ type: "SCHEDULE_ALARM", time: "06:00", lang: "ar" });
    await Promise.all(pendings);

    let received = null;
    const port2 = { postMessage: (msg) => received = msg };
    await sendMessage(listeners, { type: "GET_STATUS" }, [port2]);

    assert.equal(received.schedule.windDownTime, "21:30", "لا يجب أن يُفقَد التهدئة رغم عدم الانتظار بين الرسالتين");
    assert.equal(received.schedule.alarmTime, "06:00");
  });

  test("لا يُطلق أي إشعار إن لم يُستدعَ CHECK_NOTIFICATIONS_NOW مطلقاً — هذا هو السبب الأشيع لعدم وصول الإشعارات عملياً", async () => {
    // هذا الاختبار يوثّق قيداً معمارياً متعمَّداً: sw.js لا يُطلق شيئاً من تلقاء
    // نفسه إلا عبر periodicsync أو رسالة CHECK_NOTIFICATIONS_NOW من التطبيق.
    // إن كان المتصفح لا يدعم periodicSync (iOS) أو لم يُمنح إذنه بعد (شائع بعد
    // التثبيت الحديث)، فلن يصل أي إشعار إلا حين يكون التطبيق نفسه مفتوحاً قرب الموعد.
    const fixedNow = new Date(2026, 6, 20, 6, 1);
    const { listeners, notifications } = buildSwContext({ nowDate: fixedNow });
    await sendMessage(listeners, { type: "SCHEDULE_ALARM", time: "06:00", lang: "ar" });
    // لا CHECK_NOTIFICATIONS_NOW ولا periodicsync هنا
    assert.equal(notifications.length, 0);
  });
});

describe("sw.js — دورة حياة الإصدار الجديد", () => {
  test("install يستدعي skipWaiting فوراً (وإلا لن يظهر شريط التحديث أثناء الاستخدام العادي)", async () => {
    const { context, listeners } = buildSwContext({});
    const handlers = listeners["install"] || [];
    assert.equal(handlers.length, 1, "يجب وجود معالج install واحد");
    let pending;
    handlers[0]({ waitUntil: (p) => { pending = p; } });
    if (pending) await pending;
    assert.equal(context.self._skipWaitingCalled, true);
  });
});
