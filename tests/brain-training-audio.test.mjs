// اختبارات إصلاحات "برمجة الدماغ": quickBreath (النافذة السريعة 4-7-8/مربّع)
// كانت بلا صوت وبلا رئتين، وvisualize (تصوّر موجّه) كان مبنياً عمداً بلا صوت.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext, mockDocument, mockStore } from "./helpers/extract.mjs";

const html = readIndexHtml();

function makeVoiceGuideSpy() {
  const cued = [];
  let stopped = false;
  return { spy: { cue: (t) => cued.push(t), stop: () => { stopped = true; } }, cued, wasStopped: () => stopped };
}

describe("quickBreath — الصوت والرئتان المُضافان", () => {
  const moduleSource = extractBetween(html, "const quickBreath = {", "\nconst visualize = {")
    .replace("const quickBreath", "var quickBreath");

  function build(storeData) {
    const document = mockDocument();
    const store = mockStore(storeData || {});
    const { spy, cued, wasStopped } = makeVoiceGuideSpy();
    const context = {
      console, document, Store: store,
      voiceGuide: spy, app: { touchJourneyDay(){} },
      t: (k) => k,
      setTimeout: () => 0, // لا تنفيذ تلقائي — نفحص الأثر الفوري لاستدعاء واحد فقط
      clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
      Math, Date, JSON, Object,
    };
    runInContext(moduleSource, context, "quick-breath.js");
    return { quickBreath: context.quickBreath, document, cued, wasStopped };
  }

  test("phase('in') يُنطَق صوتياً ويُضيف صنف 'in' على عنصر الرئتين qbLungs", () => {
    const { quickBreath, document, cued } = build();
    quickBreath.pattern = "478";
    document.getElementById("qbLungs"); // إنشاء العنصر في الوثيقة الوهمية
    quickBreath.phase("in");
    assert.ok(cued.includes("qb_in"), "يجب نطق طور الشهيق");
    assert.ok(document.getElementById("qbLungs").classList.contains("in"));
  });

  test("phase('out') يُزيل صنف 'in' وينطق طور الزفير", () => {
    const { quickBreath, document, cued } = build();
    quickBreath.pattern = "478";
    const lungs = document.getElementById("qbLungs");
    lungs.classList.add("in");
    quickBreath.phase("out");
    assert.ok(cued.includes("qb_out"));
    assert.equal(lungs.classList.contains("in"), false);
  });

  test("stop() يوقف الصوت المرشد (voiceGuide.stop) لا الصمت فقط", () => {
    const { quickBreath, wasStopped } = build();
    quickBreath.stop();
    assert.equal(wasStopped(), true);
  });

  test("open() يُصفِّر صنف 'in' على qbLungs لا على qbOrb القديم المحذوف", () => {
    const { quickBreath, document } = build();
    document.getElementById("qbLungs").classList.add("in");
    quickBreath.open("478");
    assert.equal(document.getElementById("qbLungs").classList.contains("in"), false);
  });
});

describe("visualize — الصوت المُضاف لكل سطر", () => {
  const moduleSource = extractBetween(html, "const visualize = {", "\nconst recommend = {")
    .replace("const visualize", "var visualize");

  function build() {
    const document = mockDocument();
    const store = mockStore({});
    const { spy, cued, wasStopped } = makeVoiceGuideSpy();
    const context = {
      console, document, Store: store,
      voiceGuide: spy, app: { touchJourneyDay(){} }, toast: () => {},
      t: (k) => "TXT:" + k,
      setTimeout: () => 0, clearTimeout: () => {},
      Math, Date, JSON, Object,
    };
    runInContext(moduleSource, context, "visualize.js");
    return { visualize: context.visualize, document, cued, wasStopped };
  }

  test("step() ينطق نص السطر الحالي بجانب عرضه نصياً", () => {
    const { visualize, document, cued } = build();
    visualize.current = "viz1"; visualize.idx = 0;
    document.getElementById("vizText"); document.getElementById("vizProgressBar");
    visualize.step();
    assert.equal(document.getElementById("vizText").textContent, "TXT:viz1_1");
    assert.ok(cued.includes("TXT:viz1_1"), "يجب نطق نفس النص المعروض حرفياً");
  });

  test("stop() يوقف الصوت المرشد", () => {
    const { visualize, wasStopped } = build();
    visualize.stop();
    assert.equal(wasStopped(), true);
  });
});

describe("سلامة بنيوية: رئتا quickBreath الجديدتان لا تُعيدان استخدام تدرّجات bLungs الأصلية", () => {
  test("SVG الجديد يشير لـqbLungGlowR/L حصرياً، لا lungGlowR/L الأصليين", () => {
    // لو أُعيد استخدام نفس معرّف التدرّج (lungGlowR) داخل SVG ثانٍ في نفس الصفحة،
    // فسيُحلّ url(#lungGlowR) لأول عنصر مطابق في المستند فقط — تلوين خاطئ صامت.
    const start = html.indexOf('id="qbLungs"');
    const end = html.indexOf('</svg>', start);
    const qbSvgBlock = html.slice(start, end);
    assert.match(qbSvgBlock, /url\(#qbLungGlowR\)/);
    assert.match(qbSvgBlock, /url\(#qbLungGlowL\)/);
    assert.equal(qbSvgBlock.includes("url(#lungGlowR)"), false);
    assert.equal(qbSvgBlock.includes("url(#lungGlowL)"), false);
  });

  test("qbLungGlowR وqbLungGlowL معرّفان مرة واحدة فقط في كامل الملف", () => {
    ["qbLungGlowR", "qbLungGlowL"].forEach((id) => {
      const count = [...html.matchAll(new RegExp(`id="${id}"`, "g"))].length;
      assert.equal(count, 1, `${id} يجب أن يُعرَّف مرة واحدة فقط`);
    });
  });
});
