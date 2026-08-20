/**
 * dsh-plugin-table-zoom 客户端冒烟测试：
 * 用 Node 模拟浏览器模块加载器执行 lib/client.js，再用一个最小假 DOM
 * 验证端到端行为：
 *   1. 模块加载、apply/inject 导出正常；
 *   2. upgradeTable 在长表容器后注入「浮窗查看」按钮行，短表不注入；
 *   3. openPopup 创建浮窗（标题含行列数、表格克隆、关闭按钮），
 *      closePopup 关闭并还原 body 滚动；
 *   4. 表格克隆在浮窗内不会被再次增强（跳过 .dstz-popup）；
 *   5. 右下角改尺寸手柄可拖拽改面板大小；内容溢出时正文可拖拽平移；
 *      标题栏可拖拽移动浮窗（不越出视口）；Ctrl+滚轮缩放表格字体；
 *      每次打开都按内容自适应宽度并居中（不继承上次的尺寸/位置/缩放）。
 *
 * 运行：node scripts/smoke-client.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strict as assert } from 'node:assert'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// 最小假 DOM（够 upgradeTable / openPopup / closePopup 使用）
// ---------------------------------------------------------------------------
function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parentNode: null,
    className: '',
    dataset: {},
    style: {},
    _text: '',
    attributes: {},
    listeners: {},
    _onKey: null,
    setAttribute(k, v) { this.attributes[k] = String(v) },
    getAttribute(k) { return this.attributes[k] ?? null },
    appendChild(child) {
      this.children.push(child)
      child.parentNode = this
      return child
    },
    insertBefore(child, ref) {
      const idx = this.children.indexOf(ref)
      if (idx < 0) this.children.push(child)
      else this.children.splice(idx, 0, child)
      child.parentNode = this
      return child
    },
    remove() {
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this)
        if (idx >= 0) this.parentNode.children.splice(idx, 1)
        this.parentNode = null
      }
    },
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) },
    removeEventListener(type, fn) {
      const arr = this.listeners[type]
      if (!arr) return
      const idx = arr.indexOf(fn)
      if (idx >= 0) arr.splice(idx, 1)
    },
    dispatch(type, event = {}) {
      const arr = this.listeners[type]
      if (!arr) return
      for (const fn of [...arr]) fn({ target: this, stopPropagation() {}, ...event })
    },
    focus() { this._focused = true },
    cloneNode(deep) {
      const copy = makeEl(this.tagName)
      copy.className = this.className
      copy._text = this._text
      copy.dataset = { ...this.dataset }
      if (deep) {
        copy.children = this.children.map((c) => c.cloneNode(true))
        for (const c of copy.children) c.parentNode = copy
      }
      return copy
    },
    querySelector(sel) {
      for (const c of this.children) {
        if (c.matches && c.matches(sel)) return c
        const hit = c.querySelector ? c.querySelector(sel) : null
        if (hit) return hit
      }
      return null
    },
    matches(sel) {
      if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1))
      return false
    },
  }
  Object.defineProperty(el, 'textContent', {
    get() {
      return this._text + this.children.map((c) => c.textContent).join('')
    },
    set(v) { this._text = String(v) },
  })
  Object.defineProperty(el, 'nextElementSibling', {
    get() {
      if (!this.parentNode) return null
      const siblings = this.parentNode.children
      const idx = siblings.indexOf(this)
      if (idx < 0) return null
      return siblings[idx + 1] ?? null
    },
  })
  Object.defineProperty(el, 'classList', {
    value: {
      contains: (c) => el.className.split(/\s+/).includes(c),
      add: (...cs) => { for (const c of cs) if (!el.classList.contains(c)) el.className += (el.className ? ' ' : '') + c },
      remove: (...cs) => {
        const keep = el.className.split(/\s+/).filter((c) => !cs.includes(c))
        el.className = keep.join(' ')
      },
    },
  })
  return el
}

const documentEl = {
  documentElement: { lang: 'zh-CN' },
  head: makeEl('head'),
  body: makeEl('body'),
  createElement: (tag) => makeEl(tag),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
}
globalThis.document = documentEl
globalThis.window = { setTimeout: (fn) => fn() }
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async (t) => { globalThis.__copied = t } } },
  configurable: true,
})
globalThis.requestAnimationFrame = (fn) => fn()

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('[dsh-plugin-table-zoom] smoke-client')

// 1) 模块加载与导出
let spec = null
globalThis.window.__ModuleLoader__ = { load: (value) => { spec = value } }
const code = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
new Function(code)()
assert.ok(spec !== null, 'module loader not invoked')
assert.equal(spec.id, 'dsh-plugin-table-zoom')
const mod = spec.factory((name) => { throw new Error(`unexpected require: ${name}`) })
assert.equal(typeof mod.apply, 'function')
assert.equal(typeof mod.upgradeTable, 'function')
assert.equal(typeof mod.upgradeTables, 'function')
assert.equal(typeof mod.openPopup, 'function')
assert.equal(typeof mod.closePopup, 'function')
assert.equal(typeof mod.startEnhancer, 'function')
assert.equal(typeof mod.tableToMarkdown, 'function')

// 2) 长表注入按钮行
ok('upgradeTable 为长表注入按钮行', () => {
  const parent = makeEl('div')
  const wrap = makeEl('div')
  wrap.className = 'x_tableScroll_y'
  wrap.scrollWidth = 100
  wrap.clientWidth = 100
  const table = makeEl('table')
  table.closest = (sel) => sel.includes('tableScroll') ? wrap : null
  table.rows = new Array(mod.MIN_ROWS).fill({ cells: [] })
  parent.appendChild(wrap)
  const row = mod.upgradeTable(table)
  assert.ok(row !== null)
  assert.ok(row.classList.contains('dstz-row'))
  assert.equal(row.children[0].className, 'dstz-btn')
  assert.equal(table.dataset.dstz, '1')
  // 幂等：再次调用不重复插入
  const again = mod.upgradeTable(table)
  assert.equal(again, null)
  assert.equal(parent.children.filter((c) => c.classList.contains('dstz-row')).length, 1)
})

ok('upgradeTable 跳过短表', () => {
  const parent = makeEl('div')
  const wrap = makeEl('div')
  wrap.className = 'x_tableScroll_y'
  wrap.scrollWidth = 100
  wrap.clientWidth = 100
  const table = makeEl('table')
  table.closest = (sel) => sel.includes('tableScroll') ? wrap : null
  table.rows = [{ cells: [] }, { cells: [] }]
  parent.appendChild(wrap)
  assert.equal(mod.upgradeTable(table), null)
})

ok('upgradeTable 跳过浮窗内克隆表', () => {
  const popup = makeEl('div')
  popup.className = 'dstz-popup'
  const wrap = makeEl('div')
  wrap.className = 'x_tableScroll_y'
  const table = makeEl('table')
  table.closest = (sel) => {
    if (sel.includes('tableScroll')) return wrap
    if (sel.startsWith('.dstz-popup')) return popup
    return null
  }
  table.rows = new Array(mod.MIN_ROWS).fill({ cells: [] })
  popup.appendChild(wrap)
  assert.equal(mod.upgradeTable(table), null)
})

// 3) 浮窗开合
ok('openPopup 创建浮窗并克隆表格', () => {
  const table = makeEl('table')
  const row1 = makeEl('tr'); row1.cells = [{ textContent: '列A' }, { textContent: '列B' }]
  const row2 = makeEl('tr'); row2.cells = [{ textContent: '1' }, { textContent: '2' }]
  table.rows = [row1, row2]
  table.appendChild(row1)
  table.appendChild(row2)
  mod.openPopup(table)
  const popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  assert.ok(popup !== undefined, 'popup not appended')
  const panel = popup.children[0]
  assert.equal(panel.className, 'dstz-panel')
  const titleText = panel.children[0].textContent
  assert.ok(titleText.includes('2'), 'title should include row count: ' + titleText)
  const clone = panel.children[1].children[0]
  assert.equal(clone.className, 'dstz-table')
  assert.equal(clone.children.length, 2, 'clone should carry both rows')
  assert.equal(documentEl.body.style.overflow, 'hidden', 'body scroll locked')
})

ok('closePopup 关闭浮窗并还原滚动', () => {
  mod.closePopup() // 清掉上一条用例遗留的浮窗
  documentEl.body.style.overflow = 'auto'
  const table = makeEl('table')
  table.rows = []
  mod.openPopup(table)
  assert.equal(documentEl.body.style.overflow, 'hidden')
  mod.closePopup()
  assert.equal(documentEl.body.children.filter((c) => c.className === 'dstz-popup').length, 0)
  assert.equal(documentEl.body.style.overflow, 'auto')
})

// 4) 复制为 Markdown（走 navigator.clipboard 假实现）
ok('copyText 写入剪贴板', async () => {
  await mod.copyText('| a |\n| --- |')
  assert.equal(globalThis.__copied, '| a |\n| --- |')
})

// 5) 浮窗改尺寸 + 自适应 + 拖拽平移（无布局记忆：每次打开都自适应并居中）

ok('openPopup 挂载右下角改尺寸手柄并可拖拽', () => {
  mod.closePopup()
  const table = makeEl('table')
  table.rows = []
  mod.openPopup(table)
  const popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  const panel = popup.children[0]
  const handle = panel.children.find((c) => c.className === 'dstz-resizeSE')
  assert.ok(handle !== undefined, 'resize handle not mounted')
  // 假 DOM 无真实布局：显式给一个起始尺寸，验证拖拽按 delta 改大小
  panel.style.width = '800px'
  panel.style.height = '400px'
  panel.getBoundingClientRect = () => ({
    width: parseInt(panel.style.width, 10) || 800,
    height: parseInt(panel.style.height, 10) || 400,
  })
  handle.dispatch('pointerdown', { button: 0, clientX: 100, clientY: 100, pointerId: 1 })
  handle.dispatch('pointermove', { clientX: 260, clientY: 160 })
  assert.equal(panel.style.width, '960px')
  assert.equal(panel.style.height, '460px')
  assert.equal(panel.style.maxHeight, 'none')
  assert.ok(popup._suppressClick === true, 'drag should suppress overlay close')
  handle.dispatch('pointerup', {})
  assert.ok(popup._suppressClick === false, 'suppress flag reset after drag')
  mod.closePopup()
})

ok('每次打开不继承上次尺寸，始终按内容自适应', () => {
  mod.closePopup()
  const table = makeEl('table')
  table.rows = []
  mod.openPopup(table)
  let popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  let panel = popup.children[0]
  assert.equal(panel.style.width, '320px', '首次打开走自适应（假 DOM 无布局 → 下限 320）')
  // 模拟当次手动改大
  panel.style.width = '800px'
  panel.style.height = '500px'
  mod.closePopup()
  // 重新打开：应回到自适应宽度，而不是继承 800px
  mod.openPopup(table)
  popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  panel = popup.children[0]
  assert.equal(panel.style.width, '320px', '再次打开仍自适应，不继承上次尺寸')
  assert.notEqual(panel.style.height, '500px')
  mod.closePopup()
})

ok('溢出时正文可拖拽平移', () => {
  mod.closePopup()
  const table = makeEl('table')
  table.rows = []
  mod.openPopup(table)
  const popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  const body = popup.children[0].children[1]
  body.scrollWidth = 1200
  body.clientWidth = 600
  body.scrollHeight = 400
  body.clientHeight = 300
  body.scrollLeft = 300
  body.scrollTop = 100
  mod.refreshGrabbable(body)
  assert.ok(body.classList.contains('dstz-grabbable'), 'overflow should show grab cursor')
  body.dispatch('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
  body.dispatch('pointermove', { clientX: 110, clientY: 60 })
  assert.ok(body.classList.contains('dstz-panning'), 'panning class while dragging')
  assert.equal(body.scrollLeft, 200)
  assert.equal(body.scrollTop, 50)
  assert.ok(popup._suppressClick === true, 'pan should suppress overlay close')
  body.dispatch('pointerup', {})
  assert.ok(!body.classList.contains('dstz-panning'), 'panning class cleared on release')
  assert.ok(popup._suppressClick === false, 'suppress flag reset after pan')
  mod.closePopup()
})

ok('标题栏可拖拽移动浮窗（不越出视口）', () => {
  mod.closePopup()
  const table = makeEl('table')
  table.rows = []
  mod.openPopup(table)
  const popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  const panel = popup.children[0]
  const header = panel.children[0]
  assert.equal(panel.style.width, '320px', '打开即自适应（假 DOM 无布局 → 下限 320）')
  // 假 DOM 无真实布局：显式给起始位置，验证拖拽按 delta 移动
  panel.style.left = '160px'
  panel.style.top = '40px'
  panel.getBoundingClientRect = () => ({
    width: parseInt(panel.style.width, 10) || 800,
    height: parseInt(panel.style.height, 10) || 400,
    left: parseInt(panel.style.left, 10) || 300,
    top: parseInt(panel.style.top, 10) || 200,
  })
  const startLeft = parseInt(panel.style.left, 10)
  const startTop = parseInt(panel.style.top, 10)
  header.dispatch('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
  header.dispatch('pointermove', { clientX: 50, clientY: 30 })
  assert.ok(header.classList.contains('dstz-dragging'), 'dragging class while moving')
  assert.equal(parseInt(panel.style.left, 10), startLeft + 40, 'left follows drag delta')
  assert.equal(parseInt(panel.style.top, 10), startTop + 20, 'top follows drag delta')
  assert.ok(popup._suppressClick === true, 'move should suppress overlay close')
  header.dispatch('pointerup', {})
  assert.ok(!header.classList.contains('dstz-dragging'), 'dragging class cleared on release')
  assert.ok(popup._suppressClick === false, 'suppress flag reset after move')
  mod.closePopup()
})

ok('Ctrl+滚轮缩放表格字体', () => {
  mod.closePopup()
  const table = makeEl('table')
  table.rows = [{ cells: [] }, { cells: [] }]
  mod.openPopup(table)
  const popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  const panel = popup.children[0]
  const clone = panel.children[1].children[0]
  const small = panel.children[0].children[0].children[0]
  assert.equal(clone.style.zoom, '1')
  assert.ok(!small.textContent.includes('%'), 'zoom 1 时不显示百分比')
  panel.dispatch('wheel', { ctrlKey: true, deltaY: -100 })
  assert.equal(clone.style.zoom, '1.1')
  assert.ok(small.textContent.includes('110%'), '标题显示缩放百分比')
  panel.dispatch('wheel', { ctrlKey: true, deltaY: 100 })
  assert.equal(clone.style.zoom, '1')
  assert.ok(!small.textContent.includes('%'), '回到 100% 后百分比消失')
  mod.closePopup()
})

ok('applyAdaptiveWidth 按表格自然宽度自适应（窄表收缩、宽表铺满视口）', () => {
  const panel = makeEl('div')
  const clone = makeEl('table')
  clone.offsetWidth = 500
  mod.applyAdaptiveWidth(panel, clone)
  assert.equal(panel.style.width, '538px')
  // 超级大表：铺满视口可用宽度（假 DOM 视口 1280 - 留白 48 = 1232）
  clone.offsetWidth = 3000
  mod.applyAdaptiveWidth(panel, clone)
  assert.equal(panel.style.width, '1232px')
  clone.offsetWidth = 0
  mod.applyAdaptiveWidth(panel, clone)
  assert.equal(panel.style.width, '320px')
})

console.log(`[dsh-plugin-table-zoom] smoke-client: ${passed} passed`)
