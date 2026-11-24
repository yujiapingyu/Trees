import React from "react";
import AutomaticCurriculum from "./AutomaticCurriculum";
import ManualCurriculumProgress from "./ManualCurriculumProgress";

export default function CurriculumProgress({ student }) {
  return (
    <>
      <AutomaticCurriculum student={student} />
      <details className="curriculum-outline optional-curriculum-correction">
        <summary>特殊情况修正（可选，无需预先设置）</summary>
        <p className="form-hint">
          自动判断与实际不一致时，可在这里补充学校特殊安排。以前填写的内容仍保留。
        </p>
        <ManualCurriculumProgress student={student} />
      </details>
    </>
  );
}
