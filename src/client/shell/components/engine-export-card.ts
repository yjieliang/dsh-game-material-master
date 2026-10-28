/**
 * 引擎导出卡（模块① 阶段④ / 模块③ 合成之后**共用**）。
 *
 * 为什么放在 shell/components 而不是某个 feature 里：两个模块的导出入口完全同形
 * （一份整图 → manifest / Godot / Aseprite / 逐帧 PNG / zip），只是传给宿主的目标
 * 一个是 projectId、一个是 jobId。复制两份必然漂移，而 features 之间不许互相 import
 * （verify-arch 会拦），所以做成一个只吃 props 的展示组件，由两个模块各自挂。
 *
 * 这一层**不做任何导出计算**：勾选内容 / 帧率原样交给宿主 exportSprite，宿主再按
 * manifest 逐帧校验、落盘、打包。界面只负责「勾什么、看结果、点下载」。
 */

export interface EngineExportCardDeps {
  React: any;
  h: any;
  T: any;
  Btn: any;
  BusyBtn: any;
  msg: any;
}

/** 可勾选的内容 id（与宿主 exportman 的 SPRITE_EXPORT_FORMATS 一致）。 */
const FORMAT_IDS = ["sheet", "frames", "manifest", "godot", "aseprite", "zip"] as const;

/** 没有配置时（或宿主读不到配置）的兜底勾选：与 DEFAULT_CONFIG.exportDefaults 一致。 */
const FALLBACK_CHECKED: Record<string, boolean> = { manifest: true, sheet: false, frames: false, godot: false, aseprite: false, zip: false };

function checkedFromIds(ids: unknown): Record<string, boolean> {
  const next = { ...FALLBACK_CHECKED };
  for (const id of Object.keys(next)) next[id] = false;
  if (Array.isArray(ids)) {
    for (const id of ids) {
      if (typeof id === "string" && (FORMAT_IDS as readonly string[]).includes(id)) next[id] = true;
    }
  }
  return next;
}

export function createEngineExportCard(deps: EngineExportCardDeps) {
  const { React, h, T, Btn, BusyBtn, msg } = deps;

  /** 内容 → 中文标签（在渲染期取，语言切换后跟着变）。 */
  const labels = (): Array<{ id: string; label: string }> => [
    { id: "sheet", label: T("整图 PNG") },
    { id: "frames", label: T("逐帧序列") },
    { id: "manifest", label: T("manifest 清单") },
    { id: "godot", label: T("Godot SpriteFrames") },
    { id: "aseprite", label: T("Aseprite JSON") },
    { id: "zip", label: T("打包成 zip") }
  ];

  return function EngineExportCard(props: any) {
    const api = props.api;
    const target = props.target ?? {};
    const targetKey = String(target.jobId ?? target.projectId ?? "");
    const assetBase = props.assetBase ?? "";
    const ready = props.ready !== false;
    const lastExport = props.lastExport ?? null;
    const [checked, setChecked] = React.useState(checkedFromIds(["manifest"]));
    const [fps, setFps] = React.useState(10);
    const [busy, setBusy] = React.useState(false);
    const [result, setResult] = React.useState(null);
    const [error, setError] = React.useState("");

    // 首次打开按配置的 exportDefaults 勾选（设计 §9.1）；读不到就保持兜底。
    React.useEffect(() => {
      let cancelled = false;
      if (typeof api?.getConfig !== "function") return undefined;
      Promise.resolve(api.getConfig())
        .then((cfg: any) => {
          if (cancelled) return;
          const ids = Array.isArray(cfg?.exportDefaults) && cfg.exportDefaults.length > 0 ? cfg.exportDefaults : ["manifest"];
          setChecked(checkedFromIds(ids));
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [targetKey]);

    const chosen = FORMAT_IDS.filter((id) => checked[id] === true);
    const toggle = (id: string): void => setChecked({ ...checked, [id]: checked[id] !== true });
    const exportNow = (): void => {
      if (busy || chosen.length === 0 || !ready) return;
      const payload: any = { formats: chosen.slice(), fps };
      if (typeof target.projectId === "string") payload.projectId = target.projectId;
      if (typeof target.jobId === "string") payload.jobId = target.jobId;
      setBusy(true);
      setError("");
      void (async () => {
        try {
          const out = await api.exportSprite(payload);
          setResult(out ?? null);
          // 把这次的选择记成默认勾选（只改 exportDefaults 一个键）。
          if (typeof api?.saveConfig === "function") {
            try {
              await api.saveConfig({ exportDefaults: chosen.slice() });
            } catch {
              // 记默认值失败不影响导出本身
            }
          }
          props.setNotice?.({
            kind: "ok",
            text: T("引擎导出完成：{n0} 个文件（{n1} 帧）", {
              n0: Number(out?.counts?.files ?? out?.files?.length ?? 0),
              n1: Number(out?.counts?.frames ?? 0)
            })
          });
        } catch (err) {
          setError(msg === undefined ? String((err as any)?.message ?? err) : msg(err));
        } finally {
          setBusy(false);
        }
      })();
    };

    const files: string[] = Array.isArray(result?.files) ? result.files : [];
    const zip = typeof result?.zip === "string" ? result.zip : "";
    const base = typeof result?.assetBase === "string" && result.assetBase !== "" ? result.assetBase : assetBase;
    /** 结果列表里只展示「顶层产物」；逐帧 PNG 有几十张，用文字说数量就够了。 */
    const shown = files.filter((file: string) => file !== zip && !/\/frames\//u.test(file));
    const frameCount = Number(result?.manifest?.columns ?? 0) * Number(result?.manifest?.rows ?? 0);
    const warnings: string[] = Array.isArray(result?.warnings) ? result.warnings : [];

    return h(
      "div",
      { className: "SPR_card", "data-testid": "engine-export" },
      h("div", { className: "SPR_cardHead" }, h("h3", null, T("引擎导出"))),
      h(
        "p",
        { className: "SPR_hint" },
        T("把整图导出成引擎直接能用的格式：运行时 manifest、Godot SpriteFrames、Aseprite JSON、逐帧 PNG，可再打成一个 zip。全部在本机完成，不消耗任何额度。")
      ),
      h(
        "div",
        { className: "SPR_fields" },
        labels().map((item) =>
          h(
            "label",
            {
              key: item.id,
              className: "SPR_check",
              style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" },
              "data-testid": "engine-export-" + item.id
            },
            h("input", {
              type: "checkbox",
              checked: checked[item.id] === true,
              disabled: busy,
              onChange: () => toggle(item.id)
            }),
            h("span", null, item.label)
          )
        ),
        h(
          "label",
          { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12 } },
          h("span", { className: "SPR_fieldLabel" }, T("播放帧率（fps）")),
          h("input", {
            className: "SPR_input",
            type: "number",
            min: 1,
            max: 60,
            step: 1,
            style: { width: 76 },
            value: fps,
            disabled: busy,
            onChange: (event: any) => {
              const next = Math.round(Number(event?.target?.value) || 10);
              setFps(Math.min(60, Math.max(1, next)));
            }
          })
        )
      ),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(
          BusyBtn,
          {
            primary: true,
            busy,
            busyText: T("正在导出…"),
            disabled: chosen.length === 0 || !ready,
            onClick: () => exportNow()
          },
          T("导出到引擎")
        ),
        chosen.length === 0 ? h("span", { className: "SPR_hint" }, T("至少勾选一种内容")) : null,
        ready ? null : h("span", { className: "SPR_hint" }, T("还没有可导出的整图：先完成合成"))
      ),
      error === "" ? null : h("p", { className: "SPR_error" }, error),
      lastExport === null || result !== null
        ? null
        : h("p", { className: "SPR_hint" }, T("上次导出：{n0} 个文件（{n1}）", {
            n0: Array.isArray(lastExport.files) ? lastExport.files.length : 0,
            n1: Array.isArray(lastExport.formats) ? lastExport.formats.join(" / ") : ""
          })),
      result === null
        ? null
        : h(
            "div",
            null,
            h(
              "p",
              { className: "SPR_hint" },
              T("已导出 {n0} 个文件：{n1} 帧 / {n2} 个动画，{n3} fps", {
                n0: Number(result?.counts?.files ?? files.length),
                n1: frameCount,
                n2: Number(result?.counts?.animations ?? 0),
                n3: Number(result?.manifest?.fps ?? fps)
              })
            ),
            zip === ""
              ? null
              : h(
                  "div",
                  { className: "SPR_toolbar" },
                  h("a", { className: "SPR_link", href: base + zip, download: "", "data-testid": "engine-export-zip" }, T("下载 zip 包"))
                ),
            h(
              "ul",
              { className: "SPR_logList", style: { marginTop: 6 } },
              shown.map((file: string) =>
                h(
                  "li",
                  { key: file },
                  h("a", { className: "SPR_link", href: base + file, download: "" }, file.replace(/^out\/engine\/[^/]+\//u, ""))
                )
              )
            ),
            warnings.length === 0
              ? null
              : h(
                  "ul",
                  { className: "SPR_logList" },
                  warnings.map((text: string, index: number) => h("li", { key: index }, text))
                )
          )
    );
  };
}
