'use strict';
/* ================================================================
   MASTER — STATE
================================================================ */
let masterExpandedIds = new Set(); // 展開中ノードID（再レンダリング後も復元）
let masterSelectedNodeIds = new Set(); // 一括移動用の複数選択ID
let _mDragIds = [];                // D&D: ドラッグ中のノードID配列
let _mDragParentId = null;         // D&D: ドラッグ中の親ID
let _corpEvents = [];              // 編集中 corporateEvents 作業コピー（会社ルートモーダル用）
let _corpEventsNodeId = '';        // 編集中ノードID

/* ================================================================
   COMPANY MASTER — SEARCH & BADGE SYSTEM
================================================================ */
const COMPANY_BADGE_DEFAULTS = {
  levelBadge: false,
  empCount:   false,
  levelStrip: false,
  dateBadge:  false,
  corpBadge:  false,
  soldBadge:  false,
  relBar:     false,
};
const COMPANY_BADGE_CSS_MAP = {
  levelBadge: 'show-level-badge',
  empCount:   'show-emp-count',
  levelStrip: 'show-level-strip',
  dateBadge:  'show-date-badge',
  corpBadge:  'show-corp-badge',
  soldBadge:  'show-sold-badge',
  relBar:     'show-rel-bar',
};
const MAX_SEARCH_HISTORY = 8;
const MAX_SUGGEST_PER_CAT = 5;

let _companyFilterQuery = '';  // 現在の検索クエリ（再描画後も保持）
let _csDdMousedown = false;    // ドロップダウン mousedown フラグ（blur競合防止）

/* ── バッジ設定の取得（遅延初期化） ── */
function _getCompanyBadges() {
  if (!DB.settings.companyBadges) {
    DB.settings.companyBadges = { ...COMPANY_BADGE_DEFAULTS };
  }
  return DB.settings.companyBadges;
}

/* ── バッジ表示UI同期（CSS クラス & パネルスイッチ） ── */
function syncCompanyBadgeUI() {
  const tree  = document.getElementById('master-tree');
  const panel = document.getElementById('company-badge-panel');
  if (!tree) return;

  const badges = _getCompanyBadges();
  Object.entries(COMPANY_BADGE_CSS_MAP).forEach(([key, cls]) => {
    tree.classList.toggle(cls, !!badges[key]);
  });

  if (!panel) return;
  panel.querySelectorAll('.cbp-row').forEach(row => {
    row.classList.toggle('is-on', !!badges[row.dataset.badge]);
  });
}

/* ── 会社名候補を全階層から収集（検索候補用） ── */
function _getCompanyCandidates() {
  const flat   = masterFlatten(DB.masters.company || []);
  const seen   = new Map(); // name → { name, depth, empCount, currentName, isOld }
  flat.forEach(n => {
    if (!seen.has(n.name)) {
      seen.set(n.name, {
        name: n.name,
        depth: n.depth,
        empCount: getMasterNodeEmpCount('company', n.name, n.depth, n),
        currentName: n.name,
        isOld: false
      });
    }
    (n.oldNames || []).forEach(o => {
      if (o.name && !seen.has(o.name)) {
        seen.set(o.name, { name: o.name, depth: n.depth, empCount: 0, isOld: true, currentName: n.name });
      }
    });
  });
  return [...seen.values()];
}

/* ── ファジーマッチスコア（文字の出現順一致 → 0〜1） ── */
function _fuzzyScore(needle, haystack) {
  const n = needle.toLowerCase(), h = haystack.toLowerCase();
  let ni = 0;
  for (let hi = 0; hi < h.length && ni < n.length; hi++) {
    if (n[ni] === h[hi]) ni++;
  }
  return ni === n.length ? needle.length / Math.max(haystack.length, 1) : 0;
}

/* ── 検索候補を5カテゴリに分類して返す ── */
function _getCompanySuggestions(q) {
  const candidates = _getCompanyCandidates();
  const history    = DB.settings.companySearchHistory || [];

  if (!q.trim()) {
    // 入力なし：履歴 + 人気ワード
    const popular = [...candidates]
      .filter(c => !c.isOld)
      .sort((a, b) => b.empCount - a.empCount)
      .slice(0, MAX_SUGGEST_PER_CAT);
    return { mode: 'empty', history: history.slice(0, MAX_SUGGEST_PER_CAT), popular };
  }

  const ql = q.trim().toLowerCase();
  const prefix  = [];
  const partial = [];
  const fuzzy   = [];

  candidates.forEach(c => {
    const nl = c.name.toLowerCase();
    if (nl.startsWith(ql))           { prefix.push(c); return; }
    if (nl.includes(ql))             { partial.push(c); return; }
    const score = _fuzzyScore(ql, nl);
    if (score > 0.3)                  { fuzzy.push({ ...c, _score: score }); }
  });

  fuzzy.sort((a, b) => b._score - a._score);
  return {
    mode:    'query',
    prefix:  prefix.slice(0, MAX_SUGGEST_PER_CAT),
    partial: partial.slice(0, MAX_SUGGEST_PER_CAT),
    fuzzy:   fuzzy.slice(0, MAX_SUGGEST_PER_CAT),
  };
}

/* ── ドロップダウンを表示・更新 ── */
function _showCompanySearchDD(q) {
  const dd = document.getElementById('company-search-dd');
  if (!dd) return;

  const sugg = _getCompanySuggestions(q);
  dd.innerHTML = '';

  /* アイテム生成ヘルパー */
  function mkItem(cand, label, labelClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'csd-item';
    
    let nameHtml = `<span class="csd-name">${cand.name}</span>`;
    if (cand.isOld) {
      nameHtml = `<span class="csd-name">${cand.name} <small style="color:var(--c-text-3)">(現: ${cand.currentName})</small></span>`;
    }

    btn.innerHTML = `
      <span class="csd-badge ${labelClass}">${label}</span>
      ${nameHtml}
      ${cand.empCount > 0 ? `<span class="csd-cnt">${cand.empCount}名</span>` : ''}
    `;
    btn.addEventListener('mousedown', () => { _csDdMousedown = true; });
    btn.addEventListener('click', () => _companySearchSelect(cand.isOld ? cand.currentName : cand.name));
    return btn;
  }

  function mkSection(label, icon, items, labelClass, renderItem) {
    if (!items.length) return null;
    const sec = document.createElement('div');
    sec.className = 'csd-section';
    const hdr = document.createElement('div');
    hdr.className = 'csd-section-hdr';
    hdr.innerHTML = `<i class="${icon}"></i><span>${label}</span>`;
    sec.appendChild(hdr);
    items.forEach(it => sec.appendChild(renderItem(it)));
    return sec;
  }

  if (sugg.mode === 'empty') {
    // 履歴チップス
    if (sugg.history.length) {
      const sec = document.createElement('div');
      sec.className = 'csd-section';
      sec.innerHTML = '<div class="csd-section-hdr"><i class="fa-solid fa-clock-rotate-left"></i><span>最近の検索</span></div>';
      const chips = document.createElement('div');
      chips.className = 'csd-chips';
      sugg.history.forEach(term => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'csd-chip';
        chip.textContent = term;
        chip.addEventListener('mousedown', () => { _csDdMousedown = true; });
        chip.addEventListener('click', () => _companySearchSelect(term));
        chips.appendChild(chip);
      });
      sec.appendChild(chips);
      dd.appendChild(sec);
    }

    // 人気ワード
    const popSec = mkSection('人気ワード', 'fa-solid fa-fire-flame-curved', sugg.popular, 'csd-badge-pop',
      c => mkItem(c, c.depth === 0 ? '会社' : '組織', 'csd-badge-pop'));
    if (popSec) dd.appendChild(popSec);

    if (!sugg.history.length && !sugg.popular.length) {
      dd.innerHTML = '<div class="csd-empty">登録された会社がありません</div>';
    }
  } else {
    // 前方一致
    const preSec = mkSection('①前方一致', 'fa-solid fa-arrow-right-to-bracket', sugg.prefix, 'csd-badge-pre',
      c => mkItem(c, '前方', 'csd-badge-pre'));
    if (preSec) dd.appendChild(preSec);

    // 部分一致
    const parSec = mkSection('②部分一致', 'fa-solid fa-magnifying-glass', sugg.partial, 'csd-badge-par',
      c => mkItem(c, '部分', 'csd-badge-par'));
    if (parSec) dd.appendChild(parSec);

    // ファジー
    const fuzSec = mkSection('③ファジー', 'fa-solid fa-wand-magic-sparkles', sugg.fuzzy, 'csd-badge-fuz',
      c => mkItem(c, 'あいまい', 'csd-badge-fuz'));
    if (fuzSec) dd.appendChild(fuzSec);

    if (!sugg.prefix.length && !sugg.partial.length && !sugg.fuzzy.length) {
      dd.innerHTML = `<div class="csd-empty"><i class="fa-solid fa-circle-exclamation"></i>「${q}」に一致する会社が見つかりません</div>`;
    }
  }

  dd.style.display = '';
}

/* ── ドロップダウンを非表示 ── */
function _hideCompanySearchDD() {
  const dd = document.getElementById('company-search-dd');
  if (dd) dd.style.display = 'none';
  _csDdMousedown = false;
}

/* ── 候補を選択 ── */
function _companySearchSelect(name) {
  const input = document.getElementById('master-filter-input');
  if (input) input.value = name;
  _saveCompanySearchHistory(name);
  _hideCompanySearchDD();
  applyCompanyFilter(name);
  _updateMasterFilterClearBtn();
}

/* ── 検索履歴を保存 ── */
function _saveCompanySearchHistory(term) {
  if (!term.trim()) return;
  if (!DB.settings.companySearchHistory) DB.settings.companySearchHistory = [];
  const hist = DB.settings.companySearchHistory;
  const idx = hist.indexOf(term);
  if (idx >= 0) hist.splice(idx, 1);
  hist.unshift(term);
  if (hist.length > MAX_SEARCH_HISTORY) hist.length = MAX_SEARCH_HISTORY;
  saveDB();
}

/* ── クリアボタンの表示状態更新 ── */
function _updateMasterFilterClearBtn() {
  const clearBtn = document.getElementById('master-filter-clear');
  const input    = document.getElementById('master-filter-input');
  if (clearBtn && input) clearBtn.style.display = input.value ? '' : 'none';
}

/* ── 会社マスタのフィルタ適用（DOMレベル表示/非表示） ── */
function applyCompanyFilter(q) {
  _companyFilterQuery = q;
  const tree = document.getElementById('master-tree');
  if (!tree) return;

  const nodes = tree.querySelectorAll('.master-node');
  nodes.forEach(n => n.classList.remove('is-filtered-out','filter-match'));

  if (!q.trim()) {
    nodes.forEach(n => {
      n.style.display = '';
      const nameEl = n.querySelector(':scope > .master-node-head .master-node-name');
      if (nameEl && nameEl.dataset.origText) {
        nameEl.innerHTML = nameEl.dataset.origText;
      }
    });
    return;
  }

  const ql = q.trim().toLowerCase();
  nodes.forEach(n => {
    const nameEl = n.querySelector(':scope > .master-node-head .master-node-name');
    if (!nameEl) return;
    if (!nameEl.dataset.origText) nameEl.dataset.origText = nameEl.innerHTML;
    
    const name = nameEl.textContent.toLowerCase() || '';
    const old = (n.dataset.oldnames || '').toLowerCase();
    const isMatch = name.includes(ql) || old.includes(ql) || _fuzzyScore(ql, name) > 0.35 || _fuzzyScore(ql, old) > 0.35;
    
    if (isMatch) {
      n.classList.add('filter-match');
      if (typeof highlightHTMLText === 'function') {
        nameEl.innerHTML = highlightHTMLText(nameEl.dataset.origText, q);
      }
    } else {
      nameEl.innerHTML = nameEl.dataset.origText;
    }
  });

  const allNodes = [...nodes].reverse();
  allNodes.forEach(n => {
    if (n.classList.contains('filter-match')) {
      n.classList.remove('is-filtered-out');
      n.style.display = '';
      return;
    }
    const hasMatchDescendant = n.querySelector('.filter-match');
    if (!hasMatchDescendant) {
      n.classList.add('is-filtered-out');
      n.style.display = 'none';
    } else {
      n.classList.remove('is-filtered-out');
      n.style.display = '';
    }
  });
}

/* ================================================================
   TAG MASTER VIEW
================================================================ */
function renderTagMaster() {
  const grid  = document.getElementById('tag-grid');
  const empty = document.getElementById('tag-master-empty');
  if (!grid) return;
  const cntBadge = document.getElementById('master-cnt-badge');
  if (cntBadge) cntBadge.textContent = `(${DB.tags.length}件)`;
  grid.innerHTML = '';
  if (!DB.tags.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  const frag = document.createDocumentFragment();

  function renderTagLevel(tags, parentId, indent) {
    tags.filter(t => (t.parentId || '') === (parentId || '')).forEach(tag => {
      const used = DB.employees.filter(e => (e.tags||[]).includes(tag.id)).length;
      const card = document.createElement('div');
      card.className = 'tag-card';
      card.dataset.tagId = tag.id;
      if (indent > 0) card.style.marginLeft = (indent * 20) + 'px';
      const dot  = document.createElement('div'); dot.className = 'tag-dot'; dot.style.background = tag.color;
      const nm   = document.createElement('div'); nm.className = 'tag-card-name';
      nm.textContent = tag.name;
      if (indent > 0) nm.style.fontSize = '13px';
      const cnt  = document.createElement('div'); cnt.className = 'tag-card-cnt master-item-count'; cnt.textContent = used + '名';
      if (used === 0) cnt.dataset.zero = 'true';
      const acts = document.createElement('div'); acts.className = 'tag-card-acts';
      acts.appendChild(listMkBtn('fa-solid fa-pen-to-square', '編集', () => openTagModal(tag.id)));
      const dBtn = listMkBtn('fa-solid fa-trash-can', '削除', () =>
        openConfirm(`タグ「${tag.name}」を削除しますか？${used?`\n${used}名の従業員からも削除されます。`:''}`, () => deleteTag(tag.id)));
      dBtn.style.color = 'var(--c-danger)'; acts.appendChild(dBtn);
      card.append(dot, nm, cnt, acts); frag.appendChild(card);
      // 子タグを再帰的にレンダリング
      renderTagLevel(tags, tag.id, indent + 1);
    });
  }
  renderTagLevel(DB.tags, '', 0);
  grid.appendChild(frag);

  // フィルタ再適用
  const q = (document.getElementById('master-filter-input')?.value || '').trim();
  if (q) applyTagFilter(q);
}

/* ================================================================
   MASTER — CRUD UTILITIES
================================================================ */
function masterFindNode(nodes, id) {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children?.length) {
      const found = masterFindNode(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

function masterDeleteNode(nodes, id) {
  const idx = nodes.findIndex(n => n.id === id);
  if (idx >= 0) { nodes.splice(idx, 1); return true; }
  for (const n of nodes) {
    if (n.children?.length && masterDeleteNode(n.children, id)) return true;
  }
  return false;
}

/* ----------------------------------------------------------------
   同一階層内での重複名チェック
   parentId: 空文字=ルート, excludeId: 編集時に自身を除外
---------------------------------------------------------------- */
function masterCheckDuplicateSibling(type, name, parentId, excludeId = null) {
  const siblings = parentId
    ? (masterFindNode(DB.masters[type] || [], parentId)?.children || [])
    : (DB.masters[type] || []);
  return siblings.some(n => n.id !== excludeId && n.name === name);
}

/* ----------------------------------------------------------------
   D&D: ドラッグ元ノードを指定位置に移動（同一siblings内）
---------------------------------------------------------------- */
function masterMoveNodeTo(type, dragId, dropId, insertAfter) {
  function doMove(arr) {
    const dragIdx = arr.findIndex(n => n.id === dragId);
    if (dragIdx !== -1) {
      const [item] = arr.splice(dragIdx, 1);
      const dropIdx = arr.findIndex(n => n.id === dropId);
      const insertIdx = insertAfter ? dropIdx + 1 : dropIdx;
      arr.splice(insertIdx < 0 ? arr.length : insertIdx, 0, item);
      return true;
    }
    for (const n of arr) {
      if (n.children?.length && doMove(n.children)) return true;
    }
    return false;
  }
  if (doMove(DB.masters[type] || [])) { saveDB(); renderMasterView(); }
}

/* ----------------------------------------------------------------
   名前ソート（全階層を再帰的にソート・DB反映）
---------------------------------------------------------------- */
function masterSortByName(type, dir) {
  function sortArr(arr) {
    arr.sort((a, b) => dir === 'asc'
      ? a.name.localeCompare(b.name, 'ja')
      : b.name.localeCompare(a.name, 'ja'));
    arr.forEach(n => { if (n.children?.length) sortArr(n.children); });
  }
  sortArr(DB.masters[type] || []);
  saveDB();
  masterExpandedIds = new Set(); // ソート後は全折りたたみ
  renderMasterView();
  toast(dir === 'asc' ? '名前順（昇順）に並び替えました' : '名前順（降順）に並び替えました');
}

/* D&D: 全ノードのドロップインジケーターをクリア */
function clearAllDragIndicators() {
  document.querySelectorAll(
    '#master-tree .drag-over-top, #master-tree .drag-over-bottom, #master-tree .drag-over-into'
  ).forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into');
    delete el.dataset.dropMode;
  });
}

/* ================================================================
   MASTER — クロス階層D&D ユーティリティ
================================================================ */

/**
 * ツリー内の targetId を探し { node, path } を返す。
 * path はルートから「親ノードの名前配列」（自身を含まない）。
 */
function masterGetNodePath(type, targetId) {
  function search(nodes, target, path) {
    for (const n of nodes) {
      if (n.id === target) return { node: n, path: [...path] };
      if (n.children?.length) {
        const r = search(n.children, target, [...path, n.name]);
        if (r) return r;
      }
    }
    return null;
  }
  return search(DB.masters[type] || [], targetId, []);
}

/**
 * maybeDescendantId が nodeId 自身またはその子孫かどうかを返す。
 * D&D 循環参照ガードとして使用。
 */
function masterIsDescendantOf(type, nodeId, maybeDescendantId) {
  if (nodeId === maybeDescendantId) return true;
  const ancestor = masterFindNode(DB.masters[type] || [], nodeId);
  if (!ancestor) return false;
  return !!masterFindNode(ancestor.children || [], maybeDescendantId);
}

/**
 * nodeId のノードをツリーから取り外して返す（破壊的操作）。
 */
function masterExtractNode(type, nodeId) {
  let found = null;
  function remove(arr) {
    const idx = arr.findIndex(n => n.id === nodeId);
    if (idx >= 0) { [found] = arr.splice(idx, 1); return true; }
    return arr.some(n => n.children?.length && remove(n.children));
  }
  remove(DB.masters[type] || []);
  return found;
}

/**
 * nodeId のノードを取り出し newParentId 配下（null=ルート）に挿入する。
 * insertBeforeId が指定されていればその前後に挿入、なければ末尾追加。
 */
function masterApplyMove(type, nodeId, newParentId, insertBeforeId, insertAfter) {
  const node = masterExtractNode(type, nodeId);
  if (!node) return false;

  let targetArr;
  if (newParentId) {
    const parent = masterFindNode(DB.masters[type] || [], newParentId);
    if (!parent) {
      (DB.masters[type] = DB.masters[type] || []).push(node);
      return false;
    }
    if (!parent.children) parent.children = [];
    targetArr = parent.children;
    masterExpandedIds.add(newParentId);
    _companyExpandedIds.add(newParentId);
  } else {
    targetArr = DB.masters[type] || [];
  }

  if (insertBeforeId) {
    const idx = targetArr.findIndex(n => n.id === insertBeforeId);
    const pos = insertAfter
      ? (idx >= 0 ? idx + 1 : targetArr.length)
      : (idx >= 0 ? idx     : 0);
    targetArr.splice(pos, 0, node);
  } else {
    targetArr.push(node);
  }
  return true;
}

/* ----------------------------------------------------------------
   会社・学校マスタ：ノード移動が従業員異動履歴や学歴データに与える影響を分析する。
   戻り値: { oldFullPath, newFullPath, changes, count, empCount }
---------------------------------------------------------------- */
function masterAnalyzeMoveImpact(type, dragId, newParentId) {
  const empty = { oldFullPath: [], newFullPath: [], changes: [], count: 0, empCount: 0 };
  if (type !== 'company' && type !== 'school') return empty;

  const oldInfo = masterGetNodePath(type, dragId);
  if (!oldInfo) return empty;
  const oldFullPath = [...oldInfo.path, oldInfo.node.name];

  const newParentInfo = newParentId ? masterGetNodePath(type, newParentId) : null;
  const newParentPath = newParentInfo ? [...newParentInfo.path, newParentInfo.node.name] : [];
  const newFullPath   = [...newParentPath, oldInfo.node.name];

  const changes = [];
  let totalCount = 0;

  if (type === 'company') {
    DB.employees.forEach(emp => {
      const affected = [];
      (emp.transfers || []).forEach(t => {
        if (!Array.isArray(t.orgLevels) || t.orgLevels.length < oldFullPath.length) return;
        if (oldFullPath.every((name, i) => t.orgLevels[i] === name)) affected.push(t);
      });
      if (affected.length > 0) {
        const sample = [...affected].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
        changes.push({
          empId:      emp.id,
          empName:    emp.name || emp.id,
          position:   sample.position || '',
          count:      affected.length,
          sampleDate: sample.date || '',
          sampleOld:  [...sample.orgLevels],
          sampleNew:  [...newFullPath, ...sample.orgLevels.slice(oldFullPath.length)],
        });
        totalCount += affected.length;
      }
    });
  } else if (type === 'school') {
    // ラベルノードを除いた実効パスで照合（emp.school/eduDept はラベルを含まない）
    const { effectivePath: oldEffPath } = schoolEffectivePath(oldFullPath);
    const { effectivePath: newEffPath } = schoolEffectivePath(newFullPath);
    DB.employees.forEach(emp => {
      if (!emp.school) return;
      const depts   = emp.eduDept ? emp.eduDept.split(/\s+/).filter(Boolean) : [];
      const empPath = [emp.school, ...depts];
      if (oldEffPath.length === 0 || empPath.length < oldEffPath.length) return;
      if (oldEffPath.every((name, i) => empPath[i] === name)) {
        const updatedPath = [...newEffPath, ...empPath.slice(oldEffPath.length)];
        changes.push({
          empId:      emp.id,
          empName:    emp.name || emp.id,
          position:   '',
          count:      1,
          sampleDate: '',
          sampleOld:  [...empPath],
          sampleNew:  updatedPath,
        });
        totalCount += 1;
      }
    });
  }

  return {
    oldFullPath, newFullPath,
    dragNodeName: oldInfo.node.name,
    changes, count: totalCount, empCount: changes.length,
  };
}

/* ----------------------------------------------------------------
   ノード移動確認モーダルを表示する。
   opts: { type, node, oldPath, newPath, impact, onConfirm }
---------------------------------------------------------------- */
function _showMasterMoveConfirmModal(opts) {
  const { type, node, oldPath, newPath, impact, onConfirm } = opts;
  document.getElementById('_master-move-modal')?.remove();

  function pathCrumbs(arr, cls) {
    if (!arr || !arr.length) return `<span class="mmove-crumb-empty">（ルート直下）</span>`;
    return arr.map((s, i) => `<span class="mmove-crumb ${cls}${i === arr.length - 1 ? ' is-leaf' : ''}">${s}</span>`).join('<i class="fa-solid fa-angle-right mmove-crumb-sep"></i>');
  }

  const DISPLAY_MAX = 5;
  let impactHtml;
  if (impact.empCount > 0) {
    const isCompany = type === 'company';
    const targetName = isCompany ? '異動履歴' : '学歴データ';
    const empCards = impact.changes.slice(0, DISPLAY_MAX).map(c => {
      const avatar = (c.empName || '?').charAt(0);
      const posHtml  = c.position ? `<span class="mmove-emp-pos">${c.position}</span>` : '';
      const dateHtml = c.sampleDate ? `<span class="mmove-emp-date">${c.sampleDate.replace(/-/g,'/')}</span>` : '';
      const pathHtml = (c.sampleOld?.length && c.sampleNew?.length)
        ? `<div class="mmove-emp-path"><div class="mmove-ep-row old"><span class="mmove-ep-tag from">変更前</span><span class="mmove-ep-val">${c.sampleOld.join(' › ')}</span></div><div class="mmove-ep-arrow"><i class="fa-solid fa-arrow-down"></i></div><div class="mmove-ep-row new"><span class="mmove-ep-tag to">変更後</span><span class="mmove-ep-val">${c.sampleNew.join(' › ')}</span></div></div>` : '';
      return `<div class="mmove-emp-card"><div class="mmove-emp-card-hdr"><span class="mmove-emp-avatar">${avatar}</span><span class="mmove-emp-name">${c.empName}</span>${posHtml}${dateHtml}</div>${pathHtml}</div>`;
    }).join('');
    const moreHtml = impact.changes.length > DISPLAY_MAX ? `<div class="mmove-emp-more"><i class="fa-solid fa-ellipsis"></i> 他 ${impact.changes.length - DISPLAY_MAX}名の従業員も更新されます</div>` : '';
    impactHtml = `<div class="mmove-impact"><div class="mmove-impact-hdr"><i class="fa-solid fa-triangle-exclamation"></i><span>${targetName} <strong>${impact.empCount}名・${impact.count}件</strong> のパスが自動更新されます</span></div><div class="mmove-impact-list">${empCards}${moreHtml}</div></div>`;
  } else {
    impactHtml = `<div class="mmove-no-impact"><i class="fa-solid fa-circle-check"></i><span>この移動によるデータへの影響はありません</span></div>`;
  }

  let eventHtml = '';
  let isEventRequired = false;
  if (type === 'company') {
    const today = new Date().toISOString().slice(0, 10);
    let suggestEvType = '';
    const isToRoot = newPath.length === 1;
    const isFromRoot = oldPath.length === 1;

    // 状況からイベント種別を推測し、大きな変化の場合は強制入力にする
    if (isToRoot && !isFromRoot) { suggestEvType = 'spinoff'; isEventRequired = true; } 
    else if (!isToRoot && isFromRoot) { suggestEvType = 'subsidiary'; isEventRequired = true; } 
    else if (!isToRoot && !isFromRoot) { suggestEvType = 'internalize'; isEventRequired = true; }

    eventHtml = `
      <div class="mmove-event-sec">
        <div class="mmove-event-hdr">
          <i class="fa-solid fa-timeline"></i> 組織再編イベントとして記録する <span class="${isEventRequired ? 'req' : 'opt'}">${isEventRequired ? '*必須' : '（任意）'}</span>
        </div>
        <div class="fg-row" style="margin-bottom:0;">
          <div class="fg" style="flex:1.5; margin-bottom:0;">
            <select class="finput" id="_mmove-ev-type" ${isEventRequired ? 'required' : ''}>
              ${isEventRequired ? '<option value="">（イベントを選択してください）</option>' : '<option value="">（イベントを記録しない）</option>'}
              <option value="subsidiary" ${suggestEvType === 'subsidiary' ? 'selected' : ''}>子会社化 / 関連会社化</option>
              <option value="internalize" ${suggestEvType === 'internalize' ? 'selected' : ''}>部門として統合 (部門化)</option>
              <option value="merger-absorbed" ${suggestEvType === 'merger-absorbed' ? 'selected' : ''}>吸収合併</option>
              <option value="spinoff" ${suggestEvType === 'spinoff' ? 'selected' : ''}>独立・分社化</option>
              <option value="acquisition" ${suggestEvType === 'acquisition' ? 'selected' : ''}>M&A・買収</option>
            </select>
          </div>
          <div class="fg" style="flex:1; margin-bottom:0;">
            <div class="hire-wrap"><input type="text" class="finput flex-date-input" id="_mmove-ev-date" placeholder="発効日 (YYYY-MM)" value="${today}"></div>
          </div>
        </div>
        <p class="f-hint" style="margin-top:6px; color: ${isEventRequired ? 'var(--c-danger)' : 'var(--c-text-3)'}">
          <i class="fa-solid fa-circle-info"></i> ${isEventRequired ? '組織構造の変更を伴うため、イベントの記録が必須です。' : 'イベントを記録すると、過去の履歴ビューにも正確に反映されます。'}
        </p>
      </div>`;
  }

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = '_master-move-modal';
  overlay.innerHTML = `
    <div class="modal mmove-modal"><div class="modal-head"><div class="modal-title"><i class="fa-solid fa-arrows-up-down-left-right" style="color:var(--c-primary)"></i><span>ノードの移動確認</span></div><button class="modal-close" id="_mmove-close"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="modal-body"><div class="mmove-paths"><div class="mmove-path-row"><span class="mmove-path-lbl from">移動前</span><div class="mmove-path-crumbs">${pathCrumbs(oldPath, 'from')}</div></div><div class="mmove-path-arrow"><i class="fa-solid fa-arrow-down"></i></div><div class="mmove-path-row"><span class="mmove-path-lbl to">移動後</span><div class="mmove-path-crumbs">${pathCrumbs(newPath, 'to')}</div></div></div>
        ${eventHtml}${impactHtml}<p class="mmove-note"><i class="fa-solid fa-circle-info"></i>この操作は取り消せません。従業員の異動履歴は自動的に更新されます。</p>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" id="_mmove-cancel">キャンセル</button><button class="btn btn-primary" id="_mmove-confirm"><i class="fa-solid fa-check"></i>移動を実行</button></div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  if (type === 'company' && typeof FlexDatePicker !== 'undefined') {
    const dateInp = overlay.querySelector('#_mmove-ev-date');
    if (dateInp) new FlexDatePicker(dateInp, { minPrec: 'year', maxPrec: 'day', normalize: normalizeFlexDate });
  }

  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('#_mmove-close').addEventListener('click', close);
  overlay.querySelector('#_mmove-cancel').addEventListener('click', close);
  
  overlay.querySelector('#_mmove-confirm').addEventListener('click', () => {
    let evData = null;
    if (type === 'company') {
      const typeSel = overlay.querySelector('#_mmove-ev-type');
      const evType = typeSel.value;
      const evDate = overlay.querySelector('#_mmove-ev-date').value.trim();
      if (isEventRequired && !evType) {
        typeSel.style.borderColor = 'var(--c-danger)';
        setTimeout(() => typeSel.style.borderColor = '', 1500);
        toast('イベント種別を選択してください');
        return; 
      }
      if (evType) {
        evData = { type: evType, date: (typeof normalizeFlexDate === 'function' ? normalizeFlexDate(evDate) : evDate) || evDate, note: '配置変更に伴う自動登録' };
      }
    }
    close(); 
    onConfirm(evData); 
  });
  setTimeout(() => overlay.querySelector('#_mmove-cancel')?.focus(), 60);
}

/* ----------------------------------------------------------------
   クロス階層移動のトリガー。
   同一親内の並び替えは確認なしで即実行。
   親が変わる場合は影響分析 → 確認モーダル表示。
---------------------------------------------------------------- */
function _triggerMasterMoveWithConfirm(type, dragId, newParentId, insertBeforeId, insertAfter) {
  const oldInfo = masterGetNodePath(type, dragId);
  if (!oldInfo) return;

  const oldParentPath = oldInfo.path;
  const newParentInfo = newParentId ? masterGetNodePath(type, newParentId) : null;
  const newParentPath = newParentInfo ? [...newParentInfo.path, newParentInfo.node.name] : [];

  // 同一親 → 確認不要な並び替え
  if (JSON.stringify(oldParentPath) === JSON.stringify(newParentPath)) {
    if (insertBeforeId) {
      masterMoveNodeTo(type, dragId, insertBeforeId, insertAfter);
    } else {
      masterApplyMove(type, dragId, newParentId, null, false);
      saveDB(); renderMasterView();
      toast('移動しました');
    }
    return;
  }

  // 異なる親 → 影響分析 → 確認モーダル
  const impact      = masterAnalyzeMoveImpact(type, dragId, newParentId);
  const oldFullPath = [...oldParentPath, oldInfo.node.name];
  const newFullPath = [...newParentPath, oldInfo.node.name];

  _showMasterMoveConfirmModal({
    type, node: oldInfo.node,
    oldPath: oldFullPath,
    newPath: newFullPath,
    impact,
    onConfirm: (evData) => masterApplyMoveWithHistory(
      type, dragId, newParentId, impact, insertBeforeId, insertAfter, evData
    ),
  });
}

/* ----------------------------------------------------------------
   従業員 orgLevels パスを一括更新してノードを移動・保存する。
   引数 evData を受け取り、会社イベントを付与。
---------------------------------------------------------------- */
function masterApplyMoveWithHistory(type, dragId, newParentId, impact, insertBeforeId, insertAfter, evData = null) {
  const node = masterExtractNode(type, dragId);
  if (!node) return;

  // 1. 従業員のパスを自動更新（会社マスタ・学校マスタ両対応）
  if (impact && impact.oldFullPath.length > 0) {
    const { oldFullPath, newFullPath } = impact;
    if (type === 'company') {
      DB.employees.forEach(emp => {
        (emp.transfers || []).forEach(t => {
          if (!Array.isArray(t.orgLevels) || t.orgLevels.length < oldFullPath.length) return;
          if (oldFullPath.every((name, i) => t.orgLevels[i] === name)) {
            t.orgLevels = [...newFullPath, ...t.orgLevels.slice(oldFullPath.length)];
          }
        });
      });
    } else if (type === 'school') {
      // ラベルノードを除いた実効パスで照合・更新
      const { effectivePath: oldEffPath } = schoolEffectivePath(oldFullPath);
      const { effectivePath: newEffPath } = schoolEffectivePath(newFullPath);
      DB.employees.forEach(emp => {
        if (!emp.school) return;
        const depts   = emp.eduDept ? emp.eduDept.split(/\s+/).filter(Boolean) : [];
        const empPath = [emp.school, ...depts];
        if (oldEffPath.length === 0 || empPath.length < oldEffPath.length) return;
        if (oldEffPath.every((name, i) => empPath[i] === name)) {
          const updatedPath = [...newEffPath, ...empPath.slice(oldEffPath.length)];
          emp.school  = updatedPath[0] || '';
          emp.eduDept = updatedPath.slice(1).join(' ') || '';
        }
      });
    }
  }

  // 2. 組織再編イベントの処理と属性の整合性確保
  if (type === 'company') {
    if (!node.corporateEvents) node.corporateEvents = [];
    
    // 移動に伴う自動属性補正のロジック
    // ルートへ移動 = 独立した実体 (会社) への昇格を検討
    if (!newParentId) {
       if (node.nodeType !== 'company') {
         node.nodeType = 'company';
         toast('ルートへ移動したため、種別を「会社」に変更しました');
       }
    } else {
       // 他のノード配下へ移動 = 子会社化や部門統合
       const parentNode = masterFindNode(DB.masters.company, newParentId);
       if (parentNode && node.nodeType === 'company' && !evData) {
         // 会社が他社の配下に入る場合は、イベント登録を強く促す（または自動生成）
         evData = {
           type: 'subsidiary',
           date: new Date().toISOString().slice(0, 10),
           note: '配置変更に伴う自動登録'
         };
       }
    }

    if (evData) {
      node.corporateEvents.push({
        id: uid(),
        type: evData.type,
        date: evData.date,
        endDate: '',
        relatedCompanyId: newParentId || '',
        relatedNodeId: '',
        note: evData.note || '配置変更に伴う履歴'
      });
    }
  }

  // 3. ツリーへの再挿入
  let targetArr;
  if (newParentId) {
    const parent = masterFindNode(DB.masters[type] || [], newParentId);
    if (!parent) {
      (DB.masters[type] = DB.masters[type] || []).push(node);
    } else {
      if (!parent.children) parent.children = [];
      targetArr = parent.children;
      masterExpandedIds.add(newParentId);
      if (typeof _companyExpandedIds !== 'undefined') _companyExpandedIds.add(newParentId);
    }
  } else {
    targetArr = DB.masters[type] || [];
  }

  if (targetArr) {
    if (insertBeforeId) {
      const idx = targetArr.findIndex(n => n.id === insertBeforeId);
      const pos = insertAfter ? (idx >= 0 ? idx + 1 : targetArr.length) : (idx >= 0 ? idx : 0);
      targetArr.splice(pos, 0, node);
    } else {
      targetArr.push(node);
    }
  }

  saveDB();
  renderMasterView();
  const empMsg = (impact && impact.count > 0) ? `（従業員 ${impact.empCount}名 のパスを更新）` : '';
  toast(`移動しました${empMsg}`);
}

/* ----------------------------------------------------------------
   バルク移動のロジックと確認モーダル
---------------------------------------------------------------- */
function _filterTopLevelDragNodes(type, ids) {
  return ids.filter(id => {
    return !ids.some(otherId => {
      if (id === otherId) return false;
      return masterIsDescendantOf(type, otherId, id);
    });
  });
}

function _triggerBulkMasterMoveWithConfirm(type, dragIds, newParentId, insertBeforeId, insertAfter) {
  const topIds = _filterTopLevelDragNodes(type, dragIds);
  if (topIds.length === 0) return;

  const newParentInfo = newParentId ? masterGetNodePath(type, newParentId) : null;
  const newParentPath = newParentInfo ? [...newParentInfo.path, newParentInfo.node.name] : [];

  const moves = topIds.map(id => {
    const oldInfo = masterGetNodePath(type, id);
    if (!oldInfo) return null;
    const oldParentPath = oldInfo.path;
    const isSameParent = JSON.stringify(oldParentPath) === JSON.stringify(newParentPath);
    
    const impact = isSameParent ? { count: 0, empCount: 0 } : masterAnalyzeMoveImpact(type, id, newParentId);
    
    return {
      id,
      node: oldInfo.node,
      oldParentPath,
      newParentPath,
      oldFullPath: [...oldParentPath, oldInfo.node.name],
      newFullPath: [...newParentPath, oldInfo.node.name],
      isSameParent,
      impact
    };
  }).filter(Boolean);

  if (moves.length === 0) return;

  if (moves.every(m => m.isSameParent)) {
    moves.forEach(m => {
      if (insertBeforeId) masterMoveNodeTo(type, m.id, insertBeforeId, insertAfter);
      else masterApplyMove(type, m.id, newParentId, null, false);
    });
    masterSelectedNodeIds.clear();
    syncMasterBulkToolbar();
    saveDB(); renderMasterView();
    toast(`${moves.length}件を移動（並び替え）しました`);
    return;
  }

  _showBulkMoveConfirmModal(type, moves, newParentId, insertBeforeId, insertAfter);
}

function _showBulkMoveConfirmModal(type, moves, newParentId, insertBeforeId, insertAfter) {
  document.getElementById('_bulk-move-modal')?.remove();

  function pathCrumbs(arr, cls) {
    if (!arr || !arr.length) return `<span class="mmove-crumb-empty">（ルート）</span>`;
    return arr.map((s, i) => `<span class="mmove-crumb ${cls}${i === arr.length - 1 ? ' is-leaf' : ''}">${s}</span>`).join('<span class="te-crumb-sep"><i class="fa-solid fa-angle-right"></i></span>');
  }

  const isCompany = type === 'company';
  let eventHtml = '';
  if (isCompany && moves.some(m => !m.isSameParent)) {
    const today = new Date().toISOString().slice(0, 10);
    eventHtml = `
      <div class="mmove-event-sec" style="margin-top:0;">
        <div class="mmove-event-hdr">
          <i class="fa-solid fa-timeline"></i> 一括イベント記録 <span class="opt">（階層変化を伴う会社に適用）</span>
        </div>
        <div class="fg-row" style="margin-bottom:0;">
          <div class="fg" style="flex:1.5; margin-bottom:0;">
            <select class="finput" id="_bmove-ev-type">
              <option value="">（イベントを記録しない）</option>
              <option value="subsidiary">子会社化 / 関連会社化</option>
              <option value="internalize">部門として統合 (部門化)</option>
              <option value="merger-absorbed">吸収合併</option>
              <option value="spinoff">独立・分社化</option>
            </select>
          </div>
          <div class="fg" style="flex:1; margin-bottom:0;">
            <div class="hire-wrap"><input type="text" class="finput flex-date-input" id="_bmove-ev-date" placeholder="発効日 (YYYY-MM)" value="${today}"></div>
          </div>
        </div>
      </div>`;
  }

  const rowsHtml = moves.map((m, i) => {
    const imp = m.impact;
    let impBadge = '';
    if (m.isSameParent) {
      impBadge = `<span class="bmt-impact-badge no-impact">並び替えのみ</span>`;
    } else if (imp.empCount > 0) {
      impBadge = `<span class="bmt-impact-badge has-impact"><i class="fa-solid fa-users"></i>${imp.empCount}名の履歴更新</span>`;
    } else {
      impBadge = `<span class="bmt-impact-badge no-impact">影響なし</span>`;
    }

    return `
      <div class="bmt-row">
        <label><input type="checkbox" class="bmt-check-item" value="${i}" checked></label>
        <div class="bmt-path-col">
          <div class="bmt-path-line"><span class="tag from">前</span>${pathCrumbs(m.oldFullPath, 'from')}</div>
          <div class="bmt-path-line"><span class="tag to">後</span>${pathCrumbs(m.newFullPath, 'to')}</div>
        </div>
        <div class="bmt-impact-col">${impBadge}</div>
      </div>
    `;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = '_bulk-move-modal';
  overlay.innerHTML = `
    <div class="modal mmove-modal" style="max-width:760px;">
      <div class="modal-head">
        <div class="modal-title"><i class="fa-solid fa-layer-group" style="color:var(--c-primary)"></i><span>${moves.length}件の移動確認</span></div>
        <button class="modal-close" id="_bmove-close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body" style="padding-top:16px;">
        <p style="font-size:12.5px;color:var(--c-text-2);margin-bottom:12px;">以下の項目を指定の場所に移動します。移動する項目にチェックを入れてください。</p>
        ${eventHtml}
        <div class="bmt-container">
          <div class="bmt-header">
            <label><input type="checkbox" id="bmt-check-all" checked> すべて</label>
            <span style="flex:1;">移動内容</span>
            <span style="width:140px;">履歴への影響</span>
          </div>
          <div class="bmt-body">${rowsHtml}</div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" id="_bmove-cancel">キャンセル</button>
        <button class="btn btn-primary" id="_bmove-confirm"><i class="fa-solid fa-check"></i>選択した項目を移動</button>
      </div>
    </div>`;
  
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  if (isCompany && typeof FlexDatePicker !== 'undefined') {
    const dateInp = overlay.querySelector('#_bmove-ev-date');
    if (dateInp) new FlexDatePicker(dateInp, { minPrec: 'year', maxPrec: 'day', normalize: normalizeFlexDate });
  }

  const chkAll = overlay.querySelector('#bmt-check-all');
  const chkItems = overlay.querySelectorAll('.bmt-check-item');
  chkAll.addEventListener('change', e => {
    chkItems.forEach(c => c.checked = e.target.checked);
  });
  chkItems.forEach(c => c.addEventListener('change', () => {
    chkAll.checked = Array.from(chkItems).every(x => x.checked);
  }));

  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('#_bmove-close').addEventListener('click', close);
  overlay.querySelector('#_bmove-cancel').addEventListener('click', close);

  overlay.querySelector('#_bmove-confirm').addEventListener('click', () => {
    const selectedIndices = Array.from(chkItems).filter(c => c.checked).map(c => parseInt(c.value));
    if (selectedIndices.length === 0) {
      toast('移動する項目が選択されていません');
      return;
    }

    let evData = null;
    if (isCompany) {
      const typeSel = overlay.querySelector('#_bmove-ev-type');
      if (typeSel && typeSel.value) {
        const evDate = overlay.querySelector('#_bmove-ev-date').value.trim();
        evData = { type: typeSel.value, date: (typeof normalizeFlexDate === 'function' ? normalizeFlexDate(evDate) : evDate) || evDate, note: '一括移動に伴う自動登録' };
      }
    }

    let totalEmpsUpdated = 0;
    selectedIndices.forEach(idx => {
      const m = moves[idx];
      if (m.isSameParent) {
        if (insertBeforeId) masterMoveNodeTo(type, m.id, insertBeforeId, insertAfter);
        else masterApplyMove(type, m.id, newParentId, null, false);
      } else {
        masterApplyMoveWithHistory(type, m.id, newParentId, m.impact, insertBeforeId, insertAfter, evData);
        if (m.impact) totalEmpsUpdated += m.impact.empCount;
      }
    });

    masterSelectedNodeIds.clear();
    syncMasterBulkToolbar();
    saveDB(); renderMasterView();
    toast(`${selectedIndices.length}件を移動しました` + (totalEmpsUpdated > 0 ? `（計${totalEmpsUpdated}名の履歴更新）` : ''));
    close();
  });
}

function syncMasterBulkToolbar() {
  const tb = document.getElementById('bulk-move-toolbar');
  const cnt = document.getElementById('bulk-move-cnt');
  if (!tb || !cnt) return;
  if (masterSelectedNodeIds.size > 0) {
    cnt.textContent = `${masterSelectedNodeIds.size}件選択中`;
    tb.classList.add('is-active');
  } else {
    tb.classList.remove('is-active');
  }
}

/* ----------------------------------------------------------------
   D&D ゾーン判定ヘルパー
   ヘッダー内の相対Y位置から drop mode を決定する。
   'top'   (上30%) : この前に挿入
   'into'  (中40%) : この子として追加（canAdopt=true の場合のみ）
   'bottom'(下30%) : この後に挿入
---------------------------------------------------------------- */
function _getDragDropMode(e, wrapEl, canAdopt) {
  const head = wrapEl.querySelector(':scope > .master-node-head');
  if (!head) return 'bottom';
  const { top, height } = head.getBoundingClientRect();
  const ratio = (e.clientY - top) / height;
  if (ratio < 0.3) return 'top';
  if (ratio > 0.7) return 'bottom';
  return canAdopt ? 'into' : 'bottom';
}

/* ----------------------------------------------------------------
   学校マスタへの自動登録（保存時連動用）
   mutates DB.masters.school — 呼び出し側で saveDB() を呼ぶこと
   戻り値: 登録した項目の説明文字列配列
---------------------------------------------------------------- */
function collectSchoolAutoRegister(schoolName, deptName) {
  if (!schoolName) return [];
  if (!DB.masters.school) DB.masters.school = [];
  const registered = [];
  const lv0 = DB.masterConfig.school?.levels?.[0]?.label || '学校';
  const lv1 = DB.masterConfig.school?.levels?.[1]?.label || '学部・研究科';
  const lv2 = DB.masterConfig.school?.levels?.[2]?.label || '学科・専攻';

  // 階層をまたいで学校ノードを検索（ラベルノード配下も対象）
  function findSchoolNodeAnywhere(nodes) {
    for (const n of nodes) {
      if (n.name === schoolName && !n.isGroup && n.nodeCategory !== 'label') return n;
      if (n.children?.length) { const f = findSchoolNodeAnywhere(n.children); if (f) return f; }
    }
    return null;
  }

  let schoolNode = findSchoolNodeAnywhere(DB.masters.school);
  if (!schoolNode) {
    schoolNode = { id: uid(), name: schoolName, children: [], nodeCategory: lv0, isGroup: false };
    DB.masters.school.push(schoolNode);
    registered.push(`${lv0}「${schoolName}」`);
  }

  const parts = deptName?.trim().split(/\s+/).filter(Boolean) || [];
  if (parts[0]) {
    const facName = parts[0];
    if (!schoolNode.children) schoolNode.children = [];
    let facNode = schoolNode.children.find(c => c.name === facName && !c.isGroup && c.nodeCategory !== 'label');
    if (!facNode) {
      facNode = { id: uid(), name: facName, children: [], nodeCategory: lv1, isGroup: false };
      schoolNode.children.push(facNode);
      registered.push(`${lv1}「${facName}」`);
    }

    if (parts[1]) {
      const depName = parts[1];
      if (!facNode.children) facNode.children = [];
      let depNode = facNode.children.find(c => c.name === depName);
      if (!depNode) {
        depNode = { id: uid(), name: depName, children: [], nodeCategory: lv2, isGroup: false };
        facNode.children.push(depNode);
        registered.push(`${lv2}「${depName}」`);
      }
    }
  }

  return registered;
}

/* ----------------------------------------------------------------
   会社マスタへの自動登録（保存時連動用）
   mutates DB.masters.company — 呼び出し側で saveDB() を呼ぶこと
   戻り値: 登録した項目の説明文字列配列
---------------------------------------------------------------- */
function collectCompanyAutoRegister(orgLevels) {
  if (!Array.isArray(orgLevels) || !orgLevels.length || !orgLevels[0]) return [];
  if (!DB.masters.company) DB.masters.company = [];
  const registered = [];

  // 名称マッチング（現在名・旧名称の両方を照合し、ツリーの分裂を防ぐ）
  const isNameMatch = (node, targetName) => {
    if (!node || !targetName) return false;
    if (node.name === targetName) return true;
    return !!(node.oldNames?.some(o => o.name === targetName));
  };

  // ① ルートノード（会社）の解決
  const rootName = String(orgLevels[0]).trim();
  if (!rootName) return [];

  let rootNode = DB.masters.company.find(n => isNameMatch(n, rootName));
  if (!rootNode) {
    rootNode = { id: uid(), name: rootName, children: [], nodeType: 'company', corporateEvents: [], oldNames: [] };
    DB.masters.company.push(rootNode);
    registered.push(`${getCompanyRootLabel(null)}「${rootName}」`);
  }

  const levels = getCompanyLevels(rootNode);
  let parentNode = rootNode;

  // ② 下位レベルを順次解決（入力パス通りに忠実に直下の子を走査・構築）
  // 階層マタギ探索はパスの不整合を招くため行わず、入力された階層構造を正として登録する
  for (let i = 1; i < orgLevels.length; i++) {
    const name = String(orgLevels[i] ?? '').trim();
    if (!name) break;
    if (!Array.isArray(parentNode.children)) parentNode.children = [];

    // 直下の子のみを検索
    let foundNode = parentNode.children.find(c => isNameMatch(c, name)) || null;

    if (!foundNode) {
      // 存在しない場合は直下の子として新規作成
      foundNode = { id: uid(), name, children: [], nodeType: 'department' };
      parentNode.children.push(foundNode);
      // rootNode(i=0) の直下が levels[0] に該当するため i-1 でラベルを取得
      const lv = levels[i - 1];
      registered.push(`${lv?.label || '部署'}「${name}」`);
    }

    parentNode = foundNode;
  }

  return registered;
}

/* ================================================================
   MASTER — EMPLOYEE COUNT HELPERS
================================================================ */
/*
  ツリー型マスタ（学校・会社）の指定ノード名に紐づく従業員数を返す
  school : emp.school（学校名）
  company: 異動履歴の最新 orgLevels[0]（会社名）
*/
function getMasterNodeEmpCount(type, nodeName, depth, nodeRef) {
  if (!nodeName) return 0;
  if (type === 'school') {
    if (nodeRef?.isGroup || nodeRef?.nodeCategory === 'label') {
      const targetSchools = new Set();
      const targetDepts = new Set();
      const lv0 = DB.masterConfig.school?.levels?.[0]?.label || '学校';
      const walk = (nodes) => {
        nodes.forEach(n => {
          if (!n.isGroup && n.nodeCategory !== 'label') {
            const cat = n.nodeCategory;
            if (!cat || cat === lv0) targetSchools.add(n.name);
            else targetDepts.add(n.name);
          }
          if (n.children) walk(n.children);
        });
      };
      walk(nodeRef.children || []);
      
      let count = 0;
      DB.employees.forEach(e => {
        if (e.school && targetSchools.has(e.school)) { count++; return; }
        if (e.eduDept) {
          const parts = e.eduDept.split(/\s+/);
          if (parts.some(p => targetDepts.has(p))) { count++; return; }
        }
      });
      return count;
    }
    const lv0 = DB.masterConfig.school?.levels?.[0]?.label || '学校';
    const cat  = nodeRef?.nodeCategory;
    if (!cat || cat === lv0) return DB.employees.filter(e => e.school === nodeName).length;
    return DB.employees.filter(e => e.eduDept && e.eduDept.split(/\s+/).includes(nodeName)).length;
  }
  if (type === 'company') {
    // nodeRef が渡された場合は旧名も含めて照合する
    const validNames = nodeRef ? getCompanyAllNames(nodeRef) : new Set([nodeName]);
    return DB.employees.filter(emp => {
      const transfers = emp.transfers || [];
      if (!transfers.length) return false;
      const state = getEmpActiveState(emp);
      return validNames.has(state.orgLevels[depth]);
    }).length;
  }
  return 0;
}

/* マスタ管理画面の登録数バッジ表示状態を同期 */
function syncMasterCountBadgeUI() {
  const scroll = document.getElementById('master-scroll');
  const btn    = document.getElementById('btn-master-cnt-toggle');
  const on     = DB.settings.masterCountBadge;
  if (scroll) scroll.classList.toggle('show-counts', on);
  if (btn) {
    btn.classList.toggle('is-active', on);
    btn.title = on ? '登録数バッジを非表示' : '登録数バッジを表示';
    btn.querySelector('.btn-mcb-label').textContent = on ? '登録数: ON' : '登録数: OFF';
  }
}

/* ================================================================
   MASTER — RENDER TREE
================================================================ */
function renderMasterView() {
  const isTag  = (currentMasterType === 'tag');
  const cfg    = getMasterCfg(currentMasterType);
  const isFlat = cfg?.isFlat;

  /* --- header / add-button --- */
  const titleEl    = document.getElementById('master-content-title');
  const cntBadge   = document.getElementById('master-cnt-badge');
  const addLbl     = document.getElementById('btn-master-add-root-lbl');
  const filterWrap = document.getElementById('master-filter-wrap');
  const levelCfgBtn= document.getElementById('btn-level-cfg');
  const levRow     = document.getElementById('master-levels-row');
  const tree       = document.getElementById('master-tree');
  const tagArea    = document.getElementById('tag-master-area');
  const sortBtns   = document.getElementById('master-sort-btns');

  const tlBar      = document.getElementById('company-timeline-bar');
  const badgeCtrl  = document.getElementById('company-badge-ctrl');

  // --- 各マスタごとの固有メニュー・表示状態の初期化・リセット ---
  if (currentMasterType !== 'company') {
    if (tlBar) tlBar.style.display = 'none';
    if (badgeCtrl) badgeCtrl.style.display = 'none';
    // 他マスタでフィルタ入力欄プレースホルダーをデフォルトに戻す
    const fi = document.getElementById('master-filter-input');
    if (fi) fi.placeholder = 'フィルタ…';
    _hideCompanySearchDD();
  }

  // ツリー型のみ: 再レンダリング前に展開状態を収集して保持
  if (!isTag && !isFlat && tree.style.display !== 'none') {
    masterExpandedIds = new Set();
    tree.querySelectorAll('.master-node.is-expanded').forEach(el => {
      if (el.dataset.nodeId) masterExpandedIds.add(el.dataset.nodeId);
    });
  }

  // タグマスタ
  if (isTag) {
    titleEl.innerHTML = '<i class="fa-solid fa-tags" style="color:var(--c-primary)"></i><span>タグマスタ</span>';
    titleEl.appendChild(cntBadge); 
    cntBadge.textContent = `(${DB.tags.length}件)`;
    addLbl.textContent = 'タグ追加';
    filterWrap.style.display = '';
    if (sortBtns) sortBtns.style.display = 'none';
    levelCfgBtn.style.display = 'none';
    levRow.style.display = 'none';
    tree.style.display = 'none';
    tagArea.style.display = '';
    renderTagMaster();
    return;
  }

  // flatマスタ（在籍状況・属性・入社区分・役職 など）
  if (isFlat) {
    titleEl.innerHTML = `<i class="${cfg.icon}" style="color:var(--c-primary)"></i><span>${cfg.label}</span>`;
    titleEl.appendChild(cntBadge); 
    const items = getFlatMasterItems(currentMasterType);
    cntBadge.textContent = `(${items.length}件)`;
    addLbl.textContent = `${cfg.itemLabel}を追加`;
    filterWrap.style.display = 'none';
    if (sortBtns) sortBtns.style.display = 'none';
    levelCfgBtn.style.display = 'none';
    levRow.style.display = 'none';
    tree.style.display = 'none';
    tagArea.style.display = 'none';
    renderFlatMasterView(currentMasterType, cfg);
    return;
  }

  // 会社マスタの場合は専用の組織図・履歴ビューへ
  if (currentMasterType === 'company') {
    if (tlBar) tlBar.style.display = '';
    // 検索ウィンドウを表示（会社マスタ専用）
    filterWrap.style.display = '';
    const filterInput = document.getElementById('master-filter-input');
    if (filterInput) {
      filterInput.placeholder = '会社・組織名で絞り込み…';
      filterInput.value = _companyFilterQuery;
      _updateMasterFilterClearBtn();
    }
    // バッジコントロールを表示
    if (badgeCtrl) badgeCtrl.style.display = '';
    levelCfgBtn.style.display = '';
    levelCfgBtn.title = 'デフォルト組織階層の設定（各会社で個別に上書き可能）';
    const levelCfgLblEl = levelCfgBtn.querySelector('.btn-lcfg-label');
    if (levelCfgLblEl) levelCfgLblEl.textContent = 'デフォルト階層設定';
    levRow.style.display = 'none';
    tagArea.style.display = 'none';
    tree.style.display = '';
    if (sortBtns) sortBtns.style.display = 'none';

    titleEl.innerHTML = `<i class="${cfg.icon}" style="color:var(--c-primary)"></i><span>${cfg.label}</span>`;
    titleEl.appendChild(cntBadge);
    cntBadge.textContent = `(${masterFlatten(DB.masters.company || []).length}件)`;

    renderCompanyMasterView();
    // バッジCSSクラスを tree に適用
    syncCompanyBadgeUI();
    // フィルタ再適用（再描画後に絞り込みを維持）
    if (_companyFilterQuery) applyCompanyFilter(_companyFilterQuery);
    return;
  }

  // 階層ツリーマスタ（学校等）
  const roots = DB.masters[currentMasterType] ||[];

  tree.style.display = '';
  tagArea.style.display = 'none';
  filterWrap.style.display = '';
  if (sortBtns) sortBtns.style.display = '';
  levelCfgBtn.style.display = '';
  levRow.style.display = '';

  titleEl.innerHTML = `<i class="${cfg.icon}" style="color:var(--c-primary)"></i><span>${cfg.label}</span>`;
  titleEl.appendChild(cntBadge); 
  cntBadge.textContent = `(${masterFlatten(roots).length}件)`;
  addLbl.textContent = cfg.addRootLabel;

  levRow.innerHTML = `<i class="fa-solid fa-layer-group"></i>階層構造：`;
  cfg.levels.forEach((lv, i) => {
    const badge = document.createElement('span');
    badge.className = 'master-level-badge';
    badge.textContent = `L${i+1}：${lv.label}`;
    levRow.appendChild(badge);
    if (i < cfg.levels.length - 1) {
      const sep = document.createElement('i');
      sep.className = 'fa-solid fa-angle-right master-level-sep';
      levRow.appendChild(sep);
    }
  });

  tree.innerHTML = '';
  if (!roots.length) {
    tree.innerHTML = `<div class="master-empty-state">
      <i class="fa-solid fa-folder-open"></i>
      <p>まだデータがありません。「${cfg.addRootLabel}」から登録してください。</p></div>`;
    return;
  }
  roots.forEach(root => tree.appendChild(buildMasterNodeEl(root, 0, '')));

  const q = (document.getElementById('master-filter-input')?.value || '').trim();
  if (q) applyMasterFilter(q);
}

/* ================================================================
   MASTER — FLAT TYPE RENDER
================================================================ */
function renderFlatMasterView(type, cfg) {
  const scroll = document.getElementById('master-scroll');
  document.getElementById('master-tree').style.display   = 'none';
  document.getElementById('tag-master-area').style.display = 'none';
  const levRow2 = document.getElementById('master-levels-row');
  if (levRow2) levRow2.style.display = 'none';

  let flatArea = document.getElementById('flat-master-area');
  if (!flatArea) {
    flatArea = document.createElement('div');
    flatArea.id = 'flat-master-area';
    scroll.appendChild(flatArea);
  }
  flatArea.style.display = '';
  flatArea.innerHTML = '';

  const items = getFlatMasterItems(type);

  if (!items.length) {
    flatArea.innerHTML = `<div class="flat-master-empty">
      <i class="${cfg.icon}"></i>
      <p>まだデータがありません。「${cfg.itemLabel}を追加」から登録してください。</p>
    </div>`;
    return;
  }

  // 使い方テキスト
  const help = document.createElement('div');
  help.className = 'flat-master-help';
  help.innerHTML = '<i class="fa-solid fa-circle-info"></i>アイテムをドラッグ＆ドロップして、分布表示（バタフライチャート）での左右の配置と、マスター上の表示順序を設定します。';
  flatArea.appendChild(help);

  // カンバンボードUIの構築
  const board = document.createElement('div');
  board.className = 'flat-master-board';

  const cols =[
    { id: 'left', title: '左側に配置', icon: 'fa-solid fa-arrow-left', color: '#10B981', items: items.filter(i => i.splitSide === 'left') },
    { id: '', title: '配置しない（中央）', icon: 'fa-solid fa-minus', color: '#94A3B8', items: items.filter(i => i.splitSide !== 'left' && i.splitSide !== 'right') },
    { id: 'right', title: '右側に配置', icon: 'fa-solid fa-arrow-right', color: '#F59E0B', items: items.filter(i => i.splitSide === 'right') }
  ];

  cols.forEach(colData => {
    const col = document.createElement('div');
    col.className = 'flat-master-col';
    
    const hdr = document.createElement('div');
    hdr.className = 'flat-master-col-hdr';
    hdr.style.borderTop = `3px solid ${colData.color}`;
    hdr.innerHTML = `<span><i class="${colData.icon}" style="color:${colData.color};margin-right:6px"></i>${colData.title}</span><span class="flat-master-col-cnt">${colData.items.length}</span>`;
    
    const body = document.createElement('div');
    body.className = 'flat-master-col-body';
    body.dataset.side = colData.id;

    // D&D Event Listeners for body
    body.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      body.classList.add('drag-over');
    });
    body.addEventListener('dragleave', () => {
      body.classList.remove('drag-over');
    });
    body.addEventListener('drop', e => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const itemId = e.dataTransfer.getData('text/plain');
      if (!itemId) return;

      const arr = DB.masters[type];
      const itemIndex = arr.findIndex(i => i.id === itemId);
      if (itemIndex === -1) return;

      // Drop position calculation
      const cards = [...body.querySelectorAll('.flat-master-card:not(.is-dragging)')];
      const afterElement = cards.find(c => {
        const box = c.getBoundingClientRect();
        return e.clientY < box.top + box.height / 2;
      });

      const item = arr[itemIndex];
      item.splitSide = colData.id;

      // Extract and Insert
      arr.splice(itemIndex, 1);
      if (afterElement) {
        const afterId = afterElement.dataset.id;
        const afterIdx = arr.findIndex(i => i.id === afterId);
        if (afterIdx > -1) {
          arr.splice(afterIdx, 0, item);
        } else {
          arr.push(item);
        }
      } else {
        arr.push(item);
      }

      saveDB();
      renderMasterView();
      refreshAll(); // To update distribution view if open
    });

    colData.items.forEach(item => {
      const card = createFlatMasterCard(item, type);
      body.appendChild(card);
    });

    col.appendChild(hdr);
    col.appendChild(body);
    board.appendChild(col);
  });

  flatArea.appendChild(board);
}

function createFlatMasterCard(item, type) {
  const card = document.createElement('div');
  card.className = 'flat-master-card';
  card.dataset.id = item.id;
  card.draggable = true;
  card.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('is-dragging'), 0);
  });
  card.addEventListener('dragend', () => card.classList.remove('is-dragging'));

  const dot = document.createElement('div');
  dot.className = 'flat-master-color';
  if (!item.color) {
    dot.classList.add('clr-none');
  } else {
    dot.style.background = item.color;
  }

  const info = document.createElement('div');
  info.className = 'flat-master-info';
  
  const nm = document.createElement('span');
  nm.className = 'flat-master-name';
  nm.textContent = item.name;

  let iconHtml = '';
  if (item.icon) iconHtml = `<i class="${item.icon}"></i>`;

  info.innerHTML = `${iconHtml}`;
  info.appendChild(nm);

  // 登録数バッジ（show-counts クラスで表示制御）
  const cntEl = document.createElement('span');
  cntEl.className = 'flat-master-emp-count master-item-count';
  const empCnt = getFlatMasterEmpCount(type, item.name);
  cntEl.textContent = empCnt + '名';
  if (empCnt === 0) cntEl.dataset.zero = 'true';
  info.appendChild(cntEl);

  const acts = document.createElement('div');
  acts.className = 'flat-master-acts';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost btn-icon-sm';
  editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
  editBtn.title = '編集';
  editBtn.addEventListener('click', () => openFlatMasterModal(type, item.id));

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-ghost btn-icon-sm';
  delBtn.style.color = 'var(--c-danger)';
  delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
  delBtn.title = '削除';
  delBtn.addEventListener('click', () => {
    const empField = FLAT_MASTER_EMP_FIELDS[type];
    const usedCount = empField
      ? DB.employees.filter(e => e[empField] === item.name).length
      : 0;
    const usedMsg = usedCount > 0
      ? `\n※ ${usedCount}名の従業員の${getMasterCfg(type).label}が「未設定」になります。`
      : '';
    openConfirm(`「${item.name}」を削除しますか？${usedMsg}`, () => {
      // 従業員フィールドをクリア（連動）
      if (empField && usedCount > 0) syncEmpFlatMasterField(type, item.name, '');
      DB.masters[type] = DB.masters[type].filter(i => i.id !== item.id);
      saveDB(); closeModal('confirm-modal'); renderMasterView(); refreshAll();
      toast(`「${item.name}」を削除しました${usedCount > 0 ? `（従業員 ${usedCount}名 の${getMasterCfg(type).label}をクリア）` : ''}`);
    }, { title:'削除の確認', icon:'fa-solid fa-triangle-exclamation', iconColor:'var(--c-danger)',
         innerIcon:'fa-solid fa-trash-can', innerColor:'var(--c-danger)',
         okLabel:'削除する', okIcon:'fa-solid fa-trash-can', okClass:'btn btn-danger' });
  });

  acts.append(editBtn, delBtn);
  card.append(dot, info, acts);
  
  return card;
}

/* ----------------------------------------------------------------
   モーダルの条件付き表示行を全てデフォルト（非表示）にリセット
   会社マスタ専用フィールドが他マスタ開放時に残存するバグを防ぐ
   openFlatMasterModal / openMasterNodeModal の冒頭で必ず呼ぶこと
---------------------------------------------------------------- */
function _resetMnmConditionalRows() {
  const IDS = [
    'mnm-address-row',       // 住所
    'mnm-is-group-row',      // グループ化フラグ（フォルダ）
    'mnm-node-type-row',     // ノード種別
    'mnm-company-dates-row', // 存在期間（設立日・解散日）
    'mnm-oldnames-row',      // 名称変更履歴
    'mnm-color-row',         // カラー設定
    'mnm-icon-row',          // アイコン設定
  ];
  IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

/* flatマスタモーダルを開く */
function openFlatMasterModal(type, itemId = null) {
  // 前回の会社マスタ専用フィールドが残存しないよう全行をリセット
  _resetMnmConditionalRows();

  document.getElementById('master-node-modal')?.classList.remove('is-company-mode');
  document.getElementById('mnm-tabs').style.display = 'none';
  document.getElementById('mnm-pane-basic').classList.add('is-active');
  document.getElementById('mnm-pane-events').classList.remove('is-active');

  const cfg  = getMasterCfg(type);
  const item = itemId ? (DB.masters[type] ||[]).find(i => i.id === itemId) : null;

  document.getElementById('mnm-type').value  = type;
  document.getElementById('mnm-id').value    = itemId || '';
  document.getElementById('mnm-parent-id').value = '';
  document.getElementById('mnm-level').value = 0;
  document.getElementById('mnm-title').textContent = item ? `「${cfg.itemLabel}」を編集` : `${cfg.itemLabel}を追加`;
  document.getElementById('mnm-name-lbl').innerHTML = `${cfg.itemLabel}名<span class="req">*</span>`;
  document.getElementById('mnm-name').placeholder = '';
  document.getElementById('mnm-name').value = item?.name || '';

  // カラー行を表示
  const colorRow = document.getElementById('mnm-color-row');
  colorRow.style.display = '';
  const initClr = item ? (item.color ?? '') : '';
  const colorEl = document.getElementById('mnm-color');
  colorEl.value = initClr || '#6366F1';
  if (initClr === '') {
    colorEl.dataset.noColor = 'true';
  } else {
    delete colorEl.dataset.noColor;
  }
  buildMnmClrPresets(initClr);

  // アイコン行を表示
  const iconRow = document.getElementById('mnm-icon-row');
  iconRow.style.display = '';
  const initIcon = item?.icon || '';
  document.getElementById('mnm-icon-val').value = initIcon;
  buildMnmIconPresets(initIcon);

  updateMnmColorPreview(initClr, document.getElementById('mnm-name').value || cfg.itemLabel, initIcon);

  _clearMnmFieldErrs();
  openModal('master-node-modal');
  setTimeout(() => document.getElementById('mnm-name').focus(), 60);
}

function buildMnmClrPresets(selected) {
  const box = document.getElementById('mnm-clr-presets');
  if (!box) return;
  box.innerHTML = '';

  // 「背景なし（白）」ドットを先頭に追加
  const noneDot = document.createElement('div');
  noneDot.className = `clr-dot clr-none${selected === '' ? ' is-sel' : ''}`;
  noneDot.title = '背景なし（白）';
  noneDot.addEventListener('click', () => {
    box.querySelectorAll('.clr-dot').forEach(d => d.classList.remove('is-sel'));
    noneDot.classList.add('is-sel');
    document.getElementById('mnm-color').dataset.noColor = 'true';
    updateMnmColorPreview('', document.getElementById('mnm-name').value);
  });
  box.appendChild(noneDot);

  // 淡色パレットと標準色を分けてセパレータを挿入
  const PASTEL_COUNT = 14; // PRESET_CLRの先頭14個が淡色
  PRESET_CLR.forEach((clr, idx) => {
    if (idx === PASTEL_COUNT) {
      const sep = document.createElement('div');
      sep.className = 'clr-sep';
      sep.title = '標準色';
      box.appendChild(sep);
    }
    const dot = document.createElement('div');
    dot.className = `clr-dot${clr === selected ? ' is-sel' : ''}`;
    dot.style.background = clr;
    dot.addEventListener('click', () => {
      box.querySelectorAll('.clr-dot').forEach(d => d.classList.remove('is-sel'));
      dot.classList.add('is-sel');
      const colorEl = document.getElementById('mnm-color');
      colorEl.value = clr;
      delete colorEl.dataset.noColor;
      updateMnmColorPreview(clr, document.getElementById('mnm-name').value);
    });
    box.appendChild(dot);
  });
  document.getElementById('mnm-color').oninput = e => {
    box.querySelectorAll('.clr-dot').forEach(d => d.classList.remove('is-sel'));
    delete e.target.dataset.noColor;
    const v = e.target.value;
    const i = PRESET_CLR.indexOf(v);
    if (i >= 0) {
      const dots = box.querySelectorAll('.clr-dot:not(.clr-none)');
      dots[i]?.classList.add('is-sel');
    }
    updateMnmColorPreview(v, document.getElementById('mnm-name').value, document.getElementById('mnm-icon-val')?.value);
  };
  // addEventListener ではなく oninput 代入にして、モーダルを繰り返し開く際の
  // リスナー多重登録（メモリリーク）を防ぐ
  document.getElementById('mnm-name').oninput = e => {
    updateMnmColorPreview(document.getElementById('mnm-color').value, e.target.value, document.getElementById('mnm-icon-val')?.value);
  };
}

function buildMnmIconPresets(selected) {
  const box = document.getElementById('mnm-icon-presets');
  if (!box) return;
  box.innerHTML = '';
  
  const noneDot = document.createElement('div');
  noneDot.className = `icon-dot${!selected ? ' is-sel' : ''}`;
  noneDot.title = 'アイコンなし';
  noneDot.innerHTML = '<i class="fa-solid fa-ban" style="opacity:0.4;"></i>';
  noneDot.addEventListener('click', () => {
    document.querySelectorAll('#mnm-icon-presets .icon-dot').forEach(d => d.classList.remove('is-sel'));
    noneDot.classList.add('is-sel');
    document.getElementById('mnm-icon-val').value = '';
    updateMnmColorPreview(document.getElementById('mnm-color').value, document.getElementById('mnm-name').value, '');
  });
  box.appendChild(noneDot);

  PRESET_ICONS.forEach(iconCls => {
    const dot = document.createElement('div');
    dot.className = `icon-dot${iconCls === selected ? ' is-sel' : ''}`;
    dot.innerHTML = `<i class="${iconCls}"></i>`;
    dot.addEventListener('click', () => {
      document.querySelectorAll('#mnm-icon-presets .icon-dot').forEach(d => d.classList.remove('is-sel'));
      dot.classList.add('is-sel');
      document.getElementById('mnm-icon-val').value = iconCls;
      updateMnmColorPreview(document.getElementById('mnm-color').value, document.getElementById('mnm-name').value, iconCls);
    });
    box.appendChild(dot);
  });
}

function updateMnmColorPreview(color, name, icon) {
  const prev = document.getElementById('mnm-color-preview');
  if (!prev) return;
  if (name) {
    if (color) {
      prev.style.background = color;
      prev.style.color      = '';
      prev.style.border     = `1px solid ${lighten(color, 0.5)}`;
    } else {
      // 背景なし（白）
      prev.style.background = '#fff';
      prev.style.color      = '';
      prev.style.border     = '1px solid var(--c-border-d)';
    }
    const iconVal = icon !== undefined ? icon : document.getElementById('mnm-icon-val')?.value;
    const iconHtml = iconVal ? `<i class="${iconVal}" style="margin-right:4px;"></i>` : '';
    prev.innerHTML = `${iconHtml}${name}`;
  } else {
    prev.style.background = ''; prev.style.color = ''; prev.innerHTML = '';
  }
}

/* フィルタ適用（ツリー向け） */
function applyMasterFilter(q) {
  const tree = document.getElementById('master-tree');
  if (!tree) return;
  const nodes = tree.querySelectorAll('.master-node');
  nodes.forEach(n => {
    n.classList.remove('is-filtered-out','filter-match');
    n.style.display = '';
  });
  
  // ハイライトリセット
  nodes.forEach(n => {
    const nameEl = n.querySelector(':scope > .master-node-head .master-node-name');
    if (nameEl && nameEl.dataset.origText) {
      nameEl.innerHTML = nameEl.dataset.origText;
    }
  });

  if (!q) return;
  const ql = q.toLowerCase();
  nodes.forEach(n => {
    const nameEl = n.querySelector(':scope > .master-node-head .master-node-name');
    if (!nameEl) return;
    if (!nameEl.dataset.origText) nameEl.dataset.origText = nameEl.innerHTML;
    
    const nm = nameEl.textContent || '';
    const match = nm.toLowerCase().includes(ql) || _fuzzyScore(ql, nm) > 0.35;
    
    if (match) {
      n.classList.add('filter-match');
      if (typeof highlightHTMLText === 'function') {
        nameEl.innerHTML = highlightHTMLText(nameEl.dataset.origText, q);
      }
    }
  });
  // 非マッチノードで子孫にマッチがなければ非表示
  // 葉から処理: 深いものから
  const allNodes = [...nodes].reverse();
  allNodes.forEach(n => {
    if (n.classList.contains('filter-match')) {
      n.classList.remove('is-filtered-out');
      n.style.display = '';
      return;
    }
    const hasMatchDescendant = n.querySelector('.filter-match');
    if (!hasMatchDescendant) {
      n.classList.add('is-filtered-out');
      n.style.display = 'none';
    } else {
      n.classList.remove('is-filtered-out');
      n.style.display = '';
    }
  });
}

/* タグフィルタ適用 */
function applyTagFilter(q) {
  const grid = document.getElementById('tag-grid');
  if (!grid) return;
  const cards = grid.querySelectorAll('.tag-card');
  const ql = q.toLowerCase();
  cards.forEach(c => {
    const nm = c.querySelector('.tag-card-name')?.textContent?.toLowerCase() || '';
    c.classList.toggle('is-filtered-out', ql !== '' && !nm.includes(ql));
  });
}

/** 指定ノードからルートまで遡り、ラベルノードを除外した実効的な深さを計算する */
function _getEffectiveDepth(nodeId, type) {
  if (!nodeId) return 0;
  const roots = DB.masters[type] || [];
  const path = masterGetNodePath(type, nodeId);
  if (!path) return 0;
  let effDepth = 0;
  function walk(nodes, targetId, currentEffDepth) {
    for (const n of nodes) {
      if (n.id === targetId) return n.isGroup || n.nodeCategory === 'label' ? currentEffDepth : currentEffDepth + 1;
      if (n.children?.length) {
        const nextDepth = currentEffDepth + (n.isGroup || n.nodeCategory === 'label' ? 0 : 1);
        const res = walk(n.children, targetId, nextDepth);
        if (res !== -1) return res;
      }
    }
    return -1;
  }
  const result = walk(roots, nodeId, 0);
  return result > 0 ? result : 0;
}

/*
  parentId: このノードが属する親ノードのID（ルートなら空文字）
  D&D は同一parentId を持つ兄弟間のみ許可
*/
function buildMasterNodeEl(node, depth, parentId = '') {
  const cfg      = MASTER_CFG[currentMasterType];
  // 学校マスタの場合はラベルをスキップした実効深さを計算
  const effDepth = currentMasterType === 'school' ? _getEffectiveDepth(parentId, currentMasterType) : depth;
  const lv       = cfg.levels[effDepth] || cfg.levels[cfg.levels.length - 1];
  const maxDepth = cfg.levels.length - 1;
  const childrenArr = node.children || [];
  const hasChildren = childrenArr.length > 0;

  // デフォルト折りたたみ：masterExpandedIds に含まれる場合のみ展開
  const isExpanded = hasChildren && masterExpandedIds.has(node.id);

  const wrap = document.createElement('div');
  wrap.className = 'master-node' + (isExpanded ? ' is-expanded' : '');
  wrap.dataset.nodeId   = node.id;
  wrap.dataset.parentId = parentId;
  wrap.dataset.depth    = depth;

  /* ── ドラッグハンドル ── */
  const dragHandle = document.createElement('span');
  dragHandle.className = 'master-node-drag';
  dragHandle.title = 'ドラッグして移動・並び替え';
  dragHandle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';

  /* ── 複数選択チェックボックス ── */
  const chkWrap = document.createElement('label');
  chkWrap.className = 'master-node-chk-wrap';
  chkWrap.addEventListener('click', e => e.stopPropagation());
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.className = 'master-node-chk';
  chk.checked = masterSelectedNodeIds.has(node.id);
  chk.addEventListener('change', e => {
    if (e.target.checked) masterSelectedNodeIds.add(node.id);
    else masterSelectedNodeIds.delete(node.id);
    syncMasterBulkToolbar();
  });
  chkWrap.appendChild(chk);

  /* ── 展開トグル ── */
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'master-node-toggle' + (!hasChildren || depth >= maxDepth ? ' is-leaf' : '');
  toggle.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const expanded = wrap.classList.toggle('is-expanded');
    if (expanded) masterExpandedIds.add(node.id);
    else          masterExpandedIds.delete(node.id);
  });

  const icon = document.createElement('i');
  icon.className = `master-node-icon ${lv.icon}`;

  const nameEl = document.createElement('span');
  nameEl.className = 'master-node-name';
  nameEl.textContent = node.name;

  const lvBadge = document.createElement('span');
  lvBadge.className = 'master-node-level-badge';
  lvBadge.textContent = (node.nodeCategory && node.nodeCategory !== 'label') ? node.nodeCategory : lv.label;

  // 登録数バッジ（ラベルの場合は常時表示かつ展開時非表示、それ以外はshow-countsで表示制御）
  const cntBadgeEl = document.createElement('span');
  const isLabelNode = node.isGroup || node.nodeCategory === 'label';
  cntBadgeEl.className = isLabelNode 
    ? 'master-node-emp-count master-label-count' 
    : 'master-node-emp-count master-item-count';
  const empCnt = getMasterNodeEmpCount(currentMasterType, node.name, depth, node);
  cntBadgeEl.textContent = empCnt + '名';
  if (empCnt === 0) cntBadgeEl.dataset.zero = 'true';

  const headMiddle = document.createElement('div');
  headMiddle.style.display = 'flex';
  headMiddle.style.alignItems = 'center';
  headMiddle.style.gap = '6px';
  headMiddle.style.marginRight = 'auto';

  if (node.address) {
    const addrBadge = document.createElement('span');
    addrBadge.className = 'master-node-address-badge';
    addrBadge.style.fontSize = '10px';
    addrBadge.style.color = 'var(--c-text-3)';
    addrBadge.style.display = 'inline-flex';
    addrBadge.style.alignItems = 'center';
    addrBadge.style.gap = '3px';
    addrBadge.style.maxWidth = '180px';
    addrBadge.style.overflow = 'hidden';
    addrBadge.style.textOverflow = 'ellipsis';
    addrBadge.style.whiteSpace = 'nowrap';
    const iconHtml = node.manualLocation 
      ? `<i class="fa-solid fa-map-pin" style="color:var(--c-warn)"></i>` 
      : `<i class="fa-solid fa-location-dot"></i>`;
    addrBadge.innerHTML = `${iconHtml}${node.address}`;
    addrBadge.title = node.manualLocation ? `[座標調整済み] ${node.address}` : node.address;
    headMiddle.appendChild(addrBadge);
  }

  const acts = document.createElement('div');
  acts.className = 'master-node-acts';

  // ラベルノード自身を追加する場合は実効深さをそのまま使い、通常のノードなら+1する
  const nextEffDepth = currentMasterType === 'school'
    ? (node.isGroup || node.nodeCategory === 'label' ? effDepth : effDepth + 1)
    : depth + 1;

  if ((currentMasterType === 'school' && nextEffDepth <= maxDepth) || (currentMasterType !== 'school' && depth < maxDepth)) {
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'master-node-btn';
    const nextLabel = cfg.levels[nextEffDepth]?.label || '項目';
    addBtn.innerHTML = `<i class="fa-solid fa-plus"></i>${nextLabel}を追加`;
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      openMasterNodeModal(currentMasterType, null, node.id, depth + 1);
    });
    acts.appendChild(addBtn);
  }

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'master-node-btn';
  editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
  editBtn.title = '編集';
  editBtn.addEventListener('click', e => {
    e.stopPropagation();
    openMasterNodeModal(currentMasterType, node.id, null, depth);
  });

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'master-node-btn del';
  delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
  delBtn.title = '削除';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    const childCount = masterFlatten(node.children || []).length;
    const msg = childCount
      ? `「${node.name}」とその配下 ${childCount} 件をすべて削除しますか？`
      : `「${node.name}」を削除しますか？`;
    openConfirm(msg, () => {
      masterDeleteNode(DB.masters[currentMasterType], node.id);
      saveDB();
      closeModal('confirm-modal');
      renderMasterView();
      toast(`「${node.name}」を削除しました`);
    }, { title: '削除の確認', icon: 'fa-solid fa-triangle-exclamation', iconColor: 'var(--c-danger)',
         innerIcon: 'fa-solid fa-trash-can', innerColor: 'var(--c-danger)',
         okLabel: '削除する', okIcon: 'fa-solid fa-trash-can', okClass: 'btn btn-danger' });
  });

  acts.append(editBtn, delBtn);

    if (node.isGroup || node.nodeCategory === 'label') {
      wrap.classList.add('is-master-group');
      lvBadge.textContent = 'ラベル（分類）';
      lvBadge.style.background = '';
      lvBadge.style.color = '';
      lvBadge.style.borderColor = '';
    }

    /* ── ヘッド組み立て ── */
    const head = document.createElement('div');
    head.className = 'master-node-head';
    head.append(dragHandle, chkWrap, toggle, icon, nameEl, lvBadge, cntBadgeEl, headMiddle);

    // ダブルクリックで編集モードへ移行（ボタン等を除外）
    head.addEventListener('dblclick', e => {
      if (e.target.closest('button') || e.target.closest('.master-node-drag')) return;
      e.stopPropagation();
      openMasterNodeModal(currentMasterType, node.id, parentId, depth, null);
    });

    /* ── 会社・学校ルート：階層構造インジケーター ── */
    if ((currentMasterType === 'company' || currentMasterType === 'school') && (node.foundedDate || node.dissolvedDate)) {
      const today       = new Date().toISOString().slice(0, 10);
      const isDissolved = !!(node.dissolvedDate && _normDate(node.dissolvedDate, true) < today);
      if (isDissolved) wrap.classList.add('is-dissolved');
      const dateBadge = document.createElement('span');
      dateBadge.className = 'master-node-dates-badge' + (isDissolved ? ' is-dissolved' : '');
      const fd = _fmtDate(node.foundedDate) || '—';
      const dd = node.dissolvedDate ? _fmtDate(node.dissolvedDate) : '現在';
      dateBadge.innerHTML = `<i class="fa-solid fa-calendar-range"></i>${fd}〜${dd}`;
      head.appendChild(dateBadge);
    }

    head.appendChild(acts);
    wrap.appendChild(head);

  /* ── D&D（クロス階層対応） ── */
  head.addEventListener('mousedown', e => {
    if (e.target.closest('button, input, label.master-node-chk-wrap')) return;
    wrap.draggable = true;
  });

  wrap.addEventListener('dragstart', e => {
    e.stopPropagation();
    if (!masterSelectedNodeIds.has(node.id)) {
      _mDragIds = [node.id];
    } else {
      _mDragIds = Array.from(masterSelectedNodeIds);
    }
    _mDragParentId = parentId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);
    setTimeout(() => wrap.classList.add('is-dragging'), 0);
  });

  wrap.addEventListener('dragend', e => {
    e.stopPropagation();
    wrap.draggable = false;
    wrap.classList.remove('is-dragging');
    clearAllDragIndicators();
    _mDragIds = []; _mDragParentId = null;
  });

  wrap.addEventListener('dragover', e => {
    if (_mDragIds.length === 0 || _mDragIds.includes(node.id)) return;
    // 循環参照ガード：ドラッグ中ノードの子孫にはドロップ不可
    if (_mDragIds.some(id => masterIsDescendantOf(currentMasterType, id, node.id))) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const canAdopt = depth < maxDepth;
    const mode = _getDragDropMode(e, wrap, canAdopt);
    clearAllDragIndicators();
    wrap.dataset.dropMode = mode;
    if      (mode === 'top')    wrap.classList.add('drag-over-top');
    else if (mode === 'bottom') wrap.classList.add('drag-over-bottom');
    else                        wrap.classList.add('drag-over-into');
  });

  wrap.addEventListener('dragleave', e => {
    if (!wrap.contains(e.relatedTarget)) {
      wrap.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-into');
      delete wrap.dataset.dropMode;
    }
  });

  wrap.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation();
    if (_mDragIds.length === 0 || _mDragIds.includes(node.id)) return;
    if (_mDragIds.some(id => masterIsDescendantOf(currentMasterType, id, node.id))) return;

    const mode = wrap.dataset.dropMode || 'bottom';
    clearAllDragIndicators();

    let targetParentId = null;
    let insertBeforeId = null;
    let insertAfter = false;

    if (mode === 'into') {
      targetParentId = node.id;
      insertBeforeId = null;
    } else {
      targetParentId = parentId || null;
      insertBeforeId = node.id;
      insertAfter = (mode === 'bottom');
    }

    _triggerBulkMasterMoveWithConfirm(currentMasterType, _mDragIds, targetParentId, insertBeforeId, insertAfter);
  });

  /* ── Children container ── */
  if ((currentMasterType === 'school' && nextEffDepth <= maxDepth) || (currentMasterType !== 'school' && depth < maxDepth)) {
    const childWrap = document.createElement('div');
    childWrap.className = 'master-node-children';

    childrenArr.forEach(child => {
      childWrap.appendChild(buildMasterNodeEl(child, depth + 1, node.id));
    });

    const addChildBtn = document.createElement('button');
    addChildBtn.type = 'button';
    addChildBtn.className = 'master-node-add-btn';
    const nextLvLabel2 = cfg.levels[nextEffDepth]?.label || '項目';
    addChildBtn.innerHTML = `<i class="fa-solid fa-plus"></i>${nextLvLabel2}を追加`;
    addChildBtn.addEventListener('click', () => {
      openMasterNodeModal(currentMasterType, null, node.id, depth + 1);
    });
    childWrap.appendChild(addChildBtn);
    wrap.appendChild(childWrap);
  }

  return wrap;
}

/* ----------------------------------------------------------------
   会社マスタモーダル用エラー表示 ── モーダル上部の固定バーに表示
   レイアウトを一切変えない設計
---------------------------------------------------------------- */
function _showMnmFieldErr(fieldEl, msg, scroll = true) {
  if (!fieldEl) return;
  // フィールドをエラー色に
  fieldEl.classList.add('is-mnm-err');
  fieldEl.addEventListener('input', () => {
    fieldEl.classList.remove('is-mnm-err');
    _hideMnmErrBar();
  }, { once: true });
  // エラーバーを表示
  const bar = document.getElementById('mnm-err-bar');
  if (bar) {
    bar.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><span>${msg}</span>`;
    bar.classList.add('is-visible');
  }
  if (scroll) fieldEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  fieldEl.focus();
}

function _hideMnmErrBar() {
  const bar = document.getElementById('mnm-err-bar');
  if (bar) bar.classList.remove('is-visible');
}

function _clearMnmFieldErrs() {
  _hideMnmErrBar();
  document.querySelectorAll('#master-node-modal .is-mnm-err').forEach(el => el.classList.remove('is-mnm-err'));
}

/* ----------------------------------------------------------------
   名称変更履歴 行を1件追加（会社マスタ編集モーダル用）
---------------------------------------------------------------- */
function _addOldNameRow(list, name, untilDate) {
  const row = document.createElement('div');
  row.className = 'mnm-oldname-item';
  row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
  const nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.className = 'finput old-name-input';
  nameInp.placeholder = '旧名称（例：旧○○課）';
  nameInp.value = name || '';
  nameInp.style.flex = '1';
  const label = document.createElement('span');
  label.style.cssText = 'font-size:11px;color:var(--c-text-3);white-space:nowrap';
  label.textContent = '〜';

  // 日付フィールドを hire-wrap でラップし、btn-cal を追加
  const dateWrap = document.createElement('div');
  dateWrap.className = 'hire-wrap';
  dateWrap.style.cssText = 'width:160px;flex-shrink:0';
  const dateInp = document.createElement('input');
  dateInp.type = 'text';
  dateInp.className = 'finput old-date-input flex-date-input';
  dateInp.value = untilDate || '';
  dateInp.placeholder = '2020-04';
  dateInp.title = 'この旧名称が使われていた最終日（YYYY / YYYY-MM / YYYY-MM-DD）';
  dateInp.setAttribute('autocomplete', 'off');
  dateInp.setAttribute('spellcheck', 'false');
  dateInp.setAttribute('autocorrect', 'off');
  dateInp.setAttribute('autocapitalize', 'off');
  dateInp.setAttribute('data-lpignore', 'true');
  dateInp.setAttribute('data-1p-ignore', 'true');
  dateInp.style.minWidth = '0';
  const calBtn = document.createElement('button');
  calBtn.type = 'button';
  calBtn.className = 'btn-cal';
  calBtn.title = 'カレンダーで選択';
  calBtn.innerHTML = '<i class="fa-solid fa-calendar-days"></i>';
  dateWrap.append(dateInp, calBtn);

  // FlexDatePicker をアタッチ（btn-cal は hire-wrap 内を自動検索）
  if (typeof FlexDatePicker !== 'undefined') {
    const nf = s => (typeof normalizeFlexDate === 'function' ? normalizeFlexDate(s) : s);
    new FlexDatePicker(dateInp, { minPrec: 'year', maxPrec: 'month', normalize: nf });
  }

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'btn btn-ghost btn-icon-sm';
  delBtn.style.color = 'var(--c-danger)';
  delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  delBtn.title = '削除';
  delBtn.addEventListener('click', () => row.remove());
  row.append(nameInp, label, dateWrap, delBtn);
  list.appendChild(row);
}

/* ================================================================
   MASTER — OPEN/SAVE NODE MODAL
================================================================ */
/**
 * 任意の会社ノードID（または子孫ノードのID）から会社ルートノードを返す。
 * ルートの直接IDでも、深い子孫のIDでも対応。
 */
function _findCompanyRootByDescendant(anyId) {
  if (!anyId) return null;
  for (const root of (DB.masters.company || [])) {
    if (root.id === anyId) return root;
    if (masterFindNode(root.children || [], anyId)) return root;
  }
  return null;
}

function openMasterNodeModal(type, nodeId, parentId, depth, rootNode = null) {
  _resetMnmConditionalRows();

  const cfg = getMasterCfg(type);
  if (cfg?.isFlat) { openFlatMasterModal(type, nodeId); return; }

  const node = nodeId ? masterFindNode(DB.masters[type], nodeId) : null;
  const modalEl = document.getElementById('master-node-modal');
  const tabsEl = document.getElementById('mnm-tabs');
  
  document.getElementById('mnm-type').value      = type;
  document.getElementById('mnm-id').value        = nodeId || '';
  document.getElementById('mnm-parent-id').value = parentId || '';
  document.getElementById('mnm-level').value     = depth;

  let levels = cfg.levels;
  let rootLabel = '項目';

  if (type === 'company' || type === 'school') {
    modalEl.classList.add('is-company-mode');
    tabsEl.style.display = '';
    // タブを初期状態（基本情報）にリセット
    document.querySelectorAll('#mnm-tabs .modal-tab').forEach((t, i) => t.classList.toggle('is-active', i === 0));
    document.querySelectorAll('#master-node-modal .modal-tab-pane').forEach((p, i) => p.classList.toggle('is-active', i === 0));

    if (type === 'company') {
      const root = rootNode || _findCompanyRootByDescendant(nodeId || parentId);
      if (root) levels = getCompanyLevels(root);
      rootLabel = depth === 0 ? getCompanyRootLabel(root || node) : (levels[depth - 1]?.label || '組織');
    } else {
      const effDepth = _getEffectiveDepth(parentId, type);
      if (node) {
        rootLabel = node.isGroup
          ? 'ラベル（分類フォルダ）'
          : (node.nodeCategory && node.nodeCategory !== 'label' ? node.nodeCategory : (levels[effDepth]?.label || '項目'));
      } else {
        rootLabel = levels[effDepth]?.label || '項目';
      }
    }

    // 住所表示
    const addrRow = document.getElementById('mnm-address-row');
    if (addrRow) {
      addrRow.style.display = '';
      const addrInp = document.getElementById('mnm-address');
      if (addrInp) addrInp.value = node?.address || '';
      const geoSt = document.getElementById('mnm-geo-status');
      if (geoSt) { geoSt.style.display = 'none'; geoSt.className = 'geo-status'; }
      
      if (node?.manualLocation) {
        geoSt.className = 'geo-status is-ok';
        geoSt.style.display = '';
        geoSt.innerHTML = `
          <div style="display:flex; align-items:center; width:100%; gap:6px;">
            <i class="fa-solid fa-map-pin" style="color:var(--c-warn); font-size:12px;"></i>
            <span class="geo-status-text" style="color:var(--c-text);">地図上で座標を個別調整済み</span>
            <button type="button" class="btn btn-ghost btn-icon-sm" id="btn-reset-geo" style="margin-left:auto; height:24px; width:24px; font-size:11px;" title="手動設定した座標をリセットし、住所から自動取得に戻す">
              <i class="fa-solid fa-rotate-left"></i>
            </button>
          </div>
        `;
        document.getElementById('btn-reset-geo')?.addEventListener('click', () => {
           node.manualLocation = false;
           node.lat = undefined;
           node.lng = undefined;
           saveDB();
           toast('座標の個別調整をリセットしました');
           if (typeof validateAddressUI === 'function') validateAddressUI(node.address.trim(), geoSt);
           renderMasterView();
        });
      } else if (node?.address?.trim() && typeof validateAddressUI === 'function') {
        validateAddressUI(node.address.trim(), geoSt);
      }
    }

    const datesRow = document.getElementById('mnm-company-dates-row');
    const oldNameRow = document.getElementById('mnm-oldnames-row');
    
    if (datesRow) {
      datesRow.style.display = '';
      const dissolvedLbl = datesRow.querySelector('.company-date-lbl--dissolved');
      if (dissolvedLbl) dissolvedLbl.innerHTML = type === 'school'
        ? '<i class="fa-solid fa-building-circle-xmark"></i>廃校日'
        : '<i class="fa-solid fa-building-circle-xmark"></i>解散日';
      document.getElementById('mnm-founded-date').value   = node?.foundedDate   || '';
      document.getElementById('mnm-dissolved-date').value = node?.dissolvedDate || '';
    }
    if (oldNameRow) {
      oldNameRow.style.display = '';
      const listContainer = document.getElementById('mnm-oldnames-list');
      listContainer.innerHTML = '';
      (node?.oldNames || []).forEach(o => _addOldNameRow(listContainer, o.name, o.untilDate));
      const ab = document.getElementById('btn-mnm-add-oldname');
      const nb = ab.cloneNode(true);
      ab.parentNode.replaceChild(nb, ab);
      nb.addEventListener('click', () => _addOldNameRow(listContainer, '', ''));
    }

    if (type === 'company') {
      const nodeTypeRow = document.getElementById('mnm-node-type-row');
      if (nodeTypeRow) {
        nodeTypeRow.style.display = '';
        const radios = document.querySelectorAll('input[name="mnm-node-type"]');
        const nType = node?.nodeType || (depth === 0 ? 'company' : 'department');
        nodeTypeRow.dataset.originalType = nType;
        radios.forEach(r => {
          r.checked = (r.value === nType);
          r.disabled = (depth === 0);
        });
        document.getElementById('mnm-node-type-hint').textContent = depth === 0 ? '最上位は「会社」に固定されます。' : '「事業所」や「会社」に変更すると組織図で強調されます。';
      }
    }
    _populateCorpEventsUI(node, nodeId, type);
  } else {
    modalEl.classList.remove('is-company-mode');
    tabsEl.style.display = 'none';

    rootLabel = levels[depth]?.label || '項目';
  }

  document.getElementById('mnm-title').textContent = node ? `「${rootLabel}」を編集` : `${rootLabel}を追加`;
  document.getElementById('mnm-name-lbl').innerHTML = `${rootLabel}名<span class="req">*</span>`;
  document.getElementById('mnm-name').value = node?.name || '';
  document.getElementById('mnm-name').placeholder = (type === 'company' && depth === 0) ? '例：○○株式会社' : '';

  // 汎用階層マスタ（学校など）：全 depth でノードカテゴリを選択可能
  const isGroupRow = document.getElementById('mnm-is-group-row');
  if (isGroupRow) {
    if (type !== 'company') {
      isGroupRow.style.display = '';
      const calcEffDepth = type === 'school' ? _getEffectiveDepth(parentId, type) : depth;
      _populateNodeCategorySelect(type, calcEffDepth, node);
    } else {
      isGroupRow.style.display = 'none';
    }
  }

  _clearMnmFieldErrs();
  openModal('master-node-modal');
  setTimeout(() => document.getElementById('mnm-name').focus(), 100);
}


/* ================================================================
   CORPORATE EVENTS — モーダル UI
   複数の組織イベントを履歴カードとインラインフォームで管理する
================================================================ */

function _populateCorpEventsUI(node, nodeId, type = 'company') {
  _corpEventsNodeId = nodeId || '';
  _corpEvents = (node?.corporateEvents || []).map(e => ({ ...e }));
  _renderCorpEventCards(type);
  _closeCorporateEventForm();
}

function _renderCorpEventCards(type = 'company') {
  const mType = document.getElementById('mnm-type')?.value || type;
  const list = document.getElementById('mnm-corp-events-list');
  if (!list) return;
  list.innerHTML = '';
  if (!_corpEvents.length) {
    list.innerHTML = '<div class="corp-events-empty"><i class="fa-solid fa-timeline" style="opacity:0.5"></i>組織イベントなし</div>';
    return;
  }
  const sorted = _corpEvents.map((e, i) => ({ e, i }))
    .sort((a, b) => (_normDate(a.e.date, false) || '').localeCompare(_normDate(b.e.date, false) || ''));
  sorted.forEach(({ e: ev, i: origIdx }) => {
    const cfg = CORP_REL_CONFIG[ev.type] || CORP_REL_CONFIG['subsidiary'];
    const dateStr = ev.date
      ? _fmtDate(ev.date) + (ev.endDate ? ' 〜 ' + _fmtDate(ev.endDate) : ' 〜 現在')
      : '日付未設定';

    // 関連ノード名を解決
    let relDisplay = '';
    let relNode = null;
    if (mType === 'school') {
       relNode = masterFindNode(DB.masters.school || [], ev.relatedCompanyId);
    } else {
       relNode = (DB.masters.company || []).find(c => c.id === ev.relatedCompanyId);
    }
    
    let relName;
      if (CORP_TERMINAL_TYPES.has(ev.type)) {
        relName = relNode ? relNode.name : `<em style="color:var(--c-text-3);font-style:normal">（外部）</em>`;
      } else {
        relName = relNode ? relNode.name : `<em style="color:var(--c-danger)">未選択</em>`;
      }
      // relatedNodeId がある場合: 配置先部門名を追加
      let nodeDisplay = '';
      if (ev.relatedNodeId && relNode) {
        const relNodeObj = mType === 'school' 
          ? masterFindNode(DB.masters.school || [], ev.relatedNodeId)
          : _findNodeInCompany(ev.relatedCompanyId, ev.relatedNodeId);
        if (relNodeObj) nodeDisplay = `<span class="corp-event-card-node"><i class="fa-solid fa-diagram-project"></i>${relNodeObj.name}</span>`;
      }
      relDisplay = `<span class="corp-event-card-rel">${relName}</span>${nodeDisplay}`;

    const card = document.createElement('div');
    card.className = 'corp-event-card';
    card.innerHTML = `
      <div class="corp-event-card-main">
        <span class="corp-event-card-type" style="--ev-color:${cfg.color}">
          <i class="${cfg.icon}"></i>${cfg.label}
        </span>
        ${relDisplay}
        <span class="corp-event-card-date"><i class="fa-regular fa-calendar"></i>${dateStr}</span>
        ${ev.note ? `<span class="corp-event-card-note">${ev.note}</span>` : ''}
      </div>
      <div class="corp-event-card-acts">
        <button type="button" class="master-node-btn" title="編集"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="master-node-btn del" title="削除"><i class="fa-solid fa-trash-can"></i></button>
      </div>`;
    card.querySelector('.master-node-btn:not(.del)').addEventListener('click', () => _openCorporateEventForm(origIdx));
    card.querySelector('.master-node-btn.del').addEventListener('click', () => {
      _corpEvents.splice(origIdx, 1);
      _renderCorpEventCards(mType);
    });
    list.appendChild(card);
  });
}

function _openCorporateEventForm(editIdx = -1) {
  const form = document.getElementById('mnm-corp-event-form');
  const mType = document.getElementById('mnm-type')?.value || 'company';
  const empty = document.getElementById('mnm-corp-event-empty');
  if (!form || !empty) return;
  empty.style.display = 'none';
  form.style.display = 'flex';
  const idxEl = document.getElementById('mnm-cef-idx');
  if (idxEl) idxEl.value = editIdx;
  const ev     = editIdx >= 0 ? _corpEvents[editIdx] : null;
  const evType = ev?.type || 'none';
  const hiddenType = document.getElementById('mnm-cef-type');
  if (hiddenType) hiddenType.value = evType;
  const radio = document.querySelector(`input[name="mnm-cef-type-r"][value="${evType}"]`);
  if (radio) radio.checked = true;
  document.querySelectorAll('#mnm-cef-type-grid .corp-rel-card').forEach(c =>
    c.classList.toggle('is-selected', c.dataset.val === evType));

  // 関連セレクト
  const relSel = document.getElementById('mnm-cef-related-select');
  if (relSel) {
    relSel.innerHTML = mType === 'school' ? '<option value="">（対象を選択）</option>' : '<option value="">（会社を選択）</option>';
    if (mType === 'school') {
      const flatNodes = masterFlatten(DB.masters.school || []).filter(n => !n.isGroup && n.nodeCategory !== 'label');
      flatNodes.forEach(c => {
        if (c.id === _corpEventsNodeId) return;
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        if (c.id === ev?.relatedCompanyId) opt.selected = true;
        relSel.appendChild(opt);
      });
    } else {
      (DB.masters.company || []).forEach(c => {
        if (c.id === _corpEventsNodeId) return;
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        if (c.id === ev?.relatedCompanyId) opt.selected = true;
        relSel.appendChild(opt);
      });
    }
  }

  // 配置先部門セレクトを同期
  _syncCefRelatedNodeSelect(ev?.relatedCompanyId || '', ev?.relatedNodeId || '');

  document.getElementById('mnm-cef-start-date').value = ev?.date    || '';
  document.getElementById('mnm-cef-end-date').value   = ev?.endDate || '';
  document.getElementById('mnm-cef-note').value        = ev?.note    || '';
  _syncCefRelatedRow();
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _closeCorporateEventForm() {
  const form = document.getElementById('mnm-corp-event-form');
  const empty = document.getElementById('mnm-corp-event-empty');
  if (form && empty) {
    form.style.display = 'none';
    empty.style.display = 'flex';
  }
}

function _syncCefRelatedRow() {
  const type   = document.getElementById('mnm-cef-type')?.value || 'none';
  const relRow = document.getElementById('mnm-cef-related-row');
  const relLbl = document.getElementById('mnm-cef-related-lbl');
  const dateRow   = document.getElementById('mnm-cef-date-row');

  if (relRow)    relRow.style.display    = type === 'none' ? 'none' : '';

  if (relLbl) {
    const LABELS = {
      'subsidiary':      ['fa-solid fa-building',                   '親会社 / グループ親',               false],
      'full-subsidiary': ['fa-solid fa-building',                   '親会社',                           false],
      'holding':         ['fa-solid fa-sitemap',                    '持株会社',                         false],
      'merger-absorbed': ['fa-solid fa-arrow-right-to-bracket',     '吸収先会社',                       false],
      'acquisition':     ['fa-solid fa-hand-holding-dollar',        '買収元会社',                       false],
      'spinoff':         ['fa-solid fa-arrow-up-right-from-square', '分社元（もともと属していた会社）', false],
      'internalize':     ['fa-solid fa-arrow-down-to-line',         '統合先（部門として入る会社）',     false],
      'sold':            ['fa-solid fa-money-bill-transfer',        '売却先（システム内の会社のみ）',   true],
      'withdrawal':      ['fa-solid fa-right-from-bracket',         '関連会社（脱退後の所属先など）',   true],
    };
    const [icon, lbl, isOptional] = LABELS[type] || ['fa-solid fa-building', '関連会社', false];
    const marker = isOptional
      ? `<span class="opt">（任意）</span>`
      : `<span class="req">*</span>`;
    relLbl.innerHTML = `<i class="${icon}" style="color:var(--c-text-3)"></i> ${lbl}${marker}`;
  }

  // 配置先部門行の表示制御：terminal / entity-change / none 以外で relatedCompanyId がある場合
  const relSelVal = document.getElementById('mnm-cef-related-select')?.value || '';
  _syncCefRelatedNodeSelect(relSelVal, document.getElementById('mnm-cef-related-node-select')?.value || '');
}

/* 配置先部門セレクトをポピュレート */
function _syncCefRelatedNodeSelect(companyId, currentNodeId = '') {
  const nodeSel = document.getElementById('mnm-cef-related-node-select');
  const nodeRow = document.getElementById('mnm-cef-related-node-row');
  if (!nodeSel || !nodeRow) return;

  const type = document.getElementById('mnm-cef-type')?.value || 'none';
  const canHaveNode = companyId
    && type !== 'none'
    && !CORP_TERMINAL_TYPES.has(type)
    && type !== 'internalize'; // internalize は会社全体を部門化するため部門指定不要

  nodeRow.style.display = canHaveNode ? '' : 'none';
  if (!canHaveNode) return;

  const descendants = _getAllDescendantNodes(companyId);
  nodeSel.innerHTML = '<option value="">（会社直下に配置）</option>';
  descendants.forEach(dn => {
    const opt = document.createElement('option');
    opt.value = dn.id;
    const indent = '\u3000'.repeat(dn.depth - 1); // 全角スペースでインデント
    opt.textContent = `${indent}${dn.pathLabel}`;
    if (dn.id === currentNodeId) opt.selected = true;
    nodeSel.appendChild(opt);
  });
}

function _saveCorporateEventForm() {
  const type = document.getElementById('mnm-cef-type')?.value || 'none';
  if (type === 'none') { _closeCorporateEventForm(); return; }
  const relSel = document.getElementById('mnm-cef-related-select');
  const relId  = relSel?.value || '';
  // 売却・脱退は関連会社が任意
  const relOptional = CORP_TERMINAL_TYPES.has(type);
  if (!relId && !relOptional) {
    relSel?.classList.add('is-err');
    toast('関連会社を選択してください');
    setTimeout(() => relSel?.classList.remove('is-err'), 1500);
    return;
  }
  const startEl = document.getElementById('mnm-cef-start-date');
  const endEl   = document.getElementById('mnm-cef-end-date');
  if (startEl) startEl.value = _normFlexDateInput(startEl.value.trim());
  if (endEl)   endEl.value   = _normFlexDateInput(endEl.value.trim());
  const startRaw = startEl?.value || '';
  const endRaw   = endEl?.value   || '';
  if (startRaw && !_validateFlexDate(startRaw)) { toast(`開始日の形式が正しくありません: ${startRaw}`); return; }
  if (endRaw   && !_validateFlexDate(endRaw))   { toast(`終了日の形式が正しくありません: ${endRaw}`);   return; }
  if (startRaw && endRaw && _normDate(startRaw, false) > _normDate(endRaw, true)) {
    toast('終了日は開始日より後の日付を入力してください'); return;
  }
  const editIdx = parseInt(document.getElementById('mnm-cef-idx')?.value ?? '-1', 10);
  const evObj = {
    id:               editIdx >= 0 ? (_corpEvents[editIdx]?.id || uid()) : uid(),
    type,
    date:             startRaw,
    endDate:          endRaw,
    relatedCompanyId: relId,
    relatedNodeId:    document.getElementById('mnm-cef-related-node-select')?.value || '',
    note:             document.getElementById('mnm-cef-note')?.value.trim()          || '',
  };
  if (editIdx >= 0) _corpEvents[editIdx] = evObj;
  else              _corpEvents.push(evObj);
  _renderCorpEventCards();
  _closeCorporateEventForm();
}

function saveMasterNode() {
  _clearMnmFieldErrs();
  const nameEl = document.getElementById('mnm-name');
  const name   = nameEl.value.trim();
  if (!name) { _showMnmFieldErr(nameEl, '名称を入力してください'); return; }
  const type   = document.getElementById('mnm-type').value;
  const nodeId = document.getElementById('mnm-id').value;
  const cfg    = getMasterCfg(type);

  // flatタイプ保存
  if (cfg?.isFlat) {
    const colorEl = document.getElementById('mnm-color');
    const color = colorEl.dataset.noColor === 'true' ? '' : (colorEl.value || '#6366F1');
    const icon = document.getElementById('mnm-icon-val').value || '';

    if (!DB.masters[type]) DB.masters[type] = [];

    // 重複チェック（flat型）
    const dupFlat = (DB.masters[type] || []).find(i => i.id !== nodeId && i.name === name);
    if (dupFlat) { _showMnmFieldErr(document.getElementById('mnm-name'), `「${name}」はすでに登録されています`); return; }

    // 表記ゆれ警告
    const fuzzyDup = (DB.masters[type] || []).find(i => i.id !== nodeId && normalizeForDuplicate(i.name) === normalizeForDuplicate(name));
    if (fuzzyDup && !confirm(`表記の似ている項目「${fuzzyDup.name}」がすでに存在します。\n本当に「${name}」として登録しますか？`)) {
      return;
    }

    if (nodeId) {
      const item = DB.masters[type].find(i => i.id === nodeId);
      if (item) {
        const oldName = item.name;
        Object.assign(item, { name, color, icon });
        if (oldName !== name) {
          const updated = syncEmpFlatMasterField(type, oldName, name);
          if (updated > 0) {
            const cfg2 = getMasterCfg(type);
            toast(`「${oldName}」→「${name}」に更新（従業員 ${updated}名 の${cfg2.label}を連動変更）`);
          } else {
            toast('更新しました');
          }
        } else {
          toast('更新しました');
        }
      }
    } else {
      DB.masters[type].push({ id: uid(), name, color, icon, splitSide: '' });
      toast('追加しました');
    }

    saveDB();
    closeModal('master-node-modal');
    renderMasterView();
    refreshAll();
    return;
  }

  // 階層ツリー保存
  const parentId = document.getElementById('mnm-parent-id').value;

  if (type === 'company' && (name.includes('＞') || name.includes('>'))) {
    _showMnmFieldErr(document.getElementById('mnm-name'), '会社名や部門名に「＞」や「>」を含めることはできません。階層は親を選択して追加してください。');
    return;
  }

  // 重複チェック（ツリー型: 同一親の兄弟間）
  if (masterCheckDuplicateSibling(type, name, parentId, nodeId || null)) {
    const depth  = parseInt(document.getElementById('mnm-level').value, 10);
    let lvCfg;
    if (type === 'company') {
      if (depth === 0) {
        // ルートレベル = ルートノードの重複
        const _rootForDup = masterFindNode(DB.masters.company || [], nodeId || parentId);
        lvCfg = { label: getCompanyRootLabel(_rootForDup) };
      } else {
        const compRoot = _findCompanyRootByDescendant(parentId || nodeId);
        const cLevels  = getCompanyLevels(compRoot);
        lvCfg = cLevels[depth - 1] || cLevels[cLevels.length - 1] || { label: '組織' };
      }
    } else {
      lvCfg = cfg.levels[depth] || cfg.levels[cfg.levels.length - 1];
    }
    _showMnmFieldErr(document.getElementById('mnm-name'), `同じ${lvCfg.label}名「${name}」はすでに登録されています`);
    return;
  }

  const siblings = parentId ? (masterFindNode(DB.masters[type] || [], parentId)?.children || []) : (DB.masters[type] || []);
  const fuzzyDupNode = siblings.find(n => n.id !== nodeId && normalizeForDuplicate(n.name) === normalizeForDuplicate(name));
  if (fuzzyDupNode && !confirm(`同じ階層に表記の似ている項目「${fuzzyDupNode.name}」がすでに存在します。\n本当に「${name}」として登録しますか？`)) {
    return;
  }

  // 会社・学校マスタ：設立日・解散日・名称変更履歴の収集とバリデーション
  const _depth = parseInt(document.getElementById('mnm-level').value, 10);
  let _foundedDate = '', _dissolvedDate = '', _oldNames = [];
  if (type === 'company' || type === 'school') {
    // 入力値を自動正規化してからフィールドに書き戻す
    const foundedEl   = document.getElementById('mnm-founded-date');
    const dissolvedEl = document.getElementById('mnm-dissolved-date');
    if (foundedEl)   foundedEl.value   = _normFlexDateInput(foundedEl.value.trim());
    if (dissolvedEl) dissolvedEl.value = _normFlexDateInput(dissolvedEl.value.trim());
    _foundedDate   = foundedEl?.value   || '';
    _dissolvedDate = dissolvedEl?.value || '';

    if (_foundedDate && !_validateFlexDate(_foundedDate)) {
      _showMnmFieldErr(foundedEl,
        `設立日の形式が正しくありません。入力値:「${_foundedDate}」 ／ 正しい形式: 2010 / 2010-04 / 2010-04-01`);
      return;
    }
    if (_dissolvedDate && !_validateFlexDate(_dissolvedDate)) {
      _showMnmFieldErr(dissolvedEl,
        `解散日の形式が正しくありません。入力値:「${_dissolvedDate}」 ／ 正しい形式: 2025 / 2025-03 / 2025-03-31`);
      return;
    }
    if (_foundedDate && _dissolvedDate && _normDate(_foundedDate, false) > _normDate(_dissolvedDate, true)) {
      _showMnmFieldErr(dissolvedEl, '解散日は設立日より後の日付を入力してください');
      return;
    }

    // 旧名称バリデーション（forEach の return バグ修正 → フラグ変数で制御）
    const oldRows = document.querySelectorAll('#mnm-oldnames-list .mnm-oldname-item');
    let oldNameErr = false;
    oldRows.forEach(row => {
      if (oldNameErr) return;
      const oName   = row.querySelector('.old-name-input').value.trim();
      const dateInp = row.querySelector('.old-date-input');
      dateInp.value = _normFlexDateInput(dateInp.value.trim());
      const oDate   = dateInp.value;
      if (oName || oDate) {
        if (oDate && !_validateFlexDate(oDate)) {
          _showMnmFieldErr(dateInp,
            `旧名称「${oName || '(未入力)'}」の日付が不正です。入力値:「${oDate}」 ／ 正しい形式: 2020 / 2020-04`);
          oldNameErr = true;
          return;
        }
        if (oName) _oldNames.push({ name: oName, untilDate: oDate });
      }
    });
    if (oldNameErr) return;
  }

  if (nodeId) {
    const node = masterFindNode(DB.masters[type], nodeId);
    if (node) {
      const oldName = node.name;
      node.name = name;
      const nodeCatEl = document.getElementById('mnm-node-category');
      if (nodeCatEl && document.getElementById('mnm-is-group-row')?.style.display !== 'none') {
        const catVal = nodeCatEl.value;
        node.nodeCategory = catVal;
        node.isGroup      = (catVal === 'label');
      }
      // 学校名変更を従業員学歴データに連動
      if (type === 'school' && oldName !== name && !node.isGroup && node.nodeCategory !== 'label') {
        let schoolUpd = 0;
        DB.employees.forEach(e => {
          if (e.school === oldName) { e.school = name; schoolUpd++; }
          else if (e.eduDept) {
            const parts = e.eduDept.split(/\s+/);
            const idx   = parts.indexOf(oldName);
            if (idx >= 0) { parts[idx] = name; e.eduDept = parts.join(' '); schoolUpd++; }
          }
        });
        if (schoolUpd > 0) toast(`従業員 ${schoolUpd}名の学歴データを自動更新しました`);
      }
      if (type === 'company' || type === 'school') {
        node.foundedDate     = _foundedDate;
        node.dissolvedDate   = _dissolvedDate;
        node.oldNames        = _oldNames;
        node.corporateEvents = _corpEvents.map(e => ({ ...e }));
        const newAddr        = document.getElementById('mnm-address')?.value.trim() || '';
        // 住所文字列が変更された場合、手動で設定した座標はリセットする
        if (node.address !== newAddr && node.manualLocation) {
          node.manualLocation = false;
          node.lat = undefined;
          node.lng = undefined;
        }
        node.address = newAddr;
      }
      if (type === 'company') {
        const typeRadio = document.querySelector('input[name="mnm-node-type"]:checked');
        node.nodeType      = _depth === 0 ? 'company' : (typeRadio ? typeRadio.value : 'department');
        // 旧形式プロパティを削除
        delete node.corporateRelation;

        // 会社名が変わった場合、従業員の orgLevels (フルパス) 内の該当名称を一括置換
        if (oldName !== name) {
          let updateCount = 0;
          DB.employees.forEach(e => {
            (e.transfers ||[]).forEach(t => {
              if (Array.isArray(t.orgLevels)) {
                const idx = t.orgLevels.indexOf(oldName);
                if (idx >= 0) { t.orgLevels[idx] = name; updateCount++; }
              }
            });
          });
          if (updateCount > 0) toast(`従業員 ${updateCount}件の異動履歴パスを自動更新しました`);
        }
      }

      // 役職名の変更を異動履歴の役職に反映
      if (type === 'position' && oldName !== name) {
        let updateCount = 0;
        DB.employees.forEach(e => {
          (e.transfers ||[]).forEach(t => {
            if (t.position === oldName) { t.position = name; updateCount++; }
          });
        });
        if (updateCount > 0) toast(`従業員 ${updateCount}名の異動履歴の役職名も更新しました`);
      }
    }
  } else {
    const nodeCatEl = document.getElementById('mnm-node-category');
    const catVal = (nodeCatEl && document.getElementById('mnm-is-group-row')?.style.display !== 'none')
      ? nodeCatEl.value
      : (DB.masterConfig[type]?.levels?.[_depth]?.label || '');
    const isGroup = (catVal === 'label');
    const newNode = { id: uid(), name, children: [], isGroup, nodeCategory: catVal };
    if (type === 'company' || type === 'school') {
      newNode.foundedDate     = _foundedDate;
      newNode.dissolvedDate   = _dissolvedDate;
      newNode.oldNames        = _oldNames;
      newNode.corporateEvents = _corpEvents.map(e => ({ ...e }));
      newNode.address         = document.getElementById('mnm-address')?.value.trim() || '';
    }
    if (type === 'company') {
      const typeRadio = document.querySelector('input[name="mnm-node-type"]:checked');
      newNode.nodeType = _depth === 0 ? 'company' : (typeRadio ? typeRadio.value : 'department');
    }
    if (parentId) {
      const parent = masterFindNode(DB.masters[type], parentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(newNode);
        masterExpandedIds.add(parentId); // 子追加時、親を自動展開
      }
    } else {
      DB.masters[type].push(newNode);
    }
  }

  saveDB();
  closeModal('master-node-modal');
  renderMasterView();
  toast(nodeId ? '更新しました' : '追加しました');
}

/* ================================================================
   MASTER — AUTOCOMPLETE (汎用)
================================================================ */
function initMasterAC({ inputId, dropdownId, getSuggestions, onSelect, allowNew, getNewLabel, getEmpCount }) {
  const inp = document.getElementById(inputId);
  const dd  = document.getElementById(dropdownId);
  if (!inp || !dd) return;

  let acFocusIdx = -1;

  function renderAC() {
    const q    = inp.value.trim();
    const sugs = getSuggestions(q);
    dd.innerHTML = '';
    acFocusIdx = -1;

    sugs.forEach(s => {
      const item = document.createElement('div');
      item.className = 'master-ac-item is-master';
      const icon = document.createElement('i');
      icon.className = 'master-ac-icon fa-solid fa-bookmark';
      const label = document.createElement('span');
      label.className = 'master-ac-label';
      label.textContent = s;
      item.appendChild(icon);
      item.appendChild(label);
      if (typeof getEmpCount === 'function') {
        const cnt = getEmpCount(s);
        if (cnt > 0) {
          const cntEl = document.createElement('span');
          cntEl.className = 'ac-emp-count';
          cntEl.textContent = cnt + '名';
          item.appendChild(cntEl);
        }
      }
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        inp.value = s;
        dd.classList.remove('open');
        onSelect && onSelect(s);
        markEmpDirty && markEmpDirty();
      });
      dd.appendChild(item);
    });

    // 新規登録オプション: 入力値が候補と完全一致しない場合のみ表示
    if (allowNew && q && !sugs.includes(q)) {
      const sep = document.createElement('div');
      sep.className = 'master-ac-sep';
      const newItem = document.createElement('div');
      newItem.className = 'master-ac-item is-new';
      const label = getNewLabel ? getNewLabel(q) : `「${q}」をマスタに新規登録（保存時に確定）`;
      newItem.innerHTML = `<i class="master-ac-icon fa-solid fa-circle-plus"></i>${label}`;
      newItem.addEventListener('mousedown', e => {
        e.preventDefault();
        inp.value = q;
        dd.classList.remove('open');
        onSelect && onSelect(q);
        markEmpDirty && markEmpDirty();
      });
      if (sugs.length) dd.appendChild(sep);
      dd.appendChild(newItem);
    }

    if (dd.children.length) dd.classList.add('open');
    else dd.classList.remove('open');
  }

  inp.addEventListener('input',  renderAC);
  inp.addEventListener('focus',  renderAC);
  inp.addEventListener('blur',   () => setTimeout(() => dd.classList.remove('open'), 150));
  inp.addEventListener('keydown', e => {
    const items = dd.querySelectorAll('.master-ac-item');
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acFocusIdx = Math.min(acFocusIdx + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('is-focused', i === acFocusIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acFocusIdx = Math.max(acFocusIdx - 1, 0);
      items.forEach((it, i) => it.classList.toggle('is-focused', i === acFocusIdx));
    } else if (e.key === 'Enter' && acFocusIdx >= 0) {
      e.preventDefault();
      items[acFocusIdx].dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      dd.classList.remove('open');
    }
  });
}

/* ================================================================
   SCHOOL — カテゴリ・実効パス ユーティリティ
================================================================ */
/**
 * 学校マスタのフルパス配列（ラベルノードを含む可能性あり）から
 * ラベルノードを除いた「実効パス」とラベルプレフィックスを返す。
 * emp.school / emp.eduDept の照合・セットに使用。
 */
function schoolEffectivePath(fullPathNames) {
  let currentNodes = DB.masters.school || [];
  const labelPrefix = [];
  const effective   = [];
  let foundSchool   = false;
  for (const name of fullPathNames) {
    const node    = currentNodes.find(n => n.name === name);
    const isLabel = node ? (node.isGroup || node.nodeCategory === 'label') : false;
    if (isLabel && !foundSchool) { labelPrefix.push(name); }
    else { effective.push(name); foundSchool = true; }
    currentNodes = node?.children || [];
  }
  return { effectivePath: effective, labelPrefix };
}

/** ノードカテゴリ select を設定レベルから動的生成し初期値をセット */
function _populateNodeCategorySelect(type, depth, node) {
  const sel  = document.getElementById('mnm-node-category');
  const hint = document.getElementById('mnm-node-category-hint');
  if (!sel) return;
  const levels = DB.masterConfig[type]?.levels || [];
  sel.innerHTML = '<option value="label">ラベル（分類フォルダ）</option>';
  levels.forEach((lv, i) => {
    const opt = document.createElement('option');
    opt.value       = lv.label;
    opt.textContent = `L${i + 1}：${lv.label}`;
    sel.appendChild(opt);
  });
  let curVal;
  if (node?.isGroup || node?.nodeCategory === 'label') {
    curVal = 'label';
  } else if (node?.nodeCategory && levels.some(lv => lv.label === node.nodeCategory)) {
    curVal = node.nodeCategory;
  } else {
    curVal = levels[Math.min(depth, levels.length - 1)]?.label || levels[0]?.label || '学校';
  }
  sel.value = curVal;
  _updateNodeCategoryHint(curVal, hint);
  sel.onchange = () => _updateNodeCategoryHint(sel.value, hint);
}

function _updateNodeCategoryHint(val, hint) {
  if (!hint) return;
  hint.textContent = val === 'label'
    ? '「大学グループ」「国立大学」など配下をまとめるフォルダです。学歴データには記録されません。'
    : `学歴データで「${val}」として参照されます。`;
}

/* 学校名・学部学科のオートコンプリートと補正機能 */
function initSchoolAC() {
  // ラベル識別フラグ付きで全パスを収集
  function getAllSchoolPaths() {
    const paths = [];
    function traverse(nodes, curNames, curIsLabel) {
      nodes.forEach(n => {
        const isLbl  = !!(n.isGroup || n.nodeCategory === 'label');
        const names  = [...curNames, n.name];
        const labels = [...curIsLabel, isLbl];
        paths.push({ names, isLabelArr: labels });
        if (n.children?.length) traverse(n.children, names, labels);
      });
    }
    traverse(DB.masters.school || [], [], []);
    return paths;
  }

  // ラベルノードをスキップして school / dept フィールドに適用
  function applyPathToInputs(pathArray) {
    if (!pathArray || !pathArray.length) return;
    const schoolInput = document.getElementById('f-school');
    const deptInput   = document.getElementById('f-edu-dept');
    const { effectivePath } = schoolEffectivePath(pathArray.map(s => s.trim()));
    schoolInput.value = effectivePath[0] || pathArray[0];
    deptInput.value   = effectivePath.length > 1 ? effectivePath.slice(1).join(' ') : '';
    markEmpDirty?.();
  }

  // 学校候補 Map<schoolName, displayStr（ラベルプレフィックス ＞ 付き）>
  function buildSchoolCandidates() {
    const seen = new Map();
    getAllSchoolPaths().forEach(({ names, isLabelArr }) => {
      const firstReal = isLabelArr.findIndex(b => !b);
      if (firstReal < 0) return;
      const schoolName = names[firstReal];
      if (!seen.has(schoolName)) {
        const prefix = names.slice(0, firstReal).join(' ＞ ');
        seen.set(schoolName, prefix ? `${prefix} ＞ ${schoolName}` : schoolName);
      }
    });
    return seen;
  }

  initMasterAC({
    inputId: 'f-school',
    dropdownId: 'school-ac-dropdown',
    getSuggestions: q => {
      const cands = [...buildSchoolCandidates().values()];
      return q ? cands.filter(s => s.toLowerCase().includes(q.toLowerCase())) : cands;
    },
    onSelect: val => {
      // "ラベル ＞ 学校名" 形式でも実効パスを取り出して設定
      applyPathToInputs(val.split(' ＞ '));
    },
    allowNew: true,
    getNewLabel: q => {
      const lv0 = DB.masterConfig.school?.levels?.[0]?.label || '学校';
      return `「${q}」を${lv0}として新規登録`;
    },
    getEmpCount: displayStr => {
      const { effectivePath } = schoolEffectivePath(displayStr.split(' ＞ ').map(s => s.trim()));
      const schoolName = effectivePath[0] || displayStr.split(' ＞ ').pop();
      return DB.employees.filter(e => e.school === schoolName).length;
    },
  });

  initMasterAC({
    inputId: 'f-edu-dept',
    dropdownId: 'dept-ac-dropdown',
    getSuggestions: q => {
      const schoolName = document.getElementById('f-school').value.trim();
      const cands = [];
      getAllSchoolPaths().forEach(({ names, isLabelArr }) => {
        const firstReal = isLabelArr.findIndex(b => !b);
        if (firstReal < 0 || firstReal >= names.length - 1) return;
        const school = names[firstReal];
        if (schoolName && school !== schoolName) return;
        const deptDisp = names.slice(firstReal + 1).join(' ＞ ');
        if (deptDisp && !cands.includes(deptDisp)) cands.push(deptDisp);
      });
      return q ? cands.filter(s => s.toLowerCase().includes(q.toLowerCase())) : cands;
    },
    onSelect: val => {
      const deptInput = document.getElementById('f-edu-dept');
      deptInput.value = val.split(' ＞ ').join(' ');
      markEmpDirty?.();
    },
    allowNew: true,
    getNewLabel: q => {
      const schoolName = document.getElementById('f-school').value.trim();
      const lv1 = DB.masterConfig.school?.levels?.[1]?.label || '学部';
      return schoolName
        ? `「${q}」を ${schoolName} の${lv1}等として新規登録`
        : `「${q}」を${lv1}等として新規登録`;
    },
    getEmpCount: deptDisp => {
      const deptPath = deptDisp.split(' ＞ ').join(' ');
      return DB.employees.filter(e => e.eduDept && e.eduDept.startsWith(deptPath)).length;
    },
  });
}

/* ================================================================
   COMPANY — PER-NODE 階層設定モーダル
================================================================ */
/**
 * 会社ルートノードの階層設定（level-cfg-modal を再利用）
 * typeに 'company' を、会社ノードのIDを hidden フィールドに保存して区別する
 */
function openCompanyLevelCfgModal(rootNode) {
  const currentLevels = getCompanyLevels(rootNode);
  document.getElementById('lcm-type').value = 'company';
  // ルートノードIDを hidden で保持（保存時に会社固有levelsを更新）
  document.getElementById('lcm-company-node-id').value = rootNode.id;
  document.getElementById('lcm-title').textContent = `「${rootNode.name}」の階層構造を設定`;

  const hint = document.getElementById('lcm-hint');
  if (hint) {
    hint.textContent = `このノード固有の組織階層名・種別名を設定します。未設定の場合はデフォルト設定が適用されます。`;
    hint.style.display = '';
  }

  // ルートラベル入力欄を表示・初期化
  const rootLblRow = document.getElementById('lcm-root-label-row');
  const rootLblInput = document.getElementById('lcm-root-label-input');
  if (rootLblRow)   rootLblRow.style.display = '';
  if (rootLblInput) rootLblInput.value = rootNode.rootLabel || '';

  const list = document.getElementById('lcm-level-list');
  list.innerHTML = '';
  currentLevels.forEach((lv, i) => addLcmRow(lv, i));
  openModal('level-cfg-modal');
}

function saveCompanyLevelCfg() {
  const rows = document.querySelectorAll('#lcm-level-list .lcm-level-row');
  const levels = [];
  let ok = true;
  rows.forEach(row => {
    const label = row.querySelector('.lcm-label-input').value.trim();
    const ph    = row.querySelector('.lcm-ph-input').value.trim();
    if (!label) { ok = false; row.querySelector('.lcm-label-input').style.borderColor = 'var(--c-danger)'; return; }
    levels.push({ label, placeholder: ph });
  });
  if (!ok) { toast('階層名を入力してください'); return; }
  const nodeId = document.getElementById('lcm-company-node-id').value;
  const rootNode = masterFindNode(DB.masters.company || [], nodeId);
  if (!rootNode) { toast('ノードが見つかりません'); return; }
  rootNode.levels = levels;
  // ルートラベルを保存（空欄ならプロパティを削除してデフォルト使用）
  const rootLblVal = (document.getElementById('lcm-root-label-input')?.value || '').trim();
  if (rootLblVal) rootNode.rootLabel = rootLblVal;
  else delete rootNode.rootLabel;
  saveDB();
  closeModal('level-cfg-modal');
  renderMasterView();
  toast(`「${rootNode.name}」の階層構造を更新しました`);
}

function openLevelCfgModal(type) {
  const cfg = getMasterCfg(type);
  document.getElementById('lcm-type').value = type;
  // 会社ノード固有IDをクリア（グローバル設定として開く）
  const nodeIdEl = document.getElementById('lcm-company-node-id');
  if (nodeIdEl) nodeIdEl.value = '';
  // ヒントを非表示
  const hintEl = document.getElementById('lcm-hint');
  if (hintEl) hintEl.style.display = 'none';
  // 会社マスタのグローバル設定はデフォルト階層（depth=1以降）の設定
  const titleSuffix = type === 'company' ? ' — デフォルト設定（各ノードで個別設定可）' : '';
  document.getElementById('lcm-title').textContent = `「${cfg.label}」の階層構造を設定${titleSuffix}`;

  // ルートラベル行：会社マスタのグローバル設定時のみ表示
  const rootLblRow   = document.getElementById('lcm-root-label-row');
  const rootLblInput = document.getElementById('lcm-root-label-input');
  if (rootLblRow) rootLblRow.style.display = type === 'company' ? '' : 'none';
  if (rootLblInput && type === 'company') {
    rootLblInput.value = DB.masterConfig.company?.rootLabel || '';
  }

  const list = document.getElementById('lcm-level-list');
  list.innerHTML = '';
  cfg.levels.forEach((lv, i) => addLcmRow(lv, i));
  openModal('level-cfg-modal');
}

function addLcmRow(lv = null, idx = null) {
  const list = document.getElementById('lcm-level-list');
  const rowIdx = idx !== null ? idx : list.children.length;
  const row = document.createElement('div');
  row.className = 'lcm-level-row';
  row.innerHTML = `
    <span class="lcm-level-num">${rowIdx + 1}</span>
    <input type="text" class="lcm-label-input" placeholder="階層名" value="${lv?.label || ''}">
    <input type="text" class="lcm-ph-input" placeholder="プレースホルダー例" value="${lv?.placeholder || ''}">
    <button type="button" class="lcm-level-del" title="この階層を削除"><i class="fa-solid fa-trash-can"></i></button>
  `;
  row.querySelector('.lcm-level-del').addEventListener('click', () => {
    const rows = list.querySelectorAll('.lcm-level-row');
    if (rows.length <= 1) { toast('最低1階層が必要です'); return; }
    row.remove();
    // 番号を振り直し
    list.querySelectorAll('.lcm-level-num').forEach((n, i) => n.textContent = i + 1);
  });
  if (idx !== null) list.appendChild(row);
  else {
    const rows = list.querySelectorAll('.lcm-level-row').length;
    if (rows >= 5) { toast('最大5階層までです'); return; }
    list.appendChild(row);
    list.querySelectorAll('.lcm-level-num').forEach((n, i) => n.textContent = i + 1);
  }
}

function saveLevelCfg() {
  const type = document.getElementById('lcm-type').value;
  // 会社ノード固有の階層設定の場合はsaveCompanyLevelCfgに委譲
  const companyNodeId = document.getElementById('lcm-company-node-id')?.value;
  if (type === 'company' && companyNodeId) {
    saveCompanyLevelCfg();
    return;
  }
  const rows = document.querySelectorAll('#lcm-level-list .lcm-level-row');
  const levels = [];
  let ok = true;
  rows.forEach(row => {
    const label = row.querySelector('.lcm-label-input').value.trim();
    const ph    = row.querySelector('.lcm-ph-input').value.trim();
    if (!label) { ok = false; row.querySelector('.lcm-label-input').style.borderColor = 'var(--c-danger)'; return; }
    levels.push({ label, placeholder: ph });
  });
  if (!ok) { toast('階層名を入力してください'); return; }
  if (!DB.masterConfig[type]) DB.masterConfig[type] = {};
  DB.masterConfig[type].levels = levels;
  // 会社マスタのグローバルルートラベルを保存
  if (type === 'company') {
    const rootLblVal = (document.getElementById('lcm-root-label-input')?.value || '').trim();
    if (rootLblVal) DB.masterConfig.company.rootLabel = rootLblVal;
    else delete DB.masterConfig.company.rootLabel;
  }
  saveDB();
  closeModal('level-cfg-modal');
  renderMasterView();
  toast('デフォルト階層構造を更新しました');
}

function resetCurrentMaster() {
  const type  = currentMasterType;
  const cfg   = type === 'tag' ? { label: 'タグマスタ' } : getMasterCfg(type);
  const label = cfg?.label || type;

  let affectedCount = 0;
  if (type === 'tag') {
    affectedCount = DB.employees.filter(e => e.tags && e.tags.length > 0).length;
  } else if (type === 'school') {
    affectedCount = DB.employees.filter(e => e.school || e.eduDept).length;
  } else if (type === 'company') {
    affectedCount = DB.employees.filter(e => e.transfers && e.transfers.length > 0).length;
  } else if (type === 'position') {
    affectedCount = DB.employees.filter(e => e.transfers && e.transfers.some(t => t.position)).length;
  } else {
    const empField = FLAT_MASTER_EMP_FIELDS[type];
    if (empField) affectedCount = DB.employees.filter(e => e[empField]).length;
  }

  const hasSample = !!(SAMPLE_MASTERS && SAMPLE_MASTERS[type]);

  _openMasterResetModal({ type, label, affectedCount, hasSample });
}

function _openMasterResetModal({ type, label, affectedCount, hasSample }) {
  document.getElementById('_mst-reset-modal')?.remove();

  const affectHtml = affectedCount > 0
    ? `<div class="mst-reset-affect"><i class="fa-solid fa-circle-exclamation"></i>このマスタを使用している従業員 <strong>${affectedCount}名</strong> の該当データに影響します</div>`
    : '';

  const sampleCard = hasSample ? `
    <div class="imode-card" data-mode="sample" tabindex="0" role="radio" aria-checked="false">
      <div class="imode-icon" style="background:#DBEAFE;color:#1D4ED8"><i class="fa-solid fa-table-list"></i></div>
      <div>
        <div class="imode-ttl">サンプルデータを読み込む</div>
        <div class="imode-desc">あらかじめ用意されたサンプル構成にリセットします。既存データは置き換えられます。</div>
      </div>
      <div class="imode-badge recommended">推奨</div>
    </div>` : '';

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = '_mst-reset-modal';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-head">
        <div class="modal-title">
          <i class="fa-solid fa-arrow-rotate-left" style="color:var(--c-danger)"></i>
          <span>【${label}】の初期化</span>
        </div>
        <button class="modal-close" id="_mst-reset-close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal-body">
        ${affectHtml}
        <p style="font-size:13px;color:var(--c-text-2);margin:0 0 12px">初期化の方法を選択してください。<strong style="color:var(--c-danger)">この操作は取り消せません。</strong></p>
        <div class="imode-cards">
          <div class="imode-card" data-mode="clear" tabindex="0" role="radio" aria-checked="false">
            <div class="imode-icon" style="background:#FEE2E2;color:#991B1B"><i class="fa-solid fa-trash-can"></i></div>
            <div>
              <div class="imode-ttl">クリア（空にする）</div>
              <div class="imode-desc">登録されているすべての項目を削除します。マスタを白紙の状態にしたいときに使用します。</div>
            </div>
          </div>
          ${sampleCard}
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" id="_mst-reset-cancel">キャンセル</button>
        <button class="btn btn-danger" id="_mst-reset-exec" disabled style="opacity:.45;cursor:not-allowed">
          <i class="fa-solid fa-check"></i>実行する
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));

  const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('#_mst-reset-close').addEventListener('click', close);
  overlay.querySelector('#_mst-reset-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  const execBtn = overlay.querySelector('#_mst-reset-exec');
  overlay.querySelectorAll('.imode-card').forEach(card => {
    const activate = () => {
      overlay.querySelectorAll('.imode-card').forEach(c => { c.classList.remove('is-sel'); c.setAttribute('aria-checked','false'); });
      card.classList.add('is-sel');
      card.setAttribute('aria-checked','true');
      execBtn.disabled = false;
      execBtn.style.opacity = '1';
      execBtn.style.cursor  = 'pointer';
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });

  execBtn.addEventListener('click', () => {
    const mode = overlay.querySelector('.imode-card.is-sel')?.dataset.mode;
    if (!mode) return;
    close();
    _execMasterReset(type, mode);
  });
}

function _execMasterReset(type, mode) {
  const cfg   = type === 'tag' ? { label: 'タグマスタ' } : getMasterCfg(type);
  const label = cfg?.label || type;

  if (mode === 'sample') {
    const sampleData = SAMPLE_MASTERS[type];
    if (!sampleData) { toast('このマスタにはサンプルデータがありません'); return; }
    if (type === 'tag') {
      DB.tags = JSON.parse(JSON.stringify(sampleData));
    } else {
      DB.masters[type] = JSON.parse(JSON.stringify(sampleData));
    }
    saveDB(); renderMasterView(); refreshAll();
    toast(`【${label}】をサンプルデータで初期化しました`);
    return;
  }

  // mode === 'clear'
  if (type === 'tag') {
    DB.tags = [];
    DB.employees.forEach(e => e.tags = []);
  } else {
    if (type === 'school') {
      DB.employees.forEach(e => { e.school = ''; e.eduDept = ''; });
    } else if (type === 'company') {
      DB.employees.forEach(e => {
        if (e.transfers) e.transfers.forEach(t => { t.orgLevels = []; t.company = ''; t.department = ''; t.division = ''; });
      });
    } else if (type === 'position') {
      DB.employees.forEach(e => { if (e.transfers) e.transfers.forEach(t => t.position = ''); });
    } else {
      const empField = FLAT_MASTER_EMP_FIELDS[type];
      if (empField) DB.employees.forEach(e => e[empField] = '');
    }
    DB.masters[type] = [];
  }
  saveDB(); renderMasterView(); refreshAll();
  toast(`【${label}】をクリアしました`);
}

/* ================================================================
   COMPANY MASTER (組織図統合・履歴対応)
================================================================ */

let _ctl = { dates:[], idx: -1, mode: 'now' };
let _companyExpandedIds = new Set();
let _corpChildCollapsedIds = new Set(); // 子会社アコーディオン：折りたたみ中の親会社ID
let _companyDebounce = null;

/* ----------------------------------------------------------------
   柔軟な日付ユーティリティ
   入力: YYYY | YYYY-MM | YYYY-MM-DD いずれも許容
   isEnd=true の場合、期間末として扱う（比較用正規化）
---------------------------------------------------------------- */
function _normDate(s, isEnd = false) {
  if (!s) return '';
  if (/^\d{4}$/.test(s)) {
    return isEnd ? `${s}-12-31` : `${s}-01-01`;
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    if (isEnd) {
      const [y, m] = s.split('-').map(Number);
      return `${s}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
    }
    return `${s}-01`;
  }
  return s; // YYYY-MM-DD already
}

/* 表示用：YYYY-MM-DD → YYYY/MM/DD（YYYY, YYYY-MMも対応） */
function _fmtDate(s) {
  return s ? s.replace(/-/g, '/') : '—';
}

/* 柔軟日付入力の自動正規化
   2020/04 → 2020-04  /  2020.04.01 → 2020-04-01
   2020年4月1日 → 2020-04-01  /  ゼロ埋め: 2020-4-1 → 2020-04-01 */
function _normFlexDateInput(s) {
  if (!s) return s;
  // 漢字表記
  let m = s.match(/^(\d{4})年\s*(\d{1,2})月(?:\s*(\d{1,2})日)?$/);
  if (m) {
    return m[3]
      ? `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`
      : `${m[1]}-${m[2].padStart(2,'0')}`;
  }
  m = s.match(/^(\d{4})年$/);
  if (m) return m[1];
  // スラッシュ・ドット → ハイフン
  const n = s.replace(/\//g, '-').replace(/\./g, '-');
  // ゼロ埋め: YYYY-M-D or YYYY-M
  m = n.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = n.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}`;
  return n;
}

/* 柔軟日付入力のバリデーション（YYYY / YYYY-MM / YYYY-MM-DD）
   Date APIを使わず数値チェックのみ → タイムゾーンバグ回避 */
function _validateFlexDate(s) {
  if (!s) return true;
  if (/^\d{4}$/.test(s)) {
    const y = parseInt(s, 10);
    return y >= 1 && y <= 9999;
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const mo = parseInt(s.slice(5), 10);
    return mo >= 1 && mo <= 12;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, mo, d] = s.split('-').map(Number);
    if (mo < 1 || mo > 12) return false;
    const lastDay = new Date(y, mo, 0).getDate(); // Date(y,m,0)は月末取得。UTCに依存しない
    return d >= 1 && d <= lastDay;
  }
  return false;
}

/* ----------------------------------------------------------------
   指定日時点でアクティブな組織イベントを返す。
   複数ある場合は開始日が最も新しいものを優先（=最新の状態）。
   旧形式 corporateRelation がある場合もフォールバック対応。
---------------------------------------------------------------- */
function getEffectiveCorporateEvent(node, date) {
  if (!node) return null;
  const events = node.corporateEvents || [];
  if (!events.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const chkDate = date || today;
  const active = events
    .filter(e => e.type && e.type !== 'none' && (e.relatedCompanyId || CORP_TERMINAL_TYPES.has(e.type)))
    .filter(e => {
      const start = e.date    ? _normDate(e.date,    false) : '';
      const end   = e.endDate ? _normDate(e.endDate, true)  : '';
      if (start && chkDate < start) return false;
      if (end   && chkDate > end)   return false;
      return true;
    })
    .sort((a, b) =>
      (_normDate(b.date, false) || '').localeCompare(_normDate(a.date, false) || ''));
  return active[0] || null;
}

/* ----------------------------------------------------------------
   コーポレートツリー（親子会社関係）を動的構築
   corporateEvents 配列の date 時点有効なイベントを使用。
   戻り値:
     topLevel      - トップレベル会社配列
     children      - parentId → [{ node, event }]（子会社・合併等）
     internalizedMap - targetId → [{ node, event }]（部門化された会社）
     byId, childSet
---------------------------------------------------------------- */
function _buildCorporateHierarchy(roots, date) {
  const today   = new Date().toISOString().slice(0, 10);
  const chkDate = date || today;
  const byId    = {};
  roots.forEach(r => { byId[r.id] = r; });

  const children        = {};  // parentId → [{ node, event }]（relatedNodeIdなし・直下）
  const childrenByNode  = {};  // 'parentId::nodeId' → [{ node, event }]（特定部門ノード配下）
  const internalizedMap = {}; // targetCompanyId → [{ node, event }]（部門化された会社）
  const childSet        = new Set();
  const soldSet         = new Set(); // グループ離脱（売却・脱退）中の会社

  roots.forEach(r => {
    const ev = getEffectiveCorporateEvent(r, chkDate);
    if (!ev) return;

    // 売却・脱退: グループから離脱しているが childSet には入れない（topLevel で表示）
    if (CORP_TERMINAL_TYPES.has(ev.type)) {
      soldSet.add(r.id);
      return;
    }

    // 未知のタイプに対するフェイルセーフ
    if (ev.type === 'entity-change') return;

    if (!ev.relatedCompanyId) return;
    const relId = ev.relatedCompanyId;
    if (!byId[relId] || relId === r.id) return;

    if (ev.type === 'internalize') {
      // この会社は relId の部門として内包される
      if (!internalizedMap[relId]) internalizedMap[relId] = [];
      internalizedMap[relId].push({ node: r, event: ev });
      childSet.add(r.id);
    } else {
      // relatedNodeId がある場合: 親会社の特定部門ノード配下に表示
      if (ev.relatedNodeId) {
        const key = `${relId}::${ev.relatedNodeId}`;
        if (!childrenByNode[key]) childrenByNode[key] = [];
        childrenByNode[key].push({ node: r, event: ev });
      } else {
        // 通常: 親会社直下
        if (!children[relId]) children[relId] = [];
        children[relId].push({ node: r, event: ev });
      }
      childSet.add(r.id);
    }
  });

  // 循環参照チェック（DFS で祖先を辿り自己参照を除外）
  function hasAncestor(nodeId, targetId, visited = new Set()) {
    if (!nodeId || visited.has(nodeId)) return false;
    visited.add(nodeId);
    const n = byId[nodeId];
    if (!n || !childSet.has(nodeId)) return false;
    const ev = getEffectiveCorporateEvent(n, chkDate);
    const pid = ev?.relatedCompanyId;
    if (!pid) return false;
    if (pid === targetId) return true;
    return hasAncestor(pid, targetId, visited);
  }
  [...childSet].forEach(id => {
    const n  = byId[id];
    const ev = getEffectiveCorporateEvent(n, chkDate);
    const pid = ev?.relatedCompanyId;
    if (pid && hasAncestor(pid, id)) {
      childSet.delete(id);
      if (ev.type === 'internalize') {
        if (internalizedMap[pid]) internalizedMap[pid] = internalizedMap[pid].filter(c => c.node.id !== id);
      } else if (ev.relatedNodeId) {
        const key = `${pid}::${ev.relatedNodeId}`;
        if (childrenByNode[key]) childrenByNode[key] = childrenByNode[key].filter(c => c.node.id !== id);
      } else {
        if (children[pid]) children[pid] = children[pid].filter(c => c.node.id !== id);
      }
    }
  });

  const topLevel = roots.filter(r => !childSet.has(r.id));
  return { topLevel, children, childrenByNode, internalizedMap, byId, childSet, soldSet };
}

/* コーポレートリレーション種別の表示設定
   label    : アコーディオン（親会社側）から子会社を見たときのラベル
   relLabel : 子会社ノード自身に表示するバッジ用ラベル（そのノードから見た関係）
*/
const CORP_REL_CONFIG = {
  'none':            { label: '独立',             relLabel: '独立',       icon: 'fa-solid fa-building',                   color: 'var(--c-text-3)' },
  'subsidiary':      { label: '子会社',            relLabel: '親会社',     icon: 'fa-solid fa-code-branch',                color: '#6366F1' },
  'full-subsidiary': { label: '完全子会社',        relLabel: '親会社',     icon: 'fa-solid fa-circle-nodes',               color: '#8B5CF6' },
  'holding':         { label: '持株会社傘下',      relLabel: '持株会社',   icon: 'fa-solid fa-sitemap',                    color: '#0EA5E9' },
  'merger-absorbed': { label: '吸収合併',          relLabel: '合併先',     icon: 'fa-solid fa-arrow-right-to-bracket',     color: '#F59E0B' },
  'acquisition':     { label: 'M&A・買収',        relLabel: '買収元',     icon: 'fa-solid fa-hand-holding-dollar',        color: '#10B981' },
  'spinoff':         { label: '分社化',            relLabel: '分社元',     icon: 'fa-solid fa-arrow-up-right-from-square', color: '#EC4899' },
  'internalize':     { label: '部門化',            relLabel: '統合先',     icon: 'fa-solid fa-arrow-down-to-line',         color: '#F97316' },
  'sold':            { label: 'グループ売却',      relLabel: '売却先',     icon: 'fa-solid fa-money-bill-transfer',        color: '#DC2626' },
  'withdrawal':      { label: '脱退・除外',        relLabel: '脱退元',     icon: 'fa-solid fa-right-from-bracket',         color: '#9333EA' },
};
/** 売却・脱退など「グループ離脱型」イベント。関連会社は任意 */
const CORP_TERMINAL_TYPES = new Set(['sold', 'withdrawal']);

/* ----------------------------------------------------------------
   会社ノード内の特定IDのノードを再帰検索して返す
---------------------------------------------------------------- */
function _findNodeInCompany(companyId, nodeId) {
  if (!nodeId || !companyId) return null;
  const company = (DB.masters.company || []).find(c => c.id === companyId);
  if (!company) return null;
  function _search(nodes) {
    for (const n of nodes) {
      if (n.id === nodeId) return n;
      const found = n.children?.length ? _search(n.children) : null;
      if (found) return found;
    }
    return null;
  }
  return _search([company]);
}

/* ----------------------------------------------------------------
   会社ノード内の全子孫ノードをフラットリストで取得（配置先選択用）
   戻り値: [{ id, name, depth, pathLabel }]
---------------------------------------------------------------- */
function _getAllDescendantNodes(companyId) {
  const company = (DB.masters.company || []).find(c => c.id === companyId);
  if (!company) return [];
  const result = [];
  function _collect(nodes, depth, pathParts) {
    nodes.forEach(n => {
      const path = [...pathParts, n.name];
      if (depth > 0) result.push({ id: n.id, name: n.name, depth, pathLabel: path.slice(1).join(' / ') });
      if (n.children?.length) _collect(n.children, depth + 1, path);
    });
  }
  _collect([company], 0, []);
  return result;
}

function _buildCompanyDateIndex() {
  const dateSet = new Set();
  // 従業員の異動日
  DB.employees.forEach(emp => {
    (emp.transfers ||[]).forEach(t => { if (t.date) dateSet.add(t.date); });
  });
  // 会社ノード自身の設立日・解散日・名称変更日
  function _collectNodeDates(nodes) {
    nodes.forEach(n => {
      if (n.foundedDate)   dateSet.add(_normDate(n.foundedDate, false));
      if (n.dissolvedDate) dateSet.add(_normDate(n.dissolvedDate, true));
      (n.oldNames ||[]).forEach(o => { if (o.untilDate) dateSet.add(_normDate(o.untilDate, true)); });
      if (n.children?.length) _collectNodeDates(n.children);
    });
  }
  _collectNodeDates(DB.masters.company ||[]);
  // コーポレートイベント日付
  (DB.masters.company || []).forEach(r => {
    (r.corporateEvents || []).forEach(ev => {
      if (ev.date)    dateSet.add(_normDate(ev.date,    false));
      if (ev.endDate) dateSet.add(_normDate(ev.endDate, true));
    });
  });
  dateSet.delete(''); // 空文字除去
  _ctl.dates = [...dateSet].sort();
  if (_ctl.idx >= _ctl.dates.length) _ctl.idx = _ctl.dates.length - 1;
}

function _ctlGetDate() {
  if (_ctl.mode === 'now' || _ctl.idx < 0) return null;
  return _ctl.dates[_ctl.idx] || null;
}

function getCompanyNameAtDate(node, date) {
  if (!date) return node.name; // 現在
  if (node.oldNames && node.oldNames.length > 0) {
    const sorted = [...node.oldNames]
      .filter(o => o.untilDate)
      .sort((a, b) => _normDate(a.untilDate, true).localeCompare(_normDate(b.untilDate, true)));
    for (const old of sorted) {
      if (date <= _normDate(old.untilDate, true)) return old.name;
    }
  }
  return node.name;
}

/* ----------------------------------------------------------------
   会社ノードが過去に持ったすべての名称（現在名 + 旧名）を Set で返す。
   階層配下（children）は持たないため depth=0 ルートノード専用。
   depth>=1 の組織ノードにも oldNames があれば同様に機能する。
---------------------------------------------------------------- */
function getCompanyAllNames(node) {
  const names = new Set();
  if (!node) return names;
  names.add(node.name);
  if (node.oldNames && node.oldNames.length > 0) {
    node.oldNames.forEach(o => { if (o.name) names.add(o.name); });
  }
  return names;
}

function getCompanyStatusAtDate(node, date) {
  const today = new Date().toISOString().slice(0, 10);
  const fd = node.foundedDate   ? _normDate(node.foundedDate, false)  : '';
  const dd = node.dissolvedDate ? _normDate(node.dissolvedDate, true) : '';
  const chk = date || today;
  if (!date) {
    if (dd && today > dd) return 'dissolved';
    return 'active';
  }
  if (fd && chk < fd) return 'prefounded';
  if (dd && chk > dd) return 'dissolved';
  return 'active';
}

/* ----------------------------------------------------------------
   指定パスに属する従業員を返す。
   nodePathArray  : 現在名ベースのパス配列（例: ['A社', '製造部']）
   date           : 参照日（null = 最新異動を使用）
   nodeRefsArray  : 各階層のノードオブジェクト配列（省略可）
                    指定時は旧社名を含む全名称で照合する。
---------------------------------------------------------------- */
function getCompanyEmployeesAtDate(nodePathArray, date, nodeRefsArray) {
  // 旧名照合用：各階層の有効名セットを事前構築（nodeRefsArray が渡された場合のみ）
  const nameSetPerLevel = nodeRefsArray
    ? nodeRefsArray.map(n => getCompanyAllNames(n))
    : null;

  const sf = DB.settings.distStatusFilter || {};
  return applyGlobalFilter(DB.employees).filter(emp => {
    if (emp.status && sf[emp.status] === false) return false;
    const transfers = emp.transfers || [];
    if (!transfers.length) return false;

    const state = getEmpActiveState(emp, date);

    const matchPath = (orgLevels) => {
      if (!orgLevels || !orgLevels.length) return false;
      if (orgLevels.length !== nodePathArray.length) return false;
      for (let i = 0; i < nodePathArray.length; i++) {
        const actual = orgLevels[i];
        if (nameSetPerLevel) {
          if (!nameSetPerLevel[i].has(actual)) return false;
        } else {
          if (actual !== nodePathArray[i]) return false;
        }
      }
      return true;
    };

    if (matchPath(state.orgLevels)) {
      emp._relationKind = state.kind || 'assignment';
      return true;
    }
    if (state.concurrents && state.concurrents.some(c => matchPath(c.orgLevels))) {
      emp._relationKind = 'concurrent';
      return true;
    }

    return false;
  });
}

function renderCompanyMasterView() {
  const tree   = document.getElementById('master-tree');
  const tlBar  = document.getElementById('company-timeline-bar');
  const addLbl = document.getElementById('btn-master-add-root-lbl');
  const levRow = document.getElementById('master-levels-row');

  tlBar.style.display = '';
  const _globalRootLabel = getCompanyRootLabel(null);
  if (addLbl) addLbl.textContent = `${_globalRootLabel}を追加`;

  _buildCompanyDateIndex();
  _syncCompanyTimeline();

  const cfg      = getMasterCfg('company');

  // 会社ごとに階層が異なるため、グローバルの階層ラベル行は非表示
  if (levRow) levRow.style.display = 'none';

  const roots = DB.masters.company || [];
  tree.innerHTML = '';

  if (!roots.length) {
    tree.innerHTML = `<div class="master-empty-state"><i class="fa-solid fa-building"></i><p>会社マスタが未設定です。「${_globalRootLabel}を追加」から登録してください。</p></div>`;
    return;
  }

  const date         = _ctlGetDate();
  const showEmp      = document.getElementById('company-tog-emp')?.querySelector('input')?.checked ?? true;
  const showDissolved = document.getElementById('company-tog-dissolved')?.querySelector('input')?.checked ?? false;

  function buildCompanyNode(node, depth, parentPath, parentId, rootNode, parentNodeRefs) {
    const status      = getCompanyStatusAtDate(node, date);
    const currentName = getCompanyNameAtDate(node, date);
    const nodePath     = [...parentPath, node.name];       // 現在名ベースのパス（内部管理用）
    const nodeRefs     = [...(parentNodeRefs || []), node]; // ノード参照チェーン（旧名照合用）
    // depth=0はルートノード（会社）自身。depth=1以降はrootNodeのlevels[depth-1]を使用。
    const companyLevels = getCompanyLevels(rootNode);
    const _rootLabel    = getCompanyRootLabel(rootNode);
    let nIcon = 'fa-solid fa-circle-dot';
    if (node.nodeType === 'company') nIcon = 'fa-solid fa-building';
    else if (node.nodeType === 'facility') nIcon = 'fa-solid fa-map-location-dot';
    else if (node.nodeType === 'department') nIcon = 'fa-solid fa-sitemap';
    else {
      const LEVEL_ICONS = ['fa-solid fa-building','fa-solid fa-sitemap','fa-solid fa-people-group','fa-solid fa-diagram-project','fa-solid fa-circle-dot'];
      nIcon = LEVEL_ICONS[depth] || 'fa-solid fa-circle-dot';
    }

    const lv = depth === 0
      ? { label: _rootLabel, icon: nIcon }
      : { label: companyLevels[depth - 1]?.label || '組織', icon: nIcon };
    // 子ノード：showDissolved=false（現在モード）の場合、解散済み子ノードを除外
    const childrenArr = (node.children || []).filter(child => {
      if (date === null && !showDissolved) {
        return getCompanyStatusAtDate(child, null) !== 'dissolved';
      }
      return true;
    });
    const hasChildren = childrenArr.length > 0;
    const isExpanded  = _companyExpandedIds.has(node.id);

    const wrap = document.createElement('div');
    wrap.className = 'master-node' + (isExpanded ? ' is-expanded' : '');
    wrap.dataset.nodeId   = node.id;
    wrap.dataset.parentId = parentId || '';
    wrap.dataset.depth    = depth;
    const oldNamesStr = (node.oldNames || []).map(o => o.name).join(' ');
    wrap.dataset.oldnames = oldNamesStr;
    if (status === 'dissolved') wrap.classList.add('is-dissolved');
    if (status === 'prefounded') wrap.style.borderStyle = 'dashed';
    /* ── コーポレートイベント（全階層対応） ── */
    const _activeEvent = getEffectiveCorporateEvent(node, date);
    // 売却・脱退フラグ（全階層対応：corpHier.soldSet はルート参照、子ノードは activeEvent で補完）
    const _isSoldNode = corpHier.soldSet?.has(node.id)
      || (depth > 0 && !!_activeEvent && CORP_TERMINAL_TYPES.has(_activeEvent.type));
    if (_isSoldNode) wrap.classList.add('is-sold-from-group');
    wrap.style.opacity = (status === 'dissolved' || status === 'prefounded') ? '0.55' : '';

    /* ── ドラッグハンドル ── */
    const dragHandle = document.createElement('span');
    dragHandle.className = 'master-node-drag';
    dragHandle.title = 'ドラッグして移動・並び替え';
    dragHandle.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';

    /* ── 複数選択チェックボックス ── */
    const chkWrap = document.createElement('label');
    chkWrap.className = 'master-node-chk-wrap';
    chkWrap.addEventListener('click', e => e.stopPropagation());
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.className = 'master-node-chk';
    chk.checked = masterSelectedNodeIds.has(node.id);
    chk.addEventListener('change', e => {
      if (e.target.checked) masterSelectedNodeIds.add(node.id);
      else masterSelectedNodeIds.delete(node.id);
      syncMasterBulkToolbar();
    });
    chkWrap.appendChild(chk);

    /* ── 展開トグル ── */
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'master-node-toggle' + (!hasChildren || depth >= companyLevels.length ? ' is-leaf' : '');
    toggle.innerHTML = '<i class="fa-solid fa-chevron-down"></i>';
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      if (wrap.classList.toggle('is-expanded')) _companyExpandedIds.add(node.id);
      else                                      _companyExpandedIds.delete(node.id);
    });

    /* ── アイコン ── */
    const icon = document.createElement('i');
    icon.className = `master-node-icon ${lv.icon}`;

    /* ── 名前 ── */
    const nameEl = document.createElement('span');
    nameEl.className = 'master-node-name';
    nameEl.textContent = currentName;
    if (currentName !== node.name) {
      const old = document.createElement('small');
      old.style.cssText = 'color:var(--c-text-3);font-weight:normal;margin-left:4px';
      old.textContent = `(現: ${node.name})`;
      nameEl.appendChild(old);
    }

    /* ── レベルバッジ ── */
    const lvBadge = document.createElement('span');
    lvBadge.className = 'master-node-level-badge company-badge-level';
    if (depth === 0) {
      const levelSummary = companyLevels.map(l => l.label).join('／');
      lvBadge.textContent = _rootLabel;
      lvBadge.title = `階層構造：${levelSummary}`;
    } else {
      if (node.nodeType === 'company') {
        lvBadge.textContent = '会社';
        lvBadge.style.background = 'var(--c-primary-xl)';
        lvBadge.style.color = 'var(--c-primary-d)';
        lvBadge.style.borderColor = 'rgba(37,99,235,0.2)';
        lvBadge.title = `種別：会社`;
      } else if (node.nodeType === 'facility') {
        lvBadge.textContent = '事業所';
        lvBadge.style.background = 'rgba(16,185,129,0.1)';
        lvBadge.style.color = 'var(--c-success)';
        lvBadge.style.borderColor = 'rgba(16,185,129,0.2)';
        lvBadge.title = `種別：事業所`;
      } else {
        lvBadge.textContent = lv.label;
      }
    }

    /* ── 登録数バッジ ── */
    const cntBadgeEl = document.createElement('span');
    cntBadgeEl.className = 'master-node-emp-count master-item-count company-badge-emp';
    const empCnt = getMasterNodeEmpCount('company', node.name, depth, node);
    cntBadgeEl.textContent = empCnt + '名';
    if (empCnt === 0) cntBadgeEl.dataset.zero = 'true';

    /* ── ヘッド組み立て ── */
    const head = document.createElement('div');
    head.className = 'master-node-head';
    head.append(dragHandle, chkWrap, toggle, icon, nameEl, lvBadge, cntBadgeEl);

    // ダブルクリックで編集モードへ移行（ボタン等を除外）
    head.addEventListener('dblclick', e => {
      if (e.target.closest('button') || e.target.closest('.master-node-drag')) return;
      e.stopPropagation();
      openMasterNodeModal('company', node.id, parentId, depth, rootNode);
    });

    /* ── 会社ルート：階層構造インジケーター ── */
    if (depth === 0 && companyLevels.length > 0) {
      const lvStrip = document.createElement('div');
      lvStrip.className = 'company-level-strip company-badge-strip';
      companyLevels.forEach((cl, i) => {
        const pill = document.createElement('span');
        pill.className = 'company-level-pill';
        pill.textContent = `L${i + 1}：${cl.label}`;
        lvStrip.appendChild(pill);
        if (i < companyLevels.length - 1) {
          const sep = document.createElement('i');
          sep.className = 'fa-solid fa-angle-right';
          sep.style.cssText = 'font-size:9px;opacity:.4;margin:0 3px;color:var(--c-text-3)';
          lvStrip.appendChild(sep);
        }
      });
      head.appendChild(lvStrip);
    }

    /* ── 期間バッジ ── */
    if (node.foundedDate || node.dissolvedDate) {
      const banner = document.createElement('span');
      banner.className = 'master-node-dates-badge company-badge-date' + (status !== 'active' ? ' is-dissolved' : '');
      if (status === 'dissolved')
        banner.innerHTML = `<i class="fa-solid fa-xmark"></i>解散（${_fmtDate(node.dissolvedDate)}）`;
      else if (status === 'prefounded')
        banner.innerHTML = `<i class="fa-solid fa-hourglass-start"></i>設立前（${_fmtDate(node.foundedDate)}）`;
      else {
        const fd = _fmtDate(node.foundedDate) || '—';
        const dd = node.dissolvedDate ? _fmtDate(node.dissolvedDate) : '現在';
        banner.innerHTML = `<i class="fa-solid fa-calendar-check"></i>${fd}〜${dd}`;
      }
      head.appendChild(banner);
    }

    /* ── コーポレートイベントバッジ（全階層対応・_activeEvent は上部で計算済み） ── */
    if (_activeEvent && _activeEvent.relatedCompanyId) {
      const rcfg = CORP_REL_CONFIG[_activeEvent.type] || CORP_REL_CONFIG['subsidiary'];
      const relatedNode = (DB.masters.company || []).find(c => c.id === _activeEvent.relatedCompanyId);
      if (relatedNode) {
        const corpBadge = document.createElement('span');
        corpBadge.className = 'master-node-corp-badge company-badge-corp';
        corpBadge.style.setProperty('--badge-color', rcfg.color);
        // relLabel: このノード側から見た関係（例: 親会社）。label はアコーディオン側（例: 子会社）と使い分け
        const dispLabel = rcfg.relLabel || rcfg.label;
        corpBadge.innerHTML = `<i class="${rcfg.icon}"></i>${dispLabel}：${relatedNode.name}`;
        corpBadge.title = _activeEvent.note || `${dispLabel}：${relatedNode.name}`;
        head.appendChild(corpBadge);
      }
    }

    /* ── 売却・脱退バッジ（ルートノードのみ） ── */
    if (_isSoldNode && _activeEvent) {
      const rcfg = CORP_REL_CONFIG[_activeEvent.type];
      const relNode = _activeEvent.relatedCompanyId
        ? (DB.masters.company || []).find(c => c.id === _activeEvent.relatedCompanyId) : null;
      const soldBadge = document.createElement('span');
      soldBadge.className = 'master-node-sold-badge company-badge-sold';
      soldBadge.style.setProperty('--sold-color', rcfg.color);
      const dispLabel = rcfg.relLabel || rcfg.label;
      soldBadge.innerHTML = `<i class="${rcfg.icon}"></i>${dispLabel}${relNode ? '：' + relNode.name : ''}`;
      if (_activeEvent.note) soldBadge.title = _activeEvent.note;
      head.appendChild(soldBadge);
    }

    /* ── アクションボタン ── */
    const acts = document.createElement('div');
    acts.className = 'master-node-acts';
    acts.style.marginLeft = 'auto';

    if (depth < companyLevels.length) {
      const addChildBtn = document.createElement('button');
      addChildBtn.type = 'button';
      addChildBtn.className = 'master-node-btn';
      const nextLvLabel = companyLevels[depth]?.label || '組織';
      addChildBtn.innerHTML = `<i class="fa-solid fa-plus"></i>${nextLvLabel}を追加`;
      addChildBtn.addEventListener('click', e => { e.stopPropagation(); openMasterNodeModal('company', null, node.id, depth + 1, rootNode); });
      acts.appendChild(addChildBtn);
    }

    // 会社ルートノード（depth=0）には「階層設定」ボタンを追加
    if (depth === 0) {
      const levelBtn = document.createElement('button');
      levelBtn.type = 'button';
      levelBtn.className = 'master-node-btn';
      levelBtn.innerHTML = '<i class="fa-solid fa-layer-group"></i>階層設定';
      levelBtn.title = 'この会社の組織階層名を設定';
      levelBtn.addEventListener('click', e => { e.stopPropagation(); openCompanyLevelCfgModal(node); });
      acts.appendChild(levelBtn);
    }

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'master-node-btn';
    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.title = '編集';
    editBtn.addEventListener('click', e => { e.stopPropagation(); openMasterNodeModal('company', node.id, null, depth, node); });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'master-node-btn del';
    delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    delBtn.title = '削除';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      const childCount = masterFlatten(node.children || []).length;
      const msg = childCount
        ? `「${node.name}」とその配下 ${childCount} 件をすべて削除しますか？`
        : `「${node.name}」を削除しますか？`;
      openConfirm(msg, () => {
        masterDeleteNode(DB.masters.company, node.id);
        saveDB(); closeModal('confirm-modal'); renderMasterView();
        toast(`「${node.name}」を削除しました`);
      }, { title: '削除の確認', icon: 'fa-solid fa-triangle-exclamation', iconColor: 'var(--c-danger)',
           innerIcon: 'fa-solid fa-trash-can', innerColor: 'var(--c-danger)',
           okLabel: '削除する', okIcon: 'fa-solid fa-trash-can', okClass: 'btn btn-danger' });
    });

    acts.append(editBtn, delBtn);
    head.appendChild(acts);
    wrap.appendChild(head);

    /* ── D&D（クロス階層対応） ── */
    head.addEventListener('mousedown', e => {
      if (e.target.closest('button, input, label.master-node-chk-wrap')) return;
      wrap.draggable = true;
    });
    wrap.addEventListener('dragstart', e => {
      e.stopPropagation();
      if (!masterSelectedNodeIds.has(node.id)) {
        _mDragIds = [node.id];
      } else {
        _mDragIds = Array.from(masterSelectedNodeIds);
      }
      _mDragParentId = parentId || '';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
      setTimeout(() => wrap.classList.add('is-dragging'), 0);
    });
    wrap.addEventListener('dragend', e => {
      e.stopPropagation();
      wrap.draggable = false;
      wrap.classList.remove('is-dragging');
      clearAllDragIndicators();
      _mDragIds = []; _mDragParentId = null;
    });
    wrap.addEventListener('dragover', e => {
      if (_mDragIds.length === 0 || _mDragIds.includes(node.id)) return;
      // 循環参照ガード
      if (_mDragIds.some(id => masterIsDescendantOf('company', id, node.id))) return;
      e.preventDefault(); e.stopPropagation();
      clearAllDragIndicators();
      const canAdopt = depth < companyLevels.length;
      const mode = _getDragDropMode(e, wrap, canAdopt);
      wrap.dataset.dropMode = mode;
      if      (mode === 'top')    wrap.classList.add('drag-over-top');
      else if (mode === 'bottom') wrap.classList.add('drag-over-bottom');
      else                        wrap.classList.add('drag-over-into');
    });
    wrap.addEventListener('dragleave', e => {
      if (!wrap.contains(e.relatedTarget)) {
        wrap.classList.remove('drag-over-top','drag-over-bottom','drag-over-into');
        delete wrap.dataset.dropMode;
      }
    });
    wrap.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      if (_mDragIds.length === 0 || _mDragIds.includes(node.id)) return;
      if (_mDragIds.some(id => masterIsDescendantOf('company', id, node.id))) return;

      const mode = wrap.dataset.dropMode || 'bottom';
      clearAllDragIndicators();

      let targetParentId = null;
      let insertBeforeId = null;
      let insertAfter = false;

      if (mode === 'into') {
        targetParentId = node.id;
        insertBeforeId = null;
      } else {
        targetParentId = parentId || null;
        insertBeforeId = node.id;
        insertAfter = (mode === 'bottom');
      }

      _triggerBulkMasterMoveWithConfirm('company', _mDragIds, targetParentId, insertBeforeId, insertAfter);
    });

    /* ── 従業員コンパクト表示（micro variant） ── */
    if (showEmp && status === 'active') {
      const emps = getCompanyEmployeesAtDate(nodePath, date, nodeRefs);
      if (emps.length > 0) {
        const empArea = document.createElement('div');
        empArea.className = 'company-node-emp-area';
        const cards = document.createElement('div');
        cards.className = 'dist-cards';
        // 組織ツリー内は名前＋在籍状況のみのmicro表示
        const microBadges = { gender:false, attribute:false, status:false,
          hireType:false, course:false, age:false, years:false,
          tags:false, company:false, education:false, school:false, orgStatus:true };
        emps.forEach(emp => cards.appendChild(buildCard(emp, microBadges, 'm')));
        empArea.appendChild(cards);
        wrap.appendChild(empArea);
      }
    }

    /* ── 子ノード ── */
    if (depth < companyLevels.length) {
      const childWrap = document.createElement('div');
      childWrap.className = 'master-node-children';
      childrenArr.forEach(c => {
        const childEl = buildCompanyNode(c, depth + 1, nodePath, node.id, rootNode, nodeRefs);
        childWrap.appendChild(childEl);
        // この部門ノード配下に配置された関連会社を注入（childrenByNode 対応）
        _injectSubCompaniesToDivision(childEl, rootNode.id, c.id);
      });
      const nextLvLabel2 = companyLevels[depth]?.label || '組織';
      const addChildBtn2 = document.createElement('button');
      addChildBtn2.type = 'button';
      addChildBtn2.className = 'master-node-add-btn';
      addChildBtn2.innerHTML = `<i class="fa-solid fa-plus"></i>${nextLvLabel2}を追加`;
      addChildBtn2.addEventListener('click', () => openMasterNodeModal('company', null, node.id, depth + 1, rootNode));
      childWrap.appendChild(addChildBtn2);
      wrap.appendChild(childWrap);
    }

    return wrap;
  }

  // ── コーポレートツリー（親子会社関係）を考慮して描画 ──
  const corpHier = _buildCorporateHierarchy(roots, date);

/**
   * 部門ノード配下に配置された関連会社（childrenByNode）をアコーディオンで注入する。
   * @param {HTMLElement} divEl    - 注入先の部門ノード要素
   * @param {string}      rootId  - ルート会社ノードID
   * @param {string}      nodeId  - 部門ノードID
   */
  function _injectSubCompaniesToDivision(divEl, rootId, nodeId) {
    const key = `${rootId}::${nodeId}`;
    const subDefs = corpHier.childrenByNode?.[key];
    if (!subDefs || !subDefs.length) return;
    const activeDefs = date !== null
      ? subDefs.filter(({ node: cn }) => getCompanyStatusAtDate(cn, date) === 'active')
      : showDissolved
        ? subDefs
        : subDefs.filter(({ node: cn }) => getCompanyStatusAtDate(cn, null) !== 'dissolved');
    if (!activeDefs.length) return;

    const isCollapsed = _corpChildCollapsedIds.has(`div::${nodeId}`);
    const accordion = document.createElement('div');
    accordion.className = 'corp-sub-accordion corp-sub-accordion--dept' + (isCollapsed ? '' : ' is-expanded');

    const accBtn = document.createElement('button');
    accBtn.type = 'button';
    accBtn.className = 'corp-sub-acc-btn corp-sub-acc-btn--sm';
    accBtn.innerHTML = `
      <i class="fa-solid fa-code-branch"></i>
      <span>配下の関連会社</span>
      <span class="corp-sub-acc-badge">${activeDefs.length}</span>
      <i class="fa-solid fa-chevron-down corp-sub-acc-chevron"></i>
    `;
    accBtn.addEventListener('click', e => {
      e.stopPropagation();
      const dKey = `div::${nodeId}`;
      const expanded = accordion.classList.toggle('is-expanded');
      if (expanded) _corpChildCollapsedIds.delete(dKey);
      else          _corpChildCollapsedIds.add(dKey);
    });

    const corpWrap = document.createElement('div');
    corpWrap.className = 'corp-children-wrap corp-children-wrap--dept';
    activeDefs.forEach(({ node: childNode, event: childEv }) => {
      const rcfg = CORP_REL_CONFIG[childEv.type] || CORP_REL_CONFIG['subsidiary'];
      const dateStr = childEv.date
        ? `<span class="corp-rel-date">${_fmtDate(childEv.date)}${childEv.endDate ? '〜' + _fmtDate(childEv.endDate) : '〜'}</span>`
        : '';
      const noteStr = childEv.note ? `<span class="corp-rel-note">${childEv.note}</span>` : '';
      const relBar = document.createElement('div');
      relBar.className = 'corp-relation-bar company-badge-rel';
      relBar.innerHTML = `<i class="${rcfg.icon}" style="color:${rcfg.color}"></i><span class="corp-rel-label" style="color:${rcfg.color}">${rcfg.label}</span>${dateStr}${noteStr}`;
      corpWrap.appendChild(relBar);
      const childEl = renderCorpNode(childNode);
      if (childEl) { childEl.classList.add('is-corp-child'); corpWrap.appendChild(childEl); }
    });

    accordion.appendChild(accBtn);
    accordion.appendChild(corpWrap);
    divEl.appendChild(accordion);
  }

  /**
   * 会社ルートノード（depth=0）をコーポレート階層付きで再帰レンダリング。
   * ① 部門化（internalize）されたノードを組織ツリー内に注入
   * ② 子会社等（subsidiary 等）を corp-children-wrap に追記
   */
  function renderCorpNode(companyNode) {
    // ── 履歴モード：未設立・解散済みは完全非表示 ──
    if (date !== null && getCompanyStatusAtDate(companyNode, date) !== 'active') return null;

    // ── 現在モード：解散済み・グループ離脱済みをトグルOFF時は非表示 ──
    if (date === null && !showDissolved) {
      const status = getCompanyStatusAtDate(companyNode, null);
      const isSold = corpHier.soldSet?.has(companyNode.id);
      if (status === 'dissolved' || isSold) return null;
    }

    const el = buildCompanyNode(companyNode, 0, [], '', companyNode);
    if (!el) return null;

    // ── 部門化されたノードをこの会社の組織ツリー内に注入 ──
    const internalizedNodes = corpHier.internalizedMap?.[companyNode.id] || [];
    if (internalizedNodes.length) {
      const activeIntNodes = date !== null
        ? internalizedNodes.filter(({ node: n }) => getCompanyStatusAtDate(n, date) === 'active')
        : internalizedNodes;
      if (activeIntNodes.length) {
        const intWrap = document.createElement('div');
        intWrap.className = 'internalized-depts-wrap';
        activeIntNodes.forEach(({ node: intNode, event: intEv }) => {
          const intCfg = CORP_REL_CONFIG['internalize'];
          const dateStr = intEv.date
            ? _fmtDate(intEv.date) + (intEv.endDate ? '〜' + _fmtDate(intEv.endDate) : '〜現在')
            : '';
          const intHeader = document.createElement('div');
          intHeader.className = 'internalized-dept-header';
          intHeader.innerHTML = `
            <i class="${intCfg.icon}" style="color:${intCfg.color}"></i>
            <span class="int-dept-label" style="color:${intCfg.color}">${intCfg.label}</span>
            ${dateStr ? `<span class="corp-rel-date">${dateStr}</span>` : ''}
            ${intEv.note ? `<span class="corp-rel-note">${intEv.note}</span>` : ''}
          `;
          intWrap.appendChild(intHeader);
          intWrap.appendChild(buildCompanyNode(intNode, 0, [], '', intNode));
        });
        const childrenDiv = el.querySelector(':scope > .master-node-children');
        if (childrenDiv) childrenDiv.appendChild(intWrap);
        else el.appendChild(intWrap);
      }
    }

    // ── コーポレートツリー子（子会社・合併等）── アコーディオン化
    const childDefs = corpHier.children[companyNode.id];
    if (childDefs && childDefs.length) {
      // 履歴モードでは存在する会社のみに絞り込む
      const activeChildDefs = date !== null
        ? childDefs.filter(({ node: cn }) => getCompanyStatusAtDate(cn, date) === 'active')
        : childDefs;

      if (activeChildDefs.length) {
        const isCollapsed = _corpChildCollapsedIds.has(companyNode.id);

        // アコーディオンラッパー
        const accordion = document.createElement('div');
        accordion.className = 'corp-sub-accordion' + (isCollapsed ? '' : ' is-expanded');

        // アコーディオンヘッダー（トグルボタン）
        const accBtn = document.createElement('button');
        accBtn.type = 'button';
        accBtn.className = 'corp-sub-acc-btn';
        accBtn.innerHTML = `
          <i class="fa-solid fa-code-branch"></i>
          <span>関連会社・子会社</span>
          <span class="corp-sub-acc-badge">${activeChildDefs.length}</span>
          <i class="fa-solid fa-chevron-down corp-sub-acc-chevron"></i>
        `;
        accBtn.addEventListener('click', e => {
          e.stopPropagation();
          const expanded = accordion.classList.toggle('is-expanded');
          if (expanded) _corpChildCollapsedIds.delete(companyNode.id);
          else          _corpChildCollapsedIds.add(companyNode.id);
        });

        // 子会社リスト
        const corpWrap = document.createElement('div');
        corpWrap.className = 'corp-children-wrap';
        activeChildDefs.forEach(({ node: childNode, event: childEv }) => {
          const rcfg = CORP_REL_CONFIG[childEv.type] || CORP_REL_CONFIG['subsidiary'];
          const dateStr = childEv.date
            ? `<span class="corp-rel-date">${_fmtDate(childEv.date)}${childEv.endDate ? '〜' + _fmtDate(childEv.endDate) : '〜'}</span>`
            : '';
          const noteStr = childEv.note ? `<span class="corp-rel-note">${childEv.note}</span>` : '';
          const relBar = document.createElement('div');
          relBar.className = 'corp-relation-bar company-badge-rel';
          relBar.innerHTML = `<i class="${rcfg.icon}" style="color:${rcfg.color}"></i><span class="corp-rel-label" style="color:${rcfg.color}">${rcfg.label}</span>${dateStr}${noteStr}`;
          corpWrap.appendChild(relBar);
          // 再帰レンダリング（孫会社も含む）
          const childEl = renderCorpNode(childNode);
          if (childEl) {
            childEl.classList.add('is-corp-child'); // 子会社の色分け用クラス
            corpWrap.appendChild(childEl);
          }
        });

        accordion.appendChild(accBtn);
        accordion.appendChild(corpWrap);
        el.appendChild(accordion);
      }
    }
    return el;
  }

  corpHier.topLevel.forEach(root => {
    const el = renderCorpNode(root);
    if (el) tree.appendChild(el);
  });
}

function _syncCompanyTimeline() {
  const isHistory = (_ctl.mode === 'history');
  document.getElementById('company-tl-now').classList.toggle('active', !isHistory);
  document.getElementById('company-tl-history').classList.toggle('active', isHistory);
  document.getElementById('company-tl-slider-section').classList.toggle('is-active', isHistory);

  const slider = document.getElementById('company-tl-range');
  const maxIdx = Math.max(0, _ctl.dates.length - 1);
  slider.max   = maxIdx;
  slider.value = Math.max(0, Math.min(_ctl.idx, maxIdx));
  slider.style.setProperty('--progress', maxIdx > 0 ? `${(slider.value / maxIdx) * 100}%` : '100%');

  document.getElementById('company-tl-start').textContent = _ctl.dates[0] || '—';
  document.getElementById('company-tl-end').textContent   = _ctl.dates[_ctl.dates.length - 1] || '—';

  const textEl = document.getElementById('company-tl-date-text');
  if (!isHistory || _ctl.idx < 0) {
    textEl.textContent = '現在の状態';
    document.getElementById('company-tl-date-disp').classList.remove('is-date');
  } else {
    textEl.textContent = _ctl.dates[_ctl.idx];
    document.getElementById('company-tl-date-disp').classList.add('is-date');
  }

  // ── スライダー目盛り（ticks）描画 ──
  const ticksEl = document.getElementById('company-tl-ticks');
  if (ticksEl && isHistory && _ctl.dates.length > 1) {
    ticksEl.innerHTML = '';
    // 最大20本まで均等に間引く
    const total    = _ctl.dates.length;
    const maxTicks = Math.min(total, 20);
    const step     = (total - 1) / (maxTicks - 1 || 1);
    const shown    = new Set();
    for (let i = 0; i < maxTicks; i++) {
      shown.add(Math.round(i * step));
    }
    shown.forEach(i => {
      const tick = document.createElement('div');
      tick.className = 'org-tl-tick' + (i === parseInt(slider.value) ? ' is-active' : '');
      tick.style.left = `${(i / (total - 1)) * 100}%`;
      tick.title = _ctl.dates[i];
      ticksEl.appendChild(tick);
    });
  } else if (ticksEl) {
    ticksEl.innerHTML = '';
  }
}

// タイムラインイベント登録
document.getElementById('company-tl-now')?.addEventListener('click', () => { _ctl.mode = 'now'; renderCompanyMasterView(); });
document.getElementById('company-tl-history')?.addEventListener('click', () => { _ctl.mode = 'history'; if(_ctl.idx < 0) _ctl.idx = Math.max(0, _ctl.dates.length-1); renderCompanyMasterView(); });
document.getElementById('company-tl-range')?.addEventListener('input', e => {
  _ctl.idx = parseInt(e.target.value);
  _syncCompanyTimeline();
  if (_companyDebounce) clearTimeout(_companyDebounce);
  _companyDebounce = setTimeout(() => renderCompanyMasterView(), 150);
});
document.getElementById('company-tog-emp')?.addEventListener('change', e => {
  const label = document.getElementById('company-tog-emp');
  if (label) label.classList.toggle('is-on', e.target.checked);
  renderCompanyMasterView();
});
document.getElementById('company-tog-dissolved')?.addEventListener('change', e => {
  const label = document.getElementById('company-tog-dissolved');
  if (label) label.classList.toggle('is-on', e.target.checked);
  renderCompanyMasterView();
});


function initMasterEvents() {
  // ── 会社マスタ固有のUIイベント ──
  document.querySelectorAll('input[name="mnm-cef-type-r"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const hidden = document.getElementById('mnm-cef-type');
      if (hidden) hidden.value = radio.value;
      document.querySelectorAll('#mnm-cef-type-grid .corp-rel-card').forEach(c =>
        c.classList.toggle('is-selected', c.dataset.val === radio.value));
      _syncCefRelatedRow();
    });
  });

  document.querySelectorAll('#mnm-cef-type-grid .corp-rel-card').forEach(card => {
    card.addEventListener('click', () => {
      const val = card.dataset.val;
      const r = document.querySelector(`input[name="mnm-cef-type-r"][value="${val}"]`);
      if (r) { r.checked = true; r.dispatchEvent(new Event('change')); }
    });
  });

  document.getElementById('mnm-cef-related-select')?.addEventListener('change', e => {
    const curNodeVal = document.getElementById('mnm-cef-related-node-select')?.value || '';
    _syncCefRelatedNodeSelect(e.target.value, curNodeVal);
  });

  // ノード種別変更によるイベントサジェスト
  document.querySelectorAll('input[name="mnm-node-type"]').forEach(r => {
    r.addEventListener('change', e => {
      const origType = document.getElementById('mnm-node-type-row')?.dataset.originalType;
      const newType = e.target.value;
      if (!origType || origType === newType) return;
      
      let suggestEvType = '', suggestNote = '';
      if (origType === 'department' && newType === 'company') { suggestEvType = 'spinoff'; suggestNote = '部門から独立・会社化'; } 
      else if (origType === 'company' && newType === 'department') { suggestEvType = 'internalize'; suggestNote = '会社から部門へ統合'; }
      
      if (suggestEvType) {
        _openCorporateEventForm(-1);
        setTimeout(() => {
          const typeHidden = document.getElementById('mnm-cef-type');
          if (typeHidden) typeHidden.value = suggestEvType;
          document.querySelectorAll('#mnm-cef-type-grid .corp-rel-card').forEach(c => c.classList.toggle('is-selected', c.dataset.val === suggestEvType));
          const noteInp = document.getElementById('mnm-cef-note');
          if (noteInp && !noteInp.value) noteInp.value = suggestNote;
          _syncCefRelatedRow();
          if (typeof toast !== 'undefined') toast('ノード種別が変更されました。組織イベントの登録を推奨します。');
        }, 80);
      }
    });
  });

  document.getElementById('btn-mnm-add-corp-event')?.addEventListener('click', () => _openCorporateEventForm(-1));
  document.getElementById('btn-mnm-cef-save')?.addEventListener('click', _saveCorporateEventForm);
  document.getElementById('btn-mnm-cef-cancel')?.addEventListener('click', _closeCorporateEventForm);

  // mnm-tabs のタブ切り替え（会社マスタモーダル）
  document.getElementById('mnm-tabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.modal-tab');
    if (!tab) return;
    const paneId = tab.dataset.pane;
    document.querySelectorAll('#mnm-tabs .modal-tab').forEach(t => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('#master-node-modal .modal-tab-pane').forEach(p => p.classList.toggle('is-active', p.id === paneId));
  });

  // ── マスタ管理共通のUIイベント ──
  document.getElementById('btn-master-cnt-toggle')?.addEventListener('click', () => {
    DB.settings.masterCountBadge = !DB.settings.masterCountBadge;
    saveDB(); syncMasterCountBadgeUI(); renderMasterView();
  });

  document.querySelectorAll('.master-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.master-tab').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      currentMasterType = tab.dataset.master;
      masterExpandedIds = new Set();
      masterSelectedNodeIds.clear();
      syncMasterBulkToolbar();
      _companyFilterQuery = '';
      const filterInput = document.getElementById('master-filter-input');
      if (filterInput) filterInput.value = '';
      _updateMasterFilterClearBtn();
      _hideCompanySearchDD();
      const fa = document.getElementById('flat-master-area');
      if (fa) fa.style.display = 'none';
      renderMasterView();
    });
  });

  document.getElementById('btn-master-reset')?.addEventListener('click', resetCurrentMaster);
  document.getElementById('btn-master-dup-check')?.addEventListener('click', openDataDupModal);

  document.getElementById('btn-master-add-root')?.addEventListener('click', () => {
    if (currentMasterType === 'tag') { openTagModal(); return; }
    const cfg = getMasterCfg(currentMasterType);
    if (cfg?.isFlat) { openFlatMasterModal(currentMasterType, null); return; }
    openMasterNodeModal(currentMasterType, null, null, 0);
  });

  document.getElementById('btn-mnm-save')?.addEventListener('click', saveMasterNode);
  document.getElementById('mnm-name')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveMasterNode(); });

  const filterInput = document.getElementById('master-filter-input');
  if (filterInput) {
    filterInput.addEventListener('input', e => {
      const q = e.target.value;
      _updateMasterFilterClearBtn();
      if (currentMasterType === 'tag') { applyTagFilter(q.trim()); return; }
      if (currentMasterType === 'company') { _showCompanySearchDD(q); applyCompanyFilter(q); return; }
      applyMasterFilter(q.trim());
    });
    filterInput.addEventListener('focus', () => { if (currentMasterType === 'company') _showCompanySearchDD(filterInput.value); });
    filterInput.addEventListener('blur', () => { if (_csDdMousedown) { _csDdMousedown = false; return; } _hideCompanySearchDD(); });
    filterInput.addEventListener('keydown', e => { if (e.key === 'Escape') { _hideCompanySearchDD(); filterInput.blur(); } });
  }

  document.getElementById('master-filter-clear')?.addEventListener('click', () => {
    if (filterInput) filterInput.value = '';
    _updateMasterFilterClearBtn();
    _hideCompanySearchDD();
    if (currentMasterType === 'company') applyCompanyFilter('');
    else if (currentMasterType === 'tag') applyTagFilter('');
    else applyMasterFilter('');
    if (filterInput) filterInput.focus();
  });

  const badgesBtn = document.getElementById('btn-company-badges');
  const badgesPanel = document.getElementById('company-badge-panel');
  const badgesChevron = document.getElementById('company-badges-chevron');
  if (badgesBtn && badgesPanel) {
    badgesBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (badgesPanel.style.display !== 'none') {
        badgesPanel.style.display = 'none'; badgesBtn.classList.remove('is-open');
        if (badgesChevron) badgesChevron.style.transform = '';
      } else {
        badgesPanel.style.display = ''; badgesBtn.classList.add('is-open');
        if (badgesChevron) badgesChevron.style.transform = 'rotate(180deg)';
      }
    });
    document.addEventListener('click', e => {
      if (!badgesBtn.contains(e.target) && !badgesPanel.contains(e.target)) {
        badgesPanel.style.display = 'none'; badgesBtn.classList.remove('is-open');
        if (badgesChevron) badgesChevron.style.transform = '';
      }
    });
    badgesPanel.querySelectorAll('.cbp-row').forEach(row => {
      row.addEventListener('click', () => {
        const key = row.dataset.badge; const badges = _getCompanyBadges();
        badges[key] = !badges[key]; saveDB(); syncCompanyBadgeUI();
      });
    });
    document.getElementById('cbp-btn-all-on')?.addEventListener('click', e => {
      e.stopPropagation(); const badges = _getCompanyBadges();
      Object.keys(COMPANY_BADGE_DEFAULTS).forEach(k => { badges[k] = true; });
      saveDB(); syncCompanyBadgeUI();
    });
    document.getElementById('cbp-btn-all-off')?.addEventListener('click', e => {
      e.stopPropagation(); const badges = _getCompanyBadges();
      Object.keys(COMPANY_BADGE_DEFAULTS).forEach(k => { badges[k] = false; });
      saveDB(); syncCompanyBadgeUI();
    });
  }

  document.getElementById('btn-bulk-clear')?.addEventListener('click', () => {
    masterSelectedNodeIds.clear();
    syncMasterBulkToolbar();
    renderMasterView();
  });

  document.getElementById('btn-level-cfg')?.addEventListener('click', () => openLevelCfgModal(currentMasterType));
  document.getElementById('btn-lcm-save')?.addEventListener('click', saveLevelCfg);
  document.getElementById('btn-lcm-add')?.addEventListener('click', () => addLcmRow());

  document.getElementById('btn-sort-asc')?.addEventListener('click', () => masterSortByName(currentMasterType, 'asc'));
  document.getElementById('btn-sort-desc')?.addEventListener('click', () => masterSortByName(currentMasterType, 'desc'));

  // 住所フィールドのジオコード確認（デバウンス 800ms）
  let _mnmAddrTimer = null;
  document.getElementById('mnm-address')?.addEventListener('input', () => {
    const statusEl = document.getElementById('mnm-geo-status');
    const addr = document.getElementById('mnm-address')?.value.trim();
    if (!addr) { if (statusEl) statusEl.style.display = 'none'; return; }
    clearTimeout(_mnmAddrTimer);
    _mnmAddrTimer = setTimeout(() => {
      if (typeof validateAddressUI === 'function') validateAddressUI(addr, statusEl);
    }, 800);
  });

  initLassoSelection();
}

/* ================================================================
   DATA DUPLICATE CHECK & MERGE
================================================================ */
function detectDataDuplicates() {
  const duplicates = [];

  // Flat Masters
  ['status', 'attribute', 'hireType', 'course'].forEach(type => {
    const items = DB.masters[type] || [];
    const groups = {};
    items.forEach(i => {
      const norm = normalizeForDuplicate(i.name);
      groups[norm] = groups[norm] || [];
      groups[norm].push(i);
    });
    const dups = Object.entries(groups).filter(([k, v]) => v.length > 1);
    if (dups.length) {
      duplicates.push({ type, isFlat: true, isEmp: false, label: MASTER_CFG[type].label, groups: dups });
    }
  });

  // Tree Masters
  ['school', 'company', 'position'].forEach(type => {
    const groups = {};
    function traverse(nodes, parentPath) {
      nodes.forEach(n => {
        const normName = normalizeForDuplicate(n.name);
        const path = [...parentPath, normName].join('>');
        groups[path] = groups[path] || [];
        groups[path].push({ node: n, pathDisplay: [...parentPath, n.name].join(' ＞ ') });
        if (n.children) traverse(n.children, [...parentPath, n.name]);
      });
    }
    traverse(DB.masters[type] || [], []);
    const dups = Object.entries(groups).filter(([k, v]) => v.length > 1);
    if (dups.length) {
      const mappedDups = dups.map(([k, v]) => [v[0].pathDisplay, v.map(x => x.node)]);
      duplicates.push({ type, isFlat: false, isEmp: false, label: MASTER_CFG[type].label, groups: mappedDups });
    }
  });

  // Tags
  {
    const groups = {};
    DB.tags.forEach(t => {
      const norm = normalizeForDuplicate(t.name);
      const path = t.parentId ? `${t.parentId}>${norm}` : norm;
      groups[path] = groups[path] || [];
      groups[path].push(t);
    });
    const dups = Object.entries(groups).filter(([k, v]) => v.length > 1);
    if (dups.length) {
      duplicates.push({ type: 'tag', isFlat: true, isEmp: false, label: 'タグマスタ', groups: dups });
    }
  }

  // Employees
  {
    const groups = {};
    DB.employees.forEach(e => {
      const normLast = normalizeForDuplicate(e.lastName);
      const normFirst = normalizeForDuplicate(e.firstName);
      const key = `${normLast}\x00${normFirst}`;
      groups[key] = groups[key] || [];
      groups[key].push(e);
    });
    const dups = Object.entries(groups).filter(([k, v]) => v.length > 1);
    if (dups.length) {
      duplicates.push({ type: 'employee', isFlat: false, isEmp: true, label: '従業員データ', groups: dups });
    }
  }

  return duplicates;
}

let currentDupData = [];

function openDataDupModal() {
  const dups = detectDataDuplicates();
  currentDupData = dups;
  const container = document.getElementById('data-dup-list-container');
  const execBtn = document.getElementById('btn-exec-data-dup');
  if (!container || !execBtn) return;
  
  container.innerHTML = '';
  if (dups.length === 0) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--c-text-3);"><i class="fa-solid fa-circle-check" style="font-size:36px;margin-bottom:12px;color:var(--c-success)"></i><br><p style="font-size:14px">重複・表記ゆれ項目は見つかりませんでした。<br>データは正常に正規化されています。</p></div>';
    execBtn.style.display = 'none';
  } else {
    execBtn.style.display = '';
    let globalGroupIndex = 0;
    
    dups.forEach((dup, dIdx) => {
      const box = document.createElement('div');
      box.className = 'dup-group-box';
      const hd = document.createElement('div');
      hd.className = 'dup-group-hd';
      const icon = dup.isEmp ? 'fa-solid fa-users' : (MASTER_CFG[dup.type]?.icon || 'fa-solid fa-tags');
      hd.innerHTML = `<i class="${icon}"></i>${dup.label} <span class="badge" style="margin-left:auto;background:var(--c-warn-l);color:var(--c-warn-d)">${dup.groups.length}件の重複</span>`;
      box.appendChild(hd);
      
      const body = document.createElement('div');
      body.className = 'dup-group-body';
      
      dup.groups.forEach(([pathOrName, items]) => {
        const row = document.createElement('div');
        row.className = 'dup-item-row';
        
        const sortedItems = [...items].sort((a, b) => {
          if (dup.isEmp) {
            const al = (a.lastName+a.firstName).length;
            const bl = (b.lastName+b.firstName).length;
            if (al !== bl) return bl - al; 
            return (b.transfers?.length||0) - (a.transfers?.length||0);
          } else {
            const aChild = a.children ? a.children.length : 0;
            const bChild = b.children ? b.children.length : 0;
            if (bChild !== aChild) return bChild - aChild;
            return b.name.length - a.name.length;
          }
        });
        const primaryId = sortedItems[0].id;
        const radioGroupName = `dup_grp_${globalGroupIndex++}`;
        
        const candHtml = sortedItems.map((it) => {
          const isPrimary = it.id === primaryId;
          let dispName = '';
          let badge = '';
          if (dup.isEmp) {
            dispName = `${it.lastName} ${it.firstName}`;
            const s = getEmpActiveState(it);
            const org = s.orgLevels.join(' › ') || '所属なし';
            badge = `<span class="dup-cand-badge">${org}</span> <span class="dup-cand-badge">${it.status||'状態不明'}</span>`;
          } else {
            dispName = it.name;
            const childCnt = it.children ? it.children.length : 0;
            if (childCnt > 0) badge = `<span class="dup-cand-badge">配下: ${childCnt}件</span>`;
            if (it.corporateEvents && it.corporateEvents.length > 0) badge += `<span class="dup-cand-badge">イベント: ${it.corporateEvents.length}件</span>`;
          }
          
          return `
            <label class="dup-cand-row">
              <input type="radio" name="${radioGroupName}" value="${it.id}" class="dup-cand-radio" data-type="${dup.type}" data-idx="${dIdx}" ${isPrimary ? 'checked' : ''}>
              <div class="dup-cand-info">
                <span style="font-weight:600;min-width:120px;">${dispName}</span>
                ${badge}
                <span style="color:var(--c-text-3);font-size:10px;margin-left:auto">ID:${it.id.slice(0,6)}</span>
              </div>
            </label>
          `;
        }).join('');

        let dispPath = dup.isEmp ? `${items[0].lastName} ${items[0].firstName} 系の重複` : pathOrName;
        
        row.innerHTML = `
          <div class="dup-path-name"><i class="fa-solid fa-link" style="color:var(--c-border-d)"></i> ${dispPath}</div>
          <div class="dup-details">${candHtml}</div>
        `;
        body.appendChild(row);
      });
      box.appendChild(body);
      container.appendChild(box);
    });
  }
  
  openModal('data-dup-modal');
}

document.getElementById('btn-exec-data-dup')?.addEventListener('click', () => {
  if (!currentDupData || currentDupData.length === 0) return;
  
  let mergeCount = 0;
  
  currentDupData.forEach((dup, dIdx) => {
    const { type, isFlat, isEmp, groups } = dup;
    
    groups.forEach(([pathOrName, items]) => {
      const radioName = document.querySelector(`input.dup-cand-radio[data-type="${type}"][data-idx="${dIdx}"][value="${items[0].id}"]`)?.name;
      const checkedRadio = document.querySelector(`input[name="${radioName}"]:checked`);
      if (!checkedRadio) return; 
      
      const primaryId = checkedRadio.value;
      const primary = items.find(i => i.id === primaryId);
      const delItems = items.filter(i => i.id !== primaryId);
      const dupIds = new Set(delItems.map(d => d.id));
      
      if (isEmp) {
        delItems.forEach(d => {
          if (d.transfers) primary.transfers = [...(primary.transfers||[]), ...d.transfers];
          if (d.leaves) primary.leaves = [...(primary.leaves||[]), ...d.leaves];
          if (d.contacts) primary.contacts = [...(primary.contacts||[]), ...d.contacts];
          if (d.tags) primary.tags = [...new Set([...(primary.tags||[]), ...d.tags])];
          if (d.avatarIds) primary.avatarIds = [...new Set([...(primary.avatarIds||[]), ...d.avatarIds])];
          
          DB.employees = DB.employees.filter(e => e.id !== d.id);
          mergeCount++;
        });
      } else if (type === 'tag') {
        DB.employees.forEach(e => {
          if (e.tags) {
            let changed = false;
            e.tags = e.tags.map(tid => {
              if (dupIds.has(tid)) { changed = true; return primary.id; }
              return tid;
            });
            if (changed) e.tags = [...new Set(e.tags)];
          }
        });
        DB.tags.forEach(t => {
          if (dupIds.has(t.parentId)) t.parentId = primary.id;
        });
        DB.tags = DB.tags.filter(t => !dupIds.has(t.id));
        mergeCount += delItems.length;
      } else if (isFlat) {
        DB.masters[type] = DB.masters[type].filter(i => !dupIds.has(i.id));
        delItems.forEach(d => {
          syncEmpFlatMasterField(type, d.name, primary.name);
          mergeCount++;
        });
      } else {
        delItems.forEach(d => {
          if (d.children && d.children.length) {
            primary.children = primary.children || [];
            primary.children.push(...d.children);
          }
          if (type === 'company') {
            if (d.corporateEvents) {
              primary.corporateEvents = primary.corporateEvents || [];
              primary.corporateEvents.push(...d.corporateEvents);
            }
            if (d.oldNames) {
              primary.oldNames = primary.oldNames || [];
              primary.oldNames.push(...d.oldNames);
            }
            masterFlatten(DB.masters.company).forEach(n => {
              if (n.corporateEvents) {
                n.corporateEvents.forEach(ev => {
                  if (ev.relatedCompanyId === d.id) ev.relatedCompanyId = primary.id;
                  if (ev.relatedNodeId === d.id) ev.relatedNodeId = primary.id;
                });
              }
            });
            DB.employees.forEach(e => {
              (e.transfers||[]).forEach(tr => {
                if (Array.isArray(tr.orgLevels)) {
                  const idx = tr.orgLevels.indexOf(d.name);
                  if (idx >= 0) tr.orgLevels[idx] = primary.name;
                }
              });
            });
          }
          if (type === 'position') {
            DB.employees.forEach(e => {
              (e.transfers||[]).forEach(tr => {
                if (tr.position === d.name) tr.position = primary.name;
              });
            });
          }
          if (type === 'school') {
             DB.employees.forEach(e => {
               if (e.school === d.name) e.school = primary.name;
             });
          }
          masterDeleteNode(DB.masters[type], d.id);
          mergeCount++;
        });
      }
    });
  });

  saveDB();
  closeModal('data-dup-modal');
  renderMasterView();
  refreshAll();
  updateDupListBtn();
  toast(`${mergeCount}件の重複データを統合しました`);
});

/* ================================================================
   MASTER — LASSO SELECTION (Area Drag)
================================================================ */
let _lassoActive = false;
let _lassoStartX = 0;
let _lassoStartY = 0;
let _lassoBox = null;
let _lassoInitialSelected = new Set();

function initLassoSelection() {
  const container = document.getElementById('master-scroll');
  if (!container) return;

  container.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    // ノードヘッダーやボタン等の中では開始しない（空白領域から開始）
    if (e.target.closest('.master-node-head') || e.target.closest('.master-node-add-btn') || e.target.closest('button, input')) {
      return;
    }

    _lassoActive = true;
    _lassoStartX = e.clientX;
    _lassoStartY = e.clientY;

    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      _lassoInitialSelected = new Set(masterSelectedNodeIds);
    } else {
      _lassoInitialSelected = new Set();
      masterSelectedNodeIds.clear();
      document.querySelectorAll('.master-node-chk').forEach(chk => chk.checked = false);
      syncMasterBulkToolbar();
    }

    if (!_lassoBox) {
      _lassoBox = document.createElement('div');
      _lassoBox.className = 'lasso-selection-box';
      document.body.appendChild(_lassoBox);
    }

    _lassoBox.style.left = _lassoStartX + 'px';
    _lassoBox.style.top = _lassoStartY + 'px';
    _lassoBox.style.width = '0px';
    _lassoBox.style.height = '0px';
    _lassoBox.style.display = 'block';

    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!_lassoActive) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(_lassoStartX, currentX);
    const top = Math.min(_lassoStartY, currentY);
    const width = Math.abs(currentX - _lassoStartX);
    const height = Math.abs(currentY - _lassoStartY);

    _lassoBox.style.left = left + 'px';
    _lassoBox.style.top = top + 'px';
    _lassoBox.style.width = width + 'px';
    _lassoBox.style.height = height + 'px';

    const lassoRect = _lassoBox.getBoundingClientRect();
    const nodes = document.querySelectorAll('.master-node:not(.is-filtered-out):not([style*="display: none"])');

    let changed = false;
    nodes.forEach(node => {
      const head = node.querySelector(':scope > .master-node-head');
      if (!head) return;
      const headRect = head.getBoundingClientRect();
      const isIntersecting = !(
        lassoRect.right < headRect.left ||
        lassoRect.left > headRect.right ||
        lassoRect.bottom < headRect.top ||
        lassoRect.top > headRect.bottom
      );

      const nodeId = node.dataset.nodeId;
      if (!nodeId) return;

      const shouldBeSelected = _lassoInitialSelected.has(nodeId) || isIntersecting;

      if (masterSelectedNodeIds.has(nodeId) !== shouldBeSelected) {
        if (shouldBeSelected) {
          masterSelectedNodeIds.add(nodeId);
        } else {
          masterSelectedNodeIds.delete(nodeId);
        }
        const chk = head.querySelector('.master-node-chk');
        if (chk) chk.checked = shouldBeSelected;
        changed = true;
      }
    });

    if (changed) {
      syncMasterBulkToolbar();
    }
  });

  document.addEventListener('mouseup', () => {
    if (!_lassoActive) return;
    _lassoActive = false;
    if (_lassoBox) {
      _lassoBox.style.display = 'none';
    }
  });
}

/* ================================================================
   FLEX DATE PICKER — マスタモーダル初期化
   会社存在期間・コーポレートイベント日付
================================================================ */
function initMasterDatePickers() {
  if (typeof FlexDatePicker === 'undefined') return;
  const nf = s => (typeof normalizeFlexDate === 'function' ? normalizeFlexDate(s) : s);

  const configs = [
    { id: 'mnm-founded-date', maxPrec: 'day' },
    { id: 'mnm-dissolved-date', maxPrec: 'day' },
    { id: 'mnm-cef-start-date', maxPrec: 'month' },
    { id: 'mnm-cef-end-date', maxPrec: 'month' },
  ];

  configs.forEach(({ id, maxPrec }) => {
    const el = document.getElementById(id);
    if (el) new FlexDatePicker(el, { minPrec: 'year', maxPrec, normalize: nf });
  });
}

async function init() {
  await loadAllAvatarsToMemory();
  const hasData = await loadDB();
  if (!hasData) initSampleData();
  restoreUI();
  renderColPanel();
  renderListHeader();
  renderDistStatusFilter();
  renderList();
  initEvents();
  initWelcomeEvents();
  initMasterEvents();
  initMasterDatePickers();
  initSchoolAC();
  initPositionAC();
  initTransferCompanyAC();
  initWorkLocationAC();
  syncMasterCountBadgeUI();
  updateHeaderCnt();
  updateBackupBadge();

  // Show welcome on first launch (no welcomed flag)
  const welcomed = localStorage.getItem(WELCOME_KEY);
  if (!welcomed) openWelcome();
}

init();
