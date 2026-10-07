/**
 * 真实浏览器几何 + 底色回归（需要本机的 DSH 浏览器工具链）。
 *
 *   node scripts/geom-check.mjs      # 等价于 npm run smoke:geom
 *
 * 它把 lib/client.js 装进一个临时夹具页（scripts/geom-fixture.html + scripts/geom-probe.js，
 * 真 DOM 解析出的 40 行 × 20 列真表格），用无头浏览器打开并读数值，判据全为数值：
 *   ① 夹具页就绪、浮窗打开成功
 *   ② 滚动到 5 个位置：冻结首行 / 交叉格 / 首列的吸附边与正文可视区内容边的偏差 = 期望值
 *      （期望值 = max(0, 内边距 − 该轴已滚距离)；滚过内边距后必须为 0）
 *   ③ 表头行任何一格都不得被数据格盖住（elementFromPoint 命中自己）—— 几何缺陷的回归
 *   ④ 每个数据行首格都必须左向吸附（不允许出现「某一行首格不粘」）
 *   ⑤ zoom ∈ {0.6,0.75,1,1.25,1.5,2} 下 ② 的偏差仍等于期望值
 *   ⑥ 浅色/深色下 普通格 / 冻结首行 / 冻结首列 / 交叉格 的背景：alpha 全为 1、三档互不相同
 *   ⑦ 两个冻结按钮都关掉后：背景回原样、无残留标记、行数不变、聊天原表格不受影响
 *
 * 工具链不在本机时打 SKIP 并退 0（不假装验证过）；判据不过退 1。
 * 选项：--keep 保留夹具目录（默认跑完删掉）。
 */
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir, tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEEP = process.argv.includes('--keep')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CLI = join(DSH_HOME, 'browser', 'cli.mjs')

if (!existsSync(CLI)) {
  console.log(`SKIP 未找到浏览器工具链 ${CLI}（本机没有 DSH browser/cli.mjs）→ 本次没有做真实浏览器验证，未假装通过`)
  process.exit(0)
}

const DIR = join(tmpdir(), `dstz-geom-${process.pid}`)
mkdirSync(DIR, { recursive: true })
copyFileSync(join(ROOT, 'lib', 'client.js'), join(DIR, 'client.js'))
copyFileSync(join(ROOT, 'scripts', 'geom-fixture.html'), join(DIR, 'index.html'))
copyFileSync(join(ROOT, 'scripts', 'geom-probe.js'), join(DIR, 'probe.js'))

const LOG = join(DIR, 'cli.log')
/** 跑一次 cli.mjs：输出重定向到文件（不建管道，避免受限沙箱的 named-pipe 限制）。 */
function cli(args) {
  const fd = openSync(LOG, 'w')
  const r = spawnSync(process.execPath, [CLI, ...args], { stdio: ['ignore', fd, fd] })
  closeSync(fd)
  return { status: r.status, out: readFileSync(LOG, 'utf8') }
}

const failures = []
const passes = []
function check(label, ok, detail = '') {
  if (ok) passes.push(label)
  else failures.push(`${label} — ${detail}`)
}
function cleanup(code) {
  if (!KEEP) {
    try { rmSync(DIR, { recursive: true, force: true }) } catch { /* 删不掉就留着，下面会打印路径 */ }
  } else {
    console.log(`KEEP=${DIR}`)
  }
  process.exit(code)
}

// ── 1) 起浏览器 → 打开夹具页 → 跑探针 ──────────────────────────────────────
const launch = cli(['launch'])
const state = /STATE=(\w+)/.exec(launch.out)?.[1]
if (state !== 'STARTED' && state !== 'REUSED' && state !== 'SWITCHED') {
  console.log(`FAIL launch 没起来：\n${launch.out.trim()}`)
  cleanup(1)
}
const startedByUs = state === 'STARTED'
const url = pathToFileURL(join(DIR, 'index.html')).href
const opened = cli(['open', url])
check('夹具页在新标签里打开', /TAB\s/.test(opened.out) || opened.status === 0, opened.out.trim().split('\n').slice(0, 3).join(' | '))

const ev = cli(['eval', '--file', join(DIR, 'probe.js'), '--match', `dstz-geom-${process.pid}`])
function parseProbe(stdout) {
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('RESULT='))
  if (!line) return null
  let v = line.slice('RESULT='.length)
  if (v.startsWith('"')) {
    try { v = JSON.parse(v) } catch { /* 保持原样再找 GEOMJSON */ }
  }
  const i = v.indexOf('GEOMJSON')
  if (i < 0) return null
  try { return JSON.parse(v.slice(i + 'GEOMJSON'.length)) } catch { return null }
}
const probe = parseProbe(ev.out)
if (process.argv.includes('--dump')) {
  console.log('DUMP keys=' + JSON.stringify(Object.keys(probe ?? {})))
  console.log('DUMP geom[0]=' + JSON.stringify(probe?.geom?.[0], null, 1))
  console.log('DUMP zoom[0]=' + JSON.stringify(probe?.zoom?.[0], null, 1))
  console.log('DUMP hitDebug=' + JSON.stringify(probe?.hitDebug, null, 1))
  console.log('DUMP hitDebugEnv=' + JSON.stringify(probe?.hitDebugEnv))
}
if (!probe) {
  console.log(`FAIL 探针没有返回可解析的读数（exit=${ev.status}）：\n${ev.out.trim().split('\n').slice(-6).join('\n')}`)
  cleanup(1)
}

// ── 2) 判据 ───────────────────────────────────────────────────────────────
const pad = probe.padding.inner
check('夹具页就绪（真 DOM 解析出的真表格 + 浮窗打开成功）', probe.fixture.ready === true, JSON.stringify(probe.fixture))
check('滚动容器 .dstz-body 的 padding 为 0（sticky 偏移才能写 0）',
  probe.padding.body.top === 0 && probe.padding.body.left === 0, JSON.stringify(probe.padding.body))
check('内边距落在 .dstz-inner 上', pad.top > 0 && pad.left > 0, JSON.stringify(pad))

const expect = (scrolled, padding) => Math.round(Math.max(0, padding - scrolled) * 100) / 100
const rows = []
function geomRow(tag, entry) {
  const st = entry.got.scrollTop
  const sl = entry.got.scrollLeft
  const eTop = expect(st, pad.top)
  const eLeft = expect(sl, pad.left)
  const okTop = Math.abs(entry.headDev.top - eTop) <= 0.5 && Math.abs(entry.cornerDev.top - eTop) <= 0.5
  const okLeft = Math.abs(entry.firstColDev.left - eLeft) <= 0.5 && Math.abs(entry.cornerDev.left - eLeft) <= 0.5
  rows.push(`  ${tag.padEnd(9)} sTop=${String(st).padStart(4)} sLeft=${String(sl).padStart(4)} | 表头top=${String(entry.headDev.top).padStart(6)} 交叉top=${String(entry.cornerDev.top).padStart(6)} 期望top=${String(eTop).padStart(5)} | 首列left=${String(entry.firstColDev.left).padStart(6)} 交叉left=${String(entry.cornerDev.left).padStart(6)} 期望left=${String(eLeft).padStart(5)} | ${okTop && okLeft ? 'ok' : 'BAD'}`)
  check(`[${tag}] 吸附边贴合可视区内容边（sTop=${st}, sLeft=${sl}）`, okTop && okLeft,
    `表头top=${entry.headDev.top} 交叉top=${entry.cornerDev.top}(期望${eTop}) 首列left=${entry.firstColDev.left} 交叉left=${entry.cornerDev.left}(期望${eLeft})`)
  check(`[${tag}] 可见的表头格都没有被数据格盖住（elementFromPoint）`, (entry.headerCellsCovered ?? ['<读数缺失>']).length === 0,
    `被盖住的格：${(entry.headerCellsCovered ?? ['<读数缺失>']).join(',')}（取样了 ${entry.headerChecked} 个可见格）`)
  check(`[${tag}] 采样充分（可见表头格 ≥ 4 个，否则这条形同虚设）`, (entry.headerChecked ?? 0) >= 4, `headerChecked=${entry.headerChecked}`)
  check(`[${tag}] 交叉格在自己的可视区域内命中自己（z-index 6 生效）`, entry.cornerHit?.ok === true, JSON.stringify(entry.cornerHit))
}

probe.geom.forEach((entry, i) => geomRow(`geom#${i + 1}`, entry))
check('滚动位置生效（没有请求到就夹住）', probe.geom.every((e) => e.got.scrollTop >= 0 && e.got.scrollLeft >= 0), '')

const lastGeom = probe.geom[probe.geom.length - 1]
check('z-index 层次 交叉格 > 冻结首行 > 冻结首列（普通格不参与层叠：position static）',
  Number(lastGeom.zIndex.corner) > Number(lastGeom.zIndex.topRow)
  && Number(lastGeom.zIndex.topRow) > Number(lastGeom.zIndex.firstCol)
  && lastGeom.position.normal === 'static' && lastGeom.position.topRow === 'sticky' && lastGeom.position.firstCol === 'sticky',
  JSON.stringify(lastGeom.zIndex) + ' position=' + JSON.stringify(lastGeom.position))

check('每个数据行首格都左向吸附（水平方向无「不粘」的格）',
  probe.sticky.stickyCount === probe.sticky.dataRows && probe.sticky.notStuck === 0,
  JSON.stringify(probe.sticky))

probe.zoom.forEach((entry) => geomRow(`zoom=${entry.zoom}`, entry))
check('zoom 各档都应用上了', probe.zoom.every((e, i) => e.zoomApplied === String(e.zoom)), JSON.stringify(probe.zoom.map((e) => e.zoomApplied)))

// 底色：alpha 全为 1、三档互不相同
for (const theme of ['light', 'dark']) {
  const c = probe.colors[theme]
  const tiers = [c.normal, c.header, c.firstCol, c.corner]
  check(`[${theme}] 冻结格的背景 alpha 全为 1（不透明）`,
    c.header.alpha === 1 && c.firstCol.alpha === 1 && c.corner.alpha === 1,
    `header=${c.header.bg} firstCol=${c.firstCol.bg} corner=${c.corner.bg}`)
  check(`[${theme}] 三档底色互不相同（面板底 / 冻结首列 / 冻结首行）`,
    c.header.bg !== c.firstCol.bg
    && c.header.bg !== c.panel.bg
    && c.firstCol.bg !== c.panel.bg
    && c.corner.bg === c.header.bg,
    `panel=${c.panel.bg} header=${c.header.bg} firstCol=${c.firstCol.bg} corner=${c.corner.bg}`)
  check(`[${theme}] 表头文字与底色对比度 ≥ 4.5（WCAG AA）`,
    c.header.contrastVsEffectiveBg !== null && c.header.contrastVsEffectiveBg >= 4.5
    && c.firstCol.contrastVsEffectiveBg >= 4.5,
    `header=${c.header.contrastVsEffectiveBg} firstCol=${c.firstCol.contrastVsEffectiveBg}`)
  check(`[${theme}] 冻结格保留 box-shadow 分隔线（collapse 表吸附后边框会消失）`,
    /rgba?\(/.test(c.headerShadow) && c.headerShadow !== 'none', c.headerShadow)
}

// 关闭复位
const reset = probe.reset
check('两个按钮都在且关闭后 aria-pressed=false', reset.buttons === 2 && reset.ariaPressedAfter.every((v) => v === 'false'),
  JSON.stringify(reset.ariaPressedBefore) + ' → ' + JSON.stringify(reset.ariaPressedAfter))
check('关闭后：无冻结类、无吸附行标记、行数不变',
  reset.className === 'dstz-table' && reset.markedRows === 0 && reset.rows === probe.fixture.rows + 1,
  `className=${reset.className} markedRows=${reset.markedRows} rows=${reset.rows}`)
check('关闭后：背景回原样（透明）且 position 回 static',
  reset.backgrounds.header === 'rgba(0, 0, 0, 0)' && reset.backgrounds.firstCol === 'rgba(0, 0, 0, 0)'
  && reset.backgrounds.corner === 'rgba(0, 0, 0, 0)' && reset.positions.header === 'static' && reset.positions.firstCol === 'static',
  JSON.stringify(reset.backgrounds) + ' ' + JSON.stringify(reset.positions))
check('关闭后：分隔线与吸附阴影一并消失', reset.headerShadow === 'none', reset.headerShadow)
check('聊天里的原表格不受影响（类名 / 行数 / 标记 / 单元格背景）',
  reset.original.className === '' && reset.original.rows === probe.fixture.rows + 1
  && reset.original.markedRows === 0 && reset.original.cellBg === 'rgba(0, 0, 0, 0)'
  && reset.original.bodyOverflow === 'hidden',
  JSON.stringify(reset.original))

// ── 3) 打印读数 ───────────────────────────────────────────────────────────
console.log('[dsh-plugin-table-zoom] smoke:geom（真实浏览器，无头）')
console.log(`  夹具 ${probe.fixture.rows} 行 × ${probe.fixture.cols} 列；正文内边距 top=${pad.top} left=${pad.left}；body padding ${probe.padding.body.top}/${probe.padding.body.left}`)
console.log('  几何：吸附边 − 可视区内容边（0 为贴合；期望 = max(0, 内边距 − 已滚距离)）')
rows.forEach((r) => console.log(r))
for (const theme of ['light', 'dark']) {
  const c = probe.colors[theme]
  console.log(`  底色[${theme}]：普通格 ${c.normal.bg}（对比度 ${c.normal.contrastVsEffectiveBg}）| 冻结首行 ${c.header.bg}（对比度 ${c.header.contrastVsEffectiveBg}）| 冻结首列 ${c.firstCol.bg}（对比度 ${c.firstCol.contrastVsEffectiveBg}）| 交叉格 ${c.corner.bg} | 面板 ${c.panel.bg}`)
}
console.log(`  关闭后：className=${reset.className} 标记行=${reset.markedRows} 行数=${reset.rows} 背景=${reset.backgrounds.header} 阴影=${reset.headerShadow}`)
console.log(`  数据行首格吸附 ${probe.sticky.stickyCount}/${probe.sticky.dataRows}，不粘的 ${probe.sticky.notStuck}；z-index ${JSON.stringify(lastGeom.zIndex)}`)

if (startedByUs) {
  const closed = cli(['close'])
  console.log(`  浏览器：本次由脚本启动 → ${/STATE=/.test(closed.out) ? closed.out.trim().split('\n')[0] : 'close 未确认'}`)
} else {
  console.log('  浏览器：本就活着（STATE=REUSED）→ 不关，避免打断用户的登录态/标签页')
}

console.log(`[dsh-plugin-table-zoom] smoke:geom: ${passes.length} passed, ${failures.length} failed`)
failures.forEach((f) => console.log(`  FAIL ${f}`))
cleanup(failures.length === 0 ? 0 : 1)