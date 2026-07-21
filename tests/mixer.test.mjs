// اختبارات mixer — مازج الأصوات المولَّدة بـ Web Audio.
// التركيز هنا على أمرين تحديداً: (1) لا بقايا لصوت "binaural" المحذوف،
// (2) العقد الصوتية تُبنى بعد اكتمال استئناف AudioContext لا قبله —
// هذا هو الإصلاح الذي عالج صمت المازج على أندرويد/Edge سابقاً في هذه المحادثة.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readIndexHtml, extractBetween, runInContext } from "./helpers/extract.mjs";

const html = readIndexHtml();
const moduleSource = extractBetween(
  html,
  "const mixer = {",
  "\nconst app = {"
).replace("const mixer = {", "var mixer = {");

function makeFakeAudioContext({ startSuspended = true, resumeDelayMs = 5 } = {}) {
  const ctx = {
    state: startSuspended ? "suspended" : "running",
    currentTime: 0,
    sampleRate: 44100,
    resume() {
      return new Promise((resolve) => {
        setTimeout(() => { ctx.state = "running"; resolve(); }, resumeDelayMs);
      });
    },
    createBuffer: () => ({ getChannelData: () => new Float32Array(100) }),
    createBufferSource: () => ({ connect(){}, start(){}, buffer:null, loop:false }),
    createGain: () => ({ connect(){}, gain:{ value:0, setTargetAtTime(){} } }),
    createBiquadFilter: () => ({ connect(){}, type:"", frequency:{value:0}, Q:{value:0} }),
    createOscillator: () => ({ connect(){}, start(){}, stop(){}, frequency:{value:0} }),
    destination: {},
  };
  return ctx;
}

function buildMixer({ startSuspended = true } = {}) {
  const fakeCtx = makeFakeAudioContext({ startSuspended });
  const document = { getElementById: () => null, querySelectorAll: () => [] };
  const store = { get: (k, d) => d, set: () => {} };
  const context = {
    console, document, Store: store, LANG: "ar",
    window: { AudioContext: function () { return fakeCtx; }, webkitAudioContext: undefined },
    t: (k) => k,
    Math, Date, JSON, Object, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  runInContext(moduleSource, context, "mixer.js");
  return { mixer: context.mixer, fakeCtx };
}

describe("mixer.levels — لا بقايا للموجة الثنائية المحذوفة", () => {
  test("مفاتيح levels لا تحتوي binaural، وتحتوي كل الأصوات الستة الفعلية", () => {
    const { mixer } = buildMixer();
    const keys = Object.keys(structuredClone(mixer.levels)).sort();
    assert.deepEqual(keys, ["brown", "fire", "forest", "ocean", "rain", "wind"]);
  });
});

describe("mixer.start — ترتيب استئناف AudioContext قبل بناء العقد", () => {
  test("لا تُبنى أي عقدة قبل أن يصبح السياق running", async () => {
    const { mixer, fakeCtx } = buildMixer({ startSuspended: true });
    const buildOrder = [];
    const originalBuild = mixer.buildSound.bind(mixer);
    mixer.buildSound = (type) => {
      buildOrder.push({ type, ctxStateAtBuildTime: mixer.ctx.state });
      originalBuild(type);
    };

    await new Promise((resolve) => {
      mixer.start();
      // ننتظر أطول قليلاً من resumeDelayMs المفترضة (5ms) لضمان اكتمال الاستئناف
      setTimeout(resolve, 30);
    });

    assert.equal(buildOrder.length, 6, "يجب استدعاء buildSound بالضبط 6 مرات (مرة لكل نوع أساسي)");
    assert.ok(
      buildOrder.every((b) => b.ctxStateAtBuildTime === "running"),
      "كل عقدة يجب أن تُبنى والسياق running فعلاً — هذا هو إصلاح صمت المازج"
    );
    assert.equal(mixer.playing, true);
  });

  test("سياق يبدأ running أصلاً (بعد تفعيل سابق): البناء يحدث فوراً دون انتظار", async () => {
    const { mixer } = buildMixer({ startSuspended: false });
    await new Promise((resolve) => { mixer.start(); setTimeout(resolve, 10); });
    // بعض الأصوات (كالأمواج) تضيف عقدة "_lfo" إضافية لتضمين الموجة، فالعدد الكلي
    // قد يتجاوز 6 — نتحقق أن كل الأنواع الأساسية الستة موجودة تحديداً، لا العدد الكلي
    const nodeKeys = Object.keys(mixer.nodes);
    ["rain", "ocean", "forest", "fire", "wind", "brown"].forEach((tp) => {
      assert.ok(nodeKeys.includes(tp), `الصوت الأساسي "${tp}" يجب أن يُبنى`);
    });
  });

  test("استدعاء start مرتين لا يُعيد بناء نفس الأصوات مرتين", async () => {
    const { mixer } = buildMixer({ startSuspended: false });
    await new Promise((resolve) => { mixer.start(); setTimeout(resolve, 10); });
    const firstNodes = mixer.nodes;
    await new Promise((resolve) => { mixer.start(); setTimeout(resolve, 10); });
    assert.equal(mixer.nodes, firstNodes, "نفس مرجع الكائن — لم تُعَد بناء العقد");
  });
});
