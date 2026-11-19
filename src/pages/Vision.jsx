import React, { useState, useRef } from "react";
import {
  ImagePlus,
  Plus,
  X,
  Sparkles,
  Images,
  Link2,
  Square,
} from "lucide-react";
import { useApp } from "../shared/store";
import { id, validateImages } from "../shared/domain";
import { fileDataURL, services } from "../shared/services";
import {
  PageHeader,
  Button,
  IconButton,
  Field,
  Empty,
  Markdown,
  CopyButton,
  ErrorBox,
  Badge,
  Progress,
} from "../components/UI";
const presets = {
  自由提问: "请根据图片回答我的问题，不确定的部分请明确说明。",
  作业分析:
    "请分析图片中的作业，识别题目、学生解法与错误原因，并给出可操作的教学建议。无法辨认的内容标记待确认。",
  文字提取:
    "请准确提取图片中的文字与数学公式，公式使用 LaTeX。模糊内容标为[待确认]。",
  图表解读:
    "请解读图片中的图表，说明变量、趋势与关键数据，不要猜测不可辨认的数值。",
};
export default function Vision() {
  const { config, run } = useApp();
  const [images, setImages] = useState([]),
    [url, setUrl] = useState(""),
    [task, setTask] = useState("自由提问"),
    [prompt, setPrompt] = useState(presets.自由提问),
    [detail, setDetail] = useState("auto"),
    [result, setResult] = useState(""),
    [model, setModel] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef("");
  const input = useRef();
  const add = (files) =>
    run(async () => {
      const list = [...files];
      validateImages(list, images.length);
      const loaded = await Promise.all(
        list.map(async (f) => ({
          id: id(),
          url: await fileDataURL(f),
          name: f.name,
        })),
      );
      setImages((v) => [...v, ...loaded]);
    });
  const addURL = () =>
    run(async () => {
      const parsed = new URL(url);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[::1\])/.test(
          parsed.hostname,
        ) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(parsed.hostname)
      )
        throw Error("请输入公开 HTTP(S) 图片 URL");
      if (images.length >= 8) throw Error("最多添加 8 张图片");
      setImages((v) => [
        ...v,
        {
          id: id(),
          url: parsed.href,
          name: parsed.pathname.split("/").at(-1) || "网络图片",
        },
      ]);
      setUrl("");
    });
  return (
    <div className="page">
      <PageHeader
        title="视觉实验"
        eyebrow="VISION LAB"
        description="把图片变成教学线索，保留判断与校对的空间。"
      >
        <Badge
          type={
            config.deepseekKey && config.deepseekVisionModel
              ? "success"
              : "warning"
          }
        >
          {config.deepseekVisionModel || "请配置视觉模型"}
        </Badge>
      </PageHeader>
      <div className="vision-layout">
        <section className="card">
          <div className="step-heading">
            <span>01</span>
            <div>
              <h3>图片输入</h3>
              <p>最多 8 张 · 单张不超过 32 MiB</p>
            </div>
          </div>
          <div
            className="upload-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add(e.dataTransfer.files);
            }}
          >
            <ImagePlus size={34} strokeWidth={1.4} />
            <strong>拖入图片，或点击选择</strong>
            <span>JPEG、PNG、GIF、WebP</span>
            <Button onClick={() => input.current.click()}>选择本地图片</Button>
            <input
              hidden
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          <div className="inline-input">
            <input
              aria-label="公开图片 URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… 图片链接"
            />
            <IconButton icon={Plus} label="添加图片链接" onClick={addURL} />
          </div>
          <div className="image-previews">
            {images.map((img) => (
              <div key={img.id}>
                <img src={img.url} alt={img.name} />
                <IconButton
                  icon={X}
                  label="移除图片"
                  onClick={() =>
                    setImages((v) => v.filter((x) => x.id !== img.id))
                  }
                />
                <small>{img.name}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="step-heading">
            <span>02</span>
            <div>
              <h3>分析任务</h3>
              <p>提供清晰的指令，获得更准确的结果</p>
            </div>
          </div>
          <Field label="任务模板">
            <select
              value={task}
              onChange={(e) => {
                setTask(e.target.value);
                setPrompt(presets[e.target.value]);
              }}
            >
              {Object.keys(presets).map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </Field>
          <Field label="提示词">
            <textarea
              rows={12}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </Field>
          <Field label="图片细节">
            <select value={detail} onChange={(e) => setDetail(e.target.value)}>
              <option value="auto">自动</option>
              <option value="low">低</option>
              <option value="high">原图 / 高细节</option>
            </select>
          </Field>
          {error && <ErrorBox message={error} />}
          <div className="button-row">
            <Button
              variant="primary"
              icon={Sparkles}
              disabled={!images.length || !prompt.trim()}
              busy={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                request.current = id();
                try {
                  const r = await services.ai({
                    id: request.current,
                    task: prompt,
                    vision: true,
                    images: images.map((i) => ({ url: i.url, detail })),
                  });
                  setResult(r.text);
                  setModel(r.model);
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              开始分析
            </Button>
            {busy && (
              <Button
                icon={Square}
                onClick={() => services.cancelAI(request.current)}
              >
                取消
              </Button>
            )}
          </div>
        </section>
        <section className="card vision-output">
          <div className="step-heading">
            <span>03</span>
            <div>
              <h3>模型输出</h3>
              <p>{model || "支持 Markdown 与数学公式"}</p>
            </div>
            {result && <CopyButton text={result} />}
          </div>
          {busy ? (
            <Progress stage="正在理解图片" detail="请稍候，可随时取消" />
          ) : result ? (
            <Markdown>{result}</Markdown>
          ) : (
            <Empty
              icon={Images}
              title="让图片里的信息更清晰"
              description="添加图片、选择任务，分析结果会显示在这里。"
            />
          )}
        </section>
      </div>
    </div>
  );
}
