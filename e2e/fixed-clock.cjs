// Preloaded into the visual-test server only. Seeded demo data and charts are
// dated relative to "now", so screenshots would drift daily. Shift the clock so
// it starts at a fixed instant but keeps ticking, which timers and caches need.
// A Proxy keeps every Date static (UTC, parse) and instanceof intact.
const fixed = Date.parse(process.env.VISUAL_FIXED_NOW ?? "");
if (Number.isFinite(fixed)) {
  const RealDate = Date;
  const realNow = RealDate.now.bind(RealDate);
  const offset = fixed - realNow();
  const now = () => realNow() + offset;
  globalThis.Date = new Proxy(RealDate, {
    construct(target, args, newTarget) {
      return Reflect.construct(target, args.length ? args : [now()], newTarget);
    },
    apply() {
      return new RealDate(now()).toString();
    },
    get(target, property, receiver) {
      return property === "now" ? now : Reflect.get(target, property, receiver);
    },
  });
}
