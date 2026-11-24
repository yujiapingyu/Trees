// Chapter facts checked against publisher textbook contents in the configured
// textbook library. No textbook body text or user-specific paths are bundled.
export const CURRICULUM_OUTLINES = [
  {
    stage: "高中",
    volume: "必修第一册",
    names: /必修[一1]|必修第一册/,
    outline:
      "第一章 集合与常用逻辑用语：集合概念、关系、运算，充分与必要条件，全称与存在量词；第二章 一元二次函数、方程和不等式：等式与不等式性质，基本不等式，二次函数与一元二次方程、不等式；第三章 函数的概念与性质：3.1函数概念及表示，3.2基本性质，3.3幂函数，3.4应用（一）；第四章 指数函数与对数函数：4.1指数，4.2指数函数，4.3对数，4.4对数函数，4.5应用（二）；第五章 三角函数：任意角与弧度制、三角函数概念、诱导公式、图象性质、恒等变换、y=Asin(ωx+φ)、应用。",
  },
  {
    stage: "高中",
    volume: "必修第二册",
    names: /必修[二2]|必修第二册/,
    outline:
      "第六章 平面向量及其应用；第七章 复数；第八章 立体几何初步；第九章 统计；第十章 概率。",
  },
  {
    stage: "高中",
    volume: "选择性必修第一册",
    names: /选(?:择性必)?修[一1]|选择性必修第一册/,
    outline:
      "第一章 空间向量与立体几何：1.1空间向量及其运算，1.2空间向量基本定理，1.3坐标表示，1.4应用；第二章 直线和圆的方程：倾斜角与斜率，直线方程，交点与距离，圆方程，直线与圆、圆与圆位置关系；第三章 圆锥曲线的方程：3.1椭圆，3.2双曲线，3.3抛物线。",
  },
  {
    stage: "高中",
    volume: "选择性必修第二册",
    names: /选(?:择性必)?修[二2]|选择性必修第二册/,
    outline:
      "第四章 数列：4.1数列概念，4.2等差数列，4.3等比数列，4.4数学归纳法（选学）；第五章 一元函数的导数及其应用：5.1导数概念及意义，5.2导数运算，5.3导数在研究函数中的应用。",
  },
  {
    stage: "高中",
    volume: "选择性必修第三册",
    names: /选(?:择性必)?修[三3]|选择性必修第三册/,
    outline:
      "第六章 计数原理；第七章 随机变量及其分布；第八章 成对数据的统计分析。",
  },
  {
    stage: "初中",
    volume: "七年级上册",
    names: /7上|七年级上|初一上/,
    outline:
      "第1章 有理数；第2章 有理数的运算；第3章 实数；第4章 代数式；第5章 一元一次方程；第6章 图形的初步知识。",
  },
  {
    stage: "初中",
    volume: "七年级下册",
    names: /7下|七年级下|初一下/,
    outline:
      "第1章 相交线与平行线；第2章 二元一次方程组（含三元一次方程组及其解法）；第3章 整式的乘除；第4章 因式分解；第5章 分式；第6章 数据与统计图表。",
  },
  {
    stage: "初中",
    volume: "八年级上册",
    names: /8上|八年级上|初二上/,
    outline:
      "第1章 三角形；第2章 特殊三角形（含探索勾股定理、直角三角形全等判定）；第3章 一元一次不等式；第4章 图形与坐标；第5章 一次函数。",
  },
  {
    stage: "初中",
    volume: "八年级下册",
    names: /8下|八年级下|初二下/,
    outline:
      "第1章 二次根式：意义、性质、运算；第2章 一元二次方程：方程及解、解法、根与系数关系、应用；第3章 数据分析初步：平均数，中位数与众数，离差平方和与方差，四分位数与箱线图；第4章 平行四边形：多边形、性质、旋转、判定、中位线、反证法；第5章 特殊平行四边形：矩形、菱形、正方形。",
  },
  {
    stage: "初中",
    volume: "九年级上册",
    names: /9上|九年级上|初三上/,
    outline:
      "第1章 二次函数；第2章 随机事件的概率；第3章 圆的基本性质；第4章 相似三角形。",
  },
];
export const fallbackCurriculum = (stage) =>
  CURRICULUM_OUTLINES.filter((v) => v.stage === stage).map(
    ({ volume, outline }) => ({
      name: volume,
      outline,
      source: "内置核对目录（章节摘要）",
    }),
  );
export const fallbackTextbook = (name, stage) =>
  CURRICULUM_OUTLINES.find(
    (v) =>
      v.stage === stage &&
      (!/选/.test(name) || v.volume.startsWith("选择")) &&
      v.names.test(name),
  );
