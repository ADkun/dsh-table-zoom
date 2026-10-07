/* eslint-disable */
/**
 * 在夹具页里跑的探针（由 scripts/geom-check.mjs 通过 DSH 浏览器工具链 eval 执行）。
 * 返回 'GEOMJSON' + 一段 JSON；**判据全在 geom-check.mjs 里**，本文件只负责取样，
 * 而且每个读数都带上能自证的量（请求值 / 实际值 / 最大可滚值 / 容器自身的 rect）。
 *
 * 取样口径（driver 侧断言的强性质见 geom-check.mjs 头部）：
 *   · 可滚性：每条样本都记 req / got / max —— 请求被夹住即判失败，不再「≥ 0 恒真」
 *   · 不变性：吸附元素在多个滚动位置下的 rect；普通数据格的 rect（用于位移相等）
 *   · 贴边用物理量：吸附边 rect 对比**滚动容器自身** rect + 它的 padding/border 读数
 *   · 兜底：从 mod.CSS 里抽出「无 color-mix」的兜底值，内联套回去模拟无 @supports 的浏览器
 *   · 既有能力：复制 Markdown（stub 剪贴板）/ 改尺寸 / 空格平移 / 未按空格不劫持 /
 *     聊天页同型全局规则的竞争 / Esc 与遮罩关闭 / 打开期间锁页面滚动
 *   · 结构语义：nohead / emptyhead / emptyheadrow / tfoot 四种表结构下的标记与吸附
 * 需要等微任务的读数（剪贴板、_suppressClick 复位）写进 window.__dstzAsync / __dstzAsyncLate，
 * 由 driver 再 eval 一次取回，避免依赖 eval 对 Promise 的支持。
 */
(() => {
  const mod = window.__mod
  const fx = window.__fixture
  const out = { fatal: null }
  const done = () => 'GEOMJSON' + JSON.stringify(out)
  if (!mod || typeof mod.openPopup !== 'function') { out.fatal = 'window.__mod 缺失（client.js 没加载成功？）'; return done() }
  if (window.__FIXTURE_READY__ !== true) { out.fatal = '夹具未就绪：__FIXTURE_READY__=' + String(window.__FIXTURE_READY__); return done() }

  const R = (v) => Math.round(v * 100) / 100
  const q = (sel) => document.querySelector(sel)
  const cs = (el) => getComputedStyle(el)
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { top: R(r.top), left: R(r.left), right: R(r.right), bottom: R(r.bottom), w: R(r.width), h: R(r.height) } }
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }
  const uniq = (a) => Array.from(new Set(a.map((v) => Math.max(0, Math.round(v))))).sort((x, y) => x - y)

  const table = window.__fixtureTable
  const bodyOverflowBefore = document.body.style.overflow
  mod.openPopup(table)
  let panel = q('.dstz-panel')
  let body = q('.dstz-body')
  let inner = q('.dstz-inner')
  let clone = q('.dstz-table')
  let overlay = q('.dstz-popup')
  if (!panel || !body || !inner || !clone || !overlay) { out.fatal = '浮窗结构缺失（panel/body/inner/clone/overlay）'; return done() }

  const topCells = () => Array.from(clone.querySelectorAll('tr.dstz-freeze-top-row > *'))
  const cornerCell = () => topCells()[0]
  const headCell = () => topCells()[1] || topCells()[0]
  const dataRow = (i) => clone.querySelectorAll('tbody > tr')[i]
  const plainCell = (i) => { const r = dataRow(i); return r ? (r.children[2] || r.children[1]) : null }
  const firstColCell = (i) => { const r = dataRow(i); return r ? r.children[0] : null }
  /** .dstz-inner（正文包裹层）：吸附的「自然位置」由它的内边距决定。 */
  const innerEl = () => body.querySelector('.dstz-inner')
  /** 滚动容器自身的物理边缘（吸附边必须贴在这里；padding/border 另有独立断言）。 */
  const edge = () => {
    const r = rectOf(body)
    return {
      rect: r,
      padTop: px(cs(body).paddingTop), padLeft: px(cs(body).paddingLeft),
      innerPadTop: innerEl() ? px(cs(innerEl()).paddingTop) : null,
      innerPadLeft: innerEl() ? px(cs(innerEl()).paddingLeft) : null,
      innerPadRight: innerEl() ? px(cs(innerEl()).paddingRight) : null,
      borderTop: px(cs(body).borderTopWidth), borderLeft: px(cs(body).borderLeftWidth),
      edgeTop: R(r.top + px(cs(body).borderTopWidth) + px(cs(body).paddingTop)),
      edgeLeft: R(r.left + px(cs(body).borderLeftWidth) + px(cs(body).paddingLeft)),
    }
  }
  const scrollState = () => ({
    scrollWidth: body.scrollWidth, clientWidth: body.clientWidth,
    scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
    maxScrollLeft: body.scrollWidth - body.clientWidth,
    maxScrollTop: body.scrollHeight - body.clientHeight,
    scrollbarX: body.offsetWidth - body.clientWidth,
    scrollbarY: body.offsetHeight - body.clientHeight,
  })
  const setScroll = (st, sl) => {
    if (st !== null) body.scrollTop = st
    if (sl !== null) body.scrollLeft = sl
    return { top: body.scrollTop, left: body.scrollLeft }
  }
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
    const coveredByData = []
    const samples = []
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
    const l1 = lum(fg); const l2 = lum(bg)
    const hi = Math.max(l1, l2); const lo = Math.min(l1, l2)
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
  }

  out.fixture = {
    struct: 'normal', ready: true,
    rows: table.rows.length, cols: table.rows[0].cells.length,
    domRows: document.querySelectorAll('#wrap table.fx-src tr').length,
    expectedRows: fx.DROWS + 1,
    hasThead: table.tHead !== null, theadRows: table.tHead ? table.tHead.rows.length : 0,
    hasTfoot: table.tFoot !== null,
  }
  out.scroll = scrollState()
  out.edge = edge()
  out.zoomProof = { base: R(rectOf(clone).w) }

  // ── ① 垂直：同一元素在多个 scrollTop 下的 rect（不变性 + 位移相等） ───────────
  out.vertical = []
  {
    const max = scrollState().maxScrollTop
    const reqs = uniq([0, 40, 120, 300, max / 2, max])
    for (const t of reqs) {
      setScroll(t, 0)
      const got = body.scrollTop
      const hc = headCell(); const cc = cornerCell(); const pc = plainCell(4)
      const cover = coverCheck()
      const e = edge()
      out.vertical.push({
        req: t, got, max,
        headTop: R(rectOf(hc).top), cornerTop: R(rectOf(cc).top), plainTop: R(rectOf(pc).top),
        edgeTop: e.edgeTop, bodyTop: e.rect.top,
        padTop: e.padTop, borderTop: e.borderTop,
        headPosition: cs(hc).position, cornerZ: cs(cc).zIndex, headZ: cs(hc).zIndex, firstColZ: cs(firstColCell(0)).zIndex,
        plainPosition: cs(plainCell(4)).position,
        coveredByData: cover.coveredByData, headerChecked: cover.checked, cornerHit: cover.corner,
      })
      if (t === max) out.coverDebug = cover.samples
    }
    // 每个数据行首格都必须左向吸附（不允许出现「某一行首格不粘」）
    setScroll(0, scrollState().maxScrollLeft)
    const dcs = Array.from(clone.querySelectorAll('tbody > tr > *:first-child'))
    const dbLeft = rectOf(body).left
    out.firstColAllRows = {
      rows: dcs.length,
      stickyCount: dcs.filter((c) => cs(c).position === 'sticky').length,
      notStuck: dcs.filter((c) => Math.abs(rectOf(c).left - dbLeft) > 0.5).length,
      leftDevs: Array.from(new Set(dcs.map((c) => R(rectOf(c).left - dbLeft)))),
    }
  }

  // ── ② 水平：同一元素在多个 scrollLeft 下的 rect ──────────────────────────────
  out.horizontal = []
  {
    const max = scrollState().maxScrollLeft
    const reqs = uniq([0, 40, 120, 300, max / 2, max])
    for (const l of reqs) {
      setScroll(0, l)
      const got = body.scrollLeft
      const cc = cornerCell(); const fc = firstColCell(4); const pc = plainCell(4)
      const cover = coverCheck()
      const e = edge()
      out.horizontal.push({
        req: l, got, max,
        cornerLeft: R(rectOf(cc).left), firstColLeft: R(rectOf(fc).left), plainLeft: R(rectOf(pc).left),
        edgeLeft: e.edgeLeft, bodyLeft: e.rect.left, padLeft: e.padLeft, borderLeft: e.borderLeft,
        coveredByData: cover.coveredByData, headerChecked: cover.checked, cornerHit: cover.corner,
      })
    }
  }

  // ── ③ zoom 各档：每一档都要「真的缩放」+ 垂直序列的不变性/位移相等 ─────────────
  out.zoom = []
  for (const z of [0.6, 0.75, 1, 1.25, 1.5, 2]) {
    clone.style.zoom = String(z)
    const max = scrollState().maxScrollTop
    const reqs = uniq([0, 40, 300, max])
    const samples = []
    for (const t of reqs) {
      setScroll(t, 0)
      const cover = coverCheck()
      const e = edge()
      samples.push({
        req: t, got: body.scrollTop, max,
        headTop: R(rectOf(headCell()).top), cornerTop: R(rectOf(cornerCell()).top),
        plainTop: R(rectOf(plainCell(4)).top), edgeTop: e.edgeTop,
        coveredByData: cover.coveredByData, headerChecked: cover.checked, cornerHit: cover.corner,
      })
    }
    const stickySample = [0, 100, table.rows.length - 2].map((i) => {
      const c = firstColCell(i)
      return c ? { i, position: cs(c).position, sticky: cs(c).position === 'sticky' } : { i, position: null, sticky: false }
    })
    out.zoom.push({
      zoom: z,
      cloneRectWidth: R(rectOf(clone).w), cloneOffsetWidth: clone.offsetWidth,
      scaleVsBase: R(rectOf(clone).w / out.zoomProof.base),
      scroll: scrollState(), samples, stickySample,
      firstColLeftAfterStick: R(rectOf(firstColCell(4)).left), edgeLeft: edge().edgeLeft,
    })
  }
  clone.style.zoom = '1'
  out.styleAfterZoomPhase = clone.getAttribute('style')

  // ── ④ 底色（浅 / 深）+ 兜底声明（模拟不支持 color-mix 的浏览器） ─────────────
  const picked = {
    normal: plainCell(19),
    header: headCell(),
    firstCol: firstColCell(19),
    corner: cornerCell(),
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
        bg: cs(el).backgroundColor, bgRgba: bg, alpha: bg ? bg.a : null, color: cs(el).color,
        contrastVsEffectiveBg: fg && effective ? contrast(fg, effective) : null,
      }
    }
    shot.panel = { bg: cs(panel).backgroundColor, alpha: parseRgb(cs(panel).backgroundColor).a }
    shot.headerShadow = cs(picked.header).boxShadow
    shot.varRow = cs(panel).getPropertyValue('--dstz-frozen-row-bg').trim()
    shot.varCol = cs(panel).getPropertyValue('--dstz-frozen-col-bg').trim()
    out.colors[tag] = shot
  }
  out.colors = {}
  setScroll(300, 0)
  readColors('light')
  // 深色：夹具里 html.dark 覆盖同一批主题变量（真实 GUI 未实测，如实标注）
  document.documentElement.classList.add('dark')
  readColors('dark')
  document.documentElement.classList.remove('dark')

  // 兜底声明：从发布出去的 CSS 文本里抽出**第一处**（@supports 之前）取值，内联套回去，
  // 模拟不支持 color-mix 的浏览器：冻结必须仍然不透明、仍然吸附。
  {
    const cssText = String(mod.CSS || '')
    const grab = (name) => {
      const m = new RegExp(name + ':([^;}]+)[;}]').exec(cssText)
      return m ? m[1].trim() : null
    }
    out.fallback = { cssHasSupports: /@supports\s*\(color:\s*color-mix/.test(cssText), row: grab('--dstz-frozen-row-bg'), col: grab('--dstz-frozen-col-bg') }
    if (out.fallback.row && out.fallback.col) {
      panel.style.setProperty('--dstz-frozen-row-bg', out.fallback.row)
      panel.style.setProperty('--dstz-frozen-col-bg', out.fallback.col)
      setScroll(300, 300)
      const cover = coverCheck()
      out.fallbackSim = {
        headerBg: cs(picked.header).backgroundColor, headerAlpha: (parseRgb(cs(picked.header).backgroundColor) || {}).a,
        firstColBg: cs(picked.firstCol).backgroundColor, cornerBg: cs(picked.corner).backgroundColor,
        headerPosition: cs(picked.header).position, firstColPosition: cs(picked.firstCol).position,
        headTop: R(rectOf(picked.header).top), edgeTop: edge().edgeTop,
        coveredByData: cover.coveredByData, headerChecked: cover.checked,
      }
      panel.style.removeProperty('--dstz-frozen-row-bg')
      panel.style.removeProperty('--dstz-frozen-col-bg')
    }
  }

  // ── ⑤ 既有能力：复制 Markdown / 改尺寸 / 空格平移 / 未按空格不劫持 ────────────
  setScroll(300, 300)
  out.features = {}
  {
    const copyBtn = q('.dstz-copy-btn') || q('.dstz-copyBtn')
    const expected = mod.tableToMarkdown(table)
    let copied = null
    const original = navigator.clipboard
    let stub = 'ok'
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, get: () => ({ writeText: (t) => { copied = String(t); return Promise.resolve() } }) })
    } catch (e) { stub = 'ERR ' + (e && e.message) }
    copyBtn.click()
    out.features.copy = {
      stubInstalled: stub === 'ok', expectedLength: expected.length, expectedHead: expected.slice(0, 60),
      buttonLabelImmediately: copyBtn.textContent, buttonDisabledImmediately: copyBtn.disabled === true,
      clicked: true, hadClipboardBefore: !!original,
    }
    window.setTimeout(() => {
      window.__dstzAsync = {
        copiedLength: copied === null ? -1 : copied.length,
        copiedHead: copied === null ? null : copied.slice(0, 60),
        copiedEqualsSerialize: copied === expected,
        copiedHasAllRows: copied !== null && copied.split('\n').filter((l) => l.indexOf('|') === 0).length >= window.__fixture.DROWS,
        buttonLabel: copyBtn.textContent, buttonDisabled: copyBtn.disabled === true,
        suppressClickAfterResize: !!q('.dstz-popup') && !!q('.dstz-popup')._suppressClick,
        bodyOverflowWhileOpen: document.body.style.overflow,
      }
    }, 120)
    window.setTimeout(() => {
      window.__dstzAsyncLate = { buttonLabel: copyBtn.textContent, buttonDisabled: copyBtn.disabled === true }
    }, 4000) // 4s：给「已复制 → 1.6s 后复位」留足时间（后台标签页的定时器会被钳到 ≥1s）

    // 改尺寸：面板已经很宽（自适应到视口上限），所以往**小**拖才有确定的位移
    const handle = q('.dstz-resizeSE')
    const before = rectOf(panel)
    const pev = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1, pointerId: 7, pointerType: 'mouse', isPrimary: true })
    const x0 = before.right - 8; const y0 = before.bottom - 8
    handle.dispatchEvent(pev('pointerdown', x0, y0))
    handle.dispatchEvent(pev('pointermove', x0 - 120, y0 - 60))
    const mid = { resizing: panel.classList.contains('dstz-resizing'), suppress: !!overlay._suppressClick }
    handle.dispatchEvent(pev('pointerup', x0 - 120, y0 - 60))
    const after = rectOf(panel)
    out.features.resize = {
      beforeW: before.w, beforeH: before.h, afterW: after.w, afterH: after.h,
      dw: R(after.w - before.w), dh: R(after.h - before.h),
      resizingDuringDrag: mid.resizing, suppressDuringDrag: mid.suppress,
      resizingClassAfterUp: panel.classList.contains('dstz-resizing'),
      suppressClickAfterUp: !!overlay._suppressClick,
    }

    // 空格 + 拖拽平移
    setScroll(300, 300)
    const panStart = { top: body.scrollTop, left: body.scrollLeft }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }))
    const armed = body._dstzSpaceArmed === true
    const grabbable = body.classList.contains('dstz-grabbable')
    body.dispatchEvent(pev('pointerdown', 700, 400))
    body.dispatchEvent(pev('pointermove', 550, 320))
    const panMid = { top: body.scrollTop, left: body.scrollLeft, panning: body.classList.contains('dstz-panning') }
    body.dispatchEvent(pev('pointerup', 550, 320))
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }))
    out.features.pan = {
      armed, grabbable, startTop: panStart.top, startLeft: panStart.left,
      midTop: panMid.top, midLeft: panMid.left, panningDuringDrag: panMid.panning,
      dTop: panMid.top - panStart.top, dLeft: panMid.left - panStart.left,
      panningAfterUp: body.classList.contains('dstz-panning'),
      armedAfterKeyUp: body._dstzSpaceArmed === true,
      grabbableAfterKeyUp: body.classList.contains('dstz-grabbable'),
    }

    // 未按空格时：pointerdown 不得被预防（否则会毁掉原生框选文字）
    setScroll(300, 300)
    const notPrevented = body.dispatchEvent(pev('pointerdown', 700, 400))
    out.features.noSpaceDrag = {
      notPrevented, panningClass: body.classList.contains('dstz-panning'),
      scrollDelta: body.scrollLeft - 300, armed: body._dstzSpaceArmed === true,
    }
  }

  // ── ⑥ 聊天页同型全局规则（插件样式表之后注入）能否盖掉冻结 ──────────────────
  {
    if (typeof fx.injectChatLikeCss === 'function') fx.injectChatLikeCss()
    setScroll(300, 300)
    const cover = coverCheck()
    out.chatCssCompetition = {
      injected: document.getElementById('fx-chat-css') !== null,
      headerPosition: cs(picked.header).position, headerZ: cs(picked.header).zIndex,
      headerBg: cs(picked.header).backgroundColor, headerAlpha: (parseRgb(cs(picked.header).backgroundColor) || {}).a,
      firstColPosition: cs(picked.firstCol).position, cornerZ: cs(picked.corner).zIndex,
      headTop: R(rectOf(picked.header).top), edgeTop: edge().edgeTop,
      coveredByData: cover.coveredByData, headerChecked: cover.checked,
    }
  }

  // ── ⑦ 关闭冻结：只增删冻结类，不写内联样式（缩放的 zoom 另算，见文档边界） ────
  {
    const styleBefore = clone.getAttribute('style')
    const btns = Array.from(panel.querySelectorAll('.dstz-freezeBtn'))
    const ariaBefore = btns.map((b) => b.getAttribute('aria-pressed'))
    btns.forEach((b) => b.click())
    setScroll(300, 300)
    const after = {
      buttons: btns.length,
      ariaBefore, ariaAfter: btns.map((b) => b.getAttribute('aria-pressed')),
      className: clone.className, markedRows: clone.querySelectorAll('tr.dstz-freeze-top-row').length,
      stickyCells: Array.from(clone.querySelectorAll('td,th')).filter((el) => cs(el).position === 'sticky').length,
      inlineStyleAfter: clone.getAttribute('style'),
      rows: clone.querySelectorAll('tr').length,
      backgrounds: { normal: cs(picked.normal).backgroundColor, header: cs(picked.header).backgroundColor, firstCol: cs(picked.firstCol).backgroundColor, corner: cs(picked.corner).backgroundColor },
      positions: { header: cs(picked.header).position, firstCol: cs(picked.firstCol).position },
      headerShadow: cs(picked.header).boxShadow,
      // 聊天里的原表格：类名、行数、标记、背景都不该被改
      original: {
        className: table.className, rows: table.rows.length,
        markedRows: table.querySelectorAll('tr.dstz-freeze-top-row').length,
        cellBg: cs(table.querySelector('td')).backgroundColor,
      },
    }
    after.sameInlineStyleAsBefore = after.inlineStyleAfter === styleBefore
    out.reset = after
    // 边界（必修 4 裁定：清 vs 文档写清）：Ctrl+滚轮缩放写下的内联 zoom 属于缩放功能，
    // 关闭冻结不去动它；把它记下来，让「关闭冻结不留内联样式」这句话的边界可核对。
    clone.style.zoom = '0.6'
    btns.forEach((b) => b.click())
    btns.forEach((b) => b.click())
    out.reset.inlineStyleWithZoom = clone.getAttribute('style')
    out.reset.classNameWithZoom = clone.className
    out.reset.markedRowsWithZoom = clone.querySelectorAll('tr.dstz-freeze-top-row').length
    clone.style.zoom = '1'
    // 重新打开冻结，供后面结构用例之前保持一致（随后会 closePopup）
    btns.forEach((b) => b.click())
  }

  // ── ⑧ 关闭路径：Esc / 遮罩点击 / 页面滚动锁定 ───────────────────────────────
  {
    out.close = { bodyOverflowWhileOpen: document.body.style.overflow, bodyOverflowBefore }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    out.close.afterEsc = { popups: document.querySelectorAll('.dstz-popup').length, bodyOverflow: document.body.style.overflow }
    // 再开一次，点遮罩关
    mod.openPopup(table)
    const ov = q('.dstz-popup')
    out.close.reopened = !!ov && document.querySelectorAll('.dstz-popup').length === 1
    if (ov) { ov.dispatchEvent(new MouseEvent('click', { bubbles: true })) }
    out.close.afterOverlayClick = { popups: document.querySelectorAll('.dstz-popup').length, bodyOverflow: document.body.style.overflow }
    // 再开一次，用标题栏上的关闭按钮关（顺带证明按钮没被拖拽劫持）
    mod.openPopup(table)
    const ov2 = q('.dstz-popup')
    const closeBtn = ov2 ? ov2.querySelector('.dstz-iconButton') : null
    if (closeBtn) {
      closeBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 0, clientY: 0, button: 0, buttons: 1, pointerId: 11, pointerType: 'mouse', isPrimary: true }))
      closeBtn.click()
    }
    out.close.afterCloseButton = { popups: document.querySelectorAll('.dstz-popup').length, bodyOverflow: document.body.style.overflow }
  }

  // ── ⑨ 结构语义：nohead / emptyhead / emptyheadrow / tfoot ───────────────────
  {
    const readStruct = (name) => {
      const t = fx.build(name === 'tfoot' ? 'tfoot' : name, 30, 6)
      mod.openPopup(t)
      const p = q('.dstz-panel'); const c = q('.dstz-table')
      const btns = p ? Array.from(p.querySelectorAll('.dstz-freezeBtn')) : []
      const rowBtn = btns[0]
      const firstHeadCell = c ? c.querySelector('thead > tr > *:first-child') : null
      const firstBodyCell = c ? c.querySelector('tbody > tr > *:first-child') : null
      const firstFootCell = c ? c.querySelector('tfoot > tr > *:first-child') : null
      const res = {
        tableRows: t.rows.length,
        tHead: t.tHead ? t.tHead.rows.length : null,
        tHeadFirstCells: t.tHead && t.tHead.rows[0] ? t.tHead.rows[0].cells.length : null,
        tFoot: t.tFoot ? t.tFoot.rows.length : null,
        markedRows: c ? c.querySelectorAll('tr.dstz-freeze-top-row').length : -1,
        markedIsFirstBodyRow: !!(c && c.querySelector('tbody > tr') && c.querySelector('tbody > tr').classList.contains('dstz-freeze-top-row')),
        rowBtnAriaPressed: rowBtn ? rowBtn.getAttribute('aria-pressed') : null,
        rowBtnDisabled: rowBtn ? rowBtn.disabled === true : null,
        rowBtnTitle: rowBtn ? rowBtn.title : null,
        colBtnAriaPressed: btns[1] ? btns[1].getAttribute('aria-pressed') : null,
        headFirstPosition: firstHeadCell ? cs(firstHeadCell).position : null,
        bodyFirstPosition: firstBodyCell ? cs(firstBodyCell).position : null,
        footFirstPosition: firstFootCell ? cs(firstFootCell).position : null,
        stickyCells: c ? Array.from(c.querySelectorAll('td,th')).filter((el) => cs(el).position === 'sticky').length : -1,
        headStickyCells: c ? Array.from(c.querySelectorAll('tr.dstz-freeze-top-row > *')).filter((el) => cs(el).position === 'sticky').length : -1,
      }
      mod.closePopup()
      return res
    }
    out.structs = {
      nohead: readStruct('nohead'),
      emptyhead: readStruct('emptyhead'),
      emptyheadrow: readStruct('emptyheadrow'),
      tfoot: readStruct('tfoot'),
    }
    // ⑭ 窄面板：头部不溢出、面板自身不滚动、子元素与面板左边缘对齐
    //    （复核方实测「面板 rect 与 header/body 错开 226px」的根因回归：头部溢出 →
    //     overflow:hidden 的面板成为可滚动容器 → closeBtn.focus() 触发「滚动到可见」）
    out.narrowFit = (() => {
      mod.closePopup()
      mod.openPopup(fx.build('normal', 30, 2))
      const p = q('.dstz-panel'); const h = q('.dstz-header'); const act = q('.dstz-headerActions')
      // 按钮逐个读数：窄态「只收文字、图标仍在」是判据（复核方第三轮：旧写法用
      // 后代 `span` 通配，把图标 ↕/↔ 与文字一起藏了 → 22×8 的空白方块）
      const btns = p ? Array.prototype.slice.call(p.querySelectorAll('.dstz-freezeBtn')) : []
      const btnInfo = btns.map((b) => {
        const icon = b.querySelector('.dstz-freezeBtn-icon'), text = b.querySelector('.dstz-freezeBtn-text')
        const br = rectOf(b), ir = icon ? rectOf(icon) : null
        return {
          label: b.getAttribute('aria-label'), title: b.getAttribute('title'), ariaPressed: b.getAttribute('aria-pressed'),
          btnW: R(br.w), btnH: R(br.h),
          iconChar: icon ? icon.textContent : null, iconDisplay: icon ? cs(icon).display : null,
          iconW: ir ? R(ir.w) : null, iconH: ir ? R(ir.h) : null, iconOffsetW: icon ? icon.offsetWidth : null,
          textDisplay: text ? cs(text).display : null, textOffsetW: text ? text.offsetWidth : null,
        }
      })
      const pr = rectOf(p), hr = rectOf(h)
      const res = {
        tableW: R(rectOf(q('.dstz-table')).w),
        panelLeft: R(pr.left), panelWidth: R(pr.w), headerLeft: R(hr.left), headerWidth: R(hr.w),
        panelScrollLeft: p ? p.scrollLeft : null, panelScrollTop: p ? p.scrollTop : null,
        panelScrollWidth: p ? p.scrollWidth : null, panelClientWidth: p ? p.clientWidth : null,
        headerScrollWidth: h ? h.scrollWidth : null, headerClientWidth: h ? h.clientWidth : null,
        actionsScrollWidth: act ? act.scrollWidth : null,
        narrowClass: p ? p.classList.contains('dstz-narrow') : null,
        labelDisplay: btnInfo.length ? btnInfo[0].textDisplay : null,
        btnInfo: btnInfo,
        activeElement: document.activeElement ? String(document.activeElement.className) : null,
      }
      mod.closePopup()
      return res
    })()

    // ⑮ 宽度预算：面板宽 = 表宽 + 38 + 正文纵向滚动条；内层容得下整表、左右内边距对称
    out.fitBudget = (() => {
      mod.closePopup()
      mod.openPopup(fx.build('normal', 60, 6))
      const p = q('.dstz-panel'); const b = q('.dstz-body'); const i = q('.dstz-inner'); const c = q('.dstz-table')
      const pr = rectOf(p), ir = rectOf(i), cr = rectOf(c)
      const padL = px(cs(i).paddingLeft), padR = px(cs(i).paddingRight)
      const res = {
        tableW: R(cr.w), panelW: R(pr.w), panelLeft: R(pr.left),
        bodyOffsetWidth: b.offsetWidth, bodyClientWidth: b.clientWidth, scrollbarY: b.offsetWidth - b.clientWidth,
        innerOffsetWidth: i.offsetWidth, innerClientWidth: i.clientWidth,
        innerPadLeft: padL, innerPadRight: padR, innerContentW: R(i.clientWidth - padL - padR),
        leftPadEffective: R(cr.left - ir.left),
        rightPadEffective: R((ir.left + i.clientWidth) - cr.right),
        maxScrollLeft: b.scrollWidth - b.clientWidth,
        budget: R(pr.w - cr.w),
      }
      mod.closePopup()
      return res
    })()

    // 还原主夹具表，避免后续（driver 可能再跑一次）看到被换掉的表
    window.__fixtureTable = fx.build('normal')
  }

  return done()
})()