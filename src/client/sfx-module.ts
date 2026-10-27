/**
 * SfxModule：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 */
export interface SfxRuntime {
  React: any;
  h: any;
  T: any;
  useLocaleTick: any;
  useStudioIntent: any;
  msg: any;
  mergeDrafts: any;
  Chip: any;
  Btn: any;
  NumField: any;
  LoadingOverlay: any;
  BusyBtn: any;
  CopyIdButton: any;
  musicAssetUrl: any;
  musicDownloadUrl: any;
  sfxFormatLabel: any;
}

export function createSfxModule(rt: SfxRuntime) {
  const { React, h, T, useLocaleTick, useStudioIntent, msg, mergeDrafts, Chip, Btn, NumField, LoadingOverlay, BusyBtn, CopyIdButton, musicAssetUrl, musicDownloadUrl, sfxFormatLabel } = rt;
function sfxFmtBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${value} B`;
}

function sfxSettingsOf(job) {
  const settings = job?.settings ?? {};
  return {
    format: settings.format ?? "wav",
    sampleRate: Number(settings.sampleRate) || 24000,
    speechRate: Number(settings.speechRate) || 0,
    loudnessRate: Number(settings.loudnessRate) || 0,
    pitchRate: Number(settings.pitchRate) || 0,
    watermark: settings.watermark === true
  };
}

function SfxModule(props) {
  useLocaleTick();
  const api = props.api;
  const intent = useStudioIntent();
  const [config, setConfig] = React.useState(null);
  const [jobs, setJobs] = React.useState([]);
  const [jobId, setJobId] = React.useState(null);
  const [job, setJob] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ name: "", prompt: "", format: "wav", sampleRate: 24000 });
  const [reviewMode, setReviewMode] = React.useState("auto");
  const [creating, setCreating] = React.useState(false);
  const [promptDraft, setPromptDraft] = React.useState("");
  const [settingsDraft, setSettingsDraft] = React.useState(sfxSettingsOf(null));
  const [saving, setSaving] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [exporting, setExporting] = React.useState(null);
  const [exportResult, setExportResult] = React.useState(null);
  const [refBusy, setRefBusy] = React.useState(false);
  const imageInputRef = React.useRef(null);
  const audioInputRef = React.useRef(null);
  const seq = React.useRef(0);
  const loadedDraft = React.useRef({ jobId: null, prompt: "", settings: null });

  const loadConfig = React.useCallback(async () => {
    if (api === undefined) return;
    try {
      setConfig(await api.getConfig());
    } catch {
      // 配置读不到不影响任务浏览；提交时会再检查。
    }
  }, [api]);

  const loadJobs = React.useCallback(async () => {
    if (api === undefined) return [];
    try {
      const result = await api.listSfxJobs();
      const list = result?.jobs ?? [];
      setJobs(list);
      return list;
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return [];
    }
  }, [api]);

  const loadJob = React.useCallback(async (id) => {
    if (api === undefined || typeof id !== "string" || id === "") return undefined;
    const ticket = ++seq.current;
    try {
      const next = await api.getSfxJob({ jobId: id });
      if (ticket !== seq.current) return undefined;
      setJob(next);
      setJobId(id);
      // 左侧列表也要跟着轮询更新：只刷新详情的话，生成完成后列表会一直停在
      // 「0 条 · ⏳」，用户会以为任务没跑完。
      setJobs((current) => {
        const takes = Array.isArray(next.takes) ? next.takes : [];
        const latest = takes[takes.length - 1];
        const summary = {
          id: next.id,
          name: next.name,
          createdAt: next.createdAt,
          updatedAt: next.updatedAt,
          status: next.status,
          busy: next.busy === true,
          takes: takes.length,
          latestDuration: latest?.duration ?? null,
          format: latest?.format ?? null,
          reviewMode: next.reviewMode ?? null
        };
        const exists = current.some((entry) => entry.id === next.id);
        return exists
          ? current.map((entry) => (entry.id === next.id ? { ...entry, ...summary } : entry))
          : [summary, ...current];
      });
      const force = loadedDraft.current.jobId !== next.id;
      const nextPrompt = typeof next.prompt === "string" ? next.prompt : "";
      const nextSettings = sfxSettingsOf(next);
      setPromptDraft((current) => mergeDrafts(current, loadedDraft.current.prompt, nextPrompt, force));
      setSettingsDraft((current) => mergeDrafts(current, loadedDraft.current.settings, nextSettings, force));
      loadedDraft.current = { jobId: next.id, prompt: nextPrompt, settings: nextSettings };
      return next;
    } catch (error) {
      if (ticket === seq.current) setNotice({ kind: "error", text: msg(error) });
      return undefined;
    }
  }, [api]);

  React.useEffect(() => {
    void (async () => {
      await Promise.all([loadConfig(), loadJobs()]);
      setLoading(false);
    })();
  }, [loadConfig, loadJobs]);

  // 深链接：module=sfx&job=f…；没有 job 就落到第一个任务或打开新建。
  React.useEffect(() => {
    if (intent === null || intent.module !== "sfx") return;
    const target = typeof intent.jobId === "string" && intent.jobId !== "" ? intent.jobId : intent.projectId;
    void (async () => {
      if (typeof target === "string" && target !== "") {
        await loadJob(target);
        setCreateOpen(false);
      } else {
        const list = await loadJobs();
        if (list.length > 0) await loadJob(list[0].id);
        else setCreateOpen(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  // 有任务在跑时轮询；用 setInterval（不要依赖 updatedAt，见音乐模块的踩坑）。
  React.useEffect(() => {
    if (job?.busy !== true || jobId === null) return undefined;
    const timer = window.setInterval(() => {
      void loadJob(jobId);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [job?.busy, jobId, loadJob]);

  const saveJob = async () => {
    if (api === undefined || jobId === null) return undefined;
    setSaving(true);
    try {
      const saved = await api.saveSfxJob({ jobId, prompt: promptDraft, settings: settingsDraft });
      setJob(saved);
      const nextPrompt = typeof saved.prompt === "string" ? saved.prompt : promptDraft;
      const nextSettings = sfxSettingsOf(saved);
      loadedDraft.current = { jobId, prompt: nextPrompt, settings: nextSettings };
      setPromptDraft(nextPrompt);
      setSettingsDraft(nextSettings);
      setNotice({ kind: "ok", text: T("提示词与参数已保存") });
      return saved;
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  const generate = async () => {
    if (api === undefined || jobId === null) return;
    if (promptDraft.trim() === "") {
      setNotice({ kind: "error", text: T("先写点内容：要什么声音。") });
      return;
    }
    setGenerating(true);
    try {
      await api.saveSfxJob({ jobId, prompt: promptDraft, settings: settingsDraft });
      const result = await api.runSfxGeneration({ jobId });
      if (result?.started !== true) {
        setNotice({ kind: "error", text: result?.reason ?? T("提交没有启动") });
      } else {
        setNotice({ kind: "ok", text: T("已提交生成：每次生成都会真实计费，请等它跑完。") });
      }
      await loadJob(jobId);
      await loadJobs();
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setGenerating(false);
    }
  };

  const createJob = async () => {
    if (api === undefined) return;
    if (draft.prompt.trim() === "") {
      setNotice({ kind: "error", text: T("先写点内容：要什么声音。") });
      return;
    }
    setCreating(true);
    try {
      const created = await api.createSfxJob({
        name: draft.name.trim() === "" ? undefined : draft.name,
        prompt: draft.prompt,
        settings: { format: draft.format, sampleRate: draft.sampleRate },
        reviewMode
      });
      setJob(created);
      setJobId(created.id);
      setCreateOpen(false);
      setPromptDraft(created.prompt ?? draft.prompt);
      setSettingsDraft(sfxSettingsOf(created));
      loadedDraft.current = { jobId: created.id, prompt: created.prompt ?? draft.prompt, settings: sfxSettingsOf(created) };
      setDraft({ name: "", prompt: "", format: config?.sfxFormat ?? "wav", sampleRate: config?.sfxSampleRate ?? 24000 });
      await loadJobs();
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setCreating(false);
    }
  };

  const removeJob = async () => {
    if (api === undefined || jobId === null) return;
    if (!window.confirm(T("删除音效任务「{n0}」？所有生成与导出都会一起删掉。", { n0: job?.name ?? jobId }))) return;
    try {
      await api.deleteSfxJob({ jobId });
      setJob(null);
      setJobId(null);
      setNotice({ kind: "ok", text: T("任务已删除") });
      await loadJobs();
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    }
  };

  const exportTake = async (takeId, zip) => {
    if (api === undefined || jobId === null) return;
    setExporting(zip === true ? "zip" : takeId);
    try {
      const result = await api.exportSfx(zip === true ? { jobId, zip: true } : { jobId, takeId });
      setExportResult(result);
      setNotice({ kind: "ok", text: T("已导出：{n0}", { n0: result.path ?? result.file ?? "" }) });
      await loadJob(jobId);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setExporting(null);
    }
  };

  const uploadRef = (kind) => async (event) => {
    if (api === undefined || jobId === null) return;
    const file = event?.target?.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    setRefBusy(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
        reader.onerror = () => reject(new Error(T("读取文件失败")));
        reader.readAsDataURL(file);
      });
      const next = await api.uploadSfxRef({ jobId, kind, name: file.name, data: base64 });
      setJob(next);
      setNotice({ kind: "ok", text: T("参考素材已上传") });
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setRefBusy(false);
    }
  };

  const removeRef = async (kind, file = undefined) => {
    if (api === undefined || jobId === null) return;
    setRefBusy(true);
    try {
      const next = await api.removeSfxRef({ jobId, kind, ...(file === undefined ? {} : { file }) });
      setJob(next);
      setNotice({ kind: "ok", text: T("参考素材已删除") });
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setRefBusy(false);
    }
  };

  const approve = async (approved) => {
    if (api === undefined || jobId === null) return;
    try {
      const next = await api.setSfxApproved({ jobId, stage: "generate", approved });
      setJob(next);
      setNotice({ kind: "ok", text: approved ? T("已标记通过") : T("已取消通过") });
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    }
  };

  if (loading) return h("div", { className: "SPR_body" }, h("p", { className: "SPR_empty" }, T("正在读取音效任务…")));
  if (api === undefined) return h("div", { className: "SPR_body" }, h("p", { className: "SPR_empty" }, T("正在挂载游戏素材大师…")));

  const formats = (config?.sfxFormats ?? [{ id: "wav" }, { id: "mp3" }, { id: "ogg_opus" }]).map((format) => ({ id: format.id, label: sfxFormatLabel(format.id) }));
  const sampleRates = config?.sfxSampleRates ?? [16000, 24000, 44100, 48000];
  const takes = job?.takes ?? [];
  const refs = job?.refs ?? { image: null, audios: [] };
  const blocker = job?.blocker ?? config?.sfxBlocker ?? null;

  const createCard = createOpen
    ? h(
        "section",
        { className: "SPR_musicCard", "data-testid": "sfx-create" },
        h("h3", null, T("新建音效")),
        h("p", { className: "SPR_hint" }, T("把它当配音导演脚本写：声源 + 环境 + 强度/节奏 + 大致时长。单次最长 120 秒。")),
        h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("名字（可留空，按提示词自动取）")), h("input", { className: "SPR_input", value: draft.name, onChange: (event) => setDraft({ ...draft, name: event.target.value }) })),
        h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("提示词")), h("textarea", {
          className: "SPR_musicText",
          "data-testid": "sfx-create-prompt",
          rows: 3,
          maxLength: 2048,
          value: draft.prompt,
          placeholder: T("例如：暴雨中的金属撞击，短促有力，约 1 秒，带一点尾音"),
          onChange: (event) => setDraft({ ...draft, prompt: event.target.value })
        })),
        h("div", { className: "SPR_musicGrid2" },
          h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("输出格式")), h("select", { className: "SPR_input", value: draft.format, onChange: (event) => setDraft({ ...draft, format: event.target.value }) }, formats.map((format) => h("option", { key: format.id, value: format.id }, format.label)))),
          h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("采样率")), h("select", { className: "SPR_input", value: String(draft.sampleRate), onChange: (event) => setDraft({ ...draft, sampleRate: Number(event.target.value) }) }, sampleRates.map((rate) => h("option", { key: String(rate), value: String(rate) }, `${rate} Hz`))))
        ),
        h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("审核模式")), h("select", { className: "SPR_input", value: reviewMode, onChange: (event) => setReviewMode(event.target.value) },
          h("option", { value: "auto" }, T("自动审核（生成后自己核对继续）")),
          h("option", { value: "manual" }, T("每一步人工审核（生成后停下等你确认）"))
        )),
        h("div", { className: "SPR_toolbar" },
          h(BusyBtn, { busy: creating, busyText: T("正在创建…"), primary: true, "data-testid": "sfx-create-submit", onClick: () => void createJob() }, T("创建音效任务")),
          h(Btn, { onClick: () => setCreateOpen(false) }, T("取消"))
        ),
        h("p", { className: "SPR_hint" }, T("创建不会调用模型；点「生成」才会真实计费。"))
      )
    : null;

  const main = h(
    "div",
    { className: "SPR_main" },
    notice !== null ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text) : null,
    createCard,
    job === null
      ? h("p", { className: "SPR_empty" }, T("左侧选一个音效任务，或点「新建音效」开始。"))
      : h(
          React.Fragment,
          null,
          h(
            "section",
            { className: "SPR_musicCard", "data-testid": "sfx-job" },
            h("div", { className: "SPR_musicJobHead" },
              h("h3", null, job.name),
              h(CopyIdButton, { id: job.id }),
              h(Chip, { kind: job.busy ? "running" : job.status === "error" ? "error" : takes.length > 0 ? "ready" : "stale", text: job.busy ? T("生成中…") : job.status === "error" ? T("失败") : takes.length > 0 ? T("已完成") : T("还没生成") }),
              job.reviewMode ? h("span", { className: "SPR_musicMeta" }, job.reviewMode === "manual" ? T("每一步人工审核") : T("自动审核")) : null,
              h("span", { className: "SPR_musicMeta" }, T("{n0} 条生成 · 上限 120 秒", { n0: takes.length }))
            ),
            blocker !== null ? h("div", { className: "SPR_note", "data-kind": "error" }, blocker) : null,
            job.error ? h("div", { className: "SPR_note", "data-kind": "error" }, job.error) : null,
            h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("提示词（{n0}/2048）", { n0: promptDraft.length })), h("textarea", {
              className: "SPR_musicText",
              "data-testid": "sfx-prompt",
              rows: 4,
              maxLength: 2048,
              value: promptDraft,
              onChange: (event) => setPromptDraft(event.target.value)
            })),
            h("div", { className: "SPR_musicGrid2" },
              h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("输出格式")), h("select", { className: "SPR_input", value: settingsDraft.format, onChange: (event) => setSettingsDraft({ ...settingsDraft, format: event.target.value }) }, formats.map((format) => h("option", { key: format.id, value: format.id }, format.label)))),
              h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("采样率")), h("select", { className: "SPR_input", value: String(settingsDraft.sampleRate), onChange: (event) => setSettingsDraft({ ...settingsDraft, sampleRate: Number(event.target.value) }) }, sampleRates.map((rate) => h("option", { key: String(rate), value: String(rate) }, `${rate} Hz`)))),
              h(NumField, { label: T("语速（-50~100）"), value: settingsDraft.speechRate, min: -50, max: 100, onChange: (value) => setSettingsDraft({ ...settingsDraft, speechRate: value }) }),
              h(NumField, { label: T("音量（-50~100）"), value: settingsDraft.loudnessRate, min: -50, max: 100, onChange: (value) => setSettingsDraft({ ...settingsDraft, loudnessRate: value }) }),
              h(NumField, { label: T("音调（-12~12）"), value: settingsDraft.pitchRate, min: -12, max: 12, onChange: (value) => setSettingsDraft({ ...settingsDraft, pitchRate: value }) })
            ),
            h("label", { className: "SPR_musicCheck" }, h("input", { type: "checkbox", checked: settingsDraft.watermark, onChange: (event) => setSettingsDraft({ ...settingsDraft, watermark: event.target.checked }) }), T("加 AIGC 节奏水印（默认关）")),
            h("div", { className: "SPR_toolbar" },
              h(BusyBtn, { busy: generating || job.busy === true, busyText: T("正在生成…"), primary: true, "data-testid": "sfx-generate", disabled: blocker !== null || promptDraft.trim() === "", onClick: () => void generate() }, takes.length === 0 ? T("生成（计费）") : T("再生成一条（计费）")),
              h(BusyBtn, { busy: saving, busyText: T("正在保存…"), onClick: () => void saveJob() }, T("保存提示词与参数")),
              h(Btn, { onClick: () => void api.revealSfxJob({ jobId }) }, T("打开任务目录")),
              h(Btn, { danger: true, onClick: () => void removeJob() }, T("删除任务"))
            ),
            h("p", { className: "SPR_hint" }, T("每次生成都会真实计费；失败不会自动重试。参考图最多 1 张，参考音频最多 3 条，两者不能同时用。"))
          ),
          h(
            "section",
            { className: "SPR_musicCard", "data-testid": "sfx-refs" },
            h("h3", null, T("参考素材（可选）")),
            h("div", { className: "SPR_toolbar" },
              h(BusyBtn, { busy: refBusy, busyText: T("上传中…"), onClick: () => imageInputRef.current?.click?.() }, T("上传参考图")),
              h(BusyBtn, { busy: refBusy, busyText: T("上传中…"), onClick: () => audioInputRef.current?.click?.() }, T("上传参考音频")),
              h("input", { ref: imageInputRef, type: "file", accept: "image/png,image/jpeg,image/webp", style: { display: "none" }, onChange: uploadRef("image") }),
              h("input", { ref: audioInputRef, type: "file", accept: "audio/wav,audio/mpeg,audio/ogg,audio/opus", style: { display: "none" }, onChange: uploadRef("audio") })
            ),
            refs.image !== null && refs.image !== undefined
              ? h("div", { className: "SPR_musicSource" },
                  h("img", { className: "SPR_thumbMd", src: musicAssetUrl(job, refs.image.file, refs.image.url), alt: refs.image.name }),
                  h("span", { className: "SPR_musicMeta" }, `${refs.image.name} · ${sfxFmtBytes(refs.image.bytes)}`),
                  h(Btn, { onClick: () => void removeRef("image") }, T("删除参考图"))
                )
              : null,
            (refs.audios ?? []).length > 0
              ? h("div", { className: "SPR_musicSongs" }, (refs.audios ?? []).map((entry, index) =>
                  h("div", { key: entry.file, className: "SPR_musicSong" },
                    h("div", { className: "SPR_musicSongBody" },
                      h("strong", null, T("参考音频 {n0}：{n1}", { n0: index + 1, n1: entry.name })),
                      h("span", { className: "SPR_musicMeta" }, `${sfxFmtBytes(entry.bytes)}${entry.duration ? ` · ${Number(entry.duration).toFixed(1)} 秒` : ""} · 提示词里用 @音频${index + 1}`),
                      h("audio", { className: "SPR_musicAudio", controls: true, preload: "metadata", src: musicAssetUrl(job, entry.file, entry.url) })
                    ),
                    h(Btn, { onClick: () => void removeRef("audio", entry.file) }, T("删除"))
                  )
                ))
              : h("p", { className: "SPR_hint" }, T("参考图与参考音频不能同时使用；单文件上限 10MB，参考音频每条最长 30 秒。"))
          ),
          h(
            "section",
            { className: "SPR_musicCard", "data-testid": "sfx-takes" },
            h("h3", null, T("生成结果（{n0} 条）", { n0: takes.length })),
            job.busy === true ? h(LoadingOverlay, { show: true, text: T("正在生成音效…") }) : null,
            takes.length === 0
              ? h("p", { className: "SPR_hint" }, T("还没有生成。点上面的「生成（计费）」。" ))
              : h("div", { className: "SPR_musicSongs" }, takes.slice().reverse().map((take) =>
                  h("div", { key: take.id, className: "SPR_musicSong", "data-testid": "sfx-take" },
                    h("div", { className: "SPR_musicSongBody" },
                      h("div", { className: "SPR_musicSongHead" },
                        h("strong", null, take.id),
                        h("span", { className: "SPR_musicMeta" }, `${String(take.format).toUpperCase()} · ${take.duration ? `${Number(take.duration).toFixed(2)} 秒` : "—"} · ${sfxFmtBytes(take.bytes)}`),
                        take.originalDuration && take.duration && Math.abs(take.originalDuration - take.duration) > 0.05
                          ? h("span", { className: "SPR_musicMeta" }, T("计费 {n0} 秒", { n0: Number(take.originalDuration).toFixed(2) }))
                          : null
                      ),
                      h("audio", { className: "SPR_musicAudio", controls: true, preload: "metadata", src: musicAssetUrl(job, take.file, take.url) }),
                      h("details", { className: "SPR_musicLyrics" }, h("summary", null, T("生成时用的提示词")), h("pre", null, take.prompt))
                    ),
                    h("div", { className: "SPR_toolbar" },
                      h(BusyBtn, { busy: exporting === take.id, busyText: T("导出中…"), onClick: () => void exportTake(take.id, false) }, T("导出")),
                      h("a", { className: "SPR_link", href: musicDownloadUrl(job, take.file, take.url), download: `${job.name}-${take.id}.${take.format}` }, T("下载"))
                    )
                  )
                )),
            takes.length > 1
              ? h("div", { className: "SPR_toolbar" }, h(BusyBtn, { busy: exporting === "zip", busyText: T("打包中…"), onClick: () => void exportTake(undefined, true) }, T("全部打包导出（zip）")))
              : null,
            exportResult !== null
              ? h("p", { className: "SPR_hint" }, T("已导出：{n0}", { n0: exportResult.path ?? exportResult.file ?? "" }), exportResult.downloadUrl ? h("a", { className: "SPR_link", href: exportResult.downloadUrl }, T("下载")) : null)
              : null
          ),
          h(
            "section",
            { className: "SPR_musicCard" },
            h("div", { className: "SPR_toolbar" },
              h(Btn, { primary: job.stages?.generate?.approved !== true, onClick: () => void approve(job.stages?.generate?.approved !== true) }, job.stages?.generate?.approved === true ? T("取消通过") : T("通过本条音效")),
              h(Btn, { onClick: () => void loadJob(jobId) }, T("刷新"))
            ),
            (job.log ?? []).length > 0
              ? h("details", { className: "SPR_musicLog" }, h("summary", null, T("任务日志（{n0} 条）", { n0: (job.log ?? []).length })), h("ul", null, (job.log ?? []).slice(-10).map((entry, index) => h("li", { key: index }, `${new Date(entry.at).toLocaleTimeString()} · ${entry.message}`))))
              : null
          )
        )
  );

  return h(
    "div",
    { className: "SPR_body SPR_musicBody" },
    h(
      "div",
      { className: "SPR_side" },
      h("div", { className: "SPR_sideTitle" }, T("音效任务（{n0}）", { n0: jobs.length })),
      h(Btn, { primary: true, "data-testid": "sfx-create-open", onClick: () => { setDraft({ name: "", prompt: "", format: config?.sfxFormat ?? "wav", sampleRate: config?.sfxSampleRate ?? 24000 }); setCreateOpen(true); setJob(null); setJobId(null); } }, T("新建音效")),
      jobs.length === 0
        ? h("p", { className: "SPR_hint" }, T("还没有任务。写一句「要什么声音」开始。"))
        : jobs.map((entry) =>
            h(
              "button",
              { key: entry.id, type: "button", className: "SPR_projItem", "data-active": entry.id === jobId ? "true" : "false", onClick: () => void loadJob(entry.id) },
              h("span", { className: "SPR_projNameRow" },
                h("span", { className: "SPR_projName" }, entry.name),
                h(CopyIdButton, { id: entry.id, inline: true })
              ),
              h("span", { className: "SPR_projMeta" }, `${entry.takes ?? 0} 条${entry.latestDuration ? ` · ${Number(entry.latestDuration).toFixed(2)}s` : ""}${entry.busy ? " · ⏳" : ""}`)
            )
          )
    ),
    main
  );
}

  return SfxModule;
}
