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

function buildAnalysis({ lang = "ar", storeData = {} } = {}) {
  const document = mockDocument();
  const store = mockStore(storeData);
  const context = {
    console,
    document,
    Store: store,
    LANG: lang,
    Math, Date, JSON, Object,
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
