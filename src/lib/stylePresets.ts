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

/** Default — user's signature stack: 虚幻5引擎 + Blur 顶级 CG + 胡金铨电影色彩与氛围. */
export const PRESET_C_UE5_HUJINQUAN: StylePreset = {
  id: "ue5-hujinquan",
  label: "UE5 + 胡金铨",
  subtitle: "虚幻5顶级CG · 东方电影色彩",
  scenarios: "史诗动作场面、3D 写实、东方电影色调、Blur 工作室质感、神话/武侠/赛博现实主义",
  prompt: `虚幻5引擎实时渲染，Blur 公司顶级 CG 质感，史诗级 3D 写实画面，融入胡金铨电影的凌厉节奏、东方色彩与禅意氛围；重质感光影：真实太阳光与体积云散射，运动模糊只作用于高速边缘，人物脸部、武器、服化道与关键材质保持锐利；色调以东方暖金、墨绿、赭红、烟灰为主，色彩饱和度高但带胶片褪色感；环境带电影粒子感与油画肌理；全程无配乐，只保留环境风声、刀剑碰撞、能量电弧与空气冲击声。`,
};

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

export const PRESET_D_LIVE_ACTION_WASTELAND: StylePreset = {
  id: "live-action-wasteland",
  label: "真人实拍",
  subtitle: "真实演员 · 非CG动画",
  scenarios: "真人电影实拍、真实演员、现场摄影、非CG动画、荒漠废土、生存者美学、动作电影、粗粝皮肤和服化道、真实场景和道具质感",
  prompt: `最高优先级：这是 LIVE-ACTION MOVIE / 真人电影实拍 / 真实演员现场拍摄，不是高品质 CG 动画，不是 3D 渲染短片，不是游戏过场，不是二次元转绘。所有角色必须被转译成真实演员、真人替身、特效化妆、可穿戴实体服装、实体盔甲、真实道具和真实片场置景；所有镜头都必须像真实摄影机拍到的动作电影画面，而不是虚拟摄影机渲染出的 CG 画面。即使参考图带有二次元、CG、游戏或概念设计痕迹，也必须转译成真人片可拍摄的角色造型、服化道、妆发、假体、场景和道具，不允许保留动画感、游戏感、三渲二感、塑料 CG 感或虚拟角色质感。荒漠废土生存者美学，粗粝真实的皮肤与服装材质，毛孔、皱纹、汗渍、尘土、疤痕、晒伤、油污和血痕清晰可见；服化道强调破损皮革、褪色旧布料、金属扣件、绑带、缝线、磨损护具、划痕、锈蚀和重量感，场景强调沙尘、破败建筑、粗糙地表、烟尘、热浪、碎石、废金属、干裂墙面和可触摸的真实空间。低饱和沙土色、铁锈红、暗棕、灰黑和旧金属色调，电影级硬光、侧逆光、强轮廓光、高对比明暗，真实尘雾、烟尘、热浪、镜头呼吸、焦外虚化、手持摄影和胶片颗粒。构图压迫有力量，氛围冷酷、野性、危险、史诗感强，接近真人动作电影质感。必须反复强化：真实演员、真人皮肤、实体服装、实拍置景、现场摄影、实拍动作反馈。必须避免并排除：卡通、二次元、动漫、三渲二、UE5、虚幻引擎、Blur Studio、顶级 3D CG、游戏引擎渲染、动画电影、概念图感、塑料皮肤、过度磨皮、廉价游戏感、过度科幻霓虹、干净崭新服装和不真实材质。`,
};

// Default preset comes first so the user's signature stack is the obvious pick.
export const STYLE_PRESETS: StylePreset[] = [
  PRESET_C_UE5_HUJINQUAN,
  PRESET_D_LIVE_ACTION_WASTELAND,
  PRESET_A_TANG,
  PRESET_B_MIELGO,
];

/** Find which preset matches a given style_prompt string (by exact text). */
export function matchStylePreset(stylePrompt: string): StylePreset | null {
  const norm = stylePrompt.trim();
  for (const p of STYLE_PRESETS) {
    if (p.prompt.trim() === norm) return p;
  }
  if (/真人|实拍|真实演员|现场摄影|电影级写实|废土生存者|非CG|非 CG/i.test(norm)) {
    return PRESET_D_LIVE_ACTION_WASTELAND;
  }
  return null;
}
