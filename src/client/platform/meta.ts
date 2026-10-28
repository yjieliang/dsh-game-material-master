/**
 * 浏览器半区 · 模块表与方向元数据（platform/meta）。
 *
 * 纯数据 + 模块级文案表：方向、页签、音乐引擎/阶段、宿主任务查找。
 * 这些表在 locale 切换时要重建，所以工厂内部提供 rebuildStaticText()。
 */

export function createMeta(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    T
  } = deps;

    // ── 方向元数据（与宿主 src/directions.ts 保持一致）────────────────────
    // 「看不看得见脸」由南北决定——朝北走就是背对镜头，不是抬头。
    function make_DIRECTIONS() {
      return [
      { key: "front", compass: "S", label: T("南 · 正对镜头"), refs: [T("源图")] },
      { key: "back", compass: "N", label: T("北 · 背对镜头"), refs: [T("南")] },
      { key: "downLeft", compass: "SW", label: T("西南 · 四分之三正面"), refs: [T("南")] },
      { key: "downRight", compass: "SE", label: T("东南 · 四分之三正面"), refs: [T("南")] },
      { key: "upLeft", compass: "NW", label: T("西北 · 四分之三背面"), refs: [T("北")] },
      { key: "upRight", compass: "NE", label: T("东北 · 四分之三背面"), refs: [T("北")] },
      { key: "left", compass: "W", label: T("西 · 左侧脸"), refs: [T("南"), T("北")] },
      { key: "right", compass: "E", label: T("东 · 右侧脸"), refs: [T("南"), T("北")] }
    ];
    }

    let DIRECTIONS = make_DIRECTIONS();

    const DIRECTION_KEYS = DIRECTIONS.map((d) => d.key);

    function make_LABEL_OF() {
      return Object.fromEntries(DIRECTIONS.map((d) => [d.key, d.label]));
    }

    let LABEL_OF = make_LABEL_OF();

    const COMPASS_OF = Object.fromEntries(DIRECTIONS.map((d) => [d.key, d.compass]));

    /** 屏幕位移向量 → 方向 key。dy > 0 是往画面下方走（向南）。 */
    function directionKeyFor(dx, dy) {
      if (dx === 0 && dy === 0) return null;
      if (dy > 0) return dx > 0 ? "downRight" : dx < 0 ? "downLeft" : "front";
      if (dy < 0) return dx > 0 ? "upRight" : dx < 0 ? "upLeft" : "back";
      return dx > 0 ? "right" : "left";
    }

    /** WASD 与方向键统一成四个布尔轴。 */
    const KEY_AXIS = {
      w: "up",
      arrowup: "up",
      s: "down",
      arrowdown: "down",
      a: "left",
      arrowleft: "left",
      d: "right",
      arrowright: "right"
    };

    function hostJob(project, taskKey) {
      const list = Array.isArray(project?.jobs) ? project.jobs : [];
      return list.find((job) => job !== null && typeof job === "object" && job.key === taskKey);
    }

    function jobCovers(job, key) {
      return job !== undefined && Array.isArray(job.targets) && job.targets.includes(key);
    }

    /** 六个功能模块。插件是「大师」，每个模块管一类素材。 */
    function make_MODULES() {
      return [
      { key: "sprite", title: T("动画帧工具盒"), hint: T("一张设定图 → 8 方向 × 8 帧精灵图") },
      { key: "image", title: T("图片生成"), hint: T("按提示词出图，可带参考图，支持抠绿幕导出 PNG") },
      { key: "sequence", title: T("序列帧生成"), hint: T("图/视频参考生成视频 → 抽帧 → 抠像 → 合成与播放预览") },
      { key: "rig", title: T("骨骼动画生成"), hint: T("拆件 → 装配定位 → 推骨骼与动画 → 打包 Spine 图集"), experimental: true },
      { key: "iso", title: T("45°地图编辑器"), hint: T("导入菱形地块 → 自动连接 → 画 45° 等距地图 → 导出 PNG") },
      { key: "map", title: T("俯视地图编辑器"), hint: T("导入自己的素材图 → 自动连接 → 俯视画布上直接画 → 导出 PNG") },
      { key: "music", title: T("音乐生成编辑"), hint: T("灵感/歌词 → 对话里生成 → 回界面裁剪、调音量、淡入淡出与导出") },
      { key: "sfx", title: T("音效生成"), hint: T("一句话描述 → 音效 / 环境音 / 角色配音（火山引擎 Seed-Audio）") }
    ];
    }

    let MODULES = make_MODULES();

    function make_STAGES() {
      return [
      { key: "images", title: T("① 八方向绿幕图"), hint: T("以源图为基准，按依赖顺序生成八个方位的纯绿幕全身图") },
      { key: "videos", title: T("② 行走动作视频"), hint: T("固定镜头、固定背景，让角色朝原方位原地走三步") },
      { key: "frames", title: T("③ 提取序列帧"), hint: T("可整批等分抽帧，也可对每一段视频手动选帧") },
      { key: "sheet", title: T("④ 抠绿幕合成整图"), hint: T("剔除绿幕并按行序拼成一张精灵图") },
      { key: "preview", title: T("⑤ 行走预览"), hint: T("用 WASD 或方向键操控角色，看看八方向接起来顺不顺") }
    ];
    }

    let STAGES = make_STAGES();

    // ── 音乐生成编辑（模块七）────────────────────────────────────────────
    //
    // 引擎/模型表在这里也有一份：浏览器半区是经典脚本，不能 import 宿主模块。
    // 真源是宿主 `src/musicmodels.ts`；自检按 id 比对，防止两边漂移。
    function make_MUSIC_ENGINES() {
      return [
        {
          id: "suno",
          label: T("Suno"),
          hint: T("v6 系列：可只给灵感，也可给完整歌词与风格标签；每次提交返回 2 首"),
          models: [
            { id: "chirp-v6", label: T("chirp-v6（默认 · 完成度最好）") },
            { id: "chirp-v6-wild", label: T("chirp-v6-wild（探索 · 更有个性、更不可控）") },
            { id: "chirp-v6-mini", label: T("chirp-v6-mini（更快更省 · 草稿）") }
          ]
        },
        {
          id: "mureka",
          label: T("Mureka"),
          hint: T("另一个音乐模型家族；纯音乐可直接用 instrumental 端点，每次可出 1–3 首"),
          models: [
            { id: "mureka-9.5", label: "mureka-9.5" },
            { id: "mureka-9", label: "mureka-9" },
            { id: "mureka-8", label: "mureka-8" },
            { id: "mureka-7.6", label: "mureka-7.6" },
            { id: "mureka-o2", label: "mureka-o2" },
            { id: "auto", label: "auto" }
          ]
        },
        {
          id: "minimax",
          label: T("MiniMax"),
          hint: T("音乐 3.0：需要提示词与歌词（纯音乐可只给提示词），可指定采样率/码率"),
          models: [
            { id: "music-3.0", label: "music-3.0" },
            { id: "music-2.6", label: "music-2.6" }
          ]
        },
        {
          id: "aceStep",
          label: T("ACE-Step"),
          hint: T("可明确指定 BPM / 调式 / 拍号与演唱语言；适合游戏循环与纯音乐"),
          models: [{ id: "v15-turbo", label: "v15-turbo" }]
        }
      ];
    }

    let MUSIC_ENGINES = make_MUSIC_ENGINES();

    function make_MUSIC_PHASES() {
      return [
        { key: "generate", title: T("① 生成歌曲"), hint: T("在对话里扩写提示词、选引擎/模式并提交；按谱乐 AI 积分计费") },
        { key: "edit", title: T("② 编辑"), hint: T("裁剪 / 音量 / 淡入淡出 / 标准化；全部本机 ffmpeg，免费") },
        { key: "export", title: T("③ 导出"), hint: T("保存版本并导出 MP3 / WAV / M4A，多产物自动打 zip") }
      ];
    }

    let MUSIC_PHASES = make_MUSIC_PHASES();

    const MUSIC_FORMATS = ["mp3", "wav", "m4a"];

    const MUSIC_EDIT_LIMITS = { gainDb: 24, fade: 30 };

    function musicEngineOf(key) {
      return MUSIC_ENGINES.find((entry) => entry.id === key) ?? MUSIC_ENGINES[0];
    }

  /**
   * 原地换掉一张表的全部元素。
   *
   * ⚠️ 这些表在工厂创建时就被各层按值抓走：`hidden.ts` 抓 `MODULES`、`studio-panel.ts`
   * 抓 `STAGES`、`config-section.ts` 抓 `MODULES`、`bootstrap.ts` 抓一大堆 —— 语言切换后
   * 它们**不会**回来重新取一次引用。所以重算时只能改内容、不能改引用（`X = 新数组`
   * 只有内部变量变、外面全是旧的）：P7b 拆分后「切英文页签还是中文」就是这么坏的。
   * 拆分前这些表都在同一个作用域里是 `let`，原地改等价于当时的语义。
   */
  function replaceArray(target: any[], next: any[]): void {
    target.length = 0;
    target.push(...next);
  }

  /** 对象型表（目前只有 `LABEL_OF`）同理：清键再赋，保住对象身份。 */
  function replaceObject(target: Record<string, any>, next: Record<string, any>): void {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, next);
  }

  /** 重算本模块的模块级文案表（locale 切换时调用）。 */
  function rebuildStaticText(): void {
    replaceArray(DIRECTIONS, make_DIRECTIONS());
    replaceObject(LABEL_OF, make_LABEL_OF());
    replaceArray(MODULES, make_MODULES());
    replaceArray(STAGES, make_STAGES());
    replaceArray(MUSIC_ENGINES, make_MUSIC_ENGINES());
    replaceArray(MUSIC_PHASES, make_MUSIC_PHASES());
  }

  return {
    rebuildStaticText,
    make_DIRECTIONS, DIRECTIONS, DIRECTION_KEYS, make_LABEL_OF, LABEL_OF, COMPASS_OF, directionKeyFor, KEY_AXIS, hostJob, jobCovers, make_MODULES, MODULES, make_STAGES, STAGES, make_MUSIC_ENGINES, MUSIC_ENGINES, make_MUSIC_PHASES, MUSIC_PHASES, MUSIC_FORMATS, MUSIC_EDIT_LIMITS, musicEngineOf
  };
}
