import React from "react";
import { useApp } from "../shared/store";
import { services } from "../shared/services";
import { gradeLabel } from "../shared/exams";
import { Section, FileItem, Empty, ErrorBox, Badge } from "./UI";

export default function ExamCourseFiles({ course }) {
  const { run } = useApp();
  return (
    <>
      <Section
        title="考试讲评"
        subtitle={[
          course.examDate,
          gradeLabel(course.grade),
          course.schoolName,
          course.version,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        <h3>{course.name}</h3>
        <Badge>考试引用</Badge>
        {course.archived && <Badge>已归档考试</Badge>}
        <p className="form-hint">
          与考试管理共用试卷和答案，无需重复上传。课堂反馈可选择本课程，并从试卷正文提取讲评内容。
        </p>
        {course.missing && (
          <ErrorBox message="考试、学科、试卷或考试资料根目录已失效。原引用记录已保留，请到考试管理或配置中心检查。" />
        )}
      </Section>
      {[
        ["paper", "试卷"],
        ["answer", "答案"],
      ].map(([kind, label]) => (
        <Section
          key={kind}
          title={label}
          subtitle={`${course.files.filter((f) => f.kind === kind).length} 份文件`}
        >
          {course.files
            .filter((f) => f.kind === kind)
            .map((file) => (
              <div key={file.id}>
                <FileItem
                  file={file}
                  onOpen={() =>
                    run(async () => {
                      if (file.unavailable)
                        throw Error("文件不在当前考试资料根目录内，请检查配置");
                      await services.open(file.path);
                    })
                  }
                />
                {file.unavailable && (
                  <p className="text-danger">
                    该文件属于旧考试资料目录，请检查配置。
                  </p>
                )}
              </div>
            ))}
          {!course.files.some((f) => f.kind === kind) && (
            <Empty
              title={kind === "answer" ? "暂未上传答案" : "暂无可用试卷"}
              description="可在考试管理中补充文件，课程引用会同步显示。"
            />
          )}
        </Section>
      ))}
    </>
  );
}
