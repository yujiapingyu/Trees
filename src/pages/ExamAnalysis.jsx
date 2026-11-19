import React, { useState, useRef } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Sparkles,
  Download,
  FolderOpen,
  Square,
  Save,
} from "lucide-react";
import { useApp, useView } from "../shared/store";
import { services, basename, join } from "../shared/services";
import { id, parseJSONResult, today } from "../shared/domain";
import {
  PageHeader,
  Button,
  Section,
  Empty,
  ErrorBox,
  Progress,
  Editor,
  CopyButton,
  Field,
  Badge,
} from "../components/UI";
export default function ExamAnalysis() {
  const { config, run } = useApp();
  const [view, setView] = useView("examAnalysis", {
    files: [],
    result: "",
    classifications: [],
    exportPath: "",
  });
  const [stage, setStage] = useState(""),
    [error, setError] = useState(""),
    [root, setRoot] = useState(config.questionBankRoot || ""),
    [title, setTitle] = useState("试卷考点分析");
  const request = useRef(""),
    cancelled = useRef(false);
  const change = (k, v) => setView((x) => ({ ...x, [k]: v }));
  const analyze = async () => {
    setError("");
    cancelled.current = false;
    try {
      if (!view.files.length) throw Error("请先导入 DOCX 试卷");
      if (!config.deepseekKey) throw Error("请先配置 DeepSeek API Key");
      const papers = [];
      for (let i = 0; i < view.files.length; i++) {
        setStage(`读取试卷 ${i + 1}/${view.files.length}`);
        const text = await services.readText(view.files[i].path);
        if (cancelled.current) throw Error("任务已取消");
        if (!/(?:\d+[.、．]|第[一二三四五六七八九十\d]+题)/.test(text))
          throw Error(view.files[i].name + " 未识别到编号题目，请检查正文");
        setStage(`分类试卷 ${i + 1}/${view.files.length}`);
        request.current = id();
        const r = await services.ai({
          id: request.current,
          task:
            "将试卷题目按大类/知识点分类。仅输出 JSON 数组，每项 number,category,knowledgePoint,summary。只根据正文，不添加题目。\n" +
            text,
          json: true,
        });
        const parsed = parseJSONResult(r.text);
        if (
          !Array.isArray(parsed) ||
          !parsed.length ||
          parsed.some((q) => !q.category || !q.knowledgePoint)
        )
          throw Error("分类结构不完整，请重试");
        papers.push({ name: view.files[i].name, questions: parsed });
      }
      change("classifications", papers);
      setStage("比较跨卷考点与预测");
      request.current = id();
      const result = await services.ai({
        id: request.current,
        task:
          "根据以下实际分类，输出各试卷考点统计、跨卷变化、值得关注的考点和教学建议。预测须明确是基于样本的推测，不能当作命题事实。\n" +
          JSON.stringify(papers),
      });
      if (cancelled.current) throw Error("任务已取消");
      change("result", result.text);
    } catch (e) {
      setError(e.message);
    } finally {
      setStage("");
    }
  };
  return (
    <div className="page">
      <PageHeader
        title="试卷分析"
        eyebrow="EXAM INSIGHTS"
        description="从多份试卷中梳理考点，理解变化与教学重点。"
      >
        <Button
          icon={Plus}
          onClick={() =>
            run(async () => {
              const p = await services.pick("file", [
                { name: "Word 试卷", extensions: ["docx"] },
              ]);
              if (!p) return;
              if (view.files.some((f) => f.path === p))
                throw Error("已导入该试卷");
              const check = await services.check(p);
              if (!check.readable) throw Error(check.error);
              const bytes = await services.readBytes(p);
              change("files", [
                ...view.files,
                {
                  path: p,
                  name: basename(p),
                  size: Math.floor(bytes.length * 0.75),
                },
              ]);
            })
          }
        >
          导入 DOCX
        </Button>
        <Button
          variant="primary"
          icon={Sparkles}
          busy={!!stage}
          onClick={analyze}
        >
          分析考点
        </Button>
      </PageHeader>
      <div className="exam-layout">
        <Section title="试卷文件" subtitle="支持一份合并文档或多份试卷">
          {!view.files.length ? (
            <Empty
              icon={FileText}
              title="先添加一份试卷"
              description="文档需包含可提取的编号题目。"
            />
          ) : (
            view.files.map((f) => (
              <div className="exam-file" key={f.path}>
                <FileText size={23} />
                <div className="grow">
                  <strong>{f.name}</strong>
                  <small>{(f.size / 1024).toFixed(1)} KB</small>
                </div>
                <Button
                  icon={Trash2}
                  disabled={!!stage}
                  onClick={() =>
                    change(
                      "files",
                      view.files.filter((x) => x.path !== f.path),
                    )
                  }
                >
                  移除
                </Button>
              </div>
            ))
          )}
          {stage && (
            <>
              <Progress stage={stage} />
              <Button
                icon={Square}
                onClick={() => {
                  cancelled.current = true;
                  services.cancelAI(request.current);
                }}
              >
                取消处理
              </Button>
            </>
          )}
          {error && <ErrorBox message={error} retry={analyze} />}
          <div className="pipeline-list">
            {["读取文档", "题目分类", "跨卷比较与预测", "校对并导出 Word"].map(
              (s, i) => (
                <div key={s}>
                  <span>{i + 1}</span>
                  {s}
                </div>
              ),
            )}
          </div>
        </Section>
        <Section title="分析结果" subtitle="模型结果可编辑，导出前请人工校对">
          {view.result ? (
            <>
              <Editor
                value={view.result}
                onChange={(v) => change("result", v)}
                rows={20}
              />
              <div className="form-grid two">
                <Field label="导出标题">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
                <Field label="导出目录">
                  <div className="inline-input">
                    <input
                      value={root}
                      onChange={(e) => setRoot(e.target.value)}
                    />
                    <Button
                      icon={FolderOpen}
                      onClick={() =>
                        run(async () => {
                          const p = await services.pick("directory");
                          if (p) {
                            setRoot(
                              p,
                            ); /* explicit directory needs configured root */
                          }
                        })
                      }
                    >
                      选择
                    </Button>
                  </div>
                </Field>
              </div>
              <p className="muted">导出位置需位于配置的资源目录内。</p>
              <div className="button-row">
                <CopyButton text={view.result} />
                <Button
                  variant="primary"
                  icon={Download}
                  onClick={() =>
                    run(async () => {
                      if (!root || !title.trim())
                        throw Error("请填写标题与导出目录");
                      const path = join(
                        root,
                        `${title.replace(/[\\/:*?"<>|]/g, "_")}_${today()}_${id().slice(0, 6)}.docx`,
                      );
                      await services.word(path, view.result);
                      change("exportPath", path);
                    }, "分析报告已导出")
                  }
                >
                  导出 Word
                </Button>
                {view.exportPath && (
                  <Button
                    icon={FolderOpen}
                    onClick={() => run(() => services.open(view.exportPath))}
                  >
                    打开导出文件
                  </Button>
                )}
              </div>
            </>
          ) : (
            <Empty
              icon={Sparkles}
              title="从题目，到知识点的全貌"
              description="完成分析后，在这里审阅结果并导出 Word。"
            />
          )}
        </Section>
      </div>
    </div>
  );
}
