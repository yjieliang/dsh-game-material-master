/**
 * 浏览器半区 · 注入契约（platform/deps）。
 *
 * `shell/composition`、`shell/apply`、`features/<key>` 三处的依赖都是「组合根传进来
 * 的对象字面量 + 就地解构」。这些接口**只钉键名，不钉字段类型**：注入的绝大多数是
 * React 组件与 ui kit 成员，精确类型要顺着 `ui.ts` / `i18n.ts` 一路传导，收益有限。
 *
 * 钉键名能挡住一类已经存在的隐患：传参处把 `assetUrl` 写成 `assetURL`、或漏传某个
 * 组件，现在只会在运行时某个分支里炸成 `undefined is not a function`。
 *
 * 三方必须同时一致，`npm run typecheck` 会逐项校验：
 *   1. 本文件的接口
 *   2. `composition.ts` / `apply.ts` 里的解构列表
 *   3. `bootstrap.ts` 里的传参对象字面量
 */

/**
 * `createComposition` 的入参。
 *
 * 键的顺序与 `composition.ts` 的解构顺序保持一致，便于逐行对照。
 */
export interface CompositionDeps {
  h: any;
  React: any;
  store: any;
  activeLang: any;
  fill: any;
  T: any;
  useLocaleTick: any;
  deriveAssetName: any;
  ASSET_FRAMES_MIN: any;
  ASSET_FRAMES_MAX: any;
  stampLimits: any;
  clampStampSpan: any;
  ASSET_SHAPES: any;
  assetShapeLabel: any;
  buildAssetRequestPrompt: any;
  useHiddenModules: any;
  OPEN_SHAPES: any;
  useStudioIntent: any;
  msg: any;
  Btn: any;
  NumField: any;
  CopyIdButton: any;
  openAssetChat: any;
  mergeDrafts: any;
  askNewName: any;
  Chip: any;
  StatusChip: any;
  useGlobalConfig: any;
  GlobalModelField: any;
  ZoomableImage: any;
  usePendingTasks: any;
  LoadingOverlay: any;
  MediaBox: any;
  BusyBtn: any;
  BusyBadge: any;
  ReviewModeBar: any;
  ApproveBtn: any;
  readFileBase64: any;
  UploadBox: any;
  KeyingFields: any;
  JobSidebar: any;
  gmmScheduler: any;
  buildMusicRequestPrompt: any;
  buildComposeRequestPrompt: any;
  deriveMusicName: any;
  MUSIC_ENGINES: any;
  MUSIC_FORMATS: any;
  MUSIC_EDIT_LIMITS: any;
  openMusicChat: any;
  buildIsoAssetRequestPrompt: any;
  openIsoAssetChat: any;
  MODULES: any;
  normalizeHiddenKeys: any;
  publishHiddenModules: any;
  createFeatureBoundary: any;
  DIRECTION_KEYS: any;
  LABEL_OF: any;
  assetUrl: any;
  hostJob: any;
  LocalVideoPick: any;
  pickLocalVideo: any;
  SaveLink: any;
  fileLabel: any;
  jobCovers: any;
  DIRECTIONS: any;
  directionKeyFor: any;
  COMPASS_OF: any;
  KEY_AXIS: any;
  STAGES: any;
  visibleModulesOf: any;
  stageHint: any;
  stageDone: any;
  StudioGlyphIcon: any;
}

/**
 * shell 组装时从一个 feature 产出、再注入给另一个 feature 的成员。
 *
 * 证据：`composition.ts` 把地图的 `MapToolIcon` 透给 iso、把音乐的 `musicAssetUrl` /
 * `musicDownloadUrl` 透给 sfx、把序列帧的 `JobLogPanel` 透给 image / rig。
 * 只有 shell 允许跨 feature，所以这些键在各 feature 的解构里是合法存在的。
 */
export interface FeatureProducts {
  JobLogPanel: any;
  MapToolIcon: any;
  musicAssetUrl: any;
  musicDownloadUrl: any;
}

/**
 * 各 feature 工厂的入参。
 *
 * 组合根只把**该模块用到的子集**传下去，所以这里用 `Partial`：解构到未声明的键
 * 会报错（挡住拼错与多余解构），但漏传不会被发现——那需要每个 feature 一份独立的
 * 必填清单。当前收益是把「键名打错」从运行时 `undefined is not a function`
 * 提前到编译期。
 */
export type FeatureDeps = Partial<CompositionDeps> & Partial<FeatureProducts>;

/**
 * `createApply` 的入参。
 *
 * 与 `CompositionDeps` 不重叠：apply 只负责「和宿主接线」（面板 / 设置页 / 深链接），
 * 不碰任何界面组件。
 */
export interface ApplyDeps {
  attachI18n: any;
  attachSessionBridge: any;
  PACKAGE: any;
  CONTRIBUTION: any;
  SERVICE: any;
  T: any;
  activeLang: any;
  installIntentInterceptor: any;
  intentListeners: any;
  CSS: any;
  clearPendingIntent: any;
  reportClientOrigin: any;
  consumeUrlIntent: any;
  GAME_STUDIO_PANEL_ID: any;
  StudioGlyph: any;
  StudioPanel: any;
  ConfigSection: any;
}
