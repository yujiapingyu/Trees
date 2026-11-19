import React, { useEffect, useRef, useState } from "react";
import { Mic, Square, X, RotateCcw, FolderOpen } from "lucide-react";
import { useApp } from "../shared/store";
import { services, join, toBase64 } from "../shared/services";
import { id, today, recordingTransition } from "../shared/domain";
import { Button, ErrorBox, Progress, Editor } from "./UI";
export default function Recording({ student, kind = "followup", onDraft }) {
  const { config, run } = useApp();
  const [state, setState] = useState("idle"),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState(""),
    [transcript, setTranscript] = useState(""),
    [audio, setAudio] = useState("");
  const rec = useRef(),
    stream = useRef(),
    timer = useRef(),
    alive = useRef(true),
    cancelled = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelled.current = true;
      if (rec.current?.state === "recording") rec.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      clearInterval(timer.current);
    };
  }, []);
  const next = (event) => setState((s) => recordingTransition(s, event));
  const processAudio = async (path) => {
    try {
      setError("");
      setState("transcribing");
      const result = await services.transcribe(path);
      if (!alive.current) return;
      setTranscript(result.text);
      setState("summarizing");
      const generated = await services.ai({
        id: id(),
        task: `将以下${kind === "class" ? "授课" : "回访"}录音转写整理成可编辑的${kind === "class" ? "家长课堂反馈" : "回访纪要（沟通内容、家长反馈、解决方案、后续安排）"}。只依据转写，不编造。学生：${student.name}\n${result.text}`,
      });
      if (!alive.current) return;
      onDraft(generated.text, {
        audioPath: path,
        transcriptPath: result.path,
        transcript: result.text,
      });
      setState("done");
    } catch (e) {
      if (alive.current) {
        setError(e.message);
        setState("error");
      }
    }
  };
  const start = async () => {
    setError("");
    try {
      const root =
        kind === "class" ? config.classAudioRoot : config.followupAudioRoot;
      if (!root)
        throw Error(
          "请先配置" + (kind === "class" ? "课堂" : "回访") + "录音目录",
        );
      if (!window.services) throw Error("录音保存与转写需要桌面版");
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      cancelled.current = false;
      const chunks = [];
      const recorder = new MediaRecorder(stream.current);
      rec.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
        if (cancelled.current || !alive.current) return;
        setState("saving");
        try {
          const ext = recorder.mimeType.includes("mp4") ? "m4a" : "webm";
          const path = join(
            root,
            `${today()}_${student.name}_${id().slice(0, 8)}.${ext}`,
          );
          const blob = new Blob(chunks, { type: recorder.mimeType });
          await services.writeBytes(
            path,
            toBase64(new Uint8Array(await blob.arrayBuffer())),
          );
          if (!alive.current) return;
          setAudio(path);
          await processAudio(path);
        } catch (e) {
          if (alive.current) {
            setError(e.message);
            setState("error");
          }
        }
      };
      recorder.start(1000);
      setSeconds(0);
      setState("recording");
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(e.message);
      setState("error");
    }
  };
  const active = state === "recording";
  return (
    <div className="recording">
      <div className="recording-top">
        <span>
          <Mic size={16} />
          录音 → 本地转写 → AI 草稿
        </span>
        {active ? (
          <>
            <b className="record-time">
              ●{" "}
              {Math.floor(seconds / 60)
                .toString()
                .padStart(2, "0")}
              :{(seconds % 60).toString().padStart(2, "0")}
            </b>
            <Button
              icon={Square}
              variant="danger"
              onClick={() => rec.current.stop()}
            >
              结束录音
            </Button>
            <Button
              icon={X}
              onClick={() => {
                cancelled.current = true;
                rec.current.stop();
                setState("idle");
              }}
            >
              取消
            </Button>
          </>
        ) : (
          <Button
            icon={Mic}
            disabled={
              student.status === "已停课" ||
              ["saving", "transcribing", "summarizing"].includes(state)
            }
            onClick={start}
          >
            {kind === "class" ? "开始授课" : "开始录音"}
          </Button>
        )}
      </div>
      {["saving", "transcribing", "summarizing"].includes(state) && (
        <Progress
          stage={
            {
              saving: "保存音频",
              transcribing: "Whisper 本地转写",
              summarizing: "AI 整理草稿",
            }[state]
          }
        />
      )}
      {error && <ErrorBox message={error} />}
      {audio && (
        <div className="button-row">
          <Button
            icon={RotateCcw}
            disabled={
              active ||
              ["saving", "transcribing", "summarizing"].includes(state)
            }
            onClick={() => processAudio(audio)}
          >
            重试转写与整理
          </Button>
          <Button
            icon={FolderOpen}
            onClick={() =>
              run(() => services.open(audio.split("/").slice(0, -1).join("/")))
            }
          >
            结果目录
          </Button>
        </div>
      )}
      {transcript && (
        <details>
          <summary>查看录音转写</summary>
          <Editor value={transcript} onChange={setTranscript} />
        </details>
      )}
    </div>
  );
}
