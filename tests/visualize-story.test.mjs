// اختبارات إضافة "قصة مهدئة" (قارب النهر الهادئ) كخيار رابع في تصوّر موجّه —
// طلب مستخدم مباشر بعد مجلس ناقش الفرق بين تصوّر حسّي وسرد قصصي فعلي.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext, mockDocument } from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(html, "const visualize = {", "\nconst recommend = {")
  .replace("const visualize", "var visualize");

function buildVisualize() {
  const document = mockDocument();
  let calmMinutes = 0;
  const context = {
    console, document,
    Store: { get: (k, d) => (k === "calmMinutes" ? calmMinutes : d), set: (k, v) => { if (k === "calmMinutes") calmMinutes = v; } },
    voiceGuide: { cue: () => {}, stop: () => {} },
    app: { touchJourneyDay() {} },
    toast: () => {},
    t: (k) => "TXT:" + k,
    setTimeout: () => 0, clearTimeout: () => {},
    Math, Date, JSON, Object,
  };
  runInContext(moduleSource, context, "visualize.js");
  return { visualize: context.visualize, document };
}

describe("visualize — القصة المهدئة الرابعة (viz4) مُدرَجة بجانب الثلاث الحالية لا بديلاً عنها", () => {
  test("viz4 موجودة في scripts بخمسة مقاطع، والثلاث الأصلية سليمة كما هي (لم تُمَس)", () => {
    const { visualize } = buildVisualize();
    // مقارنة نصية بدل deepEqual — مصفوفات عابرة لحدود vm قد تفشل deepEqual رغم
    // تطابق المحتوى فعلياً (Array.prototype مختلف بين الواقعتين host/vm)
    assert.equal(JSON.stringify(visualize.scripts.viz1), JSON.stringify(["viz1_1", "viz1_2", "viz1_3", "viz1_4"]));
    assert.equal(JSON.stringify(visualize.scripts.viz2), JSON.stringify(["viz2_1", "viz2_2", "viz2_3", "viz2_4"]));
    assert.equal(JSON.stringify(visualize.scripts.viz3), JSON.stringify(["viz3_1", "viz3_2", "viz3_3", "viz3_4"]));
    assert.equal(JSON.stringify(visualize.scripts.viz4), JSON.stringify(["viz4_1", "viz4_2", "viz4_3", "viz4_4", "viz4_5"]));
  });

  test("viz4 لها مدة مقطع خاصة بها (55 ثانية) لا تتشارك قيمة الآخرين", () => {
    const { visualize } = buildVisualize();
    assert.equal(visualize.perLine.viz4, 55);
  });

  test("open('viz4') يعمل بلا استثناء ويعرض أول مقطع من القصة", () => {
    const { visualize, document } = buildVisualize();
    document.getElementById("vizText"); document.getElementById("vizProgressBar");
    assert.doesNotThrow(() => visualize.open("viz4"));
    assert.equal(document.getElementById("vizText").textContent, "TXT:viz4_1");
  });

  test("step() يتقدّم عبر المقاطع الخمسة كاملة بلا خطأ حتى finish()", () => {
    const { visualize, document } = buildVisualize();
    visualize.current = "viz4"; visualize.idx = 0;
    document.getElementById("vizText"); document.getElementById("vizProgressBar");
    for (let i = 0; i < 5; i++) {
      assert.doesNotThrow(() => visualize.step());
      if (i < 4) visualize.idx++;
    }
    // شريط التقدّم عند آخر مقطع يجب أن يصل 100%
    assert.equal(document.getElementById("vizProgressBar").style.width, "100%");
  });
});

describe("نصوص القصة (viz4) — لا مصطلحات توتر/تشويق تتعارض مع هدف الاسترخاء", () => {
  test("النصوص العربية موجودة وغير فارغة لكل المقاطع الخمسة", () => {
    ["viz4_1", "viz4_2", "viz4_3", "viz4_4", "viz4_5"].forEach((key) => {
      const m = html.match(new RegExp(`${key}:"([^"]+)"`));
      assert.ok(m, `${key} غير موجود بالعربية`);
      assert.ok(m[1].length > 20, `${key} قصير جداً`);
    });
  });

  test("عنوان البطاقة الرابعة (viz4_title) يوضّح أنها قصة تحديداً لا مجرد تصوّر آخر", () => {
    assert.match(html, /viz4_title:"[^"]*قصة/);
    assert.match(html, /viz4_title:"[^"]*story/i);
  });

  test("المقطع الأخير (viz4_5) ينتهي بإشارة نوم صريحة — يجب أن يقود لنوم لا حبكة مفتوحة", () => {
    const m = html.match(/viz4_5:"([^"]+)"/);
    assert.ok(m);
    assert.match(m[1], /نوم/, "يجب أن ينتهي بذكر النوم صراحة");
  });
});
