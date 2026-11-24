const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validatePreferences,
  createShortcutManager,
  DEFAULT_SHORTCUT,
  toggleWindow,
} = require("../desktop/lifecycle.cjs");
test("shortcut hides the foreground window and brings back hidden, unfocused or minimized windows", () => {
  let hidden = 0,
    shown = 0;
  const show = () => shown++;
  const foreground = {
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
    isFocused: () => true,
    hide: () => hidden++,
  };
  toggleWindow(foreground, show);
  assert.equal(hidden, 1);
  assert.equal(shown, 0);
  for (const window of [
    null,
    { ...foreground, isDestroyed: () => true },
    { ...foreground, isVisible: () => false },
    { ...foreground, isMinimized: () => true },
    { ...foreground, isFocused: () => false },
  ])
    toggleWindow(window, show);
  assert.equal(shown, 5);
  assert.equal(hidden, 1);
});
test("desktop shortcut conflict retains the previous working shortcut and callback", () => {
  const keys = new Map();
  let shown = 0;
  const global = {
    isRegistered: (key) => keys.has(key),
    register(key, fn) {
      if (key === "Control+X") return false;
      if (key === "Control+Bad") throw Error("invalid");
      keys.set(key, fn);
      return true;
    },
    unregister: (key) => keys.delete(key),
  };
  const shortcuts = createShortcutManager(global, () => shown++);
  shortcuts.set(DEFAULT_SHORTCUT);
  keys.get(DEFAULT_SHORTCUT)();
  assert.equal(shown, 1);
  assert.throws(() => shortcuts.set("Control+X"), /占用/);
  assert.throws(() => shortcuts.set("Control+Bad"), /无法注册/);
  assert.equal(shortcuts.active, DEFAULT_SHORTCUT);
  assert.equal(keys.size, 1);
  shortcuts.set("Control+Alt+J");
  assert.equal(keys.has(DEFAULT_SHORTCUT), false);
  shortcuts.set("");
  assert.equal(keys.size, 0);
  shortcuts.set(DEFAULT_SHORTCUT);
  shortcuts.dispose();
  assert.equal(keys.size, 0);
});
test("desktop preferences reject malformed input and allow explicit disabling", () => {
  assert.deepEqual(
    validatePreferences({
      shortcut: "  Control+Shift+J ",
      openAtLogin: true,
      extra: 1,
    }),
    { shortcut: "Control+Shift+J", openAtLogin: true },
  );
  assert.deepEqual(validatePreferences({ shortcut: "", openAtLogin: false }), {
    shortcut: "",
    openAtLogin: false,
  });
  for (const input of [
    null,
    {},
    { shortcut: "J", openAtLogin: false },
    { shortcut: "Shift+J", openAtLogin: false },
    { shortcut: DEFAULT_SHORTCUT, openAtLogin: "true" },
  ])
    assert.throws(() => validatePreferences(input));
});
