/**
 * 文件系统路径片段的校验（宿主半区）。
 *
 * 所有 `join(root, id)` 形状的目录函数都先过这里：`join` 会归一化 `..`，
 * 不校验的话 `deleteProject({ projectId: "../.." })` 会拼出数据根之外的路径，
 * 而删除走的是 `rm(recursive, force)`——一次错误入参就是不可恢复的越界删除。
 *
 * 合法 id 全部由本仓生成（`p` / `i` / `s` / `m` / `a` / `g` / `c` / `t` / `v` / `e`
 * 前缀 + base36 时间戳 + uuid 片段），因此这条规则不会误伤历史数据。
 */

/** 允许出现在路径片段里的字符：字母、数字、下划线、连字符。 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * 断言一个 id 可以安全地拼进路径。
 * @param value - 待校验的 id
 * @param what - 出参用的人话名称（例如「项目 id」），拼进报错消息
 * @returns 原值，便于在 `join` 里内联使用
 * @throws 当 id 为空、超长或含分隔符 / 点号 / 其它字符时
 */
export function assertSafeId(value: string, what: string): string {
  if (typeof value !== "string" || !SAFE_SEGMENT.test(value)) {
    throw new Error(`${what} 不合法：只允许 1–64 个字母、数字、下划线或连字符`);
  }
  return value;
}
