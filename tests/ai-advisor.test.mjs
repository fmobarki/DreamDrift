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
    // testConnection يستخدم t() لتوليد تلميحات الأخطاء العملية (404/429/401)
    t: (k) => k,
    JSON, Math, Object, String,
  };
  runInContext(moduleSource, context, "ai-advisor.js");
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
    const { aiAdvisor } = buildAdvisor({
      moods: { "2026-07-20": 4, "2026-07-19": 3 },
      breatheSessions: [{ ts: new Date().toISOString(), type: "breath" }],
      journeyDays: ["2026-07-19", "2026-07-20"],
    });
    const dx = { hyp: "تأخر طور النوم", conf: 0.55, avgDur: 453, wakeGap: 131, r: 0.81, n: 8, key: "delay" };
    const summary = aiAdvisor.buildSummary(dx);
    const json = JSON.stringify(summary);
    assert.equal(summary.confidencePct, 55);
    assert.equal(summary.avgSleepHours, 7.5);
    assert.equal(summary.wakeGapMinutes, 131);
    assert.equal(summary.nightsAnalyzed, 8);
    // كل قيمة رقم مُشتق مفرد — لا مصفوفات، لا كائنات متداخلة، لا تواريخ
    Object.entries(summary).forEach(([k,v])=>{
      assert.ok(["number","string"].includes(typeof v), `الحقل ${k} يجب أن يكون رقماً أو نصاً مفرداً`);
      assert.equal(Array.isArray(v), false, `الحقل ${k} يجب ألا يكون مصفوفة`);
    });
    assert.equal(json.includes("2026"), false, "لا يجب أن يحتوي أي تاريخ");
    assert.equal(json.includes("07-"), false, "لا يجب أن يحتوي أي جزء تاريخ");
  });

  test("الفئات الموسّعة (مزاج/تهدئة/سلسلة) تُحسَب كأرقام مفردة — نصيحة تستحق تكلفتها", () => {
    const now = Date.now();
    const iso = (daysAgo)=> new Date(now - daysAgo*86400000).toISOString();
    const { aiAdvisor } = buildAdvisor({
      moods: { [iso(1).slice(0,10)]: 4, [iso(2).slice(0,10)]: 2 },
      breatheSessions: [{ ts: iso(1) }, { ts: iso(3) }, { ts: iso(40) }],
      journeyDays: ["a","b","c"],
    });
    const dx = { hyp: "x", conf: 0.5, avgDur: 420, wakeGap: 30, r: 0.3, n: 5, key: "delay" };
    const s = aiAdvisor.buildSummary(dx);
    assert.equal(s.avgMoodThisWeek, 3, "متوسط (4+2)/2");
    assert.equal(s.calmSessionsThisWeek, 2, "الجلسة الأقدم من 7 أيام تُستبعَد");
    assert.equal(s.currentStreakDays, 3);
  });

  test("بلا بيانات مزاج: يُحذَف الحقل بدل إرسال قيمة مضلِّلة", () => {
    const { aiAdvisor } = buildAdvisor({ moods: {}, breatheSessions: [], journeyDays: [] });
    const s = aiAdvisor.buildSummary({ hyp:"x", conf:0.5, avgDur:420, wakeGap:30, r:0.3, n:5, key:"delay" });
    assert.equal("avgMoodThisWeek" in s, false);
    assert.equal(s.calmSessionsThisWeek, 0);
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

  test("Gemini: اسم النموذج يُرمَّز (encodeURIComponent) مثل المفتاح تماماً — رمز خاص في حقل التجاوز لا يُفسد الرابط", () => {
    const { aiAdvisor } = buildAdvisor({});
    const req = aiAdvisor.PROVIDERS.gemini.buildRequest("k", "s", "u", "model/with#special?chars");
    assert.match(req.url, /model%2Fwith%23special%3Fchars/);
    assert.equal(req.url.includes("model/with#special?chars"), false, "يجب ألا يظهر غير مرمَّز حرفياً في الرابط");
  });

  test("Gemini: يستخدم الاسم المستعار -latest لا رقم إصدار مثبَّت (2.0 و2.5 أُوقفا فعلياً)", () => {
    // اختبار حماية ضد الانحدار: تثبيت رقم إصدار بعينه يُعطّل الميزة بالكامل بصمت
    // فور إيقافه من المزوّد — حدث هذا مرتين متتاليتين مع جوجل خلال أيام معدودة.
    const { aiAdvisor } = buildAdvisor({});
    const req = aiAdvisor.PROVIDERS.gemini.buildRequest("k", "s", "u");
    assert.match(req.url, /gemini-flash-latest/);
    assert.equal(req.url.includes("gemini-2.0-flash"), false);
    assert.equal(req.url.includes("gemini-2.5-flash"), false);
  });

  test("تجاوز النموذج يدوياً: المعامل الرابع يتقدّم على الافتراضي لكل المزوّدين", () => {
    const { aiAdvisor } = buildAdvisor({});
    assert.match(aiAdvisor.PROVIDERS.gemini.buildRequest("k","s","u","custom-model").url, /custom-model/);
    assert.equal(JSON.parse(aiAdvisor.PROVIDERS.openai.buildRequest("k","s","u","custom-model").body).model, "custom-model");
    assert.equal(JSON.parse(aiAdvisor.PROVIDERS.anthropic.buildRequest("k","s","u","custom-model").body).model, "custom-model");
  });

  test("بلا تجاوز: يعود لنموذج المزوّد الافتراضي", () => {
    const { aiAdvisor } = buildAdvisor({});
    assert.equal(JSON.parse(aiAdvisor.PROVIDERS.openai.buildRequest("k","s","u").body).model, aiAdvisor.PROVIDERS.openai.model);
    assert.equal(JSON.parse(aiAdvisor.PROVIDERS.openai.buildRequest("k","s","u","").body).model, aiAdvisor.PROVIDERS.openai.model);
  });

  test("activeModel: يُعيد التجاوز المحفوظ إن وُجد، وإلا افتراضي المزوّد الحالي", () => {
    const withOverride = buildAdvisor({ aiProvider:"gemini", aiModelOverride:"my-model" });
    assert.equal(withOverride.aiAdvisor.activeModel(), "my-model");
    const noOverride = buildAdvisor({ aiProvider:"gemini", aiModelOverride:"" });
    assert.equal(noOverride.aiAdvisor.activeModel(), "gemini-flash-latest");
    // مسافات بيضاء فقط تُعامَل كلا تجاوز
    const blank = buildAdvisor({ aiProvider:"openai", aiModelOverride:"   " });
    assert.equal(blank.aiAdvisor.activeModel(), blank.aiAdvisor.PROVIDERS.openai.model);
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

describe("recordAIUsage — عدّاد استخدام محلي شفاف (بديل صادق عن رصيد الدولار غير القابل للتنفيذ)", () => {
  function buildRecorder(storeData) {
    const store = mockStore(storeData);
    const context = {
      console, Store: store,
      aiSettings: { refreshUsage(){} },
      Math, Date, JSON, Object,
    };
    const src = html.slice(html.indexOf("// عدّاد استخدام محلي بحت"), html.indexOf("const aiAdvisor = {"));
    runInContext(src, context, "record-ai-usage.js");
    return { recordAIUsage: context.recordAIUsage, store };
  }

  test("أول استدعاء يبدأ عدّاداً بقيمة 1 ويُسجّل بداية أسبوع جديد", () => {
    const { recordAIUsage, store } = buildRecorder({});
    recordAIUsage();
    assert.equal(store.get("aiUsageWeekCount"), 1);
    assert.ok(store.get("aiUsageWeekStart") > 0);
  });

  test("استدعاءات متتالية خلال نفس الأسبوع تتراكم", () => {
    const { recordAIUsage, store } = buildRecorder({});
    recordAIUsage(); recordAIUsage(); recordAIUsage();
    assert.equal(store.get("aiUsageWeekCount"), 3);
  });

  test("بعد مرور 7 أيام، يُعاد ضبط العدّاد إلى 1 لا الاستمرار من حيث توقّف", () => {
    const DAY = 86400000;
    const { recordAIUsage, store } = buildRecorder({
      aiUsageWeekStart: Date.now() - 8 * DAY,
      aiUsageWeekCount: 5,
    });
    recordAIUsage();
    assert.equal(store.get("aiUsageWeekCount"), 1, "يجب إعادة الضبط لا التراكم فوق أسبوع سابق");
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

  test("tip بنوع غير نصي (كائن) → null بصمت لا عرض '[object Object]'", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"tip":{"a":1},"why":"سبب"}' } }] }) })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res, null, "tip كائن يجب أن يُرفَض لا أن يُعرَض مشوَّهاً");
  });

  test("tip بنوع رقمي → null بصمت", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"tip":42}' } }] }) })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res, null);
  });

  test("tip نص فارغ أو بياض فقط → null بصمت", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"tip":"   "}' } }] }) })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res, null);
  });

  test("why بنوع غير نصي (رقم) → null بصمت", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"tip":"نصيحة","why":123}' } }] }) })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res, null, "why رقمياً يجب أن يُرفَض الرد كاملاً لا تجاهل الحقل بصمت");
  });

  test("why غائب تماماً (undefined) لا يزال مقبولاً — الحقل اختياري", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"tip":"نصيحة"}' } }] }) })
    );
    const res = await aiAdvisor.generateAdvice(dx, "ar");
    assert.equal(res.t, "نصيحة");
    assert.equal(res.why, "");
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

describe("aiAdvisor.testConnection — تشخيص حقيقي بتفاصيل الخطأ (لا 'فشل الاتصال' عامة)", () => {
  test("غير مُهيَّأ: رسالة واضحة بلا استدعاء fetch", async () => {
    let called = false;
    const { aiAdvisor } = buildAdvisor({ aiEnabled: false }, async () => { called = true; });
    const res = await aiAdvisor.testConnection("ar");
    assert.equal(res.ok, false);
    assert.ok(res.message);
    assert.equal(called, false);
  });

  test("نجاح: ok=true بلا رسالة خطأ", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"tip":"a","why":"b"}' } }] }) })
    );
    const res = await aiAdvisor.testConnection("ar");
    assert.equal(res.ok, true);
  });

  test("فشل HTTP: يُعيد رمز الحالة ونص الرد الفعلي — هذا بالضبط ما كان سيكشف توقّف gemini-2.0-flash فوراً", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "gemini", aiApiKey: "AIza-test" },
      async () => ({ ok: false, status: 404, text: async () => '{"error":{"message":"model not found"}}' })
    );
    const res = await aiAdvisor.testConnection("ar");
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.match(res.message, /model not found/);
  });

  test("انقطاع شبكة: يُعيد رسالة الخطأ الفعلية بدل نص عام", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => { throw new Error("Failed to fetch"); }
    );
    const res = await aiAdvisor.testConnection("ar");
    assert.equal(res.ok, false);
    assert.match(res.message, /Failed to fetch/);
  });

  test("رد بصيغة غير متوقَّعة: رسالة تشرح احتمال تغيّر الصيغة لا فشلاً غامضاً", async () => {
    const { aiAdvisor } = buildAdvisor(
      { aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-test" },
      async () => ({ ok: true, json: async () => ({}) })
    );
    const res = await aiAdvisor.testConnection("ar");
    assert.equal(res.ok, false);
    assert.ok(res.message);
  });
});
