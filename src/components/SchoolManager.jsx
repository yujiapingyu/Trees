import React, { useState } from "react";
import { Plus, Pencil, Trash2, School } from "lucide-react";
import { useApp } from "../shared/store";
import { SCHOOL_STAGES, saveSchool, deleteSchool } from "../shared/schools";
import { Button, Tabs, Field, Modal, Confirm, Empty, Badge } from "./UI";
export default function SchoolManager({ initialStage = "初中" }) {
  const { data, mutate, run } = useApp();
  const [stage, setStage] = useState(initialStage),
    [name, setName] = useState(""),
    [editing, setEditing] = useState(null),
    [remove, setRemove] = useState(null);
  const schools = data.schools.filter((s) => s.stage === stage);
  return (
    <div className="school-manager">
      <Tabs items={SCHOOL_STAGES} value={stage} onChange={setStage} />
      <div className="inline-input school-add">
        <input
          aria-label="新增学校名称"
          value={name}
          placeholder={"输入" + stage + "学校名称"}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run(async () => {
                await mutate((d) => saveSchool(d, { name, stage }));
                setName("");
              });
            }
          }}
        />
        <Button
          icon={Plus}
          variant="primary"
          disabled={!name.trim()}
          onClick={() =>
            run(async () => {
              await mutate((d) => saveSchool(d, { name, stage }));
              setName("");
            }, "学校已添加")
          }
        >
          添加学校
        </Button>
      </div>
      <p className="form-hint">
        学校由教师自定义；同一学段内名称唯一。学生关联后，学校改名会自动显示新名称。
      </p>
      {!schools.length ? (
        <Empty
          icon={School}
          title={"还没有" + stage + "学校"}
          description="添加学校后，即可在学生档案中选择关联。"
        />
      ) : (
        schools.map((s) => {
          const linked = data.students.filter(
            (student) => student.schoolId === s.id,
          );
          const usedByExam = (data.exams || []).some((e) =>
            e.schoolIds.includes(s.id),
          );
          return (
            <div className="linked-row" key={s.id}>
              <strong>{s.name}</strong>
              <Badge>{linked.length} 位学生</Badge>
              <span className="spacer" />
              <Button icon={Pencil} onClick={() => setEditing(s)}>
                编辑学校
              </Button>
              <Button
                icon={Trash2}
                disabled={!!linked.length || usedByExam}
                title={
                  linked.length ? "请先处理关联学生及考试" : "删除未关联学校"
                }
                onClick={() => setRemove(s)}
              >
                删除学校
              </Button>
            </div>
          );
        })
      )}
      {editing && (
        <Modal title="编辑学校" onClose={() => setEditing(null)}>
          <Field label="学校名称">
            <input
              value={editing.name}
              onChange={(e) =>
                setEditing((s) => ({ ...s, name: e.target.value }))
              }
            />
          </Field>
          <Field label="学校学段">
            <select
              value={editing.stage}
              onChange={(e) =>
                setEditing((s) => ({ ...s, stage: e.target.value }))
              }
            >
              {SCHOOL_STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <footer>
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={() =>
                run(async () => {
                  await mutate((d) => saveSchool(d, editing));
                  setEditing(null);
                }, "学校已更新")
              }
            >
              保存学校
            </Button>
          </footer>
        </Modal>
      )}
      {remove && (
        <Confirm
          title="删除学校"
          description={
            "删除学校“" + remove.name + "”。已有学生关联时不能删除。"
          }
          onClose={() => setRemove(null)}
          onConfirm={() => mutate((d) => deleteSchool(d, remove.id))}
        />
      )}
    </div>
  );
}
