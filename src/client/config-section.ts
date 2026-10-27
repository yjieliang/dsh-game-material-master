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

  return h(
    "section",
    { className: "SPR_settings" },
    h("h2", { style: { margin: 0, fontSize: 15 } }, T("游戏素材大师")),
    h("p", { className: "SPR_hint" }, T("配置生图 / 生视频的模型与整条流水线的默认参数。Key 只保存在本机 DSH 数据目录下的 game-material-master/config.json（真实路径见文末「数据位置」），界面里始终脱敏显示。")),

    notice !== null
      ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text)
      : null,

    h(
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("生图后端")),
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
            h("option", { value: "custom" }, T("自定义生图模型（OpenAI / ComfyUI / SD WebUI）"))
          )
        )
      ),
      h("p", { className: "SPR_hint" }, T("当前生效：{n0}", { n0: config.imageProviderSummary ?? "" })),
      config.imageProviderBlocker
        ? h("div", { className: "SPR_note", "data-kind": "error" }, T("还不能开跑：{n0}", { n0: config.imageProviderBlocker }))
        : h("div", { className: "SPR_note", "data-kind": "ok" }, T("后端已就绪，可以开跑。"))
    ),

    h(
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("火山方舟（生图）"), imageProvider === "ark" ? h("span", { className: "SPR_badge" }, T("当前使用")) : null),
      h("p", null, config.ffmpeg?.ok === true ? T("ffmpeg 可用：{n0}", { n0: config.ffmpeg.version }) : T("ffmpeg 不可用：{n0}", { n0: config.ffmpeg?.error ?? T("未知") })),
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


    h("div", {className:"SPR_settingsGroup", "data-testid":"cfg-toapis"},
      h("h3",null,"ToAPIs"),
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
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("自定义生图模型"), imageProvider === "custom" ? h("span", { className: "SPR_badge" }, T("当前使用")) : null),
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

    h(
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("MiniMax（图生视频）")),
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
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("本地 ComfyUI（图生视频）")),
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

    h(
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("新建项目的默认参数")),
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

    h(
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("音乐生成（谱乐 AI）")),
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
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("谱曲模式（本地 MIDI）")),
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
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("音效生成（火山引擎 Seed-Audio）")),
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
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("功能管理")),
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

    h(
      "div",
      { className: "SPR_settingsGroup" },
      h("h3", null, T("数据位置")),
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
