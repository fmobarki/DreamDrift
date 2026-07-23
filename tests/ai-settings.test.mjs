// اختبارات aiSettings — تحديداً الفرق الجوهري بين "إيقاف مؤقت" (لا يمسح شيئاً)
// و"حذف صريح للمفتاح" (يمسح كل أثر: النصيحة المخزَّنة، وقت آخر استدعاء،
// والتشخيص المرتبط بها) — سؤال خصوصية حقيقي طرحه المستخدم.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext, mockDocument, mockStore } from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(html, "const aiSettings = {", "\nconst rhythm = {")
  .replace("const aiSettings", "var aiSettings");
// Validate كائن مشترك حقيقي مُستخرَج من نفس الملف — لا محاكاة مبسَّطة، لضمان
// أن الاختبار يفحص السلوك الفعلي لفحص معقولية المفتاح لا افتراضاً عنه
const validateSource = extractBetween(html, "const Validate = {", "\nfunction wrapCanvasText")
  .replace("const Validate", "var Validate");

// ترجمة وهمية دنيا — كافية فقط لما تستخدمه aiSettings فعلياً في هذه الاختبارات
const T_AR = {
  ai_key_missing:"أدخل مفتاح API أولاً", ai_key_invalid:"مفتاح غير صالح", ai_saved:"تم حفظ المفتاح", ai_cleared:"تم حذف المفتاح",
  ai_usage_none:"لم يُستخدَم بعد هذا الأسبوع",
  ai_usage_count: (n)=>"استُخدم "+n+" مرات هذا الأسبوع",
  ai_history_empty:"لا تحليلات مخزَّنة بعد — ستظهر هنا فور أول تحديث ناجح.",
};

function buildSettings(storeData, lang="ar") {
  const document = mockDocument();
  const store = mockStore(storeData);
  let toastMsg = null;
  const context = {
    console, document, Store: store, LANG: lang,
    toast: (m) => { toastMsg = m; },
    t: (k) => { const v = T_AR[k]; return v===undefined ? k : v; },
    // aiSettings.refreshModelPlaceholder تقرأ النموذج الافتراضي من aiAdvisor
    // لعرضه كنص إرشادي في حقل تجاوز النموذج
    aiAdvisor: { PROVIDERS: {
      openai:{ model:"gpt-4o-mini" },
      gemini:{ model:"gemini-flash-latest" },
      anthropic:{ model:"claude-haiku-4-5-20251001" },
    }},
    Math, Date, JSON, Object,
  };
  runInContext(validateSource, context, "validate.js");
  runInContext(moduleSource, context, "ai-settings.js");
  return { aiSettings: context.aiSettings, document, store, getToast: () => toastMsg };
}

const CACHED_STATE = {
  aiEnabled: true, aiProvider: "openai", aiApiKey: "sk-real-key",
  aiHistory: [{ ts: Date.now() - 86400000, t: "نصيحة سابقة", why: "سبب", provider: "openai", dxKey: "delay" }],
};

describe("aiSettings.onToggle — إيقاف مؤقت لا يمسح السجل التاريخي", () => {
  test("تبديل المفتاح إلى إيقاف لا يُغيّر aiHistory إطلاقاً", () => {
    const { aiSettings, store } = buildSettings({ ...CACHED_STATE });
    aiSettings.onToggle({ checked: false });
    assert.deepEqual(store.get("aiHistory"), CACHED_STATE.aiHistory, "يجب أن يبقى السجل محفوظاً عند الإيقاف المؤقت");
    assert.equal(store.get("aiEnabled"), false, "التفعيل نفسه يجب أن يُطفَأ");
  });
});

describe("aiSettings.clear — حذف المفتاح يوقف الاستخدام المستقبلي، لا يمسح السجل التاريخي", () => {
  test("يمسح المفتاح والتفعيل، ويُبقي aiHistory كاملاً كما هو", () => {
    const { aiSettings, store } = buildSettings({ ...CACHED_STATE });
    aiSettings.clear();
    assert.equal(store.get("aiApiKey"), "");
    assert.equal(store.get("aiEnabled"), false);
    assert.deepEqual(store.get("aiHistory"), CACHED_STATE.aiHistory, "حذف المفتاح يجب ألا يمسّ السجل التاريخي إطلاقاً — هو ملك المستخدم بصرف النظر عن حالة المفتاح");
  });

  test("يُظهر تأكيداً للمستخدم", () => {
    const { aiSettings, getToast } = buildSettings({ ...CACHED_STATE });
    aiSettings.clear();
    assert.ok(getToast());
  });

  test("لا يرمي خطأً حتى بلا أي بيانات مخزَّنة مسبقاً", () => {
    const { aiSettings } = buildSettings({});
    assert.doesNotThrow(() => aiSettings.clear());
  });
});

describe("aiSettings.openHistory — عرض السجل وحمايته من الحقن", () => {
  test("يعرض كل السجلات، الأحدث أولاً", () => {
    const { aiSettings, document } = buildSettings({
      aiHistory: [
        { ts: 1000, t: "الأقدم", why: "", provider: "openai", dxKey: "delay" },
        { ts: 2000, t: "الأحدث", why: "", provider: "gemini", dxKey: "unstable" },
      ],
    });
    aiSettings.openHistory();
    const html = document.getElementById("aiHistoryList").innerHTML;
    assert.ok(html.indexOf("الأحدث") < html.indexOf("الأقدم"), "يجب عرض الأحدث أولاً");
  });

  test("حالة فارغة: رسالة واضحة بلا سجلات", () => {
    const { aiSettings, document } = buildSettings({ aiHistory: [] });
    aiSettings.openHistory();
    assert.match(document.getElementById("aiHistoryList").innerHTML, /لا تحليلات مخزَّنة/);
  });

  test("نص من رد المزوّد يحتوي وسم HTML يُعقَّم قبل الإدراج (حماية من الحقن)", () => {
    const { aiSettings, document } = buildSettings({
      aiHistory: [{ ts: Date.now(), t: '<img src=x onerror=alert(1)>', why: "<b>test</b>", provider: "openai", dxKey: "delay" }],
    });
    aiSettings.openHistory();
    const html = document.getElementById("aiHistoryList").innerHTML;
    assert.equal(html.includes("<img"), false, "لا يجب إدراج وسم <img> حرفياً");
    assert.equal(html.includes("<b>test</b>"), false, "لا يجب إدراج <b> حرفياً");
    assert.match(html, /&lt;img/, "يجب أن يظهر معقَّماً كنص بدل وسم فعلي");
  });
});

describe("aiSettings — تجاوز اسم النموذج يدوياً", () => {
  test("save يحفظ التجاوز المكتوب في الحقل", () => {
    const { aiSettings, document, store } = buildSettings({ aiProvider:"gemini" });
    document.getElementById("aiApiKeyInput").value = "AIzaSyD-fake-key-for-testing-only";
    document.getElementById("aiModelInput").value = "  gemini-custom  ";
    aiSettings.save();
    assert.equal(store.get("aiModelOverride"), "gemini-custom", "يجب تشذيب المسافات وحفظ القيمة");
  });

  test("تبديل المزوّد يمسح التجاوز — نموذج مزوّد لا ينتمي للآخر يعني فشلاً مضموناً", () => {
    const { aiSettings, document, store } = buildSettings({ aiProvider:"gemini", aiModelOverride:"gemini-custom" });
    aiSettings.onProviderChange({ value:"openai" });
    assert.equal(store.get("aiModelOverride"), "");
    assert.equal(document.getElementById("aiModelInput").value, "");
  });

  test("clear يمسح التجاوز مع المفتاح", () => {
    const { aiSettings, store } = buildSettings({ aiApiKey:"k", aiModelOverride:"custom" });
    aiSettings.clear();
    assert.equal(store.get("aiModelOverride"), "");
  });

  test("النص الإرشادي في الحقل يعرض النموذج الافتراضي للمزوّد الحالي", () => {
    const { aiSettings, document } = buildSettings({ aiProvider:"anthropic" });
    aiSettings.refreshModelPlaceholder();
    assert.equal(document.getElementById("aiModelInput").placeholder, "claude-haiku-4-5-20251001");
  });
});

describe("aiSettings.refreshUsage — عدّاد وربط الفوترة", () => {
  test("رابط الفوترة يتبع المزوّد المحفوظ حالياً", () => {
    const { aiSettings, document, store } = buildSettings({ aiProvider: "anthropic" });
    aiSettings.refreshUsage();
    assert.match(document.getElementById("aiBillingLink").href, /anthropic\.com/);
  });

  test("onProviderChange يُحدّث رابط الفوترة فوراً عند التبديل", () => {
    const { aiSettings, document } = buildSettings({ aiProvider: "openai" });
    aiSettings.onProviderChange({ value: "gemini" });
    assert.match(document.getElementById("aiBillingLink").href, /google\.com/);
  });
});
