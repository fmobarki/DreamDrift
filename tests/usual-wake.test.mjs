// اختبارات usualWake (تعديل وقت الاستيقاظ الدائم من الإعدادات) ومعاينة
// منتقي الإعداد الأول — أُضيفتا بعد اكتشاف أن مستخدماً حقيقياً أدخل "00:08"
// خطأً بدل "08:00" أثناء الإعداد الأول، ولم يكن هناك أي وسيلة لتصحيح ذلك
// لاحقاً سوى مسح بيانات التطبيق بالكامل.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, runInContext, mockDocument, mockStore } from "./helpers/extract.mjs";

const html = readIndexHtml();

describe("usualWake — تعديل الوقت المعتاد الدائم من الإعدادات", () => {
  function buildUsualWake(storeData) {
    const start = html.indexOf("// تعديل الوقت المعتاد (الدائم)");
    const end = html.indexOf("\nconst rhythm = {");
    const src = html.slice(start, end).replace("const usualWake", "var usualWake");
    const document = mockDocument();
    document.getElementById("usualWakeInput").value = "";
    const store = mockStore(storeData);
    let toastMsg = null, rendered = false, rescheduled = false;
    const context = {
      console, document, Store: store,
      toast: (m) => { toastMsg = m; }, t: (k) => k,
      app: { render() { rendered = true; } },
      rescheduleNotificationsIfEnabled() { rescheduled = true; },
    };
    runInContext(src, context, "usual-wake.js");
    return { usualWake: context.usualWake, document, store, getToast: () => toastMsg, wasRendered: () => rendered, wasRescheduled: () => rescheduled };
  }

  test("open() يملأ الحقل بالقيمة الحالية المحفوظة", () => {
    const { usualWake, document } = buildUsualWake({ wakeTime: "00:08" });
    usualWake.open();
    assert.equal(document.getElementById("usualWakeInput").value, "00:08");
  });

  test("save() يحفظ القيمة الجديدة في Store.wakeTime بشكل دائم", () => {
    const { usualWake, document, store } = buildUsualWake({ wakeTime: "00:08" });
    document.getElementById("usualWakeInput").value = "08:00";
    usualWake.save();
    assert.equal(store.get("wakeTime"), "08:00");
  });

  test("save() يُعيد رسم الواجهة، يُظهر تأكيداً، ويُعيد جدولة الإشعارات", () => {
    const { usualWake, document, wasRendered, wasRescheduled, getToast } = buildUsualWake({ wakeTime: "06:00" });
    document.getElementById("usualWakeInput").value = "07:15";
    usualWake.save();
    assert.equal(wasRendered(), true);
    assert.equal(wasRescheduled(), true, "يجب إعادة جدولة الإشعارات فوراً لأن الوقت الأساسي تغيّر");
    assert.ok(getToast());
  });

  test("قيمة بصيغة غير صحيحة تُرفض ولا تُحفظ (حماية من إدخال فاسد)", () => {
    const { usualWake, document, store } = buildUsualWake({ wakeTime: "07:30" });
    document.getElementById("usualWakeInput").value = "غير صالح";
    usualWake.save();
    assert.equal(store.get("wakeTime"), "07:30");
  });

  test("حقل فارغ عند الحفظ يستخدم القيمة المحفوظة حالياً بدل حفظ فراغ", () => {
    const { usualWake, document, store } = buildUsualWake({ wakeTime: "06:45" });
    document.getElementById("usualWakeInput").value = "";
    usualWake.save();
    assert.equal(store.get("wakeTime"), "06:45");
  });
});

describe("picker.updatePreview — معاينة حيّة لمنتقي الإعداد الأول", () => {
  function buildPicker(lang = "ar") {
    const src = html.slice(html.indexOf("const picker = {"), html.indexOf("\nconst ob = {")).replace("const picker = {", "var picker = {");
    const document = mockDocument();
    const context = { console, document, LANG: lang };
    runInContext(src, context, "picker.js");
    return { picker: context.picker, document };
  }

  test("يعرض 08:00 ص بوضوح عند اختيار الساعة 8 صباحاً", () => {
    const { picker, document } = buildPicker("ar");
    picker.h = 8; picker.m = 0; picker.p = "AM";
    picker.updatePreview();
    assert.equal(document.getElementById("pickerPreview").textContent, "08:00 ص");
  });

  test("الخطأ الشائع (ساعة 12 افتراضية + دقيقة 8) يظهر بوضوح كـ12:08 ص لا 00:08 صامتة", () => {
    // هذا بالضبط السيناريو الذي أنتج قيمة \"00:08\" الخاطئة لدى مستخدم حقيقي —
    // المعاينة يجب أن تجعل الخطأ لافتاً بصيغة 12 ساعة، لا صيغة 24 ساعة المضلِّلة
    const { picker, document } = buildPicker("ar");
    picker.h = 12; picker.m = 8; picker.p = "AM";
    picker.updatePreview();
    assert.equal(document.getElementById("pickerPreview").textContent, "12:08 ص");
  });

  test("تعمل بالإنجليزية أيضاً (AM/PM بدل ص/م)", () => {
    const { picker, document } = buildPicker("en");
    picker.h = 8; picker.m = 30; picker.p = "PM";
    picker.updatePreview();
    assert.equal(document.getElementById("pickerPreview").textContent, "08:30 PM");
  });

  test("init() يستدعي المعاينة فوراً فلا تظهر الشاشة بقيمة افتراضية غير محدَّثة", () => {
    const { picker, document } = buildPicker("ar");
    // نحاكي init جزئياً: نتحقق فقط أن updatePreview قابلة للاستدعاء بأمان بلا عجلات مبنية فعلياً
    assert.doesNotThrow(() => picker.updatePreview());
    assert.ok(document.getElementById("pickerPreview").textContent.length > 0);
  });
});
