/* eslint-disable */
/**
 * 在夹具页里跑的探针（由 scripts/geom-check.mjs 通过 DSH 浏览器工具链 eval 执行）。
 * 返回值是一段 JSON 文本（前缀 GEOMJSON），判据在 geom-check.mjs 里做。
 *
 * 覆盖：
 *   ① 滚动到若干位置时 冻结首行 / 交叉格 / 首列 的吸附边与正文可视区内容边的偏差（都应为 0）
 *   ② 表头行任何一格都不会被数据格盖住（elementFromPoint 命中自己）—— 上一版几何缺陷的回归
 *   ③ 每个数据行首格都左向吸附（不允许出现「某一行首格不粘」）
 *   ④ zoom ∈ {0.6,0.75,1,1.25,1.5,2} 下 ① 仍为 0
 *   ⑤ 浅色/深色下 普通格 / 冻结首行 / 冻结首列 / 交叉格 的 backgroundColor（alpha 必须 1、三档互不相同）
 *      以及表头文字与底色的对比度
 *   ⑥ 两个按钮都关掉后：背景回原样、无残留标记、行数不变、聊天原表格不受影响
 */
(() => {
  const mod = window.__mod
  const COLS = 20
  const ROWS = 40
  const wrap = document.getElementById('wrap')
  let html = '<table id="src"><thead><tr>'
  for (let c = 1; c <= COLS; c += 1) html += '<th>H' + c + '</th>'
  html += '</tr></thead><tbody>'
  for (let r = 1; r <= ROWS; r += 1) {
    html += '<tr>'
    for (let c = 1; c <= COLS; c += 1) html += '<td>r' + r + 'c' + c + '</td>'
    html += '</tr>'
  }
  html += '</tbody></table>'
  wrap.innerHTML = html

  const table = document.getElementById('src')
  mod.openPopup(table)
  const panel = document.querySelector('.dstz-panel')
  const body = panel.querySelector('.dstz-body')
  const inner = panel.querySelector('.dstz-inner')
  const clone = panel.querySelector('.dstz-table')

  const cs = (el) => getComputedStyle(el)
  const round = (v) => Math.round(v * 100) / 100
  const topCells = () => Array.from(clone.querySelectorAll('tr.dstz-freeze-top-row > *'))
  const dataFirstCells = () => Array.from(clone.querySelectorAll('tbody > tr > *:first-child'))
  const dev = (el) => {
    const r = el.getBoundingClientRect()
    const b = body.getBoundingClientRect()
    return { top: round(r.top - b.top), left: round(r.left - b.left) }
  }
  const vp = (el) => { const r = el.getBoundingClientRect(); return { top: round(r.top), left: round(r.left), w: round(r.width), h: round(r.height) } }
  // 只测「真正可见」的表头格：取该格与正文可视区的交集中心；完全滚出可视区的格跳过
  // （滚出视口的点 elementFromPoint 返回 null，那是取样问题不是几何问题）
  const visPoint = (el) => {
    const r = el.getBoundingClientRect()
    const b = body.getBoundingClientRect()
    const l = Math.max(r.left, b.left + 1)
    const t = Math.max(r.top, b.top + 1)
    const rr = Math.min(r.right, b.right - 1)
    const bb = Math.min(r.bottom, b.bottom - 1)
    if (rr - l < 2 || bb - t < 2) return null
    return { x: Math.round((l + rr) / 2), y: Math.round(Math.min(t + 6, (t + bb) / 2)) }
  }
  /** 判据：可见表头格的采样点不得命中数据行（tbody）的格；可见的交叉格必须命中自己。 */
  const coverCheck = () => {
    const cells = topCells()
    const samples = []
    const coveredByData = []
    let corner = { visible: false, ok: false, hit: null }
    for (const c of cells) {
      const p = visPoint(c)
      if (!p) continue
      const hit = document.elementFromPoint(p.x, p.y)
      const hitIsData = !!(hit && hit.closest && hit.closest('tbody'))
      const hitSelf = !!hit && (hit === c || c.contains(hit))
      samples.push({ tag: c.tagName, text: String(c.textContent || '').slice(0, 4), x: p.x, y: p.y, hit: hit ? hit.tagName + ':' + String(hit.textContent || '').slice(0, 8) : null, hitIsData, hitSelf })
      if (hitIsData) coveredByData.push(`${String(c.textContent || '').slice(0, 4)}@${p.x},${p.y}←${hit.tagName}:${String(hit.textContent || '').slice(0, 8)}`)
      if (c === cells[0]) corner = { visible: true, ok: hitSelf, hit: hit ? hit.tagName + ':' + String(hit.textContent || '').slice(0, 8) : null }
    }
    return { checked: samples.length, coveredByData, corner, samples }
  }
  const parseRgb = (s) => {
    const str = String(s || '')
    const m = /rgba?\(([^)]+)\)/.exec(str)
    if (m) {
      const p = m[1].split(/[,/\s]+/).filter((v) => v !== '').map(Number)
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
    }
    // Chrome 会把 color-mix() 的结果序列化成 color(srgb r g b [/ a])（0–1 浮点，无 a 即不透明）
    const c = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(str)
    if (c) {
      const f = (v) => Math.round(Number(v) * 255 * 100) / 100
      return { r: f(c[1]), g: f(c[2]), b: f(c[3]), a: c[4] === undefined ? 1 : Number(c[4]) }
    }
    return null
  }
  const lum = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
  }
  const contrast = (fg, bg) => {
    const l1 = lum(fg)
    const l2 = lum(bg)
    const hi = Math.max(l1, l2)
    const lo = Math.min(l1, l2)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }

  const out = {
    fixture: { rows: ROWS, cols: COLS, ready: window.__FIXTURE_READY__ === true },
    padding: { inner: { top: parseFloat(cs(inner).paddingTop), left: parseFloat(cs(inner).paddingLeft) }, body: { top: parseFloat(cs(body).paddingTop), left: parseFloat(cs(body).paddingLeft) } },
    geom: [],
    sticky: null,
    zoom: [],
    colors: {},
    reset: null,
  }

  // ① / ② 滚动到若干位置（含横竖同时滚）
  const scrolls = [[0, 0], [120, 0], [300, 240], [700, 600], [1500, 900]]
  for (const [st, sl] of scrolls) {
    body.scrollTop = st
    body.scrollLeft = sl
    const cells = topCells()
    const firstData = clone.querySelector('tbody > tr > *:first-child')
    const cover = coverCheck()
    if (st === 0 && sl === 0) {
      out.hitDebug = cover.samples
      out.hitDebugEnv = { vw: window.innerWidth, vh: window.innerHeight, body: vp(body), panel: vp(panel), clone: vp(clone) }
    }
    out.geom.push({
      req: { scrollTop: st, scrollLeft: sl },
      got: { scrollTop: body.scrollTop, scrollLeft: body.scrollLeft },
      headDev: dev(cells[1]),
      cornerDev: dev(cells[0]),
      firstColDev: dev(firstData),
      headerCellsCovered: cover.coveredByData,
      headerChecked: cover.checked,
      cornerHit: cover.corner,
      zIndex: { topRow: cs(cells[1]).zIndex, corner: cs(cells[0]).zIndex, firstCol: cs(firstData).zIndex, normal: cs(clone.querySelector('tbody > tr:nth-child(5) > td:nth-child(5)')).zIndex },
      position: { topRow: cs(cells[1]).position, corner: cs(cells[0]).position, firstCol: cs(firstData).position, normal: cs(clone.querySelector('tbody > tr:nth-child(5) > td:nth-child(5)')).position },
      scroll: { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight },
    })
  }

  // ③ 水平方向：每个数据行首格都必须吸附
  body.scrollLeft = 600
  const dcs = dataFirstCells()
  const dbs = body.getBoundingClientRect()
  out.sticky = {
    dataRows: dcs.length,
    stickyCount: dcs.filter((c) => cs(c).position === 'sticky').length,
    leftDevs: Array.from(new Set(dcs.map((c) => round(c.getBoundingClientRect().left - dbs.left)))),
    notStuck: dcs.filter((c) => Math.abs(c.getBoundingClientRect().left - dbs.left) > 0.5).length,
  }

  // ⑤ 取四类单元格的引用（后面 zoom / 关闭复位还要用，故先取好）
  const topCellsNow = topCells()
  const midRow = clone.querySelectorAll('tbody > tr')[19]
  const midCells = Array.from(midRow.children)
  const picked = {
    normal: midCells[Math.floor(midCells.length / 2)],
    header: topCellsNow[Math.floor(topCellsNow.length / 2)],
    firstCol: midCells[0],
    corner: topCellsNow[0],
  }
  const readColors = (tag) => {
    const panelBg = parseRgb(cs(panel).backgroundColor)
    const shot = {}
    for (const key of ['normal', 'header', 'firstCol', 'corner']) {
      const el = picked[key]
      const bg = parseRgb(cs(el).backgroundColor)
      const fg = parseRgb(cs(el).color)
      const effective = bg && bg.a === 1 ? bg : panelBg
      shot[key] = {
        bg: cs(el).backgroundColor,
        bgRgba: bg,
        alpha: bg ? bg.a : null,
        color: cs(el).color,
        contrastVsEffectiveBg: fg && effective ? contrast(fg, effective) : null,
      }
    }
    shot.panel = { bg: cs(panel).backgroundColor, alpha: parseRgb(cs(panel).backgroundColor).a }
    shot.headerShadow = cs(picked.header).boxShadow
    out.colors[tag] = shot
  }
  readColors('light')
  // 深色：夹具里 html.dark 覆盖同一批主题变量（真实 GUI 未实测，如实标注）
  document.documentElement.classList.add('dark')
  readColors('dark')
  document.documentElement.classList.remove('dark')

  // ④ zoom 各档下 ① 仍应为 0
  for (const z of [0.6, 0.75, 1, 1.25, 1.5, 2]) {
    clone.style.zoom = String(z)
    body.scrollTop = 300
    body.scrollLeft = 240
    const cells = topCells()
    const firstData = clone.querySelector('tbody > tr > *:first-child')
    out.zoom.push({
      zoom: z,
      zoomApplied: clone.style.zoom,
      got: { scrollTop: body.scrollTop, scrollLeft: body.scrollLeft },
      headDev: dev(cells[1]),
      cornerDev: dev(cells[0]),
      firstColDev: dev(firstData),
      ...(() => { const cv = coverCheck(); return { headerCellsCovered: cv.coveredByData, headerChecked: cv.checked, cornerHit: cv.corner } })(),
      scroll: { scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight },
    })
  }
  clone.style.zoom = '1'

  // ⑥ 两个按钮都关掉（点真实按钮，走完整链路）
  const btns = Array.from(panel.querySelectorAll('.dstz-freezeBtn'))
  const beforeAria = btns.map((b) => b.getAttribute('aria-pressed'))
  btns.forEach((b) => b.click())
  body.scrollTop = 300
  body.scrollLeft = 240
  out.reset = {
    buttons: btns.length,
    ariaPressedBefore: beforeAria,
    ariaPressedAfter: btns.map((b) => b.getAttribute('aria-pressed')),
    className: clone.className,
    markedRows: clone.querySelectorAll('tr.dstz-freeze-top-row').length,
    inlineStyle: clone.getAttribute('style'),
    rows: clone.querySelectorAll('tr').length,
    backgrounds: {
      normal: cs(picked.normal).backgroundColor,
      header: cs(picked.header).backgroundColor,
      firstCol: cs(picked.firstCol).backgroundColor,
      corner: cs(picked.corner).backgroundColor,
    },
    positions: { header: cs(picked.header).position, firstCol: cs(picked.firstCol).position },
    headerShadow: cs(picked.header).boxShadow,
    // 聊天里的原表格：类名、行数、标记、背景都不该被改
    original: {
      className: table.className,
      rows: table.querySelectorAll('tr').length,
      markedRows: table.querySelectorAll('tr.dstz-freeze-top-row').length,
      cellBg: cs(table.querySelector('td')).backgroundColor,
      bodyOverflow: document.body.style.overflow,
    },
  }

  mod.closePopup()
  return 'GEOMJSON' + JSON.stringify(out)
})()