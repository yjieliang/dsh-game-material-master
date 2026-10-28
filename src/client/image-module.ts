/**
 * ImageModule：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 */

import { markRender } from "./platform/perf.js";

export interface ImageRuntime {
  React: any;
  scheduler: any;
  h: any;
  T: any;
  useLocaleTick: any;
  useStudioIntent: any;
  msg: any;
  mergeDrafts: any;
  askNewName: any;
  Chip: any;
  StatusChip: any;
  Btn: any;
  NumField: any;
  useGlobalConfig: any;
  GlobalModelField: any;
  usePendingTasks: any;
  MediaBox: any;
  BusyBtn: any;
  BusyBadge: any;
  ReviewModeBar: any;
  ApproveBtn: any;
  readFileBase64: any;
  UploadBox: any;
  KeyingFields: any;
  CopyIdButton: any;
  JobSidebar: any;
  K_IMG_JOB: any;
  K_IMG_ITEM: any;
  K_IMG_KEY: any;
  K_IMG_UPLOAD: any;
  K_IMG_CREATE: any;
  JobLogPanel: any;
}

export function createImageModule(rt: ImageRuntime) {
  const { React, h, T, scheduler, useLocaleTick, useStudioIntent, msg, mergeDrafts, askNewName, Chip, StatusChip, Btn, NumField, useGlobalConfig, GlobalModelField, usePendingTasks, MediaBox, BusyBtn, BusyBadge, ReviewModeBar, ApproveBtn, readFileBase64, UploadBox, KeyingFields, CopyIdButton, JobSidebar, K_IMG_JOB, K_IMG_ITEM, K_IMG_KEY, K_IMG_UPLOAD, K_IMG_CREATE, JobLogPanel } = rt;

function ImageModule(props) {
  markRender("ImageModule");
  useLocaleTick();
  const api = props.api;
  const [jobs, setJobs] = React.useState([]);
  const [jobId, setJobId] = React.useState(null);
  const [job, setJob] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [promptDraft, setPromptDraft] = React.useState("");
  const [suffixDraft, setSuffixDraft] = React.useState("");
  const [settingsDraft, setSettingsDraft] = React.useState({});
  const [keyingDraft, setKeyingDraft] = React.useState({});
  const globalConfig = useGlobalConfig(api);
  // 去背后端的中文标签（设置页可切 keygreen / birefnet / auto）。
  const matteBackendLabel = (backend) =>
    backend === "birefnet" ? T("BiRefNet 模型") : backend === "auto" ? T("自动") : T("绿幕");
  // 「正在调用接口」的记账表（上传走自己的 uploading 状态，不在这里）。
  const tasks = usePendingTasks();
  // 深链接：切到某一个图片任务。
  const intent = useStudioIntent();
  /**
   * 上一次从宿主读到的草稿（连同任务 id）。
   *
   * 有任务在跑时这里每 2.5 秒 `load()` 一次；无条件覆盖草稿的话，用户正在
   * 改提示词 / 尺寸时会被打回原形（同模块①的视频提示词）。判定见 `mergeDrafts`。
   */
  const loadedDrafts = React.useRef({ id: null, prompt: "", suffix: "", settings: {}, keying: {} });
  const imageSaveQueue = React.useRef(Promise.resolve());

  React.useEffect(() => {
    if (intent === null) return;
    if (intent.module === "image" && typeof intent.jobId === "string") setJobId(intent.jobId);
  }, [intent]);

  const busy = (job !== null && (job.items ?? []).some((item) => item.status === "running")) || tasks.active;

  const refresh = React.useCallback(async () => {
    try {
      const result = await api.listImageJobs();
      setJobs(result.jobs ?? []);
      return result.jobs ?? [];
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return [];
    }
  }, [api]);

  const load = React.useCallback(async (id) => {
    if (id === null) return;
    try {
      const next = await api.getImageJob(id);
      const previous = loadedDrafts.current;
      const force = previous.id !== id;
      const settings = { ...(next.settings ?? {}) };
      const keying = { ...(next.keying ?? {}) };
      loadedDrafts.current = { id, prompt: next.prompt ?? "", suffix: next.suffix ?? "", settings, keying };
      setJob(next);
      setPromptDraft((current) => mergeDrafts(current, previous.prompt, next.prompt ?? "", force));
      setSuffixDraft((current) => mergeDrafts(current, previous.suffix, next.suffix ?? "", force));
      setSettingsDraft((current) => mergeDrafts(current, previous.settings, settings, force));
      setKeyingDraft((current) => mergeDrafts(current, previous.keying, keying, force));
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    }
  }, [api]);

  React.useEffect(() => {
    void (async () => {
      const list = await refresh();
      if (list.length > 0) setJobId((current) => current ?? list[0].id);
    })();
  }, [refresh]);

  React.useEffect(() => {
    if (jobId !== null) void load(jobId);
  }, [jobId, load]);

  React.useEffect(() => {
    if (!busy || jobId === null) return undefined;
    const handle = scheduler.watch({
      key: "image:" + String(jobId),
      intervalMs: 2500,
      immediate: false,
      run: () => load(jobId)
    });
    return () => handle.cancel();
  }, [busy, jobId, load, scheduler]);

  /**
   * 跑一次远程调用。`feedback`（可选）给出 pending 的 key 与文案，
   * 界面据此在对应预览上盖 loading、把按钮变成转圈。
   */
  const run = async (fn, okText = undefined, feedback = undefined) => {
    const invoke = async () => {
      try {
        const value = await fn();
        if (okText !== undefined) setNotice({ kind: "ok", text: okText });
        if (jobId !== null) await load(jobId);
        await refresh();
        return value;
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
        return undefined;
      }
    };
    if (feedback === undefined) return invoke();
    return tasks.run(feedback.key, feedback.label, invoke);
  };

  const create = async () => {
    const name = askNewName(T("新图片任务的名字"), T("图片 {n0}", { n0: new Date().toLocaleString("zh-CN", { hour12: false }) }));
    if (name === null) return;
    await run(async () => {
      const created = await api.createImageJob({ name });
      await refresh();
      setJobId(created.jobId);
    }, T("已新建图片任务"), { key: K_IMG_CREATE, label: T("正在新建任务…") });
  };

  const enqueueImageSave = (patch) => {
    const id = job.id;
    const pending = imageSaveQueue.current.catch(() => undefined).then(() => api.saveImageJob({ jobId: id, ...patch }));
    imageSaveQueue.current = pending;
    return pending;
  };
  const saveJob = (patch) => run(() => enqueueImageSave(patch), T("已保存"));

  const del = async () => {
    if (job === null) return;
    if (typeof window !== "undefined" && !window.confirm(T("删除任务「{n0}」？目录会被整个移除。", { n0: job.name }))) return;
    await run(async () => {
      await api.deleteImageJob({ jobId: job.id });
      const list = await refresh();
      setJobId(list.length > 0 ? list[0].id : null);
      if (list.length === 0) setJob(null);
    }, T("已删除"));
  };

  const upload = async (files, kind) => {
    setUploading(true);
    // 上传本身也要有反馈：走同一个 tasks 表，key 固定成上传中的那批。
    await tasks.run(K_IMG_UPLOAD, T("正在上传 {n0} 个文件…", { n0: files.length }), async () => {
      try {
        for (const file of files) {
          const data = await readFileBase64(file);
          if (kind === "ref") await api.uploadImageRef({ jobId: job.id, name: file.name, data });
          else await api.addImageItem({ jobId: job.id, name: file.name, data });
        }
        await load(job.id);
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
      } finally {
        setUploading(false);
      }
    });
  };

  return h(
    React.Fragment,
    null,
    h(
      "div",
      { className: "SPR_body SPR_pageBody" },
      h(JobSidebar, {
        title: T("图片任务"),
        items: jobs,
        activeId: jobId,
        onSelect: setJobId,
        onCreate: create,
        renderMeta: (item) => T("{n0} 张 · 抠像 {n1}", { n0: item.ready, n1: item.keyed })
      }),
      h(
        "div",
        { className: "SPR_main" },
        notice !== null
          ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text,
              h("span", { style: { marginLeft: 10 } }, h("button", { type: "button", className: "SPR_miniBtn", onClick: () => setNotice(null) }, T("关闭"))))
          : null,
        h(
          "div",
          { className: "SPR_toolbar" },
          h(BusyBtn, { onClick: create, primary: true, busy: tasks.has(K_IMG_CREATE), busyText: T("正在新建…") }, T("新建任务")),
          job !== null ? h(Btn, { onClick: del, danger: true }, T("删除任务")) : null,
          job !== null ? h(CopyIdButton, { id: job.id }) : null,
          h(BusyBadge, { show: tasks.active, text: tasks.label(K_IMG_JOB) ?? tasks.label(K_IMG_KEY) ?? tasks.label(K_IMG_UPLOAD) ?? tasks.firstLabel ?? T("正在调用接口…") })
        ),
        job === null
          ? h("p", { className: "SPR_empty" }, T("请选择或新建一个图片任务"))
          : h(
              React.Fragment,
              null,
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("① 提示词"))),
                h("p", { className: "SPR_hint" }, T("统一附加提示词会接在主提示词后面，用来写跨批次的共同要求。")),
                h("textarea", {
                  className: "SPR_area",
                  placeholder: T("描述你要生成的图片…"),
                  value: promptDraft,
                  onChange: (event) => setPromptDraft(event.target.value),
                  onBlur: () => {
                    if (promptDraft !== (job.prompt ?? "")) void saveJob({ prompt: promptDraft });
                  }
                }),
                h("textarea", {
                  className: "SPR_area",
                  style: { minHeight: 60 },
                  placeholder: T("统一附加提示词（可留空）"),
                  value: suffixDraft,
                  onChange: (event) => setSuffixDraft(event.target.value),
                  onBlur: () => {
                    if (suffixDraft !== (job.suffix ?? "")) void saveJob({ suffix: suffixDraft });
                  }
                }),
                h(
                  "div",
                  { className: "SPR_fields" },
                  h(GlobalModelField, { label: T("生图模型"), value: globalConfig?.imageModel ?? globalConfig?.arkModel ?? settingsDraft.model }),
                  h(
                    "label",
                    { className: "SPR_field" },
                    h("span", { className: "SPR_fieldLabel" }, T("尺寸")),
                    h("input", { className: "SPR_input", value: settingsDraft.size ?? "", onChange: (event) => setSettingsDraft({ ...settingsDraft, size: event.target.value }), onBlur: () => void saveJob({ settings: settingsDraft }) })
                  ),
                  h(NumField, { label: T("生成张数（1~8）"), value: settingsDraft.count ?? 1, min: 1, max: 8, onChange: (v) => { setSettingsDraft({ ...settingsDraft, count: v }); void saveJob({ settings: { ...settingsDraft, count: v } }); } })
                ),
                h(
                  "div",
                  { className: "SPR_toolbar" },
                  h(
                    BusyBtn,
                    {
                      primary: true,
                      busy: tasks.has(K_IMG_JOB),
                      busyText: T("正在生成 {n0} 张…", { n0: settingsDraft.count ?? 1 }),
                      disabled: promptDraft.trim() === "" || tasks.has(K_IMG_JOB),
                      onClick: () =>
                        void run(
                          async () => {
                            await enqueueImageSave({ prompt: promptDraft, suffix: suffixDraft, settings: settingsDraft });
                            return api.runImageJob({ jobId: job.id });
                          },
                          T("已开始生成 {n0} 张", { n0: settingsDraft.count ?? 1 }),
                          { key: K_IMG_JOB, label: T("正在生成 {n0} 张图片…", { n0: settingsDraft.count ?? 1 }) }
                        )
                    },
                    T("生成 {n0} 张", { n0: settingsDraft.count ?? 1 })
                  ),
                  h("span", { className: "SPR_refRow" }, T("按当前生图后端的账号价格计费，实际以平台账单为准"))
                )
              ),
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("② 参考图（可留空）"))),
                h("p", { className: "SPR_hint" }, T("最多 10 张。有参考图时走图生图；引用多张时可在提示词里写「图一」「图二」。") ),
                h(UploadBox, { label: T("把参考图拖到这里"), accept: "image/*", multiple: true, busy: uploading || tasks.has(K_IMG_UPLOAD), onFiles: (files) => void upload(files, "ref") }),
                (job.refs ?? []).length === 0
                  ? null
                  : h(
                      "div",
                      { className: "SPR_grid" },
                      (job.refs ?? []).map((ref) =>
                        h(
                          "div",
                          { key: ref.file, className: "SPR_node" },
                          h("img", { className: "SPR_thumb", src: `${job.assetBase}${ref.file}?v=${job.updatedAt}`, alt: ref.name }),
                          h("span", { className: "SPR_refRow" }, ref.name),
                          h("div", { className: "SPR_btnRow" }, h(Btn, { danger: true, onClick: () => void run(() => api.removeImageRef({ jobId: job.id, file: ref.file }), T("已移除参考图")) }, T("移除")))
                        )
                      )
                    )
              ),
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("③ 绿幕抠图"))),
                h("p", { className: "SPR_hint" }, T("开启后每张生成完会自动抠一遍；也可以上传已有图片只做抠像。") ),
                h(
                  "p",
                  { className: "SPR_hint" },
                  T("去背后端：{n0}（在设置页切换；BiRefNet 失败会自动回退绿幕并写明原因）", {
                    n0: matteBackendLabel(globalConfig?.matteBackend)
                  })
                ),
                h(
                  "div",
                  { className: "SPR_toolbar" },
                  h(
                    "select",
                    {
                      className: "SPR_input",
                      style: { width: 220 },
                      value: keyingDraft.enabled ? "on" : "off",
                      onChange: (event) => {
                        const enabled = event.target.value === "on";
                        setKeyingDraft({ ...keyingDraft, enabled });
                        void saveJob({ keying: { enabled } });
                      }
                    },
                    h("option", { value: "off" }, T("不抠像")),
                    h("option", { value: "on" }, T("自动抠绿幕输出 PNG"))
                  ),
                  h(
                    BusyBtn,
                    {
                      busy: tasks.has(K_IMG_KEY),
                      busyText: T("正在抠像…"),
                      onClick: () =>
                        void run(() => api.keyImageJob({ jobId: job.id }), T("已开始抠像"), {
                          key: K_IMG_KEY,
                          label: T("正在抠绿幕…")
                        })
                    },
                    T("按当前参数重新抠像")
                  )
                ),
                h(KeyingFields, { draft: keyingDraft, onChange: (patch) => { const next = { ...keyingDraft, ...patch }; setKeyingDraft(next); void saveJob({ keying: patch }); } }),
                h(UploadBox, { label: T("上传一张已有图片，直接抠成透明 PNG"), accept: "image/*", multiple: false, busy: uploading || tasks.has(K_IMG_UPLOAD), onFiles: (files) => void upload(files, "item") }),
                tasks.has(K_IMG_UPLOAD) ? h(BusyBadge, { show: true, text: tasks.label(K_IMG_UPLOAD) }) : null
              ),
              h(
                "div",
                { className: "SPR_card" },
                h("div", { className: "SPR_cardHead" }, h("h3", null, T("④ 结果（{n0} 张）", { n0: (job.items ?? []).length }))),
                h(ReviewModeBar, { api, module: "image", id: job.id, mode: job.reviewMode, onChanged: () => void load(job.id) }),
                (job.items ?? []).length === 0
                  ? h("p", { className: "SPR_empty" }, T("还没有图片"))
                  : h(
                      "div",
                      { className: "SPR_grid" },
                      (job.items ?? []).map((item, index) => {
                        const itemKey = K_IMG_ITEM(index);
                        const itemBusy = item.status === "running" || tasks.has(itemKey);
                        // 生成的原图（未抠像时就是唯一产物）也要能存下来：
                        // 之前只有「抠像结果」给了下载链接，抠像关掉后整张卡片
                        // 只剩 通过 / 重新生成 / 删除，用户只能右键另存。
                        const rawExt = typeof item.file === "string" && item.file.includes(".")
                          ? item.file.slice(item.file.lastIndexOf(".") + 1).toLowerCase()
                          : "png";
                        // 整批生成时，还没轮到的那些也要盖住（否则旧图看着像「没反应」）
                        const waiting = item.status !== "running" && tasks.has(K_IMG_JOB);
                        const keyingNow = item.status !== "running" && tasks.has(K_IMG_KEY);
                        const overlay = itemBusy || keyingNow || waiting;
                        const overlayText =
                          tasks.label(itemKey) ??
                          (keyingNow ? T("正在抠绿幕…") : waiting ? tasks.label(K_IMG_JOB) ?? T("正在生成…") : T("正在生成…"));
                        return h(
                          "div",
                          { key: index, className: "SPR_node", "data-busy": overlay ? "true" : undefined },
                          h(
                            "div",
                            { className: "SPR_nodeTop" },
                            h("span", { className: "SPR_nodeTitle" }, T("第 {n0} 张", { n0: index + 1 })),
                            overlay ? h(Chip, { kind: "running", text: T("生成中") }) : h(StatusChip, { node: item }),
                            item.source === "uploaded" ? h(Chip, { kind: "empty", text: T("上传") }) : null
                          ),
                          h(
                            MediaBox,
                            { overlay, text: overlayText },
                            item.keyedFile !== undefined
                              ? h("img", { className: "SPR_thumb", src: `${job.assetBase}${item.keyedFile}?v=${item.updatedAt}`, alt: T("抠像结果") })
                              : item.file !== undefined
                                ? h("img", { className: "SPR_thumb", src: `${job.assetBase}${item.file}?v=${item.updatedAt}`, alt: T("生成结果") })
                                : h("div", { className: "SPR_thumbEmpty" }, overlay ? T("生成中…") : T("等待生成"))
                          ),
                          overlay ? h(BusyBadge, { show: true, text: overlayText }) : null,
                          item.backgroundFraction !== undefined
                            ? h("span", { className: "SPR_refRow" }, T("背景占比 {n0}%", { n0: (item.backgroundFraction * 100).toFixed(0) }))
                            : null,
                          item.matte !== undefined
                            ? h(
                                "span",
                                { className: "SPR_refRow" },
                                item.matte.fallbackReason === undefined
                                  ? T("去背：{n0}", { n0: matteBackendLabel(item.matte.backend) })
                                  : T("去背：{n0} · 回退原因：{n1}", { n0: matteBackendLabel(item.matte.backend), n1: item.matte.fallbackReason })
                              )
                            : null,
                          item.error !== undefined ? h("p", { className: "SPR_error" }, item.error) : null,
                          h(
                            "div",
                            { className: "SPR_btnRow" },
                            h(ApproveBtn, {
                              approved: item.approved === true,
                              disabled: overlay || item.status !== "ready",
                              onToggle: () =>
                                void run(
                                  () => api.saveImageJob({ jobId: job.id, index, approved: item.approved !== true }),
                                  item.approved === true ? T("已取消通过") : T("已标记通过")
                                )
                            }),
                            item.file !== undefined
                              ? h("a", { className: "SPR_btn", href: `${job.assetBase}${item.file}`, download: `image-${index + 1}.${rawExt}`, style: { textDecoration: "none" } }, T("下载原图"))
                              : null,
                            item.keyedFile !== undefined
                              ? h("a", { className: "SPR_btn", href: `${job.assetBase}${item.keyedFile}`, download: `keyed-${index + 1}.png`, style: { textDecoration: "none" } }, T("下载 PNG"))
                              : null,
                            item.source === "generated"
                              ? h(
                                  BusyBtn,
                                  {
                                    busy: tasks.has(itemKey),
                                    busyText: T("正在提交…"),
                                    onClick: () =>
                                      void run(() => api.runImageJob({ jobId: job.id, count: index + 1 }), T("已重新生成"), {
                                        key: itemKey,
                                        label: T("正在重新生成第 {n0} 张…", { n0: index + 1 })
                                      })
                                  },
                                  T("重新生成")
                                )
                              : null,
                            h(Btn, { danger: true, disabled: overlay, onClick: () => void run(() => api.removeImageItem({ jobId: job.id, index }), T("已删除")) }, T("删除"))
                          )
                        );
                      })
                    )
              ),
              h(JobLogPanel, { job })
            )
      )
    ),
  );
}

  return ImageModule;
}
