import React, { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { desktop, services } from "../shared/services";
import { Button, Field, ErrorBox, Badge } from "./UI";

export default function DesktopSettings() {
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (desktop)
      services
        .desktopState()
        .then((value) => {
          if (active) setState(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, []);
  if (!desktop)
    return <p>请打开已安装的「知序」应用，设置全局快捷键和登录自动启动。</p>;
  const change = (patch) => {
    setState((value) => ({ ...value, ...patch }));
    setSaved(false);
  };
  return (
    <div className="settings-fields">
      <p>
        双击「知序」即可使用，无需打开终端。全局快捷键可调出窗口，再按一次即可隐藏；切到其他软件后再按会调回知序。关闭或隐藏窗口后仍在菜单栏驻留，页面和草稿会保留。彻底退出请使用菜单中的「退出知序」或
        ⌘Q。
      </p>
      {error && <ErrorBox message={error} />}
      {state ? (
        <>
          <p>
            当前版本：{state.version}
            。软件修改后需安装新版应用才会生效。保存草稿并用 ⌘Q
            退出后，双击项目中的「更新知序.command」即可更新，原有学生数据和配置会保留。
          </p>
          <Field label="全局唤起快捷键">
            <input
              value={state.shortcut}
              onChange={(e) => change({ shortcut: e.target.value })}
              placeholder="CommandOrControl+Shift+J"
            />
            <small>
              默认
              Mac：⌘⇧J。示例：CommandOrControl+Alt+J；留空可禁用。保存后立即生效。
            </small>
          </Field>
          {state.shortcutError && <ErrorBox message={state.shortcutError} />}
          <Badge type={state.registered ? "success" : "warning"}>
            {state.registered ? "全局快捷键已生效" : "全局快捷键未启用"}
          </Badge>
          <Field label="登录自动启动">
            <select
              value={String(state.openAtLogin)}
              disabled={!state.packaged}
              onChange={(e) =>
                change({ openAtLogin: e.target.value === "true" })
              }
            >
              <option value="false">关闭</option>
              <option value="true">开启</option>
            </select>
            <small>
              {state.packaged
                ? "开启后，登录电脑时自动启动知序，方便随时用快捷键打开。"
                : "安装独立应用后可开启，开发模式不支持。"}
            </small>
          </Field>
          <div className="settings-footer">
            <span>
              {saved
                ? "桌面设置已保存"
                : "桌面设置保存在本机，原有学生和资料数据不变。"}
            </span>
            <Button
              variant="primary"
              icon={Save}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                setSaved(false);
                try {
                  setState(
                    await services.desktopSave({
                      shortcut: state.shortcut,
                      openAtLogin: state.openAtLogin,
                    }),
                  );
                  setSaved(true);
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存桌面设置
            </Button>
          </div>
        </>
      ) : (
        !error && <p>正在读取桌面设置…</p>
      )}
    </div>
  );
}
