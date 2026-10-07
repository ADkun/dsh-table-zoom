/**
 * 真实浏览器几何 / 底色 / 既有能力回归（需要本机的 DSH 浏览器工具链）。
 *
 *   node scripts/geom-check.mjs      # 等价于 npm run smoke:geom
 *   node scripts/geom-check.mjs --dump    # 额外打印探针原始读数（排查用）
 *   node scripts/geom-check.mjs --keep    # 保留临时夹具目录（排查用）
 *
 * 它把 lib/client.js + scripts/geom-fixture.html + scripts/geom-probe.js 装进临时目录，
 * 用**无头**浏览器打开夹具页（夹具自己建一张 300 行 × 20 列的真表格），由探针驱动作真
 * 滚动并读数。判据全为可查询的物理量，不依赖截图：
 *
 *   ① 前提：夹具页真就绪（夹具**自己**建的表、DOM 行数与期望一致）、垂直/水平方向都
 *      **真的滚得动**（maxScrollTop / maxScrollLeft > 0，且请求的滚动位置没被夹住）
 *   ② 吸附不变性：冻结首行 / 交叉格在任一滚动位置都停在可视区内容边上（滚动量超过
 *      内边距后偏移恒为 0，容差 0.5px）；未滚过内边距时停在自然位置（= 内边距）
 *   ③ 普通数据格必须按滚动增量移动（位移 = −Δscroll），证明表确实在滚
 *   ④ 可见的表头格没有被数据格盖住（elementFromPoint 命中自己）、交叉格命中自己
 *   ⑤ 层次 z-index 交叉格 6 > 冻结首行 5 > 冻结首列 4，普通格 position:static
 *   ⑥ 每个数据行首格都左向吸附
 *   ⑦ Ctrl+滚轮 zoom ∈ {0.6,0.75,1,1.25,1.5,2} 下渲染宽度真的按比例变化，且 ② 仍成立
 *   ⑧ 浅色/深色下冻结格底色 alpha = 1、两档不同色、对比度 ≥ 4.5、分隔线仍在
 *   ⑨ 兜底：CSS 里有不依赖 color-mix() 的兜底变量（只在 @supports 内用 color-mix）；
 *      模拟不支持 color-mix 时底色仍不透明
 *   ⑩ 仿造的「聊天页全局表格规则」插在插件样式之后也压不倒冻结规则（靠特异性 + 顺序）
 *   ⑪ 既有能力：复制为 Markdown（真的把整表序列化进剪贴板）、右下角改尺寸、空格+拖拽
 *      平移、未按空格不劫持拖动、Esc/遮罩/关闭按钮三条关闭路径、打开期间锁聊天页滚动
 *   ⑫ 关闭两个冻结开关后：无冻结类、无标记行、无内联样式、底色/position 回原样，
 *      聊天里的原表格不受影响
 *   ⑬ 结构语义：无 <thead> / 空 <thead> / <thead> 内空行 / 有 <tfoot> 四种表的行为
 *
 * 工具链不在本机时打 SKIP 并退 0（不假装验证过）；判据不过退 1。
 */
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir, tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KEEP = process.argv.includes('--keep')
const DUMP = process.argv.includes('--dump')
const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const CLI = join(DSH_HOME, 'browser', 'cli.mjs')
const TAG = `dstz-geom-${process.pid}`

if (!existsSync(CLI)) {
  console.log(`SKIP 未找到浏览器工具链 ${CLI}（本机没有 DSH browser/cli.mjs）→ 本次没有做真实浏览器验证，未假装通过`)
  process.exit(0)
}

const DIR = join(tmpdir(), TAG)
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
const notes = []
function check(label, ok, detail = '') {
  if (ok) passes.push(label)
  else failures.push(`${label} — ${detail}`)
}
function cleanup(code) {
  if (!KEEP) {
    try { rmSync(DIR, { recursive: true, force: true }) } catch { /* 删不掉就留着，上面已打印过路径 */ }
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
const url = pathToFileURL(join(DIR, 'index.html')).href + `?tag=${TAG}`
const opened = cli(['open', url])
check('夹具页在新标签里打开', /TAB\s/.test(opened.out) || opened.status === 0,
  opened.out.trim().split('\n').slice(0, 3).join(' | '))

const ev = cli(['eval', '--file', join(DIR, 'probe.js'), '--match', TAG])
/** 从 CLI 输出里取出探针返回的 JSON（RESULT=… 行里含 GEOMJSON 标记）。 */
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
if (DUMP) {
  console.log('DUMP keys=' + JSON.stringify(Object.keys(probe ?? {})))
  for (const k of ['fatal', 'fixture', 'scroll', 'edge', 'zoomProof']) if (probe) console.log(`DUMP ${k}=` + JSON.stringify(probe[k]))
  if (probe) console.log('DUMP vertical[0]=' + JSON.stringify(probe.vertical?.[0], null, 1))
  if (probe) console.log('DUMP structs=' + JSON.stringify(probe.structs, null, 1))
}
if (!probe) {
  console.log(`FAIL 探针没有返回可解析的读数（exit=${ev.status}）：\n${ev.out.trim().split('\n').slice(-6).join('\n')}`)
  cleanup(1)
}
if (probe.fatal) {
  console.log(`FAIL 探针报致命错误：${JSON.stringify(probe.fatal)}`)
  cleanup(1)
}

// 探针里的异步读数（复制完成 / 按钮复位）在探针返回后才写入，单独取一次
const late = (() => {
  const r = cli(['eval', '--match', TAG, '--js',
    '(async()=>{await new Promise(s=>setTimeout(s,5200));'
    + 'return JSON.stringify({a:window.__dstzAsync||null,l:window.__dstzAsyncLate||null})})()'])
  const line = r.out.split(/\r?\n/).find((l) => l.startsWith('RESULT='))
  if (!line) return null
  let v = line.slice('RESULT='.length)
  if (v.startsWith('"')) { try { v = JSON.parse(v) } catch { /* 原样解析 */ } }
  try { return JSON.parse(v) } catch { return null }
})()

// ── 2) 前提：夹具真就绪、两个方向都真的滚得动 ──────────────────────────────
const fx = probe.fixture ?? {}
const sc = probe.scroll ?? {}
const edge = probe.edge ?? {}
check('夹具页真就绪：夹具自己建的表格，DOM 行数与期望一致',
  fx.ready === true && fx.struct === 'normal' && fx.hasThead === true
  && fx.expectedRows >= 300 && fx.domRows === fx.expectedRows && fx.rows === fx.expectedRows,
  JSON.stringify(fx))
check('垂直方向真的滚得动（缺这个前提，垂直吸附等于没测）',
  sc.maxScrollTop > 0 && sc.scrollHeight > sc.clientHeight,
  `maxScrollTop=${sc.maxScrollTop} scrollHeight=${sc.scrollHeight} clientHeight=${sc.clientHeight}`)
check('水平方向真的滚得动', sc.maxScrollLeft > 0 && sc.scrollWidth > sc.clientWidth,
  `maxScrollLeft=${sc.maxScrollLeft} scrollWidth=${sc.scrollWidth} clientWidth=${sc.clientWidth}`)
check('滚动容器 .dstz-body 自身 padding 为 0（sticky 偏移才能写 0）',
  edge.padTop === 0 && edge.padLeft === 0 && edge.borderTop === 0 && edge.borderLeft === 0,
  JSON.stringify({ padTop: edge.padTop, padLeft: edge.padLeft, borderTop: edge.borderTop, borderLeft: edge.borderLeft }))

const V = probe.vertical ?? []
const H = probe.horizontal ?? []
// 未滚动时观察到的偏移就是自然位置（= .dstz-inner 的内边距），由读数本身推出，不写死
check('取样起点是未滚动位置（req=0）', V[0]?.req === 0 && V[0]?.got === 0 && H[0]?.req === 0 && H[0]?.got === 0,
  `V0=${JSON.stringify(V[0] ? { req: V[0].req, got: V[0].got } : null)} H0=${JSON.stringify(H[0] ? { req: H[0].req, got: H[0].got } : null)}`)
const padTop = V.length ? Math.round((V[0].headTop - V[0].edgeTop) * 100) / 100 : NaN
const padLeft = H.length ? Math.round((H[0].cornerLeft - H[0].edgeLeft) * 100) / 100 : NaN
notes.push(`  夹具 ${fx.rows} 行 × ${fx.cols} 列；正文 ${edge.rect?.w}×${edge.rect?.h}（top=${edge.edgeTop} left=${edge.edgeLeft}）；`
  + `可滚 scrollTop ${sc.maxScrollTop} / scrollLeft ${sc.maxScrollLeft}；内边距 top=${padTop} left=${padLeft}`)

const near = (a, b, tol = 0.5) => typeof a === 'number' && Math.abs(a - b) <= tol
/** 期望偏移：滚动量还没吃掉内边距时停在自然位置，之后必须贴边（0）。 */
const expect = (scrolled, padding) => Math.round(Math.max(0, padding - scrolled) * 100) / 100

// ── 3) 垂直：吸附不变性 + 普通格按滚动增量移动 + 覆盖采样 ──────────────────
V.forEach((e, i) => {
  const tag = `垂直 sTop=${e.got}`
  const okClamp = e.max > 0 && e.got === Math.min(e.req, e.max)
  const expTop = expect(e.got, padTop)
  const okHead = near(e.headTop, e.edgeTop + expTop) && near(e.cornerTop, e.edgeTop + expTop)
  const stuck = near(e.headTop, e.edgeTop) && near(e.cornerTop, e.edgeTop)
  const okMove = i === 0 || near(e.plainTop - V[0].plainTop, -(e.got - V[0].got))
  const okCover = (e.coveredByData ?? []).length === 0 && (e.headerChecked ?? 0) >= 4 && e.cornerHit?.ok === true
  const okZ = Number(e.cornerZ) === 6 && Number(e.headZ) === 5 && Number(e.firstColZ) === 4 && e.plainPosition === 'static'
  notes.push(`  ${tag.padEnd(16)} 表头top=${String(e.headTop).padStart(6)} 交叉top=${String(e.cornerTop).padStart(6)} 期望top=${String(e.edgeTop + expTop).padStart(6)}`
    + ` | 普通格top=${String(e.plainTop).padStart(7)}（首个 ${V[0].plainTop}） | 表头贴边=${stuck ? '是' : '否'} | 采样 ${e.headerChecked} 格，被盖 ${(e.coveredByData ?? []).length}`)
  check(`[${tag}] 请求的滚动位置生效（没有被夹住）`, okClamp, `req=${e.req} got=${e.got} max=${e.max}`)
  check(`[${tag}] 冻结首行/交叉格停在自然位置或贴住内容边（不变性）`, okHead,
    `headTop=${e.headTop} cornerTop=${e.cornerTop} 期望=${e.edgeTop + expTop}（edgeTop=${e.edgeTop} 内边距=${padTop}）`)
  check(`[${tag}] 滚过内边距后表头行恒贴内容边（不动）`, e.got < padTop || stuck,
    `headTop=${e.headTop} edgeTop=${e.edgeTop}`)
  check(`[${tag}] 普通数据格按滚动增量移动（位移 = −Δscroll）`, okMove,
    `plainTop=${e.plainTop} 首个=${V[0].plainTop} Δscroll=${e.got - V[0].got}`)
  check(`[${tag}] 可见表头格没被数据格盖住、交叉格命中自己（采样 ≥4 格）`, okCover,
    `coveredByData=${JSON.stringify(e.coveredByData)} headerChecked=${e.headerChecked} cornerHit=${JSON.stringify(e.cornerHit)}`)
  check(`[${tag}] 层次 交叉格6 > 首行5 > 首列4，普通格 position:static`, okZ,
    `corner=${e.cornerZ} head=${e.headZ} firstCol=${e.firstColZ} normal=${e.plainPosition}`)
})
check('垂直至少覆盖到「滚过内边距」与「滚到底」两种位置', V.some((e) => e.got > padTop) && V.some((e) => e.got === e.max),
  `请求过的位置 ${JSON.stringify(V.map((e) => e.got))}`)

// ── 4) 水平：吸附不变性 + 普通格位移 ──────────────────────────────────────
H.forEach((e, i) => {
  const tag = `水平 sLeft=${e.got}`
  const expLeft = expect(e.got, padLeft)
  const okClamp = e.max > 0 && e.got === Math.min(e.req, e.max)
  const okCol = near(e.cornerLeft, e.edgeLeft + expLeft) && near(e.firstColLeft, e.edgeLeft + expLeft)
  const stuck = near(e.cornerLeft, e.edgeLeft) && near(e.firstColLeft, e.edgeLeft)
  const okMove = i === 0 || near(e.plainLeft - H[0].plainLeft, -(e.got - H[0].got))
  const okCover = (e.coveredByData ?? []).length === 0 && (e.headerChecked ?? 0) >= 4 && e.cornerHit?.ok === true
  notes.push(`  ${tag.padEnd(16)} 首列left=${String(e.firstColLeft).padStart(6)} 交叉left=${String(e.cornerLeft).padStart(6)} 期望left=${String(e.edgeLeft + expLeft).padStart(6)}`
    + ` | 普通格left=${String(e.plainLeft).padStart(7)}（首个 ${H[0].plainLeft}） | 首列贴边=${stuck ? '是' : '否'}`)
  check(`[${tag}] 请求的滚动位置生效（没有被夹住）`, okClamp, `req=${e.req} got=${e.got} max=${e.max}`)
  check(`[${tag}] 冻结首列/交叉格停在自然位置或贴住内容边（不变性）`, okCol,
    `firstColLeft=${e.firstColLeft} cornerLeft=${e.cornerLeft} 期望=${e.edgeLeft + expLeft}（edgeLeft=${e.edgeLeft} 内边距=${padLeft}）`)
  check(`[${tag}] 滚过内边距后首列恒贴内容边（不动）`, e.got < padLeft || stuck,
    `firstColLeft=${e.firstColLeft} edgeLeft=${e.edgeLeft}`)
  check(`[${tag}] 普通数据格按滚动增量移动（位移 = −Δscroll）`, okMove,
    `plainLeft=${e.plainLeft} 首个=${H[0].plainLeft} Δscroll=${e.got - H[0].got}`)
  check(`[${tag}] 可见表头格没被数据格盖住（采样 ≥4 格）`, okCover,
    `coveredByData=${JSON.stringify(e.coveredByData)} headerChecked=${e.headerChecked}`)
})
check('水平至少覆盖到「滚过内边距」与「滚到底」两种位置', H.some((e) => e.got > padLeft) && H.some((e) => e.got === e.max),
  `请求过的位置 ${JSON.stringify(H.map((e) => e.got))}`)

const fc = probe.firstColAllRows ?? {}
check('每个数据行首格都左向吸附（不允许「某一行首格不粘」）',
  fc.rows >= 300 && fc.stickyCount === fc.rows && fc.notStuck === 0 && (fc.leftDevs ?? [1]).every((d) => Math.abs(d) <= 0.5),
  JSON.stringify(fc))

// ── 5) 缩放各档 ───────────────────────────────────────────────────────────
const base = probe.zoomProof?.base
check('缩放前测到表格基准宽度（缩放证明的分母）', typeof base === 'number' && base > 100, String(base))
;(probe.zoom ?? []).forEach((z) => {
  const tag = `zoom=${z.zoom}`
  const scaleOk = typeof base === 'number' && Math.abs(z.cloneRectWidth / base - z.scaleVsBase) <= 0.02
    && Math.abs(z.scaleVsBase - z.zoom) <= 0.02
  const samples = z.samples ?? []
  const okClamp = samples.length > 0 && samples.every((s) => s.max > 0 && s.got === Math.min(s.req, s.max))
  const okHead = samples.every((s) => near(s.headTop, s.edgeTop + expect(s.got, padTop)) && near(s.cornerTop, s.edgeTop + expect(s.got, padTop)))
  const okCover = samples.every((s) => (s.coveredByData ?? []).length === 0 && (s.headerChecked ?? 0) >= 4 && s.cornerHit?.ok === true)
  const okSticky = (z.stickySample ?? []).length >= 3 && z.stickySample.every((s) => s.sticky === true)
  notes.push(`  ${tag.padEnd(16)} 渲染宽=${z.cloneRectWidth}（基准 ${base}，比 ${z.scaleVsBase}）| 可滚 top=${z.scroll?.maxScrollTop} left=${z.scroll?.maxScrollLeft}`
    + ` | 采样位置 ${JSON.stringify(samples.map((s) => s.got))} | 表头top ${JSON.stringify(samples.map((s) => s.headTop))}（edgeTop=${samples[0]?.edgeTop}）| 首列吸附 ${z.stickySample?.filter((s) => s.sticky).length}/${z.stickySample?.length}`)
  check(`[${tag}] 渲染宽度真的按比例缩放（物理证据，不只是内联样式）`, scaleOk,
    `rectWidth=${z.cloneRectWidth} base=${base} scaleVsBase=${z.scaleVsBase} zoom=${z.zoom}`)
  check(`[${tag}] 缩放后仍真的滚得动且位置没被夹住`, okClamp, JSON.stringify(z.scroll) + ' samples=' + JSON.stringify(samples.map((s) => ({ req: s.req, got: s.got, max: s.max }))))
  check(`[${tag}] 缩放后吸附不变性仍成立`, okHead, JSON.stringify(samples.map((s) => ({ got: s.got, headTop: s.headTop, cornerTop: s.cornerTop, edgeTop: s.edgeTop }))))
  check(`[${tag}] 缩放后表头格仍没被盖住、交叉格命中自己`, okCover, JSON.stringify(samples.map((s) => ({ got: s.got, covered: s.coveredByData, checked: s.headerChecked }))))
  check(`[${tag}] 缩放后每个数据行首格仍吸附`, okSticky, `sticky ${z.stickySample?.filter((s) => s.sticky).length}/${z.stickySample?.length}`)
  check(`[${tag}] 首列吸附后停在自然位置或贴住内容边`, near(z.firstColLeftAfterStick, z.edgeLeft) || near(z.firstColLeftAfterStick, z.edgeLeft + padLeft),
    `firstColLeftAfterStick=${z.firstColLeftAfterStick} edgeLeft=${z.edgeLeft} 内边距=${padLeft}`)
})

// ── 6) 底色（浅色 / 深色） ────────────────────────────────────────────────
for (const theme of ['light', 'dark']) {
  const c = probe.colors?.[theme]
  if (!c) { check(`[${theme}] 底色读数存在`, false, '缺少读数'); continue }
  check(`[${theme}] 冻结格底色 alpha 全为 1（不透明）`,
    c.header.alpha === 1 && c.firstCol.alpha === 1 && c.corner.alpha === 1 && c.panel.alpha === 1,
    `header=${c.header.bg} firstCol=${c.firstCol.bg} corner=${c.corner.bg} panel=${c.panel.bg}`)
  check(`[${theme}] 两档底色不同色，交叉格用首行那一档`,
    c.header.bg !== c.firstCol.bg && c.corner.bg === c.header.bg, `header=${c.header.bg} firstCol=${c.firstCol.bg} corner=${c.corner.bg}`)
  check(`[${theme}] 冻结格文字对比度 ≥ 4.5（WCAG AA）`,
    c.header.contrastVsEffectiveBg >= 4.5 && c.firstCol.contrastVsEffectiveBg >= 4.5,
    `header=${c.header.contrastVsEffectiveBg} firstCol=${c.firstCol.contrastVsEffectiveBg}`)
  check(`[${theme}] 冻结格保留了分隔线（collapse 表吸附后边框会消失，故用 box-shadow）`,
    /0px -8px 0px 0px/.test(c.headerShadow) && /0px 4px 0px -1px/.test(c.headerShadow), c.headerShadow)
  check(`[${theme}] 未冻结的普通格仍是透明底（冻结才上底色）`, c.normal.alpha === 0, `${c.normal.bg} alpha=${c.normal.alpha}`)
  notes.push(`  底色[${theme}]：普通格 ${c.normal.bg}（对比 ${c.normal.contrastVsEffectiveBg}）| 冻结首行 ${c.header.bg}（对比 ${c.header.contrastVsEffectiveBg}）`
    + `| 冻结首列 ${c.firstCol.bg}（对比 ${c.firstCol.contrastVsEffectiveBg}）| 交叉格 ${c.corner.bg} | 面板 ${c.panel.bg} | 变量 ${c.varRow} / ${c.varCol}`)
}

// ── 7) color-mix 兜底（必修项） ───────────────────────────────────────────
const fb = probe.fallback ?? {}
const fbs = probe.fallbackSim ?? {}
check('CSS 里有不依赖 color-mix() 的兜底变量，color-mix 只在 @supports 内出现',
  fb.cssHasSupports === true && !String(fb.row).includes('color-mix') && !String(fb.col).includes('color-mix')
  && String(fb.row).includes('--dsw-specific-input-major') && String(fb.col).includes('--dsw-specific-input-major'),
  JSON.stringify(fb))
check('模拟「浏览器不支持 color-mix」后底色仍是不透明主题底色（不会退化成透明）',
  fbs.headerAlpha === 1 && fbs.cornerBg === fbs.headerBg && fbs.firstColBg === fbs.headerBg
  && fbs.headerPosition === 'sticky' && fbs.firstColPosition === 'sticky',
  JSON.stringify(fbs))
check('兜底生效时吸附与覆盖仍正常', near(fbs.headTop, fbs.edgeTop) && (fbs.coveredByData ?? []).length === 0 && (fbs.headerChecked ?? 0) >= 4,
  `headTop=${fbs.headTop} edgeTop=${fbs.edgeTop} covered=${JSON.stringify(fbs.coveredByData)} checked=${fbs.headerChecked}`)

// ── 8) 仿造的聊天页全局 CSS 竞争 ─────────────────────────────────────────
const cc = probe.chatCssCompetition ?? {}
check('仿聊天页全局表格规则（插在插件样式之后）压不倒冻结规则',
  cc.injected === true && cc.headerPosition === 'sticky' && cc.firstColPosition === 'sticky'
  && cc.headerZ === '5' && cc.cornerZ === '6' && cc.headerAlpha === 1,
  JSON.stringify(cc))
check('CSS 竞争下吸附位置仍贴内容边、表头格仍未被盖住',
  near(cc.headTop, cc.edgeTop) && (cc.coveredByData ?? []).length === 0 && (cc.headerChecked ?? 0) >= 4,
  `headTop=${cc.headTop} edgeTop=${cc.edgeTop} covered=${JSON.stringify(cc.coveredByData)}`)

// ── 9) 既有能力（回归） ───────────────────────────────────────────────────
const feat = probe.features ?? {}
const cp = feat.copy ?? {}
check('复制为 Markdown：按钮立即禁用 + 异步把整表写进剪贴板（内容与 tableToMarkdown 一致）',
  cp.stubInstalled === true && cp.clicked === true && cp.expectedLength > 0 && cp.buttonDisabledImmediately === true,
  JSON.stringify(cp))
check('复制内容 = 表格序列化结果，且包含所有数据行',
  late?.a?.copiedEqualsSerialize === true && late?.a?.copiedHasAllRows === true && late?.a?.copiedLength === cp.expectedLength,
  JSON.stringify(late?.a ?? null))
check('复制反馈：先变「已复制」，1.6s 后复位成原文案并恢复可点',
  late?.a?.buttonLabel === '已复制' && late?.l?.buttonLabel === '复制为 Markdown' && late?.l?.buttonDisabled === false,
  JSON.stringify({ at120ms: late?.a?.buttonLabel, at4000ms: late?.l ?? null }))
const rz = feat.resize ?? {}
check('右下角手柄改尺寸：拖动中进入 dstz-resizing、位移等于拖拽距离、松手后收尾',
  rz.resizingDuringDrag === true && near(rz.dw, -120, 1) && near(rz.dh, -60, 1)
  && rz.resizingClassAfterUp === false && rz.suppressClickAfterUp === true && rz.afterW > 320,
  JSON.stringify(rz))
const pan = feat.pan ?? {}
check('空格 + 拖拽平移：光标态/平移态正确，位移等于拖拽距离，松键后全部复位',
  pan.armed === true && pan.grabbable === true && pan.panningDuringDrag === true
  && near(pan.dTop, 80, 1) && near(pan.dLeft, 150, 1)
  && pan.panningAfterUp === false && pan.armedAfterKeyUp === false && pan.grabbableAfterKeyUp === false,
  JSON.stringify(pan))
const ns = feat.noSpaceDrag ?? {}
check('没按空格时左键拖动不被劫持（保留原生文本选择）',
  ns.notPrevented === true && ns.panningClass === false && ns.scrollDelta === 0, JSON.stringify(ns))

// ── 10) 关闭冻结后复位 ────────────────────────────────────────────────────
const reset = probe.reset ?? {}
check('两个冻结按钮都在，关闭后 aria-pressed 都变 false',
  reset.buttons === 2 && (reset.ariaBefore ?? []).join() === 'true,true' && (reset.ariaAfter ?? []).every((v) => v === 'false'),
  `${JSON.stringify(reset.ariaBefore)} → ${JSON.stringify(reset.ariaAfter)}`)
check('关闭后：无冻结类、无吸附行标记、无吸附格、行数不变',
  reset.className === 'dstz-table' && reset.markedRows === 0 && reset.stickyCells === 0 && reset.rows === fx.expectedRows,
  `className=${reset.className} markedRows=${reset.markedRows} stickyCells=${reset.stickyCells} rows=${reset.rows}`)
check('关闭后：底色回透明、position 回 static、阴影消失',
  ['normal', 'header', 'firstCol', 'corner'].every((k) => reset.backgrounds?.[k] === 'rgba(0, 0, 0, 0)')
  && reset.positions?.header === 'static' && reset.positions?.firstCol === 'static' && reset.headerShadow === 'none',
  JSON.stringify(reset.backgrounds) + ' ' + JSON.stringify(reset.positions) + ' shadow=' + reset.headerShadow)
check('关闭冻结不留下内联样式（打开→开冻结→关冻结，表格 style 属性净变化为空）',
  reset.sameInlineStyleAsBefore === true && (reset.inlineStyleAfter === null || reset.inlineStyleAfter === '' || reset.inlineStyleAfter === 'zoom: 1;' || String(reset.inlineStyleAfter).trim() === ''),
  `inlineStyleAfter=${JSON.stringify(reset.inlineStyleAfter)} sameInlineStyleAsBefore=${reset.sameInlineStyleAsBefore}`)
check('缩放是独立状态：用户自己缩到 60% 后关冻结不会把它重置（复位边界，已写进文档）',
  reset.inlineStyleWithZoom === 'zoom: 0.6;' && reset.classNameWithZoom === 'dstz-table' && reset.markedRowsWithZoom === 0,
  `inlineStyleWithZoom=${JSON.stringify(reset.inlineStyleWithZoom)}`)
check('聊天里的原表格不受影响（类名 / 行数 / 无标记 / 单元格仍透明）',
  reset.original?.className === 'fx-src' && reset.original?.rows === fx.expectedRows
  && reset.original?.markedRows === 0 && reset.original?.cellBg === 'rgba(0, 0, 0, 0)',
  JSON.stringify(reset.original))

// ── 11) 打开期间的滚动锁定与三条关闭路径 ─────────────────────────────────
const cl = probe.close ?? {}
check('打开期间锁定聊天页滚动（body overflow=hidden），关闭后还原',
  cl.bodyOverflowWhileOpen === 'hidden' && cl.bodyOverflowBefore === '', JSON.stringify(cl))
check('Esc / 点遮罩 / 关闭按钮三条路径都能关掉浮窗且还原滚动',
  cl.afterEsc?.popups === 0 && cl.afterEsc?.bodyOverflow === '' && cl.reopened === true
  && cl.afterOverlayClick?.popups === 0 && cl.afterOverlayClick?.bodyOverflow === ''
  && cl.afterCloseButton?.popups === 0 && cl.afterCloseButton?.bodyOverflow === '',
  JSON.stringify(cl))

// ── 12) 结构语义（必修项） ────────────────────────────────────────────────
const st = probe.structs ?? {}
const sNohead = st.nohead ?? {}
check('无 <thead> 的表：标记表格首行、行按钮仍开启',
  sNohead.tHead === null && sNohead.markedRows === 1 && sNohead.markedIsFirstBodyRow === true
  && sNohead.rowBtnDisabled === false && sNohead.rowBtnAriaPressed === 'true',
  JSON.stringify(sNohead))
const sEmpty = st.emptyhead ?? {}
check('空 <thead>（<thead></thead>）：不标记任何行、行按钮禁用并给出原因，且不把数据行当表头',
  sEmpty.markedRows === 0 && sEmpty.markedIsFirstBodyRow === false && sEmpty.rowBtnDisabled === true
  && sEmpty.rowBtnAriaPressed === 'false' && sEmpty.rowBtnTitle === '此表无表头行，无需冻结',
  JSON.stringify(sEmpty))
check('空 <thead> 时列冻结照常可用（body 首格 sticky）',
  sEmpty.colBtnAriaPressed === 'true' && sEmpty.bodyFirstPosition === 'sticky' && sEmpty.headStickyCells === 0,
  JSON.stringify(sEmpty))
const sEmptyRow = st.emptyheadrow ?? {}
check('<thead> 里只有空行（<tr></tr>）：同样不标记、行按钮禁用（冻了也没有可吸附的格）',
  sEmptyRow.markedRows === 0 && sEmptyRow.rowBtnDisabled === true && sEmptyRow.bodyFirstPosition === 'sticky',
  JSON.stringify(sEmptyRow))
const sFoot = st.tfoot ?? {}
check('有 <tfoot> 的表：表头首格吸附、表尾首格**不**吸附（表尾不该冻）',
  sFoot.headFirstPosition === 'sticky' && sFoot.footFirstPosition === 'static' && sFoot.bodyFirstPosition === 'sticky'
  && sFoot.markedRows === 1 && sFoot.rowBtnDisabled === false,
  JSON.stringify(sFoot))
notes.push(`  结构语义：nohead 标记 ${sNohead.markedRows} 行（按钮 ${sNohead.rowBtnDisabled ? '禁用' : '可用'}）|`
  + ` emptyhead 标记 ${sEmpty.markedRows} 行（按钮 ${sEmpty.rowBtnDisabled ? '禁用' : '可用'}）|`
  + ` emptyheadrow 标记 ${sEmptyRow.markedRows} 行（按钮 ${sEmptyRow.rowBtnDisabled ? '禁用' : '可用'}）|`
  + ` tfoot 表头 ${sFoot.headFirstPosition} / 表尾 ${sFoot.footFirstPosition}`)

// ── 13) 打印读数 ──────────────────────────────────────────────────────────
console.log('[dsh-plugin-table-zoom] smoke:geom（真实浏览器，无头）')
notes.forEach((n) => console.log(n))

// 收尾：关掉自己开的标签页；浏览器若是本次脚本拉起的就一并关掉（复用的不动）
const closedTab = cli(['close-tab', '--match', TAG])
console.log(`  标签页：${/TABS=/.test(closedTab.out) ? closedTab.out.trim().split('\n')[0] : 'close-tab 未确认'}`)
if (startedByUs) {
  const closed = cli(['close'])
  console.log(`  浏览器：本次由脚本拉起 → ${/STATE=/.test(closed.out) ? closed.out.trim().split('\n')[0] : 'close 未确认'}`)
} else {
  console.log('  浏览器：本就活着（STATE=' + state + '）→ 只关本脚本开的标签页，不关浏览器（可能含着用户的登录态）')
}

console.log(`[dsh-plugin-table-zoom] smoke:geom: ${passes.length} passed, ${failures.length} failed`)
failures.forEach((f) => console.log(`  FAIL ${f}`))
cleanup(failures.length === 0 ? 0 : 1)