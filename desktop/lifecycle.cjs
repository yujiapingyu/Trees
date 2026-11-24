const DEFAULT_SHORTCUT = "CommandOrControl+Shift+J";
function validatePreferences(input) {
  if (
    !input ||
    typeof input.shortcut !== "string" ||
    typeof input.openAtLogin !== "boolean"
  )
    throw Error("桌面设置格式无效");
  const shortcut = input.shortcut.trim();
  if (
    shortcut &&
    (!/^(?=.*(?:CommandOrControl|Command|Control|Ctrl|Alt|Option|Super))(?:[A-Za-z0-9]+\+)+[A-Za-z0-9]+$/.test(
      shortcut,
    ) ||
      shortcut.length > 100)
  )
    throw Error("快捷键格式示例：CommandOrControl+Shift+J；留空可禁用");
  return { shortcut, openAtLogin: input.openAtLogin };
}
function toggleWindow(window, show) {
  if (
    window &&
    !window.isDestroyed() &&
    window.isVisible() &&
    !window.isMinimized() &&
    window.isFocused()
  )
    window.hide();
  else show();
}
function createShortcutManager(globalShortcut, onShortcut) {
  let active = "";
  return {
    get active() {
      return active;
    },
    set(next) {
      if (next === active && (!next || globalShortcut.isRegistered(next)))
        return;
      if (next) {
        let registered = false;
        try {
          registered = globalShortcut.register(next, onShortcut);
        } catch {}
        if (!registered)
          throw Error("全局快捷键已被占用或无法注册，请换一个组合");
      }
      const previous = active;
      active = next;
      if (previous && previous !== next) globalShortcut.unregister(previous);
    },
    dispose() {
      if (active) globalShortcut.unregister(active);
      active = "";
    },
  };
}
module.exports = {
  DEFAULT_SHORTCUT,
  validatePreferences,
  createShortcutManager,
  toggleWindow,
};
