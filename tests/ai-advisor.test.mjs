// اختبارات aiAdvisor — طبقة الصياغة الاختيارية (BYOK) فوق التحليل المحلي.
// التركيز الأهم هنا: (1) الملخص المُرسَل لا يحتوي بيانات خام إطلاقاً،
// (2) كل مزوّد يبني طلبه الصحيح (رأس/جسم مختلفين)، (3) أي فشل يُعيد null
// بصمت فلا ينكسر التطبيق ولا يظهر خطأ للمستخدم.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext, mockStore } from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(html, "const aiAdvisor = {", "\n// يسأل sw.js")
  .replace("const aiAdvisor = {", "var aiAdvisor = {");

function buildAdvisor(storeData, fetchImpl) {
  const store = mockStore(storeData);
  const context = {
    console, Store: store,
    fetch: fetchImpl || (async () => { throw new Error("لم يُستدعَ fetch في هذا الاختبار"); }),
    AbortController: global.AbortController,
    setTimeout, clearTimeout,
    JSON, Math, Object, String,
  };
  runInContext(context.fetch ? moduleSource : moduleSource, context, "ai-advisor.js");
  return { aiAdvisor: context.aiAdvisor, store };
}

describe("aiAdvisor.isConfigured — بوابة التفعيل", () => {
  test("false إن لم يُفعَّل التبديل حتى لو وُجد مفتاح", () => {
    const { aiAdvisor } = buildAdvisor({ aiEnabled: false, aiProvider: "openai", aiApiKey: "sk-test" });
    assert.equal(aiAdvisor.isConfigured(), false);
  });
  test("false إن لم يوجد مفتاح حتى لو فُعِّل التبديل", () => {
    const { aiAdvisor } = buildAdvisor({ aiEnabled: true, aiProvider: "openai", aiApiKey: "" });
    assert.equal(aiAdvisor.isConfigured(), false);
  });
  test("true فقط عند اكتمال الثلاثة: التفعيل + المزوّد + المفتاح", () => {
    const { aiAdvisor } = buildAdvisor({ aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" });
    assert.equal(aiAdvisor.isConfigured(), true);
  });
});

describe("aiAdvisor.buildSummary — لا بيانات خام إطلاقاً", () => {
  test("يحتوي أرقاماً محسوبة فقط، ولا تواريخ ولا سجلات نوم", () => {
    const { aiAdvisor } = buildAdvisor({});
    const dx = { hyp: "تأخر طور النوم", conf: 0.55, avgDur: 453, wakeGap: 131, r: 0.81, n: 8, key: "delay" };
    const summary = aiAdvisor.buildSummary(dx);
    const json = JSON.stringify(summary);
    assert.equal(summary.confidencePct, 55);
    assert.equal(summary.avgSleepHours, 7.5);
    assert.equal(summary.wakeGapMinutes, 131);
    assert.equal(summary.nightsAnalyzed, 8);
    // لا حقول تحمل تواريخ أو سجلات — فقط الحقول الرقمية المُعرَّفة صراحة
    assert.deepEqual(Object.keys(summary).sort(), [
      "avgSleepHours","confidencePct","hypothesis","moodDurationCorrelation","nightsAnalyzed","wakeGapMinutes",
    ]);
    assert.equal(json.includes("2026"), false, "لا يجب أن يحتوي أي تاريخ");
  });

  test("يعيد null بلا تشخيص", () => {
    const { aiAdvisor } = buildAdvisor({});
    assert.equal(aiAdvisor.buildSummary(null), null);
  });
});

describe("aiAdvisor.PROVIDERS — بناء الطلبات لكل مزوّد", () => {
  test("OpenAI: رأس Authorization Bearer، ونموذج gpt-4o-mini", () => {
    const { aiAdvisor } = buildAdvisor({});
    const req = aiAdvisor.PROVIDERS.openai.buildRequest("sk-abc", "sys", "user");
    assert.equal(req.headers["Authorization"], "Bearer sk-abc");
    assert.match(req.url, /api\.openai\.com/);
    const body = JSON.parse(req.body);
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal(body.messages[0].role, "system");
  });

  test("Gemini: المفتاح في رابط الاستعلام لا في الرأس", () => {
    const { aiAdvisor } = buildAdvisor({});
    const req = aiAdvisor.PROVIDERS.gemini.buildRequest("AIzaTest", "sys", "user");
    assert.match(req.url, /key=AIzaTest/);
    assert.match(req.url, /generativelanguage\.googleapis\.com/);
    const body = JSON.parse(req.body);
    assert.equal(body.systemInstruction.parts[0].text, "sys");
  });

  test("Anthropic: رأس x-api-key وanthropic-dangerous-direct-browser-access", () => {
    const { aiAdvisor } = buildAdvisor({});
    const req = aiAdvisor.PROVIDERS.anthropic.buildRequest("sk-ant", "sys", "user");
    assert.equal(req.headers["x-api-key"], "sk-ant");
    assert.equal(req.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.match(req.url, /api\.anthropic\.com/);
    const body = JSON.parse(req.body);
    assert.equal(body.system, "sys");
  });

  test("parse() يستخرج النص الصحيح من صيغة رد كل مزوّد", () => {
    const { aiAdvisor } = buildAdvisor({});
    assert.equal(aiAdvisor.PROVIDERS.openai.parse({choices:[{message:{content:" hi "}}]}), "hi");
    assert.equal(aiAdvisor.PROVIDERS.gemini.parse({candidates:[{content:{parts:[{text:" hi "}]}}]}), "hi");
    assert.equal(aiAdvisor.PROVIDERS.anthropic.parse({content:[{text:" hi "}]}), "hi");
  });

  test("parse() يعيد null بأمان لو الرد بصيغة غير متوقَّعة", () => {
    const { aiAdvisor } = buildAdvisor({});
    assert.equal(aiAdvisor.PROVIDERS.openai.parse({}), null);
    assert.equal(aiAdvisor.PROVIDERS.gemini.parse({candidates:[]}), null);
    assert.equal(aiAdvisor.PROVIDERS.anthropic.parse(null), null);
  });
});

describe("aiAdvisor.generateAdvice — تكامل ونجاح/فشل", () => {
  const dx = { hyp: "تأخر طور النوم", conf: 0.55, avgDur: 453, wakeGap: 131, r: 0.81, n: 8, key: "delay" };

  test("غير مفعَّل → لا يستدعي fetch إطلاقاً ويعيد null", async () => {
    let called = false;
    const { aiAdvisor } = buildAdvisor({ aiEnabled: false }, async () => { called = true; });
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res, null);
    assert.equal(called, false);
  });

  test("نجاح: يُعيد {t, why} من رد JSON صالح", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"tip":"نم مبكراً","why":"لتحسين الإيقاع"}' } }] }) })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res.t, "نم مبكراً");
    assert.equal(res.why, "لتحسين الإيقاع");
  });

  test("رد يحتوي أسوار ```json``` يُنظَّف قبل التحليل", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"tip":"a","why":"b"}\n```' } }] }) })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res.t, "a");
  });

  test("استجابة HTTP غير ناجحة (401/429/500) → null بصمت", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "wrong-key" },
      async () => ({ ok: false, status: 401 })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res, null);
  });

  test("انقطاع الشبكة (fetch يرمي خطأً) → null بصمت", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => { throw new Error("network down"); }
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res, null);
  });

  test("رد بصيغة JSON فاسدة (ليست JSON صالحة) → null بصمت", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "ليس JSON إطلاقاً" } }] }) })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res, null);
  });

  test("رد بلا حقل tip → null بصمت", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"why":"بلا نصيحة"}' } }] }) })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res, null);
  });

  test("بلا تشخيص (dx=null) → null بلا استدعاء fetch", async () => {
    let called = false;
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => { called = true; }
    );
    const res = await aiAdvisor.generateAdvice(null, "ar");
    assert.equal(res, null);
    assert.equal(called, false);
  });
});
