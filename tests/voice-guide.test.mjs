// اختبارات voiceGuide — الصوت المرشد للاسترخاء وأطوار التنفّس.
// نغطّي هنا تحديداً السلوك الذي تغيّر خلال هذه الجلسة: بوابة الجودة لم تعد
// تُخفي الميزة عند غياب صوت عربي محلي (طالما speechSynthesis نفسه مدعوم).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  readIndexHtml, extractBetween, runInContext, mockDocument, mockStore,
} from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(html, "const voiceGuide", "\n/* ============================================================\n   Sound Mixer")
  .replace("const voiceGuide", "var voiceGuide");

function makeSpeechSynthesis(voices, { onSpeak } = {}) {
  const listeners = {};
  return {
    getVoices: () => voices,
    speak: (u) => onSpeak && onSpeak(u),
    cancel: () => {},
    addEventListener: (type, cb) => { (listeners[type] = listeners[type] || []).push(cb); },
    _listeners: listeners,
  };
}

function buildVoiceGuide({ lang = "ar", voices = [], storeData = {}, onSpeak } = {}) {
  const document = mockDocument();
  const store = mockStore(storeData);
  const speechSynthesis = makeSpeechSynthesis(voices, { onSpeak });
  const context = {
    console,
    document,
    Store: store,
    LANG: lang,
    window: { speechSynthesis },
    speechSynthesis,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    toast: () => {},
    t: (k) => k,
    mixer: { ctx: null, playing: false, levels: {}, applyLevels() {} },
    Math, Date, JSON, Object,
    // نتجاهل مقدار التأخير الحقيقي (فواصل صمت الاسترخاء تصل لثوانٍ عدة) ونُطلق
    // فوراً — يحافظ هذا على ترتيب التنفيذ غير المتزامن الصحيح دون إبطاء الاختبارات
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout, clearInterval, setInterval,
  };
  runInContext(moduleSource, context, "voice-guide.js");
  return { voiceGuide: context.voiceGuide, document, store };
}

describe("voiceGuide.detect — بوابة الجودة", () => {
  test("جهاز فيه صوت عربي محلي: supported و hasNativeVoice كلاهما true", () => {
    const { voiceGuide, document } = buildVoiceGuide({
      voices: [{ lang: "ar-SA", localService: true, name: "Maged" }],
    });
    voiceGuide.detect();
    assert.equal(voiceGuide.supported, true);
    assert.equal(voiceGuide.hasNativeVoice, true);
    assert.equal(document.getElementById("voiceRelaxCard").style.display, "block");
  });

  test("جهاز بلا صوت عربي لكن فيه speechSynthesis: الميزة تظهر (supported=true) بصوت افتراضي", () => {
    const { voiceGuide, document } = buildVoiceGuide({
      voices: [{ lang: "en-US", localService: true, name: "Samantha" }],
    });
    voiceGuide.detect();
    assert.equal(voiceGuide.supported, true, "يجب أن تعمل الميزة بالصوت الافتراضي بدل الاختفاء");
    assert.equal(voiceGuide.hasNativeVoice, false);
    assert.equal(voiceGuide.voice, null);
    assert.equal(document.getElementById("voiceRelaxCard").style.display, "block");
    assert.equal(document.getElementById("voiceQualityHint").style.display, "block", "يجب إظهار تلميح جودة النطق");
  });

  test("جهاز بلا speechSynthesis إطلاقاً: الميزة تختفي بهدوء", () => {
    const document = mockDocument();
    const store = mockStore({});
    const context = {
      console, document, Store: store, LANG: "ar", window: {},
      toast: () => {}, t: (k) => k, mixer: { levels: {}, applyLevels(){} },
      Math, Date, JSON, Object, setTimeout, clearTimeout,
    };
    runInContext(moduleSource, context, "voice-guide-no-speech.js");
    context.voiceGuide.detect();
    assert.equal(context.voiceGuide.supported, false);
    assert.equal(document.getElementById("voiceRelaxCard").style.display, "none");
  });

  test("أصوات تُحمَّل متأخرة (نمط أندرويد): voiceschanged يُصحّح الحالة لاحقاً", () => {
    const speechSynthesis = makeSpeechSynthesis([]); // لا أصوات في البداية
    const document = mockDocument();
    const store = mockStore({});
    const context = {
      console, document, Store: store, LANG: "ar",
      window: { speechSynthesis }, speechSynthesis,
      SpeechSynthesisUtterance: function (text) { this.text = text; },
      toast: () => {}, t: (k) => k, mixer: { levels: {}, applyLevels(){} },
      Math, Date, JSON, Object,
      // نُعطّل الاستطلاع الحقيقي (setInterval كل 400ms×10) عمداً — هذا الاختبار
      // يتحقق فقط من مسار حدث voiceschanged الفوري، لا شبكة الأمان الاحتياطية،
      // وتركه حقيقياً يُبقي مؤقّتاً معلّقاً في الخلفية يُبطئ حزمة الاختبارات.
      setInterval: () => 0, clearInterval: () => {}, setTimeout, clearTimeout,
    };
    runInContext(moduleSource, context, "voice-guide-late.js");
    context.voiceGuide.detect();
    // التصميم المتعمَّد: تظهر البطاقة بمجرد وجود speechSynthesis نفسه، حتى قبل
    // وصول أي صوت — لأن أغلب المتصفحات تنطق رغم ذلك بصوت افتراضي. لا صوت عربي
    // بعد يعني hasNativeVoice=false وتلميح الجودة ظاهر، لا اختفاء البطاقة.
    assert.equal(context.voiceGuide.supported, true);
    assert.equal(context.voiceGuide.hasNativeVoice, false);
    assert.equal(document.getElementById("voiceRelaxCard").style.display, "block");
    assert.equal(document.getElementById("voiceQualityHint").style.display, "block");

    // الآن "تصل" الأصوات فعلياً ويُطلَق حدث voiceschanged كما يفعل أندرويد
    speechSynthesis.getVoices = () => [{ lang: "ar-SA", localService: true, name: "Maged" }];
    const cbs = speechSynthesis._listeners["voiceschanged"] || [];
    assert.ok(cbs.length > 0, "يجب أن يكون detect() قد استمع للحدث");
    cbs.forEach((cb) => cb());

    assert.equal(context.voiceGuide.hasNativeVoice, true, "بعد وصول صوت عربي يجب أن يُستخدَم");
    assert.equal(document.getElementById("voiceQualityHint").style.display, "none", "التلميح يختفي بعد توفّر صوت عربي حقيقي");
  });
});

describe("voiceGuide._clean — معالجة النص للنطق", () => {
  test("يحوّل نقاط الحذف الطويلة إلى فاصلة (توقف مضمون بدل تجاهل المحرّك لها)", () => {
    const { voiceGuide } = buildVoiceGuide({ voices: [{ lang: "ar-SA", localService: true }] });
    const out = voiceGuide._clean("خذ نفساً عميقاً… ثم أخرجه");
    assert.equal(out.includes("…"), false);
    assert.match(out, /خذ نفساً عميقاً، ثم أخرجه/);
  });

  test("يضغط المسافات المتكررة", () => {
    const { voiceGuide } = buildVoiceGuide({ voices: [] });
    assert.equal(voiceGuide._clean("كلمة   كلمة\n\nكلمة"), "كلمة كلمة كلمة");
  });
});

describe("voiceGuide.script — نصوص الاسترخاء", () => {
  test("عدد جُمل الاسترخاء العربي 9 ولا نص فارغ بينها", () => {
    const { voiceGuide } = buildVoiceGuide({ voices: [], lang: "ar" });
    const lines = voiceGuide.script();
    assert.equal(lines.length, 9);
    lines.forEach((l) => { assert.ok(l.t.trim().length > 0); assert.ok(l.p > 0); });
  });

  test("عدد جُمل الاسترخاء الإنجليزي 9", () => {
    const { voiceGuide } = buildVoiceGuide({ voices: [], lang: "en" });
    assert.equal(voiceGuide.script().length, 9);
  });
});

describe("voiceGuide.setSpeed — تفضيل السرعة يُحفظ ويُطبَّق", () => {
  test("يحدّث cfg.scanRate ويحفظه في Store", () => {
    const { voiceGuide, store } = buildVoiceGuide({ voices: [{ lang: "ar-SA", localService: true }] });
    voiceGuide.detect();
    voiceGuide.setSpeed(0.6);
    assert.equal(voiceGuide.cfg.scanRate, 0.6);
    assert.equal(store.get("voiceSpeed"), 0.6);
  });

  test("cueRate يبقى دائماً أعلى قليلاً من scanRate وبحد أقصى 0.9", () => {
    const { voiceGuide } = buildVoiceGuide({ voices: [{ lang: "ar-SA", localService: true }] });
    voiceGuide.detect();
    voiceGuide.setSpeed(0.9); // يجب ألا يتجاوز cueRate الحد الأقصى 0.9 رغم الجمع
    assert.ok(voiceGuide.cfg.cueRate <= 0.9);
  });
});

describe("voiceGuide.play — تسلسل نطق كامل", () => {
  test("ينطق كل جُمل السكربت بالترتيب ثم يستدعي onDone", async () => {
    const spoken = [];
    const { voiceGuide } = buildVoiceGuide({
      voices: [{ lang: "ar-SA", localService: true }],
      onSpeak: (u) => { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 0); },
    });
    voiceGuide.detect();
    voiceGuide.cfg.settleMs = 1; // تسريع الاختبار
    await new Promise((resolve) => {
      voiceGuide.play(voiceGuide.script(), resolve);
    });
    assert.equal(spoken.length, 9);
  });

  test("toggleCues بإيقاف الصوت يمنع cue من النطق", () => {
    const spoken = [];
    const { voiceGuide } = buildVoiceGuide({
      voices: [{ lang: "ar-SA", localService: true }],
      onSpeak: (u) => spoken.push(u.text),
    });
    voiceGuide.detect();
    voiceGuide.toggleCues(); // إيقاف
    voiceGuide.cue("شهيق");
    assert.equal(spoken.length, 0);
  });
});
