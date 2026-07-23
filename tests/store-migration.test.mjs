// اختبارات Store وترحيل بنية البيانات عبر SCHEMA_VERSION.
// نستخرج Store الحقيقي من index.html ونُشغّله فوق localStorage وهمي، محاكين
// بالضبط سيناريو مستخدم قديم يفتح نسخة جديدة من التطبيق.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext } from "./helpers/extract.mjs";

const html = readIndexHtml();
// SCHEMA_VERSION و Store معاً حتى تُختبر آلية الترحيل ضد رقم الإصدار الفعلي الحالي لا رقماً مُفترَضاً
const moduleSource = extractBetween(html, "const SCHEMA_VERSION", "\nconst STR = {")
  .replace("const SCHEMA_VERSION", "var SCHEMA_VERSION")
  .replace("const Store", "var Store");

function makeLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    _raw: store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
  };
}

function buildStore(localStorageInitial) {
  const localStorage = makeLocalStorage(localStorageInitial);
  const context = { console, localStorage, JSON, Object };
  runInContext(moduleSource, context, "store.js");
  return { Store: context.Store, SCHEMA_VERSION: context.SCHEMA_VERSION, localStorage };
}

describe("Store._migrate — ترحيل عبر الإصدارات", () => {
  test("مستخدم جديد كلياً (لا بيانات محفوظة) يحصل على __schemaVersion الحالي مباشرة", () => {
    const { Store, SCHEMA_VERSION } = buildStore({});
    Store.load();
    assert.equal(Store.data.__schemaVersion, SCHEMA_VERSION);
  });

  test("مستخدم من v1 (بلا __schemaVersion إطلاقاً): يُعامَل كـv1 ويُرحَّل بكل الخطوات", () => {
    const { Store, SCHEMA_VERSION } = buildStore({
      dd_data: JSON.stringify({ name: "فهد" }), // بلا __schemaVersion
    });
    Store.load();
    assert.equal(Store.data.__schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(structuredClone(Store.data.moods), {});
    assert.deepEqual(structuredClone(Store.data.breatheSessions), []);
    assert.deepEqual(structuredClone(Store.data.sleepLogs), {});
    assert.equal(Store.data.calmMinutes, 0);
    assert.equal(Store.data.voiceCues, true);
  });

  test("مستخدم من v3 القديم: تُحذف بقايا الموجة الثنائية من mixLevels", () => {
    const { Store } = buildStore({
      dd_data: JSON.stringify({
        __schemaVersion: 3,
        mixLevels: { rain: 40, binaural: 45, ocean: 0 },
      }),
    });
    Store.load();
    assert.equal("binaural" in Store.data.mixLevels, false);
    assert.equal(Store.data.mixLevels.rain, 40); // بقية القيم تبقى كما هي
    assert.equal(Store.data.voiceCues, true); // يُضاف افتراضياً
  });

  test("مستخدم من v3 بلا mixLevels إطلاقاً: لا يرمي خطأً", () => {
    const { Store } = buildStore({ dd_data: JSON.stringify({ __schemaVersion: 3 }) });
    assert.doesNotThrow(() => Store.load());
    assert.equal(Store.data.voiceCues, true);
  });

  test("مستخدم محدَّث بالفعل (نفس SCHEMA_VERSION) لا يُعاد ترحيله ولا تُفقد بياناته", () => {
    const currentVersion = buildStore({}).SCHEMA_VERSION; // نعرف الرقم الحالي أولاً
    const { Store } = buildStore({
      dd_data: JSON.stringify({ __schemaVersion: currentVersion, wakeTime: "07:15", voiceCues: false }),
    });
    Store.load();
    assert.equal(Store.data.wakeTime, "07:15");
    assert.equal(Store.data.voiceCues, false, "قيمة المستخدم المُعدَّلة يدوياً يجب ألا يُعاد ضبطها للافتراضي");
  });

  test("get/set يعملان بعد التحميل، وset يحفظ في localStorage", () => {
    const { Store, localStorage } = buildStore({});
    Store.load();
    Store.set("wakeTime", "06:45");
    assert.equal(Store.get("wakeTime", "00:00"), "06:45");
    const saved = JSON.parse(localStorage.getItem("dd_data"));
    assert.equal(saved.wakeTime, "06:45");
  });

  test("localStorage تالف (JSON غير صالح) لا يُسقط التطبيق — يبدأ ببيانات فارغة", () => {
    const { Store, SCHEMA_VERSION } = buildStore({ dd_data: "{not valid json" });
    assert.doesNotThrow(() => Store.load());
    assert.equal(Store.data.__schemaVersion, SCHEMA_VERSION);
  });

  test("ترحيل مفتاح تخزين قديم جداً (dreamdrift_v1) إلى المفتاح الحالي", () => {
    const { Store } = buildStore({ dreamdrift_v1: JSON.stringify({ name: "أحمد" }) });
    Store.load();
    assert.equal(Store.data.name, "أحمد");
  });

  test("v4 → v5: نصيحة ذكاء اصطناعي مخزَّنة بالنموذج القديم (aiLastTip) تتحوّل لأول سجل في aiHistory بلا فقدان", () => {
    const { Store } = buildStore({
      dd_data: JSON.stringify({
        __schemaVersion: 4,
        aiLastTip: { t: "نصيحة قديمة", why: "سبب قديم" },
        aiLastCallTs: 1700000000000,
        aiLastCallDxKey: "delay",
        aiProvider: "anthropic",
      }),
    });
    Store.load();
    assert.equal(Store.data.aiLastTip, undefined, "يجب حذف المفتاح القديم بعد الترحيل");
    assert.equal(Store.data.aiLastCallTs, undefined);
    assert.equal(Store.data.aiLastCallDxKey, undefined);
    assert.equal(Store.data.aiHistory.length, 1);
    assert.equal(Store.data.aiHistory[0].t, "نصيحة قديمة");
    assert.equal(Store.data.aiHistory[0].why, "سبب قديم");
    assert.equal(Store.data.aiHistory[0].ts, 1700000000000);
    assert.equal(Store.data.aiHistory[0].provider, "anthropic");
    assert.equal(Store.data.aiHistory[0].dxKey, "delay");
  });

  test("v4 → v5: مستخدم لم يفعّل الذكاء الاصطناعي إطلاقاً يحصل على aiHistory فارغة لا خطأ", () => {
    const { Store } = buildStore({ dd_data: JSON.stringify({ __schemaVersion: 4 }) });
    assert.doesNotThrow(() => Store.load());
    assert.deepEqual(structuredClone(Store.data.aiHistory), []);
  });
});
