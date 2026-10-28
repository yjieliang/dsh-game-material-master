/**
 * ConfigSection：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 */
export interface ConfigRuntime {
  React: any;
  h: any;
  T: any;
  useLocaleTick: any;
  MODULES: any;
  MUSIC_ENGINES: any;
  normalizeHiddenKeys: any;
  publishHiddenModules: any;
  msg: any;
  Btn: any;
  NumField: any;
  BusyBtn: any;
  sfxFormatLabel: any;
}

export function createConfigSection(rt: ConfigRuntime) {
  const { React, h, T, useLocaleTick, MODULES, MUSIC_ENGINES, normalizeHiddenKeys, publishHiddenModules, msg, Btn, NumField, BusyBtn, sfxFormatLabel } = rt;

function ConfigSection(props) {
  useLocaleTick();
  const api = props?.api;
  const [config, setConfig] = React.useState(null);
  const [arkKey, setArkKey] = React.useState("");
  const [customKey, setCustomKey] = React.useState("");
  const [toapisKey, setToapisKey] = React.useState("");
  const [minimaxKey, setMinimaxKey] = React.useState("");
  const [notice, setNotice] = React.useState(null);
  const [testing, setTesting] = React.useState(null);
  /**
   * ComfyUI 工作流草稿。
   *
   * ⚠️ 不能像别的文本框那样「每敲一个字就 patch 一次」：一份工作流 JSON 几 KB，
   * 每个字符都往返一次会明显卡；而且中途的**非法 JSON** 存进去之后，
   * 下一次生成要在几十秒后才报错。所以用本地草稿，失焦 / 点保存才提交。
   */
  const [workflowDraft, setWorkflowDraft] = React.useState(null);
  // 本地 ComfyUI 视频后端的工作流 JSON 也很长，逐键 patch 会每敲一个字存一次配置；
  // 这里同样留成草稿（null = 跟随配置），点「保存工作流」才提交。
  const [comfyWorkflowDraft, setComfyWorkflowDraft] = React.useState(null);
  const [comfyProbe, setComfyProbe] = React.useState(null);
  // Cookie 也是凭据：已配置时输入框留空 = 不修改，点「保存 Cookie」才覆盖。
  const [comfyCookie, setComfyCookie] = React.useState("");
  // 谱乐 AI 的 Key 同样：留空 = 不修改，点「保存 Key」才覆盖。
  const [musicKey, setMusicKey] = React.useState("");
  /**
   * 谱曲依赖路径草稿：逐键 patch 会在每次心跳里 spawn 一次 Python/FluidSynth
   * 探测，所以留成草稿，失焦才保存。
   */
  const [scorePaths, setScorePaths] = React.useState(null);
  /** 音效模块的语音 API Key（单独一份，不是方舟 Key）。 */
  const [sfxKey, setSfxKey] = React.useState("");
  /**
   * 工作流库的导入草稿与自检结果。
   *
   * 合成**一个** state：JSON 草稿动辄几 KB，逐键 patch 会每个字符往返一次；
   * 自检结果也只是这块卡片的临时数据，没必要拆成三个 state（Hook 槽位越少越好）。
   */
  const [workflowImport, setWorkflowImport] = React.useState(null);
  const importState = workflowImport ?? { json: "", name: "", kind: "generate", test: null };
  /**
   * 素材互操作：本机路径导入 / ComfyUI 工作流文件导入。
   *
   * 放在设置页的原因：路径由**宿主**读盘（不经过浏览器 base64），输入框就是「本机绝对路径」；
   * 工作流文件也在这里解析（API / 界面两种格式，能连 ComfyUI 时按 /object_info 精确转换）。
   * 新 Hook 追加在最后：前面 Hook 的槽位顺序保持不变（verify-feedback 按槽位喂桩）。
   */
  const [importTarget, setImportTarget] = React.useState("project-source");
  const [importPath, setImportPath] = React.useState("");
  const [importProjectId, setImportProjectId] = React.useState("");
  const [importJobId, setImportJobId] = React.useState("");
  const [importKey, setImportKey] = React.useState("turn");
  const [importKind, setImportKind] = React.useState("referenceImage");
  const [importNotice, setImportNotice] = React.useState(null);
  const [importBusy, setImportBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    if (api === undefined) return;
    try {
      const next = await api.getConfig();
      setConfig(next);
      // 可见性是全插件共享的状态（侧栏菜单 / 工作台页签都订阅它），
      // 每次读到配置就广播一次——包括保存后的重读。
      publishHiddenModules(next?.hiddenModules);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    }
  }, [api]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (config === null) return;
    setScorePaths({
      python: config.musicPythonPath ?? "",
      fluidsynth: config.musicFluidsynthPath ?? "",
      soundfont: config.musicSoundfontPath ?? ""
    });
  }, [config?.musicPythonPath, config?.musicFluidsynthPath, config?.musicSoundfontPath]);

  const run = async (fn, successText) => {
    if (api === undefined) return;
    try {
      const value = await fn();
      setNotice({ kind: "ok", text: typeof successText === "function" ? successText(value) : successText });
      await load();
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    }
  };

  if (api === undefined || config === null) {
    return h("section", { className: "SPR_settings" }, h("p", { className: "SPR_hint" }, T("正在载入配置…")));
  }

  const patch = (values) => run(() => api.saveConfig(values), T("配置已保存"));

  /** 素材互操作：本机路径导入（图片 / 视频 / 目录批量；宿主读盘，零计费）。 */
  const runPathImport = async () => {
    if (api === undefined) return;
    const path = importPath.trim();
    if (path === "") {
      setImportNotice({ kind: "error", text: T("请先填写本机绝对路径") });
      return;
    }
    const needsProject = importTarget === "project-source" || importTarget === "project-video";
    try {
      setImportBusy(true);
      const result = await api.importLocalPath({
        target: importTarget,
        path,
        projectId: needsProject ? importProjectId.trim() : undefined,
        jobId: needsProject ? undefined : importJobId.trim(),
        key: importTarget === "project-video" ? importKey : undefined,
        kind: importTarget === "sequence-ref" ? importKind : undefined
      });
      const imported = Array.isArray(result?.imported) ? result.imported : [];
      const skipped = Array.isArray(result?.skipped) ? result.skipped : [];
      const skippedText =
        skipped.length === 0
          ? ""
          : T("；跳过 {n0} 个：{n1}", {
              n0: skipped.length,
              n1: skipped
                .slice(0, 3)
                .map((item) => item.reason)
                .join("；")
            });
      setImportNotice({ kind: skipped.length === 0 ? "ok" : "warn", text: T("已导入 {n0} 个文件", { n0: imported.length }) + skippedText });
    } catch (error) {
      setImportNotice({ kind: "error", text: msg(error) });
    } finally {
      setImportBusy(false);
    }
  };
  /** 素材互操作：解析 ComfyUI 工作流文件（只读 + 校验，免费；缺节点/缺绑定会逐条列出）。 */
  const runWorkflowImport = async () => {
    if (api === undefined) return;
    const path = importPath.trim();
    if (path === "") {
      setImportNotice({ kind: "error", text: T("请先填写本机绝对路径") });
      return;
    }
    try {
      setImportBusy(true);
      const result = await api.importWorkflowFile({ path });
      const workflow = result?.workflow ?? {};
      const bindings = workflow.bindings ?? {};
      const lines = [
        T("已解析「{n0}」：{n1} 个节点（{n2} 格式）", { n0: workflow.name ?? "", n1: workflow.nodeCount ?? 0, n2: workflow.protocol ?? "?" }),
        T("提示词绑定：{n0}；图像输入：{n1}；种子：{n2}", {
          n0: bindings.prompt ?? T("未识别"),
          n1: bindings.image ?? T("无"),
          n2: bindings.seed ?? T("未识别")
        })
      ];
      if (Array.isArray(workflow.requiredModels) && workflow.requiredModels.length > 0) {
        lines.push(T("模型：{n0}", { n0: workflow.requiredModels.join("、") }));
      }
      if (Array.isArray(workflow.unknownNodes) && workflow.unknownNodes.length > 0) {
        lines.push(T("缺节点：{n0}", { n0: workflow.unknownNodes.map((item) => `#${item.node} ${item.classType}`).join("、") }));
      }
      for (const warning of Array.isArray(workflow.warnings) ? workflow.warnings : []) lines.push("· " + warning);
      const hasProblem = Array.isArray(workflow.unknownNodes) && workflow.unknownNodes.length > 0;
      setImportNotice({ kind: hasProblem ? "warn" : "ok", text: lines.join("\n") });
    } catch (error) {
      setImportNotice({ kind: "error", text: msg(error) });
    } finally {
      setImportBusy(false);
    }
  };

  /** 工作流目录与后端状态（跟着 getConfig 一起回，见宿主 decorateConfig）。 */
  const workflowsList = Array.isArray(config.workflows) ? config.workflows : [];
  const imageBackend = config.imageBackend ?? null;
  const installedWorkflows = workflowsList.filter((item) => item.hasWorkflow === true);
  /** 自检结果拼成一块可读文本（成功 / 缺节点 / 缺模型 / 缺绑定 / 真出图）。 */
  const formatWorkflowTest = (result) => {
    if (result === null || result === undefined) return "";
    const lines = [];
    lines.push(result.ok === true ? T("自检通过") : T("自检未通过"));
    if (result.name) lines.push(T("工作流：{n0}", { n0: result.name }));
    if (result.service?.version) lines.push(T("ComfyUI 版本 {n0}", { n0: result.service.version }));
    if (result.error) lines.push(T("错误：{n0}", { n0: result.error }));
    if (Array.isArray(result.missingNodeTypes) && result.missingNodeTypes.length > 0) lines.push(T("缺节点：{n0}", { n0: result.missingNodeTypes.join("、") }));
    if (Array.isArray(result.missingModels) && result.missingModels.length > 0) lines.push(T("缺模型：{n0}", { n0: result.missingModels.join("、") }));
    if (Array.isArray(result.missing) && result.missing.length > 0) lines.push(T("缺关键绑定：{n0}", { n0: result.missing.join("、") }));
    if (result.bindings !== undefined && result.bindings !== null) {
      const entries = Object.entries(result.bindings).map(([key, value]) => key + " → " + value);
      if (entries.length > 0) lines.push(T("识别到的绑定：{n0}", { n0: entries.join(" · ") }));
    }
    if (result.generated?.bytes > 0) lines.push(T("真出图：{n0} 字节 / {n1} 毫秒", { n0: result.generated.bytes, n1: result.generated.elapsedMs }));
    return lines.join("\n");
  };

  /**
   * 功能管理：`hiddenModules` 的当前值（以宿主返回的为准）。
   *
   * 勾选立刻**乐观广播**一次，再落盘——工作台页签与侧栏菜单是另一个组件，
   * 等一个来回才变的话，用户会看到「勾了但菜单里还在」。
   */
  const hiddenNow = normalizeHiddenKeys(config.hiddenModules);
  const toggleFeature = (key, visible) => {
    const next = MODULES.map((entry) => entry.key).filter((item) => (item === key ? !visible : hiddenNow.includes(item)));
    publishHiddenModules(next);
    void patch({ hiddenModules: next });
  };

  // 模型能力决定分辨率档位与时长控件形态；切换模型后宿主会重新收敛，
  // 这里始终以「当前模型」的能力为准，避免下拉里出现非法档位。
  const minimaxCaps = config.minimaxCapabilitiesByModel?.[config.minimaxModel] ??
    config.minimaxCapabilities ?? {
      protocol: "v2",
      resolutions: ["2K", "768P"],
      durationMin: 4,
      durationMax: 15,
      note: ""
    };

  // 模型决定网关：选中「优云智算版 H3」时顺带把 Base URL 切到它的网关；
  // 从该模型切走时，若 Base URL 还停在优云智算网关，则还原成官方默认地址。
  const compshareModelId = config.minimaxCompshareModelId;
  const compshareBaseUrl = config.minimaxCompshareBaseUrl;
  const onModelChange = (nextModel) => {
    const values: Record<string, unknown> = { minimaxModel: nextModel };
    if (compshareModelId !== undefined && nextModel === compshareModelId) {
      values.minimaxBaseUrl = compshareBaseUrl;
    } else if (config.minimaxModel === compshareModelId && config.minimaxBaseUrl === compshareBaseUrl) {
      values.minimaxBaseUrl = config.defaults?.minimaxBaseUrl ?? "https://api.minimaxi.com";
    }
    void patch(values);
  };
  const usingCompshare = compshareModelId !== undefined && config.minimaxModel === compshareModelId;

  /**
   * 生图后端。`ark` 与 `custom` 互斥，两组配置同时保留、只由这个开关决定用哪一组
   * —— 来回切不会丢任何一边的 Key 和参数。
   */
  const imageProvider = config.imageProvider === "toapis" ? "toapis" : config.imageProvider === "custom" ? "custom" : "ark";
  const protocols = config.customProtocols ?? [];
  const protocolInfo = protocols.find((entry) => entry.id === config.customProtocol);
  const customProtocol = config.customProtocol ?? "openai";
  const workflowNow = workflowDraft === null ? config.customWorkflow ?? "" : workflowDraft;
  const workflowDirty = workflowDraft !== null && workflowDraft !== (config.customWorkflow ?? "");
  /**
   * 切换协议时顺手换地址：只有当**当前地址还停在另一个协议的默认值**时才换，
   * 手动改过的地址一律不动（与 MiniMax 切「优云智算版」同一套判断）。
   * 不这么做的话，用户从 OpenAI 切到 ComfyUI 会得到一个指向 api.openai.com 的
   * ComfyUI 配置 —— 点测试才报「连不上」，中间没有任何提示。
   */
  const onProtocolChange = (nextProtocol) => {
    const values: Record<string, unknown> = { customProtocol: nextProtocol };
    const knownDefaults = protocols.map((entry) => entry.baseUrl);
    const target = protocols.find((entry) => entry.id === nextProtocol);
    if (target !== undefined && (config.customBaseUrl === "" || knownDefaults.includes(config.customBaseUrl))) {
      values.customBaseUrl = target.baseUrl;
    }
    void patch(values);
  };

  /**
   * 分组标题（原生 `<details>` 的 summary）。
   *
   * 折叠用浏览器原生元素：不新增 Hook、不新增 addEventListener，
   * 也就不会动 verify-arch 的监听器棘轮与 verify-feedback 的 Hook 槽位。
   */
  const groupHead = (title, subtitle = null, badge = null) =>
    h(
      "summary",
      { className: "SPR_groupHead" },
      h("span", { className: "SPR_groupTitle" }, title, badge ? h("span", { className: "SPR_badge" }, badge) : null),
      subtitle ? h("span", { className: "SPR_groupSub" }, subtitle) : null
    );

  /** 顶部「检查环境」：只跑免费项；付费「测试连接」仍留在各自分组里。 */
  const checkEnvironment = async () => {
    if (testing !== null) return;
    setTesting("env");
    const lines = [];
    let problems = 0;
    const mark = (ok, text) => {
      lines.push((ok ? "✓ " : "✗ ") + text);
      if (!ok) problems += 1;
    };
    if (config.ffmpeg?.ok === true) mark(true, T("ffmpeg 可用：{n0}", { n0: config.ffmpeg.version }));
    else mark(false, T("ffmpeg 不可用：{n0}", { n0: config.ffmpeg?.error ?? T("未知") }));
    try {
      const probe = await api.testComfy();
      setComfyProbe(probe);
      mark(true, T("ComfyUI 可用：{n0}", { n0: probe.version }));
    } catch (error) {
      setComfyProbe(null);
      mark(false, T("ComfyUI 不可用：{n0}", { n0: msg(error) }));
    }
    if (config.minimaxApiKeySet === true) {
      try { await api.testMinimax(); mark(true, T("MiniMax 连接正常")); } catch (error) { mark(false, T("MiniMax 连接失败：{n0}", { n0: msg(error) })); }
    } else mark(false, T("MiniMax 未配置 Key"));
    if (config.musicApiKeySet === true) {
      try { await api.testMusic(); mark(true, T("音乐 API 连接正常")); } catch (error) { mark(false, T("音乐 API 连接失败：{n0}", { n0: msg(error) })); }
    } else mark(false, T("音乐 API 未配置 Key"));
    try {
      const score = await api.testMusicScore();
      mark(score?.ok === true, score?.ok === true ? T("谱曲依赖已就绪") : score?.blocker ?? T("谱曲依赖缺失"));
    } catch (error) {
      mark(false, T("谱曲依赖检测失败：{n0}", { n0: msg(error) }));
    }
    lines.push(T("付费项目（方舟 / 自定义 / ToAPIs / 音效）请在各自分组里点「测试连接」。"));
    setNotice({ kind: problems === 0 ? "ok" : "error", text: lines.join("\n") });
    setTesting(null);
  };

  return h(
    "section",
    { className: "SPR_settings" },
    h("h2", { style: { margin: 0, fontSize: 15 } }, T("墨盒")),
    h("p", { className: "SPR_hint" }, T("配置生图 / 生视频的模型与整条流水线的默认参数。Key 只保存在本机 DSH 数据目录下的 inkbox/config.json（真实路径见文末「数据位置」），界面里始终脱敏显示。")),

    /**
     * 顶部状态条：当前生效的后端与能否开跑，一眼可见；环境检查集中在这里，
     * 不再把 ffmpeg 这类全局警告塞进某一张卡片里。
     */
    h(
      "div",
      { className: "SPR_statusBar", "data-testid": "cfg-status-bar" },
      h(
        "div",
        { className: "SPR_statusMain" },
        h("span", { className: "SPR_statusTitle" }, T("当前生图后端")),
        h("span", { className: "SPR_statusValue" }, config.imageProviderSummary ?? ""),
        h(
          "span",
          { className: "SPR_statusRow" },
          config.imageProviderBlocker
            ? h("span", { className: "SPR_statusTag", "data-kind": "bad" }, T("还不能开跑"))
            : h("span", { className: "SPR_statusTag", "data-kind": "ok" }, T("后端已就绪")),
          h("span", { className: "SPR_statusHint" }, config.ffmpeg?.ok === true ? T("ffmpeg 可用：{n0}", { n0: config.ffmpeg.version }) : T("ffmpeg 不可用：{n0}", { n0: config.ffmpeg?.error ?? T("未知") }))
        ),
        config.imageProviderBlocker ? h("span", { className: "SPR_statusHint", "data-kind": "bad" }, config.imageProviderBlocker) : null
      ),
      h(
        BusyBtn,
        { busy: testing === "env", busyText: T("正在检查…"), disabled: testing !== null, onClick: () => void checkEnvironment() },
        T("检查环境")
      )
    ),

    notice !== null
      ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text)
      : null,

    h(
      "details",
      { className: "SPR_settingsGroup", open: true },
      groupHead(T("生图后端"), config.imageProviderBlocker ? T("未就绪") : T("就绪")),
      h("p", null, T("八方向图、图片生成、骨骼动画的生图都走这里选的后端；图生视频（MiniMax）不受影响。")),
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("当前使用")),
          h(
            "select",
            {
              className: "SPR_input",
              "data-testid": "cfg-image-provider",
              value: imageProvider,
              onChange: (event) => void patch({ imageProvider: event.target.value })
            },
            h("option", { value: "ark" }, T("火山方舟 Seedream（云端，开箱即用）")),
            h("option", { value: "toapis" }, "ToAPIs"),
            h("option", { value: "custom" }, T("自定义生图模型（OpenAI / ComfyUI / SD WebUI）")),
            h("option", { value: "comfy" }, T("本地 ComfyUI · 工作流库（本机免费）"))
          )
        )
      ),
      h("p", { className: "SPR_hint" }, T("当前生效：{n0}", { n0: config.imageProviderSummary ?? "" }))
    ),

    h(
      "details",
      { className: "SPR_settingsGroup", open: imageProvider === "ark" },
      groupHead(T("火山方舟（生图）"), config.arkApiKeySet ? T("Key 已配置") : T("Key 未配置"), imageProvider === "ark" ? T("当前使用") : null),
      h(
        "div",
        { className: "SPR_keyRow" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("API Key {n0}", { n0: config.arkApiKeySet ? T("（已配置 {n0}）", { n0: config.arkApiKeyHint }) : T("（未配置）") })),
          h("input", {
            className: "SPR_input",
            type: "password",
            placeholder: config.arkApiKeySet ? T("留空表示不修改") : T("粘贴 ARK_API_KEY"),
            value: arkKey,
            onChange: (event) => setArkKey(event.target.value)
          })
        ),
        h(Btn, { onClick: () => run(async () => { await api.saveConfig({ arkApiKey: arkKey }); setArkKey(""); }, T("火山方舟 Key 已保存")) }, T("保存 Key")),
        h(Btn, { disabled: !config.arkApiKeySet, onClick: () => run(() => api.saveConfig({ clearArkApiKey: true }), T("已清除火山方舟 Key")) }, T("清除"))
      ),
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("生图模型")),
          h(
            "select",
            {
              className: "SPR_input",
              value: config.arkModel,
              onChange: (event) => void patch({ arkModel: event.target.value })
            },
            (config.arkModels ?? []).map((model) =>
              h("option", { key: model.id, value: model.id }, T("{n0}（{n1}）", { n0: model.label, n1: model.id }))
            ),
            (config.arkModels ?? []).some((model) => model.id === config.arkModel)
              ? null
              : h("option", { value: config.arkModel }, T("自定义：{n0}", { n0: config.arkModel }))
          )
        ),
        /**
         * 部件重绘单独一个模型。
         *
         * 拆件与重绘对模型的要求不同：前者是「按提示词画一整张摊平图」，
         * 后者是「原地改这一小块、保持轮廓」。默认跟随主模型，
         * 需要时在这里单独指定。
         */
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("部件重绘模型")),
          h(
            "select",
            {
              className: "SPR_input",
              "data-testid": "cfg-redraw-model",
              value: config.arkRedrawModel ?? "",
              onChange: (event) => void patch({ arkRedrawModel: event.target.value })
            },
            h("option", { value: "" }, T("跟生图模型相同")),
            (config.arkModels ?? []).map((model) =>
              h("option", { key: model.id, value: model.id }, T("{n0}（{n1}）", { n0: model.label, n1: model.id }))
            )
          )
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("输出尺寸")),
          h("input", {
            className: "SPR_input",
            value: config.arkSize,
            onChange: (event) => void patch({ arkSize: event.target.value })
          })
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, "Base URL"),
          h("input", {
            className: "SPR_input",
            value: config.arkBaseUrl,
            onChange: (event) => void patch({ arkBaseUrl: event.target.value })
          })
        )
      ),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(
          BusyBtn,
          {
            busy: testing === "ark",
            busyText: T("正在生成测试图…"),
            disabled: testing !== null || !config.arkApiKeySet,
            onClick: async () => {
              setTesting("ark");
              await run(() => api.testArk(), (value) => T("连接正常：{n0} 返回 {n1} 字节图片", { n0: value.model, n1: value.bytes }));
              setTesting(null);
            }
          },
          T("测试连接（会真实生成 1 张 1K 小图，产生少量费用）")
        )
      )
    ),


    h("details", {className:"SPR_settingsGroup", "data-testid":"cfg-toapis", open: imageProvider === "toapis"},
      groupHead("ToAPIs", config.toapisApiKeySet ? T("Key 已配置") : T("Key 未配置"), imageProvider === "toapis" ? T("当前使用") : null),
      h("p",null,T("ToAPIs：图片和视频使用独立的异步协议；每次生成会计费。")),
      ...[ ["toapisBaseUrl","Base URL"], ["toapisImageModel",T("ToAPIs 图片模型")],
           ["toapisImageSize",T("ToAPIs 图片尺寸")], ["toapisImageQuality",T("ToAPIs 图片质量")],
           ["toapisVideoModel",T("ToAPIs 视频模型")], ["toapisVideoResolution",T("ToAPIs 视频分辨率")] ].map(([key,label])=>
        h("label",{className:"SPR_field"},h("span",{className:"SPR_fieldLabel"},label),h("input",{className:"SPR_input",value:config[key] ?? "",onChange:(event)=>void patch({[key]:event.target.value})}))),
      h("label",{className:"SPR_field"},h("span",{className:"SPR_fieldLabel"},T("ToAPIs 图片背景（GPT Image）")),h("select",{className:"SPR_input","data-testid":"cfg-toapis-background",value:config.toapisImageBackground ?? "auto",onChange:(event)=>void patch({toapisImageBackground:event.target.value})},h("option",{value:"auto"},T("自动背景")),h("option",{value:"transparent"},T("原生透明背景")),h("option",{value:"opaque"},T("不透明背景")))),
      h("p",null,T("透明PNG无需绿幕抠像；MP4视频没有透明通道，视频抽帧仍需背景处理。")),
      h("p",null,T("国内地址 https://toapis.cn/v1；国际地址 https://toapis.com/v1。")),
      h("p",null,T("ToAPIs 视频参数独立于 MiniMax；目前仅支持文生视频或一张首帧，不支持尾帧及多模态参考。")),
      h(NumField,{label:T("超时（秒）"),value:Math.round((config.toapisTimeoutMs ?? 600000)/1000),min:10,max:3600,onChange:(value)=>void patch({toapisTimeoutMs:value*1000})}),
      h("label",{className:"SPR_field"},h("span",{className:"SPR_fieldLabel"},T("ToAPIs 视频比例")),h("select",{className:"SPR_input","data-testid":"cfg-toapis-video-ratio",value:config.toapisVideoAspectRatio ?? "16:9",onChange:(event)=>void patch({toapisVideoAspectRatio:event.target.value})},...["16:9","9:16","1:1","4:3","3:4","21:9"].map(value=>h("option",{key:value,value},value)))),
      h("p",null,T("角色首帧为方形时建议1:1，避免宽屏裁掉头脚；MP4抽帧仍需去背景。")),
      h(NumField,{label:T("ToAPIs 视频时长（秒）"),value:config.toapisVideoDuration ?? 4,min:4,max:15,onChange:(value)=>void patch({toapisVideoDuration:value})}),
      h("label",{className:"SPR_check"},h("input",{type:"checkbox",checked:config.toapisVideo === true,onChange:(event)=>void patch({toapisVideo:event.target.checked,...(event.target.checked?{comfyVideo:false}:{})})}),h("span",null,T("使用 ToAPIs 生成视频"))),
      h("p",null,config.toapisApiKeySet ? T("ToAPIs Key 已配置") : T("ToAPIs Key 未配置")),
      h("input",{className:"SPR_input",type:"password",value:toapisKey,onChange:(event)=>setToapisKey(event.target.value),placeholder:T("留空表示不修改")}),
      h(Btn,{onClick:()=>run(async()=>{await api.saveConfig({toapisApiKey:toapisKey});setToapisKey("");},T("ToAPIs Key 已保存"))},T("保存 Key")),
      h(Btn,{disabled:!config.toapisApiKeySet,onClick:()=>run(()=>api.saveConfig({clearToapisApiKey:true}),T("已清除 ToAPIs Key"))},T("清除"))
    ),

    /**
     * 自定义生图后端。
     *
     * 三种协议共用一套表单，只有「高级参数」和「工作流」按协议显示——
     * 每个协议单独一块的话，用户切换协议时会看到完全换了一套界面，
     * 反而不知道哪些是共通的。
     */
    h(
      "details",
      { className: "SPR_settingsGroup", open: imageProvider === "custom" },
      groupHead(T("自定义生图模型"), protocolInfo?.label ?? "", imageProvider === "custom" ? T("当前使用") : null),
      h("p", null, T("填「主机根地址」即可，具体端点由插件按协议拼；本地服务通常不需要 API Key。")),
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("协议")),
          h(
            "select",
            {
              className: "SPR_input",
              "data-testid": "cfg-custom-protocol",
              value: customProtocol,
              onChange: (event) => onProtocolChange(event.target.value)
            },
            protocols.length > 0
              ? protocols.map((entry) => h("option", { key: entry.id, value: entry.id }, entry.label))
              : [
                  h("option", { key: "openai", value: "openai" }, "OpenAI API"),
                  h("option", { key: "comfyui", value: "comfyui" }, "ComfyUI API"),
                  h("option", { key: "sdwebui", value: "sdwebui" }, "Stable Diffusion WebUI API")
                ]
          )
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, "Base URL"),
          h("input", {
            className: "SPR_input",
            "data-testid": "cfg-custom-base-url",
            value: config.customBaseUrl ?? "",
            placeholder: protocolInfo?.baseUrl ?? "",
            onChange: (event) => void patch({ customBaseUrl: event.target.value })
          })
        ),
        h(
          "label",
          { className: "SPR_field" },
          h(
            "span",
            { className: "SPR_fieldLabel" },
            customProtocol === "sdwebui" ? T("模型名（SD WebUI 忽略，模型由服务端决定）") : T("模型名")
          ),
          h("input", {
            className: "SPR_input",
            "data-testid": "cfg-custom-model",
            value: config.customModel ?? "",
            disabled: customProtocol === "sdwebui",
            placeholder: customProtocol === "comfyui" ? T("可不填，由工作流决定") : "gpt-image-1",
            onChange: (event) => void patch({ customModel: event.target.value })
          })
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("输出尺寸（宽x高）")),
          h("input", {
            className: "SPR_input",
            "data-testid": "cfg-custom-size",
            value: config.customSize ?? "",
            placeholder: "1024x1024",
            onChange: (event) => void patch({ customSize: event.target.value })
          })
        )
      ),
      h("p", { className: "SPR_hint" }, T("请求端点：{n0}", { n0: protocolInfo?.hint ?? "" })),
      h(
        "div",
        { className: "SPR_keyRow" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("API Key {n0}", { n0: config.customApiKeySet ? T("（已配置 {n0}）", { n0: config.customApiKeyHint }) : T("（未配置，本地服务可以留空）") })),
          h("input", {
            className: "SPR_input",
            type: "password",
            placeholder: config.customApiKeySet ? T("留空表示不修改") : T("粘贴 API Key（A1111 的 user:pass 也认）"),
            value: customKey,
            onChange: (event) => setCustomKey(event.target.value)
          })
        ),
        h(Btn, { onClick: () => run(async () => { await api.saveConfig({ customApiKey: customKey }); setCustomKey(""); }, T("自定义后端 Key 已保存")) }, T("保存 Key")),
        h(Btn, { disabled: !config.customApiKeySet, onClick: () => run(() => api.saveConfig({ clearCustomApiKey: true }), T("已清除自定义后端 Key")) }, T("清除"))
      ),

      /**
       * 高级参数：OpenAI 协议不认这些（它只有 prompt / size / n），
       * 所以那一档不显示，免得用户以为调了有用。
       */
      customProtocol === "sdwebui" || customProtocol === "comfyui"
        ? h(
            "div",
            { className: "SPR_fields" },
            h("label", { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, T("负面提示词")),
              h("input", {
                className: "SPR_input",
                value: config.customNegativePrompt ?? "",
                placeholder: customProtocol === "comfyui" ? T("走 {{negative_prompt}} 占位符") : "",
                onChange: (event) => void patch({ customNegativePrompt: event.target.value })
              })
            ),
            h(NumField, {
              label: T("采样步数"),
              value: config.customSteps ?? 28,
              min: 1,
              max: 150,
              onChange: (value) => void patch({ customSteps: value })
            }),
            h(NumField, {
              label: T("CFG / 引导强度"),
              value: config.customCfgScale ?? 7,
              min: 0,
              max: 30,
              onChange: (value) => void patch({ customCfgScale: value })
            }),
            h("label", { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, T("采样器")),
              h("input", {
                className: "SPR_input",
                value: config.customSampler ?? "",
                placeholder: "DPM++ 2M Karras",
                onChange: (event) => void patch({ customSampler: event.target.value })
              })
            ),
            customProtocol === "sdwebui"
              ? h(NumField, {
                  label: T("图生图重绘强度（0~1）"),
                  value: config.customDenoising ?? 0.65,
                  min: 0,
                  max: 1,
                  step: 0.05,
                  onChange: (value) => void patch({ customDenoising: value })
                })
              : null,
            h(NumField, {
              label: T("随机种子（-1 = 每次随机）"),
              value: config.customSeed ?? -1,
              min: -1,
              max: 2147483647,
              onChange: (value) => void patch({ customSeed: value })
            })
          )
        : null,

      // 超时对所有协议都有效（云端 OpenAI 也可能很慢），所以放在条件块外面。
      h(NumField, {
        label: T("请求超时（毫秒，本地模型建议给足）"),
        value: config.customTimeoutMs ?? 300000,
        min: 10000,
        max: 3600000,
        onChange: (value) => void patch({ customTimeoutMs: value })
      }),

      /**
       * ComfyUI 的工作流。必须整段粘贴 API 格式的 JSON —— 从界面导出的
       * 「工作流」格式（带 nodes / links 的那份）不是 API 格式，提交会直接 400。
       */
      customProtocol === "comfyui"
        ? h(
            "div",
            null,
            h("p", { className: "SPR_hint" }, T("工作流（在 ComfyUI 里点「导出（API）」，把那份 JSON 整段粘贴）。可用占位符：{{prompt}} {{negative_prompt}} {{width}} {{height}} {{seed}} {{steps}} {{cfg}} {{sampler}} {{denoising}} {{model}} {{image}}；一个都不写就原样跑你保存的工作流。")),
            h("textarea", {
              className: "SPR_area",
              "data-testid": "cfg-custom-workflow",
              placeholder: '{"3":{"class_type":"KSampler","inputs":{"seed":"{{seed}}","steps":"{{steps}}","cfg":"{{cfg}}","sampler_name":"{{sampler}}","denoise":"{{denoising}}","model":["4",0],"positive":["6",0],"negative":["7",0],"latent_image":["5",0]}},"6":{"class_type":"CLIPTextEncode","inputs":{"text":"{{prompt}}","clip":["4",1]}}}',
              value: workflowNow,
              onChange: (event) => setWorkflowDraft(event.target.value)
            }),
            h(
              "div",
              { className: "SPR_toolbar" },
              h(
                Btn,
                {
                  disabled: !workflowDirty,
                  onClick: () => run(async () => {
                    await api.saveConfig({ customWorkflow: workflowNow });
                    setWorkflowDraft(null);
                  }, T("工作流已保存"))
                },
                workflowDirty ? T("保存工作流") : T("工作流已保存")
              ),
              h(
                Btn,
                {
                  onClick: () => {
                    setWorkflowDraft("");
                    void patch({ customWorkflow: "" });
                  }
                },
                T("清空")
              )
            )
          )
        : null,

      h(
        "div",
        { className: "SPR_toolbar" },
        h(
          BusyBtn,
          {
            busy: testing === "custom",
            busyText: T("正在生成测试图…"),
            disabled: testing !== null || config.customImageBlocker != null,
            onClick: async () => {
              setTesting("custom");
              await run(() => api.testCustomImage(), (value) => T("连接正常：{n0} 返回 {n1} 字节图片", { n0: value.provider, n1: value.bytes }));
              setTesting(null);
            }
          },
          T("测试连接（会真实生成 1 张测试图，产生少量费用）")
        )
      )
    ),

    /**
     * 本地 ComfyUI · 工作流库（req_e395dcba0d）。
     *
     * 为什么单独一张卡：本地后端不只是「换个地址」，它有一份目录（9 个实测工作流）、
     * 一个默认选择、一套注入绑定与自检。塞进「自定义生图模型」那一组会让
     * 「自定义（协议三选一）」与「本地工作流库」两件事互相污染。
     */
    h(
      "details",
      { className: "SPR_settingsGroup", "data-testid": "cfg-workflow-lib", open: config.imageProvider === "comfy" },
      groupHead(
        T("本地 ComfyUI · 工作流库"),
        config.imageProvider === "comfy" ? T("当前使用") : T("{n0} 条可用", { n0: installedWorkflows.length })
      ),
      h(
        "p",
        null,
        T("把本机 ComfyUI 的实测工作流做成目录：生图时按用途选工作流，提示词 / 尺寸 / 种子自动注入到正确节点。工作流 JSON 支持 API 格式与 ComfyUI 界面格式（界面格式需要 ComfyUI 可达才能精确转换）。")
      ),
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("选择策略")),
          h(
            "select",
            {
              className: "SPR_input",
              "data-testid": "cfg-backend-policy",
              value: config.imageBackendPolicy ?? "manual",
              onChange: (event) => void patch({ imageBackendPolicy: event.target.value })
            },
            h("option", { value: "manual" }, T("手动（只按上面选的生图后端）")),
            h("option", { value: "local-first" }, T("本地优先（本机可用就用本地，不可用自动回退）"))
          )
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("回退目标（本地优先时）")),
          h(
            "select",
            {
              className: "SPR_input",
              "data-testid": "cfg-backend-fallback",
              value: config.imageProviderFallback ?? "ark",
              onChange: (event) => void patch({ imageProviderFallback: event.target.value })
            },
            h("option", { value: "ark" }, T("火山方舟 Seedream")),
            h("option", { value: "custom" }, T("自定义生图服务")),
            h("option", { value: "none" }, T("不回退（本地不可用就报错，避免悄悄花钱）"))
          )
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("默认工作流")),
          h(
            "select",
            {
              className: "SPR_input",
              "data-testid": "cfg-workflow-default",
              value: config.imageWorkflowId ?? "",
              onChange: (event) => void patch({ imageWorkflowId: event.target.value })
            },
            h("option", { value: "" }, T("按用途自动选择")),
            workflowsList
              .filter((item) => item.hasWorkflow === true)
              .map((item) =>
                h(
                  "option",
                  { key: item.id, value: item.id },
                  item.builtin === true ? T("内置 · {n0}", { n0: item.name }) : T("导入 · {n0}", { n0: item.name })
                )
              )
          )
        )
      ),
      imageBackend?.fallbackReason
        ? h("p", { className: "SPR_note", "data-kind": "warn" }, T("上次回退原因：{n0}", { n0: imageBackend.fallbackReason }))
        : null,
      h("p", { className: "SPR_hint" }, T("本地后端走本机并发通道、不建付费凭证；回退原因会显示在这里。")),
      h(
        "div",
        null,
        ...workflowsList.map((item) =>
          h(
            "div",
            { key: item.id, className: "SPR_toolbar", "data-workflow": item.id },
            h(
              "span",
              { className: "SPR_badge" },
              item.needsImport === true ? T("需导入") : item.builtin === true ? T("内置") : T("已导入")
            ),
            h("span", { className: "SPR_refRow", style: { flex: "1 1 auto" } }, item.name + (item.purpose ? " · " + item.purpose : "")),
            h(
              "div",
              { className: "SPR_btnRow" },
              item.hasWorkflow === true
                ? h(
                    BusyBtn,
                    {
                      busy: testing === "wf-test:" + item.id,
                      busyText: T("自检中…"),
                      disabled: testing !== null,
                      onClick: async () => {
                        setTesting("wf-test:" + item.id);
                        await run(async () => {
                          const result = await api.testWorkflow({ id: item.id });
                          setWorkflowImport({ ...importState, test: result });
                          return result;
                        }, T("自检已执行"));
                        setTesting(null);
                      }
                    },
                    T("自检")
                  )
                : null,
              item.hasWorkflow === true
                ? h(
                    Btn,
                    { onClick: () => void patch({ imageWorkflowId: item.id }) },
                    config.imageWorkflowId === item.id ? T("已是默认") : T("设为默认")
                  )
                : null,
              item.builtin !== true
                ? h(
                    Btn,
                    { danger: true, onClick: () => run(() => api.removeWorkflow({ id: item.id }), T("已删除工作流")) },
                    T("删除")
                  )
                : null
            )
          )
        )
      ),
      workflowsList.some((item) => item.needsImport === true)
        ? h("p", { className: "SPR_hint" }, T("标「需导入」的是目录条目：正文不随包内置，从本机 ComfyUI 的 user/default/workflows 目录导入即可。"))
        : null,
      h(
        "p",
        { className: "SPR_hint" },
        T("导入工作流：在 ComfyUI 里「工作流 → 导出」拿到 JSON（界面格式也行），整段粘到下面。ComfyUI 可达时按节点定义精确转换，提示词 / 模型 / 尺寸等控件值不会丢。")
      ),
      h("textarea", {
        className: "SPR_area",
        "data-testid": "cfg-workflow-import-json",
        placeholder: T("粘贴工作流 JSON（界面格式或 API 格式）"),
        value: importState.json,
        onChange: (event) => setWorkflowImport({ ...importState, json: event.target.value })
      }),
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("工作流名称")),
          h("input", {
            className: "SPR_input",
            "data-testid": "cfg-workflow-import-name",
            placeholder: T("例如：我的像素风工作流"),
            value: importState.name,
            onChange: (event) => setWorkflowImport({ ...importState, name: event.target.value })
          })
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("用途")),
          h(
            "select",
            {
              className: "SPR_input",
              "data-testid": "cfg-workflow-import-kind",
              value: importState.kind,
              onChange: (event) => setWorkflowImport({ ...importState, kind: event.target.value })
            },
            h("option", { value: "generate" }, T("出图（需要提示词）")),
            h("option", { value: "post" }, T("后处理（去背 / 像素化，需要输入图）"))
          )
        )
      ),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(
          BusyBtn,
          {
            busy: testing === "wf-import",
            busyText: T("正在导入…"),
            disabled: testing !== null || importState.json.trim() === "" || importState.name.trim() === "",
            onClick: async () => {
              setTesting("wf-import");
              await run(async () => {
                const result = await api.saveWorkflow({ name: importState.name, json: importState.json, kind: importState.kind });
                setWorkflowImport({ json: "", name: "", kind: importState.kind, test: null });
                return result;
              }, (value) => T("已导入工作流：{n0}（{n1} 个节点）", { n0: value.name, n1: value.nodes }));
              setTesting(null);
            }
          },
          T("导入工作流")
        )
      ),
      importState.test !== null
        ? h(
            "pre",
            { className: "SPR_note", "data-kind": importState.test.ok === true ? "ok" : "error", "data-testid": "cfg-workflow-test" },
            formatWorkflowTest(importState.test)
          )
        : null
    ),

    h(
      "details",
      { className: "SPR_settingsGroup" },
      groupHead(T("MiniMax（图生视频）"), config.minimaxApiKeySet ? T("Key 已配置") : T("Key 未配置")),
      h("p", null, T("视频阶段使用图生视频（I2V）。建议用 MiniMax-Hailuo-02，镜头稳定性最好。")),
      h(
        "div",
        { className: "SPR_keyRow" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("API Key {n0}", { n0: config.minimaxApiKeySet ? T("（已配置 {n0}）", { n0: config.minimaxApiKeyHint }) : T("（未配置）") })),
          h("input", {
            className: "SPR_input",
            type: "password",
            placeholder: config.minimaxApiKeySet ? T("留空表示不修改") : T("粘贴 MiniMax API Key"),
            value: minimaxKey,
            onChange: (event) => setMinimaxKey(event.target.value)
          })
        ),
        h(Btn, { onClick: () => run(async () => { await api.saveConfig({ minimaxApiKey: minimaxKey }); setMinimaxKey(""); }, T("MiniMax Key 已保存")) }, T("保存 Key")),
        h(Btn, { disabled: !config.minimaxApiKeySet, onClick: () => run(() => api.saveConfig({ clearMinimaxApiKey: true }), T("已清除 MiniMax Key")) }, T("清除"))
      ),
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("视频模型")),
          h(
            "select",
            {
              className: "SPR_input",
              value: config.minimaxModel,
              onChange: (event) => onModelChange(event.target.value)
            },
            (config.minimaxModels ?? []).map((model) =>
              h("option", { key: model.id, value: model.id }, T("{n0}（{n1}）", { n0: model.label, n1: model.id }))
            ),
            (config.minimaxModels ?? []).some((model) => model.id === config.minimaxModel)
              ? null
              : h("option", { value: config.minimaxModel }, T("自定义：{n0}", { n0: config.minimaxModel }))
          )
        ),
        // 时长控件随模型切换：Hailuo 是 6/10 两档，H3 是 4~15 连续区间。
        minimaxCaps.durations !== undefined
          ? h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, T("时长（秒）")),
              h(
                "select",
                {
                  className: "SPR_input",
                  value: config.minimaxDuration,
                  onChange: (event) => void patch({ minimaxDuration: Number(event.target.value) })
                },
                minimaxCaps.durations.map((seconds) =>
                  h("option", { key: seconds, value: seconds }, T("{n0} 秒", { n0: seconds }))
                )
              )
            )
          : h(NumField, {
              label: T("时长（秒，{n0}~{n1}）", { n0: minimaxCaps.durationMin, n1: minimaxCaps.durationMax }),
              value: config.minimaxDuration,
              min: minimaxCaps.durationMin,
              max: minimaxCaps.durationMax,
              onChange: (value) => void patch({ minimaxDuration: value })
            }),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("分辨率")),
          h(
            "select",
            {
              className: "SPR_input",
              value: config.minimaxResolution,
              onChange: (event) => void patch({ minimaxResolution: event.target.value })
            },
            minimaxCaps.resolutions.map((value) => h("option", { key: value, value }, value))
          )
        ),
        h(
          "label",
          { className: "SPR_field" },
          h(
            "span",
            { className: "SPR_fieldLabel" },
            usingCompshare
              ? T("Base URL（优云智算版 H3 固定使用，无需修改）")
              : T("Base URL（主机根，不含 /v1、/v2）")
          ),
          h("input", {
            className: "SPR_input",
            list: "SPR_minimax_hosts",
            value: config.minimaxBaseUrl,
            disabled: usingCompshare,
            onChange: (event) => void patch({ minimaxBaseUrl: event.target.value })
          }),
          h(
            "datalist",
            { id: "SPR_minimax_hosts" },
            (config.minimaxHosts ?? []).map((host) => h("option", { key: host.id, value: host.id }, host.label))
          ),
          h(
            "span",
            { className: "SPR_fieldLabel" },
            T("当前协议：{n0}", { n0: minimaxCaps.protocol === "v2" ? T("v2（{n0}/v2/video_generation）", { n0: config.minimaxPathPrefix ?? "" }) : T("v1（{n0}/v1/video_generation）", { n0: config.minimaxPathPrefix ?? "" }) })
          )
        )
      ),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(
          BusyBtn,
          {
            busy: testing === "minimax",
            busyText: T("正在校验…"),
            disabled: testing !== null || !config.minimaxApiKeySet,
            onClick: async () => {
              setTesting("minimax");
              await run(() => api.testMinimax(), (value) => T("连接正常：{n0}", { n0: value.model }));
              setTesting(null);
            }
          },
          T("测试连接（只校验 Key，不产生费用）")
        )
      )
    ),

    h(
      "details",
      { className: "SPR_settingsGroup" },
      groupHead(T("本地 ComfyUI（图生视频）"), config.comfyVideo === true ? T("已启用") : T("未启用")),
      h("p", null, T("勾选后，视频阶段改由本机 ComfyUI 生成，不再调用 MiniMax。工作流贴「导出（API 格式）」的那份 JSON；插件只负责把提示词、首帧图、尺寸、时长、种子注入进去，其余节点原样提交。")),
      h(
        "label",
        { className: "SPR_check" },
        h("input", {
          type: "checkbox",
          checked: config.comfyVideo === true,
          onChange: (event) => void patch({ comfyVideo: event.target.checked, ...(event.target.checked ? {toapisVideo:false} : {}) })
        }),
        h("span", null, T("用本机 ComfyUI 生成视频（替代 MiniMax）"))
      ),
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("ComfyUI 地址（本机默认 http://127.0.0.1:8188）")),
          h("input", {
            className: "SPR_input",
            value: config.comfyBaseUrl,
            onChange: (event) => void patch({ comfyBaseUrl: event.target.value })
          })
        ),
        h(NumField, {
          label: T("超时（秒）"),
          value: Math.round((config.comfyTimeoutMs ?? 600000) / 1000),
          min: 10,
          max: 3600,
          onChange: (value) => void patch({ comfyTimeoutMs: value * 1000 })
        })
      ),
      h(
        "div",
        { className: "SPR_keyRow" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("Cookie {n0}", { n0: config.comfyCookiesSet ? T("（已配置 {n0}）", { n0: config.comfyCookiesHint }) : T("（未配置）") })),
          h("input", {
            className: "SPR_input",
            type: "password",
            placeholder: config.comfyCookiesSet ? T("留空表示不修改") : T("粘贴 Cookie 头，例如 token=abc; session=xyz"),
            value: comfyCookie,
            onChange: (event) => setComfyCookie(event.target.value)
          })
        ),
        h(Btn, { onClick: () => run(async () => { await api.saveConfig({ comfyCookies: comfyCookie }); setComfyCookie(""); }, T("ComfyUI Cookie 已保存")) }, T("保存 Cookie")),
        h(Btn, { disabled: !config.comfyCookiesSet, onClick: () => run(() => api.saveConfig({ clearComfyCookies: true }), T("已清除 ComfyUI Cookie")) }, T("清除"))
      ),
      h("p", { className: "SPR_hint" }, T("ComfyUI 本身不做鉴权；只有当它藏在需要登录的反向代理后面（Cloudflare Access、Basic Auth 之类）时才用得上——从浏览器开发者工具里把 Cookie 整段复制过来即可，所有请求（包括取回成品视频）都会带上它。")),
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("提示词注入点（留空自动探测）")),
          h("input", {
            className: "SPR_input",
            placeholder: "1.text",
            value: config.comfyPromptTarget,
            onChange: (event) => void patch({ comfyPromptTarget: event.target.value })
          })
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("首帧图注入点（留空自动探测）")),
          h("input", {
            className: "SPR_input",
            placeholder: "10.image",
            value: config.comfyFirstFrameTarget,
            onChange: (event) => void patch({ comfyFirstFrameTarget: event.target.value })
          })
        )
      ),
      h(
        "div",
        { className: "SPR_fields" },
        h(NumField, { label: T("宽度（0 = 用工作流里的值）"), value: config.comfyWidth, min: 0, max: 4096, onChange: (value) => void patch({ comfyWidth: value }) }),
        h(NumField, { label: T("高度（0 = 用工作流里的值）"), value: config.comfyHeight, min: 0, max: 4096, onChange: (value) => void patch({ comfyHeight: value }) }),
        h(NumField, { label: T("时长（秒，0 = 用工作流里的值）"), value: config.comfySeconds, min: 0, max: 120, onChange: (value) => void patch({ comfySeconds: value }) }),
        h(NumField, { label: T("种子（0 = 每次随机）"), value: config.comfySeed, min: 0, max: 2147483647, onChange: (value) => void patch({ comfySeed: value }) })
      ),
      h(
        "label",
        { className: "SPR_field" },
        h("span", { className: "SPR_fieldLabel" }, T("工作流 JSON（ComfyUI 菜单里的「导出（API 格式）」）")),
        h("textarea", {
          className: "SPR_input",
          rows: 8,
          spellCheck: false,
          value: comfyWorkflowDraft ?? config.comfyWorkflow,
          onChange: (event) => setComfyWorkflowDraft(event.target.value)
        })
      ),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(Btn, { onClick: () => run(async () => { await api.saveConfig({ comfyWorkflow: comfyWorkflowDraft ?? config.comfyWorkflow }); setComfyWorkflowDraft(null); }, T("工作流已保存")) }, T("保存工作流")),
        h(Btn, { onClick: () => run(async () => { await api.saveConfig({ comfyWorkflow: "" }); setComfyWorkflowDraft(null); }, T("已恢复内置模板")) }, T("恢复内置模板")),
        h(
          BusyBtn,
          {
            busy: testing === "comfy",
            busyText: T("正在连接…"),
            disabled: testing !== null,
            onClick: async () => {
              setTesting("comfy");
              try {
                const value = await api.testComfy();
                setComfyProbe(value);
                setNotice({ kind: "ok", text: T("连接正常：ComfyUI {n0}", { n0: value.version }) });
              } catch (error) {
                setComfyProbe(null);
                setNotice({ kind: "error", text: msg(error) });
              } finally {
                setTesting(null);
              }
            }
          },
          T("测试连接（只读状态，不产生费用）")
        )
      ),
      comfyProbe === null
        ? null
        : h(
            "div",
            { className: "SPR_hint" },
            h("div", null, T("ComfyUI {n0} · {n1} · 队列 {n2} 运行 / {n3} 等待 · 工作流 {n4} 个节点", {
              n0: comfyProbe.version,
              n1: comfyProbe.device || T("未知显卡"),
              n2: comfyProbe.queueRunning,
              n3: comfyProbe.queuePending,
              n4: comfyProbe.nodes
            })),
            h("div", null, T("探测到的注入点 —— 提示词：{n0}；首帧：{n1}；尺寸：{n2} × {n3}；秒数：{n4}；种子：{n5}", {
              n0: comfyProbe.bindings?.prompt ?? T("未探测到"),
              n1: comfyProbe.bindings?.first ?? T("未探测到"),
              n2: comfyProbe.bindings?.width ?? T("—"),
              n3: comfyProbe.bindings?.height ?? T("—"),
              n4: comfyProbe.bindings?.seconds ?? T("—"),
              n5: comfyProbe.bindings?.seed ?? T("—")
            })),
            (comfyProbe.notes ?? []).map((note, index) => h("div", { key: index }, note))
          )
    ),

    // 产物体检（QA）：开关 / fail-closed / 阈值覆盖。阈值直接读「当前生效值」，
    // 改一个键就把整份表发回去（宿主侧 normalizeQaThresholds 会补齐并夹范围）。
    h(
      "details",
      { className: "SPR_settingsGroup", "data-testid": "cfg-qa" },
      groupHead(T("产物体检（QA）"), config.qaFailClosed === true ? T("QA 不通过时阻断验收") : T("只警告")),
      h("p", null, T("合图 / 条图 / 抠像后自动算一份体检报告（透明比例、边缘彩边、帧间一致性、循环缝），落在产物的 qa/report.json。默认只警告，不阻断。")),
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("自动体检")),
          h(
            "select",
            { className: "SPR_input", value: config.qaEnabled === false ? "off" : "on", onChange: (event) => void patch({ qaEnabled: event.target.value === "on" }) },
            h("option", { value: "on" }, T("开启")),
            h("option", { value: "off" }, T("关闭"))
          )
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("QA 不通过时阻断验收")),
          h(
            "select",
            { className: "SPR_input", value: config.qaFailClosed === true ? "on" : "off", onChange: (event) => void patch({ qaFailClosed: event.target.value === "on" }) },
            h("option", { value: "off" }, T("关闭（只警告）")),
            h("option", { value: "on" }, T("开启（fail 阻断）"))
          )
        )
      ),
      h(
        "div",
        { className: "SPR_fields" },
        [
          { key: "transparentRatioMin", label: T("透明比例下限"), min: 0, max: 0.95, step: 0.01 },
          { key: "transparentRatioMax", label: T("透明比例上限"), min: 0.05, max: 1, step: 0.01 },
          { key: "fringeRatioMax", label: T("彩边比例上限"), min: 0, max: 1, step: 0.01 },
          { key: "bboxCvMax", label: T("包围盒宽度 CV 上限"), min: 0, max: 50, step: 0.5 },
          { key: "heightCvMax", label: T("身高 CV 上限"), min: 0, max: 50, step: 0.1 },
          { key: "headWidthCvMax", label: T("头宽 CV 上限"), min: 0, max: 50, step: 0.1 },
          { key: "loopSeamIouMin", label: T("循环缝 IoU 下限"), min: 0, max: 1, step: 0.05 },
          { key: "loopSeamDiffMax", label: T("循环缝 RGB 差上限"), min: 0, max: 255, step: 1 }
        ].map((entry) =>
          h(NumField, {
            key: entry.key,
            label: entry.label,
            value: config.qaThresholds?.[entry.key] ?? config.defaults?.qaThresholds?.[entry.key] ?? 0,
            min: entry.min,
            max: entry.max,
            step: entry.step,
            onChange: (value) => void patch({ qaThresholds: { ...(config.qaThresholds ?? {}), [entry.key]: value } })
          })
        )
      ),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(Btn, { "data-testid": "cfg-qa-reset", onClick: () => void patch({ qaThresholds: { ...(config.defaults?.qaThresholds ?? {}) } }) }, T("恢复默认阈值"))
      ),
      h("p", { className: "SPR_hint" }, T("透明比例 / 彩边比例 / 循环缝 IoU 是 0~1 的小数；CV 与 RGB 差是百分数 / 像素差。阈值越严格越容易报警告。"))
    ),

    h(
      "details",
      { className: "SPR_settingsGroup" },
      groupHead(T("新建项目的默认参数"), T("新项目初始值")),
      h("p", null, T("这些值会成为每个新项目的初始设置，之后可在项目里单独调整。")),
      h(
        "div",
        { className: "SPR_fields" },
        h(NumField, {
          label: T("单格宽（px）"),
          value: config.cellWidth,
          min: 16,
          max: 2048,
          onChange: (value) => void patch({ cellWidth: value })
        }),
        h(NumField, {
          label: T("单格高（px）"),
          value: config.cellHeight,
          min: 16,
          max: 2048,
          onChange: (value) => void patch({ cellHeight: value })
        }),
        h(NumField, {
          label: T("每段视频抽帧数"),
          value: config.frameCount,
          min: 1,
          max: 64,
          onChange: (value) => void patch({ frameCount: value })
        }),
        h(NumField, {
          label: T("并发数"),
          value: config.concurrency,
          min: 1,
          max: 8,
          onChange: (value) => void patch({ concurrency: value })
        }),
        h(NumField, {
          label: T("抠像下限"),
          value: config.keyLow,
          min: 0,
          max: 255,
          onChange: (value) => void patch({ keyLow: value })
        }),
        h(NumField, {
          label: T("抠像上限"),
          value: config.keyHigh,
          min: 1,
          max: 255,
          onChange: (value) => void patch({ keyHigh: value })
        }),
        h(NumField, {
          label: T("去绿溢出"),
          value: config.despill,
          min: 0,
          max: 1,
          step: 0.05,
          onChange: (value) => void patch({ despill: value })
        }),
        h(NumField, {
          label: T("边缘收缩（px）"),
          value: config.edgeShrink,
          min: 0,
          max: 8,
          onChange: (value) => void patch({ edgeShrink: value })
        }),
        h(NumField, {
          label: T("背景分割容差（0 = 只认绿色）"),
          value: config.bgTolerance,
          min: 0,
          max: 160,
          onChange: (value) => void patch({ bgTolerance: value })
        }),
        h(NumField, {
          label: T("抽帧工作尺寸（长边 px）"),
          value: config.workingLongEdge,
          min: 128,
          max: 2048,
          onChange: (value) => void patch({ workingLongEdge: value })
        }),
        h(NumField, {
          label: T("像素块边长（0/1 = 关闭）"),
          value: config.pixelSize,
          min: 0,
          max: 32,
          onChange: (value) => void patch({ pixelSize: value })
        }),
        h(NumField, {
          label: T("自动裁剪填充比例"),
          value: config.fillRatio,
          min: 0.5,
          max: 1,
          step: 0.02,
          onChange: (value) => void patch({ fillRatio: value })
        }),
        h(NumField, {
          label: T("底部留白（px）"),
          value: config.bottomMargin,
          min: 0,
          max: 64,
          onChange: (value) => void patch({ bottomMargin: value })
        })
      )
    ),

    /**
     * 去背后端（模块①②③ 共用）。
     *
     * 默认 keygreen = 现有绿幕算法，升级不改行为；birefnet 用本机 ComfyUI 的
     * BiRefNet 工作流（见 src/matte.ts，内置 builtin.matte-birefnet）。
     */
    h(
      "details",
      { className: "SPR_settingsGroup", "data-testid": "cfg-matte" },
      groupHead(
        T("去背后端"),
        T("动画帧 / 图片生成 / 序列帧共用"),
        config.matteBackend === "birefnet" ? T("当前：BiRefNet") : config.matteBackend === "auto" ? T("当前：自动") : T("当前：绿幕")
      ),
      h("p", null, T("绿幕抠像只适合纯色背景；手绘、照片、渐变背景用 BiRefNet（本机 ComfyUI，免费）去得更干净。默认仍是绿幕，不改既有行为。")),
      h(
        "label",
        { className: "SPR_field" },
        h("span", { className: "SPR_fieldLabel" }, T("去背后端")),
        h(
          "select",
          {
            className: "SPR_input",
            "data-testid": "cfg-matte-backend",
            value: config.matteBackend ?? "keygreen",
            onChange: (event) => void patch({ matteBackend: event.target.value })
          },
          h("option", { value: "keygreen" }, T("绿幕（默认）")),
          h("option", { value: "birefnet" }, T("BiRefNet 模型（本机 ComfyUI）")),
          h("option", { value: "auto" }, T("自动（先试绿幕，不行再用模型）"))
        )
      ),
      h(
        "label",
        { className: "SPR_check" },
        h("input", {
          type: "checkbox",
          "data-testid": "cfg-matte-fallback",
          checked: config.matteFallback !== false,
          onChange: (event) => void patch({ matteFallback: event.target.checked })
        }),
        h("span", null, T("BiRefNet 失败时自动回退绿幕，并在任务日志里写明原因"))
      ),
      h(
        "label",
        { className: "SPR_field" },
        h("span", { className: "SPR_fieldLabel" }, T("去背工作流")),
        h("input", {
          className: "SPR_input",
          "data-testid": "cfg-matte-workflow",
          value: config.matteWorkflowId ?? "",
          onChange: (event) => void patch({ matteWorkflowId: event.target.value }),
          placeholder: "builtin.matte-birefnet"
        })
      ),
      h("p", null, T("BiRefNet 走本机 ComfyUI（默认 127.0.0.1:8188），需要装好 background_removal 的 birefnet 模型；可在上方 ComfyUI 分组点「测试连接」确认服务可达。"))
    ),

    h(
      "details",
      { className: "SPR_settingsGroup" },
      groupHead(T("音乐生成（谱乐 AI）"), config.musicApiKeySet ? T("Key 已配置") : T("Key 未配置")),
      h("p", null, T("「音乐生成编辑」用谱乐 AI 的开放 API。Key 只保存在本机配置文件里，界面始终脱敏显示；生成按平台积分计费，插件不代收。目前只支持谱乐 AI（YourMusic）。")),
      config.musicBlocker !== null && config.musicBlocker !== undefined
        ? h("div", { className: "SPR_note", "data-kind": "error" }, config.musicBlocker)
        : null,
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("API Key")),
          h("input", {
            className: "SPR_input",
            type: "password",
            autoComplete: "off",
            "data-testid": "cfg-music-key",
            placeholder: config.musicApiKeySet ? T("已配置 {n0}（留空表示不修改）", { n0: config.musicApiKeyHint }) : T("粘贴谱乐 AI API Key（sk-live-…）"),
            value: musicKey,
            onChange: (event) => setMusicKey(event.target.value)
          })
        ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(Btn, { primary: true, disabled: musicKey.trim() === "", onClick: () => void run(async () => { await api.saveConfig({ musicApiKey: musicKey }); setMusicKey(""); }, T("音乐 API Key 已保存")) }, T("保存 Key")),
          h(Btn, { disabled: config.musicApiKeySet !== true, onClick: () => void run(() => api.saveConfig({ clearMusicApiKey: true }), T("已清除音乐 API Key")) }, T("清除 Key")),
          h(Btn, { onClick: () => void run(() => api.testMusic(), (value) => value.warning ?? T("连接正常：{n0}", { n0: value.message ?? "" })) }, T("测试连接"))
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("API 地址")),
          h("input", {
            className: "SPR_input",
            value: config.musicBaseUrl ?? "",
            onChange: (event) => void patch({ musicBaseUrl: event.target.value }),
            placeholder: "https://api.yourmusic.fun"
          })
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("默认音乐模型")),
          h(
            "select",
            { className: "SPR_input", value: config.musicModel ?? "chirp-v6", onChange: (event) => void patch({ musicModel: event.target.value }) },
            MUSIC_ENGINES.flatMap((engine) =>
              engine.models.map((model) => h("option", { key: `${engine.id}:${model.id}`, value: model.id }, `${engine.label} · ${model.label}`))
            )
          )
        ),
        h(NumField, {
          label: T("请求超时（毫秒）"),
          value: config.musicTimeoutMs,
          min: 10000,
          max: 900000,
          onChange: (value) => void patch({ musicTimeoutMs: value })
        }),
        h(NumField, {
          label: T("生成等待超时（毫秒）"),
          value: config.musicPollTimeoutMs,
          min: 60000,
          max: 3600000,
          onChange: (value) => void patch({ musicPollTimeoutMs: value })
        })
      ),
      h(
        "p",
        { className: "SPR_hint" },
        T("文档："),
        config.musicDocsUrl ? h("a", { className: "SPR_link", href: config.musicDocsUrl, target: "_blank", rel: "noreferrer" }, config.musicDocsUrl) : null,
        T(" · 控制台："),
        config.musicConsoleUrl ? h("a", { className: "SPR_link", href: config.musicConsoleUrl, target: "_blank", rel: "noreferrer" }, config.musicConsoleUrl) : null
      ),
      h("p", { className: "SPR_hint" }, T("音乐创作技巧来源：bitwize-music-studio/claude-ai-music-skills（CC0-1.0），已提炼为插件内置指南；原仓库版权归其作者所有，特此致谢。"))
    ),

    h(
      "details",
      { className: "SPR_settingsGroup" },
      groupHead(T("谱曲模式（本地 MIDI）"), config.musicScoreStatus?.blocker ? T("依赖缺失") : T("依赖已就绪")),
      h("p", null, T("谱曲模式在对话里先分析想法、给出方案，再用 scoremill 把方案写成 MIDI；宿主在本机渲染试听。谱曲、试听、导出全部免费；只有最后「交给 Suno」会消耗谱乐 AI 积分。")),
      h("p", null, T("依赖：Python 3 + scoremill（写 MIDI）、FluidSynth + SoundFont（更好的试听，可选）、ffmpeg（转 MP3/导出）。没有 FluidSynth 时插件会退回内置简易音源；没有 scoremill 时无法谱曲。")),
      config.musicScoreStatus === undefined || config.musicScoreStatus === null
        ? h("p", { className: "SPR_hint" }, T("正在检测谱曲依赖…"))
        : h(
            React.Fragment,
            null,
            config.musicScoreStatus.blocker
              ? h("div", { className: "SPR_note", "data-kind": "error" }, config.musicScoreStatus.blocker)
              : h("div", { className: "SPR_note", "data-kind": "ok" }, T("谱曲依赖已就绪：试听使用 {n0}", { n0: config.musicScoreStatus.renderer === "fluidsynth" ? T("FluidSynth + SoundFont") : T("内置简易音源") })),
            h(
              "div",
              { className: "SPR_fields" },
              h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("Python")), h("div", { className: "SPR_hint" }, config.musicScoreStatus.python?.ok ? `${config.musicScoreStatus.python.path ?? ""} ${config.musicScoreStatus.python.version ?? ""}` : config.musicScoreStatus.python?.error ?? T("未找到"))),
              h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("scoremill")), h("div", { className: "SPR_hint" }, config.musicScoreStatus.scoremill?.ok ? config.musicScoreStatus.scoremill.version ?? "OK" : config.musicScoreStatus.scoremill?.error ?? T("未安装"))),
              h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("FluidSynth")), h("div", { className: "SPR_hint" }, config.musicScoreStatus.fluidsynth?.ok ? `${config.musicScoreStatus.fluidsynth.path ?? ""} ${config.musicScoreStatus.fluidsynth.version ?? ""}` : T("未找到（用内置音源）"))),
              h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("SoundFont")), h("div", { className: "SPR_hint" }, config.musicScoreStatus.soundfont?.ok ? config.musicScoreStatus.soundfont.path ?? "OK" : T("未找到（用内置音源）"))),
              h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("ffmpeg")), h("div", { className: "SPR_hint" }, config.musicScoreStatus.ffmpeg?.ok ? `${config.musicScoreStatus.ffmpeg.path ?? ""} ${config.musicScoreStatus.ffmpeg.version ?? ""}` : config.musicScoreStatus.ffmpeg?.error ?? T("未找到"))),
              h(
                "label",
                { className: "SPR_field" },
                h("span", { className: "SPR_fieldLabel" }, T("Python 路径（留空自动探测）")),
                h("input", {
                  className: "SPR_input",
                  value: scorePaths?.python ?? config.musicPythonPath ?? "",
                  placeholder: "/path/to/venv/bin/python3",
                  onChange: (event) => setScorePaths({ ...(scorePaths ?? { python: "", fluidsynth: "", soundfont: "" }), python: event.target.value }),
                  onBlur: () => void patch({ musicPythonPath: (scorePaths?.python ?? "").trim() })
                })
              ),
              h(
                "label",
                { className: "SPR_field" },
                h("span", { className: "SPR_fieldLabel" }, T("FluidSynth 路径（留空自动探测）")),
                h("input", {
                  className: "SPR_input",
                  value: scorePaths?.fluidsynth ?? config.musicFluidsynthPath ?? "",
                  placeholder: "/opt/homebrew/bin/fluidsynth",
                  onChange: (event) => setScorePaths({ ...(scorePaths ?? { python: "", fluidsynth: "", soundfont: "" }), fluidsynth: event.target.value }),
                  onBlur: () => void patch({ musicFluidsynthPath: (scorePaths?.fluidsynth ?? "").trim() })
                })
              ),
              h(
                "label",
                { className: "SPR_field" },
                h("span", { className: "SPR_fieldLabel" }, T("SoundFont 路径（留空自动探测）")),
                h("input", {
                  className: "SPR_input",
                  value: scorePaths?.soundfont ?? config.musicSoundfontPath ?? "",
                  placeholder: "~/Library/Audio/SoundFonts/FluidR3_GM.sf2",
                  onChange: (event) => setScorePaths({ ...(scorePaths ?? { python: "", fluidsynth: "", soundfont: "" }), soundfont: event.target.value }),
                  onBlur: () => void patch({ musicSoundfontPath: (scorePaths?.soundfont ?? "").trim() })
                })
              )
            ),
            Array.isArray(config.musicScoreStatus.warnings) && config.musicScoreStatus.warnings.length > 0
              ? h("div", { className: "SPR_hint" }, ...config.musicScoreStatus.warnings.map((warning) => h("div", null, warning)))
              : null
          ),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(
          BusyBtn,
          {
            busy: testing === "score",
            busyText: T("正在检测…"),
            disabled: testing !== null,
            onClick: async () => {
              setTesting("score");
              await run(() => api.testMusicScore(), (value) => (value?.ok === true ? T("谱曲依赖已就绪") : value?.blocker ?? T("仍有依赖缺失")));
              setTesting(null);
            }
          },
          T("重新检测")
        )
      ),
      h("p", { className: "SPR_hint" }, T("安装提示：python3 -m pip install scoremill；macOS 可 brew install fluid-synth；SoundFont 放到 ~/Library/Audio/SoundFonts/FluidR3_GM.sf2。")),
      h("p", { className: "SPR_hint" }, T("谱曲模式参考：scoremill（MIT，https://github.com/CharlesCNorton/scoremill）与 Midra 的 prompt-to-code MIDI 思路；只吸收方法论，未打包其代码或音源。"))
    ),

    h(
      "details",
      { className: "SPR_settingsGroup" },
      groupHead(T("音效生成（火山引擎 Seed-Audio）"), config.sfxApiKeySet ? T("Key 已配置") : T("Key 未配置")),
      h("p", null, T("用豆包语音的生成式音频模型做游戏音效：撞击 / 环境音 / UI 声 / 生物吼叫 / 角色配音。单次最长 120 秒。Key 是语音控制台的 API Key（请求头 X-Api-Key），不是火山方舟的 ARK_API_KEY；模型需要在语音控制台开通。")),
      config.sfxBlocker !== null && config.sfxBlocker !== undefined
        ? h("div", { className: "SPR_note", "data-kind": "error" }, config.sfxBlocker)
        : null,
      h(
        "div",
        { className: "SPR_fields" },
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("API Key")),
          h("input", {
            className: "SPR_input",
            type: "password",
            autoComplete: "off",
            "data-testid": "cfg-sfx-key",
            placeholder: config.sfxApiKeySet ? T("已配置 {n0}（留空表示不修改）", { n0: config.sfxApiKeyHint }) : T("粘贴语音控制台 API Key"),
            value: sfxKey,
            onChange: (event) => setSfxKey(event.target.value)
          })
        ),
        h(
          "div",
          { className: "SPR_toolbar" },
          h(Btn, { primary: true, disabled: sfxKey.trim() === "", onClick: () => void run(async () => { await api.saveConfig({ sfxApiKey: sfxKey }); setSfxKey(""); }, T("音效 API Key 已保存")) }, T("保存 Key")),
          h(Btn, { disabled: config.sfxApiKeySet !== true, onClick: () => void run(() => api.saveConfig({ clearSfxApiKey: true }), T("已清除音效 API Key")) }, T("清除 Key")),
          h(
            BusyBtn,
            {
              busy: testing === "sfx",
              busyText: T("正在生成测试音效…"),
              disabled: testing !== null || config.sfxApiKeySet !== true,
              onClick: async () => {
                setTesting("sfx");
                await run(() => api.testSfx(), (value) => T("连接正常：{n0}", { n0: value.message ?? "" }));
                setTesting(null);
              }
            },
            T("测试连接（会真实生成一条极短音效，产生少量费用）")
          )
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("API 地址")),
          h("input", {
            className: "SPR_input",
            value: config.sfxBaseUrl ?? "",
            onChange: (event) => void patch({ sfxBaseUrl: event.target.value }),
            placeholder: "https://openspeech.bytedance.com"
          })
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("默认模型")),
          h("input", {
            className: "SPR_input",
            value: config.sfxModel ?? "seed-audio-1.0",
            onChange: (event) => void patch({ sfxModel: event.target.value }),
            placeholder: "seed-audio-1.0"
          })
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("默认输出格式")),
          h(
            "select",
            { className: "SPR_input", value: config.sfxFormat ?? "wav", onChange: (event) => void patch({ sfxFormat: event.target.value }) },
            (config.sfxFormats ?? [{ id: "wav" }, { id: "mp3" }, { id: "ogg_opus" }]).map((format) => h("option", { key: format.id, value: format.id }, sfxFormatLabel(format.id)))
          )
        ),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("默认采样率")),
          h(
            "select",
            { className: "SPR_input", value: String(config.sfxSampleRate ?? 24000), onChange: (event) => void patch({ sfxSampleRate: Number(event.target.value) }) },
            (config.sfxSampleRates ?? [16000, 24000, 44100, 48000]).map((rate) => h("option", { key: String(rate), value: String(rate) }, `${rate} Hz`))
          )
        ),
        h(NumField, {
          label: T("请求超时（毫秒）"),
          value: config.sfxTimeoutMs ?? 300000,
          min: 30000,
          max: 900000,
          onChange: (value) => void patch({ sfxTimeoutMs: value })
        })
      ),
      h(
        "p",
        { className: "SPR_hint" },
        T("文档："),
        config.sfxDocsUrl ? h("a", { className: "SPR_link", href: config.sfxDocsUrl, target: "_blank", rel: "noreferrer" }, config.sfxDocsUrl) : null,
        T(" · 控制台："),
        config.sfxConsoleUrl ? h("a", { className: "SPR_link", href: config.sfxConsoleUrl, target: "_blank", rel: "noreferrer" }, config.sfxConsoleUrl) : null
      )
    ),

    h(
      "details",
      { className: "SPR_settingsGroup" },
      groupHead(T("功能管理"), hiddenNow.length === 0 ? T("全部可见") : T("{n0} 项已隐藏", { n0: hiddenNow.length })),
      h("p", null, T("隐藏不用的功能。隐藏后界面里不再出现它的页签与侧栏菜单项，对话里的 AI 也无法调用它（工具会直接报错）。随时可以再打开，已有的项目数据不会被删除。")),
      h(
        "div",
        { className: "SPR_featureList" },
        MODULES.map((entry) => {
          const isHidden = hiddenNow.includes(entry.key);
          return h(
            "label",
            {
              key: entry.key,
              className: "SPR_featureRow",
              "data-hidden": isHidden ? "true" : "false",
              "data-feature": entry.key
            },
            h("input", {
              type: "checkbox",
              className: "SPR_featureCheck",
              "data-testid": `cfg-feature-${entry.key}`,
              checked: !isHidden,
              onChange: (event) => toggleFeature(entry.key, event.target.checked)
            }),
            h(
              "span",
              { className: "SPR_featureText" },
              h(
                "span",
                { className: "SPR_featureTitle" },
                entry.title,
                entry.experimental === true ? h("span", { className: "SPR_expTag" }, T("实验性")) : null
              ),
              h("span", { className: "SPR_featureHint" }, entry.hint)
            ),
            h("span", { className: "SPR_featureState" }, isHidden ? T("已隐藏") : T("显示中"))
          );
        })
      ),
      hiddenNow.length === 0
        ? h("p", { className: "SPR_hint" }, T("当前功能全部可见。"))
        : h(
            "p",
            { className: "SPR_hint" },
            T("已隐藏 {n0} 个功能：{n1}。隐藏的模块在对话里同样不可调用。", {
              n0: hiddenNow.length,
              n1: MODULES.filter((entry) => hiddenNow.includes(entry.key)).map((entry) => entry.title).join("、")
            })
          )
    ),

    /**
     * 素材互操作：本机路径导入 + ComfyUI 工作流文件解析。
     *
     * 两个按钮都**不花钱**（本地读盘 / 只读 /object_info），所以没有付费确认；
     * 路径由宿主读，浏览器只传路径字符串——100MB 的视频也不会变成 133MB 的 base64。
     */
    h(
      "details",
      { className: "SPR_settingsGroup" },
      groupHead(T("素材互操作"), T("本机路径 / 工作流文件")),
      h("p", null, T("宿主直接读本机文件（不经过浏览器 base64）：支持图片 / 视频 / 目录批量；工作流文件支持 ComfyUI 的 API 与界面两种格式。只读你显式给出的路径，不会扫描其它目录。")),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(
          "select",
          {
            className: "SPR_input",
            "data-testid": "cfg-import-target",
            value: importTarget,
            onChange: (event) => setImportTarget(event.target.value)
          },
          h("option", { value: "project-source" }, T("项目源图")),
          h("option", { value: "project-video" }, T("项目视频槽位")),
          h("option", { value: "image-ref" }, T("图片任务参考图")),
          h("option", { value: "image-item" }, T("图片任务产物")),
          h("option", { value: "sequence-ref" }, T("序列帧参考素材"))
        ),
        importTarget === "project-source" || importTarget === "project-video"
          ? h("input", {
              className: "SPR_input",
              "data-testid": "cfg-import-project",
              placeholder: T("项目 id（p…）"),
              value: importProjectId,
              onChange: (event) => setImportProjectId(event.target.value)
            })
          : h("input", {
              className: "SPR_input",
              "data-testid": "cfg-import-job",
              placeholder: T("任务 id（i… / s…）"),
              value: importJobId,
              onChange: (event) => setImportJobId(event.target.value)
            }),
        importTarget === "project-video"
          ? h(
              "select",
              { className: "SPR_input", value: importKey, onChange: (event) => setImportKey(event.target.value) },
              h("option", { value: "turn" }, T("转圈视频")),
              ["front", "downLeft", "left", "upLeft", "back", "upRight", "right", "downRight"].map((key) =>
                h("option", { key, value: key }, key)
              )
            )
          : null,
        importTarget === "sequence-ref"
          ? h(
              "select",
              { className: "SPR_input", value: importKind, onChange: (event) => setImportKind(event.target.value) },
              h("option", { value: "referenceImage" }, T("参考图")),
              h("option", { value: "referenceVideo" }, T("参考视频")),
              h("option", { value: "firstFrame" }, T("首帧图")),
              h("option", { value: "lastFrame" }, T("尾帧图"))
            )
          : null
      ),
      h("input", {
        className: "SPR_input",
        "data-testid": "cfg-import-path",
        placeholder: T("本机绝对路径（文件或目录）"),
        value: importPath,
        onChange: (event) => setImportPath(event.target.value)
      }),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(Btn, { primary: true, busy: importBusy, onClick: () => void runPathImport() }, T("从本机路径导入")),
        h(Btn, { busy: importBusy, onClick: () => void runWorkflowImport() }, T("解析工作流文件"))
      ),
      importNotice === null
        ? null
        : h("p", { className: "SPR_hint", "data-testid": "cfg-import-notice" }, importNotice.text)
    ),

    h(
      "details",
      { className: "SPR_settingsGroup" },
      groupHead(T("数据位置"), T("数据目录")),
      h(
        "p",
        null,
        T("所有项目（源图、绿幕图、视频、序列帧、整图）都保存在：") ,
        h("code", null, config.dataRoot)
      ),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(Btn, { onClick: () => void run(() => api.saveConfig({}), T("已刷新")) }, T("重新读取配置"))
      )
    )
  );
}

  return ConfigSection;
}
