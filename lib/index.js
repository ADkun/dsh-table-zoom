/**
 * dsh-plugin-table-zoom — 聊天表格浮窗插件（服务端半边）
 *
 * 功能：聊天里 markdown 表格太长（行数多 / 横向超宽）导致一次看不完时，
 * 在表格上方自动出现一个小按钮「⛶ 浮窗查看」；点击后弹出可滚动的小浮窗，
 * 完整显示表格（独立于聊天滚动），并支持一键复制为 Markdown。
 *
 * 实现完全在客户端半边（lib/client.js）：
 *   MutationObserver 扫描 DOM 中的 markdown 表格（`.tableScroll` 容器内的
 *   `<table>`），对长表注入按钮；按钮点击后命令式创建浮窗（复用 image-tools
 *   的 lightbox 模式，纯 DOM 单节点变更，不触碰 React 管理的结构）。
 * 服务端半边因此为空实现：插件以「自带 bundle patch」方式挂载进 profile，
 * 客户端半边由 dsh.client 声明经 /plugins/<id>/client.js 送达浏览器。
 *
 * @module dsh-plugin-table-zoom
 */

export const name = 'dsh-plugin-table-zoom'

/** 服务端不依赖任何宿主服务（所有逻辑在客户端半边）。 */
export const inject = []

/** 插件入口：空实现。详见文件头注释。 */
export function apply() {
  // 无服务端注册项：浮窗协议是纯客户端交互（DOM 增强）。
}
