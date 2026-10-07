/**
 * dsh-plugin-table-zoom 客户端冒烟测试：
 * 用 Node 模拟浏览器模块加载器执行 lib/client.js，再用一个最小假 DOM
 * 验证端到端行为：
 *   1. 模块加载、apply/inject 导出正常；
 *   2. upgradeTable 在长表容器后注入「浮窗查看」按钮行，短表不注入；
 *   3. openPopup 创建浮窗（标题含行列数、表格克隆、关闭按钮），
 *      closePopup 关闭并还原 body 滚动；
 *   4. 表格克隆在浮窗内不会被再次增强（跳过 .dstz-popup）；
 *   5. 右下角改尺寸手柄可拖拽改面板大小；溢出时左键拖动保留原生文本
 *      选择（不启动平移），按住空格拖动才平移；标题栏可拖拽移动浮窗
 *      （不越出视口）；Ctrl+滚轮缩放表格字体；
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
    spec: null,
    value: '',
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
    removeChild(child) {
      const idx = this.children.indexOf(child)
      if (idx >= 0) this.children.splice(idx, 1)
      if (child) child.parentNode = null
      return child
    },
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
      copy.spec = this.spec
      copy.cells = this.cells
      if (deep) {
        copy.children = this.children.map((c) => c.cloneNode(true))
        for (const c of copy.children) c.parentNode = copy
      }
      // 真实 DOM 里 rows/tHead 是活访问器，克隆后指向克隆体内的元素；
      // 假 DOM 需把 rows 重映射到「克隆树里对应的行元素」上（否则插行会插到原表里）
      copy.tHead = this.tHead
      if (Array.isArray(this.rows)) {
        const deepRows = []
        const collect = (node) => {
          for (const c of node.children) {
            if (c.tagName === 'TR') deepRows.push(c)
            collect(c)
          }
        }
        collect(copy)
        copy.rows = this.rows.map((r, i) => deepRows[i] ?? r)
      }
      return copy
    },
    // 支持多级后代选择器（'a b c'）：逐级向下匹配，供冻结相关断言使用
    querySelector(sel) {
      const parts = String(sel).trim().split(/\s+/)
      if (parts.length > 1) {
        const [head, ...rest] = parts
        for (const c of this.children) {
          if (c.matches && c.matches(head)) {
            const hit = c.querySelector(rest.join(' '))
            if (hit) return hit
          }
        }
        return null
      }
      for (const c of this.children) {
        if (c.matches && c.matches(sel)) return c
        const hit = c.querySelector ? c.querySelector(sel) : null
        if (hit) return hit
      }
      return null
    },
    querySelectorAll(sel) {
      const parts = String(sel).trim().split(/\s+/)
      const out = []
      const collect = (node, idx) => {
        const part = parts[idx]
        const last = idx === parts.length - 1
        for (const c of node.children) {
          if (c.matches && c.matches(part)) {
            if (last) out.push(c)
            else collect(c, idx + 1)
          }
          if (!last) collect(c, idx + 1)
        }
      }
      collect(this, 0)
      return out
    },
    matches(sel) {
      if (sel.startsWith('.')) return this.className.split(/\s+/).includes(sel.slice(1))
      const attr = /^\[([\w-]+)\]$/.exec(sel)
      if (attr) return this.attributes[attr[1]] !== undefined
      const attrEq = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel)
      if (attrEq) return String(this.attributes[attrEq[1]] ?? '') === attrEq[2]
      const tag = /^([a-zA-Z][\w-]*)(?:\[([\w-]+)="([^"]*)"\])?$/.exec(sel)
      if (tag) {
        if (this.tagName !== tag[1].toUpperCase()) return false
        if (tag[2] === undefined) return true
        return String(this.attributes[tag[2]] ?? '') === tag[3]
      }
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
globalThis.window = {
  setTimeout: (fn) => fn(),
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn) },
  removeEventListener(type, fn) {
    const arr = this._listeners[type]
    if (!arr) return
    const idx = arr.indexOf(fn)
    if (idx >= 0) arr.splice(idx, 1)
  },
  dispatch(type, event = {}) {
    const arr = this._listeners[type]
    if (!arr) return
    for (const fn of [...arr]) fn({ target: documentEl, stopPropagation() {}, ...event })
  },
}
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
  assert.ok(clone.classList.contains('dstz-table'), 'clone should carry dstz-table class: ' + clone.className)
  // 表格无 thead 时，默认开启的冻结首行会额外克隆一份首行用于吸附
  assert.equal(clone.children.length, 3, 'clone should carry both rows (+ frozen header clone)')
  // 关掉冻结首行后回到原结构，确认多出来的那一行只来自冻结
  const freezeRowBtn = freezeBtnOf(panel, 'row')
  assert.ok(freezeRowBtn !== undefined, 'freeze row button should be present')
  clickFreeze(panel, 'row')
  assert.equal(clone.children.length, 2, 'clone should carry both rows once freeze is off')
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

ok('溢出时左键拖动不启动平移（保留原生文本选择）', () => {
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
  assert.ok(!body.classList.contains('dstz-grabbable'), '未按空格时不应显示 grab 光标')
  // 未按空格：左键拖动不进入平移，也不吞掉遮罩点击（让给浏览器原生框选文字）
  body.dispatch('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
  body.dispatch('pointermove', { clientX: 110, clientY: 60 })
  assert.ok(!body.classList.contains('dstz-panning'), '未按空格拖动不应进入平移')
  assert.equal(body.scrollLeft, 300)
  assert.equal(body.scrollTop, 100)
  assert.ok(popup._suppressClick !== true, '未按空格拖动不应吞掉遮罩点击')
  body.dispatch('pointerup', {})
  mod.closePopup()
})

ok('按住空格拖动可平移溢出内容，光标随空格状态切换', () => {
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
  // 按住空格：内容溢出时出现 grab 光标
  globalThis.window.dispatch('keydown', { key: ' ', code: 'Space' })
  assert.ok(body.classList.contains('dstz-grabbable'), '按住空格且溢出时应显示 grab 光标')
  body.dispatch('pointerdown', { button: 0, clientX: 10, clientY: 10, pointerId: 1 })
  body.dispatch('pointermove', { clientX: 110, clientY: 60 })
  assert.ok(body.classList.contains('dstz-panning'), '按住空格拖动应进入平移')
  assert.equal(body.scrollLeft, 200)
  assert.equal(body.scrollTop, 50)
  assert.ok(popup._suppressClick === true, '平移应吞掉遮罩关闭')
  body.dispatch('pointerup', {})
  assert.ok(!body.classList.contains('dstz-panning'), '松手后退出平移')
  assert.ok(popup._suppressClick === false, '平移结束恢复遮罩点击')
  // 松开空格：grab 光标消失
  globalThis.window.dispatch('keyup', { key: ' ', code: 'Space' })
  assert.ok(!body.classList.contains('dstz-grabbable'), '松开空格后 grab 光标消失')
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

// 6) 冻结首行 / 冻结首列（默认开启、可独立切换、关闭后无残留）

/** 造一个「有 thead」的表，供冻结断言使用。 */
function makeHeadTable(rowCount = 10, colCount = 3) {
  const table = makeEl('table')
  const thead = makeEl('thead')
  const body = makeEl('tbody')
  const headRow = makeEl('tr')
  headRow.cells = []
  for (let c = 0; c < colCount; c++) {
    const th = makeEl('th')
    th._text = `表头${c + 1}`
    headRow.cells.push({ textContent: `表头${c + 1}` })
    headRow.appendChild(th)
  }
  const bodyRows = []
  for (let r = 1; r < rowCount; r++) {
    const tr = makeEl('tr')
    tr.cells = []
    for (let c = 0; c < colCount; c++) {
      const td = makeEl('td')
      td._text = `${r}-${c + 1}`
      tr.cells.push({ textContent: `${r}-${c + 1}` })
      tr.appendChild(td)
    }
    bodyRows.push(tr)
    body.appendChild(tr)
  }
  thead.appendChild(headRow)
  table.appendChild(thead)
  table.appendChild(body)
  table.tHead = thead
  table.rows = [headRow, ...bodyRows]
  return table
}

/** 取浮窗内的克隆表与头部按钮。 */
function openAndGet() {
  mod.closePopup()
  const table = makeHeadTable()
  mod.openPopup(table)
  const popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  const panel = popup.children[0]
  const clone = panel.querySelector('.dstz-body .dstz-table')
  return { table, popup, panel, clone }
}

/** 按 aria-pressed 找冻结按钮（切换后从 DOM 状态反查，验证真实点击链路）。 */
function freezeBtnOf(panel, key) {
  const btns = []
  const walk = (el) => {
    const arr = el.listeners?.click
    if (arr?.length && el.className.includes('dstz-freezeBtn')) btns.push(el)
    for (const c of el.children) walk(c)
  }
  walk(panel)
  return btns[key === 'row' ? 0 : 1]
}

/** 模拟用户点击（含 pointerdown，用于验证头部拖拽不会干扰按钮）。 */
function clickFreeze(panel, key) {
  const btn = freezeBtnOf(panel, key)
  const header = panel.children[0]
  const headerDown = header.listeners.pointerdown?.[0]
  if (headerDown) {
    // 事件从按钮冒泡到标题栏：真实 DOM 里 e.target 是按钮（命中可交互元素则不平移）
    headerDown({ button: 0, pointerId: 1, clientX: 10, clientY: 10, target: btn, preventDefault() {}, stopPropagation() {} })
  }
  btn.dispatch('click', {})
  return btn
}

ok('浮窗里冻结首行/首列默认都开启（状态类 + 按钮 aria-pressed）', () => {
  const { panel, clone } = openAndGet()
  assert.equal(clone.className, 'dstz-table ' + mod.FREEZE_ROW_CLASS + ' ' + mod.FREEZE_COL_CLASS)
  assert.ok(clone.classList.contains(mod.FREEZE_ROW_CLASS), '默认冻结首行')
  assert.ok(clone.classList.contains(mod.FREEZE_COL_CLASS), '默认冻结首列')
  const rowBtn = panel.querySelector('button[aria-pressed="true"]')
  assert.ok(rowBtn !== null, '默认应有处于开启态（aria-pressed=true）的冻结按钮')
  assert.ok(panel.querySelector('.dstz-freezeBtn'), '冻结按钮挂在浮窗头部')
  const actions = panel.children[0].querySelector('.dstz-headerActions')
  const names = actions.children.map((c) => c.className)
  assert.equal(names[1], 'dstz-freezeBtn', '冻结按钮在「复制为 Markdown」之后')
  assert.equal(names[3], 'dstz-iconButton', '关闭按钮仍在最后')
  mod.closePopup()
})

ok('冻结开关可各自独立切换，且按钮状态同步（aria-pressed）', () => {
  const { panel, clone } = openAndGet()
  const rowBtn = freezeBtnOf(panel, 'row')
  const colBtn = freezeBtnOf(panel, 'col')
  assert.equal(rowBtn.getAttribute('aria-pressed'), 'true')
  assert.equal(colBtn.getAttribute('aria-pressed'), 'true')
  clickFreeze(panel, 'row')
  assert.ok(!clone.classList.contains(mod.FREEZE_ROW_CLASS), '点一次：取消冻结首行')
  assert.equal(rowBtn.getAttribute('aria-pressed'), 'false', '按钮转为关闭态')
  assert.ok(clone.classList.contains(mod.FREEZE_COL_CLASS), '首列不受影响（各自独立）')
  assert.equal(colBtn.getAttribute('aria-pressed'), 'true')
  clickFreeze(panel, 'row')
  assert.ok(clone.classList.contains(mod.FREEZE_ROW_CLASS), '再点一次：恢复冻结首行')
  assert.equal(rowBtn.getAttribute('aria-pressed'), 'true')
  clickFreeze(panel, 'col')
  assert.ok(!clone.classList.contains(mod.FREEZE_COL_CLASS), '首列可独立关掉')
  assert.ok(clone.classList.contains(mod.FREEZE_ROW_CLASS), '首行保持开启')
  mod.closePopup()
})

ok('两项都关闭后无残留：无冻结类、无内联样式、无额外节点、表结构不变', () => {
  const { table, panel, clone } = openAndGet()
  const rowsBefore = clone.children.length
  clickFreeze(panel, 'row')
  clickFreeze(panel, 'col')
  assert.equal(clone.className, 'dstz-table', '关闭后只剩基础类，无 sticky 状态残留')
  assert.equal(clone.getAttribute('style'), null, '关闭后不留下任何内联样式')
  assert.equal(clone.children.length, rowsBefore, '关闭后不残留额外克隆行')
  assert.ok(clone.querySelector('.dstz-freeze-row-clone') === null)
  // 聊天里的原表格始终不受影响
  assert.equal(table.className, '', '原表格类名未被改动')
  assert.equal(table.rows.length, 10, '原表格行数不变')
  assert.equal(table.getAttribute('style'), null, '原表格无内联样式')
  mod.closePopup()
})

ok('冻结样式规则齐备：两向 sticky、层次 z-index、不透明主题背景、box-shadow 分隔线', () => {
  const css = mod.CSS
  // 两个方向都吸附
  assert.ok(/\.dstz-freeze-row[^{]*\{[^}]*position:sticky;top:-14px/.test(css), '首行 sticky top:-14px（抵消正文 padding-top）')
  assert.ok(/\.dstz-freeze-col[^{]*\{[^}]*position:sticky;left:-18px/.test(css), '首列 sticky left:-18px（抵消正文 padding-left）')
  // 交叉单元格层次最高
  assert.ok(/dstz-freeze-row\.dstz-freeze-col[^{]*:first-child\{z-index:6/.test(css), '交叉单元格 z-index:6')
  assert.ok(/dstz-freeze-row thead th[^{]*\{[^}]*z-index:5/.test(css), '冻结首行 z-index:5')
  assert.ok(/dstz-freeze-col tr>\*:first-child\{position:sticky;left:-18px;z-index:4/.test(css), '冻结首列 z-index:4')
  // 背景不透明且走主题变量（border-collapse:collapse 下 sticky 单元格边框会消失，用 box-shadow 画线）
  assert.ok(/dstz-freeze-row[^{]*\{[^}]*background:var\(--dstz-frozen-bg\)/.test(css), '吸附单元格背景不透明')
  assert.ok(!/dstz-freeze[^{]*\{[^}]*background:transparent/.test(css), '吸附单元格不得用透明背景')
  assert.ok(css.includes('--dstz-frozen-bg:var(--dsw-specific-input-major'), '背景跟随 DSH 主题变量')
  assert.ok(/dstz-freeze-row[^{]*\{[^}]*box-shadow:0 -8px 0 0 var\(--dstz-frozen-bg\)/.test(css), '上溢遮罩 + 下边框分隔线')
  assert.ok(/dstz-freeze-col[^{]*\{[^}]*box-shadow:2px 0 0 -1px/.test(css), '首列右侧分隔线')
  mod.closePopup()
})

ok('无 thead 的表格：开启时克隆首行吸附，关闭后克隆行移除', () => {
  mod.closePopup()
  const table = makeEl('table')
  const rows = []
  for (let r = 0; r < 3; r++) {
    const tr = makeEl('tr')
    tr.cells = []
    tr.appendChild(makeEl('td'))
    rows.push(tr)
    table.appendChild(tr)
  }
  table.rows = rows
  mod.openPopup(table)
  const popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  const panel = popup.children[0]
  const clone = panel.querySelector('.dstz-body .dstz-table')
  assert.ok(clone.classList.contains(mod.FREEZE_ROW_CLASS), '默认冻结首行')
  assert.equal(clone.querySelectorAll('.' + mod.FREEZE_ROW_CLONE_CLASS).length, 1,
    '无 thead 时首行被克隆一份用于吸附（且只克隆一次）')
  assert.equal(clone.children.length, 4, '克隆行插在首行之前')
  clickFreeze(panel, 'row')
  assert.equal(clone.children.length, 3, '关闭冻结后克隆行被移除（无残留）')
  assert.equal(clone.querySelectorAll('.' + mod.FREEZE_ROW_CLONE_CLASS).length, 0, '关闭后不再有克隆行')
  mod.closePopup()
})

ok('冻结按钮点击不会被标题栏拖拽劫持（按钮仍可达）', () => {
  mod.closePopup()
  const table = makeHeadTable()
  mod.openPopup(table)
  const popup = documentEl.body.children.find((c) => c.className === 'dstz-popup')
  const panel = popup.children[0]
  const header = panel.children[0]
  const btn = freezeBtnOf(panel, 'row')
  const startLeft = panel.style.left
  // 按钮上按下 → 标题栏拖拽逻辑应放行（isInteractive 命中 button），不改浮窗位置
  header.dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 10, clientY: 10, target: btn })
  header.dispatch('pointermove', { clientX: 120, clientY: 60 })
  assert.equal(panel.style.left, startLeft, '按在按钮上拖动不应移动浮窗')
  assert.ok(!header.classList.contains('dstz-dragging'), '不应进入拖拽态')
  assert.equal(popup._suppressClick, undefined, '不应吞掉遮罩点击')
  mod.closePopup()
})

console.log(`[dsh-plugin-table-zoom] smoke-client: ${passed} passed`)
