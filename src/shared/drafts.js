import { useEffect, useRef, useState } from "react";
import { storage } from "./services";
import { useApp } from "./store";
// Persist every edit immediately. Main-process writes are queued and awaited on quit.
export function useDraft(name, initial) {
  const { storageState, notify } = useApp();
  const key =
    "sm_draft_" +
    (storageState?.datasetId || storageState?.file || "browser") +
    ":" +
    name;
  const fresh = () =>
    typeof initial === "function" ? initial() : structuredClone(initial);
  const [value, setValue] = useState(fresh),
    current = useRef(value),
    generation = useRef(0),
    activeKey = useRef(key);
  useEffect(() => {
    let live = true;
    activeKey.current = key;
    const token = ++generation.current;
    const fallback = fresh();
    current.current = fallback;
    setValue(fallback);
    storage
      .get(key, null)
      .then((saved) => {
        if (live && token === generation.current && saved != null) {
          current.current = saved;
          setValue(saved);
        }
      })
      .catch((e) => notify("草稿读取失败：" + e.message, "danger"));
    return () => {
      live = false;
    };
  }, [key]);
  const set = (next) => {
    ++generation.current;
    const result = typeof next === "function" ? next(current.current) : next;
    current.current = result;
    setValue(result);
    storage
      .set(activeKey.current, result)
      .catch((e) => notify("草稿未能保存：" + e.message, "danger"));
  };
  return [value, set];
}
