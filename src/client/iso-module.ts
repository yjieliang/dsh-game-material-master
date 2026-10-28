/**
 * IsoModule：面板实现。
 *
 * 拆成工厂函数的原因：面板要用宿主 `require("react")` 提供的 React，而 `require` 只在
 * `__ModuleLoader__.load` 的 factory 里可用 —— 模块顶层不能直接抓 React。所以共享物
 * （React / h / T / api 辅助 / 公共组件）由入口显式传进来，这里只构造一次组件。
 */

import { markRender } from "./platform/perf.js";
import { onceTimer, repeatTimer } from "./platform/lifecycle.js";

export interface IsoRuntime {
  React: any;
  h: any;
  fill: any;
  T: any;
  useLocaleTick: any;
  deriveAssetName: any;
  ASSET_FRAMES_MIN: any;
  ASSET_FRAMES_MAX: any;
  buildIsoAssetRequestPrompt: any;
  useHiddenModules: any;
  useStudioIntent: any;
  Btn: any;
  NumField: any;
  readFileBase64: any;
  CopyIdButton: any;
  MapToolIcon: any;
  ISO_OBJECT_SCALE_MIN: any;
  ISO_OBJECT_SCALE_MAX: any;
  ISO_pointToCellRaw: any;
  ISO_cellCenter: any;
  ISO_lineCells: any;
  ISO_addPreviewScene: any;
  openIsoAssetChat: any;
  /** 集中轮询调度器（platform/scheduler；组合根注入） */
  scheduler: any;
}

export function createIsoModule(rt: IsoRuntime) {
  const { React, h, fill, T, useLocaleTick, deriveAssetName, ASSET_FRAMES_MIN, ASSET_FRAMES_MAX, buildIsoAssetRequestPrompt, useHiddenModules, useStudioIntent, Btn, NumField, readFileBase64, CopyIdButton, MapToolIcon, ISO_OBJECT_SCALE_MIN, ISO_OBJECT_SCALE_MAX, ISO_pointToCellRaw, ISO_cellCenter, ISO_lineCells, ISO_addPreviewScene, openIsoAssetChat, scheduler } = rt;

function IsoModule(props) {
  markRender("IsoModule");
  useLocaleTick();
  const api = props.api;
  const intent = useStudioIntent();
  const hiddenModules = useHiddenModules(api);
  const [projects, setProjects] = React.useState([]);
  const [view, setView] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [openCard, setOpenCard] = React.useState(null);
  const [busyKey, setBusyKey] = React.useState(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [viewport, setViewport] = React.useState({ w: 900, h: 520 });
  const [measured, setMeasured] = React.useState(false);
  const [planOps, setPlanOps] = React.useState(new Map());
  const [visibleKeys, setVisibleKeys] = React.useState([]);
  const [planMarkers, setPlanMarkers] = React.useState([]);
  const [planLegend, setPlanLegend] = React.useState([]);
  const [planPass, setPlanPass] = React.useState([]);
  const [planMeta, setPlanMeta] = React.useState({ fps: 1, fpsMax: 1, frameCount: 1 });
  const [planWarnings, setPlanWarnings] = React.useState([]);
  const [truncated, setTruncated] = React.useState(false);
  const [planEpoch, setPlanEpoch] = React.useState(0);
  const [previewTick, setPreviewTick] = React.useState(0);
  const [animFps, setAnimFps] = React.useState(null);
  const [animElapsed, setAnimElapsed] = React.useState(0);
  const [imagesReady, setImagesReady] = React.useState(0);
  const [tool, setTool] = React.useState("pen");
  const [brush, setBrush] = React.useState(null);
  const [multi, setMulti] = React.useState([]);
  const [layerIndex, setLayerIndex] = React.useState(0);
  const [single, setSingle] = React.useState(false);
  const [showGrid, setShowGrid] = React.useState(false);
  const [showPass, setShowPass] = React.useState(false);
  const [hover, setHover] = React.useState(null);
  const [markerSel, setMarkerSel] = React.useState(null);
  const [layerDraft, setLayerDraft] = React.useState(null);
  const [markerDraft, setMarkerDraft] = React.useState(null);
  const [genKind, setGenKind] = React.useState("random");
  const [genSeed, setGenSeed] = React.useState(20261024);
  const [exportScale, setExportScale] = React.useState(1);
  const [exportFormats, setExportFormats] = React.useState({ png: true, json: true, tilesets: false });
  const [nameAsk, setNameAsk] = React.useState(null);
  const [addDraft, setAddDraft] = React.useState(null);
  const [aiDraft, setAiDraft] = React.useState(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [tsEdit, setTsEdit] = React.useState(null);
  const [guidePage, setGuidePage] = React.useState(null);
  const [addPreview, setAddPreview] = React.useState(null);
  const [addPreviewNatural, setAddPreviewNatural] = React.useState({ width: 0, height: 0 });
  const [addPreviewDragging, setAddPreviewDragging] = React.useState(false);
  const addPreviewDragRef = React.useRef(null);
  const planRef = React.useRef(new Map());
  const pendingRef = React.useRef([]);
  const previewKeys = React.useRef(new Set());
  const strokeRef = React.useRef(null);
  const pointersRef = React.useRef(new Map());
  const spaceRef = React.useRef(false);
  const fittedRef = React.useRef("");
  const canvasRef = React.useRef(null);
  const stageRef = React.useRef(null);
  const imageRefs = React.useRef({});
  const addFileRef = React.useRef(null);

  /** 把拖动距离换算成归一化锚点；0~1 之外夹住，避免把图片拖丢。 */
  const clampAnchor = (value: number): number => Math.max(0, Math.min(1, value));

  const activeLayer = view === null ? null : view.layers[Math.max(0, Math.min(view.layers.length - 1, layerIndex))] ?? null;
  const layout =
    view === null
      ? null
      : {
          cell: view.cell,
          cols: view.cols,
          rows: view.rows,
          wrap: view.wrap,
          stepX: view.layout.stepX,
          stepY: view.layout.stepY
        };
  const activeFps = animFps === null ? (planMeta.fps > 0 ? planMeta.fps : 1) : animFps;
  const legendMap = React.useMemo(() => new Map((planLegend.length > 0 ? planLegend : view?.legend ?? []).map((entry) => [entry.index, entry])), [planLegend, view?.legend]);
  const objectList = view?.objectList ?? [];
  const paletteEntries = React.useMemo(() => {
    if (view === null || activeLayer === null) return [];
    const out = [];
    for (const tileset of view.tilesets) {
      if (activeLayer.kind === "object" ? tileset.kind !== "object" : tileset.kind === "object") continue;
      for (const item of tileset.palette ?? []) {
        out.push({ tilesetId: tileset.id, name: tileset.name, kind: tileset.kind, index: item.index, rect: item.rect, tileset });
      }
    }
    return out;
  }, [view?.id, view?.tilesets, activeLayer?.id, activeLayer?.kind]);

  const msg = (error) => (error instanceof Error ? error.message : String(error));

  const clearPlan = () => {
    planRef.current = new Map();
    pendingRef.current = [];
    previewKeys.current = new Set();
    setPlanOps(new Map());
    setVisibleKeys([]);
    setPlanMarkers([]);
    setPlanWarnings([]);
    setTruncated(false);
  };

  const refreshProjects = React.useCallback(async () => {
    try {
      const result = await api.listIsoProjects();
      setProjects(result.projects ?? []);
      return result.projects ?? [];
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return [];
    }
  }, [api]);

  const loadProject = React.useCallback(
    async (id, keepCamera = false) => {
      if (id === null || id === undefined) return;
      try {
        const next = await api.getIsoProject({ projectId: id });
        setView((current) => {
          if (current === null || current.id !== next.id) {
            setLayerIndex(0);
            setBrush(null);
            setMulti([]);
          }
          return next;
        });
        clearPlan();
        setPlanEpoch((value) => value + 1);
        if (keepCamera !== true) fittedRef.current = "";
        return next;
      } catch (error) {
        setNotice({ kind: "error", text: msg(error) });
        return undefined;
      }
    },
    [api]
  );

  React.useEffect(() => {
    void (async () => {
      const list = await refreshProjects();
      if (intent !== null && intent.module === "iso" && typeof intent.jobId === "string") {
        await loadProject(intent.jobId);
        if (intent.stage === "export") setOpenCard("export");
        return;
      }
      if (list.length > 0) await loadProject(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (intent === null || intent.module !== "iso") return;
    const id = typeof intent.jobId === "string" && intent.jobId !== "" ? intent.jobId : intent.projectId;
    if (typeof id !== "string" || id === "") return;
    void (async () => {
      const loaded = await loadProject(id);
      if (intent.stage === "export") setOpenCard("export");
      if (intent.dialog === "add") await openIsoAiAssetDraft(intent, loaded);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  // 画布尺寸：用 ResizeObserver 量，不量之前不发计划请求。
  React.useEffect(() => {
    const element = stageRef.current;
    if (element === null || element === undefined) return undefined;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setViewport({ w: Math.max(160, Math.round(rect.width)), h: Math.max(120, Math.round(rect.height)) });
      setMeasured(true);
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [view?.id]);

  // 换项目 / 改尺寸后把整张地图摆回视野中央。
  React.useEffect(() => {
    if (view === null || layout === null) return;
    const key = `${view.id}:${view.cols}x${view.rows}:${layout.stepX}`;
    if (fittedRef.current === key) return;
    fittedRef.current = key;
    const bounds = view.bounds;
    const scale = Math.min(1, viewport.w / Math.max(1, bounds.width), viewport.h / Math.max(1, bounds.height));
    const nextZoom = Math.min(4, Math.max(0.2, Number.isFinite(scale) && scale > 0 ? scale * 0.94 : 1));
    setZoom(nextZoom);
    setPan({
      x: bounds.originX + (bounds.width - viewport.w / nextZoom) / 2,
      y: bounds.originY + (bounds.height - viewport.h / nextZoom) / 2
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, layout === null ? "" : `${layout.cols}x${layout.rows}x${layout.stepX}`, viewport.w, viewport.h]);

  // 图片预载
  React.useEffect(() => {
    if (view === null) return undefined;
    let live = true;
    const images = {};
    for (const tileset of view.tilesets) {
      if (tileset.file === "") continue;
      const image = new Image();
      image.onload = () => {
        if (live) setImagesReady((value) => value + 1);
      };
      image.src = `${view.assetBase}${tileset.file}?v=${tileset.rev ?? 0}`;
      images[tileset.id] = image;
    }
    imageRefs.current = images;
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, (view?.tilesets ?? []).map((tileset) => `${tileset.id}:${tileset.rev}`).join("|")]);

  // 计划查询
  React.useEffect(() => {
    if (view === null || layout === null || measured !== true) return undefined;
    let cancelled = false;
    const cancel = onceTimer(() => {
      void (async () => {
      const pending = pendingRef.current;
      const have = pending.length > 0 ? [] : [...planRef.current.keys()];
      try {
        const result = await api.isoPlan({
          projectId: view.id,
          view: { x: pan.x, y: pan.y, width: viewport.w / zoom, height: viewport.h / zoom },
          have,
          pending: pending.length > 0 ? pending : undefined,
          layerIds: single === true ? [layerIndex] : undefined,
          pass: showPass === true
        });
        if (cancelled) return;
        if (pending.length > 0) {
          planRef.current = new Map();
          previewKeys.current = new Set(result.visibleKeys ?? []);
        }
        for (const chunk of result.chunks ?? []) planRef.current.set(chunk.key, chunk.ops ?? []);
        if (planRef.current.size > 512) {
          const keep = new Set(result.visibleKeys ?? []);
          for (const key of [...planRef.current.keys()]) if (!keep.has(key)) planRef.current.delete(key);
        }
        setPlanOps(new Map(planRef.current));
        setVisibleKeys(result.visibleKeys ?? []);
        setPlanMarkers(result.markers ?? []);
        setPlanLegend(result.legend ?? []);
        setPlanPass(result.pass ?? []);
        setPlanMeta({ fps: result.fps ?? 1, fpsMax: result.fpsMax ?? 1, frameCount: Math.max(1, result.frameCount ?? 1) });
        setPlanWarnings(result.warnings ?? []);
        setTruncated(result.truncated === true);
      } catch (error) {
        if (!cancelled) setNotice({ kind: "error", text: msg(error) });
      }
      })();
    }, pendingRef.current.length > 0 ? 60 : 20);
    return () => {
      cancelled = true;
      cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, viewport.w, viewport.h, zoom, pan.x, pan.y, planEpoch, previewTick, single, layerIndex, showPass, measured, api]);

  // 动画时钟
  React.useEffect(() => {
    if (planMeta.frameCount <= 1) {
      setAnimElapsed(0);
      return undefined;
    }
    const started = Date.now();
    const cancel = repeatTimer(() => setAnimElapsed((Date.now() - started) / 1000), 90);
    return cancel;
  }, [planMeta.frameCount, view?.id]);

  // 作业进行中轮询（预览 / 导出）：走集中调度器（同 key 去重 / 失败退避 / 页面隐藏暂停）。
  React.useEffect(() => {
    if (view === null || view.busy !== true) return undefined;
    const handle = scheduler.watch({
      key: "iso:" + String(view.id) + ":busy",
      intervalMs: 1500,
      immediate: false,
      run: () => loadProject(view.id, true)
    });
    return () => handle.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.id, view?.busy, loadProject, scheduler]);

  const clampPan = (next) => {
    if (view === null) return next;
    const bounds = view.bounds;
    const visibleW = viewport.w / zoom;
    const visibleH = viewport.h / zoom;
    const x = bounds.width <= visibleW ? bounds.originX + (bounds.width - visibleW) / 2 : Math.max(bounds.originX, Math.min(bounds.originX + bounds.width - visibleW, next.x));
    const y = bounds.height <= visibleH ? bounds.originY + (bounds.height - visibleH) / 2 : Math.max(bounds.originY, Math.min(bounds.originY + bounds.height - visibleH, next.y));
    return { x, y };
  };

  const zoomAt = React.useCallback(
    (clientX, clientY, factor) => {
      const element = stageRef.current;
      if (element === null || element === undefined || view === null) return;
      const rect = element.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const nextZoom = Math.min(8, Math.max(0.2, zoom * factor));
      const worldX = pan.x + localX / zoom;
      const worldY = pan.y + localY / zoom;
      setZoom(nextZoom);
      setPan(clampPan({ x: worldX - localX / nextZoom, y: worldY - localY / nextZoom }));
    },
    [zoom, pan.x, pan.y, view?.id, viewport.w, viewport.h]
  );

  const bindCanvas = React.useCallback(
    (node) => {
      if (canvasRef.current !== null && canvasRef.current !== undefined && canvasRef.current.__isoWheelOff) {
        canvasRef.current.__isoWheelOff();
      }
      canvasRef.current = node ?? null;
      if (node === null || node === undefined) return;
      const handler = (event) => {
        event.preventDefault();
        if (event.ctrlKey || event.metaKey) {
          const list = [...paletteEntries];
          if (list.length === 0) return;
          const at = list.findIndex((entry) => brush !== null && entry.index === brush.index && entry.tilesetId === brush.tilesetId);
          const step = event.deltaY > 0 ? -1 : 1;
          const next = list[(at + step + list.length) % list.length];
          selectBrush(next, false);
          return;
        }
        zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
      };
      node.addEventListener("wheel", handler, { passive: false });
      node.__isoWheelOff = () => node.removeEventListener("wheel", handler);
    },
    [paletteEntries, brush?.index, brush?.tilesetId, zoomAt]
  );

  const cellFromEvent = (event) => {
    const element = stageRef.current;
    if (element === null || element === undefined || layout === null) return null;
    const rect = element.getBoundingClientRect();
    const x = pan.x + (event.clientX - rect.left) / zoom;
    const y = pan.y + (event.clientY - rect.top) / zoom;
    const hit = ISO_pointToCellRaw(layout, x, y);
    if (hit.inMap !== true) return null;
    return hit;
  };

  const objectAtCell = (r, c, layerId) => {
    for (const object of objectList) {
      if (object.layerId !== layerId) continue;
      if (r >= object.r && r < object.r + object.rows && c >= object.c && c < object.c + object.cols) return object;
    }
    return undefined;
  };

  const selectBrush = (entry, additive) => {
    if (entry === undefined || entry === null) return;
    setBrush({ index: entry.index, tilesetId: entry.tilesetId, kind: entry.kind });
    setMarkerSel(null);
    if (additive === true) {
      setMulti((current) => (current.includes(entry.index) ? current.filter((value) => value !== entry.index) : [...current, entry.index]));
    } else {
      setMulti([entry.index]);
    }
  };

  const applyOps = async (ops, stroke, opts: any = {}) => {
    if (view === null || api === undefined || ops.length === 0) return undefined;
    try {
      const result = await api.applyIsoOps({
        projectId: view.id,
        ops,
        stroke,
        have: [...planRef.current.keys()]
      });
      if (result !== undefined && Array.isArray(result.skipped) && result.skipped.length > 0) {
        setNotice({ kind: "info", text: result.skipped.join("；") });
      }
      for (const key of result?.dropKeys ?? []) planRef.current.delete(key);
      if (opts.reload !== false) await loadProject(view.id, true);
      setPlanEpoch((value) => value + 1);
      return result;
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
      return undefined;
    }
  };

  const commitPending = async (strokeId) => {
    const ops = pendingRef.current;
    pendingRef.current = [];
    if (ops.length === 0 || view === null) return;
    await applyOps(ops, strokeId, { reload: true });
  };

  const paintPending = (r, c, tile) => {
    if (activeLayer === null || activeLayer.kind !== "ground") return;
    pendingRef.current.push({ kind: "paint", layerId: activeLayer.id, cells: [{ r, c, tile }] });
    setPreviewTick((value) => value + 1);
  };

  const doUndo = async () => {
    if (view === null) return;
    const result = await api.isoUndo({ projectId: view.id, have: [...planRef.current.keys()] }).catch((error) => {
      setNotice({ kind: "error", text: msg(error) });
      return undefined;
    });
    if (result === undefined) return;
    for (const key of result.dropKeys ?? []) planRef.current.delete(key);
    clearPlan();
    await loadProject(view.id, true);
  };

  const doRedo = async () => {
    if (view === null) return;
    const result = await api.isoRedo({ projectId: view.id, have: [...planRef.current.keys()] }).catch((error) => {
      setNotice({ kind: "error", text: msg(error) });
      return undefined;
    });
    if (result === undefined) return;
    for (const key of result.dropKeys ?? []) planRef.current.delete(key);
    clearPlan();
    await loadProject(view.id, true);
  };

  const onPointerDown = async (event) => {
    if (view === null || layout === null) return;
    if (event.button === 2) return;
    const hit = cellFromEvent(event);
    if (hit === null) return;
    const panMode = tool === "hand" || spaceRef.current === true || event.button === 1;
    if (panMode) {
      strokeRef.current = { mode: "pan", pan: { x: pan.x, y: pan.y }, clientX: event.clientX, clientY: event.clientY };
      return;
    }
    if (tool === "marker") {
      const existing = view.markers.find((marker) => marker.r === hit.r && marker.c === hit.c);
      if (existing !== undefined) {
        setMarkerSel(existing.id);
        strokeRef.current = { mode: "marker", id: existing.id, from: { r: hit.r, c: hit.c } };
      } else {
        await applyOps([{ kind: "marker", op: "add", r: hit.r, c: hit.c, name: "" }], undefined, { reload: true });
        setMarkerSel(null);
      }
      return;
    }
    if (tool === "eraser") {
      if (activeLayer?.kind === "object") {
        const object = objectAtCell(hit.r, hit.c, activeLayer.id);
        if (object !== undefined) await applyOps([{ kind: "object", op: "remove", id: object.id }], undefined, { reload: true });
      } else {
        paintPending(hit.r, hit.c, 0);
        strokeRef.current = { mode: "paint", from: hit, tile: 0, id: `stroke-${Date.now()}` };
      }
      return;
    }
    if (tool === "bucket") {
      if (activeLayer?.kind !== "ground" || brush === null) return setNotice({ kind: "info", text: T("油漆桶只能铺地面层，先选一块地面素材。") });
      await applyOps([{ kind: "fill", layerId: activeLayer.id, r: hit.r, c: hit.c, tile: brush.index }], undefined, { reload: true });
      return;
    }
    if (tool === "pipette") {
      const entry = [...planOps.values()].flat().find((op) => op.r === hit.r && op.c === hit.c && (single === true || op.l === layerIndex));
      if (entry !== undefined) {
        const owner = view.tilesets.find((tileset) => (tileset.palette ?? []).some((item) => item.index === entry.t));
        const paletteEntry = owner?.palette?.find((item) => item.index === entry.t) ?? owner?.palette?.[0];
        if (owner !== undefined && paletteEntry !== undefined) selectBrush({ index: paletteEntry.index, tilesetId: owner.id, kind: owner.kind }, false);
      }
      return;
    }
    if (activeLayer?.kind === "object") {
      if (brush === null || brush.kind !== "object") return setNotice({ kind: "info", text: T("先在左边选一个物件。") });
      await applyOps([{ kind: "object", op: "add", layerId: activeLayer.id, tilesetId: brush.tilesetId, r: hit.r, c: hit.c }], undefined, { reload: true });
      return;
    }
    if (brush === null) return setNotice({ kind: "info", text: T("先在左边点一块图当笔刷。") });
    paintPending(hit.r, hit.c, brush.index);
    strokeRef.current = { mode: "paint", from: hit, tile: brush.index, id: `stroke-${Date.now()}` };
  };

  const onPointerMove = (event) => {
    if (layout === null) return;
    const hit = cellFromEvent(event);
    setHover((current) => (current !== null && hit !== null && current.r === hit.r && current.c === hit.c ? current : hit));
    const stroke = strokeRef.current;
    if (stroke === null || stroke === undefined) return;
    if (stroke.mode === "pan") {
      setPan(clampPan({ x: stroke.pan.x - (event.clientX - stroke.clientX) / zoom, y: stroke.pan.y - (event.clientY - stroke.clientY) / zoom }));
      return;
    }
    if (stroke.mode === "marker" && hit !== null && (stroke.from.r !== hit.r || stroke.from.c !== hit.c)) {
      stroke.from = { r: hit.r, c: hit.c };
      void applyOps([{ kind: "marker", op: "move", id: stroke.id, r: hit.r, c: hit.c }], undefined, { reload: false });
      return;
    }
    if (stroke.mode === "paint" && hit !== null && (stroke.from.r !== hit.r || stroke.from.c !== hit.c)) {
      const cells = ISO_lineCells(stroke.from.r, stroke.from.c, hit.r, hit.c);
      for (const cell of cells) paintPending(cell.r, cell.c, stroke.tile);
      stroke.from = hit;
    }
  };

  const onPointerUp = () => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    if (stroke !== null && stroke !== undefined && stroke.mode === "marker") {
      void commitPending(undefined).then(() => { if (view !== null) void loadProject(view.id, true); });
      return;
    }
    if (stroke !== null && stroke !== undefined && stroke.mode === "paint") void commitPending(stroke.id);
    else if (stroke?.mode === "pan") void commitPending(undefined);
  };

  // 快捷键
  React.useEffect(() => {
    const editable = (target) => target !== null && target !== undefined && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "");
    const onKeyDown = (event) => {
      if (String(event.key) === " ") {
        spaceRef.current = true;
        if (editable(event.target) !== true && typeof event.preventDefault === "function") event.preventDefault();
        return;
      }
      const meta = event.metaKey === true || event.ctrlKey === true;
      if (meta === true) {
        if (editable(event.target) === true) return;
        const key = String(event.key).toLowerCase();
        if (key === "z" && event.shiftKey === true) {
          event.preventDefault();
          void doRedo();
          return;
        }
        if (key === "z" || key === "y") {
          event.preventDefault();
          void doUndo();
        }
        return;
      }
      if (editable(event.target) === true) return;
      const key = String(event.key).toLowerCase();
      if (key === "b") setTool("pen");
      else if (key === "e") setTool("eraser");
      else if (key === "g") setTool("bucket");
      else if (key === "i") setTool("pipette");
      else if (key === "h") setTool("hand");
      else if (key === "m") setTool("marker");
      else if (key === "v") setSingle((value) => value !== true);
      else if (key === "escape") setBrush(null);
    };
    const onKeyUp = (event) => {
      if (String(event.key) === " ") spaceRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  // 画布绘制
  const draw = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || canvas === undefined || layout === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null || ctx === undefined) return;
    const width = Math.max(1, Math.round(viewport.w));
    const height = Math.max(1, Math.round(viewport.h));
    const dpr = Math.max(1, Math.min(3, (typeof window !== "undefined" && window.devicePixelRatio) || 1));
    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backingWidth, backingHeight);
    ctx.imageSmoothingEnabled = false;
    const scale = zoom * dpr;
    ctx.setTransform(scale, 0, 0, scale, -pan.x * scale, -pan.y * scale);
    if (single === true) {
      ctx.fillStyle = "rgb(40, 92, 52)";
      ctx.fillRect(pan.x, pan.y, width / zoom, height / zoom);
    }
    const list = [];
    for (const key of visibleKeys) {
      const ops = planOps.get(key);
      if (ops !== undefined) for (const op of ops) list.push(op);
    }
    list.sort((a, b) => a.z - b.z || a.r - b.r || a.c - b.c);
    let drawn = 0;
    for (const op of list) {
      const opFps = typeof op.fps === "number" && op.fps > 0 ? op.fps : activeFps;
      const frame = op.cycle === undefined || op.cycle.length === 0 ? op.t : op.cycle[Math.floor(animElapsed * opFps) % op.cycle.length];
      const entry = legendMap.get(frame);
      if (entry === undefined) continue;
      const image = imageRefs.current[entry.tilesetId];
      if (image === undefined || image === null) continue;
      ctx.globalAlpha = op.a === undefined ? 1 : op.a;
      ctx.drawImage(image, entry.rect.x, entry.rect.y, entry.rect.width, entry.rect.height, op.x, op.y, entry.rect.width, entry.rect.height);
      drawn++;
    }
    ctx.globalAlpha = 1;
    // 网格线：菱形边框，按可见范围画，数量有上限。
    if (showGrid === true) {
      const corners = [
        { x: pan.x, y: pan.y },
        { x: pan.x + width / zoom, y: pan.y },
        { x: pan.x, y: pan.y + height / zoom },
        { x: pan.x + width / zoom, y: pan.y + height / zoom }
      ].map((point) => ISO_pointToCellRaw(layout, point.x, point.y));
      const r0 = Math.max(0, Math.min(...corners.map((hit) => hit.r)) - 1);
      const c0 = Math.max(0, Math.min(...corners.map((hit) => hit.c)) - 1);
      const r1 = Math.min(view.rows - 1, Math.max(...corners.map((hit) => hit.r)) + 1);
      const c1 = Math.min(view.cols - 1, Math.max(...corners.map((hit) => hit.c)) + 1);
      if ((r1 - r0 + 1) * (c1 - c0 + 1) < 5000) {
        const thin = 1 / zoom;
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = thin;
        ctx.beginPath();
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const center = ISO_cellCenter(layout, r, c);
            ctx.moveTo(center.x, center.y - layout.stepY);
            ctx.lineTo(center.x + layout.stepX, center.y);
            ctx.lineTo(center.x, center.y + layout.stepY);
            ctx.lineTo(center.x - layout.stepX, center.y);
            ctx.closePath();
          }
        }
        ctx.stroke();
      }
    }
    // 通行区域
    if (showPass === true) {
      const colors = ["rgba(226,59,43,0.30)", "rgba(52,120,246,0.28)", "rgba(52,190,120,0.28)"];
      for (const cell of planPass) {
        const center = ISO_cellCenter(layout, cell.r, cell.c);
        ctx.beginPath();
        ctx.moveTo(center.x, center.y - layout.stepY);
        ctx.lineTo(center.x + layout.stepX, center.y);
        ctx.lineTo(center.x, center.y + layout.stepY);
        ctx.lineTo(center.x - layout.stepX, center.y);
        ctx.closePath();
        ctx.fillStyle = colors[cell.kind] ?? colors[0];
        ctx.fill();
      }
    }
    // 标记
    for (const marker of planMarkers) {
      ctx.beginPath();
      ctx.arc(marker.x, marker.y, marker.radius, 0, Math.PI * 2);
      ctx.fillStyle = marker.id === markerSel ? "rgba(210,59,44,0.92)" : "rgba(20,22,30,0.86)";
      ctx.fill();
      ctx.lineWidth = Math.max(1, marker.radius * 0.16);
      ctx.strokeStyle = "#f0c040";
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${marker.font}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(marker.n), marker.x, marker.y);
    }
    // 悬停菱形 / 物件占格幽灵
    if (hover !== null) {
      const thickness = 2 / zoom;
      const drawDiamond = (r, c, color, filled) => {
        const center = ISO_cellCenter(layout, r, c);
        ctx.beginPath();
        ctx.moveTo(center.x, center.y - layout.stepY);
        ctx.lineTo(center.x + layout.stepX, center.y);
        ctx.lineTo(center.x, center.y + layout.stepY);
        ctx.lineTo(center.x - layout.stepX, center.y);
        ctx.closePath();
        if (filled === true) {
          ctx.fillStyle = color;
          ctx.fill();
        } else {
          ctx.strokeStyle = color;
          ctx.lineWidth = thickness;
          ctx.stroke();
        }
      };
      const fp = brush !== null && brush.kind === "object" ? view.tilesets.find((tileset) => tileset.id === brush.tilesetId)?.footprint : undefined;
      if (activeLayer?.kind === "object" && fp !== undefined) {
        for (let dr = 0; dr < fp.rows; dr++) for (let dc = 0; dc < fp.cols; dc++) drawDiamond(hover.r + dr, hover.c + dc, "rgba(240,192,64,0.28)", true);
      }
      drawDiamond(hover.r, hover.c, "#e23b2b", false);
      // 悬停标记名字
      let found;
      let best = Infinity;
      for (const marker of planMarkers) {
        const distance = Math.hypot(marker.x - (pan.x + (hover.worldX ?? 0)), marker.y - (pan.y + (hover.worldY ?? 0)));
        if (distance < best) {
          best = distance;
          found = marker;
        }
      }
      void found;
    }
    if (planMarkers.length > 0 && hover !== null) {
      const target = planMarkers.find((marker) => marker.r === hover.r && marker.c === hover.c);
      if (target !== undefined && target.name !== "") {
        const font = Math.max(12 / zoom, target.font * 0.85);
        ctx.font = `600 ${font}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(20,22,30,0.9)";
        ctx.fillRect(target.x + target.radius + 3 / zoom, target.y - font, font * target.name.length + 8 / zoom, font * 1.6);
        ctx.fillStyle = "#f3e7d3";
        ctx.fillText(target.name, target.x + target.radius + 5 / zoom, target.y);
      }
    }
    if (typeof window !== "undefined" && (window as any).__isoDebug === true) {
      (window as any).__isoDrawStats = { drawn, ops: list.length, keys: [...visibleKeys], frame: Math.floor(animElapsed * activeFps) % planMeta.frameCount };
      (window as any).__isoCamera = { pan: { x: pan.x, y: pan.y }, zoom, viewport: { w: viewport.w, h: viewport.h } };
    }
  }, [layout, viewport, zoom, pan, planOps, visibleKeys, planMarkers, markerSel, legendMap, single, showGrid, showPass, planPass, hover, brush, activeLayer, animElapsed, activeFps, planMeta.frameCount, view?.id]);

  React.useEffect(() => {
    draw();
  }, [draw, imagesReady]);

  // ── 项目动作 ─────────────────────────────────────────────────────────
  const requestNewProject = () =>
    setNameAsk({
      mode: "create",
      title: T("新建 45° 地图"),
      value: T("我的地图"),
      cellW: 64,
      cellH: 96,
      cols: 32,
      rows: 32,
      wrap: true
    });

  const submitNameAsk = async () => {
    const ask = nameAsk;
    if (ask === null) return;
    setNameAsk(null);
    if (ask.mode === "rename") {
      if (view === null) return;
      await api.saveIsoProject({ projectId: view.id, name: ask.value }).catch((error) => setNotice({ kind: "error", text: msg(error) }));
      await loadProject(view.id, true);
      return;
    }
    setBusyKey("create");
    try {
      const created = await api.createIsoProject({
        name: ask.value.trim() === "" ? T("我的地图") : ask.value.trim(),
        cell: { width: Number(ask.cellW) || 64, height: Number(ask.cellH) || 96 },
        cols: Number(ask.cols) || 32,
        rows: Number(ask.rows) || 32,
        wrap: ask.wrap !== false
      });
      if (created !== undefined && created.id !== undefined) {
        await api.importIsoSampleTileset({ projectId: created.id }).catch(() => undefined);
        await refreshProjects();
        await loadProject(created.id);
        setOpenCard("assets");
      }
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const deleteProject = async () => {
    if (view === null) return;
    if (typeof window !== "undefined" && !window.confirm(T("确定删除项目「{n0}」？项目目录会被整个移除，无法撤销。", { n0: view.name }))) return;
    try {
      await api.deleteIsoProject({ projectId: view.id });
      const list = await refreshProjects();
      if (list.length > 0) await loadProject(list[0].id);
      else {
        setView(null);
        clearPlan();
      }
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    }
  };

  const restoreSamples = async () => {
    if (view === null) return;
    setBusyKey("sample");
    try {
      const result = await api.importIsoSampleTileset({ projectId: view.id });
      const added = Array.isArray(result?.tilesets) ? result.tilesets.length : 0;
      setNotice({ kind: "info", text: added > 0 ? T("已恢复 {n0} 张默认素材", { n0: String(added) }) : T("默认素材都在。") });
      await loadProject(view.id, true);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const saveLayerName = async (id, value) => {
    setLayerDraft(null);
    const name = String(value ?? "").trim();
    if (name === "" || view === null) return;
    await api.saveIsoDoc({ projectId: view.id, layers: [{ id, name }] }).catch((error) => setNotice({ kind: "error", text: msg(error) }));
    await loadProject(view.id, true);
  };

  const saveMarkerName = async (id, value) => {
    setMarkerDraft(null);
    if (view === null) return;
    await applyOps([{ kind: "marker", op: "rename", id, name: String(value ?? "") }], undefined, { reload: true });
  };

  const centerOnCell = (r, c) => {
    if (layout === null) return;
    const center = ISO_cellCenter(layout, r, c);
    setPan(clampPan({ x: center.x - viewport.w / (2 * zoom), y: center.y - viewport.h / (2 * zoom) }));
  };

  const runExport = async () => {
    if (view === null) return;
    if (exportFormats.png !== true && exportFormats.json !== true && exportFormats.tilesets !== true) {
      setNotice({ kind: "error", text: T("至少勾一项要导出的内容。") });
      return;
    }
    setBusyKey("export");
    try {
      await api.runIsoExport({ projectId: view.id, scale: exportScale, formats: { ...exportFormats } });
      await loadProject(view.id, true);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const runPreview = async () => {
    if (view === null) return;
    setBusyKey("preview");
    try {
      await api.runIsoPreview({ projectId: view.id });
      await loadProject(view.id, true);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  const runGenerate = async () => {
    if (view === null || activeLayer === null) return;
    const tiles = multi.length > 0 ? multi : brush === null ? [] : [brush.index];
    if (tiles.length === 0) {
      setNotice({ kind: "error", text: T("先选至少一块地面素材。") });
      return;
    }
    setBusyKey("gen");
    try {
      const result = await api.runIsoGenerate({ projectId: view.id, kind: genKind, tiles, seed: genSeed, layerId: activeLayer.id });
      if (result !== undefined && Number.isFinite(Number(result.seed)) && Number(result.seed) !== genSeed) setGenSeed(Number(result.seed));
      clearPlan();
      await loadProject(view.id, true);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  /** 「AI 生成素材」草稿：不自己生成，开一个新对话把活派出去。 */
  const openIsoAiAsset = () =>
    setAiDraft({
      prompt: "",
      name: "",
      frames: 1,
      mode: "image",
      kind: "auto",
      footprint: { cols: 1, rows: 1 }
    });

  const submitIsoAiAsset = async () => {
    const draft = aiDraft;
    if (draft === null || view === null) return;
    const prompt = draft.prompt.trim();
    if (prompt === "") {
      setNotice({ kind: "error", text: T("先写一段提示词。") });
      return;
    }
    const frames = Math.min(ASSET_FRAMES_MAX, Math.max(ASSET_FRAMES_MIN, Math.round(Number(draft.frames) || 1)));
    const mode = frames <= 1 ? "image" : draft.mode === "video" ? "video" : "image";
    const kind = draft.kind === "ground" || draft.kind === "object" ? draft.kind : "auto";
    const footprint = {
      cols: Math.max(1, Math.min(64, Math.round(Number(draft.footprint.cols) || 1))),
      rows: Math.max(1, Math.min(64, Math.round(Number(draft.footprint.rows) || 1)))
    };
    if (hiddenModules.includes("image")) {
      setNotice({ kind: "error", text: T("「图片生成」被隐藏了，去「设置 → 游戏素材大师 → 功能管理」打开再试。") });
      return;
    }
    if (mode === "video" && hiddenModules.includes("sequence")) {
      setNotice({ kind: "error", text: T("「序列帧生成」被隐藏了，去「设置 → 游戏素材大师 → 功能管理」打开再试。") });
      return;
    }
    setAiBusy(true);
    try {
      const name = draft.name.trim() === "" ? deriveAssetName(prompt) : draft.name.trim();
      const text = buildIsoAssetRequestPrompt({
        projectId: view.id,
        projectName: view.name,
        cell: view.cell,
        name,
        prompt,
        frames,
        mode,
        kind,
        footprint
      });
      await openIsoAssetChat(text);
      setAiDraft(null);
      setNotice({
        kind: "info",
        text:
          kind === "auto"
            ? T("已在新对话里开始生成：素材「{n0}」（地面 / 物件由对话判断）", { n0: name })
            : T("已在新对话里开始生成：素材「{n0}」（{n1}）", { n0: name, n1: kind === "ground" ? T("地面") : T("物件") })
      });
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setAiBusy(false);
    }
  };

  /**
   * AI 回链落点：把 `ai/<名字>.png` 取回来，打开「新增素材」并预填。
   *
   * 取不到图也照样打开空白对话框并说清楚；直接什么都不做的话，用户只会觉得
   * 「链接点了没反应」。
   */
  const openIsoAiAssetDraft = async (target, loaded) => {
    const cell = (loaded !== null && loaded !== undefined && loaded.cell) || (view !== null ? view.cell : null) || { width: 64, height: 96 };
    const scale = typeof target.scale === "number" && Number.isInteger(target.scale) && target.scale > 1 ? Math.min(8, target.scale) : 1;
    const kind = target.shape === "object" ? "object" : "ground";
    const frames = typeof target.frames === "number" && Number.isFinite(target.frames) && target.frames > 0 ? Math.round(target.frames) : 1;
    const footprint = {
      cols: typeof target.cols === "number" && Number.isFinite(target.cols) ? Math.max(1, Math.min(64, Math.round(target.cols))) : 1,
      rows: typeof target.rows === "number" && Number.isFinite(target.rows) ? Math.max(1, Math.min(64, Math.round(target.rows))) : 1
    };
    const relative = typeof target.asset === "string" ? target.asset : "";
    const stem = relative === "" ? "" : String(relative).split("/").pop().replace(/\.[^.]+$/u, "");
    const draft = {
      base64: "",
      name: stem,
      kind,
      sourceW: cell.width * scale,
      sourceH: cell.height * scale,
      frames: kind === "object" ? frames : 1,
      animRows: kind === "ground" && frames > 1,
      footprint,
      anchor: { x: 0.5, y: 1 },
      objectScale: 1,
      passMode: 1,
      keyGreen: target.keyed !== 1,
      clarity: "smooth"
    };
    setOpenCard("assets");
    setAddPreview(null);
    const base = (loaded !== null && loaded !== undefined && loaded.assetBase) || (view !== null ? view.assetBase : "");
    if (relative === "" || base === "") {
      setAddDraft(draft);
      return;
    }
    try {
      const response = await fetch(`${base}${relative}`);
      if (response === undefined || response.ok !== true) throw new Error(String(response?.status ?? "fetch failed"));
      const blob = await response.blob();
      const base64 = await readFileBase64(blob);
      setAddDraft({ ...draft, base64 });
      setAddPreview(`data:image/png;base64,${base64}`);
    } catch (error) {
      setAddDraft(draft);
      setNotice({ kind: "error", text: T("没取到刚生成的那张图（{n0}）。你可以自己选一张，或者回对话里再要一次。", { n0: msg(error) }) });
    }
  };

  const importAsset = async () => {
    if (view === null || addDraft === null) return;
    setBusyKey("import");
    try {
      const base64 = addDraft.base64;
      if (base64 === "") throw new Error(T("先选一张素材图。"));
      const pass = addDraft.kind === "object" ? new Array(Math.max(1, Number(addDraft.footprint.cols)) * Math.max(1, Number(addDraft.footprint.rows))).fill(Number(addDraft.passMode) || 1) : undefined;
      const result = await api.importIsoTileset({
        projectId: view.id,
        name: addDraft.name,
        data: base64,
        kind: addDraft.kind,
        sourceCell: { width: Number(addDraft.sourceW) || view.cell.width, height: Number(addDraft.sourceH) || view.cell.height },
        animRows: addDraft.animRows === true,
        frames: Number(addDraft.frames) || 1,
        footprint: addDraft.kind === "object" ? { cols: Number(addDraft.footprint.cols) || 1, rows: Number(addDraft.footprint.rows) || 1 } : undefined,
        anchor: addDraft.kind === "object" ? addDraft.anchor ?? { x: 0.5, y: 1 } : undefined,
        objectScale: addDraft.kind === "object" ? Number(addDraft.objectScale) || 1 : undefined,
        pass,
        keyGreen: addDraft.keyGreen === true,
        clarity: addDraft.clarity
      });
      if (result !== undefined && Array.isArray(result.warnings) && result.warnings.length > 0) setNotice({ kind: "info", text: result.warnings.join("；") });
      setAddDraft(null);
      await loadProject(view.id, true);
    } catch (error) {
      setNotice({ kind: "error", text: msg(error) });
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * 「新增素材」预览的几何：图片与 2:1 菱形地格放进同一个**地图像素**坐标系，
   * 再由 SVG 的 `viewBox` 等比缩放到对话框里。
   *
   * 旧实现是 CSS 矩形网格：1×1 物件时「网格」正好和图片一样大，屏幕上只有
   * 一片蓝底 + 一条黄线，根本看不出地格。等距地格必须是菱形（宽
   * `cell.width`、高 `cell.width / 2`），而且物件按「占格菱形的中心 = 图片锚点」摆。
   */
  const addIsObject = addDraft?.kind === "object";
  const addObjectScale = addDraft === null || addDraft.kind !== "object"
    ? 1
    : Math.max(ISO_OBJECT_SCALE_MIN, Math.min(ISO_OBJECT_SCALE_MAX, Number(addDraft.objectScale) || 1));
  const addPreviewScene = addDraft === null ? null : ISO_addPreviewScene({
    cell: view?.cell ?? { width: 64, height: 96 },
    object: addDraft.kind === "object",
    cols: Number(addDraft.footprint.cols) || 1,
    rows: Number(addDraft.footprint.rows) || 1,
    scale: addObjectScale,
    anchor: addDraft.anchor ?? { x: 0.5, y: 1 },
    frames: Number(addDraft.frames) || 1,
    naturalWidth: addPreviewNatural.width,
    naturalHeight: addPreviewNatural.height,
    sourceW: Number(addDraft.sourceW) || 1,
    sourceH: Number(addDraft.sourceH) || 1
  });

  const beginAddPreviewDrag = (event) => {
    if (addDraft === null || addDraft.kind !== "object" || addPreviewScene === null) return;
    addPreviewDragRef.current = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      imageWidth: Math.max(1, addPreviewScene.imageWidth),
      frameHeight: Math.max(1, addPreviewScene.frameHeight)
    };
    setAddPreviewDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  };
  /** 拖动**逐帧增量**换算；每帧重新读 SVG 的等比缩放，图片才会跟手（不会越拖越偏）。 */
  const moveAddPreviewDrag = (event) => {
    const drag = addPreviewDragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (dx === 0 && dy === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const box = event.currentTarget.viewBox?.baseVal;
    const zoom = box !== undefined && box.width > 0 && box.height > 0 ? Math.min(rect.width / box.width, rect.height / box.height) : 1;
    const perCss = 1 / Math.max(0.0001, zoom);
    setAddDraft((current) => {
      if (current === null) return current;
      const anchor = current.anchor ?? { x: 0.5, y: 1 };
      return {
        ...current,
        anchor: {
          x: clampAnchor(anchor.x - (dx * perCss) / drag.imageWidth),
          y: clampAnchor(anchor.y - (dy * perCss) / drag.frameHeight)
        }
      };
    });
    event.preventDefault?.();
  };
  const endAddPreviewDrag = (event) => {
    const drag = addPreviewDragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    addPreviewDragRef.current = null;
    setAddPreviewDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  /** 「新增素材」预览；物件的大小滑杆就排在图片正下方，调的时候不用离开画面。 */
  const addPreviewNode = addPreview === null || addDraft === null || addPreviewScene === null ? null : h(
    "div",
    { className: "SPR_isoPreviewWrap" },
    h(
      "div",
      {
        className: "SPR_isoPreviewStage",
        "data-testid": "iso-add-preview",
        "data-draggable": addIsObject ? "true" : undefined,
        "data-dragging": addPreviewDragging ? "true" : undefined
      },
      h("img", {
        className: "SPR_isoPreviewSizer",
        src: addPreview,
        alt: "",
        onLoad: (event) => setAddPreviewNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
      }),
      h(
        "svg",
        {
          className: "SPR_isoPreviewSvg",
          viewBox: addPreviewScene.viewBox,
          preserveAspectRatio: "xMidYMid meet",
          onPointerDown: beginAddPreviewDrag,
          onPointerMove: moveAddPreviewDrag,
          onPointerUp: endAddPreviewDrag,
          onPointerCancel: endAddPreviewDrag
        },
        h("image", {
          href: addPreview,
          x: addPreviewScene.image.x,
          y: addPreviewScene.image.y,
          width: addPreviewScene.image.width,
          height: addPreviewScene.image.height,
          preserveAspectRatio: "none"
        }),
        addPreviewScene.cells.map((point, index) =>
          h("path", {
            key: index,
            className: "SPR_isoPreviewCell",
            d: `M ${point.x} ${point.y - addPreviewScene.halfH} L ${point.x + addPreviewScene.halfW} ${point.y} L ${point.x} ${point.y + addPreviewScene.halfH} L ${point.x - addPreviewScene.halfW} ${point.y} Z`
          })
        ),
        addPreviewScene.base === null
          ? null
          : h(
              "g",
              { className: "SPR_isoPreviewBase" },
              h("circle", { cx: addPreviewScene.base.x, cy: addPreviewScene.base.y, r: Math.max(2, addPreviewScene.cell.width * 0.045) }),
              h("line", {
                x1: addPreviewScene.base.x - addPreviewScene.cell.width * 0.38,
                y1: addPreviewScene.base.y,
                x2: addPreviewScene.base.x + addPreviewScene.cell.width * 0.38,
                y2: addPreviewScene.base.y
              }),
              h("line", {
                x1: addPreviewScene.base.x,
                y1: addPreviewScene.base.y - addPreviewScene.cell.width * 0.22,
                x2: addPreviewScene.base.x,
                y2: addPreviewScene.base.y + addPreviewScene.cell.width * 0.22
              })
            )
      )
    ),
    h(
      "div",
      { className: "SPR_isoPreviewHintRow" },
      h(
        "span",
        { className: "SPR_isoPreviewHint" },
        addIsObject
          ? T("蓝色菱形是地格，黄点是落地点；按住图片拖动可以改落点。")
          : T("蓝色菱形是每一格；源图每格宽 / 高决定切几格。")
      ),
      addIsObject
        ? h(
            "button",
            {
              type: "button",
              className: "SPR_isoMini",
              onClick: () => setAddDraft((current) => (current === null ? current : { ...current, anchor: { x: 0.5, y: 1 } }))
            },
            T("重置位置")
          )
        : null
    ),
    addIsObject
      ? h(
          "div",
          { className: "SPR_isoPreviewSizeRow" },
          h("span", { className: "SPR_isoPreviewSizeLabel" }, T("大小")),
          h("input", {
            type: "range",
            className: "SPR_isoRange",
            "data-testid": "iso-add-scale",
            min: Math.round(ISO_OBJECT_SCALE_MIN * 100),
            max: Math.round(ISO_OBJECT_SCALE_MAX * 100),
            step: 5,
            value: Math.round(addObjectScale * 100),
            title: T("100% = 图片宽度正好占满这几格；调小就缩在地格里，调大就超出地格。"),
            onChange: (event) => {
              const percent = Number(event.target.value);
              setAddDraft((current) => (current === null ? current : { ...current, objectScale: Math.max(ISO_OBJECT_SCALE_MIN, Math.min(ISO_OBJECT_SCALE_MAX, percent / 100)) }));
            }
          }),
          h("span", { className: "SPR_isoScaleValue", "data-testid": "iso-add-scale-value" }, `${Math.round(addObjectScale * 100)}%`),
          h(
            "button",
            {
              type: "button",
              className: "SPR_isoMini",
              onClick: () => setAddDraft((current) => (current === null ? current : { ...current, objectScale: 1 }))
            },
            T("恢复 100%")
          )
        )
      : null
  );

  const addDialog = addDraft === null ? null : h(
    "div",
    { className: "SPR_isoDlgMask", onClick: () => (busyKey === "import" ? undefined : setAddDraft(null)) },
    h(
      "div",
      { className: "SPR_isoDlg", onClick: (event) => event.stopPropagation() },
      h("div", { className: "SPR_isoDlgHead" }, h("b", null, T("新增素材")), h("span", { style: { flex: 1 } }), h("button", { type: "button", className: "SPR_isoClose", onClick: () => setAddDraft(null) }, "×")),
      h("label", { className: "SPR_isoLabel" }, T("素材图")),
      h("input", { ref: addFileRef, type: "file", accept: "image/*", onChange: (event) => {
        const file = event.target.files?.[0];
        if (file === undefined || file === null) return;
        const reader = new FileReader();
        reader.onload = () => {
          const data = String(reader.result ?? "");
          const base64 = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
          setAddDraft((current) => (current === null ? current : { ...current, base64, name: current.name === "" ? file.name.replace(/\.[^.]+$/, "") : current.name }));
          setAddPreview(data);
        };
        reader.readAsDataURL(file);
        event.target.value = "";
      } }),
      addPreviewNode,
      h("label", { className: "SPR_isoLabel" }, T("叫什么")),
      h("input", { className: "SPR_isoInput", value: addDraft.name, onChange: (event) => setAddDraft((current) => ({ ...current, name: event.target.value })) }),
      h("label", { className: "SPR_isoLabel" }, T("这块素材怎么用")),
      h("select", { className: "SPR_isoInput", value: addDraft.kind, onChange: (event) => setAddDraft((current) => ({ ...current, kind: event.target.value })) },
        h("option", { value: "ground" }, T("地面（网格图块）")),
        h("option", { value: "autotile" }, T("自动连接（4×4 = 16 块）")),
        h("option", { value: "object" }, T("物件（一张完整图，可占多格）"))
      ),
      h("div", { className: "SPR_isoRow" },
        h(NumField, { label: T("源图每格宽"), value: Number(addDraft.sourceW), min: 1, max: 512, onChange: (value) => setAddDraft((current) => ({ ...current, sourceW: value })) }),
        h(NumField, { label: T("源图每格高"), value: Number(addDraft.sourceH), min: 1, max: 768, onChange: (value) => setAddDraft((current) => ({ ...current, sourceH: value })) })
      ),
      addDraft.kind === "ground"
        ? h("label", { className: "SPR_isoCheck" }, h("input", { type: "checkbox", checked: addDraft.animRows === true, onChange: (event) => setAddDraft((current) => ({ ...current, animRows: event.target.checked })) }), T("会动（每一行是一帧）"))
        : null,
      addDraft.kind === "object"
        ? h(React.Fragment, null,
            h("div", { className: "SPR_isoRow" },
              h(NumField, { label: T("占几格宽"), value: Number(addDraft.footprint.cols), min: 1, max: 512, onChange: (value) => setAddDraft((current) => ({ ...current, footprint: { ...current.footprint, cols: value } })) }),
              h(NumField, { label: T("占几格高"), value: Number(addDraft.footprint.rows), min: 1, max: 512, onChange: (value) => setAddDraft((current) => ({ ...current, footprint: { ...current.footprint, rows: value } })) })
            ),
            h(NumField, { label: T("帧数"), value: Number(addDraft.frames), min: 1, max: 64, onChange: (value) => setAddDraft((current) => ({ ...current, frames: value })) }),
            h("label", { className: "SPR_isoLabel" }, T("通行性")),
            h("select", { className: "SPR_isoInput", value: String(addDraft.passMode), onChange: (event) => setAddDraft((current) => ({ ...current, passMode: Number(event.target.value) })) },
              h("option", { value: "1" }, T("可通过 · 角色在上面")),
              h("option", { value: "0" }, T("不可通过")),
              h("option", { value: "2" }, T("可通过 · 物件盖住角色"))
            ),
            h("label", { className: "SPR_isoCheck" }, h("input", { type: "checkbox", checked: addDraft.keyGreen === true, onChange: (event) => setAddDraft((current) => ({ ...current, keyGreen: event.target.checked })) }), T("抠掉绿幕背景"))
          )
        : null,
      h("label", { className: "SPR_isoLabel" }, T("清晰度")),
      h("select", { className: "SPR_isoInput", value: addDraft.clarity, onChange: (event) => setAddDraft((current) => ({ ...current, clarity: event.target.value })) },
        h("option", { value: "smooth" }, T("平滑")),
        h("option", { value: "sharp" }, T("锐利")),
        h("option", { value: "crisp" }, T("清晰"))
      ),
      h("div", { className: "SPR_isoRow" },
        h(Btn, { onClick: () => setAddDraft(null) }, T("取消")),
        h(Btn, { primary: true, busy: busyKey === "import", onClick: () => void importAsset() }, T("确定"))
      )
    )
  );

  const aiDialog = aiDraft === null ? null : h(
    "div",
    { className: "SPR_isoDlgMask", onClick: () => (aiBusy ? undefined : setAiDraft(null)) },
    h(
      "div",
      { className: "SPR_isoDlg", role: "dialog", "aria-label": T("AI 生成素材"), "data-testid": "iso-ai-dialog", onClick: (event) => event.stopPropagation() },
      h("div", { className: "SPR_isoDlgHead" }, h("b", null, T("AI 生成素材")), h("span", { style: { flex: 1 } }), h("button", { type: "button", className: "SPR_isoClose", onClick: () => (aiBusy ? undefined : setAiDraft(null)) }, "×")),
      h("p", { className: "SPR_isoHint" }, T("它会开一个新对话，让对话里的 agent 生成并整理；做完贴一条链接，点回来这张图就会填进「新增素材」。只支持地面 / 物件，自动连接仍走手工导入。")),
      h("label", { className: "SPR_isoLabel" }, T("提示词")),
      h("textarea", {
        className: "SPR_isoInput",
        "data-testid": "iso-ai-prompt",
        rows: 4,
        value: aiDraft.prompt,
        placeholder: T("想要什么素材？例如「一块长满青苔的灰色石地」或「一棵歪脖子的松树」"),
        onChange: (event) => setAiDraft((current) => (current === null ? current : { ...current, prompt: event.target.value }))
      }),
      h("label", { className: "SPR_isoLabel" }, T("素材名字")),
      h("input", {
        className: "SPR_isoInput",
        "data-testid": "iso-ai-name",
        value: aiDraft.name,
        placeholder: T("留空就用提示词开头几个字"),
        onChange: (event) => setAiDraft((current) => (current === null ? current : { ...current, name: event.target.value }))
      }),
      h("label", { className: "SPR_isoLabel" }, T("动画帧数（1 = 静态）")),
      h(NumField, {
        label: T("帧"),
        value: aiDraft.frames,
        min: ASSET_FRAMES_MIN,
        max: ASSET_FRAMES_MAX,
        onChange: (value) => setAiDraft((current) => (current === null ? current : { ...current, frames: value, mode: value <= 1 ? "image" : current.mode }))
      }),
      h("label", { className: "SPR_isoLabel" }, T("动画生成方式")),
      h(
        "select",
        { className: "SPR_isoInput", "data-testid": "iso-ai-mode", value: aiDraft.mode, onChange: (event) => setAiDraft((current) => (current === null ? current : { ...current, mode: event.target.value })) },
        h("option", { value: "image" }, T("生图模型")),
        h("option", { value: "video" }, T("视频模型"))
      ),
      h("p", { className: "SPR_isoHint" }, aiDraft.frames <= 1 ? T("帧数为 1 时只用生图模型：出一张静态素材。想要会动的，把帧数改成大于 1。") : aiDraft.mode === "video" ? T("视频模型：先出一张静态首帧，再让它动起来并抽出这些帧。比生图模型多一次计费。") : T("生图模型：按同一个提示词出多张图。动作没有视频模型连贯，但更省。")),
      h("label", { className: "SPR_isoLabel" }, T("这块素材怎么用")),
      h(
        "select",
        { className: "SPR_isoInput", "data-testid": "iso-ai-kind", value: aiDraft.kind, onChange: (event) => setAiDraft((current) => (current === null ? current : { ...current, kind: event.target.value })) },
        h("option", { value: "auto" }, T("自动判断")),
        h("option", { value: "ground" }, T("地面（2:1 菱形）")),
        h("option", { value: "object" }, T("物件（一张完整图，可占多格）"))
      ),
      h("p", { className: "SPR_isoHint" }, aiDraft.kind === "ground" ? T("地面：模型只画一块 2:1 菱形，菱形外是纯绿幕；宿主会抠绿、裁边并缩进菱形格。") : aiDraft.kind === "object" ? T("物件：模型只画一个完整物件，纯绿幕背景；宿主会抠绿、按占格缩放。") : T("自动判断：成片铺开、会跟邻居接 → 地面；单独一个、不跟邻居接 → 物件。自动连接（4×4）首版不做，请手工导入。")),
      aiDraft.kind !== "ground"
        ? h(React.Fragment, null,
            h("label", { className: "SPR_isoLabel" }, T("物件占几格（自动 / 物件时用）")),
            h("div", { className: "SPR_isoRow" },
              h(NumField, { label: T("宽"), value: Number(aiDraft.footprint.cols), min: 1, max: 64, onChange: (value) => setAiDraft((current) => (current === null ? current : { ...current, footprint: { ...current.footprint, cols: value } })) }),
              h(NumField, { label: T("高"), value: Number(aiDraft.footprint.rows), min: 1, max: 64, onChange: (value) => setAiDraft((current) => (current === null ? current : { ...current, footprint: { ...current.footprint, rows: value } })) })
            )
          )
        : null,
      h("div", { className: "SPR_isoRow" },
        h(Btn, { onClick: () => (aiBusy ? undefined : setAiDraft(null)) }, T("取消")),
        h(Btn, { primary: true, busy: aiBusy, "data-testid": "iso-ai-ok", onClick: () => void submitIsoAiAsset() }, T("生成"))
      )
    )
  );

  const tsDialog = tsEdit === null ? null : h(
    "div",
    { className: "SPR_isoDlgMask", onClick: () => setTsEdit(null) },
    h("div", { className: "SPR_isoDlg", onClick: (event) => event.stopPropagation() },
      h("div", { className: "SPR_isoDlgHead" }, h("b", null, T("素材属性")), h("span", { style: { flex: 1 } }), h("button", { type: "button", className: "SPR_isoClose", onClick: () => setTsEdit(null) }, "×")),
      h("label", { className: "SPR_isoLabel" }, T("名字")),
      h("input", { className: "SPR_isoInput", value: tsEdit.name, onChange: (event) => setTsEdit((current) => ({ ...current, name: event.target.value })) }),
      h("label", { className: "SPR_isoLabel" }, T("动画速度")),
      h("select", { className: "SPR_isoInput", value: tsEdit.fps, onChange: (event) => setTsEdit((current) => ({ ...current, fps: event.target.value })) },
        h("option", { value: "" }, T("跟设置里的动画速度")),
        [1, 2, 4, 6, 8, 12].map((value) => h("option", { key: value, value: String(value) }, T("{n0} 帧/秒", { n0: String(value) })))
      ),
      h("label", { className: "SPR_isoLabel" }, T("循环方式")),
      h("select", { className: "SPR_isoInput", value: tsEdit.loop, onChange: (event) => setTsEdit((current) => ({ ...current, loop: event.target.value })) },
        h("option", { value: "forward" }, T("正放")),
        h("option", { value: "reverse" }, T("倒放")),
        h("option", { value: "pingpong" }, T("来回"))
      ),
      h("div", { className: "SPR_isoRow" },
        h(Btn, { onClick: () => setTsEdit(null) }, T("取消")),
        h(Btn, { primary: true, busy: busyKey === "tileset", onClick: async () => {
          setBusyKey("tileset");
          try {
            await api.saveIsoTileset({ projectId: view.id, tilesetId: tsEdit.tilesetId, name: tsEdit.name, fps: tsEdit.fps === "" ? null : Number(tsEdit.fps), loop: tsEdit.loop });
            setTsEdit(null);
            await loadProject(view.id, true);
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
          } finally {
            setBusyKey(null);
          }
        } }, T("保存"))
      )
    )
  );

  const nameDialog = nameAsk === null ? null : h(
    "div",
    { className: "SPR_isoDlgMask", onClick: () => setNameAsk(null) },
    h("div", { className: "SPR_isoDlg", onClick: (event) => event.stopPropagation() },
      h("div", { className: "SPR_isoDlgHead" }, h("b", null, nameAsk.title), h("span", { style: { flex: 1 } }), h("button", { type: "button", className: "SPR_isoClose", onClick: () => setNameAsk(null) }, "×")),
      h("label", { className: "SPR_isoLabel" }, T("名字")),
      h("input", { className: "SPR_isoInput", autoFocus: true, value: nameAsk.value, onChange: (event) => setNameAsk((current) => ({ ...current, value: event.target.value })) }),
      nameAsk.mode === "create"
        ? h(React.Fragment, null,
            h("div", { className: "SPR_isoRow" },
              h(NumField, { label: T("格子宽"), value: Number(nameAsk.cellW), min: 16, max: 512, step: 4, onChange: (value) => setNameAsk((current) => ({ ...current, cellW: value })) }),
              h(NumField, { label: T("格子高"), value: Number(nameAsk.cellH), min: 32, max: 768, onChange: (value) => setNameAsk((current) => ({ ...current, cellH: value })) })
            ),
            h("div", { className: "SPR_isoRow" },
              h(NumField, { label: T("列"), value: Number(nameAsk.cols), min: 1, max: 512, onChange: (value) => setNameAsk((current) => ({ ...current, cols: value })) }),
              h(NumField, { label: T("行"), value: Number(nameAsk.rows), min: 1, max: 512, onChange: (value) => setNameAsk((current) => ({ ...current, rows: value })) })
            ),
            h("label", { className: "SPR_isoCheck" }, h("input", { type: "checkbox", checked: nameAsk.wrap === true, onChange: (event) => setNameAsk((current) => ({ ...current, wrap: event.target.checked })) }), T("地图四周环绕"))
          )
        : null,
      h("div", { className: "SPR_isoRow" },
        h(Btn, { onClick: () => setNameAsk(null) }, T("取消")),
        h(Btn, { primary: true, busy: busyKey === "create", onClick: () => void submitNameAsk() }, T("确定"))
      )
    )
  );

  const shell = (inner) => h("div", { className: "SPR_moduleBody", "data-module": "iso" }, inner, nameDialog, addDialog, aiDialog, tsDialog);

  if (view === null || layout === null) {
    return shell(h("div", { className: "SPR_isoRoot" },
      h("div", { className: "SPR_isoEmpty" },
        h("p", { className: "SPR_isoEmptyTitle" }, T("还没有 45° 地图项目。")),
        h("p", { className: "SPR_isoHint" }, T("建一个项目就能直接画；自带一套 45° 素材，不用先准备图。")),
        h("div", { className: "SPR_isoRow" },
          h(Btn, { primary: true, onClick: requestNewProject }, T("新建项目")),
          h(Btn, { onClick: () => void (async () => {
            try {
              const created = await api.createIsoProject({ name: T("我的地图"), cell: { width: 64, height: 96 }, cols: 32, rows: 32, wrap: true });
              await api.importIsoSampleTileset({ projectId: created.id }).catch(() => undefined);
              await refreshProjects();
              await loadProject(created.id);
              setOpenCard("assets");
            } catch (error) {
              setNotice({ kind: "error", text: msg(error) });
            }
          })() }, T("用自带素材试试"))
        ),
        notice === null ? null : h("div", { className: `SPR_notice SPR_notice-${notice.kind}` }, notice.text)
      )
    ));
  }

  const menu = h("div", { className: "SPR_isoMenu" },
    h("button", { type: "button", className: "SPR_isoMenuItem", onClick: () => { setMenuOpen(false); requestNewProject(); } }, T("新建项目")),
    h("button", { type: "button", className: "SPR_isoMenuItem", onClick: () => { setMenuOpen(false); setNameAsk({ mode: "rename", title: T("重命名项目"), value: view.name }); } }, T("重命名")),
    h("button", { type: "button", className: "SPR_isoMenuItem", onClick: () => { setMenuOpen(false); void deleteProject(); } }, T("删除项目")),
    h("div", { className: "SPR_isoMenuLabel" }, T("切换项目")),
    projects.map((entry) => h("button", { key: entry.id, type: "button", className: "SPR_isoMenuItem", "data-on": entry.id === view.id ? "true" : undefined, onClick: () => { setMenuOpen(false); void loadProject(entry.id); } },
      h("span", { className: "SPR_projNameRow" },
        h("span", { className: "SPR_projName" }, entry.name),
        h(CopyIdButton, { id: entry.id, inline: true })
      )
    ))
  );

  const palette = h("div", { className: "SPR_isoPalette" },
    h("div", { className: "SPR_isoPaletteGrid" },
      paletteEntries.map((entry) => {
        const owner = entry.tileset;
        const url = `${view.assetBase}${owner.file}?v=${owner.rev ?? 0}`;
        const bw = owner.cell.width;
        const bh = owner.cell.height;
        const sizeX = (owner.imageWidth / Math.max(1, entry.rect.width)) * 100;
        const sizeY = (owner.imageHeight / Math.max(1, entry.rect.height)) * 100;
        const posX = owner.imageWidth <= entry.rect.width ? 0 : (entry.rect.x / Math.max(1, owner.imageWidth - entry.rect.width)) * 100;
        const posY = owner.imageHeight <= entry.rect.height ? 0 : (entry.rect.y / Math.max(1, owner.imageHeight - entry.rect.height)) * 100;
        return h("button", {
          key: `${entry.tilesetId}:${entry.index}`,
          type: "button",
          className: "SPR_isoTile",
          "data-on": brush !== null && brush.index === entry.index && brush.tilesetId === entry.tilesetId ? "true" : undefined,
          title: `${entry.name}${owner.frames > 1 ? ` · ${owner.frames} 帧` : ""}`,
          style: {
            backgroundImage: `url(${url})`,
            backgroundSize: `${sizeX}% ${sizeY}%`,
            backgroundPosition: `${posX}% ${posY}%`,
            imageRendering: "pixelated"
          },
          onClick: (event) => selectBrush(entry, event.shiftKey === true || event.ctrlKey === true)
        });
      })
    ),
    paletteEntries.length === 0 ? h("p", { className: "SPR_isoHint" }, T("这一层还没有可用的笔刷。点「素材」导入，或换到另一层。")) : null
  );

  const toolButton = (key, label, icon, onClick, opts: any = {}) =>
    h("button", {
      key,
      type: "button",
      className: "SPR_isoTool",
      "data-on": opts.on === true ? "true" : undefined,
      disabled: opts.disabled === true,
      title: `${label}${opts.hint === undefined ? "" : ` · ${opts.hint}`}`,
      onClick
    }, h(MapToolIcon, { name: icon }));

  const tools = h("div", { className: "SPR_isoTools" },
    toolButton("undo", T("撤销"), "undo", () => void doUndo(), { hint: "⌘Z", disabled: view.canUndo !== true }),
    toolButton("redo", T("重做"), "redo", () => void doRedo(), { hint: "⇧⌘Z", disabled: view.canRedo !== true }),
    toolButton("pen", T("画笔"), "pen", () => setTool("pen"), { on: tool === "pen", hint: "B" }),
    toolButton("eraser", T("橡皮"), "eraser", () => setTool("eraser"), { on: tool === "eraser", hint: "E" }),
    toolButton("bucket", T("油漆桶"), "bucket", () => setTool("bucket"), { on: tool === "bucket", hint: "G" }),
    toolButton("pipette", T("吸管"), "pipette", () => setTool("pipette"), { on: tool === "pipette", hint: "I" }),
    toolButton("hand", T("抓手"), "hand", () => setTool("hand"), { on: tool === "hand", hint: "H" }),
    toolButton("marker", T("标记"), "marker", () => setTool("marker"), { on: tool === "marker", hint: "M" }),
    h("button", { key: "layer", type: "button", className: "SPR_isoTool SPR_isoLayerBtn", title: T("图层"), onClick: () => setOpenCard(openCard === "layers" ? null : "layers") },
      h("span", null, String(layerIndex + 1)),
      h("small", null, activeLayer?.kind === "object" ? T("物件") : T("地面"))
    ),
    toolButton("grid", T("网格线"), "grid", () => setShowGrid((value) => value !== true), { on: showGrid === true }),
    toolButton("gen", T("一键生成"), "magic", () => setOpenCard(openCard === "gen" ? null : "gen"), { on: openCard === "gen" }),
    toolButton("settings", T("设置"), "settings", () => setOpenCard(openCard === "settings" ? null : "settings"), { on: openCard === "settings" })
  );

  const side = h("div", { className: "SPR_isoSide" },
    h("div", { className: "SPR_isoSideTitle" }, activeLayer?.kind === "object" ? T("物件调色板") : T("地面调色板")),
    palette,
    tools
  );

  const cardHead = (title) => h("div", { className: "SPR_isoCardHead" }, h("b", null, title), h("span", { style: { flex: 1 } }), h("button", { type: "button", className: "SPR_isoClose", onClick: () => setOpenCard(null) }, "×"));

  const assetsCard = h("div", { className: "SPR_isoCard" },
    cardHead(T("素材")),
    h("div", { className: "SPR_isoRow" },
      h(Btn, { primary: true, onClick: () => { setAddDraft({ base64: "", name: "", kind: "ground", sourceW: view.cell.width, sourceH: view.cell.height, frames: 1, animRows: false, footprint: { cols: 1, rows: 1 }, anchor: { x: 0.5, y: 1 }, objectScale: 1, passMode: 1, keyGreen: false, clarity: "smooth" }); setAddPreview(null); setAddPreviewNatural({ width: 0, height: 0 }); } }, T("新增素材")),
      h(Btn, { "data-testid": "iso-ai-open", onClick: openIsoAiAsset }, T("AI 生成素材")),
      h(Btn, { busy: busyKey === "sample", onClick: () => void restoreSamples() }, T("恢复默认素材")),
      h(Btn, { onClick: () => setGuidePage(0) }, T("素材说明"))
    ),
    h("div", { className: "SPR_isoAssetList" },
      view.tilesets.map((tileset) => h("div", { key: tileset.id, className: "SPR_isoAssetRow" },
        h("button", { type: "button", className: "SPR_isoAssetName", onClick: () => setTsEdit({ tilesetId: tileset.id, name: tileset.name, fps: tileset.fps === undefined ? "" : String(tileset.fps), loop: tileset.loop ?? "forward" }) }, tileset.name),
        h("span", { className: "SPR_isoAssetMeta" }, tileset.reason),
        tileset.builtin === true ? h("span", { className: "SPR_isoBadge" }, T("自带")) : null,
        h("button", { type: "button", className: "SPR_isoMini", onClick: async () => {
          if (!window.confirm(T("确定删除素材「{n0}」？它切出来的块和放下的物件会一起删掉。", { n0: tileset.name }))) return;
          try {
            const result = await api.removeIsoTileset({ projectId: view.id, tilesetId: tileset.id });
            if (Array.isArray(result?.warnings) && result.warnings.length > 0) setNotice({ kind: "info", text: result.warnings.join("；") });
            await loadProject(view.id, true);
          } catch (error) {
            setNotice({ kind: "error", text: msg(error) });
          }
        } }, "×")
      ))
    )
  );

  const layersCard = h("div", { className: "SPR_isoCard" },
    cardHead(T("图层")),
    h("div", { className: "SPR_isoRow" },
      h(Btn, { onClick: async () => { await api.saveIsoDoc({ projectId: view.id, addLayer: { name: T("地面层 {n0}", { n0: String(view.layers.length + 1) }), kind: "ground" } }); await loadProject(view.id, true); } }, T("加地面层")),
      h(Btn, { onClick: async () => { await api.saveIsoDoc({ projectId: view.id, addLayer: { name: T("物件层 {n0}", { n0: String(view.layers.length + 1) }), kind: "object" } }); await loadProject(view.id, true); } }, T("加物件层")),
      h(Btn, { onClick: async () => { if (!window.confirm(T("清掉这一层？"))) return; await api.saveIsoDoc({ projectId: view.id, clearLayerId: activeLayer.id }); await loadProject(view.id, true); } }, T("清空当前层"))
    ),
    view.layers.map((layer, index) => h("div", { key: layer.id, className: "SPR_isoLayerRow", "data-on": index === layerIndex ? "true" : undefined },
      h("span", { className: "SPR_isoLayerIdx" }, String(index + 1)),
      layerDraft !== null && layerDraft.id === layer.id
        ? h("input", { className: "SPR_isoInput", autoFocus: true, value: layerDraft.value, onChange: (event) => setLayerDraft({ id: layer.id, value: event.target.value }), onBlur: () => void saveLayerName(layer.id, layerDraft.value), onKeyDown: (event) => { if (event.key === "Enter") void saveLayerName(layer.id, layerDraft.value); } })
        : h("button", { type: "button", className: "SPR_isoLayerName", onClick: () => { setLayerIndex(index); setLayerDraft({ id: layer.id, value: layer.name }); } }, `${layer.name}${layer.kind === "object" ? " · 物件" : ""}（${layer.filled}）`),
      h("button", { type: "button", className: "SPR_isoMini", disabled: index <= 0, onClick: async () => { await api.saveIsoDoc({ projectId: view.id, moveLayer: { id: layer.id, toIndex: index - 1 } }); await loadProject(view.id, true); } }, "↑"),
      h("button", { type: "button", className: "SPR_isoMini", disabled: index >= view.layers.length - 1, onClick: async () => { await api.saveIsoDoc({ projectId: view.id, moveLayer: { id: layer.id, toIndex: index + 1 } }); await loadProject(view.id, true); } }, "↓"),
      h("button", { type: "button", className: "SPR_isoMini", onClick: async () => { if (!window.confirm(T("删掉这一层和它上面的内容？"))) return; await api.saveIsoDoc({ projectId: view.id, removeLayerId: layer.id }); await loadProject(view.id, true); } }, "×")
    )),
    h("label", { className: "SPR_isoCheck" }, h("input", { type: "checkbox", checked: single === true, onChange: (event) => { setSingle(event.target.checked); clearPlan(); setPlanEpoch((value) => value + 1); } }), T("只看这一层")),
    h("div", { className: "SPR_isoSideTitle" }, T("标记")),
    view.markers.map((marker) => h("div", { key: marker.id, className: "SPR_isoMarkerRow" },
      h("span", { className: "SPR_isoMarkerDot" }, String(marker.n)),
      markerDraft !== null && markerDraft.id === marker.id
        ? h("input", { className: "SPR_isoInput", autoFocus: true, value: markerDraft.value, onChange: (event) => setMarkerDraft({ id: marker.id, value: event.target.value }), onBlur: () => void saveMarkerName(marker.id, markerDraft.value), onKeyDown: (event) => { if (event.key === "Enter") void saveMarkerName(marker.id, markerDraft.value); } })
        : h("button", { type: "button", className: "SPR_isoMarkerName", onClick: () => setMarkerDraft({ id: marker.id, value: marker.name }) }, marker.name === "" ? T("标记 {n0}", { n0: String(marker.n) }) : marker.name),
      h("span", { className: "SPR_isoAssetMeta" }, `(${marker.r},${marker.c})`),
      h("button", { type: "button", className: "SPR_isoMini", onClick: () => centerOnCell(marker.r, marker.c) }, T("定位")),
      h("button", { type: "button", className: "SPR_isoMini", onClick: async () => { await applyOps([{ kind: "marker", op: "remove", id: marker.id }], undefined, { reload: true }); } }, "×")
    ))
  );

  const exportCard = h("div", { className: "SPR_isoCard" },
    cardHead(T("导出")),
    h("label", { className: "SPR_isoCheck" }, h("input", { type: "checkbox", checked: exportFormats.png === true, onChange: (event) => setExportFormats((current) => ({ ...current, png: event.target.checked })) }), T("地图图片 PNG")),
    h("label", { className: "SPR_isoCheck" }, h("input", { type: "checkbox", checked: exportFormats.json === true, onChange: (event) => setExportFormats((current) => ({ ...current, json: event.target.checked })) }), T("存档数据 JSON")),
    h("label", { className: "SPR_isoCheck" }, h("input", { type: "checkbox", checked: exportFormats.tilesets === true, onChange: (event) => setExportFormats((current) => ({ ...current, tilesets: event.target.checked })) }), T("素材原图")),
    exportFormats.png === true ? h("div", { className: "SPR_isoRow" }, h(NumField, { label: T("倍率"), value: exportScale, min: 1, max: 4, onChange: setExportScale })) : null,
    h("div", { className: "SPR_isoRow" },
      h(Btn, { primary: true, busy: busyKey === "export" || view.busy === true, onClick: () => void runExport() }, T("导出")),
      h(Btn, { onClick: () => void runPreview() }, T("生成预览图")),
      h(Btn, { onClick: () => void api.revealIsoProject({ projectId: view.id, target: "export" }).catch((error) => setNotice({ kind: "error", text: msg(error) })) }, T("打开导出目录"))
    ),
    view.exportPath === "" ? null : h("p", { className: "SPR_isoHint" }, view.exportPath),
    view.exportFiles.map((file) => h("a", { key: file, className: "SPR_isoFile", href: `${view.assetBase}${view.exportBase}${file}`, download: file }, file)),
    view.preview.map((file) => h("a", { key: file, className: "SPR_isoFile", href: `${view.assetBase}${file}`, target: "_blank", rel: "noreferrer" }, `${T("预览图")}：${file}`))
  );

  const settingsCard = h("div", { className: "SPR_isoCard" },
    cardHead(T("设置")),
    h("label", { className: "SPR_isoCheck" }, h("input", { type: "checkbox", checked: view.wrap === true, onChange: async (event) => { await api.saveIsoProject({ projectId: view.id, wrap: event.target.checked }); await loadProject(view.id, true); } }), T("地图四周环绕")),
    h("div", { className: "SPR_isoRow" }, h(NumField, { label: T("列"), value: view.cols, min: 1, max: 512, onChange: async (value) => { await api.saveIsoDoc({ projectId: view.id, cols: value, rows: view.rows }); await loadProject(view.id, true); } }),
      h(NumField, { label: T("行"), value: view.rows, min: 1, max: 512, onChange: async (value) => { await api.saveIsoDoc({ projectId: view.id, cols: view.cols, rows: value }); await loadProject(view.id, true); } })),
    h("label", { className: "SPR_isoLabel" }, T("动画速度")),
    h("select", { className: "SPR_isoInput", value: animFps === null ? "" : String(animFps), onChange: (event) => setAnimFps(event.target.value === "" ? null : Number(event.target.value)) },
      h("option", { value: "" }, T("跟地图计划默认")),
      h("option", { value: "0.5" }, T("慢")),
      h("option", { value: "1" }, T("中")),
      h("option", { value: "2" }, T("快"))
    ),
    h("div", { className: "SPR_isoRow" },
      h(Btn, { on: showGrid === true, onClick: () => setShowGrid((value) => value !== true) }, T("网格线")),
      h(Btn, { on: showPass === true, onClick: () => { setShowPass((value) => value !== true); clearPlan(); setPlanEpoch((value) => value + 1); } }, T("区域"))
    ),
    h("div", { className: "SPR_isoRow" },
      h(Btn, { onClick: () => setOpenCard("layers") }, T("图层与标记")),
      h(Btn, { onClick: () => setGuidePage(0) }, T("素材说明")),
      h(Btn, { onClick: async () => { await api.setIsoApproved({ projectId: view.id, approved: true }); await loadProject(view.id, true); } }, T("整个模块看过了"))
    ),
    planWarnings.length === 0 ? null : h("p", { className: "SPR_isoWarn" }, planWarnings.join("；")),
    truncated === true ? h("p", { className: "SPR_isoWarn" }, T("现在缩得太小，画布只画了一部分（放大一点）。")) : null
  );

  const genCard = h("div", { className: "SPR_isoCard" },
    cardHead(T("一键生成")),
    h("label", { className: "SPR_isoLabel" }, T("怎么铺")),
    h("select", { className: "SPR_isoInput", value: genKind, onChange: (event) => setGenKind(event.target.value) },
      h("option", { value: "random" }, T("随机铺满")),
      h("option", { value: "maze" }, T("迷宫（需要两块素材）")),
      h("option", { value: "continent" }, T("大陆（需要四块素材）"))
    ),
    h("div", { className: "SPR_isoRow" }, h(NumField, { label: T("种子"), value: genSeed, min: 0, max: 999999999, onChange: setGenSeed })),
    h("p", { className: "SPR_isoHint" }, T("用当前选中的地面笔刷铺；多选（Shift / Ctrl）可按顺序当墙 / 通路 / 地貌。同种子结果完全一样。")),
    h("div", { className: "SPR_isoRow" },
      h(Btn, { primary: true, busy: busyKey === "gen", onClick: () => void runGenerate() }, T("生成")),
      h(Btn, { onClick: () => { setGenSeed(Math.floor(Math.random() * 999999999)); } }, T("换一组"))
    )
  );

  const guideCard = h("div", { className: "SPR_isoCard SPR_isoGuide" },
    cardHead(T("素材说明")),
    h("div", { className: "SPR_isoRow" },
      [0, 1, 2].map((index) => h("button", { key: index, type: "button", className: "SPR_isoMini", "data-on": guidePage === index ? "true" : undefined, onClick: () => setGuidePage(index) }, [T("地面"), T("自动连接"), T("物件")][index]))
    ),
    guidePage === 0
      ? h(React.Fragment, null, h("p", null, T("地面：整张图按格子切开。静态时每个格子都是一个笔刷；勾「会动」时每一列是一个笔刷，每一行是一帧。")), h("p", { className: "SPR_isoHint" }, T("菱形在每一格里居中；格子宽 = 菱形宽，格子高 = 菱形高 + 上方留给高处物件的空间。")))
      : guidePage === 1
        ? h(React.Fragment, null, h("p", null, T("自动连接：严格 4×4 = 16 块，行优先排列。")), h("p", { className: "SPR_isoHint" }, T("位序：N=1 / E=2 / S=4 / W=8。屏幕上 N 是右上、E 是右下、S 是左下、W 是左上。第 0 块四周都不连，第 15 块四周都连。"))
        )
        : h(React.Fragment, null, h("p", null, T("物件：一张完整图，不要切成格子。")), h("p", { className: "SPR_isoHint" }, T("图片底边中点是落地点；可以高出一格（树冠 / 屋顶）。占几格只影响占地与遮挡，不改图片本身。多帧时竖排，同一张图按帧播放。")))
  );

  const card = openCard === "assets" ? assetsCard
    : openCard === "layers" ? layersCard
    : openCard === "export" ? exportCard
    : openCard === "settings" ? settingsCard
    : openCard === "gen" ? genCard
    : openCard === "guide" ? guideCard
    : null;

  const topBar = h("div", { className: "SPR_isoTop" },
    h("div", { className: "SPR_isoProjWrap" },
      h("button", { type: "button", className: "SPR_isoProj", "data-open": menuOpen === true ? "true" : undefined, onClick: () => setMenuOpen((value) => value !== true) }, h("span", { className: "SPR_isoProjName" }, view.name), h("span", null, "▾")),
      menuOpen === true ? menu : null
    ),
    h(CopyIdButton, { id: view.id }),
    h("span", { style: { flex: 1 } }),
    h(Btn, { on: openCard === "assets", onClick: () => setOpenCard(openCard === "assets" ? null : "assets") }, T("素材")),
    h(Btn, { on: openCard === "export", onClick: () => setOpenCard(openCard === "export" ? null : "export") }, T("导出")),
    h(Btn, { on: openCard === "layers", onClick: () => setOpenCard(openCard === "layers" ? null : "layers") }, T("图层")),
    h(Btn, { onClick: () => setOpenCard(openCard === "settings" ? null : "settings") }, T("设置"))
  );

  const stage = h("div", { className: "SPR_isoStage", ref: stageRef },
    h("canvas", {
      ref: bindCanvas,
      className: "SPR_isoCanvas",
      onPointerDown: (event) => void onPointerDown(event),
      onPointerMove,
      onPointerUp,
      onPointerLeave: () => { setHover(null); },
      onContextMenu: (event) => event.preventDefault(),
      onDoubleClick: (event) => {
        const hit = cellFromEvent(event);
        if (hit !== null) centerOnCell(hit.r, hit.c);
      }
    })
  );

  const main = h("div", { className: "SPR_isoRoot" },
    topBar,
    h("div", { className: "SPR_isoBody" },
      side,
      stage
    ),
    notice === null ? null : h("div", { className: `SPR_notice SPR_notice-${notice.kind}` }, notice.text, h("button", { type: "button", className: "SPR_isoMini", style: { marginLeft: 8 }, onClick: () => setNotice(null) }, T("关闭"))),
    card === null ? null : h("div", { className: "SPR_isoCardWrap", onClick: () => setOpenCard(null) }, h("div", { onClick: (event) => event.stopPropagation() }, card)),
    guidePage === null ? null : h("div", { className: "SPR_isoDlgMask", onClick: () => setGuidePage(null) }, h("div", { className: "SPR_isoDlg", onClick: (event) => event.stopPropagation() }, guideCard))
  );
  return shell(main);
}

  return IsoModule;
}
