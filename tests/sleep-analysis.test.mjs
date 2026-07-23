// اختبارات SleepAnalysis (خانة "التحليل التفصيلي" في تبويب رحلتي).
// نستخرج الوحدة الحقيقية من index.html ونُشغّلها على بيانات ثابتة معروفة
// النتيجة (بعضها من النسخة الاحتياطية الفعلية لأحد المستخدمين)، بدل بيانات
// اصطناعية قد تُخفي أخطاء لا تظهر إلا على بيانات واقعية فوضوية.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  readIndexHtml, extractBetween, runInContext, mockDocument, mockStore,
} from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(html, "const DDA_STR", "\nconst breathe = {");

function buildAnalysis({ lang = "ar", storeData = {}, aiAdvisor = undefined, rhythm = undefined } = {}) {
  const document = mockDocument();
  const store = mockStore(storeData);
  const context = {
    console,
    document,
    Store: store,
    LANG: lang,
    Math, Date, JSON, Object,
    aiAdvisor,
    // effectiveWake الحقيقية تراعي الإيقاع المتغيّر واستثناء الغد؛ الاختبارات هنا
    // لا تفحص ذلك تحديداً (مُغطّى في rhythm.test.mjs)، فالافتراضي يعيد ببساطة
    // الوقت المعتاد نفسه من Store — مطابق تماماً لما كانت الاختبارات تفترضه
    // قبل إصلاح diagnose()/render() لاستخدام effectiveWake() بدل القراءة المباشرة.
    rhythm: rhythm || { effectiveWake: () => ({ time: store.get("wakeTime", "06:00"), source: "usual" }) },
  };
  // الوحدتان في المصدر مُعرَّفتان بـ const — نحوّلهما إلى var كي تصبحا خاصيتين
  // على سياق vm يمكن الوصول لهما بعد التشغيل (const لا تتسرّب لكائن global في vm)
  const code = moduleSource.replace("const DDA_STR", "var DDA_STR").replace("const SleepAnalysis", "var SleepAnalysis");
  runInContext(code, context, "sleep-analysis.js");
  return { SleepAnalysis: context.SleepAnalysis, document, store };
}

// بيانات فهد من النسخة الاحتياطية الحقيقية (dreamdrift-backup-2026-07-07.json)
const FAHD_SLEEP_LOGS = {
  "2026-06-27": { bed: "07:29", wake: "13:00", feel: 2 },
  "2026-06-28": { bed: "22:00", wake: "06:00", feel: 3 },
  "2026-06-29": { bed: "21:30", wake: "08:00", feel: 4 },
  "2026-06-30": { bed: "01:00", wake: "08:00", feel: 3 },
  "2026-07-01": { bed: "11:00", wake: "08:00", feel: 4 },
  "2026-07-02": { bed: "03:00", wake: "08:00", feel: 2 },
  "2026-07-03": { bed: "02:00", wake: "09:30", feel: 2 },
  "2026-07-04": { bed: "02:00", wake: "10:00", feel: 3 },
  "2026-07-05": { bed: "01:00", wake: "08:00", feel: 2 },
  "2026-07-07": { bed: "00:30", wake: "08:00", feel: 3 },
};

describe("SleepAnalysis.clean — تنظيف السجلات الشاذة", () => {
  test("يستبعد ليلة مدتها أكثر من 12 ساعة (خطأ إدخال شائع)", () => {
    const { SleepAnalysis, store } = buildAnalysis({ storeData: { sleepLogs: FAHD_SLEEP_LOGS } });
    const nights = SleepAnalysis.clean();
    const bad = nights.find((n) => n.date === "2026-07-01");
    assert.equal(bad.valid, false);
    assert.match(bad.reasons[0], /21\.0 ساعة/);
  });

  test("يستبعد ليلة بدأت صباحاً (ليلة مقلوبة)", () => {
    const { SleepAnalysis } = buildAnalysis({ storeData: { sleepLogs: FAHD_SLEEP_LOGS } });
    const nights = SleepAnalysis.clean();
    const bad = nights.find((n) => n.date === "2026-06-27");
    assert.equal(bad.valid, false);
  });

  test("يُبقي الليالي الطبيعية صالحة", () => {
    const { SleepAnalysis } = buildAnalysis({ storeData: { sleepLogs: FAHD_SLEEP_LOGS } });
    const nights = SleepAnalysis.clean();
    assert.equal(nights.filter((n) => n.valid).length, 8);
    assert.equal(nights.length, 10);
  });

  test("يتجاهل سجلات ناقصة (بلا bed أو wake)", () => {
    const { SleepAnalysis } = buildAnalysis({
      storeData: { sleepLogs: { "2026-07-10": { bed: "23:00" } } }, // بلا wake
    });
    assert.equal(SleepAnalysis.clean().length, 0);
  });

  test("مصفوفة فارغة إن لم توجد سجلات نوم إطلاقاً", () => {
    const { SleepAnalysis } = buildAnalysis({ storeData: {} });
    assert.deepEqual(structuredClone(SleepAnalysis.clean()), []);
  });
});

describe("SleepAnalysis.diagnose — التشخيص التفريقي", () => {
  test("يعيد null بأقل من 3 ليالٍ صالحة", () => {
    const { SleepAnalysis } = buildAnalysis({
      storeData: { sleepLogs: { "2026-07-01": { bed: "23:00", wake: "07:00", feel: 3 } }, wakeTime: "06:00" },
    });
    assert.equal(SleepAnalysis.diagnose(SleepAnalysis.clean()), null);
  });

  test("خلل مُصلَح (بلاغ ميداني): فجوة الاستيقاظ تُحسَب من الوقت الفعّال لا الخام المباشر", () => {
    // السيناريو الحقيقي الذي وُلِّد الخلل: وقت الاستيقاظ الخام (Store.wakeTime)
    // يختلف عن الوقت الفعّال (rhythm.effectiveWake) بسبب إيقاع متغيّر أو استثناء
    // غدٍ نشط. diagnose() كانت تقرأ الخام مباشرة، فتُنتج فجوة استيقاظ (ومن ثمّ
    // فرضية وثقة) لا تطابق ما يعرضه بقية التطبيق (الشجرة، الإشعارات) لنفس اللحظة.
    const fakeRhythm = { effectiveWake: () => ({ time: "08:00", source: "variable" }) };
    const { SleepAnalysis: withRaw } = buildAnalysis({
      storeData: { sleepLogs: FAHD_SLEEP_LOGS, wakeTime: "00:08" }, // الخام القديم الخاطئ
      rhythm: { effectiveWake: () => ({ time: "00:08", source: "usual" }) },
    });
    const { SleepAnalysis: withEffective } = buildAnalysis({
      storeData: { sleepLogs: FAHD_SLEEP_LOGS, wakeTime: "00:08" }, // نفس الخام
      rhythm: fakeRhythm, // لكن الفعّال مختلف تماماً (08:00)
    });
    const dxRaw = withRaw.diagnose(withRaw.clean());
    const dxEffective = withEffective.diagnose(withEffective.clean());
    // نفس بيانات النوم بالضبط، لكن هدف مختلف (00:08 مقابل 08:00) يجب أن يُنتج
    // فجوة استيقاظ مختلفة فعلياً — يُثبِت أن diagnose تستخدم rhythm.effectiveWake()
    // فعلياً لا قيمة ثابتة مصادفة
    assert.notEqual(dxRaw.wakeGap, dxEffective.wakeGap, "فجوة الاستيقاظ يجب أن تتغيّر مع تغيّر الوقت الفعّال");
  });

  test("بيانات فهد: يشخّص تأخر طور النوم بفجوة استيقاظ ~2:11 وr موجب قوي", () => {
    const { SleepAnalysis } = buildAnalysis({ storeData: { sleepLogs: FAHD_SLEEP_LOGS, wakeTime: "06:00" } });
    const dx = SleepAnalysis.diagnose(SleepAnalysis.clean());
    assert.equal(dx.key, "delay");
    assert.equal(dx.n, 8);
    // فجوة الاستيقاظ يجب أن تكون موجبة وقريبة من 131 دقيقة (2س11د)
    assert.ok(dx.wakeGap > 100 && dx.wakeGap < 160, `wakeGap=${dx.wakeGap}`);
    assert.ok(dx.r > 0.5, `الارتباط بين الشعور ومدة النوم يجب أن يكون قوياً وموجباً، حصلنا على r=${dx.r}`);
    assert.ok(dx.conf > 0 && dx.conf <= 0.8, "الثقة يجب أن تبقى ضمن سقف منطقي");
  });

  test("عيّنة أقل من 14 ليلة تخفّض الثقة عمداً (عقوبة العيّنة الصغيرة)", () => {
    const { SleepAnalysis } = buildAnalysis({ storeData: { sleepLogs: FAHD_SLEEP_LOGS, wakeTime: "06:00" } });
    const dx = SleepAnalysis.diagnose(SleepAnalysis.clean());
    assert.ok(dx.n < 14);
    // القيمة قبل العقوبة تُضرب في 0.8 — نتحقق أن نتيجة نهائية معقولة وليست القصوى النظرية
    assert.ok(dx.conf < 0.8);
  });

  test("نوم منتظم وكافٍ لا يُشخَّص كتأخر طور ولا كحرمان", () => {
    const regular = {};
    const dates = ["2026-07-01","2026-07-02","2026-07-03","2026-07-04","2026-07-05"];
    dates.forEach((d) => { regular[d] = { bed: "22:30", wake: "06:30", feel: 4 }; });
    const { SleepAnalysis } = buildAnalysis({ storeData: { sleepLogs: regular, wakeTime: "06:30" } });
    const dx = SleepAnalysis.diagnose(SleepAnalysis.clean());
    assert.notEqual(dx.key, "delay");
    assert.notEqual(dx.key, "deprived");
  });

  test("نوم قصير باستمرار (<6 ساعات) يُشخَّص كحرمان مزمن", () => {
    const short = {};
    ["2026-07-01","2026-07-02","2026-07-03","2026-07-04"].forEach((d) => {
      short[d] = { bed: "01:00", wake: "05:30", feel: 2 };
    });
    const { SleepAnalysis } = buildAnalysis({ storeData: { sleepLogs: short, wakeTime: "05:30" } });
    const dx = SleepAnalysis.diagnose(SleepAnalysis.clean());
    assert.equal(dx.key, "deprived");
  });
});

describe("SleepAnalysis.triage — الفرز والسلامة", () => {
  test("يرفع علامة عند تكرار المزاج المنخفض في ثلث الأيام فأكثر", () => {
    const { SleepAnalysis } = buildAnalysis({
      storeData: { moods: { d1: 1, d2: 2, d3: 4, d4: 4 }, sleepLogs: {} },
    });
    const flags = SleepAnalysis.triage([]);
    assert.ok(flags.length > 0);
  });

  test("لا يرفع أي علامة على بيانات فهد (وفق العتبات الحالية)", () => {
    const { SleepAnalysis } = buildAnalysis({
      storeData: {
        sleepLogs: FAHD_SLEEP_LOGS,
        moods: { "2026-06-26":4,"2026-06-27":1,"2026-06-28":3,"2026-06-29":4,"2026-06-30":4,"2026-07-01":4,"2026-07-02":3,"2026-07-03":3,"2026-07-05":2 },
      },
    });
    const nights = SleepAnalysis.clean();
    const flags = SleepAnalysis.triage(nights);
    // structuredClone: كائنات vm تنتمي لعالم (realm) منفصل، فمقارنتها المباشرة
    // بمصفوفة حرفية من هذا الملف تفشل في deepEqual رغم تطابق المحتوى فعلياً
    assert.deepEqual(structuredClone(flags), []);
  });
});

describe("SleepAnalysis.coach — التوصية الأسبوعية", () => {
  test("بلا تشخيص، يطلب مزيداً من البيانات فقط", () => {
    const { SleepAnalysis } = buildAnalysis({ storeData: {} });
    const tip = SleepAnalysis.coach(null);
    assert.match(tip.t, /٣ ليالٍ/);
  });

  test("عند تأخر الطور، ينصح بتثبيت الاستيقاظ لا تقديم النوم", () => {
    const { SleepAnalysis } = buildAnalysis({ storeData: { sleepLogs: FAHD_SLEEP_LOGS, wakeTime: "06:00" } });
    const dx = SleepAnalysis.diagnose(SleepAnalysis.clean());
    const tip = SleepAnalysis.coach(dx);
    assert.match(tip.t, /ثبّت الاستيقاظ/);
  });
});

describe("SleepAnalysis._enhanceWithAI — سياسة تقليل التكلفة (3 أيام + تغيّر تشخيص، أو 7 أيام إجباري)", () => {
  function makeMockAdvisor({ configured = true, response = { t: "نصيحة", why: "سبب" } } = {}) {
    const calls = [];
    return {
      isConfigured: () => configured,
      generateAdvice: async (dx, lang) => { calls.push({ dx, lang }); return response; },
      _calls: calls,
    };
  }
  // يحاكي مرور الوقت: يُعدِّل طابع وقت آخر سجل في aiHistory (بدل مفتاح aiLastCallTs
  // القديم) — هذا هو مصدر الحقيقة الوحيد الذي تقرأ منه _enhanceWithAI الآن
  function ageLastHistoryEntry(store, daysAgo) {
    const history = store.get("aiHistory", []);
    history[history.length - 1].ts = Date.now() - daysAgo * DAY;
    store.set("aiHistory", history);
  }
  const dxDelay = { key: "delay", hyp: "تأخر طور النوم", conf: 0.6, avgDur: 420, wakeGap: 90, r: 0.5, n: 10 };
  const dxUnstable = { ...dxDelay, key: "unstable", hyp: "إيقاع غير مستقر" };
  const DAY = 86400000;

  test("أول استدعاء على الإطلاق يحدث فوراً (لا سجل سابق)", async () => {
    const advisor = makeMockAdvisor();
    const { SleepAnalysis } = buildAnalysis({ aiAdvisor: advisor });
    await SleepAnalysis._enhanceWithAI(dxDelay);
    assert.equal(advisor._calls.length, 1);
  });

  test("أول استدعاء ناجح يُضاف كسجل جديد في aiHistory بكل الحقول الصحيحة", async () => {
    const advisor = makeMockAdvisor();
    const { SleepAnalysis, store } = buildAnalysis({ aiAdvisor: advisor, storeData: { aiProvider: "gemini" } });
    await SleepAnalysis._enhanceWithAI(dxDelay);
    const history = store.get("aiHistory");
    assert.equal(history.length, 1);
    assert.equal(history[0].t, "نصيحة");
    assert.equal(history[0].provider, "gemini");
    assert.equal(history[0].dxKey, "delay");
    assert.ok(history[0].ts > 0);
  });

  test("استدعاء ثانٍ بعد يوم واحد فقط بلا تغيّر تشخيص: لا يُطلَق (لم يحن الوقت)", async () => {
    const advisor = makeMockAdvisor();
    const { SleepAnalysis, store } = buildAnalysis({ aiAdvisor: advisor });
    await SleepAnalysis._enhanceWithAI(dxDelay); // أول استدعاء
    ageLastHistoryEntry(store, 1); // نحاكي مرور يوم واحد فقط
    await SleepAnalysis._enhanceWithAI(dxDelay); // نفس التشخيص
    assert.equal(advisor._calls.length, 1, "يجب ألا يُطلَق استدعاء ثانٍ قبل 3 أيام حتى بلا تغيّر");
    assert.equal(store.get("aiHistory").length, 1, "لا سجل جديد يُضاف بلا استدعاء فعلي");
  });

  test("تغيّر التشخيص بعد يومين فقط: لا يُطلَق (أقل من 3 أيام حتى مع التغيّر)", async () => {
    const advisor = makeMockAdvisor();
    const { SleepAnalysis, store } = buildAnalysis({ aiAdvisor: advisor });
    await SleepAnalysis._enhanceWithAI(dxDelay);
    ageLastHistoryEntry(store, 2);
    await SleepAnalysis._enhanceWithAI(dxUnstable); // تشخيص مختلف لكن بعد يومين فقط
    assert.equal(advisor._calls.length, 1, "تغيّر التشخيص وحده لا يكفي قبل مرور 3 أيام على الأقل");
  });

  test("تغيّر التشخيص بعد 3 أيام كاملة: يُطلَق استدعاء جديد ويُضاف سجل ثانٍ", async () => {
    const advisor = makeMockAdvisor();
    const { SleepAnalysis, store } = buildAnalysis({ aiAdvisor: advisor });
    await SleepAnalysis._enhanceWithAI(dxDelay);
    ageLastHistoryEntry(store, 3);
    await SleepAnalysis._enhanceWithAI(dxUnstable);
    assert.equal(advisor._calls.length, 2, "تغيّر جوهري بعد 3 أيام يجب أن يُطلق تحديثاً");
    assert.equal(store.get("aiHistory").length, 2, "يجب أن يتراكم سجل ثانٍ لا استبدال الأول");
  });

  test("لا تغيّر تشخيص وبعد 6 أيام فقط: لا يُطلَق (التحديث الإجباري عند 7 لا قبله)", async () => {
    const advisor = makeMockAdvisor();
    const { SleepAnalysis, store } = buildAnalysis({ aiAdvisor: advisor });
    await SleepAnalysis._enhanceWithAI(dxDelay);
    ageLastHistoryEntry(store, 6);
    await SleepAnalysis._enhanceWithAI(dxDelay); // نفس التشخيص تماماً
    assert.equal(advisor._calls.length, 1);
  });

  test("بعد 7 أيام كاملة بلا أي تغيّر تشخيص: تحديث إجباري يُطلَق رغم ذلك", async () => {
    const advisor = makeMockAdvisor();
    const { SleepAnalysis, store } = buildAnalysis({ aiAdvisor: advisor });
    await SleepAnalysis._enhanceWithAI(dxDelay);
    ageLastHistoryEntry(store, 7);
    await SleepAnalysis._enhanceWithAI(dxDelay); // نفس التشخيص، لكن أسبوع كامل مرّ
    assert.equal(advisor._calls.length, 2, "يجب تحديث إجباري كل أسبوع بصرف النظر عن ثبات التشخيص");
  });

  test("عند عدم استدعاء جديد، تُعرض النصيحة المخزَّنة من آخر سجل بدل الاختفاء", async () => {
    const advisor = makeMockAdvisor({ response: { t: "نصيحة مخزَّنة", why: "" } });
    const { SleepAnalysis, document, store } = buildAnalysis({ aiAdvisor: advisor });
    await SleepAnalysis._enhanceWithAI(dxDelay); // يُخزِّن النصيحة الأولى
    ageLastHistoryEntry(store, 1); // لم يحن وقت تحديث جديد
    await SleepAnalysis._enhanceWithAI(dxDelay);
    assert.equal(document.getElementById("ddaCoachT").textContent, "نصيحة مخزَّنة");
    assert.equal(document.getElementById("ddaCoachBadge").style.display, "inline");
  });

  test("سقف 104 سجلاً: تجاوزه يحذف الأقدم لا الأحدث", async () => {
    const advisor = makeMockAdvisor();
    const oldHistory = Array.from({ length: 104 }, (_, i) => ({ ts: i, t: "قديم"+i, why: "", provider: "openai", dxKey: "delay" }));
    const { SleepAnalysis, store } = buildAnalysis({ aiAdvisor: advisor, storeData: { aiHistory: oldHistory } });
    ageLastHistoryEntry(store, 7); // إجبار تحديث جديد
    await SleepAnalysis._enhanceWithAI(dxDelay);
    const history = store.get("aiHistory");
    assert.equal(history.length, 104, "يجب ألا يتجاوز السقف");
    assert.equal(history[history.length - 1].t, "نصيحة", "أحدث سجل يجب أن يكون الجديد");
    assert.equal(history[0].t, "قديم1", "أقدم سجل (index 0) يجب أن يُحذَف لا الأحدث");
  });

  test("بلا تشخيص (dx=null) أو aiAdvisor غير مُهيَّأ: لا يرمي خطأً ولا يستدعي شيئاً", async () => {
    const { SleepAnalysis } = buildAnalysis({}); // بلا aiAdvisor إطلاقاً
    await assert.doesNotReject(() => SleepAnalysis._enhanceWithAI(dxDelay));
    const advisor = makeMockAdvisor();
    const { SleepAnalysis: sa2 } = buildAnalysis({ aiAdvisor: advisor });
    await sa2._enhanceWithAI(null);
    assert.equal(advisor._calls.length, 0);
  });

  test("aiAdvisor.isConfigured()=false: لا يُطلَق أي استدعاء", async () => {
    const advisor = makeMockAdvisor({ configured: false });
    const { SleepAnalysis } = buildAnalysis({ aiAdvisor: advisor });
    await SleepAnalysis._enhanceWithAI(dxDelay);
    assert.equal(advisor._calls.length, 0);
  });
});

describe("SleepAnalysis.render — لا يرمي خطأً ولا يُنتج undefined/NaN", () => {
  ["ar", "en"].forEach((lang) => {
    test(`اللغة: ${lang}`, () => {
      const { SleepAnalysis, document } = buildAnalysis({
        lang, storeData: { sleepLogs: FAHD_SLEEP_LOGS, wakeTime: "06:00" },
      });
      document.getElementById("ddaBody"); // يضمن وجود العنصر مسبقاً
      assert.doesNotThrow(() => SleepAnalysis.render());
      const out = document.getElementById("ddaBody").innerHTML;
      assert.ok(out.length > 100);
      assert.ok(!out.includes("undefined"));
      assert.ok(!out.includes("NaN"));
    });
  });
});

describe("SleepAnalysis.render — وضوح محور الرسم البياني (بلاغ ميداني: 18:00 يظهر مرتين بلا تمييز)", () => {
  test("الطرف الأيمن للمحور (18:00 الثانية) يحمل تمييز 'يوم تالٍ' لا يحمله الطرف الأيسر", () => {
    const { SleepAnalysis, document } = buildAnalysis({
      storeData: { sleepLogs: FAHD_SLEEP_LOGS, wakeTime: "06:00" },
    });
    SleepAnalysis.render();
    const out = document.getElementById("ddaBody").innerHTML;
    // العنصر الأول (18:00 اليسرى) يجب أن يبقى نظيفاً بلا أي تمييز إضافي
    assert.match(out, /<span>18:00<\/span><span>00:00<\/span>/);
    // العنصر الأخير (18:00 اليمنى) يحمل شارة يوم تالٍ داخل i.dda-axis-next
    assert.match(out, /18:00<i class="dda-axis-next">[^<]+<\/i><\/span>/);
  });

  test("نص شارة اليوم التالي يتبدّل مع اللغة", () => {
    const { SleepAnalysis: ar, document: docAr } = buildAnalysis({
      lang: "ar", storeData: { sleepLogs: FAHD_SLEEP_LOGS, wakeTime: "06:00" },
    });
    ar.render();
    assert.match(docAr.getElementById("ddaBody").innerHTML, /dda-axis-next">\+١ يوم</);

    const { SleepAnalysis: en, document: docEn } = buildAnalysis({
      lang: "en", storeData: { sleepLogs: FAHD_SLEEP_LOGS, wakeTime: "06:00" },
    });
    en.render();
    assert.match(docEn.getElementById("ddaBody").innerHTML, /dda-axis-next">\+1 day</);
  });
});
