// اختبارات rhythm/calcRhythm — تحديداً اختبار انحدار للعلّة المكتشفة ميدانياً:
// بطاقتا "نوم/استيقاظ" وشبكة الدورات وجدولة الإشعارات كانت تُحسَب من مصادر
// وقت استيقاظ مختلفة (الخام مقابل الفعّال)، فتتناقض نفس الشاشة مع نفسها
// كلما كان الإيقاع المتغيّر أو استثناء الغد فعّالاً.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext, mockStore } from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(html, "function calcRhythm", "\nconst app = {")
  .replace("const rhythm = {", "var rhythm = {");

function buildRhythm(storeData, fixedDate) {
  const store = mockStore(storeData);
  const context = {
    console, Store: store,
    document: { getElementById: () => null, querySelectorAll: () => [] },
    Math, JSON, Object, String, Number,
    Date: fixedDate ? makeFixedDate(fixedDate) : Date,
  };
  runInContext(moduleSource, context, "rhythm.js");
  return { calcRhythm: context.calcRhythm, rhythm: context.rhythm, store };
}

function makeFixedDate(fixedDate) {
  const RealDate = Date;
  function FixedDate(...args) {
    if (args.length === 0) return new RealDate(fixedDate.getTime());
    return new RealDate(...args);
  }
  FixedDate.now = () => fixedDate.getTime();
  return FixedDate;
}

describe("rhythm.effectiveWake — أولوية المصادر", () => {
  test("بلا استثناء وبلا إيقاع متغيّر: يعيد الوقت الأساسي المعتاد", () => {
    const { rhythm } = buildRhythm({ wakeTime: "06:00" });
    const eff = rhythm.effectiveWake();
    assert.equal(eff.time, "06:00");
    assert.equal(eff.source, "usual");
  });

  test("الإيقاع المتغيّر مفعّل: يعيد وقت العمل أو العطلة حسب يوم الغد", () => {
    // الثلاثاء 2026-07-21 (غد الاثنين 2026-07-20) — ليس ضمن عطلة [5,6] الافتراضية
    const fixedNow = new Date(2026, 6, 20, 14, 0);
    const { rhythm } = buildRhythm({
      wakeTime: "00:08", // القيمة الأساسية "الخام" التي أربكت الشاشة سابقاً
      variable: { on: true, work: "08:00", weekend: "10:00", weekendDays: [5, 6] },
    }, fixedNow);
    const eff = rhythm.effectiveWake();
    assert.equal(eff.time, "08:00", "غداً ثلاثاء = يوم عمل، يجب أن يُستخدَم وقت العمل");
    assert.equal(eff.source, "variable");
  });

  test("استثناء يدوي لليوم التالي له الأولوية القصوى حتى مع الإيقاع المتغيّر", () => {
    const fixedNow = new Date(2026, 6, 20, 14, 0);
    const tomorrow = "2026-07-21";
    const { rhythm } = buildRhythm({
      wakeTime: "06:00",
      variable: { on: true, work: "08:00", weekend: "10:00", weekendDays: [5, 6] },
      wakeException: { date: tomorrow, time: "05:00" },
    }, fixedNow);
    const eff = rhythm.effectiveWake();
    assert.equal(eff.time, "05:00");
    assert.equal(eff.source, "manual");
  });

  test("استثناء يدوي منتهي الصلاحية (تاريخه في الماضي): يُتجاهَل ويُمسَح", () => {
    const fixedNow = new Date(2026, 6, 20, 14, 0);
    const { rhythm, store } = buildRhythm({
      wakeTime: "06:00",
      wakeException: { date: "2026-07-01", time: "05:00" }, // منتهي
    }, fixedNow);
    const eff = rhythm.effectiveWake();
    assert.equal(eff.time, "06:00");
    assert.equal(eff.source, "usual");
    assert.equal(store.get("wakeException"), null, "يجب مسح الاستثناء المنتهي تلقائياً");
  });
});

describe("اختبار انحدار: كل مستهلكي وقت الاستيقاظ يتفقون على نفس القيمة الفعّالة", () => {
  test("calcRhythm(effectiveWake) يُنتج نفس أرقام شبكة الدورات المتوقَّعة عند تفعيل الإيقاع المتغيّر", () => {
    // يحاكي بالضبط حالة المستخدم الفعلية: wakeTime الخام = 00:08، لكن الإيقاع
    // المتغيّر مفعّل بوقت عمل 08:00 — الشاشة يجب أن تعرض 08:00 في كل مكان،
    // لا مزيجاً من القيمتين كما حدث فعلياً قبل هذا الإصلاح.
    const fixedNow = new Date(2026, 6, 20, 14, 0);
    const { calcRhythm, rhythm } = buildRhythm({
      wakeTime: "00:08",
      variable: { on: true, work: "08:00", weekend: "10:00", weekendDays: [5, 6] },
    }, fixedNow);

    const eff = rhythm.effectiveWake();
    const r = calcRhythm(eff.time);

    // بطاقة "نوم" (r.sleep) وشبكة الدورات (r.cycles) يجب أن تُحسَبا من نفس eff.time
    assert.equal(eff.time, "08:00");
    assert.equal(r.sleep, "00:15");
    const rec = r.cycles.find((c) => c.n === 5);
    assert.equal(rec.time, "00:15");

    // ولا يجب أن تُطابق أرقام الوقت الخام (00:08) التي كانت تظهر خطأً في الشبكة سابقاً
    const wrongR = calcRhythm("00:08");
    assert.notEqual(rec.time, wrongR.cycles.find((c) => c.n === 5).time);
  });
});
