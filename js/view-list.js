'use strict';

/* ================================================================
   LIST DUPLICATE MODE STATE
================================================================ */
let listDupMode = false;
let listDupIds  = new Set();

function buildListDupSet() {
  const nameMap = new Map();
  DB.employees.forEach(e => {
    const key = `${e.lastName}\x00${e.firstName}`;
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key).push(e.id);
  });
  listDupIds = new Set();
  nameMap.forEach(ids => { if (ids.length > 1) ids.forEach(id => listDupIds.add(id)); });
  return listDupIds;
}

function toggleListDupMode() {
  updateDupListBtn(); // 先にセットを構築しUIを準備
  if (!listDupIds.size) {
    listDupMode = false;
    updateDupListBtn(); // クラス状態をリセット
    renderList();
    toast('重複する氏名はありません');
    return;
  }
  listDupMode = !listDupMode;
  updateDupListBtn();
  renderList();
  if (listDupMode) toast(`同姓名の従業員が ${listDupIds.size} 名見つかりました`);
}

function updateDupListBtn() {
  const btn   = document.getElementById('btn-dup-list');
  const badge = document.getElementById('dup-list-badge');
  if (!btn) return;
  
  const groups = {};
  DB.employees.forEach(e => {
    const key = `${normalizeForDuplicate(e.lastName)}\x00${normalizeForDuplicate(e.firstName)}`;
    groups[key] = groups[key] || [];
    groups[key].push(e.id);
  });
  let cnt = 0;
  Object.values(groups).forEach(ids => { if(ids.length > 1) cnt += ids.length; });

  if (cnt > 0) {
    badge.textContent = cnt;
    badge.style.display = '';
    btn.classList.add('is-active');
  } else {
    badge.style.display = 'none';
    btn.classList.remove('is-active');
  }
}

/* ================================================================
   COLUMN PANEL
================================================================ */
function renderColPanel() {
  const list  = document.getElementById('col-panel-list');
  const cols  = getListCols();
  list.innerHTML = '';

  cols.forEach(col => {
    const def = getColDef(col.key);
    if (!def) return;

    const row = document.createElement('div');
    row.className = 'col-panel-row';
    row.draggable = !def.required;
    row.dataset.colkey = col.key;

    const handle = document.createElement('i');
    handle.className = 'fa-solid fa-grip-vertical col-drag-handle';
    if (def.required) handle.style.opacity = '.25';

    const lbl = document.createElement('label');
    lbl.className = 'col-check-lbl';

    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = col.visible;
    chk.disabled = !!def.required;
    chk.addEventListener('change', () => toggleListColVisible(col.key, chk.checked));

    const span = document.createElement('span');
    span.textContent = def.label;

    lbl.append(chk, span);

    if (def.required) {
      const badge = document.createElement('span');
      badge.className = 'col-required-badge';
      badge.textContent = '固定';
      lbl.appendChild(badge);
    }

    row.append(handle, lbl);
    list.appendChild(row);
  });

  initColPanelDrag(list);
}

function initColPanelDrag(list) {
  if (list.dataset.dragInit) return;
  list.dataset.dragInit = '1';
  list.addEventListener('dragstart', e => {
    const row = e.target.closest('[data-colkey]');
    if (!row || row.draggable === false) return;
    colDragKey = row.dataset.colkey;
    setTimeout(() => row.classList.add('is-dragging'), 0);
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragover', e => {
    e.preventDefault();
    const row = e.target.closest('[data-colkey]');
    if (!row || !colDragKey || row.dataset.colkey === colDragKey) return;
    list.querySelectorAll('.col-panel-row').forEach(r => r.classList.remove('drag-over'));
    row.classList.add('drag-over');
    colDragOverKey = row.dataset.colkey;
  });
  list.addEventListener('dragleave', e => {
    if (!list.contains(e.relatedTarget))
      list.querySelectorAll('.col-panel-row').forEach(r => r.classList.remove('drag-over'));
  });
  list.addEventListener('drop', e => {
    e.preventDefault();
    list.querySelectorAll('.col-panel-row').forEach(r => r.classList.remove('drag-over', 'is-dragging'));
    if (colDragKey && colDragOverKey && colDragKey !== colDragOverKey)
      reorderListCol(colDragKey, colDragOverKey);
    colDragKey = colDragOverKey = null;
  });
  list.addEventListener('dragend', () => {
    list.querySelectorAll('.col-panel-row').forEach(r => r.classList.remove('drag-over', 'is-dragging'));
    colDragKey = colDragOverKey = null;
  });
}

function toggleListColVisible(key, visible) {
  const cols = getListCols();
  const col  = cols.find(c => c.key === key);
  if (col) { col.visible = visible; DB.settings.listCols = cols; saveDB(); }
  renderListHeader();
  renderList();
}

function reorderListCol(fromKey, toKey) {
  const cols = getListCols();
  const fi   = cols.findIndex(c => c.key === fromKey);
  const ti   = cols.findIndex(c => c.key === toKey);
  if (fi < 0 || ti < 0) return;
  const [item] = cols.splice(fi, 1);
  cols.splice(ti, 0, item);
  DB.settings.listCols = cols;
  saveDB();
  renderColPanel();
  renderListHeader();
  renderList();
}

/* ================================================================
   LIST VIEW — Header (dynamic)
================================================================ */
function renderListHeader() {
  const tr   = document.getElementById('ls-thead-row');
  const cols = getListCols();
  tr.innerHTML = '';

  cols.forEach(col => {
    if (!col.visible) return;
    const def = getColDef(col.key);
    if (!def) return;
    const th  = document.createElement('th');
    if (def.sortKey) {
      th.dataset.sort = def.sortKey;
      if (listSort.key === def.sortKey) th.classList.add('sort-' + listSort.dir);
    }
    th.textContent = def.label;
    if (col.key === 'currentOrg') {
      th.style.minWidth = '300px';
    }
    tr.appendChild(th);
  });

  const thAct = document.createElement('th');
  thAct.style.width = '72px';
  tr.appendChild(thAct);

  initSortHeaders();
}

/* ================================================================
   LIST VIEW — Render
================================================================ */
const SORT_FNS = {
  name:      e => e.lastName + e.firstName,
  kana:      e => (e.lastNameKana || '') + (e.firstNameKana || ''),
  gender:    e => e.gender    || '',
  age:       e => { const a = getEmpAge(e);        return a  ?? 9999; },
  birthDate: e => e.birthDate || (e.ageApprox?.refDate || ''),
  hireYear:  e => parseHireYear(e.hireDate) ?? 0,
  adjHireYear: e => { const info = getAdjHireYearInfo(e); return info ? info.year : 0; },
  years:     e => { const y = calcYears(e.hireDate); return y  ?? -1; },
  currentOrg:e => { const s = getEmpActiveState(e); return s.orgLevels.join('') || ''; },
  currentPos:e => { const s = getEmpActiveState(e); return s.position || ''; },
  attr:      e => e.attribute || '',
  status:    e => e.status    || '',
  hireType:  e => e.hireType  || '',
  course:    e => e.course    || '',
  education: e => e.education || '',
  school:    e => e.school    || '',
  eduDept:   e => e.eduDept   || '',
};

function getFiltered() {
  const { search } = listFilters;
  // グローバルフィルターを先に適用してから、リスト固有フィルター（フリーワード検索）を重ねる
  let list = applyGlobalFilter(DB.employees).filter(e => {
    if (!search) return true;
    const text = _buildEmpSearchText(e);
    return _matchSearchTerms(text, search);
  });
  const fn = SORT_FNS[listSort.key];
  if (fn) list.sort((a, b) => {
    const va = fn(a), vb = fn(b);
    const c  = typeof va === 'string' ? va.localeCompare(vb, 'ja') : va - vb;
    return listSort.dir === 'asc' ? c : -c;
  });
  return list;
}

/* ================================================================
   VIRTUAL SCROLL STATE
================================================================ */
let _vsData = [];
let _vsCols = [];
const _VS_ROW_H = 44; // 約44px(アバター＋パディングを想定した標準行の高さ)
const _VS_BUFFER = 20;
let _vsScrollBound = false;
let _vsRAF = null;

function _vsInitScroll() {
  if (_vsScrollBound) return;
  const scrollEl = document.querySelector('.list-scroll');
  if (!scrollEl) return;
  scrollEl.addEventListener('scroll', () => {
    if (_vsRAF) cancelAnimationFrame(_vsRAF);
    _vsRAF = requestAnimationFrame(_vsRenderWindow);
  }, { passive: true });
  _vsScrollBound = true;
}

function _vsRenderWindow() {
  const scrollEl = document.querySelector('.list-scroll');
  const tbody = document.getElementById('ls-tbody');
  if (!scrollEl || !tbody || !_vsData.length) return;

  const scrollTop = scrollEl.scrollTop;
  const viewH = scrollEl.clientHeight;
  const total = _vsData.length;

  let startIdx = Math.max(0, Math.floor(scrollTop / _VS_ROW_H) - _VS_BUFFER);
  let endIdx = Math.min(total, Math.ceil((scrollTop + viewH) / _VS_ROW_H) + _VS_BUFFER);

  const topPad = startIdx * _VS_ROW_H;
  const bottomPad = Math.max(0, (total - endIdx) * _VS_ROW_H);

  tbody.innerHTML = '';

  if (topPad > 0) {
    const sp = document.createElement('tr');
    sp.setAttribute('aria-hidden', 'true');
    const td = document.createElement('td');
    td.colSpan = 99;
    td.style.cssText = `height:${topPad}px; padding:0; border:none;`;
    sp.appendChild(td);
    tbody.appendChild(sp);
  }

  const frag = document.createDocumentFragment();
  for (let i = startIdx; i < endIdx; i++) {
    frag.appendChild(_vsCreateRow(_vsData[i], _vsCols));
  }
  tbody.appendChild(frag);

  if (bottomPad > 0) {
    const sp = document.createElement('tr');
    sp.setAttribute('aria-hidden', 'true');
    const td = document.createElement('td');
    td.colSpan = 99;
    td.style.cssText = `height:${bottomPad}px; padding:0; border:none;`;
    sp.appendChild(td);
    tbody.appendChild(sp);
  }
}

function highlightHTMLText(htmlStr, queryStr) {
  if (!queryStr || !DB.settings.showSearchMarker) return htmlStr;
  const terms = queryStr.toLowerCase().replace(/　/g, ' ').split(/\s+/).filter(Boolean);
  if (!terms.length) return htmlStr;
  
  const uniqueTerms = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const escTerms = uniqueTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const reg = new RegExp(`(${escTerms.join('|')})`, 'gi');

  const parts = String(htmlStr).split(/(<[^>]*>)/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0 && parts[i]) {
      parts[i] = parts[i].replace(reg, '<mark class="search-hl">$1</mark>');
    }
  }
  return parts.join('');
}

function _vsCreateRow(emp, cols) {
  const age = getEmpAge(emp);
  const years = calcYears(emp.hireDate);
  const hireY = parseHireYear(emp.hireDate);
  const tags = empTagObjs(emp);
  const tr = document.createElement('tr');
  tr.dataset.empid = emp.id;

  if (typeof compareIds !== 'undefined' && compareIds.has(emp.id)) {
    tr.classList.add('is-compare-selected');
  }
  if (listDupMode && listDupIds.has(emp.id)) {
    tr.classList.add('is-dup-row');
  }

  const query = listFilters.search;

  cols.forEach(col => {
    switch (col.key) {
      case 'name': {
        const td = document.createElement('td'); td.className = 'td-name-cell';
        const as = getMiniAvatarStyle(emp);
        let avatarHtml = `<div class="avatar-fallback-list" style="aspect-ratio:${as.aspect}; border-radius:${as.radius};"><i class="fa-solid fa-user"></i></div>`;
        if (emp.avatarId && avatarMap.has(emp.avatarId)) {
          avatarHtml = `<img src="${avatarMap.get(emp.avatarId)}" class="avatar-img-list" style="aspect-ratio:${as.aspect}; border-radius:${as.radius}; object-fit:${as.fit}" alt="Avatar">`;
        }

        const kana = [emp.lastNameKana, emp.firstNameKana].filter(Boolean).join(' ');
        const kanaHtml = kana ? `<span class="td-name-kana">${kana}</span>` : '';
        const dupBadge = (listDupMode && listDupIds.has(emp.id))
          ? `<span class="dup-name-badge"><i class="fa-solid fa-clone"></i>重複</span>` : '';
        td.innerHTML = highlightHTMLText(`<div class="td-name-inner">${avatarHtml}<span class="td-name-text">${emp.lastName} ${emp.firstName}</span>${kanaHtml}${dupBadge}</div>`, query);
        tr.appendChild(td); break;
      }
      case 'kana': {
        const td = listAddTd(tr);
        const k = [emp.lastNameKana, emp.firstNameKana].filter(Boolean).join(' ');
        td.innerHTML = highlightHTMLText(k || '—', query); if (!k) td.classList.add('td-dash'); break;
      }
      case 'gender': {
        const td = listAddTd(tr);
        emp.gender ? td.appendChild(makeBadge(genderClass(emp.gender), emp.gender)) : (td.innerHTML = '<span class="td-dash">—</span>'); break;
      }
      case 'age': {
        const td = listAddTd(tr, 'td-num');
        td.innerHTML = age !== null ? `<span>${age}<small style="font-size:10px;margin-left:1px">歳</small></span>` : '<span class="td-dash">—</span>'; break;
      }
      case 'birthDate': {
        const td = listAddTd(tr);
        if (emp.birthDate) {
          const z = getZodiac(emp.birthDate);
          td.innerHTML = `<span>${emp.birthDate}</span>` + (z ? `<span class="badge b-zodiac" style="margin-left:6px"><i class="${getZodiacIcon(z)}"></i>${z}年</span>` : '');
        } else if (hasApproxAge(emp)) {
          td.innerHTML = `<span style="color:var(--c-text-2)">—</span><span class="badge-approx">概算</span>`;
        } else {
          td.innerHTML = '<span class="td-dash">—</span>';
        }
        break;
      }
      case 'hireYear': {
        const td = listAddTd(tr, 'td-num');
        td.innerHTML = hireY ? `<span>${hireY}<small style="font-size:10px;margin-left:1px">年</small></span>` : '<span class="td-dash">—</span>'; break;
      }
      case 'adjHireYear': {
        const td = listAddTd(tr, 'td-num');
        const info = getAdjHireYearInfo(emp);
        if (info) {
          let html = `<span>${info.year}<small style="font-size:10px;margin-left:1px">年</small></span>`;
          if (info.isUnset) html += `<span class="badge-approx" title="学歴未設定のため補正なし" style="margin-left:4px">未設定</span>`;
          td.innerHTML = html;
        } else {
          td.innerHTML = '<span class="td-dash">—</span>';
        }
        break;
      }
      case 'years': {
        const td = listAddTd(tr, 'td-num');
        td.innerHTML = years !== null ? `<span>${years}<small style="font-size:10px;margin-left:1px">年</small></span>` : '<span class="td-dash">—</span>'; break;
      }
      case 'currentOrg': {
        const td = listAddTd(tr, 'td-long-text td-org-cell'); td.style.fontSize = '12px';
        const s = getEmpActiveState(emp);
        const org = s.orgLevels.join(' › ');
        let extra = '';
        if(s.kind==='stationed' && s.workLocation) extra = `<br><span style="font-size:10.5px;color:var(--c-text-3)"><i class="fa-solid fa-location-dot" style="color:#0D9488;margin-right:3px"></i>${s.workLocation} 駐在</span>`;
        else if(s.kind==='secondment') extra = `<br><span style="font-size:10.5px;color:var(--c-text-3)"><i class="fa-solid fa-right-left" style="color:#0891B2;margin-right:3px"></i>出向</span>`;
        td.innerHTML = highlightHTMLText(org ? `<span>${org}</span>${extra}` : '<span class="td-dash">—</span>', query);
        break;
      }
      case 'currentPos': {
        const td = listAddTd(tr);
        const s = getEmpActiveState(emp);
        td.innerHTML = highlightHTMLText(s.position ? `<span class="badge b-position"><i class="fa-solid fa-user-tie"></i>${s.position}</span>` : '<span class="td-dash">—</span>', query);
        break;
      }
      case 'attr': {
        const td = listAddTd(tr);
        if (emp.attribute) { const b = makeFlatBadge('attribute', emp.attribute); if (b) td.appendChild(b); else td.innerHTML = '<span class="td-dash">—</span>'; }
        else td.innerHTML = '<span class="td-dash">—</span>'; break;
      }
      case 'status': {
        const td = listAddTd(tr);
        if (emp.status) { const b = makeFlatBadge('status', emp.status); if (b) td.appendChild(b); else td.innerHTML = '<span class="td-dash">—</span>'; }
        else td.innerHTML = '<span class="td-dash">—</span>'; break;
      }
      case 'hireType': {
        const td = listAddTd(tr);
        if (emp.hireType) { const b = makeFlatBadge('hireType', emp.hireType); if (b) td.appendChild(b); else td.innerHTML = '<span class="td-dash">—</span>'; }
        else td.innerHTML = '<span class="td-dash">—</span>'; break;
      }
      case 'course': {
        const td = listAddTd(tr);
        if (emp.course) { const b = makeFlatBadge('course', emp.course); if (b) td.appendChild(b); else td.innerHTML = '<span class="td-dash">—</span>'; }
        else td.innerHTML = '<span class="td-dash">—</span>'; break;
      }
      case 'education': {
        const td = listAddTd(tr);
        td.innerHTML = highlightHTMLText(emp.education || '—', query); if (!emp.education) td.classList.add('td-dash'); break;
      }
      case 'school': {
        const td = listAddTd(tr, 'td-long-text'); td.style.fontSize = '12px';
        td.innerHTML = highlightHTMLText(emp.school || '—', query); if (!emp.school) td.classList.add('td-dash'); break;
      }
      case 'eduDept': {
        const td = listAddTd(tr, 'td-long-text'); td.style.fontSize = '12px';
        td.innerHTML = highlightHTMLText(emp.eduDept || '—', query); if (!emp.eduDept) td.classList.add('td-dash'); break;
      }
      case 'tags': {
        const td = listAddTd(tr);
        if (tags.length) {
          const row = document.createElement('div'); row.className = 'badge-row';
          tags.forEach(t => { const b = document.createElement('span'); b.className = 'badge'; b.style.background = lighten(t.color); b.style.color = t.color; b.innerHTML = highlightHTMLText(t.name, query); row.appendChild(b); });
          td.appendChild(row);
        } else td.innerHTML = '<span class="td-dash">—</span>';
        break;
      }
      case 'memo': {
        const td = listAddTd(tr, 'td-memo-cell'); td.title = emp.memo || '';
        td.innerHTML = highlightHTMLText(emp.memo || '—', query); if (!emp.memo) td.classList.add('td-dash'); break;
      }
    }
  });

  tr.addEventListener('dblclick', e => {
    if (e.target.closest('button')) return;
    openEmpModal(emp.id);
  });
  tr.addEventListener('mouseenter', _showCardPopup);
  tr.addEventListener('mousemove',  _moveCardPopup);
  tr.addEventListener('mouseleave', _hideCardPopup);
  tr.title = 'ダブルクリックで編集';

  const tac = listAddTd(tr);
  tac.style.padding = '3px 8px';
  const tacInner = document.createElement('div');
  tacInner.className = 'td-actions';
  const editBtn = listMkBtn('fa-solid fa-pen-to-square', '編集', () => openEmpModal(emp.id));
  const dBtn = listMkBtn('fa-solid fa-trash-can', '削除', () =>
    openConfirm(`${emp.lastName} ${emp.firstName} を削除しますか？`, () => deleteEmp(emp.id)));
  dBtn.style.color = 'var(--c-danger)';
  tacInner.append(editBtn, dBtn);
  tac.appendChild(tacInner);

  return tr;
}

function renderList() {
  _vsData = getFiltered();
  const tbody = document.getElementById('ls-tbody');
  const empty = document.getElementById('ls-empty');
  
  document.getElementById('ls-cnt').textContent =
    _vsData.length !== DB.employees.length
      ? `${_vsData.length} / ${DB.employees.length}名`
      : `全${DB.employees.length}名`;

  tbody.innerHTML = '';
  if (!_vsData.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  if (listDupMode) buildListDupSet();

  _vsCols = getListCols().filter(c => c.visible);
  
  _vsInitScroll();
  _vsRenderWindow();
  
  updateHeaderCnt();
}

function listAddTd(tr, cls) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  tr.appendChild(td); return td;
}
function listMkBtn(icon, title, cb) {
  const b = document.createElement('button'); b.className = 'btn btn-ghost btn-icon-sm'; b.title = title;
  b.innerHTML = `<i class="${icon}"></i>`; b.addEventListener('click', cb); return b;
}

function initSortHeaders() {
  document.querySelectorAll('.list-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (listSort.key === key) listSort.dir = listSort.dir === 'asc' ? 'desc' : 'asc';
      else { listSort.key = key; listSort.dir = 'asc'; }
      document.querySelectorAll('.list-table th[data-sort]').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add('sort-' + listSort.dir);
      renderList();
    });
  });
  const cur = document.querySelector(`.list-table th[data-sort="${listSort.key}"]`);
  if (cur) cur.classList.add('sort-' + listSort.dir);
}

/* ================================================================
   COMPARE MODE (Context Menu & Modal)
================================================================ */
let compareIds = new Set();
let compareSortDir = 'asc';
let compareChartInst = null;

function initListContextMenu() {
  const menu = document.getElementById('list-context-menu');
  if (!menu) return;
  let contextTargetId = null;

  document.addEventListener('contextmenu', e => {
    let empid = null;
    const tr = e.target.closest('tr[data-empid]');
    if (tr) empid = tr.dataset.empid;
    else {
      const card = e.target.closest('.emp-card[data-empid]');
      if (card) empid = card.dataset.empid;
    }
    
    if (!empid) return;

    e.preventDefault();
    contextTargetId = empid;

    let directIds = [empid];
    if (typeof _distSelectedIds !== 'undefined' && _distSelectedIds.has(empid)) {
      directIds = Array.from(_distSelectedIds);
    }
    const directBtn = document.getElementById('ctx-compare-direct');
    if (directBtn) {
      directBtn.innerHTML = `<i class="fa-solid fa-eye"></i>${directIds.length > 1 ? directIds.length + '名の履歴を比較表示' : 'この従業員の履歴を表示'}`;
    }

    // メニュー更新
    const isSel = compareIds.has(empid);
    document.getElementById('ctx-compare-toggle').innerHTML = isSel 
      ? '<i class="fa-solid fa-minus"></i>比較対象から外す' 
      : '<i class="fa-solid fa-plus"></i>比較対象に追加する';
    
    document.getElementById('ctx-compare-cnt').textContent = compareIds.size;
    document.getElementById('ctx-compare-open').disabled = compareIds.size === 0;

    menu.style.display = 'block';
    
    let x = e.clientX;
    let y = e.clientY;
    if (x + menu.offsetWidth > window.innerWidth) x = window.innerWidth - menu.offsetWidth - 5;
    if (y + menu.offsetHeight > window.innerHeight) y = window.innerHeight - menu.offsetHeight - 5;
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  });

  document.addEventListener('click', e => {
    if (!menu.contains(e.target)) menu.style.display = 'none';
  });

  document.getElementById('ctx-compare-direct')?.addEventListener('click', () => {
    if (!contextTargetId) return;
    let targetIds = [contextTargetId];
    if (typeof _distSelectedIds !== 'undefined' && _distSelectedIds.has(contextTargetId)) {
      targetIds = Array.from(_distSelectedIds);
    }
    if (targetIds.length > 4) {
      toast('比較できるのは最大4名までです。先頭4名を表示します。');
      targetIds = targetIds.slice(0, 4);
    }
    compareIds = new Set(targetIds);
    menu.style.display = 'none';
    renderList();
    openCompareModal();
  });

  document.getElementById('ctx-compare-toggle').addEventListener('click', () => {
    if (!contextTargetId) return;
    if (compareIds.has(contextTargetId)) {
      compareIds.delete(contextTargetId);
    } else {
      if (compareIds.size >= 4) {
        toast('比較できるのは最大4名までです');
      } else {
        compareIds.add(contextTargetId);
      }
    }
    menu.style.display = 'none';
    renderList(); // ハイライト更新
  });

  document.getElementById('ctx-compare-open').addEventListener('click', () => {
    menu.style.display = 'none';
    openCompareModal();
  });

  document.getElementById('ctx-compare-clear').addEventListener('click', () => {
    compareIds.clear();
    menu.style.display = 'none';
    renderList();
  });

  document.getElementById('btn-compare-sort')?.addEventListener('click', () => {
    compareSortDir = compareSortDir === 'asc' ? 'desc' : 'asc';
    const icon = document.getElementById('icon-compare-sort');
    if (icon) icon.className = compareSortDir === 'asc' ? 'fa-solid fa-arrow-down-1-9' : 'fa-solid fa-arrow-down-9-1';
    renderCompareModal();
  });
}

function openCompareModal() {
  if (compareIds.size === 0) return;
  renderCompareModal();
  openModal('compare-modal');
  setTimeout(initCompareAddAC, 100);
}

function renderCompareModal() {
  const grid = document.getElementById('compare-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const idArray = Array.from(compareIds);

  const chartWrap = document.getElementById('compare-chart-wrap');
  const canvas = document.getElementById('compare-radar-chart');
  if (chartWrap && canvas) {
    if (idArray.length === 0) {
      chartWrap.style.display = 'none';
      if (compareChartInst) { compareChartInst.destroy(); compareChartInst = null; }
    } else {
      chartWrap.style.display = 'block';
      const chartColors = [
        { border: '#3B82F6', bg: 'rgba(59, 130, 246, 0.2)' },
        { border: '#EC4899', bg: 'rgba(236, 72, 153, 0.2)' },
        { border: '#10B981', bg: 'rgba(16, 185, 129, 0.2)' },
        { border: '#F59E0B', bg: 'rgba(245, 158, 11, 0.2)' }
      ];
      const datasets = idArray.map((id, index) => {
        const emp = DB.employees.find(e => e.id === id);
        const yrs = calcYears(emp?.hireDate) || 0;
        const orgYrs = getOrgExperienceYears(emp) || 0;
        const posYrs = getPosExperienceYears(emp) || 0;
        const color = chartColors[index % chartColors.length];
        return {
          label: emp ? `${emp.lastName} ${emp.firstName}` : '不明',
          data: [yrs, orgYrs, posYrs],
          backgroundColor: color.bg,
          borderColor: color.border,
          pointBackgroundColor: color.border,
          borderWidth: 2,
        };
      });
      if (compareChartInst) compareChartInst.destroy();
      compareChartInst = new Chart(canvas, {
        type: 'radar',
        data: {
          labels: ['在社年数', '部門経験年数', '役職経験年数'],
          datasets: datasets
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: { r: { beginAtZero: true, ticks: { precision: 0, stepSize: 5 } } },
          plugins: {
            legend: { position: 'bottom', labels: { font: { family: "'DM Sans','Noto Sans JP',sans-serif", size: 11 } } },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}年` } }
          }
        }
      });
    }
  }

  idArray.forEach(id => {
    const emp = DB.employees.find(e => e.id === id);
    if (!emp) return;

    const col = document.createElement('div');
    col.className = 'compare-col';
    col.draggable = true;
    col.dataset.empid = id;

    // カラムのD&D
    col.addEventListener('dragstart', e => {
      if (e.target.closest('button, input, select')) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => col.classList.add('is-dragging'), 0);
    });
    col.addEventListener('dragend', () => {
      col.classList.remove('is-dragging');
      grid.querySelectorAll('.compare-col').forEach(c => c.classList.remove('drag-over-left', 'drag-over-right'));
    });
    col.addEventListener('dragover', e => {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      const dragId = document.querySelector('.compare-col.is-dragging')?.dataset.empid;
      if (dragId === id) return;
      const rect = col.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      col.classList.remove('drag-over-left', 'drag-over-right');
      if (e.clientX < midX) col.classList.add('drag-over-left');
      else col.classList.add('drag-over-right');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over-left', 'drag-over-right'));
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('drag-over-left', 'drag-over-right');
      const dragId = e.dataTransfer.getData('text/plain');
      if (dragId === id) return;
      const rect = col.getBoundingClientRect();
      const insertBefore = e.clientX < (rect.left + rect.width / 2);
      
      const arr = Array.from(compareIds);
      const fromIdx = arr.indexOf(dragId);
      const toIdx = arr.indexOf(id);
      if (fromIdx >= 0 && toIdx >= 0) {
        arr.splice(fromIdx, 1);
        const newToIdx = arr.indexOf(id);
        arr.splice(insertBefore ? newToIdx : newToIdx + 1, 0, dragId);
        compareIds = new Set(arr);
        renderCompareModal();
      }
    });

    // Head
    const as = getMiniAvatarStyle(emp);
    let avatarHtml = `<div class="avatar-fallback-list" style="aspect-ratio:${as.aspect}; border-radius:${as.radius};"><i class="fa-solid fa-user"></i></div>`;
    const _avatarId = getActiveAvatarId(emp);
    if (_avatarId && avatarMap.has(_avatarId)) {
      avatarHtml = `<img src="${avatarMap.get(_avatarId)}" class="avatar-img-list" style="aspect-ratio:${as.aspect}; border-radius:${as.radius}; object-fit:${as.fit}" alt="Avatar">`;
    }

    const head = document.createElement('div');
    head.className = 'compare-col-head';
    head.innerHTML = `
      ${avatarHtml}
      <div style="display:flex; flex-direction:column; min-width:0; flex:1;">
        <span style="font-size:14px; font-weight:700; color:var(--c-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${emp.lastName} ${emp.firstName}</span>
        <span style="font-size:11px; color:var(--c-text-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${emp.status||'不明'} / ${emp.attribute||'未設定'}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:2px;">
        <button class="btn btn-ghost btn-icon-sm" title="比較から外す" onclick="removeCompareId('${id}')" style="color:var(--c-danger); padding:2px;"><i class="fa-solid fa-xmark"></i></button>
        <button class="btn btn-ghost btn-icon-sm" title="履歴を追加" onclick="openCompareAddTransfer('${id}')" style="padding:2px;"><i class="fa-solid fa-plus"></i></button>
      </div>
    `;
    
    // Body (Timeline)
    const body = document.createElement('div');
    body.className = 'compare-col-body';
    
    const timeline = document.createElement('div');
    
    const entries = buildTimelineEntries(emp.transfers || [], emp.leaves || []);
    const isRetired = emp.status === '退職';
    const periodEnd = isRetired && emp.resignDate ? normalizeHireDate(emp.resignDate) : null;
    
    renderTimelineToContainer(timeline, entries, compareSortDir, true, periodEnd, emp.transfers || [], id);
    
    if (entries.length === 0) {
      timeline.innerHTML = '<div style="color:var(--c-text-3); font-size:12px; text-align:center; padding:20px;">履歴なし</div>';
    }

    body.appendChild(timeline);
    col.appendChild(head);
    col.appendChild(body);
    grid.appendChild(col);
  });
}

window.removeCompareId = function(id) {
  compareIds.delete(id);
  if (compareIds.size === 0) {
    closeModal('compare-modal');
  } else {
    renderCompareModal();
  }
  renderList();
};

window.openCompareAddTransfer = function(empId) {
  openEmpModal(empId);
  switchEmpModalTab('emp-pane-transfer');
  setTimeout(() => openTransferEdit(), 100);
};

function initCompareAddAC() {
  const inp = document.getElementById('compare-add-input');
  const dd = document.getElementById('compare-add-dd');
  if (!inp || !dd) return;

  function renderAC() {
    const q = inp.value.trim().toLowerCase();
    dd.innerHTML = '';

    const avail = DB.employees.filter(e => !compareIds.has(e.id));
    const matched = q ? avail.filter(e => {
      const nm = e.lastName + e.firstName;
      const kana = (e.lastNameKana || '') + (e.firstNameKana || '');
      return nm.includes(q) || kana.includes(q);
    }) : avail.slice(0, 10);

    if (matched.length === 0) {
      dd.innerHTML = '<div class="master-ac-empty">候補が見つかりません</div>';
      dd.classList.add('open');
      return;
    }

    matched.forEach(emp => {
      const item = document.createElement('div');
      item.className = 'master-ac-item';
      item.innerHTML = `<i class="master-ac-icon fa-solid fa-user"></i><span class="master-ac-label">${emp.lastName} ${emp.firstName} <small style="color:var(--c-text-3)">(${emp.attribute||'未設定'})</small></span>`;
      item.addEventListener('mousedown', e => {
        e.preventDefault();
        if (compareIds.size >= 4) {
          toast('比較できるのは最大4名までです');
        } else {
          compareIds.add(emp.id);
          renderCompareModal();
          renderList();
        }
        inp.value = '';
        dd.classList.remove('open');
      });
      dd.appendChild(item);
    });
    dd.classList.add('open');
  }

  inp.addEventListener('input', renderAC);
  inp.addEventListener('focus', renderAC);
  inp.addEventListener('blur', () => setTimeout(() => dd.classList.remove('open'), 150));
}
