/**
 * 浏览器半区 · 新对话桥（platform/session-bridge）。
 *
 * 「AI 生成素材 / 音乐 / 谱曲」不挂靠项目：本文件负责建会话、把拼好的提示词作为
 * 第一句话发进去，以及回链需要的上下文。
 */

export function createSessionBridge(deps: any) {
  // 依赖：组合根注入（先按需展开，由 tsc 报错驱动补齐）
  const {
    T,
  } = deps;

    // ── 新对话桥：把「AI 生成素材」的活派给一个不挂靠项目的新对话 ────────────
    //
    // 素材窗口那颗「AI 生成素材」不自己生成图：它开一个**新对话**，把拼好的需求作为
    // 第一句话发进去，剩下的交给对话里的 agent（它有 game_material 工具与按需手册）。
    //
    // `sessions` / `uiWorkspace` 是 DSH 核心的浏览器侧服务。它们是**可选依赖**：
    // 写进 `inject` 数组会让整个插件卡在这两个服务上（缺一个就整块不挂载），
    // 所以照 `attachI18n` 的写法懒接一次；没接上时点「生成」给一句可读的提示。
    let sessionsService: any = null;

    let uiWorkspaceService: any = null;

    function attachSessionBridge(ctx: any): void {
      const bind = (child: any) => {
        try {
          if (child === null || child === undefined || typeof child.get !== "function") return;
          const sessions = child.get("sessions");
          const workspace = child.get("uiWorkspace");
          if (sessions !== undefined && sessions !== null) sessionsService = sessions;
          if (workspace !== undefined && workspace !== null) uiWorkspaceService = workspace;
        } catch {
          // 取服务失败不影响插件其余功能。
        }
      };
      bind(ctx);
      if (sessionsService !== null && uiWorkspaceService !== null) return;
      try {
        ctx.inject(["sessions", "uiWorkspace"], bind);
      } catch {
        // 没有 ctx.inject 的宿主：点「生成」时会明确提示，界面其余部分照常。
      }
    }

    async function openStudioTaskChat(text: string, source: string): Promise<string> {
      const sessions = sessionsService;
      const workspace = uiWorkspaceService;
      if (sessions === null || workspace === null) {
        throw new Error(T("当前环境不支持自动开新对话，请在对话里直接说明你要的素材。"));
      }
      const sessionId = await sessions.create({});
      workspace.openSession(sessionId);
      const reference = sessions.retain(sessionId, { source });
      try {
        await reference.ready;
        const session = reference.binding.session;
        const submission = session.beginSubmission({ mode: "queue", text, attachments: [] });
        const result = await session.prompt([{ type: "text", text }], "queue", undefined, submission.requestId);
        if (result === null || result === undefined || result.ok !== true) {
          submission.abandon();
          const detail = result?.error;
          throw new Error(detail === undefined ? T("新对话打开了，但提示词没发出去。") : `${detail.code ?? "ERROR"}: ${detail.message ?? ""}`);
        }
      } finally {
        reference.release();
      }
      return sessionId;
    }

    /** 地图编辑器「AI 生成素材」的对话（保留原名字给自检）。 */
    async function openAssetChat(text: string): Promise<string> {
      return openStudioTaskChat(text, "gameStudioAssetRequest");
    }

    /** 45° 编辑器「AI 生成素材」的对话。 */
    async function openIsoAssetChat(text: string): Promise<string> {
      return openStudioTaskChat(text, "gameStudioIsoAssetRequest");
    }

    /** 音乐生成编辑的对话。 */
    async function openMusicChat(text: string): Promise<string> {
      return openStudioTaskChat(text, "gameStudioMusicRequest");
    }

  return {
    sessionsService, uiWorkspaceService, attachSessionBridge, openStudioTaskChat, openAssetChat, openIsoAssetChat, openMusicChat
  };
}
