// اختبار weeklyReport.generate — التحليل المحلي (السلمّ/البوصلة/المرساة) يجب أن
// يظهر دائماً في صورة التقرير المُصدَّرة، بصرف النظر عن تفعيل الذكاء الاصطناعي
// من عدمه. كان الكود سابقاً يعتمد فقط على aiHistory (فارغة لغالبية المستخدمين).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext, mockStore } from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(html, "const weeklyReport = {", "\nfunction roundRect")
  .replace("const weeklyReport", "var weeklyReport");

// كانفس وهمي بأدنى واجهة تكفي generate() فعلياً بلا رسم حقيقي
function makeFakeCanvas() {
  const calls = { fillText: [] };
  const ctx = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, beginPath() {}, arc() {}, fill() {}, moveTo() {}, arcTo() {}, closePath() {},
    measureText: (s) => ({ width: String(s).length * 6 }),
    fillText(text, x, y) { calls.fillText.push(String(text)); },
    set fillStyle(v) {}, get fillStyle() { return ""; },
    set font(v) {}, get font() { return ""; },
    set textAlign(v) {}, get textAlign() { return ""; },
    set globalAlpha(v) {}, get globalAlpha() { return 1; },
  };
  return { canvas: { width: 360, height: 640, getContext: () => ctx }, calls };
}

function buildReport(storeData, sleepAnalysisOverrides) {
  const { canvas, calls } = makeFakeCanvas();
  const document = { getElementById: (id) => (id === "wrCanvas" ? canvas : { classList: { add(){}, remove(){} } }) };
  const store = mockStore(storeData || {});
  const diagnoseCalls = [];
  const coachCalls = [];
  const SleepAnalysis = Object.assign({
    clean() { return []; },
    diagnose(nights) { diagnoseCalls.push(nights); return null; },
    coach(dx) { coachCalls.push(dx); return { t: "نصيحة محلية دائمة", why: "سبب محلي" }; },
  }, sleepAnalysisOverrides || {});
  const context = {
    console, document, Store: store, LANG: "ar", SleepAnalysis,
    wrapCanvasText: (ctx, text, maxWidth) => [String(text)],
    roundRect: () => {}, // الدالة الحقيقية خارج نطاق الاستخراج، ولا نحتاج رسمها فعلياً هنا
    Math, Date, JSON, Object, String,
  };
  runInContext(moduleSource, context, "weekly-report.js");
  return { weeklyReport: context.weeklyReport, calls, diagnoseCalls, coachCalls };
}

describe("weeklyReport.generate — التحليل المحلي يظهر دائماً", () => {
  test("بلا aiHistory إطلاقاً: يُستدعى SleepAnalysis.diagnose/coach وتظهر نصيحته في الصورة", () => {
    const { weeklyReport, calls, diagnoseCalls, coachCalls } = buildReport({ aiHistory: [] });
    assert.doesNotThrow(() => weeklyReport.generate());
    assert.equal(diagnoseCalls.length, 1, "يجب استدعاء التحليل المحلي دائماً");
    assert.equal(coachCalls.length, 1);
    assert.ok(calls.fillText.includes("نصيحة محلية دائمة"), "يجب رسم النصيحة المحلية في الصورة");
  });

  test("aiHistory فارغة (لم تُنشأ إطلاقاً في Store): لا يرمي خطأً ويعرض التحليل المحلي كذلك", () => {
    const { weeklyReport, calls } = buildReport({}); // لا مفتاح aiHistory إطلاقاً
    assert.doesNotThrow(() => weeklyReport.generate());
    assert.ok(calls.fillText.includes("نصيحة محلية دائمة"));
  });

  test("مع وجود سجل ذكاء اصطناعي فعلي: يُفضَّل نص الذكاء الاصطناعي على المحلي، لكن التحليل المحلي يُستدعى دوماً أيضاً", () => {
    const { weeklyReport, calls, diagnoseCalls } = buildReport({
      aiHistory: [{ ts: Date.now(), t: "نصيحة بالذكاء الاصطناعي", why: "", provider: "openai", dxKey: "delay" }],
    });
    weeklyReport.generate();
    assert.equal(diagnoseCalls.length, 1, "التحليل المحلي يُحسَب دائماً حتى لو فُضِّل عرض AI بدلاً منه");
    assert.ok(calls.fillText.includes("نصيحة بالذكاء الاصطناعي"));
    assert.equal(calls.fillText.includes("نصيحة محلية دائمة"), false, "لا يُعرَض الاثنان معاً — الأحدث تفضيلاً فقط");
  });

  test("لا تشخيص كافٍ (بيانات جديدة): coach يُستدعى بـdx=null ولا يزال يُعيد نصاً قابلاً للعرض", () => {
    const { weeklyReport, calls, coachCalls } = buildReport({ aiHistory: [] }, {
      diagnose() { return null; },
      coach(dx) { assert.equal(dx, null); return { t: "سجّل 3 ليالٍ لتبدأ", why: "" }; },
    });
    weeklyReport.generate();
    assert.ok(calls.fillText.includes("سجّل 3 ليالٍ لتبدأ"));
  });
});
