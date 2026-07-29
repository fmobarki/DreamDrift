// إعداد ESLint اختياري لفحص جودة الكود أثناء التطوير — لا علاقة له بالتطبيق
// المُسلَّم نفسه (index.html يبقى ملفاً واحداً بلا خطوة بناء كما هو). يُشغَّل
// عبر: npm run lint (يستخرج السكربت من index.html تلقائياً عبر scripts/lint.mjs)
//
// تحذيرات مقبولة عمداً ولا تحتاج إصلاحاً (وثّقناها هنا بدل تجاهلها صمتاً):
// - "'e' is defined but never used" داخل catch(e){} فارغة: نمط دفاعي متكرر
//   ومقصود (تجاهل خطأ غير حرج عمداً)، لا خطأ إغفال.
// - "'X' is assigned a value but never used" لكائنات المستوى الأعلى مثل
//   profile/quickBreath/visualize/weeklyReport: هذه كائنات تُستدعى دوالها من
//   HTML مباشرة (onclick="X.method()")، لا يراها ESLint لأنه يفحص السكربت
//   المُستخرَج بمعزل عن HTML المُستضيف — استخدام حقيقي لا كود ميت.
export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly",
        localStorage: "readonly", sessionStorage: "readonly",
        fetch: "readonly", console: "readonly", setTimeout: "readonly",
        clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly",
        requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
        Notification: "readonly", crypto: "readonly", btoa: "readonly", atob: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly", Uint8Array: "readonly",
        AudioContext: "readonly", webkitAudioContext: "readonly",
        speechSynthesis: "readonly", SpeechSynthesisUtterance: "readonly",
        Blob: "readonly", URL: "readonly", FileReader: "readonly", File: "readonly",
        indexedDB: "readonly", matchMedia: "readonly", alert: "readonly", confirm: "readonly",
        CustomEvent: "readonly", Image: "readonly", location: "readonly", history: "readonly",
        Promise: "readonly", MutationObserver: "readonly", IntersectionObserver: "readonly",
        performance: "readonly", ServiceWorkerRegistration: "readonly",
        DOMMatrix: "readonly", AbortController: "readonly", MessageChannel: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-unreachable": "error",
      "no-fallthrough": "error",
      "no-const-assign": "error",
      "no-redeclare": "error",
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-var": "warn",
      "eqeqeq": ["warn", "smart"],
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
];
