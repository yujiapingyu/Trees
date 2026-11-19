import React from "react";
import { PanelLeftClose, PanelLeftOpen, BookOpen } from "lucide-react";
import { useApp, useView } from "../shared/store";
import { today, timeFilter } from "../shared/domain";
import { useCourses } from "../shared/hooks";
import StudentList from "../components/StudentList";
import { PageHeader, Button, Empty, Field } from "../components/UI";
import { WrongPanel } from "../components/StudentPanels";
export default function WrongQuestions() {
  const { data } = useApp();
  const [view, setView] = useView("wrongQuestions", {
    selected: "",
    query: "",
    range: "all",
    lesson: "",
    collapsed: false,
    n: 5,
  });
  const student = data.students.find(
    (s) => s.id === view.selected && s.status !== "已停课",
  );
  const { courses } = useCourses(student);
  const all = data.wrongQuestions.filter((q) =>
    data.students.some((s) => s.id === q.studentId && s.status !== "已停课"),
  );
  const change = (k, v) => setView((x) => ({ ...x, [k]: v }));
  return (
    <div className="page">
      <PageHeader
        title="错题报告"
        eyebrow="LEARN FROM MISTAKES"
        description="看见错误背后的规律，让每一次练习更有方向。"
      >
        <Button
          icon={view.collapsed ? PanelLeftOpen : PanelLeftClose}
          onClick={() => change("collapsed", !view.collapsed)}
        >
          学生列表
        </Button>
      </PageHeader>
      <div className="simple-stats">
        {[
          ["错题总数", all.length],
          ["本周新增", timeFilter(all, "week").length],
          ["本月新增", timeFilter(all, "month").length],
        ].map(([l, n]) => (
          <div key={l}>
            <span>{l}</span>
            <b>{n}</b>
          </div>
        ))}
      </div>
      <div className={"two-panel " + (view.collapsed ? "collapsed" : "")}>
        {!view.collapsed && (
          <StudentList
            selected={view.selected}
            onSelect={(s) =>
              setView((v) => ({ ...v, selected: s, lesson: "" }))
            }
            query={view.query}
            onQuery={(q) => change("query", q)}
            count={(s) =>
              data.wrongQuestions.filter((q) => q.studentId === s.id).length +
              " 道错题"
            }
          />
        )}
        <div className="scroll-pane">
          {student ? (
            <>
              <div className="card filter-toolbar">
                <Field label="课程范围">
                  <select
                    value={view.lesson}
                    onChange={(e) => change("lesson", e.target.value)}
                  >
                    <option value="">全部课程</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="时间范围">
                  <select
                    value={view.range}
                    onChange={(e) => change("range", e.target.value)}
                  >
                    {[
                      ["all", "全部"],
                      ["week", "本周"],
                      ["month", "本月"],
                      ["recent", "近 N 次课"],
                    ].map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                {view.range === "recent" && (
                  <Field label="课次数">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={view.n}
                      onChange={(e) =>
                        change("n", Math.min(100, Math.max(1, +e.target.value)))
                      }
                    />
                  </Field>
                )}
              </div>
              <WrongPanel
                key={student.id}
                student={student}
                course={courses.find((c) => c.id === view.lesson)}
                range={view.range}
                recentN={view.n}
              />
            </>
          ) : (
            <Empty
              icon={BookOpen}
              title="选择学生，查看错题轨迹"
              description="这里与学生管理页共用同一份错题记录。"
            />
          )}
        </div>
      </div>
    </div>
  );
}
