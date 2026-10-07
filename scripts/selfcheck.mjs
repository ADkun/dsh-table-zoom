/**
 * dsh-plugin-table-zoom 自检：对 lib/client.js 导出的纯函数做离线冒烟测试。
 * 运行：node scripts/selfcheck.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strict as assert } from 'node:assert'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// 1) 模拟浏览器模块加载器并物化 factory（本插件不依赖 react，无需 shim require）
let spec = null
globalThis.window = {
  __ModuleLoader__: { load: (value) => { spec = value } },
}
const code = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
new Function(code)()
assert.ok(spec !== null, 'module loader not invoked')
assert.equal(spec.id, 'dsh-plugin-table-zoom')

const mod = spec.factory((name) => { throw new Error(`unexpected require: ${name}`) })
assert.equal(typeof mod.apply, 'function')
assert.deepEqual(mod.inject, [])
assert.equal(typeof mod.isMarkdownTable, 'function')
assert.equal(typeof mod.isLongTable, 'function')
assert.equal(typeof mod.tableToMarkdown, 'function')
assert.equal(typeof mod.openPopup, 'function')
assert.equal(typeof mod.closePopup, 'function')
assert.equal(typeof mod.copyText, 'function')

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`  ok  ${name}`)
}

console.log('[dsh-plugin-table-zoom] selfcheck')

// --- isMarkdownTable：识别 markdown 表格容器（类名哈希含 tableScroll） ---
ok('isMarkdownTable 命中 tableScroll 容器', () => {
  const table = { closest: (sel) => sel.includes('tableScroll') ? {} : null }
  assert.equal(mod.isMarkdownTable(table), true)
})
ok('isMarkdownTable 拒绝普通表格', () => {
  const table = { closest: () => null }
  assert.equal(mod.isMarkdownTable(table), false)
})
ok('isMarkdownTable 拒绝 null / 无 closest', () => {
  assert.equal(mod.isMarkdownTable(null), false)
  assert.equal(mod.isMarkdownTable({}), false)
})

// --- isLongTable：行数多或横向溢出 ---
ok('isLongTable 行数达标', () => {
  const table = { rows: new Array(mod.MIN_ROWS).fill({}) }
  assert.equal(mod.isLongTable(table, { scrollWidth: 100, clientWidth: 100 }), true)
})
ok('isLongTable 行数少但横向溢出', () => {
  const table = { rows: [{}, {}] }
  assert.equal(mod.isLongTable(table, { scrollWidth: 500, clientWidth: 300 }), true)
})
ok('isLongTable 都未达标', () => {
  const table = { rows: [{}, {}] }
  assert.equal(mod.isLongTable(table, { scrollWidth: 100, clientWidth: 100 }), false)
})
ok('isLongTable 缺 wrap 时只看行数', () => {
  const table = { rows: new Array(mod.MIN_ROWS).fill({}) }
  assert.equal(mod.isLongTable(table, null), true)
  assert.equal(mod.isLongTable({ rows: [{}] }, null), false)
})

// --- tableToMarkdown：单元格转义 / 内联换行 / 对齐 ---
ok('tableToMarkdown 基础表格', () => {
  const table = {
    rows: [
      { cells: [{ textContent: '名称' }, { textContent: '数值' }] },
      { cells: [{ textContent: '甲' }, { textContent: '12' }] },
      { cells: [{ textContent: '乙' }, { textContent: '34' }] },
    ],
  }
  assert.equal(
    mod.tableToMarkdown(table),
    '| 名称 | 数值 |\n| --- | --- |\n| 甲 | 12 |\n| 乙 | 34 |',
  )
})
ok('tableToMarkdown 转义管道符', () => {
  const table = {
    rows: [
      { cells: [{ textContent: 'A|B' }] },
      { cells: [{ textContent: 'C' }] },
    ],
  }
  const out = mod.tableToMarkdown(table)
  assert.ok(out.includes('A\\|B'), out)
})
ok('tableToMarkdown 折叠内联换行', () => {
  const table = {
    rows: [
      { cells: [{ textContent: '多\n行' }] },
    ],
  }
  assert.ok(mod.tableToMarkdown(table).includes('多 行'))
})
ok('tableToMarkdown 补齐短行', () => {
  const table = {
    rows: [
      { cells: [{ textContent: 'a' }, { textContent: 'b' }] },
      { cells: [{ textContent: 'c' }] },
    ],
  }
  const out = mod.tableToMarkdown(table)
  assert.ok(out.includes('| c |  |'), out)
})
ok('tableToMarkdown 空表', () => {
  assert.equal(mod.tableToMarkdown({ rows: [] }), '')
  assert.equal(mod.tableToMarkdown(null), '')
})

// --- 冻结首行/首列：样式规则必须齐备（防后续编辑误删 sticky / 层次 / 背景） ---
ok('client.js 样式表含冻结首行/首列规则', () => {
  assert.equal(typeof mod.CSS, 'string')
  assert.ok(mod.CSS.includes('.dstz-table.dstz-freeze-row tr.dstz-freeze-top-row>*'),
    '缺少冻结首行规则（应认 JS 打的 dstz-freeze-top-row 标记类，不再靠 tr:first-child 猜）')
  assert.ok(mod.CSS.includes('.dstz-table.dstz-freeze-col thead>tr>*:first-child,.dstz-table.dstz-freeze-col tbody>tr>*:first-child'),
    '缺少冻结首列规则（须分别写 thead/tbody 两条：写 `tr:first-child` 会把 <tfoot> 首格也冻住）')
  assert.ok(!/dstz-freeze-col tr>\*:first-child/.test(mod.CSS),
    '列冻结不得用不带 thead/tbody 限定的 tr 选择器（会冻住 tfoot 首格）')
  // 兜底：不支持 color-mix 的浏览器整条声明会被丢弃 → 必须先用不透明主题底色兜底，
  // 再用 @supports 覆盖成混合色（两条都在，顺序不能反）
  assert.ok(/@supports\s*\(color:\s*color-mix/.test(mod.CSS), '混合底色须包在 @supports 里')
  const supAt = mod.CSS.indexOf('@supports (color: color-mix')
  const fbRowAt = mod.CSS.indexOf('--dstz-frozen-row-bg:')
  const fbColAt = mod.CSS.indexOf('--dstz-frozen-col-bg:')
  const decl = (at) => mod.CSS.slice(at, mod.CSS.indexOf(';', at))
  assert.ok(fbRowAt >= 0 && fbColAt >= 0 && fbRowAt < supAt && fbColAt < supAt,
    '@supports 之前必须先有不依赖 color-mix 的兜底声明（否则不支持的浏览器里冻结格会变透明）')
  assert.ok(!decl(fbRowAt).includes('color-mix') && /--dsw-specific-input-major/.test(decl(fbRowAt)),
    '首行兜底取值必须是主题里不透明的底色：' + decl(fbRowAt))
  assert.ok(!decl(fbColAt).includes('color-mix') && /--dsw-specific-input-major/.test(decl(fbColAt)),
    '首列兜底取值同上：' + decl(fbColAt))
  assert.ok(mod.CSS.includes('position:sticky;top:0'), '竖向吸附应写 top:0（内边距已挪到 .dstz-inner，偏移与 padding/断点/zoom 解耦）')
  assert.ok(mod.CSS.includes('position:sticky;left:0'), '横向吸附应写 left:0')
  assert.ok(!/position:sticky;top:-/.test(mod.CSS) && !/position:sticky;left:-/.test(mod.CSS),
    'sticky 偏移不得再写死负值（zoom≠1 时会错位）')
  const bodyRule = /\.dstz-body\{([^}]*)\}/.exec(mod.CSS)
  assert.ok(bodyRule !== null && !bodyRule[1].includes('padding'),
    '滚动容器 .dstz-body 不得有内边距，否则吸附偏移会随 zoom 错位')
  assert.ok(mod.CSS.includes('.dstz-inner{padding:14px 18px 18px}'), '内边距应落在内层 .dstz-inner')
  assert.ok(mod.CSS.includes('.dstz-inner{padding:10px 12px 12px}'), '720px 断点只改 .dstz-inner 内边距')
  assert.ok(!/width<=720px\)[^']*top:-/.test(mod.CSS), '断点里不应再补 sticky 偏移')
  assert.ok(mod.CSS.includes('--dstz-frozen-row-bg:color-mix(in srgb,var(--dsw-alias-label-primary'),
    '首行底色应为主题变量混合（两个输入都不透明 ⇒ alpha 恒为 1）')
  assert.ok(mod.CSS.includes('--dstz-frozen-col-bg:color-mix(in srgb,var(--dsw-alias-label-primary'),
    '首列底色同上')
  assert.ok(mod.CSS.includes('--dsw-alias-label-primary,#0f1115) 18%')
    && mod.CSS.includes('--dsw-alias-label-primary,#0f1115) 9%'),
    '两档混合比例必须不同，否则冻结首行与首列同色')
  assert.ok(mod.CSS.includes('background:var(--dstz-frozen-row-bg)')
    && mod.CSS.includes('background:var(--dstz-frozen-col-bg)'), '吸附单元格背景须走这两档变量')
  assert.ok(/dstz-freeze-row\.dstz-freeze-col tr\.dstz-freeze-top-row>\*:first-child\{z-index:6;background:var\(--dstz-frozen-row-bg\)/.test(mod.CSS),
    '交叉格取首行那一档底色（不叠第三色），且层次最高')
})
ok('applyFreeze 只切换状态类（关闭后无残留）', () => {
  const cls = new Set()
  const table = {
    classList: {
      add: (c) => cls.add(c),
      remove: (c) => cls.delete(c),
    },
  }
  mod.applyFreeze(table, { row: true, col: true })
  assert.ok(cls.has(mod.FREEZE_ROW_CLASS) && cls.has(mod.FREEZE_COL_CLASS))
  mod.applyFreeze(table, { row: false, col: true })
  assert.ok(!cls.has(mod.FREEZE_ROW_CLASS) && cls.has(mod.FREEZE_COL_CLASS))
  mod.applyFreeze(table, { row: false, col: false })
  assert.equal(cls.size, 0, '两项都关闭后不应留下任何状态类')
})
ok('applyFreeze 标记「要吸附的那一行」（有 / 无 thead 两条路径，且关闭后无残留）', () => {
  const mkRow = () => {
    const s = new Set()
    return { s, classList: { add: (c) => s.add(c), remove: (c) => s.delete(c) } }
  }
  const noop = { add() {}, remove() {} }
  // 有 <thead>：只标记 thead 首行，不得碰首个数据行（否则会与表头重叠、压住表头首格）
  const h1 = mkRow(); const h2 = mkRow(); const d1 = mkRow()
  const withHead = { rows: [h1, h2, d1], tHead: { rows: [h1, h2] }, classList: noop }
  mod.applyFreeze(withHead, { row: true, col: false })
  assert.ok(h1.s.has(mod.FREEZE_TOP_ROW_CLASS), '有 thead 时应标记 thead 首行')
  assert.ok(!h2.s.has(mod.FREEZE_TOP_ROW_CLASS) && !d1.s.has(mod.FREEZE_TOP_ROW_CLASS), '其他行不得被标记')
  mod.applyFreeze(withHead, { row: false, col: false })
  assert.equal(h1.s.size, 0, '关闭后标记应被撤掉')
  // 无 <thead>：真实 DOM 里 table.tHead === null（不是 undefined），此时标记表格首行
  const r0 = mkRow(); const r1 = mkRow()
  const noHead = { rows: [r0, r1], tHead: null, classList: noop }
  mod.applyFreeze(noHead, { row: true, col: false })
  assert.ok(r0.s.has(mod.FREEZE_TOP_ROW_CLASS), '无 thead 时应标记表格首行')
  assert.ok(!r1.s.has(mod.FREEZE_TOP_ROW_CLASS))
  mod.applyFreeze(noHead, { row: false, col: false })
  assert.equal(r0.s.size, 0, '无 thead 的表关闭后也不得残留标记')
})
ok('findFreezeTopRow / isFreezeRowToggleable：空 <thead> 不把数据行当表头', () => {
  assert.equal(typeof mod.findFreezeTopRow, 'function', 'findFreezeTopRow 应导出（回归脚本要用）')
  assert.equal(typeof mod.isFreezeRowToggleable, 'function')
  const mkRow = () => ({ classList: { add() {}, remove() {} } })
  const h = mkRow(); const d1 = mkRow()
  assert.equal(mod.findFreezeTopRow({ rows: [h, d1], tHead: { rows: [h] } }), h, '有非空 thead 取 thead 首行')
  assert.equal(mod.findFreezeTopRow({ rows: [d1], tHead: { rows: [] } }), null, 'thead 无行 → 没有可冻结的表头行')
  assert.equal(mod.findFreezeTopRow({ rows: [d1], tHead: { rows: [{ cells: [] }] } }), null,
    '表头行一个单元格都没有（<thead><tr></tr></thead>）→ 冻了也没有可吸附的格，同样不可用')
  assert.equal(mod.findFreezeTopRow({ rows: [d1], tHead: { rows: [{ cells: [{}, {}] }] } }) !== null, true,
    '表头行有单元格 → 可用')
  assert.equal(mod.isFreezeRowToggleable({ rows: [d1], tHead: { rows: [] } }), false)
  assert.equal(mod.findFreezeTopRow({ rows: [d1], tHead: null }), d1, '无 thead 取表格首行')
  assert.equal(mod.isFreezeRowToggleable({ rows: [d1], tHead: null }), true)
  assert.equal(mod.findFreezeTopRow({ rows: [], tHead: null }), null, '空表没有可冻结的行')
  assert.equal(mod.findFreezeTopRow(null), null)
})
ok('applyFreeze：空 <thead> 的表不得标记任何行（否则数据行会被钉在顶部）', () => {
  const mkRow = () => {
    const s = new Set()
    return { s, classList: { add: (c) => s.add(c), remove: (c) => s.delete(c) } }
  }
  const d1 = mkRow(); const d2 = mkRow()
  const emptyHead = { rows: [d1, d2], tHead: { rows: [] }, classList: { add() {}, remove() {} } }
  mod.applyFreeze(emptyHead, { row: true, col: true })
  assert.equal(d1.s.size + d2.s.size, 0, '空 thead 时一行都不该被标记')
  mod.applyFreeze(emptyHead, { row: false, col: false })
  assert.equal(d1.s.size + d2.s.size, 0, '关闭后同样无残留')
})

// --- rc2 兼容：client.js 样式数组必须含宽表覆盖规则（防后续编辑误删） ---
ok('client.js 样式数组含 rc2 宽表覆盖规则', () => {
  assert.ok(
    code.includes('[class*="tableScroll"].md-table-wide{box-sizing:border-box'),
    'missing rc2 md-table-wide override rule in injected CSS',
  )
})

console.log(`[dsh-plugin-table-zoom] selfcheck: ${passed} passed`)
