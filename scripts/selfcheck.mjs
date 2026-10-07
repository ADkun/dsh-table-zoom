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
  assert.ok(mod.CSS.includes('.dstz-table.dstz-freeze-row thead th'), '缺少冻结首行规则')
  assert.ok(mod.CSS.includes('.dstz-table.dstz-freeze-col tr>*:first-child'), '缺少冻结首列规则')
  assert.ok(mod.CSS.includes('position:sticky;top:0'), '缺少竖向吸附')
  assert.ok(mod.CSS.includes('position:sticky;left:0'), '缺少横向吸附')
  assert.ok(mod.CSS.includes('--dstz-frozen-bg:var(--dsw-specific-input-major'), '吸附背景应跟随主题变量')
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

// --- rc2 兼容：client.js 样式数组必须含宽表覆盖规则（防后续编辑误删） ---
ok('client.js 样式数组含 rc2 宽表覆盖规则', () => {
  assert.ok(
    code.includes('[class*="tableScroll"].md-table-wide{box-sizing:border-box'),
    'missing rc2 md-table-wide override rule in injected CSS',
  )
})

console.log(`[dsh-plugin-table-zoom] selfcheck: ${passed} passed`)
