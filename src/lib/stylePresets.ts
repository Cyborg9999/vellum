// Style presets for Pass 2 enhancement.
// Source: docs/methodology.md "常用风格预设"
//
// These get written into projects.style_prompt when user clicks a preset
// button in Stage 2. Pass 2 interpolates this into PASS_2_SYSTEM as the
// "三层结构" style block prepended to every shot.

export interface StylePreset {
  id: string;
  label: string;       // short button label
  subtitle: string;    // one-line description shown under label
  scenarios: string;   // when to use this
  prompt: string;      // the actual text injected into Pass 2 system prompt
}

export const PRESET_A_TANG: StylePreset = {
  id: "tang-wuxia",
  label: "唐风武侠",
  subtitle: "街角雨色 · 东方禅意",
  scenarios: "古风、武侠、东方禅意、静态张力、宋画意境、人物对峙",
  prompt: `画面呈现唐风武侠的美学：街角雨幕梅花，宽银幕比例，古寺出檐与山林竹海为背景，光线从侧面投出形成强烈的明暗对比；色调以赭红、墨绿、金黄为主；人物身着改良式古代服饰静止于画面中央形成不对称张力，镜头微角度仰拍；雾气弥漫营造禅意氛围，超清画面粒质感明显；色彩饱和度极高带褪色感。`,
};

export const PRESET_B_MIELGO: StylePreset = {
  id: "mielgo-cyber",
  label: "Mielgo 赛博",
  subtitle: "平行宇宙式 · 末日诗意",
  scenarios: "赛博朋克、未来主义、末日预感、强情绪场面、MV 段落、多元宇宙感",
  prompt: `三渲二电影级风格（3D 模型 + 2D 笔触感的混合渲染），Alberto Mielgo 式强烈的视觉表达，《爱、死亡和机器人》"刮屑感"那种笔触与阴影 + 色块切离的肌理风格；重质感光影，高对比低亮度环境，体积感与雾气倾斜下投影，湿地反射地面霓虹和污染感叠加，不稳定光泡颤抖；肌理高饱和与色像（霓绿 × 洋红 × 橙色对撑），明显色块切离与笔触分离，边缘锐利但局部融化；人物保持写实人体比例，材质真实但表达抽象化，情感强调致空间压迫感，画面带有油画般层次与数字粒细感的融合；整体氛围孤离、带末日诗意与情绪张力，宇宙无言。`,
};

export const STYLE_PRESETS: StylePreset[] = [PRESET_A_TANG, PRESET_B_MIELGO];

/** Find which preset matches a given style_prompt string (by exact text). */
export function matchStylePreset(stylePrompt: string): StylePreset | null {
  const norm = stylePrompt.trim();
  for (const p of STYLE_PRESETS) {
    if (p.prompt.trim() === norm) return p;
  }
  return null;
}
