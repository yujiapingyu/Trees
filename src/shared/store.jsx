import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
} from "react";
import { storage, services, desktop, join } from "./services";
import { id, validateName, EMPTY_DATA } from "./domain";
import { validateStudentSchool } from "./schools";
const Context = createContext(null);
export const useApp = () => useContext(Context);
export function useView(key, initial) {
  const [state, set] = useState(initial);
  const loaded = useRef(false);
  useEffect(() => {
    let live = true;
    storage.get("sm_view_state_" + key, initial).then((v) => {
      if (live) {
        loaded.current = true;
        set(v);
      }
    });
    return () => {
      live = false;
      loaded.current = false;
    };
  }, [key]);
  const change = (v) =>
    set((old) => {
      const next = typeof v === "function" ? v(old) : v;
      if (loaded.current)
        storage
          .set("sm_view_state_" + key, next)
          .catch((e) =>
            window.dispatchEvent(
              new CustomEvent("app:error", { detail: e.message }),
            ),
          );
      return next;
    });
  return [state, change];
}
export function AppProvider({ children }) {
  const [data, setData] = useState(structuredClone(EMPTY_DATA)),
    [config, setConfig] = useState({}),
    [loading, setLoading] = useState(true),
    [toast, setToast] = useState(null),
    [fatal, setFatal] = useState("");
  const current = useRef(data);
  const queue = useRef(Promise.resolve());
  const configRef = useRef(config);
  const studentQueue = useRef(Promise.resolve());
  const studentOperation = (fn) => {
    const p = studentQueue.current.then(fn);
    studentQueue.current = p.catch(() => {});
    return p;
  };
  const notify = (message, type = "success") => {
    setToast({ message, type });
  };
  useEffect(() => {
    storage
      .bootstrap()
      .then((r) => {
        current.current = r.data;
        setData(r.data);
        setConfig(r.config);
        configRef.current = r.config;
      })
      .catch((e) => setFatal(e.message))
      .finally(() => setLoading(false));
    const onError = (e) => notify(e.detail, "danger");
    window.addEventListener("app:error", onError);
    return () => window.removeEventListener("app:error", onError);
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const mutate = (fn) => {
    const operation = async () => {
      const next =
        typeof fn === "function" ? fn(structuredClone(current.current)) : fn;
      await storage.set("sm_workspace_v1", next);
      current.current = next;
      setData(next);
      return next;
    };
    const p = queue.current.then(operation);
    queue.current = p.catch((e) => notify(e.message, "danger"));
    return p;
  };
  const run = async (fn, success) => {
    try {
      const r = await fn();
      if (success) notify(success);
      return r;
    } catch (e) {
      notify(e.message, "danger");
      return undefined;
    }
  };
  const saveConfig = async (c) => {
    await storage.set("sm_path_config_v1", c);
    configRef.current = c;
    setConfig(c);
    notify("配置已保存，资源目录将重新加载");
  };
  const syncStudents = () =>
    studentOperation(async () => {
      const root = configRef.current.studentsRoot;
      if (!root) return;
      const entries = await services.list(root);
      await mutate((d) => {
        const incoming = entries.filter((e) => e.isDirectory);
        d.students = d.students.map((s) => ({
          ...s,
          missing: !incoming.some((e) => e.path === s.directoryPath),
        }));
        for (const e of incoming) {
          if (!d.students.some((s) => s.directoryPath === e.path)) {
            d.students.push({
              id: id(),
              name: e.name,
              grade: "",
              phone: "",
              notes: "",
              status: "未授课",
              directoryPath: e.path,
            });
          }
        }
        return d;
      });
    });
  const addStudent = (form) =>
    studentOperation(async () => {
      validateStudentSchool(form, current.current);
      const name = validateName(form.name, current.current.students);
      if (!configRef.current.studentsRoot)
        throw Error("请先在配置中心设置学生根目录");
      const directoryPath = join(configRef.current.studentsRoot, name);
      await services.mkdir(directoryPath);
      const student = {
        ...form,
        name,
        id: id(),
        directoryPath,
        status: "未授课",
      };
      try {
        await mutate((d) => ({ ...d, students: [...d.students, student] }));
      } catch (e) {
        throw Error(`目录已创建，但档案保存失败。请刷新扫描恢复：${e.message}`);
      }
      return student;
    });
  const editStudent = (student, form) =>
    studentOperation(async () => {
      validateStudentSchool(form, current.current);
      const name = validateName(
        form.name,
        current.current.students,
        student.id,
      );
      let directoryPath = student.directoryPath;
      if (name !== student.name) {
        directoryPath = join(
          student.directoryPath.split("/").slice(0, -1).join("/"),
          name,
        );
        await services.rename(student.directoryPath, directoryPath);
      }
      try {
        await mutate((d) => {
          const replace = (p) =>
            typeof p === "string" &&
            (p === student.directoryPath ||
              p.startsWith(student.directoryPath + "/"))
              ? directoryPath + p.slice(student.directoryPath.length)
              : p;
          const walk = (value) =>
            Array.isArray(value)
              ? value.map(walk)
              : value && typeof value === "object"
                ? Object.fromEntries(
                    Object.entries(value).map(([k, v]) => [k, walk(v)]),
                  )
                : replace(value);
          const migrated = walk(d);
          migrated.students = migrated.students.map((s) =>
            s.id === student.id ? { ...s, ...form, name, directoryPath } : s,
          );
          return migrated;
        });
      } catch (e) {
        if (name !== student.name)
          await services.rename(directoryPath, student.directoryPath);
        throw e;
      }
    });
  const deleteStudent = (student) =>
    studentOperation(async () => {
      await services.trash(student.directoryPath, student.name);
      await mutate((d) => {
        for (const k of [
          "students",
          "refs",
          "homework",
          "feedback",
          "notes",
          "followups",
          "wrongQuestions",
          "reports",
        ])
          d[k] = d[k].filter((x) =>
            k === "students" ? x.id !== student.id : x.studentId !== student.id,
          );
        for (const k of Object.keys(d.analysis))
          if (k.startsWith(student.id + ":")) delete d.analysis[k];
        return d;
      });
    });
  return (
    <Context.Provider
      value={{
        data,
        config,
        loading,
        fatal,
        toast,
        notify,
        run,
        mutate,
        saveConfig,
        syncStudents,
        addStudent,
        editStudent,
        deleteStudent,
        desktop,
      }}
    >
      {children}
      {toast && (
        <div role="status" className={"toast " + toast.type}>
          <span>{toast.message}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
