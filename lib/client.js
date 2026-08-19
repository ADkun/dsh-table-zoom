window.__ModuleLoader__.load({
  id: 'dsh-plugin-table-zoom',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    // ------------------------------------------------------------------
    // 样式：一次注入 <style>，类名 dstz-*，全部走主题 CSS 变量。
    // ------------------------------------------------------------------
    var CSS = [
      '.dstz-row{display:flex;justify-content:flex-end;margin-top:2px}',
      '.dstz-btn{appearance:none;cursor:pointer;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);border-radius:999px;font-size:12px;line-height:18px;padding:3px 10px;font-family:inherit;white-space:nowrap}',
      '.dstz-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-bg-active);background:var(--dsw-alias-interactive-bg-hover)}',
      '.dstz-btn:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-active);outline-offset:1px}',
      '.dstz-popup{position:fixed;inset:0;z-index:9999;background:rgba(8,10,18,.55);display:flex;align-items:center;justify-content:center;padding:24px}',
      '.dstz-panel{box-sizing:border-box;background:var(--dsw-specific-input-major);border:1px solid var(--dsw-alias-border-l2-darkmode-thin);border-radius:16px;box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);width:min(92vw,960px);max-height:min(84vh,720px);flex-direction:column;display:flex;overflow:hidden;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}',
      '.dstz-panel,.dstz-panel *{box-sizing:border-box}',
      '.dstz-header{flex-shrink:0;justify-content:space-between;align-items:center;gap:12px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:10px 12px 10px 18px;display:flex}',
      '.dstz-title{margin:0;font-size:14px;font-weight:500;line-height:20px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dstz-title small{color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:400;margin-left:8px}',
      '.dstz-headerActions{flex-shrink:0;align-items:center;gap:8px;display:flex}',
      '.dstz-body{overscroll-behavior:contain;flex:auto;min-height:0;padding:14px 18px 18px;overflow:auto}',
      '.dstz-table{border-collapse:collapse;width:max-content;max-width:max-content;color:var(--dsw-alias-label-primary)}',
      '.dstz-table th{text-align:start;padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l3);font:var(--dsw-font-markdown-table-head);white-space:nowrap}',
      '.dstz-table td{padding:8px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);font:var(--dsw-font-markdown-table)}',
      '.dstz-table tr:last-child td{border-bottom:none}',
      '.dstz-iconButton{width:28px;height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:999px;place-items:center;display:grid;font-size:15px;line-height:1;padding:0}',
      '.dstz-iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.dstz-iconButton:focus-visible{outline:2px solid var(--dsw-alias-interactive-bg-active);outline-offset:1px}',
      '.dstz-copyBtn{appearance:none;cursor:pointer;border-radius:999px;border:1px solid var(--dsw-alias-border-l2-darkmode-thin);background:0 0;color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;padding:3px 10px;font-family:inherit;white-space:nowrap}',
      '.dstz-copyBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.dstz-copyBtn:disabled{cursor:default;opacity:.55}',
      '@media (width<=720px){.dstz-popup{padding:12px}.dstz-panel{width:min(96vw,960px);max-height:88vh}.dstz-body{padding:10px 12px 12px}}'
    ].join('');
    var tagId = 'dsh-plugin-table-zoom/zoom.module.css';
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {
      var tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-plugin-table-zoom';
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    // ------------------------------------------------------------------
    // 常量与文案
    // ------------------------------------------------------------------
    /** 行数（含表头）达到该值即视为“长表”，注入浮窗按钮。 */
    var MIN_ROWS = 9;
    /** 超过该像素视为横向溢出（表太宽），也注入按钮。 */
    var OVERFLOW_PX = 2;
    /** markdown 表格容器类名片段（核心渲染器 tableScroll，CSS Module 哈希前缀）。 */
    var TABLE_WRAP_HINT = 'tableScroll';

    /** 页面语言是否中文（决定按钮/浮窗文案）。 */
    function isZh() {
      return typeof document !== 'undefined' && (document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0;
    }
    var zh = isZh();
    var LABELS = {
      open: zh ? '\u6d6e\u7a97\u67e5\u770b' : 'Open in popup',
      title: zh ? '\u8868\u683c' : 'Table',
      rowsCols: zh ? '\u884c \u00d7 \u5217' : 'rows \u00d7 cols',
      copy: zh ? '\u590d\u5236\u4e3a Markdown' : 'Copy as Markdown',
      copied: zh ? '\u5df2\u590d\u5236' : 'Copied',
      copyFailed: zh ? '\u590d\u5236\u5931\u8d25' : 'Copy failed',
      close: zh ? '\u5173\u95ed' : 'Close'
    };

    // ------------------------------------------------------------------
    // 纯函数（导出供 selfcheck / smoke 测试）
    // ------------------------------------------------------------------

    /**
     * 判断一个 <table> 是否位于 markdown 表格容器内（核心渲染器把表格包在
     * `.tableScroll` 样式的 div 里，类名为 CSS Module 哈希，用属性包含匹配）。
     * @param {object} table - <table> 元素（或测试用假对象，须有 closest 方法）。
     * @returns {boolean}
     */
    function isMarkdownTable(table) {
      if (table === null || typeof table !== 'object' || typeof table.closest !== 'function') return false;
      return table.closest('[class*="' + TABLE_WRAP_HINT + '"]') !== null;
    }

    /**
     * 判断表格是否“长”（行数多或横向溢出）而值得注入浮窗按钮。
     * @param {object} table - <table> 元素（须有 rows 数组/类数组，rows[0].cells）。
     * @param {object} wrap - 表格容器（须有 scrollWidth / clientWidth）。
     * @returns {boolean}
     */
    function isLongTable(table, wrap) {
      if (table === null || typeof table !== 'object') return false;
      var rows = table.rows;
      var rowCount = rows === null || rows === void 0 ? 0 : rows.length;
      if (rowCount >= MIN_ROWS) return true;
      if (wrap !== null && typeof wrap === 'object') {
        var sw = typeof wrap.scrollWidth === 'number' ? wrap.scrollWidth : 0;
        var cw = typeof wrap.clientWidth === 'number' ? wrap.clientWidth : 0;
        if (sw > cw + OVERFLOW_PX) return true;
      }
      return false;
    }

    /**
     * 把 <table> 序列化为 Markdown 文本（单元格内联换行/管道转义），
     * 供「复制为 Markdown」使用。纯函数，可离线测试。
     * @param {object} table - <table> 元素（须有 rows，rows[i].cells，cell.textContent）。
     * @returns {string}
     */
    function tableToMarkdown(table) {
      if (table === null || typeof table !== 'object' || table.rows === null || table.rows === void 0) return '';
      var rows = [];
      for (var r = 0; r < table.rows.length; r++) {
        var tr = table.rows[r];
        var cells = tr.cells === null || tr.cells === void 0 ? [] : tr.cells;
        var row = [];
        for (var c = 0; c < cells.length; c++) {
          var text = cells[c].textContent === null || cells[c].textContent === void 0 ? '' : String(cells[c].textContent);
          row.push(text.replace(/\s*\n\s*/g, ' ').trim().replace(/\|/g, '\\|'));
        }
        rows.push(row);
      }
      if (rows.length === 0) return '';
      var width = 0;
      for (var i = 0; i < rows.length; i++) width = Math.max(width, rows[i].length);
      var lines = [];
      var pad = function (row) {
        var out = [];
        for (var j = 0; j < width; j++) out.push(j < row.length ? row[j] : '');
        return out;
      };
      var line = function (row) { return '| ' + pad(row).join(' | ') + ' |'; };
      lines.push(line(rows[0]));
      var sep = [];
      for (var k = 0; k < width; k++) sep.push('---');
      lines.push('| ' + sep.join(' | ') + ' |');
      for (var m = 1; m < rows.length; m++) lines.push(line(rows[m]));
      return lines.join('\n');
    }

    // ------------------------------------------------------------------
    // 浮窗：命令式 DOM（复用 image-tools lightbox 模式，不触碰 React 结构）
    // ------------------------------------------------------------------
    var activePopup = null;
    var lastTrigger = null;

    /** 关闭当前浮窗并还原页面滚动。 */
    function closePopup() {
      if (activePopup === null) return;
      var popup = activePopup;
      activePopup = null;
      if (typeof popup._onKey === 'function') document.removeEventListener('keydown', popup._onKey);
      popup.remove();
      document.body.style.overflow = lastTrigger !== null && lastTrigger.bodyOverflow !== void 0 ? lastTrigger.bodyOverflow : '';
      lastTrigger = null;
    }

    /** 复制文本到剪贴板（clipboard API，失败时 execCommand 兜底）。@returns {Promise<boolean>} */
    function copyText(text) {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
      }
      return Promise.resolve(legacyCopy(text));
    }

    /** 旧式复制兜底（textarea + execCommand）。 */
    function legacyCopy(text) {
      if (typeof document === 'undefined') return false;
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e) {
        return false;
      }
    }

    /**
     * 打开表格浮窗：可滚动容器 + 表格克隆 + 头部（标题/行列数/复制/关闭）。
     * 克隆而不是移动原表格，聊天里的表格保持不变。
     * @param {object} table - 原始 <table> 元素。
     */
    function openPopup(table) {
      if (typeof document === 'undefined' || table === null || typeof table !== 'object') return;
      closePopup();

      var overlay = document.createElement('div');
      overlay.className = 'dstz-popup';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', LABELS.title);

      var panel = document.createElement('div');
      panel.className = 'dstz-panel';

      var header = document.createElement('header');
      header.className = 'dstz-header';
      var title = document.createElement('h3');
      title.className = 'dstz-title';
      title.textContent = LABELS.title;
      var rowCount = table.rows !== null && table.rows !== void 0 ? table.rows.length : 0;
      var colCount = rowCount > 0 && table.rows[0].cells !== void 0 ? table.rows[0].cells.length : 0;
      var small = document.createElement('small');
      small.textContent = rowCount + ' ' + LABELS.rowsCols + ' ' + colCount;
      title.appendChild(small);

      var actions = document.createElement('div');
      actions.className = 'dstz-headerActions';

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'dstz-copyBtn';
      copyBtn.textContent = LABELS.copy;
      copyBtn.addEventListener('click', function () {
        copyBtn.disabled = true;
        copyText(tableToMarkdown(table)).then(function (ok) {
          copyBtn.textContent = ok ? LABELS.copied : LABELS.copyFailed;
          window.setTimeout(function () {
            copyBtn.textContent = LABELS.copy;
            copyBtn.disabled = false;
          }, 1600);
        });
      });

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'dstz-iconButton';
      closeBtn.setAttribute('aria-label', LABELS.close);
      closeBtn.title = LABELS.close;
      closeBtn.textContent = '\u2715';
      closeBtn.addEventListener('click', closePopup);

      actions.appendChild(copyBtn);
      actions.appendChild(closeBtn);
      header.appendChild(title);
      header.appendChild(actions);

      var body = document.createElement('div');
      body.className = 'dstz-body';
      var clone = table.cloneNode(true);
      clone.className = 'dstz-table';
      body.appendChild(clone);

      panel.appendChild(header);
      panel.appendChild(body);
      overlay.appendChild(panel);

      lastTrigger = { bodyOverflow: document.body.style.overflow };
      document.body.style.overflow = 'hidden';

      var onKey = function (event) {
        if (event.key === 'Escape') closePopup();
      };
      overlay.addEventListener('click', function (event) {
        if (event.target === overlay) closePopup();
      });
      document.addEventListener('keydown', onKey);
      overlay._onKey = onKey;

      activePopup = overlay;
      document.body.appendChild(overlay);
      closeBtn.focus();
    }

    // ------------------------------------------------------------------
    // 扫描与按钮注入
    // ------------------------------------------------------------------

    /** 为单个表格注入「浮窗查看」按钮（容器后插入一行，右对齐）。 */
    function upgradeTable(table) {
      if (typeof document === 'undefined') return null;
      if (!isMarkdownTable(table)) return null;
      // 跳过浮窗内部（克隆表）与图片 lightbox 内的表格
      if (typeof table.closest === 'function' && table.closest('.dstz-popup') !== null) return null;
      if (typeof table.closest === 'function' && table.closest('.dshpick-lightbox') !== null) return null;

      var wrap = table.closest('[class*="' + TABLE_WRAP_HINT + '"]');
      if (wrap === null || wrap === void 0) return null;
      if (!isLongTable(table, wrap)) return null;

      // 该表格容器后紧跟的兄弟已经是按钮行则不再重复插入
      if (wrap.nextElementSibling !== null && wrap.nextElementSibling.classList !== void 0
          && wrap.nextElementSibling.classList.contains('dstz-row')) {
        if (table.dataset !== void 0) table.dataset.dstz = '1';
        return null;
      }

      var parent = wrap.parentNode;
      if (parent === null || parent === void 0) return null;

      var row = document.createElement('div');
      row.className = 'dstz-row';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dstz-btn';
      btn.setAttribute('aria-label', LABELS.open);
      btn.title = LABELS.open;
      var icon = document.createElement('span');
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '\u26F6';
      var label = document.createElement('span');
      label.textContent = LABELS.open;
      btn.appendChild(icon);
      btn.appendChild(label);
      btn.addEventListener('click', function () { openPopup(table); });
      row.appendChild(btn);

      if (wrap.nextSibling !== null) {
        parent.insertBefore(row, wrap.nextSibling);
      } else {
        parent.appendChild(row);
      }
      if (table.dataset !== void 0) table.dataset.dstz = '1';
      return row;
    }

    /** 全量扫描：对每个候选表格执行 upgradeTable。 */
    function upgradeTables() {
      if (typeof document === 'undefined') return;
      var tables = document.querySelectorAll('table');
      for (var i = 0; i < tables.length; i++) upgradeTable(tables[i]);
    }

    /**
     * 启动表格增强：MutationObserver 观察 body，rAF 合帧扫描。
     * @returns {Function|null} 停止函数；无 DOM 环境返回 null。
     */
    function startEnhancer() {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined' || typeof requestAnimationFrame === 'undefined') return null;
      var pending = false;
      var scan = function () {
        pending = false;
        upgradeTables();
      };
      var observer = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        requestAnimationFrame(scan);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      scan();
      return function () {
        observer.disconnect();
        closePopup();
      };
    }

    // ------------------------------------------------------------------
    // 插件入口
    // ------------------------------------------------------------------
    function apply(ctx) {
      ctx.effect(function () {
        return startEnhancer();
      }, 'dsh-plugin-table-zoom: table popup enhancer');
    }

    exports.apply = apply;
    exports.inject = [];
    // 供自检/冒烟测试复用：纯函数与可测入口。
    exports.MIN_ROWS = MIN_ROWS;
    exports.isMarkdownTable = isMarkdownTable;
    exports.isLongTable = isLongTable;
    exports.tableToMarkdown = tableToMarkdown;
    exports.openPopup = openPopup;
    exports.closePopup = closePopup;
    exports.copyText = copyText;
    exports.upgradeTable = upgradeTable;
    exports.upgradeTables = upgradeTables;
    exports.startEnhancer = startEnhancer;
    return module.exports;
  }
});
