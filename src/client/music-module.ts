/**
 * MusicModule：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 */

import { markRender } from "./platform/perf.js";

export interface MusicRuntime {
  React: any;
  h: any;
  activeLang: any;
  T: any;
  useLocaleTick: any;
  buildMusicRequestPrompt: any;
  buildComposeRequestPrompt: any;
  deriveMusicName: any;
  MUSIC_ENGINES: any;
  MUSIC_FORMATS: any;
  MUSIC_EDIT_LIMITS: any;
  useStudioIntent: any;
  msg: any;
  Chip: any;
  Btn: any;
  NumField: any;
  BusyBtn: any;
  BusyBadge: any;
  ReviewModeBar: any;
  CopyIdButton: any;
  musicFmtTime: any;
  musicAssetUrl: any;
  musicDownloadUrl: any;
  makeMusicOps: any;
  musicOpsText: any;
  musicStatusChip: any;
  MusicWave: any;
  openMusicChat: any;
  /** 集中轮询调度器（platform/scheduler；组合根注入） */
  scheduler: any;
}

export function createMusicModule(rt: MusicRuntime) {
  const { React, h, activeLang, T, useLocaleTick, buildMusicRequestPrompt, buildComposeRequestPrompt, deriveMusicName, MUSIC_ENGINES, MUSIC_FORMATS, MUSIC_EDIT_LIMITS, useStudioIntent, msg, Chip, Btn, NumField, BusyBtn, BusyBadge, ReviewModeBar, CopyIdButton, musicFmtTime, musicAssetUrl, musicDownloadUrl, makeMusicOps, musicOpsText, musicStatusChip, MusicWave, openMusicChat, scheduler } = rt;

function MusicModule(props) {
  markRender("MusicModule");
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
  const [workflow, setWorkflow] = React.useState("generate");
  const [kind, setKind] = React.useState("prompt");
  const [prompt, setPrompt] = React.useState("");
  const [lyrics, setLyrics] = React.useState("");
  const [note, setNote] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [instrumental, setInstrumental] = React.useState(false);
  const [preferredEngine, setPreferredEngine] = React.useState("");
  const [reviewMode, setReviewMode] = React.useState("auto");
  const [creating, setCreating] = React.useState(false);
  const [selectedSongId, setSelectedSongId] = React.useState(null);
  const [selectedScoreId, setSelectedScoreId] = React.useState(null);
  const [scorePeaks, setScorePeaks] = React.useState(null);
  const [scoreBusy, setScoreBusy] = React.useState(false);
  const [scoreExporting, setScoreExporting] = React.useState(false);
  const [ops, setOps] = React.useState(makeMusicOps(0));
  const [peaks, setPeaks] = React.useState(null);
  const [audioSrc, setAudioSrc] = React.useState("");
  const [rendering, setRendering] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [exportResult, setExportResult] = React.useState(null);
  const [pendingVersionId, setPendingVersionId] = React.useState(null);
  const [guide, setGuide] = React.useState(null);
  const [showGuide, setShowGuide] = React.useState(false);
  const [actionBusy, setActionBusy] = React.useState(false);
  const seq = React.useRef(0);
  const intentRef = React.useRef(intent);
  intentRef.current = intent;

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
      const result = await api.listMusicJobs();
      const list = result?.jobs ?? [];
      setJobs(list);
      return list;
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return [];
    }
  }, [api]);

  const loadJob = React.useCallback(
    async (id) => {
      if (api === undefined || typeof id !== "string" || id === "") return undefined;
      const ticket = ++seq.current;
      try {
        const next = await api.getMusicJob({ jobId: id });
        if (ticket !== seq.current) return undefined;
        setJob(next);
        setJobId(id);
        const ready = (next.songs ?? []).find((song) => song.status === "succeeded");
        setSelectedSongId((current) => {
          const exists = (next.songs ?? []).some((song) => song.id === current);
          return exists ? current : ready?.id ?? next.songs?.[0]?.id ?? null;
        });
        setSelectedScoreId((current) => {
          const compositions = next.compositions ?? [];
          const exists = compositions.some((entry) => entry.id === current);
          return exists ? current : next.currentScoreId ?? compositions[compositions.length - 1]?.id ?? null;
        });
        return next;
      } catch (error) {
        if (ticket === seq.current) setNotice({ kind: "error", text: msg(error) });
        return undefined;
      }
    },
    [api]
  );

  React.useEffect(() => {
    void (async () => {
      await Promise.all([loadConfig(), loadJobs()]);
      setLoading(false);
    })();
  }, [loadConfig, loadJobs]);

  // 深链接：module=music&job=a…（stage 只影响默认展开的卡片）。
  React.useEffect(() => {
    if (intent === null || intent.module !== "music") return;
    const target = typeof intent.jobId === "string" && intent.jobId !== "" ? intent.jobId : intent.projectId;
    void (async () => {
      if (typeof target === "string" && target !== "") {
        await loadJob(target);
        if (intent.stage === "edit" || intent.stage === "compose") setCreateOpen(false);
        if (typeof intent.score === "string" && intent.score !== "") setSelectedScoreId(intent.score);
      } else {
        const list = await loadJobs();
        if (list.length > 0) await loadJob(list[0].id);
        else setCreateOpen(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  // 切到谱曲模式时默认纯音乐；用户仍可手动取消勾选。
  React.useEffect(() => {
    if (workflow === "compose") setInstrumental(true);
  }, [workflow]);

  // 切换工作流 / 任务时，缓存的创作指南可能不是同一份，清掉重读。
  React.useEffect(() => {
    setGuide(null);
    setShowGuide(false);
  }, [workflow, job?.id]);

  // 有任务在跑时轮询；跑完自动停。走集中调度器：同 key 去重、失败退避、页面隐藏暂停。
  //
  // ⚠️ **不要把 job.updatedAt 放进依赖**：
  // 平台还在排队时，每次 getMusicJob 拿到的 updatedAt 可能完全一样，
  // 依赖 updatedAt 重排会让 effect 不再重跑，轮询只跑一次就停住 ——
  // 表现就是「点完按钮转圈结束、歌不出来，切走再切回才出现」。
  React.useEffect(() => {
    if (job?.busy !== true || jobId === null) return undefined;
    const handle = scheduler.watch({
      key: "music:" + String(jobId),
      intervalMs: 4000,
      immediate: false,
      run: () => loadJob(jobId)
    });
    return () => handle.cancel();
  }, [job?.busy, jobId, loadJob, scheduler]);

  const selectedSong = (job?.songs ?? []).find((song) => song.id === selectedSongId) ?? null;
  const versions = job?.versions ?? [];

  // 切歌：重置编辑参数、重新算波形；已经选过同一首就不要反复覆盖用户的滑杆。
  React.useEffect(() => {
    setAudioSrc(selectedSong === null ? "" : musicAssetUrl(job, selectedSong.file, selectedSong.url));
    setPeaks(null);
    if (selectedSong === null) {
      setOps(makeMusicOps(0));
      return;
    }
    setOps((current) => {
      const same = current.__songId === selectedSong.id;
      return same ? current : { ...makeMusicOps(selectedSong.duration), __songId: selectedSong.id };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSong?.id]);

  React.useEffect(() => {
    if (api === undefined || job === null || selectedSong === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.musicPeaks({ jobId: job.id, songId: selectedSong.id, buckets: 160 });
        if (!cancelled) setPeaks(result?.peaks ?? null);
      } catch {
        if (!cancelled) setPeaks(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, job?.id, selectedSong?.id]);

  // 谱曲版本切换：重新算波形；没有试听音频就清空。
  React.useEffect(() => {
    if (api === undefined || job === null || job.workflow !== "compose" || selectedScoreId === null) {
      setScorePeaks(null);
      return undefined;
    }
    const composition = (job.compositions ?? []).find((entry) => entry.id === selectedScoreId);
    if (composition === undefined || typeof composition.audioFile !== "string" || composition.audioFile === "") {
      setScorePeaks(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.musicPeaks({ jobId: job.id, scoreId: selectedScoreId, buckets: 160 });
        if (!cancelled) setScorePeaks(result?.peaks ?? null);
      } catch {
        if (!cancelled) setScorePeaks(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, job?.id, job?.updatedAt, selectedScoreId]);

  // 渲染完成：把新版本设为当前试听源。
  React.useEffect(() => {
    if (pendingVersionId === null || job === null) return;
    const version = (job.versions ?? []).find((entry) => entry.id === pendingVersionId);
    if (version === undefined) return;
    if (version.status === "ready") {
      setAudioSrc(musicAssetUrl(job, version.file, version.url));
      setNotice({ kind: "ok", text: T("版本已就绪：{n0}", { n0: version.label }) });
      setPendingVersionId(null);
    } else if (version.status === "error") {
      setNotice({ kind: "error", text: T("版本渲染失败：{n0}", { n0: version.error ?? "" }) });
      setPendingVersionId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVersionId, job?.updatedAt]);

  const withApi = async (run, setBusy = undefined) => {
    if (api === undefined) return;
    if (setBusy !== undefined) setBusy(true);
    try {
      await run();
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      if (setBusy !== undefined) setBusy(false);
    }
  };

  const submitCreate = async () => {
    if (api === undefined) return;
    const compose = workflow === "compose";
    const text = compose ? prompt : kind === "lyrics" ? lyrics : prompt;
    if (text.trim() === "") {
      setNotice({ kind: "error", text: compose ? T("先写点内容：这段音乐的想法或主题。") : T("先写点内容：灵感提示词或完整歌词都可以。") });
      return;
    }
    // 设置是另一个弹窗：回到音乐页时 config 可能是旧快照，提交前现读一次。
    let latestConfig = config;
    try {
      latestConfig = await api.getConfig();
      setConfig(latestConfig);
    } catch {
      // 读不到就用旧快照；真正的错误会在 generate 时暴露。
    }
    if (compose) {
      if (latestConfig?.musicScoreStatus?.blocker !== null && latestConfig?.musicScoreStatus?.blocker !== undefined) {
        setNotice({ kind: "error", text: latestConfig.musicScoreStatus.blocker });
        return;
      }
    } else if (latestConfig?.musicBlocker !== null && latestConfig?.musicBlocker !== undefined) {
      setNotice({ kind: "error", text: latestConfig.musicBlocker });
      return;
    }
    setCreating(true);
    try {
      if (compose) {
        const name = deriveMusicName("prompt", prompt, "");
        const created = await api.createMusicJob({
          name,
          source: { kind: "prompt", prompt, lyrics: instrumental ? "" : lyrics, note, title, tags, instrumental, preferredEngine: undefined },
          settings: { engine: "suno", mode: "custom", ...(typeof latestConfig?.musicModel === "string" && latestConfig.musicModel !== "" ? { model: latestConfig.musicModel } : {}) },
          reviewMode,
          workflow: "compose"
        });
        setJob(created);
        setJobId(created.id);
        setSelectedSongId(null);
        setSelectedScoreId(null);
        setCreateOpen(false);
        setJobs((current) => [{ id: created.id, name: created.name, workflow: "compose", songsReady: 0, songsTotal: 0, versions: 0, compositions: 0, engines: [], busy: false, updatedAt: created.updatedAt }, ...current.filter((entry) => entry.id !== created.id)]);
        await openMusicChat(
          buildComposeRequestPrompt({
            jobId: created.id,
            jobName: created.name,
            prompt,
            lyrics,
            note,
            title,
            instrumental,
            reviewMode,
            lang: activeLang(),
            scoreStatus: latestConfig?.musicScoreStatus
          })
        );
        setNotice({ kind: "ok", text: T("已在新对话里开始谱曲：{n0}", { n0: created.name }) });
      } else {
        const name = deriveMusicName(kind, prompt, lyrics);
        const created = await api.createMusicJob({
          name,
          source: { kind, prompt, lyrics, note, title, tags, instrumental, preferredEngine: preferredEngine || undefined },
          settings: preferredEngine === "" ? {} : { engine: preferredEngine },
          reviewMode,
          workflow: "generate"
        });
        setJob(created);
        setJobId(created.id);
        setSelectedSongId(null);
        setSelectedScoreId(null);
        setCreateOpen(false);
        setJobs((current) => [{ id: created.id, name: created.name, workflow: "generate", songsReady: 0, songsTotal: 0, versions: 0, compositions: 0, engines: [], busy: false, updatedAt: created.updatedAt }, ...current.filter((entry) => entry.id !== created.id)]);
        await openMusicChat(
          buildMusicRequestPrompt({
            jobId: created.id,
            jobName: created.name,
            kind,
            prompt,
            lyrics,
            note,
            title,
            tags,
            instrumental,
            preferredEngine,
            reviewMode,
            lang: activeLang()
          })
        );
        setNotice({ kind: "ok", text: T("已在新对话里开始生成：{n0}", { n0: created.name }) });
      }
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setCreating(false);
    }
  };

  const refresh = async () => {
    if (job === null) return;
    await withApi(async () => {
      await api.refreshMusicJob({ jobId: job.id });
      await loadJob(job.id);
      await loadJobs();
    }, setActionBusy);
  };

  const removeJob = async () => {
    if (job === null) return;
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(T("删除音乐任务「{n0}」？歌曲与所有版本都会一起删掉。", { n0: job.name }))) return;
    await withApi(async () => {
      await api.deleteMusicJob({ jobId: job.id });
      setJob(null);
      setJobId(null);
      setSelectedSongId(null);
      await loadJobs();
    }, setActionBusy);
  };

  const reveal = async () => {
    if (job === null) return;
    await withApi(async () => {
      await api.revealMusicJob({ jobId: job.id });
    });
  };

  const renderEdit = async (preview) => {
    if (job === null || selectedSong === null) return;
    const start = Number(ops.start) || 0;
    const end = Number(ops.end) || 0;
    if (!(end > start)) {
      setNotice({ kind: "error", text: T("裁剪终点必须大于起点。") });
      return;
    }
    setRendering(true);
    try {
      const result = await api.renderMusicEdit({
        jobId: job.id,
        songId: selectedSong.id,
        ops: { ...ops, start, end, __songId: undefined },
        preview: preview === true,
        by: "human"
      });
      if (result?.versionId !== undefined) {
        setPendingVersionId(result.versionId);
        if (result.reused === true) {
          const existing = (job.versions ?? []).find((entry) => entry.id === result.versionId);
          if (existing !== undefined) setAudioSrc(musicAssetUrl(job, existing.file, existing.url));
        }
      }
      await loadJob(job.id);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setRendering(false);
    }
  };

  const saveVersion = async (versionId) => {
    if (job === null) return;
    await withApi(async () => {
      await api.saveMusicVersion({ jobId: job.id, versionId });
      await loadJob(job.id);
    }, setActionBusy);
  };

  const deleteVersion = async (versionId) => {
    if (job === null) return;
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(T("删除这个版本？原曲不会受影响。"))) return;
    await withApi(async () => {
      await api.deleteMusicVersion({ jobId: job.id, versionId });
      await loadJob(job.id);
    }, setActionBusy);
  };

  const approveSong = async (song) => {
    if (job === null) return;
    await withApi(async () => {
      await api.setMusicApproved({ jobId: job.id, songId: song.id, approved: song.approved !== true });
      await loadJob(job.id);
    }, setActionBusy);
  };

  const getWav = async () => {
    if (job === null || selectedSong === null) return;
    await withApi(async () => {
      await api.getMusicWav({ jobId: job.id, songId: selectedSong.id });
      await loadJob(job.id);
      setNotice({ kind: "ok", text: T("无损 WAV 已就绪。") });
    }, setActionBusy);
  };

  const getLrc = async () => {
    if (job === null || selectedSong === null) return;
    await withApi(async () => {
      await api.getMusicLrc({ jobId: job.id, songIds: [selectedSong.id] });
      await loadJob(job.id);
      setNotice({ kind: "ok", text: T("滚动歌词已就绪。") });
    }, setActionBusy);
  };

  const exportNow = async (versionId, songId) => {
    if (job === null) return;
    setExporting(true);
    try {
      const result = await api.exportMusic({
        jobId: job.id,
        ...(versionId === undefined ? {} : { versionId }),
        ...(songId === undefined ? {} : { songId }),
        ...(versionId === undefined ? { format: ops.format } : {})
      });
      setExportResult(result);
      await loadJob(job.id);
      setNotice({ kind: "ok", text: T("已导出：{n0}", { n0: result?.file ?? "" }) });
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setExporting(false);
    }
  };

  const openGuide = async () => {
    if (showGuide) {
      setShowGuide(false);
      return;
    }
    setShowGuide(true);
    if (guide === null && api !== undefined) {
      try {
        const composeGuide = workflow === "compose" || job?.workflow === "compose";
        setGuide(composeGuide
          ? await api.getMusicScoreGuide({ lang: activeLang() })
          : await api.getMusicGuide({ lang: activeLang() }));
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
      }
    }
  };

  const createCard = () => {
    const compose = workflow === "compose";
    const scoreStatus = config?.musicScoreStatus;
    const scoreBlocker = scoreStatus?.blocker ?? null;
    const scoreWarnings = Array.isArray(scoreStatus?.warnings) ? scoreStatus.warnings : [];
    return h(
      "section",
      { className: "SPR_musicCard", "data-testid": "music-create" },
      h("h3", null, T("新建音乐")),
      h(
        "p",
        { className: "SPR_hint" },
        compose
          ? T("先在对话里分析想法、给出曲风与段落规划，再用 scoremill 写成 MIDI 让你试听；满意后可以交给 Suno 生成正式版。谱曲与试听全在本地，免费。")
          : T("写一段灵感，或者贴一整首歌词，点确认后插件会开一个不挂靠项目的新对话，由对话里的 agent 扩写、选模型并生成。")
      ),
      h(
        "div",
        { className: "SPR_musicTabs", "data-testid": "music-workflow" },
        h("button", { type: "button", className: "SPR_step", "data-active": workflow === "generate" ? "true" : "false", "data-testid": "music-workflow-generate", onClick: () => setWorkflow("generate") }, T("AI 生成（谱乐 AI）")),
        h("button", { type: "button", className: "SPR_step", "data-active": workflow === "compose" ? "true" : "false", "data-testid": "music-workflow-compose", onClick: () => setWorkflow("compose") }, T("谱曲模式（本地 MIDI）"))
      ),
      compose
        ? h("textarea", {
            className: "SPR_input SPR_musicText",
            rows: 6,
            "data-testid": "music-compose-prompt",
            placeholder: T("例如：一首 90 秒的仙侠 Boss 战配乐，D 小调，前 8 小节压抑，中段铜管主题，结尾 unresolved 方便循环"),
            value: prompt,
            onChange: (event) => setPrompt(event.target.value)
          })
        : h(
            React.Fragment,
            null,
            h(
              "div",
              { className: "SPR_musicTabs" },
              h("button", { type: "button", className: "SPR_step", "data-active": kind === "prompt" ? "true" : "false", "data-testid": "music-create-kind-prompt", onClick: () => setKind("prompt") }, T("灵感提示词")),
              h("button", { type: "button", className: "SPR_step", "data-active": kind === "lyrics" ? "true" : "false", "data-testid": "music-create-kind-lyrics", onClick: () => setKind("lyrics") }, T("完整歌词"))
            ),
            kind === "prompt"
              ? h("textarea", {
                  className: "SPR_input SPR_musicText",
                  rows: 5,
                  "data-testid": "music-prompt",
                  placeholder: T("例如：一首 90 秒的 8-bit 战斗循环，节奏紧迫、低音扎实，不要人声"),
                  value: prompt,
                  onChange: (event) => setPrompt(event.target.value)
                })
              : h("textarea", {
                  className: "SPR_input SPR_musicText",
                  rows: 10,
                  "data-testid": "music-lyrics",
                  placeholder: T("把完整歌词贴进来，建议带 [Verse] / [Chorus] 等结构标签"),
                  value: lyrics,
                  onChange: (event) => setLyrics(event.target.value)
                })
          ),
      compose && !instrumental
        ? h("textarea", {
            className: "SPR_input SPR_musicText",
            rows: 6,
            "data-testid": "music-compose-lyrics",
            placeholder: T("歌词（可选）：谱曲模式默认纯音乐；要人声时把歌词贴在这里，或在补充要求里说明"),
            value: lyrics,
            onChange: (event) => setLyrics(event.target.value)
          })
        : null,
      h("textarea", {
        className: "SPR_input SPR_musicText",
        rows: 2,
        "data-testid": "music-note",
        placeholder: T("补充要求（可选）：用途、时长、女声/男声、要不要循环、不要什么元素…"),
        value: note,
        onChange: (event) => setNote(event.target.value)
      }),
      h(
        "div",
        { className: "SPR_musicGrid2" },
        h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("标题（可选）")), h("input", { className: "SPR_input", value: title, onChange: (event) => setTitle(event.target.value) })),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, compose ? T("风格标签（可选，交 Suno 时用）") : T("风格标签（可选）")),
          h("input", { className: "SPR_input", value: tags, onChange: (event) => setTags(event.target.value) })
        )
      ),
      h(
        "div",
        { className: "SPR_musicGrid2" },
        compose
          ? h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, T("审核模式")),
              h(
                "select",
                { className: "SPR_input", value: reviewMode, onChange: (event) => setReviewMode(event.target.value) },
                h("option", { value: "auto" }, T("自动审核（方案先给你看，然后继续谱曲）")),
                h("option", { value: "manual" }, T("每一步人工审核（方案先停下等你确认）"))
              )
            )
          : h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, T("引擎偏好")),
              h(
                "select",
                { className: "SPR_input", value: preferredEngine, onChange: (event) => setPreferredEngine(event.target.value) },
                h("option", { value: "" }, T("自动（按用途选）")),
                MUSIC_ENGINES.map((engine) => h("option", { key: engine.id, value: engine.id }, engine.label))
              )
            ),
        compose
          ? h("label", { className: "SPR_field" }, h("span", { className: "SPR_fieldLabel" }, T("谱曲依赖")), h("div", { className: "SPR_btn" }, scoreStatus === undefined ? T("检测中…") : scoreBlocker !== null ? T("未就绪") : T("已就绪")))
          : h(
              "label",
              { className: "SPR_field" },
              h("span", { className: "SPR_fieldLabel" }, T("审核模式")),
              h(
                "select",
                { className: "SPR_input", value: reviewMode, onChange: (event) => setReviewMode(event.target.value) },
                h("option", { value: "auto" }, T("自动审核")),
                h("option", { value: "manual" }, T("每一步人工审核"))
              )
            )
      ),
      h(
        "label",
        { className: "SPR_musicCheck" },
        h("input", { type: "checkbox", checked: instrumental, onChange: (event) => setInstrumental(event.target.checked) }),
        compose ? T("纯音乐（谱曲模式默认；取消勾选可写歌词，最后交 Suno 时使用）") : T("纯音乐（不需要人声）")
      ),
      compose && scoreStatus !== undefined
        ? h(
            "div",
            { className: "SPR_note", "data-kind": scoreBlocker === null ? "ok" : "error" },
            scoreBlocker === null
              ? T("谱曲依赖就绪：Python {n0} · scoremill {n1} · 试听 {n2}", {
                  n0: scoreStatus.python?.version ?? "OK",
                  n1: scoreStatus.scoremill?.version ?? "OK",
                  n2: scoreStatus.renderer === "fluidsynth" ? T("FluidSynth + SoundFont") : T("内置简易音源")
                })
              : scoreBlocker,
            ...scoreWarnings.map((warning) => h("div", { className: "SPR_hint" }, warning))
          )
        : null,
      !compose && config?.musicBlocker !== null && config?.musicBlocker !== undefined
        ? h("div", { className: "SPR_note", "data-kind": "error" }, config.musicBlocker)
        : null,
      compose
        ? h("p", { className: "SPR_hint" }, T("谱曲模式不需要谱乐 AI Key；最后「交给 Suno」才需要。交 Suno 时插件会先把试听音频上传作为参考（标准上传免费），再生成 cover；结果不会逐音一致。"))
        : null,
      h(
        "div",
        { className: "SPR_toolbar" },
        h(
          BusyBtn,
          {
            busy: creating,
            busyText: T("正在创建任务并打开对话…"),
            primary: true,
            disabled: compose ? scoreStatus === undefined || scoreBlocker !== null : config?.musicBlocker !== null && config?.musicBlocker !== undefined,
            "data-testid": "music-submit",
            onClick: () => void submitCreate()
          },
          compose ? T("开始谱曲并打开对话") : T("生成并打开对话")
        ),
        h(Btn, { onClick: () => void openGuide() }, showGuide ? T("收起创作技巧") : T("创作技巧"))
      ),
      showGuide
        ? h(
            "div",
            { className: "SPR_musicGuide" },
            guide === null
              ? h("p", { className: "SPR_hint" }, T("正在读取创作指南…"))
              : h(
                  React.Fragment,
                  null,
                  h("pre", { className: "SPR_musicGuideText" }, guide.guide ?? ""),
                  h(
                    "p",
                    { className: "SPR_hint" },
                    compose
                      ? T("谱曲指南来源：scoremill（MIT）与 Midra 的 prompt-to-code MIDI 思路，已改写为插件内置指南。")
                      : T("技巧来源：bitwize-music-studio/claude-ai-music-skills（CC0-1.0），已改写为插件内置指南。")
                  )
                )
          )
        : null
    );
  };

  const songCard = (song) =>
    h(
      "article",
      { key: song.id, className: "SPR_musicSong", "data-active": song.id === selectedSongId ? "true" : "false", "data-testid": `music-song-${song.id}` },
      h("div", { className: "SPR_musicCover" }, (() => {
        const cover = musicAssetUrl(job, song.coverFile, song.coverUrl);
        return cover === "" ? h("span", { className: "SPR_musicCoverPh" }, "♪") : h("img", { src: cover, alt: "" });
      })()),
      h(
        "div",
        { className: "SPR_musicSongBody" },
        h(
          "div",
          { className: "SPR_musicSongHead" },
          h("strong", null, song.title ?? song.id),
          musicStatusChip(song.status),
          song.approved === true ? h(Chip, { kind: "approved", text: T("已通过") }) : null
        ),
        h(
          "div",
          { className: "SPR_musicMeta" },
          `${song.engine ?? ""}${song.modelName ? ` · ${song.modelName}` : ""}${song.duration ? ` · ${musicFmtTime(song.duration)}` : ""}${song.tags ? ` · ${song.tags}` : ""}`
        ),
        song.downloadError ? h("p", { className: "SPR_hint" }, T("本地下载失败：{n0}（可以点「刷新」重试）", { n0: song.downloadError })) : null,
        song.error ? h("p", { className: "SPR_hint" }, T("平台错误：{n0}", { n0: song.error })) : null,
        h(
          "div",
          { className: "SPR_toolbar" },
          song.status === "succeeded"
            ? h(Btn, {
                on: song.id === selectedSongId,
                // 已经选中同一首时也要把试听源切回原曲：否则先点了某个版本试听，
                // 再点这首歌的「试听 / 编辑」看起来完全没反应。
                onClick: () => {
                  setSelectedSongId(song.id);
                  setAudioSrc(musicAssetUrl(job, song.file, song.url));
                }
              }, T("试听 / 编辑"))
            : null,
          song.status === "succeeded" ? h(Btn, { on: song.approved === true, onClick: () => void approveSong(song) }, song.approved === true ? T("已通过") : T("通过")) : null,
          song.localFile !== null && song.localFile !== undefined
            ? h("a", { className: "SPR_btn", href: musicDownloadUrl(job, song.file, song.url), download: `${song.title ?? job?.name ?? "music"}.${String(song.localFile).split(".").pop()}` }, T("下载原曲"))
            : null,
          song.wavUrl !== null && song.wavUrl !== undefined ? h("a", { className: "SPR_btn", href: musicDownloadUrl(job, song.wavFile, song.wavUrl), download: "lossless.wav" }, T("下载 WAV")) : null
        ),
        song.lyric
          ? h("details", { className: "SPR_musicLyrics" }, h("summary", null, T("歌词")), h("pre", null, song.lyric))
          : null
      )
    );

  const editor = () => {
    if (selectedSong === null) return null;
    const duration = Math.max(0.01, Number(selectedSong.duration) || Number(ops.end) || 1);
    return h(
      "section",
      { className: "SPR_musicCard", "data-testid": "music-editor" },
      h("h3", null, T("编辑：{n0}", { n0: selectedSong.title ?? selectedSong.id })),
      h("audio", { className: "SPR_musicAudio", controls: true, preload: "metadata", src: audioSrc === "" ? undefined : audioSrc }),
      h(MusicWave, { peaks, start: ops.start, end: ops.end, duration }),
      h(
        "div",
        { className: "SPR_musicGrid2" },
        h(NumField, { label: T("起点（秒）"), value: ops.start, min: 0, max: duration, step: 0.1, testId: "music-edit-start", onChange: (value) => setOps({ ...ops, start: Math.min(value, ops.end - 0.05) }) }),
        h(NumField, { label: T("终点（秒）"), value: ops.end, min: 0, max: duration, step: 0.1, testId: "music-edit-end", onChange: (value) => setOps({ ...ops, end: Math.max(value, ops.start + 0.05) }) }),
        h(NumField, { label: T("音量（dB）"), value: ops.gainDb, min: -MUSIC_EDIT_LIMITS.gainDb, max: MUSIC_EDIT_LIMITS.gainDb, step: 0.5, testId: "music-edit-gain", onChange: (value) => setOps({ ...ops, gainDb: value }) }),
        h(NumField, { label: T("淡入（秒）"), value: ops.fadeIn, min: 0, max: MUSIC_EDIT_LIMITS.fade, step: 0.1, testId: "music-edit-fade-in", onChange: (value) => setOps({ ...ops, fadeIn: value }) }),
        h(NumField, { label: T("淡出（秒）"), value: ops.fadeOut, min: 0, max: MUSIC_EDIT_LIMITS.fade, step: 0.1, testId: "music-edit-fade-out", onChange: (value) => setOps({ ...ops, fadeOut: value }) }),
        h(
          "label",
          { className: "SPR_field" },
          h("span", { className: "SPR_fieldLabel" }, T("导出格式")),
          h(
            "select",
            { className: "SPR_input", "data-testid": "music-edit-format", value: ops.format, onChange: (event) => setOps({ ...ops, format: event.target.value }) },
            MUSIC_FORMATS.map((format) => h("option", { key: format, value: format }, format.toUpperCase()))
          )
        )
      ),
      h(
        "label",
        { className: "SPR_musicCheck" },
        h("input", { type: "checkbox", "data-testid": "music-edit-normalize", checked: ops.normalize === true, onChange: (event) => setOps({ ...ops, normalize: event.target.checked }) }),
        T("响度标准化（默认 -14 LUFS / -1 dBTP）")
      ),
      ops.normalize === true
        ? h(
            "div",
            { className: "SPR_musicGrid2" },
            h(NumField, { label: T("目标 LUFS"), value: ops.lufs, min: -40, max: -5, step: 0.5, onChange: (value) => setOps({ ...ops, lufs: value }) }),
            h(NumField, { label: T("真峰值 dBTP"), value: ops.truePeak, min: -9, max: 0, step: 0.1, onChange: (value) => setOps({ ...ops, truePeak: value }) })
          )
        : null,
      h("p", { className: "SPR_hint" }, T("当前参数：{n0}", { n0: musicOpsText(ops) })),
      h(
        "div",
        { className: "SPR_toolbar" },
        h(BusyBtn, { busy: rendering, busyText: T("正在渲染…"), primary: true, "data-testid": "music-render", onClick: () => void renderEdit(true) }, T("试听这一版")),
        h(BusyBtn, { busy: rendering, busyText: T("正在渲染…"), onClick: () => void renderEdit(false) }, T("保存为版本")),
        h(Btn, { onClick: () => setOps(makeMusicOps(duration)) }, T("重置参数")),
        h(BusyBtn, { busy: actionBusy, busyText: T("查询中…"), onClick: () => void getWav() }, T("获取无损 WAV（可能计费）")),
        h(BusyBtn, { busy: actionBusy, busyText: T("查询中…"), onClick: () => void getLrc() }, T("获取滚动歌词"))
      )
    );
  };

  const versionCard = (version) =>
    h(
      "article",
      { key: version.id, className: "SPR_musicVersion", "data-testid": `music-version-${version.id}` },
      h(
        "div",
        { className: "SPR_musicSongHead" },
        h("strong", null, version.label),
        h(Chip, { kind: version.status === "ready" ? "ready" : version.status === "error" ? "error" : "running", text: version.status === "ready" ? T("已就绪") : version.status === "error" ? T("失败") : T("渲染中") }),
        version.preview === true ? h(Chip, { kind: "stale", text: T("试听") }) : null
      ),
      h("div", { className: "SPR_musicMeta" }, `${musicFmtTime(version.duration)} · ${String(version.format).toUpperCase()}${version.size ? ` · ${(version.size / 1024 / 1024).toFixed(1)} MB` : ""}${version.by === "ai" ? ` · ${T("AI 处理")}` : ""}`),
      version.error ? h("p", { className: "SPR_hint" }, version.error) : null,
      h(
        "div",
        { className: "SPR_toolbar" },
        version.status === "ready" ? h(Btn, { onClick: () => setAudioSrc(musicAssetUrl(job, version.file, version.url)) }, T("试听")) : null,
        version.status === "ready" && version.preview === true ? h(Btn, { onClick: () => void saveVersion(version.id) }, T("保存为正式版本")) : null,
        version.status === "ready" ? h(Btn, { onClick: () => void exportNow(version.id, undefined) }, T("导出这一版")) : null,
        version.status === "ready" ? h("a", { className: "SPR_btn", href: musicDownloadUrl(job, version.file, version.url), download: `${version.label}.${version.format}` }, T("下载")) : null,
        h(Btn, { danger: true, onClick: () => void deleteVersion(version.id) }, T("删除"))
      )
    );

  const approveScore = async (composition) => {
    if (job === null) return;
    await withApi(async () => {
      await api.setMusicApproved({ jobId: job.id, scoreId: composition.id, approved: composition.approved !== true });
      await loadJob(job.id);
    }, setActionBusy);
  };

  const submitScoreToSuno = async (composition) => {
    if (job === null) return;
    if (config?.musicApiKeySet !== true) {
      setNotice({ kind: "error", text: config?.musicBlocker ?? T("还没配置谱乐 AI Key：交 Suno 需要它；谱曲与试听不需要。") });
      return;
    }
    if (typeof composition.audioFile !== "string" || composition.audioFile === "") {
      setNotice({ kind: "error", text: T("这一版没有试听音频，无法作为 Suno 的参考。先修复试听渲染（FluidSynth + SoundFont 或 ffmpeg），或下载 MIDI 自行处理。") });
      return;
    }
    const hasSongs = (job.songs ?? []).some((song) => song.status === "succeeded");
    const message = hasSongs
      ? T("这个任务已经有歌曲了，再交 Suno 会再消耗积分。插件会先把这一版的试听音频上传给 Suno 作为参考（标准上传免费），再生成 cover 正式版；生成计费，结果不会逐音一致。继续？")
      : T("会把这一版的试听音频上传给 Suno 作为参考（标准上传免费），再生成 cover 正式版；生成消耗谱乐 AI 积分。这是「按这段音频重新演奏」，不会逐音一致。继续？");
    if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(message)) return;
    setScoreBusy(true);
    try {
      const payload = {
        jobId: job.id,
        scoreId: composition.id,
        confirm: true,
        ...(hasSongs ? { regenerate: true } : {})
      };
      let result = await api.submitMusicScoreToSuno(payload);
      if (result?.needsCopyrightConsent === true) {
        const consent = T("Suno 判定这段参考音频有版权，需要走付费版权上传通道（会扣积分）。继续？");
        if (typeof window === "undefined" || typeof window.confirm !== "function" || !window.confirm(consent)) {
          setNotice({ kind: "error", text: result?.reason ?? T("已取消：没有走付费版权通道") });
          return;
        }
        result = await api.submitMusicScoreToSuno({ ...payload, copyrightAudio: true });
      }
      if (result?.started === true) {
        setNotice({ kind: "ok", text: T("已上传参考音频并提交给 Suno：{n0}（真实计费）", { n0: result?.message ?? "" }) });
        // 用 loadJob 而不是 setJob：它会推进 seq，把还在路上的旧快照作废；
        // 否则一个更早发出的 loadJob 回来后会把「刚提交、正在轮询」的快照覆盖成旧状态，
        // 表现就是「转圈结束但歌没出来，切走再切回才出现」。
        await loadJob(job.id);
      } else {
        setNotice({ kind: "error", text: result?.reason ?? T("提交没有启动") });
      }
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setScoreBusy(false);
    }
  };

  const exportScore = async (composition) => {
    if (job === null) return;
    setScoreExporting(true);
    try {
      const result = await api.exportMusic({ jobId: job.id, scoreId: composition.id });
      setExportResult(result);
      await loadJob(job.id);
      setNotice({ kind: "ok", text: T("已导出乐谱包：{n0}", { n0: result?.file ?? "" }) });
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setScoreExporting(false);
    }
  };

  const scoreCard = () => {
    if (job === null || job.workflow !== "compose") return null;
    const compositions = job.compositions ?? [];
    const selected = compositions.find((entry) => entry.id === selectedScoreId) ?? compositions[compositions.length - 1] ?? null;
    const plan = selected?.plan ?? job.scorePlan ?? null;
    const scoreStatus = config?.musicScoreStatus;
    const planHead = plan === null
      ? ""
      : [plan.style, plan.mood, plan.key, plan.tempo ? `${plan.tempo} BPM` : "", plan.timeSignature].filter(Boolean).join(" · ");
    return h(
      "section",
      { className: "SPR_musicCard", "data-testid": "music-score" },
      h(
        "div",
        { className: "SPR_musicJobHead" },
        h("h3", null, T("谱曲（本地 MIDI）")),
        h(CopyIdButton, { id: job.id }),
        selected !== null ? h(Chip, { kind: "ready", text: T("第 {n0} 版", { n0: compositions.indexOf(selected) + 1 }) }) : null,
        h("span", { className: "SPR_spacer" }),
        h(Btn, { onClick: () => void loadJob(job.id) }, T("重新读取"))
      ),
      h("p", { className: "SPR_hint" }, T("谱曲与试听全在本地完成，免费；只有「交给 Suno」会消耗积分。每次修改都是新版本，旧版保留。")),
      plan !== null
        ? h(
            "div",
            { className: "SPR_scorePlan" },
            h("div", { className: "SPR_musicMeta" }, planHead || T("（方案已保存）")),
            plan.summary ? h("pre", { className: "SPR_musicSourceText" }, plan.summary) : null,
            (plan.structure ?? []).length > 0
              ? h("div", { className: "SPR_scoreStructure" }, (plan.structure ?? []).map((section, index) =>
                  h("span", { key: index, className: "SPR_chip" }, `${section.name}${section.bars ? ` ${section.bars}小节` : ""}${section.energy ? ` ${section.energy}` : ""}`)
                ))
              : null,
            (plan.instrumentation ?? []).length > 0
              ? h("p", { className: "SPR_hint" }, T("配器：{n0}", { n0: (plan.instrumentation ?? []).map((entry) => entry.name).join(" / ") }))
              : null
          )
        : h("p", { className: "SPR_hint" }, T("还没有方案：对话里的 agent 会先分析你的想法，再把曲风、调性、段落与配器写成方案。")),
      compositions.length === 0
        ? h("p", { className: "SPR_hint" }, T("还没有 MIDI：方案确认后 agent 会用 scoremill 谱曲，宿主渲染试听。"))
        : h(
            "div",
            { className: "SPR_musicSongs" },
            compositions.map((composition, index) => {
              const active = composition.id === selected?.id;
              return h(
                "article",
                { key: composition.id, className: "SPR_musicSong", "data-active": active ? "true" : "false", "data-testid": `music-score-${composition.id}` },
                h(
                  "div",
                  { className: "SPR_musicSongBody" },
                  h(
                    "div",
                    { className: "SPR_musicSongHead" },
                    h("strong", null, composition.label || T("第 {n0} 版", { n0: index + 1 })),
                    h(Chip, { kind: composition.status === "ready" ? "ready" : "error", text: composition.status === "ready" ? T("已就绪") : T("失败") }),
                    composition.approved === true ? h(Chip, { kind: "approved", text: T("已通过") }) : null
                  ),
                  h(
                    "div",
                    { className: "SPR_musicMeta" },
                    `${composition.midi?.bars ?? "?"} ${T("小节")} · ${musicFmtTime(composition.midi?.duration ?? 0)} · ${composition.midi?.tempo ?? "?"} BPM · ${composition.midi?.timeSignature ?? "?"}${composition.audioRenderer ? ` · ${composition.audioRenderer === "fluidsynth" ? "FluidSynth" : T("内置音源")}` : ""}`
                  ),
                  composition.audioError
                    ? h("p", { className: "SPR_hint" }, T("试听渲染失败：{n0}（可下载 MIDI；装 FluidSynth + SoundFont 后可重新渲染）", { n0: composition.audioError }))
                    : null,
                  composition.audioFile
                    ? h("audio", { className: "SPR_musicAudio", controls: true, preload: "metadata", src: musicAssetUrl(job, composition.audioFile, composition.audioUrl) })
                    : null,
                  active && composition.audioFile
                    ? h(MusicWave, { peaks: scorePeaks, start: 0, end: Math.max(0.01, Number(composition.midi?.duration) || 0.01), duration: Math.max(0.01, Number(composition.midi?.duration) || 0.01) })
                    : null,
                  h(
                    "div",
                    { className: "SPR_toolbar" },
                    h(Btn, { on: active, onClick: () => setSelectedScoreId(composition.id) }, T("选中这一版")),
                    h("a", { className: "SPR_btn", href: musicDownloadUrl(job, composition.midiFile, composition.midiUrl), download: `${composition.title || job.name}-${composition.label}.mid` }, T("下载 MIDI")),
                    composition.audioFile
                      ? h("a", { className: "SPR_btn", href: musicDownloadUrl(job, composition.audioFile, composition.audioUrl), download: `${composition.title || job.name}-${composition.label}.${String(composition.audioFile).split(".").pop()}` }, T("下载试听"))
                      : null,
                    h(Btn, { on: composition.approved === true, onClick: () => void approveScore(composition) }, composition.approved === true ? T("已通过") : T("通过")),
                    h(
                      BusyBtn,
                      {
                        busy: scoreBusy,
                        busyText: T("提交中…"),
                        disabled: config?.musicApiKeySet !== true || job.busy === true || typeof composition.audioFile !== "string" || composition.audioFile === "",
                        onClick: () => void submitScoreToSuno(composition)
                      },
                      T("用这首音频生成 Suno 正式版（计费）")
                    ),
                    h(BusyBtn, { busy: scoreExporting, busyText: T("导出中…"), onClick: () => void exportScore(composition) }, T("导出乐谱包"))
                  ),
                  h("p", { className: "SPR_hint" }, T("交 Suno 会先把这一版的试听音频上传作为参考（标准上传免费），再生成 cover 正式版；比只发文字标签更贴近 MIDI。若 Suno 判定版权，需要你确认后走付费版权通道。")),
                  composition.script
                    ? h("details", { className: "SPR_scoreScript" }, h("summary", null, T("查看 compose.py")), h("pre", null, composition.script))
                    : null
                )
              );
            })
          ),
      Array.isArray(scoreStatus?.warnings) && scoreStatus.warnings.length > 0
        ? h("p", { className: "SPR_hint" }, scoreStatus.warnings.join(" "))
        : null
    );
  };

  const main = h(
    "div",
    { className: "SPR_main" },
    notice !== null
      ? h("div", { className: "SPR_note", "data-kind": notice.kind }, notice.text, h("button", { type: "button", className: "SPR_miniBtn", style: { marginLeft: 10 }, onClick: () => setNotice(null) }, T("关闭")))
      : null,
    job === null
      ? h(React.Fragment, null,
          loading ? h("p", { className: "SPR_empty" }, T("正在载入…")) : null,
          !loading ? h(React.Fragment, null,
            createOpen || jobs.length === 0 ? createCard() : h("p", { className: "SPR_empty" }, T("从左侧选一个音乐任务，或点「新建音乐」开始。")),
            h("div", { className: "SPR_toolbar" }, h(Btn, { primary: true, onClick: () => setCreateOpen(true) }, T("新建音乐")))
          ) : null
        )
      : h(
          React.Fragment,
          null,
          h(
            "section",
            { className: "SPR_musicCard" },
            h(
              "div",
              { className: "SPR_musicJobHead" },
              h("h3", null, job.name),
              h(CopyIdButton, { id: job.id }),
              job.workflow === "compose" ? h(Chip, { kind: "stale", text: T("谱曲模式") }) : null,
              h("span", { className: "SPR_musicMeta" }, job.workflow === "compose"
                ? T("谱曲 {n0} 版 · {n1}/{n2} 首就绪 · {n3} 个版本", { n0: (job.compositions ?? []).length, n1: job.songsReady ?? 0, n2: job.songsTotal ?? 0, n3: (job.versions ?? []).filter((entry) => entry.status === "ready").length })
                : T("{n0}/{n1} 首就绪 · {n2} 个版本", { n0: job.songsReady ?? 0, n1: job.songsTotal ?? 0, n2: (job.versions ?? []).filter((entry) => entry.status === "ready").length })),
              job.busy === true ? h(BusyBadge, { show: true, text: T("有任务在跑…") }) : null,
              h("span", { className: "SPR_spacer" }),
              h(Btn, { onClick: () => void refresh() }, T("刷新")),
              h(Btn, { onClick: () => void reveal() }, T("打开任务目录")),
              h(Btn, { danger: true, onClick: () => void removeJob() }, T("删除任务"))
            ),
            h(ReviewModeBar, { api, module: "music", id: job.id, mode: job.reviewMode, onChanged: () => void loadJob(job.id) }),
            h(
              "div",
              { className: "SPR_musicSource" },
              h("strong", null, job.source?.kind === "lyrics" ? T("完整歌词") : T("灵感提示词")),
              job.source?.title ? h("span", { className: "SPR_musicMeta" }, T("标题：{n0}", { n0: job.source.title })) : null,
              job.source?.note ? h("p", { className: "SPR_hint" }, T("补充要求：{n0}", { n0: job.source.note })) : null,
              h("pre", { className: "SPR_musicSourceText" }, job.source?.kind === "lyrics" ? job.source?.lyrics ?? "" : job.source?.prompt ?? ""),
              job.source?.adaptedPrompt ? h("details", null, h("summary", null, T("AI 扩写提示词")), h("pre", { className: "SPR_musicSourceText" }, job.source.adaptedPrompt)) : null,
              job.source?.adaptedLyrics ? h("details", null, h("summary", null, T("AI 扩写歌词")), h("pre", null, job.source.adaptedLyrics)) : null,
              job.source?.adaptedTags ? h("p", { className: "SPR_hint" }, T("风格标签：{n0}", { n0: job.source.adaptedTags })) : null
            ),
            config?.musicBlocker !== null && config?.musicBlocker !== undefined ? h("div", { className: "SPR_note", "data-kind": "error" }, config.musicBlocker) : null,
            h(
              "div",
              { className: "SPR_toolbar" },
              h(Btn, { primary: true, onClick: () => setCreateOpen((value) => !value) }, createOpen ? T("收起新建") : T("新建音乐")),
              h(Btn, { onClick: () => void openGuide() }, showGuide ? T("收起创作技巧") : T("创作技巧")),
              h(Btn, { onClick: () => void loadJob(job.id) }, T("重新读取"))
            ),
            createOpen ? createCard() : null,
            showGuide ? h("div", { className: "SPR_musicGuide" }, guide === null ? h("p", { className: "SPR_hint" }, T("正在读取创作指南…")) : h("pre", { className: "SPR_musicGuideText" }, guide.guide ?? "")) : null
          ),
          scoreCard(),
          h(
            "section",
            { className: "SPR_musicCard" },
            h("h3", null, T("歌曲")),
            (() => {
              const pending = (job.generations ?? []).find((generation) => generation.status === "submitting" || generation.status === "polling");
              return pending === undefined ? null : h("p", { className: "SPR_hint", "data-testid": "music-generating" }, T("Suno 正在生成…（{n0}）", { n0: pending.summary ?? "" }));
            })(),
            h("div", { className: "SPR_musicSongs" }, (job.songs ?? []).length === 0 ? h("p", { className: "SPR_hint" }, T("还没有歌曲：对话里的 agent 正在生成，或者还在等你提交。")) : (job.songs ?? []).map(songCard))
          ),
          editor(),
          h(
            "section",
            { className: "SPR_musicCard" },
            h("h3", null, T("版本")),
            h("p", { className: "SPR_hint" }, T("每次「试听这一版 / 保存为版本」都会生成一个新版本，原曲永不覆盖。")),
            versions.length === 0 ? h("p", { className: "SPR_hint" }, T("还没有编辑版本。")) : h("div", { className: "SPR_musicVersions" }, versions.map(versionCard)),
            h(
              "div",
              { className: "SPR_toolbar" },
              h(BusyBtn, { busy: exporting, busyText: T("正在导出…"), primary: true, "data-testid": "music-export", onClick: () => void exportNow(undefined, selectedSong?.id) }, T("导出原曲")),
              selectedSong !== null ? h(Btn, { onClick: () => void exportNow(undefined, undefined) }, T("导出全部（zip）")) : null
            ),
            exportResult?.downloadUrl !== null && exportResult?.downloadUrl !== undefined
              ? h("p", { className: "SPR_hint" }, h("a", { className: "SPR_link", href: musicDownloadUrl(job, exportResult.file, exportResult.downloadUrl ?? exportResult.url), download: `${job.name}.${String(exportResult.format ?? "zip")}` }, T("下载导出文件")), ` · ${exportResult.path ?? ""}`)
              : null
          ),
          (job.tools ?? []).length > 0
            ? h(
                "section",
                { className: "SPR_musicCard" },
                h("h3", null, T("工具结果")),
                (job.tools ?? []).map((tool) =>
                  h(
                    "div",
                    { key: tool.id, className: "SPR_musicTool" },
                    h("strong", null, tool.kind),
                    h(Chip, { kind: tool.status === "succeeded" ? "ready" : tool.status === "failed" ? "error" : "running", text: tool.status }),
                    tool.error ? h("p", { className: "SPR_hint" }, tool.error) : null,
                    tool.result?.description ? h("p", { className: "SPR_hint" }, String(tool.result.description)) : null,
                    Array.isArray(tool.result?.genres) && tool.result.genres.length > 0 ? h("p", { className: "SPR_hint" }, `${T("风格")}：${tool.result.genres.join(" / ")}${Array.isArray(tool.result.tags) && tool.result.tags.length > 0 ? ` · ${tool.result.tags.join(" / ")}` : ""}`) : null,
                    h("div", { className: "SPR_toolbar" }, (tool.files ?? []).map((file) =>
                      h("a", { key: file.file, className: "SPR_link", href: musicDownloadUrl(job, file.file, file.url), target: "_blank", rel: "noreferrer" }, file.name)
                    ))
                  )
                )
              )
            : null,
          (job.log ?? []).length > 0
            ? h(
                "details",
                { className: "SPR_musicLog" },
                h("summary", null, T("任务日志（{n0} 条）", { n0: (job.log ?? []).length })),
                h("ul", null, (job.log ?? []).slice(-10).map((entry, index) => h("li", { key: index }, `${new Date(entry.at).toLocaleTimeString()} · ${entry.message}`)))
              )
            : null
        )
  );

  return h(
    "div",
    { className: "SPR_body SPR_musicBody SPR_pageBody" },
    h(
      "div",
      { className: "SPR_side" },
      h("div", { className: "SPR_sideTitle" }, T("音乐任务（{n0}）", { n0: jobs.length })),
      h(Btn, { primary: true, onClick: () => { setCreateOpen(true); setJob(null); } }, T("新建音乐")),
      jobs.length === 0
        ? h("p", { className: "SPR_hint" }, T("还没有任务。写一段灵感或贴一首歌词开始。"))
        : jobs.map((entry) =>
            h(
              "button",
              { key: entry.id, type: "button", className: "SPR_projItem", "data-active": entry.id === jobId ? "true" : "false", onClick: () => void loadJob(entry.id) },
              h("span", { className: "SPR_projNameRow" },
                h("span", { className: "SPR_projName" }, entry.name),
                h(CopyIdButton, { id: entry.id, inline: true })
              ),
              h("span", { className: "SPR_projMeta" }, entry.workflow === "compose"
                ? T("谱曲 {n0} 版 · {n1}/{n2} 首", { n0: entry.compositions ?? 0, n1: entry.songsReady, n2: entry.songsTotal })
                : T("{n0}/{n1} 首 · {n2} 个版本", { n0: entry.songsReady, n1: entry.songsTotal, n2: entry.versions }))
            )
          )
    ),
    main
  );
}

  return MusicModule;
}
