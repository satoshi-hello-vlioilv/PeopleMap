'use strict';
// --- Register Chart.js BoxPlot / Violin controllers ---
if (typeof Chart !== 'undefined') {
  if (Chart.registerables) {
    Chart.register(...Chart.registerables);
  }
  if (typeof ChartBoxPlot !== 'undefined' && !Chart.registry.controllers.get('violin')) {
    try {
      Chart.register(
        ChartBoxPlot.BoxPlotController,
        ChartBoxPlot.BoxAndWiskers,
        ChartBoxPlot.ViolinController,
        ChartBoxPlot.Violin
      );
    } catch (e) {
      console.warn('Failed to register ChartBoxPlot elements initially', e);
    }
  }
}

/* ================================================================
   DISTRIBUTION VIEW — helpers
================================================================ */

/* ── 会社マスタ階層アクセスヘルパー ───────────────────── */
function getLatestTransfer(emp) {
  if (!Array.isArray(emp.transfers) || !emp.transfers.length) return null;
  return [...emp.transfers].sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1)[0];
}
function getEmpCompanyLevel(emp, level) {
  const state = getEmpActiveState(emp);
  return state.orgLevels[level] || null;
}
/** eduDept "学部名 学科名" をスペース区切りで分解して指定インデックスを返す */
function parseEduDeptPart(eduDept, partIndex) {
  if (!eduDept) return null;
  const parts = eduDept.trim().split(/\s+/);
  return parts[partIndex] || null;
}

/* ── 縦軸定義（動的生成） ─────────────────────────────── */
function buildYAxisDefs() {
  const groups = [
    {
      key: 'numeric', label: '数値軸・経験', icon: 'fa-solid fa-ruler-horizontal', color: '#3B82F6',
      items:[
        { key: 'hire',  label: '入社年',   icon: 'fa-solid fa-calendar-days' },
        { key: 'adjHire', label: '換算入社年(大卒基準)', icon: 'fa-solid fa-scale-balanced' },
        { key: 'age',   label: '年齢',     icon: 'fa-solid fa-person' },
        { key: 'years', label: '在社年数', icon: 'fa-solid fa-hourglass-half' },
        { key: 'orgExp', label: '部門経験年数', icon: 'fa-solid fa-sitemap' },
        { key: 'posExp', label: '役職経験年数', icon: 'fa-solid fa-user-tie' },
      ]
    },
    {
      key: 'personal', label: '個人属性', icon: 'fa-solid fa-id-card', color: '#EC4899',
      items: [
        { key: 'birthMonth', label: '誕生月', icon: 'fa-solid fa-cake-candles' },
        { key: 'zodiac', label: '干支', icon: 'fa-solid fa-dragon' },
      ]
    },
    {
      key: 'flat', label: '分類マスタ', icon: 'fa-solid fa-layer-group', color: '#10B981', items: [
        { key: 'gender',    label: '性別',     icon: 'fa-solid fa-venus-mars' },
        { key: 'attribute', label: '属性',     icon: 'fa-solid fa-map-location-dot' },
        { key: 'status',    label: '在籍状況', icon: 'fa-solid fa-circle-dot' },
        { key: 'hireType',  label: '入社区分', icon: 'fa-solid fa-door-open' },
        { key: 'course',    label: '職群', icon: 'fa-solid fa-user-gear' },
        { key: 'education', label: '学歴',     icon: 'fa-solid fa-graduation-cap' },
      ]
    }
  ];

  // 学校マスタ — 階層設定から動的生成
  const schoolLevels  = DB.masterConfig.school?.levels  || [];
  const companyLevels = DB.masterConfig.company?.levels || [];
  const schoolIcons   = ['fa-solid fa-school','fa-solid fa-building-columns','fa-solid fa-flask','fa-solid fa-book'];
  const companyIcons  = ['fa-solid fa-building','fa-solid fa-sitemap','fa-solid fa-people-group','fa-solid fa-diagram-project'];

  if (schoolLevels.length) {
    groups.push({
      key: 'school', label: '学校マスタ', icon: 'fa-solid fa-graduation-cap', color: '#8B5CF6',
      items: schoolLevels.map((lv, i) => ({
        key: `school_l${i}`, label: lv.label, icon: schoolIcons[i] || 'fa-solid fa-circle-dot'
      }))
    });
  }
  // 会社マスタ — 階層設定から動的生成
  if (companyLevels.length) {
    groups.push({
      key: 'company', label: '会社マスタ', icon: 'fa-solid fa-building', color: '#F59E0B',
      items: companyLevels.map((lv, i) => ({
        key: `company_l${i}`, label: lv.label, icon: companyIcons[i] || 'fa-solid fa-circle-dot'
      }))
    });
  }
  return groups;
}

/** 軸キーから定義アイテムを検索 */
function getYAxisItem(key) {
  for (const grp of buildYAxisDefs()) {
    const item = grp.items.find(i => i.key === key);
    if (item) return { ...item, groupKey: grp.key, groupColor: grp.color };
  }
  return null;
}

/* ── グループキー取得 ─────────────────────────────────── */
function getGroupKey(e, yAxis) {
  // 数値軸
  if (yAxis === 'hire')  { const y = parseHireYear(e.hireDate); return y ? String(y) : '不明'; }
  if (yAxis === 'adjHire') { const info = getAdjHireYearInfo(e); return info !== null ? String(info.year) : '不明'; }
  if (yAxis === 'age')   { const a = getEmpAge(e);              return a !== null ? String(a) : '不明'; }
  if (yAxis === 'years') { const y = calcYears(e.hireDate);     return y !== null ? String(y) : '不明'; }
  if (yAxis === 'orgExp') { const y = getOrgExperienceYears(e); return y !== null ? String(y) : '不明'; }
  if (yAxis === 'posExp') { const y = getPosExperienceYears(e); return y !== null ? String(y) : '不明'; }
  if (yAxis === 'birthMonth') { const m = getBirthMonth(e.birthDate); return m !== null ? String(m) : '不明'; }
  if (yAxis === 'zodiac') { const z = getZodiac(e.birthDate);   return z !== null ? z : '不明'; }
  // フラット分類
  if (yAxis === 'gender')    return e.gender    || '未設定';
  if (yAxis === 'attribute') return e.attribute || '未設定';
  if (yAxis === 'status')    return e.status    || '未設定';
  if (yAxis === 'hireType')  return e.hireType  || '未設定';
  if (yAxis === 'course')    return e.course    || '未設定';
  if (yAxis === 'education') return e.education || '未設定';
  // 学校マスタ階層
  if (yAxis === 'school_l0') return e.school || '未設定';
  if (yAxis === 'school_l1') return parseEduDeptPart(e.eduDept, 0) || '未設定';
  if (yAxis === 'school_l2') return parseEduDeptPart(e.eduDept, 1) || '未設定';
  // 会社マスタ階層（company_l0, l1, l2 ...）
  if (yAxis.startsWith('company_l')) {
    const lv = parseInt(yAxis.slice(9));
    return getEmpCompanyLevel(e, lv) || '未設定';
  }
  return '不明';
}

/* ── グループキーのソート ─────────────────────────────── */
function sortGroupKeys(keys, yAxis) {
  const dir    = DB.settings.yAxisDir || 'desc';
  const NUMERIC = ['hire', 'adjHire', 'age', 'years', 'orgExp', 'posExp', 'birthMonth'];
  const UNK    = '未設定';

  if (NUMERIC.includes(yAxis)) {
    return [...keys].sort((a, b) => {
      if (a === '不明') return 1; if (b === '不明') return -1;
      return dir === 'asc' ? parseInt(a) - parseInt(b) : parseInt(b) - parseInt(a);
    });
  }
  // 干支のソート
  if (yAxis === 'zodiac') {
    const ZODIACS = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
    const sorted = [...keys].sort((a,b) => {
      if (a === '不明') return 1; if (b === '不明') return -1;
      const ia = ZODIACS.indexOf(a) < 0 ? 98 : ZODIACS.indexOf(a);
      const ib = ZODIACS.indexOf(b) < 0 ? 98 : ZODIACS.indexOf(b);
      return ia - ib;
    });
    return dir === 'asc' ? sorted : sorted.reverse();
  }
  // 学歴：固定優先順
  if (yAxis === 'education') {
    const ORDER = ['博士','修士','大卒','高専卒','短大卒','専門卒','高卒','中卒', UNK,'不明'];
    const sorted = [...keys].sort((a, b) => {
      const ia = ORDER.indexOf(a) < 0 ? 98 : ORDER.indexOf(a);
      const ib = ORDER.indexOf(b) < 0 ? 98 : ORDER.indexOf(b);
      return ia - ib;
    });
    return dir === 'asc' ? sorted : sorted.reverse();
  }
  // フラットマスタ：マスタ登録順
  if (['gender','attribute','status','hireType','course'].includes(yAxis)) {
    const masterItems = yAxis === 'gender'
      ? [{ name:'男性' },{ name:'女性' },{ name:'その他' }]
      : (DB.masters[yAxis] || []);
    const order = masterItems.map(i => i.name);
    const sorted = [...keys].sort((a, b) => {
      if (a === UNK) return 1; if (b === UNK) return -1;
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0 && ib < 0) return a.localeCompare(b, 'ja');
      if (ia < 0) return 1; if (ib < 0) return -1;
      return ia - ib;
    });
    return dir === 'asc' ? sorted : sorted.reverse();
  }
  // 学校・会社階層：マスタツリー登録順
  if (yAxis.startsWith('school_') || yAxis.startsWith('company_')) {
    const mType = yAxis.startsWith('school_') ? 'school' : 'company';
    const flat  = typeof masterFlatten === 'function' ? masterFlatten(DB.masters[mType] || []) : [];
    const order = flat.map(n => n.name);
    const sorted = [...keys].sort((a, b) => {
      if (a === UNK) return 1; if (b === UNK) return -1;
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia < 0 && ib < 0) return a.localeCompare(b, 'ja');
      if (ia < 0) return 1; if (ib < 0) return -1;
      return ia - ib;
    });
    return dir === 'asc' ? sorted : sorted.reverse();
  }
  // 汎用文字列ソート
  const sorted = [...keys].sort((a, b) => {
    if (a === UNK) return 1; if (b === UNK) return -1;
    return a.localeCompare(b, 'ja');
  });
  return dir === 'asc' ? sorted : sorted.reverse();
}

/* ── ナイススケール計算 ─────────────────────────────────── */
function _niceNum(range, round) {
  if (range === 0) return 1;
  const exp  = Math.floor(Math.log10(Math.abs(range)));
  const frac = Math.abs(range) / Math.pow(10, exp);
  let nf;
  if (round) { nf = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10; }
  else        { nf = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10; }
  return nf * Math.pow(10, exp);
}
function calcNiceScale(dataMin, dataMax, numTicks = 5) {
  if (dataMin === dataMax) { dataMin -= 1; dataMax += 1; }
  const range  = _niceNum(dataMax - dataMin, false);
  const step   = _niceNum(range / (numTicks - 1), true);
  return { min: Math.floor(dataMin / step) * step, max: Math.ceil(dataMax / step) * step, step };
}

/* ── 軸ラベル / アイコン ──────────────────────────────── */
function getAxisLabel(yAxis) {
  const item = getYAxisItem(yAxis);
  return item ? item.label : yAxis;
}

/* ── 軸セルのメタ情報 ─────────────────────────────────── */
function getAxisMeta(key, yAxis) {
  if (key === '不明' || key === '未設定') return { main: key, sub: '', wareki: null };
  const numYear = parseInt(key);
  const wareki  = DB.settings.showWareki && !isNaN(numYear) ? toWareki(numYear) : null;
  if (yAxis === 'hire')  return { main: key, sub: '年入社', wareki };
  if (yAxis === 'adjHire') return { main: key, sub: '年相当', wareki };
  if (yAxis === 'age')   return { main: key, sub: '歳',     wareki: null };
  if (yAxis === 'years') return { main: key, sub: '年目',   wareki: null };
  if (yAxis === 'orgExp' || yAxis === 'posExp') return { main: key, sub: '年目', wareki: null };
  if (yAxis === 'birthMonth') return { main: key, sub: '月', wareki: null };
  if (yAxis === 'zodiac') return { main: key, sub: '年', wareki: null };
  return { main: key, sub: '', wareki: null };
}

/* ================================================================
   ラベル列幅 — Canvas実測でCSS変数 --dist-label-w を算出
================================================================ */
const _mCanvas = document.createElement('canvas');
const _mCtx    = _mCanvas.getContext('2d');
function _measurePx(text, fontSpec) {
  _mCtx.font = fontSpec;
  return _mCtx.measureText(text).width;
}
function computeLabelColWidth(keys, yAxis) {
  const FONT_KEY  = '800 13px "DM Sans","Noto Sans JP",sans-serif';
  const FONT_SUB  = '600 10px "DM Sans","Noto Sans JP",sans-serif';
  const FONT_CNT  = '500 10px "DM Sans","Noto Sans JP",sans-serif';
  const FONT_WREK = '500  9px "DM Sans","Noto Sans JP",sans-serif';
  const PAD = 18, GAP = 3;
  const wCntMax = _measurePx('·999名', FONT_CNT);
  let maxW = 0;
  keys.forEach(k => {
    const { main, sub, wareki } = getAxisMeta(k, yAxis);
    const wMain  = _measurePx(main,  FONT_KEY);
    const wSub   = sub    ? _measurePx(sub,    FONT_SUB)  + GAP : 0;
    const wWrek  = wareki ? _measurePx(wareki, FONT_WREK) + GAP : 0;
    maxW = Math.max(maxW, wMain + wSub + wWrek + wCntMax + GAP + PAD);
  });
  return Math.max(88, Math.min(260, Math.ceil(maxW)));
}

/* ================================================================
   Y軸ピッカー — UI
================================================================ */
function buildYAxisPanel() {
  const panel = document.getElementById('yaxis-picker-panel');
  if (!panel) return;
  panel.innerHTML = '';

  const currentKey = DB.settings.yAxis;
  const defs       = buildYAxisDefs();

  const head = document.createElement('div');
  head.className   = 'yaxp-head';
  head.textContent = '縦軸の選択';
  panel.appendChild(head);

  defs.forEach(grp => {
    const grpEl = document.createElement('div');
    grpEl.className = 'yaxp-group';

    const grpLbl = document.createElement('div');
    grpLbl.className = 'yaxp-group-label';
    grpLbl.style.setProperty('--grp-color', grp.color || '#6B7280');
    grpLbl.innerHTML = `<i class="${grp.icon}"></i>${grp.label}`;
    grpEl.appendChild(grpLbl);

    const grpItems = document.createElement('div');
    grpItems.className = 'yaxp-group-items';

    grp.items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'yaxp-item' + (item.key === currentKey ? ' is-active' : '');
      el.dataset.yaxisKey = item.key;
      el.innerHTML = `
        <span class="yaxp-item-check"><i class="fa-solid fa-check"></i></span>
        <span class="yaxp-item-icon"><i class="${item.icon}"></i></span>
        <span class="yaxp-item-label">${item.label}</span>`;
      el.addEventListener('click', e => {
        e.stopPropagation();
        DB.settings.yAxis = item.key;
        // 数値軸以外では空行表示を無効化
        if (!['hire','adjHire','age','years'].includes(item.key) && DB.settings.showEmptyRows) {
          DB.settings.showEmptyRows = false;
          if (typeof updateEmptyRowsBtn === 'function') updateEmptyRowsBtn();
        }
        saveDB();
        syncYAxisPicker();
        closeYAxisPanel();
        renderDist();
      });
      grpItems.appendChild(el);
    });

    grpEl.appendChild(grpItems);
    panel.appendChild(grpEl);
  });
}

function syncYAxisPicker() {
  const key  = DB.settings.yAxis;
  const item = getYAxisItem(key);
  const iconEl  = document.getElementById('yaxis-picker-icon');
  const labelEl = document.getElementById('yaxis-picker-label');
  if (iconEl)  iconEl.className = item ? item.icon : 'fa-solid fa-bars-staggered';
  if (labelEl) labelEl.textContent = item ? item.label : key;

  document.querySelectorAll('.yaxp-item').forEach(el => {
    el.classList.toggle('is-active', el.dataset.yaxisKey === key);
  });

  // 空行ボタン：数値軸のみ有効
  const isNumeric =['hire','adjHire','age','years'].includes(key);
  const emptyBtn  = document.getElementById('btn-show-empty-rows');
  if (emptyBtn) {
    emptyBtn.style.opacity       = isNumeric ? '' : '0.4';
    emptyBtn.style.pointerEvents = isNumeric ? '' : 'none';
    emptyBtn.title = isNumeric ? '' : '数値軸でのみ使用できます';
  }
}

function openYAxisPanel() {
  buildYAxisPanel();
  const panel = document.getElementById('yaxis-picker-panel');
  const btn   = document.getElementById('btn-yaxis-picker');
  if (!panel || !btn) return;

  // position:fixed でtoolbar-left の overflow-x:auto を回避
  const rect = btn.getBoundingClientRect();
  panel.style.top  = (rect.bottom + 6) + 'px';
  panel.style.left = rect.left + 'px';

  // 画面右端からはみ出す場合は右寄せ
  const panelW = 240;
  if (rect.left + panelW > window.innerWidth - 8) {
    panel.style.left = Math.max(8, window.innerWidth - panelW - 8) + 'px';
  }

  panel.classList.add('open');
  document.getElementById('yaxis-picker-wrap')?.classList.add('is-open');
}
function closeYAxisPanel() {
  document.getElementById('yaxis-picker-panel')?.classList.remove('open');
  document.getElementById('yaxis-picker-wrap')?.classList.remove('is-open');
}

/* ================================================================
   DISTRIBUTION — build card
================================================================ */
function buildCard(emp, badges, variant) {
  const card = document.createElement('div');
  card.className = `emp-card emp-card-${variant}`;
  card.setAttribute('data-empid',  emp.id);
  card.setAttribute('data-gender', emp.gender  || '');
  card.setAttribute('data-status', emp.status  || '');
  if (emp.memo) card.title = emp.memo;
  card.draggable = true;
  card.style.cursor = 'grab';

  const mode = DB.settings.cardColorMode || 'attribute';
  const ccfg = CARD_COLOR_CFG[mode];
  const clr  = ccfg ? ccfg.fn(emp) : null;
  card.style.borderLeftColor = clr || 'var(--c-border-d)';

  if (emp.status) {
    card.classList.add('sc-styled');
    const stColor = getFlatMasterColor('status', emp.status);
    if (stColor) {
      card.style.background  = stColor;
      card.style.borderColor = lighten(stColor, 0.5);
    }
  }

  card.addEventListener('dblclick', () => openEmpModal(emp.id));
  card.addEventListener('click', e => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      if (_distSelectedIds.has(emp.id)) {
        _distSelectedIds.delete(emp.id);
        card.classList.remove('is-selected');
      } else {
        _distSelectedIds.add(emp.id);
        card.classList.add('is-selected');
      }
    } else {
      if (!_distSelectedIds.has(emp.id) || _distSelectedIds.size > 1) {
        _distClearSelection();
        _distSelectedIds.add(emp.id);
        card.classList.add('is-selected');
      } else {
        _distClearSelection();
      }
    }
  });

  card.addEventListener('dragstart', e => {
    if (!_distSelectedIds.has(emp.id)) {
      _distClearSelection();
      _distSelectedIds.add(emp.id);
      card.classList.add('is-selected');
    }
    const ids = Array.from(_distSelectedIds).join(',');
    e.dataTransfer.setData('text/plain', ids);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      document.querySelectorAll('.emp-card.is-selected').forEach(c => c.classList.add('is-dragging'));
    }, 0);
  });
  card.addEventListener('dragend', () => {
    document.querySelectorAll('.emp-card.is-dragging').forEach(c => c.classList.remove('is-dragging'));
  });

  // ── ホバーポップアップ（常時アタッチ。表示可否は_showCardPopup内で判定）
  card.addEventListener('mouseenter', _showCardPopup);
  card.addEventListener('mousemove',  _moveCardPopup);
  card.addEventListener('mouseleave', _hideCardPopup);

  const nm = document.createElement('span');
  nm.className   = 'emp-card-name';

  const as = getMiniAvatarStyle(emp);
  const _showAvtr = DB.settings.showCardAvatar !== false;
  let avatarHtml = '';
  if (_showAvtr) {
    avatarHtml = `<div class="avatar-fallback-card" style="aspect-ratio:${as.aspect}; border-radius:${as.radius};"><i class="fa-solid fa-user"></i></div>`;
    const _avatarId = getActiveAvatarId(emp);
    if (_avatarId && avatarMap.has(_avatarId)) {
      avatarHtml = `<img src="${avatarMap.get(_avatarId)}" class="avatar-img-card" style="aspect-ratio:${as.aspect}; border-radius:${as.radius}; object-fit:${as.fit}" alt="Avatar">`;
    }
  }
  
  nm.innerHTML = `${avatarHtml}<span>${emp.lastName} ${emp.firstName}</span>`;
  nm.dataset.origHtml = nm.innerHTML;
  card.appendChild(nm);

  if (badges.gender    && emp.gender)    card.appendChild(makeBadge(genderClass(emp.gender), emp.gender));
  if (badges.attribute && emp.attribute) { const b = makeFlatBadge('attribute', emp.attribute); if (b) card.appendChild(b); }
  if (badges.status    && emp.status)    { const b = makeFlatBadge('status',    emp.status);    if (b) card.appendChild(b); }
  if (badges.hireType  && emp.hireType)  { const b = makeFlatBadge('hireType',  emp.hireType);  if (b) card.appendChild(b); }
  if (badges.course    && emp.course)    { const b = makeFlatBadge('course',    emp.course);    if (b) card.appendChild(b); }
  if (badges.age)  { const a = getEmpAge(emp);  if (a !== null) { const b = makeBadge('b-age', a + '歳'); if (hasApproxAge(emp)) { const ap = document.createElement('span'); ap.className = 'badge-approx'; ap.textContent = '概算'; b.appendChild(ap); } card.appendChild(b); } }
  if (badges.years){ const y = calcYears(emp.hireDate); if (y !== null) card.appendChild(makeBadge('b-years', y + '年')); }
  if (badges.adjHire) {
    const info = getAdjHireYearInfo(emp);
    if (info !== null) {
      const b = makeBadge('b-adjhire', info.year + '年相当');
      if (info.isUnset) {
        const ap = document.createElement('span'); ap.className = 'badge-approx'; ap.textContent = '学歴未設定'; b.appendChild(ap);
      }
      card.appendChild(b);
    }
  }
  if (badges.birthMonth) { const bm = getBirthMonth(emp.birthDate); if (bm !== null) card.appendChild(makeBadge('b-birthmonth', bm + '月生')); }
  if (badges.zodiac)     { 
    const z = getZodiac(emp.birthDate); 
    if (z !== null) {
      const b = document.createElement('span');
      b.className = 'badge b-zodiac';
      b.innerHTML = `<i class="${getZodiacIcon(z)}"></i>${z}年`;
      card.appendChild(b);
    }
  }
  if (badges.orgExp)     { const oy = getOrgExperienceYears(emp);   if (oy !== null) card.appendChild(makeBadge('b-orgexp', '部門' + oy + '年')); }
  if (badges.posExp)     { const py = getPosExperienceYears(emp);   if (py !== null) card.appendChild(makeBadge('b-posexp', '役職' + py + '年')); }

  if (badges.tags) empTagObjs(emp).forEach(tag => {
    const b = document.createElement('span'); b.className = 'badge';
    b.style.background = lighten(tag.color); b.style.color = tag.color; b.textContent = tag.name;
    card.appendChild(b);
  });
  if (badges.company)   { const b = makeCompanyBadge(emp);            if (b) card.appendChild(b); }
  if (badges.education) { const b = makeEducationBadge(emp.education); if (b) card.appendChild(b); }
  if (badges.school)    { const b = makeSchoolBadge(emp.school);       if (b) card.appendChild(b); }
  if (badges.orgStatus && emp._relationKind) {
    const kMap = {
      assignment: { label: '主務', class: 'b-org-assign', icon: 'fa-solid fa-rotate' },
      concurrent: { label: '兼務', class: 'b-org-concurrent', icon: 'fa-solid fa-code-branch' },
      secondment: { label: '出向', class: 'b-org-secondment', icon: 'fa-solid fa-right-left' },
      stationed:  { label: '駐在', class: 'b-org-stationed', icon: 'fa-solid fa-location-dot' },
      transfer:   { label: '転籍', class: 'b-org-transfer', icon: 'fa-solid fa-right-from-bracket' },
    };
    const kInfo = kMap[emp._relationKind] || kMap.assignment;
    const b = document.createElement('span');
    b.className = `badge ${kInfo.class}`;
    b.innerHTML = `<i class="${kInfo.icon}"></i>${kInfo.label}`;
    card.appendChild(b);
  }

  card.querySelectorAll('.badge').forEach(b => {
    b.dataset.origHtml = b.innerHTML;
  });

  return card;
}

/* ================================================================
   CARD HOVER POPUP
================================================================ */
let _avatarPopupTimer = null;

function _getOrCreatePopup() {
  let p = document.getElementById('avatar-card-popup');
  if (!p) {
    p = document.createElement('div');
    p.id = 'avatar-card-popup';
    p.className = 'avatar-card-popup';
    document.body.appendChild(p);
  }
  return p;
}

/** ポップアップ表示コンテンツ構築 */
function _buildPopupContent(emp) {
  const cfg = DB.settings.cardPopup;
  let html = `<div class="acp-name">${emp.lastName} ${emp.firstName}</div>`;

  // 写真（アバター）
  const _popAvatarId = getActiveAvatarId(emp);
  if (cfg.showAvatar && _popAvatarId && avatarMap.has(_popAvatarId)) {
    const as = getAvatarStyle(emp);
    html += `<div class="acp-img-wrap" style="aspect-ratio:${as.aspect}">
      <img src="${avatarMap.get(_popAvatarId)}" style="border-radius:${as.radius};object-fit:${as.fit}" alt="${emp.lastName}${emp.firstName}">
    </div>`;
  }

  // 入社年・在社年数
  if (cfg.showHireYear) {
    const year  = parseHireYear(emp.hireDate);
    const years = calcYears(emp.hireDate);
    const info  = getAdjHireYearInfo(emp);
    if (year !== null || years !== null || info !== null) {
      html += '<div class="acp-info-rows">';
      if (year  !== null) html += `<div class="acp-info-row"><i class="fa-solid fa-calendar-days acp-info-icon"></i><span>${year}年入社</span></div>`;
      if (info !== null) {
        const unsetMark = info.isUnset ? '<span style="opacity:0.6;font-size:9px;margin-left:3px">(学歴未設定)</span>' : '';
        html += `<div class="acp-info-row"><i class="fa-solid fa-scale-balanced acp-info-icon"></i><span>大卒換算: ${info.year}年${unsetMark}</span></div>`;
      }
      if (years !== null) html += `<div class="acp-info-row"><i class="fa-solid fa-hourglass-half acp-info-icon"></i><span>${years}年目</span></div>`;
      
      const orgY = getOrgExperienceYears(emp);
      if (orgY !== null) html += `<div class="acp-info-row"><i class="fa-solid fa-sitemap acp-info-icon"></i><span>部門経験: ${orgY}年目</span></div>`;
      const posY = getPosExperienceYears(emp);
      if (posY !== null) html += `<div class="acp-info-row"><i class="fa-solid fa-user-tie acp-info-icon"></i><span>役職経験: ${posY}年目</span></div>`;

      const state = getEmpActiveState(emp);
      if (state.orgLevels.length > 0 || state.position) {
        let orgText = state.orgLevels.join(' › ');
        let locText = '';
        if (state.kind === 'stationed' && state.workLocation) locText = ` <span style="opacity:0.8;font-size:10px;">[${state.workLocation}駐在]</span>`;
        else if (state.kind === 'secondment') locText = ` <span style="opacity:0.8;font-size:10px;">[出向]</span>`;
        html += `<div class="acp-info-row" style="margin-top:4px;"><i class="fa-solid fa-building-user acp-info-icon" style="color:var(--c-primary)"></i><span style="white-space:normal;line-height:1.4;">${orgText}${locText}<br>${state.position ? `<b style="color:var(--c-text);">${state.position}</b>` : ''}</span></div>`;
      }
      if (state.concurrents && state.concurrents.length > 0) {
        state.concurrents.forEach(c => {
          html += `<div class="acp-info-row"><i class="fa-solid fa-code-branch acp-info-icon" style="color:#059669"></i><span style="white-space:normal;line-height:1.4;opacity:0.9;">[兼] ${c.orgLevels.join(' › ')}<br>${c.position ? `<b style="color:var(--c-text);">${c.position}</b>` : ''}</span></div>`;
        });
      }

      const bm = getBirthMonth(emp.birthDate);
      const z  = getZodiac(emp.birthDate);
      if (bm !== null || z !== null) {
          const zStr = z ? `（<i class="${getZodiacIcon(z)}"></i> ${z}年）` : '';
          const mStr = bm ? `${bm}月生まれ` : '';
          html += `<div class="acp-info-row"><i class="fa-solid fa-cake-candles acp-info-icon"></i><span>${mStr}${zStr}</span></div>`;
      }

      html += '</div>';
    }
  }

  // バッジ（属性・状況・入社区分・課程）
  if (cfg.showBadges) {
    const parts = [];
    const _badge = (type, val) => {
      if (!val) return '';
      const col = getFlatMasterColor(type, val);
      const sty = col ? ` style="background:${lighten(col)};color:${col}"` : '';
      return `<span class="badge"${sty}>${val}</span>`;
    };
    if (emp.gender) {
      const gcls = genderClass(emp.gender);
      parts.push(`<span class="badge ${gcls}">${emp.gender}</span>`);
    }
    if (emp.attribute) parts.push(_badge('attribute', emp.attribute));
    if (emp.status)    parts.push(_badge('status',    emp.status));
    if (emp.hireType)  parts.push(_badge('hireType',  emp.hireType));
    if (emp.course)    parts.push(_badge('course',    emp.course));
    const age = getEmpAge(emp);
    if (age !== null) parts.push(`<span class="badge b-age">${age}歳</span>`);
    if (parts.length) html += `<div class="acp-badges">${parts.join('')}</div>`;
  }

  // メモ
  if (cfg.showMemo && emp.memo) {
    html += `<div class="acp-memo">${emp.memo}</div>`;
  }
  
  // 異動履歴
  if (cfg.showHistory && emp.transfers && emp.transfers.length > 0) {
    const trs = [...emp.transfers].sort((a,b) => (b.date||'').localeCompare(a.date||'')).slice(0, 5); // 最新5件
    html += `<div class="acp-history-list">`;
    trs.forEach(t => {
      const dateStr = t.date ? t.date.replace(/-/g, '/') : '時期不明';
      const pos = t.position ? `<span class="acp-history-pos">${t.position}</span>` : '';
      const org = Array.isArray(t.orgLevels) ? t.orgLevels.join('›') : '';
      html += `<div class="acp-history-item"><span class="acp-history-date">${dateStr}</span><span class="acp-history-body">${pos}${org}</span></div>`;
    });
    if (emp.transfers.length > 5) html += `<div style="font-size:9.5px;color:var(--c-text-3);text-align:center;">他 ${emp.transfers.length - 5} 件...</div>`;
    html += `</div>`;
  }

  return html;
}

/** コンテンツが名前のみかを判定（ポップアップ表示をスキップする条件） */
function _popupHasContent(emp) {
  const cfg = DB.settings.cardPopup;
  const _pid = getActiveAvatarId(emp);
  if (cfg.showAvatar && _pid && avatarMap.has(_pid)) return true;
  if (cfg.showHireYear && (parseHireYear(emp.hireDate) !== null || calcYears(emp.hireDate) !== null || getAdjHireYearInfo(emp) !== null || getEmpActiveState(emp).orgLevels.length > 0)) return true;
  if (cfg.showBadges   && (emp.gender || emp.attribute || emp.status || emp.hireType || emp.course || getEmpAge(emp) !== null)) return true;
  if (cfg.showMemo     && emp.memo) return true;
  if (cfg.showHistory  && emp.transfers && emp.transfers.length > 0) return true;
  return false;
}

function _showCardPopup(e) {
  const cfg = DB.settings.cardPopup;
  if (!cfg.enabled) return;

  const card  = e.currentTarget;
  const empId = card.getAttribute('data-empid');
  const emp   = DB.employees.find(x => x.id === empId);
  if (!emp) return;
  // コンテンツが名前のみになる場合は表示しない
  if (!_popupHasContent(emp)) return;

  clearTimeout(_avatarPopupTimer);
  _avatarPopupTimer = setTimeout(() => {
    const popup = _getOrCreatePopup();
    popup.dataset.size = cfg.size || 'md';
    popup.innerHTML    = _buildPopupContent(emp);
    popup.classList.add('is-visible');
    _positionPopup(popup, e);
  }, 260);
}

function _moveCardPopup(e) {
  const popup = document.getElementById('avatar-card-popup');
  if (popup?.classList.contains('is-visible')) _positionPopup(popup, e);
}

function _hideCardPopup() {
  clearTimeout(_avatarPopupTimer);
  const popup = document.getElementById('avatar-card-popup');
  if (popup) popup.classList.remove('is-visible');
}

function _positionPopup(popup, e) {
  const size = DB.settings.cardPopup?.size || 'md';
  const PW  = size === 'sm' ? 150 : size === 'lg' ? 300 : 230;
  const GAP = 14;
  // 実際の高さを取得（レンダリング後）、なければ推定値
  const PH  = popup.offsetHeight || (size === 'sm' ? 160 : size === 'lg' ? 320 : 240);
  let x = e.clientX + GAP;
  let y = e.clientY - PH / 2;
  if (x + PW > window.innerWidth  - 8) x = e.clientX - PW - GAP;
  if (y < 8)                           y = 8;
  if (y + PH > window.innerHeight - 8) y = window.innerHeight - PH - 8;
  popup.style.left = x + 'px';
  popup.style.top  = y + 'px';
}

/* ================================================================
   DISTRIBUTION — build axis label cell
================================================================ */
function buildAxisCell(key, yAxis, total, cls) {
  const meta   = getAxisMeta(key, yAxis);
  const el     = document.createElement('div'); el.className = cls;
  const keyEl  = document.createElement('span'); keyEl.className  = 'dist-row-key';  keyEl.textContent = meta.main;
  const unitEl = document.createElement('span'); unitEl.className = 'dist-row-unit'; unitEl.textContent = meta.sub;
  const cntEl  = document.createElement('span'); cntEl.className  = 'dist-row-cnt';  cntEl.textContent  = '·' + total + '名';
  el.append(keyEl, unitEl, cntEl);
  if (meta.wareki) {
    const wEl = document.createElement('span'); wEl.className = 'dist-row-wareki'; wEl.textContent = meta.wareki;
    el.insertBefore(wEl, cntEl);
  }
  return el;
}

/* ================================================================
   DISTRIBUTION — no-split
================================================================ */
function renderDistNoSplit(scroll, keys, groups, yAxis, badges) {
  const frag = document.createDocumentFragment();
  keys.forEach(key => {
    const emps    = groups[key] || [];
    const isEmpty = emps.length === 0;
    const row     = document.createElement('div');
    row.className = 'dist-row' + (isEmpty ? ' is-empty' : '');
    const axisCell = buildAxisCell(key, yAxis, emps.length, 'dist-row-label');
    if (isEmpty) axisCell.querySelector('.dist-row-cnt')?.classList.add('is-zero');
    row.appendChild(axisCell);
    const cards = document.createElement('div');
    cards.className = 'dist-cards dist-drop-zone';
    cards.dataset.dropkey = key; cards.dataset.dropyaxis = yAxis;
    emps.forEach(e => cards.appendChild(buildCard(e, badges, 'c')));
    row.appendChild(cards); frag.appendChild(row);
  });
  scroll.appendChild(frag);
  initDropZones();
}

/* ================================================================
   DISTRIBUTION — butterfly split
================================================================ */
function renderDistSplit(scroll, keys, groups, yAxis, badges, split) {
  const cfg = getSplitCfg(split);
  if (!cfg) return;

  let lTotal = 0, rTotal = 0, oTotal = 0;
  DB.employees.forEach(e => {
    const v = getSplitVal(e, split);
    if (v === cfg.left) lTotal++; else if (v === cfg.right) rTotal++; else oTotal++;
  });

  scroll.style.setProperty('--split-l-color', cfg.lColor);
  scroll.style.setProperty('--split-r-color', cfg.rColor);

  const buildBadgeHtml = (items, fallbackText) => {
    if (!items || !items.length) return `<span class="dist-sph-name">${fallbackText}</span>`;
    return `<div class="dist-sph-badges">${items.map(i => {
      const bg = lighten(i.color || '#94A3B8', 0.85);
      return `<span class="dist-sph-badge" style="background:${bg};color:${i.color || '#475569'}"><i class="${i.icon || 'fa-solid fa-circle'}"></i>${i.name}</span>`;
    }).join('')}</div>`;
  };

  const hdr = document.createElement('div'); hdr.className = 'dist-split-header';
  hdr.innerHTML = `
    <div class="dist-sph-l">
      <span class="dist-sph-cnt">${lTotal}名</span>
      ${buildBadgeHtml(cfg.leftItems, cfg.left)}
      <i class="fa-solid fa-arrow-right dist-sph-arrow"></i>
    </div>
    <div class="dist-sph-c">
      <i class="fa-solid fa-left-right"></i>
      <span>${cfg.label}</span>
    </div>
    <div class="dist-sph-r">
      <i class="fa-solid fa-arrow-left dist-sph-arrow"></i>
      ${buildBadgeHtml(cfg.rightItems, cfg.right)}
      <span class="dist-sph-cnt">${rTotal}名</span>
    </div>`;
  scroll.appendChild(hdr);

  const otherGroups = {};
  const frag = document.createDocumentFragment();
  keys.forEach(key => {
    const emps  = groups[key] || [];
    const lEmps = emps.filter(e => getSplitVal(e, split) === cfg.left);
    const rEmps = emps.filter(e => getSplitVal(e, split) === cfg.right);
    const oEmps = emps.filter(e => { const v = getSplitVal(e, split); return v !== cfg.left && v !== cfg.right; });
    oEmps.forEach(e => (otherGroups[key] = otherGroups[key] || []).push(e));

    const isEmpty = emps.length === 0;
    const row = document.createElement('div');
    row.className = 'dist-split-row' + (isEmpty ? ' is-empty' : '');

    const lPanel = document.createElement('div'); lPanel.className = 'dist-split-l dist-drop-zone';
    lPanel.dataset.dropkey = key; lPanel.dataset.dropyaxis = yAxis;
    lPanel.dataset.dropsplit = split; lPanel.dataset.dropsplitval = cfg.left;
    lEmps.forEach(e => lPanel.appendChild(buildCard(e, badges, 's')));

    const cPanel = buildAxisCell(key, yAxis, emps.length, 'dist-split-c');

    const rPanel = document.createElement('div'); rPanel.className = 'dist-split-r dist-drop-zone';
    rPanel.dataset.dropkey = key; rPanel.dataset.dropyaxis = yAxis;
    rPanel.dataset.dropsplit = split; rPanel.dataset.dropsplitval = cfg.right;
    rEmps.forEach(e => rPanel.appendChild(buildCard(e, badges, 's')));

    row.append(lPanel, cPanel, rPanel); frag.appendChild(row);
  });
  scroll.appendChild(frag);

  const oKeys = sortGroupKeys(Object.keys(otherGroups), yAxis);
  if (oKeys.length) {
    const wrap = document.createElement('div'); wrap.className = 'dist-others-wrap';
    wrap.innerHTML = `<div class="dist-others-hdr"><i class="fa-solid fa-circle-question"></i>未分類（${oTotal}名）</div>`;
    const ofrag = document.createDocumentFragment();
    oKeys.forEach(key => {
      const emps = otherGroups[key];
      const row  = document.createElement('div'); row.className = 'dist-row';
      row.appendChild(buildAxisCell(key, yAxis, emps.length, 'dist-row-label'));
      const cards = document.createElement('div'); cards.className = 'dist-cards dist-drop-zone';
      cards.dataset.dropkey = key; cards.dataset.dropyaxis = yAxis;
      emps.forEach(e => cards.appendChild(buildCard(e, badges, 'c')));
      row.appendChild(cards); ofrag.appendChild(row);
    });
    wrap.appendChild(ofrag); scroll.appendChild(wrap);
  }
  initDropZones();
}

/* ================================================================
   DISTRIBUTION — 全軸キー（数値軸の空行補完用）
================================================================ */
function getFullAxisKeys(yAxis, existingKeys) {
  const nums = existingKeys.filter(k => k !== '不明' && k !== '未設定').map(Number).filter(n => !isNaN(n));
  if (nums.length < 1) return existingKeys;
  const min = Math.min(...nums), max = Math.max(...nums);
  const full = [];
  for (let i = min; i <= max; i++) full.push(String(i));
  if (existingKeys.includes('不明'))   full.push('不明');
  if (existingKeys.includes('未設定')) full.push('未設定');
  return full;
}

/* ================================================================
   DISTRIBUTION — SEARCH HIGHLIGHT
================================================================ */
function updateDistHighlight() {
  const q = (document.getElementById('dist-search')?.value || '').trim();
  const cards = document.querySelectorAll('#dist-scroll .emp-card');
  if (!q) {
    cards.forEach(c => {
      c.classList.remove('is-dimmed');
      const nm = c.querySelector('.emp-card-name');
      if (nm && nm.dataset.origHtml) nm.innerHTML = nm.dataset.origHtml;
      c.querySelectorAll('.badge').forEach(b => {
        if (b.dataset.origHtml) b.innerHTML = b.dataset.origHtml;
      });
    });
    return;
  }
  cards.forEach(c => {
    const empId = c.dataset.empid;
    const emp = DB.employees.find(x => x.id === empId);
    if (!emp) return;
    const text = _buildEmpSearchText(emp);
    if (_matchSearchTerms(text, q)) {
      c.classList.remove('is-dimmed');
    } else {
      c.classList.add('is-dimmed');
    }
    
    // マーカー強調表示
    if (typeof highlightHTMLText === 'function') {
      const nm = c.querySelector('.emp-card-name');
      if (nm && nm.dataset.origHtml) nm.innerHTML = highlightHTMLText(nm.dataset.origHtml, q);
      c.querySelectorAll('.badge').forEach(b => {
        if (b.dataset.origHtml) b.innerHTML = highlightHTMLText(b.dataset.origHtml, q);
      });
    }
  });
}

/* ================================================================
   DISTRIBUTION — entry
================================================================ */
function renderDist() {
  const scroll = document.getElementById('dist-scroll');
  const stat   = document.getElementById('dist-stat');
  scroll.innerHTML = '';

  if (!DB.settings.split) {
    scroll.style.removeProperty('--split-l-color');
    scroll.style.removeProperty('--split-r-color');
  }

  if (!DB.employees.length) {
    scroll.innerHTML = '<div class="dist-empty"><i class="fa-solid fa-chart-simple"></i><p>従業員データがありません</p></div>';
    stat.textContent = ''; return;
  }

  const yAxis  = DB.settings.yAxis;
  const split  = DB.settings.split;
  const badges = DB.settings.badges;

  const visibleEmps = applyGlobalFilter(DB.employees);

  const groups = {};
  visibleEmps.forEach(e => { const k = getGroupKey(e, yAxis); (groups[k] = groups[k] || []).push(e); });

  // 空行補完は数値軸のみ
  const isNumericAxis = ['hire', 'adjHire', 'age', 'years'].includes(yAxis);
  let dataKeys = sortGroupKeys(Object.keys(groups), yAxis);
  let allKeys  = dataKeys;
  if (DB.settings.showEmptyRows && isNumericAxis) {
    allKeys = sortGroupKeys(getFullAxisKeys(yAxis, dataKeys), yAxis);
    allKeys.forEach(k => { if (!groups[k]) groups[k] = []; });
  }

  const filledCount = dataKeys.filter(k => k !== '不明' && k !== '未設定').length;
  const emptyCount  = allKeys.length - dataKeys.length;
  const hiddenCount = DB.employees.length - visibleEmps.length;
  stat.textContent  = DB.settings.showEmptyRows && isNumericAxis && emptyCount > 0
    ? `${filledCount}グループ · ${visibleEmps.length}名表示${hiddenCount ? ' · ' + hiddenCount + '名非表示' : ''} · 空行${emptyCount}`
    : `${filledCount}グループ · ${visibleEmps.length}名表示${hiddenCount ? ' · ' + hiddenCount + '名非表示' : ''}`;

  // ラベル列幅をCanvas実測でCSS変数にセット（見切れ防止）
  scroll.style.setProperty('--dist-label-w', computeLabelColWidth(allKeys, yAxis) + 'px');

  const multiColumnSplits = ['position', 'birthMonth', 'zodiac'];

  if (!split) {
    renderDistNoSplit(scroll, allKeys, groups, yAxis, badges);
  } else if (multiColumnSplits.includes(split)) {
    renderDistGrid(scroll, allKeys, groups, yAxis, badges, split);
  } else {
    renderDistSplit(scroll, allKeys, groups, yAxis, badges, split);
  }
  updateDistHighlight();
  _initDistLassoSelection();
}

let _distSelectedIds = new Set();
function _distClearSelection() {
  _distSelectedIds.clear();
  document.querySelectorAll('#dist-scroll .emp-card.is-selected').forEach(c => c.classList.remove('is-selected'));
}

function _initDistLassoSelection() {
  const container = document.getElementById('dist-scroll');
  if (!container || container.dataset.lassoInit) return;
  container.dataset.lassoInit = '1';

  let active = false;
  let startX = 0, startY = 0;
  let box = null;
  let initialSel = new Set();

  container.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    if (e.target.closest('.emp-card') || e.target.closest('button, input, select')) return;

    active = true;
    startX = e.clientX;
    startY = e.clientY;

    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      initialSel = new Set(_distSelectedIds);
    } else {
      initialSel = new Set();
      _distClearSelection();
    }

    if (!box) {
      box = document.createElement('div');
      box.className = 'lasso-selection-box';
      document.body.appendChild(box);
    }

    box.style.left = startX + 'px';
    box.style.top = startY + 'px';
    box.style.width = '0px';
    box.style.height = '0px';
    box.style.display = 'block';

    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!active || !box) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = width + 'px';
    box.style.height = height + 'px';

    const lassoRect = box.getBoundingClientRect();
    const cards = document.querySelectorAll('#dist-scroll .emp-card:not(.is-dimmed)');

    cards.forEach(card => {
      const rect = card.getBoundingClientRect();
      const isIntersecting = !(
        lassoRect.right < rect.left ||
        lassoRect.left > rect.right ||
        lassoRect.bottom < rect.top ||
        lassoRect.top > rect.bottom
      );

      const empid = card.dataset.empid;
      if (!empid) return;

      const shouldBeSelected = initialSel.has(empid) || isIntersecting;

      if (_distSelectedIds.has(empid) !== shouldBeSelected) {
        if (shouldBeSelected) {
          _distSelectedIds.add(empid);
          card.classList.add('is-selected');
        } else {
          _distSelectedIds.delete(empid);
          card.classList.remove('is-selected');
        }
      }
    });
  });

  document.addEventListener('mouseup', () => {
    if (!active) return;
    active = false;
    if (box) box.style.display = 'none';
  });
}

/* ================================================================
   DISTRIBUTION — Grid Mode (Multi-column)
================================================================ */
function renderDistGrid(scroll, keys, groups, yAxis, badges, split) {
  const lbl = getAxisLabel(split) || split;
  
  // X軸(split)のキーを全従業員から抽出しソート
  const xRaw = new Set();
  DB.employees.forEach(e => {
    const v = getSplitVal(e, split);
    if (v) xRaw.add(v);
  });
  let xKeys = [...xRaw];
  if (split === 'birthMonth') {
    xKeys.sort((a,b) => parseInt(a) - parseInt(b));
  } else if (split === 'zodiac') {
    const Z = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];
    xKeys.sort((a,b) => {
      const ia = Z.indexOf(a), ib = Z.indexOf(b);
      return (ia<0?99:ia) - (ib<0?99:ib);
    });
  } else {
    xKeys.sort((a,b) => a.localeCompare(b, 'ja'));
  }
  xKeys = xKeys.filter(k => k !== '未設定');
  xKeys.push('未設定');

  // グリッドコンテナ構築
  const gridWrap = document.createElement('div');
  gridWrap.className = 'dist-grid-wrap';
  
  const grid = document.createElement('div');
  grid.className = 'dist-grid';
  // 横スクロールを抑えるため、最小幅を180pxから120pxに縮小
  grid.style.gridTemplateColumns = `var(--dist-label-w, 100px) repeat(${xKeys.length}, minmax(120px, 1fr))`;

  // ヘッダー行生成
  const corner = document.createElement('div');
  corner.className = 'dist-grid-hdr corner';
  corner.innerHTML = `<span style="display:block;text-align:right;font-size:10px;color:var(--c-text-3)">${getAxisLabel(yAxis)} ↓</span><span style="display:block;font-size:10px;color:var(--c-text-3)">→ ${lbl}</span>`;
  grid.appendChild(corner);

  xKeys.forEach(xk => {
    const xh = document.createElement('div');
    xh.className = 'dist-grid-hdr';
    xh.textContent = xk;
    xh.title = xk; // 見切れた時用にツールチップを追加
    grid.appendChild(xh);
  });

  // データ行生成
  keys.forEach(yk => {
    const emps = groups[yk] || [];
    
    // Y軸セル
    const yCell = document.createElement('div');
    yCell.className = 'dist-grid-ylabel';
    yCell.appendChild(buildAxisCell(yk, yAxis, emps.length, 'dist-row-label'));
    grid.appendChild(yCell);
    
    // X軸ごとのセル
    xKeys.forEach(xk => {
      const cellEmps = emps.filter(e => getSplitVal(e, split) === xk);
      const cell = document.createElement('div');
      cell.className = 'dist-grid-cell dist-drop-zone';
      cell.dataset.dropkey = yk; 
      cell.dataset.dropyaxis = yAxis;
      cell.dataset.dropsplit = split; 
      cell.dataset.dropsplitval = xk;
      
      // グリッド専用のスタイル 'g' を適用し、幅いっぱいで縦並びにする
      cellEmps.forEach(e => cell.appendChild(buildCard(e, badges, 'g')));
      grid.appendChild(cell);
    });
  });

  gridWrap.appendChild(grid);
  scroll.appendChild(gridWrap);
  initDropZones();
}

/* ================================================================
   DISTRIBUTION — drag and drop
================================================================ */
function initDropZones() {
  document.querySelectorAll('.dist-drop-zone').forEach(zone => {
    zone.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const empIdsStr = e.dataTransfer.getData('text/plain');
      if (!empIdsStr) return;
      const empIds = empIdsStr.split(',');
      const emps = empIds.map(id => DB.employees.find(x => x.id === id)).filter(Boolean);
      if (!emps.length) return;

      const { dropkey:targetKey, dropyaxis:yAxis, dropsplit:split='', dropsplitval:splitVal='' } = zone.dataset;
      
      let allChanges = [];
      let hasError = false;
      let hasWarning = false;

      emps.forEach(emp => {
        const result = computeDropChanges(emp, targetKey, yAxis, split, splitVal);
        if (result?.__error) { toast(`${emp.lastName}: ${result.__error}`); hasError = true; }
        else if (result && result.length) {
          if (result.__warning) hasWarning = true;
          allChanges.push({ emp, changes: result });
        }
      });

      if (hasError || allChanges.length === 0) return;

      const isMulti = allChanges.length > 1;
      const titleName = isMulti ? `${allChanges.length}名の従業員` : `「${allChanges[0].emp.lastName} ${allChanges[0].emp.firstName}」`;
      
      let desc = isMulti 
        ? `${allChanges.length}名一括移動を実行します。` 
        : allChanges[0].changes.map(c => `${c.field}：${c.from} → ${c.to}`).join('\n');
        
      const warnLine = hasWarning ? `\n\n【警告】最新の異動履歴を直接変更する従業員が含まれています。` : '';

      openConfirm(
        `${titleName}を移動します\n\n${desc}${warnLine}\n\n変更してよろしいですか？`,
        () => {
          allChanges.forEach(({ emp, changes }) => {
            changes.forEach(c => {
              if (typeof c.customApply === 'function') c.customApply(emp);
              else emp[c.key] = c.newVal;
            });
          });
          _distClearSelection();
          saveDB(); renderDist();
          toast(`${titleName}を移動しました`);
        },
        isTransWarn ? {
          title:      '異動履歴の変更確認',
          icon:       'fa-solid fa-triangle-exclamation', iconColor: 'var(--c-warn)',
          innerIcon:  'fa-solid fa-clock-rotate-left',   innerColor:'var(--c-warn)',
          okLabel:    '変更する', okIcon:'fa-solid fa-check', okClass:'btn btn-primary'
        } : {
          title:     '移動の確認',
          icon:      'fa-solid fa-arrows-up-down-left-right', iconColor:'var(--c-primary)',
          innerIcon: 'fa-solid fa-arrows-up-down-left-right', innerColor:'var(--c-primary)',
          okLabel:   '移動する', okIcon:'fa-solid fa-check', okClass:'btn btn-primary'
        }
      );
    });
  });
}

/* ================================================================
   DISTRIBUTION — ドロップ変更計算（全軸対応）
================================================================ */
function computeDropChanges(emp, targetKey, yAxis, split, splitVal) {
  const changes = [], now = new Date();
  const SKIP    = ['不明', '未設定'];
  let   warning = null;
  let   error   = null;

  if (targetKey && !SKIP.includes(targetKey)) {
    // ── 数値軸──────────────────────────────────────────────
    if (yAxis === 'hire' || yAxis === 'adjHire') {
      const isAdj = yAxis === 'adjHire';
      const curYear = isAdj ? getAdjHireYearInfo(emp)?.year : parseHireYear(emp.hireDate);
      if (String(curYear) !== targetKey) {
        let actualTargetYear = parseInt(targetKey);
        if (isAdj) {
          const info = getAdjHireYearInfo(emp);
          if (info) actualTargetYear = parseInt(targetKey) - info.adj;
        }
        const newDate = emp.hireDate && emp.hireDate.length >= 5 ? actualTargetYear + emp.hireDate.slice(4) : String(actualTargetYear);
        changes.push({ field: isAdj ? '大卒換算入社年' : '入社年', from:(curYear?curYear+(isAdj?'年相当':'年'):'不明'), to:targetKey+(isAdj?'年相当':'年'), key:'hireDate', newVal:newDate });
      }
    } else if (yAxis === 'age') {
      const curAge = getEmpAge(emp);
      if (String(curAge) !== targetKey) {
        const birthYear = now.getFullYear() - parseInt(targetKey);
        const newBirth  = emp.birthDate && emp.birthDate.length >= 5 ? birthYear + emp.birthDate.slice(4) : birthYear + '-07-01';
        changes.push({ field:'誕生年', from:(curAge!==null?curAge+'歳':'不明'), to:targetKey+'歳相当', key:'birthDate', newVal:String(newBirth) });
      }
    } else if (yAxis === 'years') {
      const curYrs = calcYears(emp.hireDate);
      if (String(curYrs) !== targetKey) {
        const hireYear = now.getFullYear() - parseInt(targetKey);
        const newHire  = emp.hireDate && emp.hireDate.length >= 5 ? hireYear + emp.hireDate.slice(4) : String(hireYear);
        changes.push({ field:'在社年数', from:(curYrs!==null?curYrs+'年':'不明'), to:targetKey+'年相当', key:'hireDate', newVal:newHire });
      }
    }
    // 自動計算のためドロップ変更不可の項目
    else if (['orgExp', 'posExp', 'birthMonth', 'zodiac'].includes(yAxis)) {
      error = `「${getAxisLabel(yAxis)}」は自動計算される項目のため、ドラッグ＆ドロップで直接変更することはできません。`;
    }
    // ── フラット分類軸───────────────────────────────────────
    else if (['gender','attribute','status','hireType','course','education'].includes(yAxis)) {
      const curVal = emp[yAxis] || '未設定';
      if (curVal !== targetKey) {
        changes.push({ field: getAxisLabel(yAxis), from: curVal, to: targetKey, key: yAxis, newVal: targetKey });
      }
    }
    // ── 学校マスタ L0（学校名） ─────────────────────────────
    else if (yAxis === 'school_l0') {
      const curVal = emp.school || '未設定';
      if (curVal !== targetKey) {
        changes.push({ field: getAxisLabel(yAxis), from: curVal, to: targetKey, key: 'school', newVal: targetKey });
      }
    }
    // ── 学校マスタ L1（学部・研究科） ────────────────────────
    else if (yAxis === 'school_l1') {
      const curPart = parseEduDeptPart(emp.eduDept, 0) || '未設定';
      if (curPart !== targetKey) {
        const rest   = parseEduDeptPart(emp.eduDept, 1) || '';
        const newVal = rest ? `${targetKey} ${rest}` : targetKey;
        changes.push({ field: getAxisLabel(yAxis), from: curPart, to: targetKey, key: 'eduDept', newVal });
      }
    }
    // ── 学校マスタ L2（学科・専攻） ──────────────────────────
    else if (yAxis === 'school_l2') {
      const curPart = parseEduDeptPart(emp.eduDept, 1) || '未設定';
      if (curPart !== targetKey) {
        const dept   = parseEduDeptPart(emp.eduDept, 0) || '';
        const newVal = dept ? `${dept} ${targetKey}` : targetKey;
        changes.push({ field: getAxisLabel(yAxis), from: curPart, to: targetKey, key: 'eduDept', newVal });
      }
    }
    // ── 会社マスタ階層 ──────────────────────────────────────
    else if (yAxis.startsWith('company_l')) {
      if (!Array.isArray(emp.transfers) || emp.transfers.length === 0) {
        // 履歴なし → エラー扱い（変更不可）
        error = `「${emp.lastName} ${emp.firstName}」に異動履歴が登録されていません。\n先に異動履歴を追加してからドラッグしてください。`;
      } else {
        const level    = parseInt(yAxis.slice(9));
        const fldNames = { 0:'company', 1:'department', 2:'division' };
        const fldName  = fldNames[level];
        if (fldName) {
          const curVal   = getEmpCompanyLevel(emp, level) || '未設定';
          const latestTr = getLatestTransfer(emp);
          if (curVal !== targetKey) {
            // 最新履歴を変更することを警告
            warning = `最新の異動履歴（${latestTr?.date || '日付不明'}）の「${getAxisLabel(yAxis)}」欄を直接変更します。\n必要に応じて異動履歴タブで内容を確認してください。`;
            changes.push({
              field: getAxisLabel(yAxis), from: curVal, to: targetKey,
              key: '__transfer',
              customApply: (e) => {
                const tr = getLatestTransfer(e);
                if (!tr) return;
                const state = getEmpActiveState(e);
                // 最新履歴が positionChange 等で orgLevels が空なら、直前の状態をクローンして更新する
                if (!Array.isArray(tr.orgLevels) || tr.orgLevels.length === 0) {
                  tr.orgLevels = [...state.orgLevels];
                }
                tr.orgLevels[level] = targetKey;
              }
            });
          }
        }
      }
    }
  }

  // エラーがあれば早期返却（変更なし・トースト通知用）
  if (error) {
    const r = [];
    r.__error = error;
    return r;
  }

  // ── スプリット変更 ────────────────────────────────────────
  if (split && splitVal && !isNumericSplit(split)) {
    const cfg = getSplitCfg(split);
    if (cfg) {
      let splitKey  = null;
      const fieldName = cfg.label;
      if      (split === 'attribute') splitKey = 'attribute';
      else if (split === 'gender')    splitKey = 'gender';
      else if (split === 'hireType')  splitKey = 'hireType';
      else if (split === 'status')    splitKey = 'status';
      else if (split === 'course')    splitKey = 'course';

      if (splitKey) {
        const curVal = emp[splitKey] || '未設定';
        let targetVal = splitVal;
        let skipSplit = false;
        if (split !== 'gender') {
          const flatCfg = getSplitCfgForFlat(split);
          if (flatCfg) {
            if      (splitVal === flatCfg.left  && flatCfg.leftNames.includes(curVal))  skipSplit = true;
            else if (splitVal === flatCfg.right && flatCfg.rightNames.includes(curVal)) skipSplit = true;
            else targetVal = (splitVal === flatCfg.left) ? flatCfg.leftNames[0] : flatCfg.rightNames[0];
          }
        } else {
          if (curVal === splitVal) skipSplit = true;
        }
        if (!skipSplit) {
          changes.push({ field:fieldName, from:curVal, to:targetVal, key:splitKey, newVal:targetVal });
        }
      }
    }
  }

  if (!changes.length) return null;
  if (warning) changes.__warning = warning;
  return changes;
}

/* ================================================================
   HEATMAP — AXIS DEFINITIONS
================================================================ */
const HM_AXES = {
  hire:      { label:'入社年',              fn: e => { const y = parseHireYear(e.hireDate); return y ? String(y) : null; }, numFn: e => parseHireYear(e.hireDate), sortNum: true },
  adjHire:   { label:'換算入社年(大卒基準)', fn: e => { const info = getAdjHireYearInfo(e); return info ? String(info.year) : null; }, numFn: e => { const info = getAdjHireYearInfo(e); return info ? info.year : null; }, sortNum: true },
  age:       { label:'年齢',               fn: e => { const a = getEmpAge(e);      return a !== null ? String(a) : null; }, numFn: e => getEmpAge(e), sortNum: true },
  age5:      { label:'年齢（5歳刻み）',     fn: e => { const a = getEmpAge(e);      if (a === null) return null; const b = Math.floor(a/5)*5; return `${b}〜${b+4}歳`; }, numFn: e => getEmpAge(e), sortNum: true, bandOf: 5, bandSrc: 'age' },
  years:     { label:'在社年数',            fn: e => { const y = calcYears(e.hireDate); return y !== null ? String(y) : null; }, numFn: e => calcYears(e.hireDate), sortNum: true },
  years5:    { label:'在社年数（5年刻み）', fn: e => { const y = calcYears(e.hireDate); if (y === null) return null; const b = Math.floor(y/5)*5; return `${b}〜${b+4}年`; }, numFn: e => calcYears(e.hireDate), sortNum: true, bandOf: 5, bandSrc: 'years' },
  birthMonth:{ label:'誕生月',              fn: e => { const m = getBirthMonth(e.birthDate); return m !== null ? String(m) : null; }, numFn: e => getBirthMonth(e.birthDate), sortNum: true },
  zodiac:    { label:'干支',                fn: e => getZodiac(e.birthDate), order: ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'] },
  orgExp:    { label:'部門経験年数',        fn: e => { const y = getOrgExperienceYears(e); return y !== null ? String(y) : null; }, numFn: e => getOrgExperienceYears(e), sortNum: true },
  posExp:    { label:'役職経験年数',        fn: e => { const y = getPosExperienceYears(e); return y !== null ? String(y) : null; }, numFn: e => getPosExperienceYears(e), sortNum: true },
  position:  { label:'役職',                fn: e => getEmpActiveState(e).position || null, sortStr: true },
  gender:    { label:'性別',     fn: e => e.gender    || null, sortStr: true },
  attribute: { label:'属性',     fn: e => e.attribute || null, sortStr: true },
  status:    { label:'在籍状況', fn: e => e.status    || null, sortStr: true },
  hireType:  { label:'入社区分', fn: e => e.hireType  || null, sortStr: true },
  course:    { label:'履修系統', fn: e => e.course    || null, sortStr: true },
  education: { label:'学歴',     fn: e => e.education || null,
    order: ['中卒','高卒','高専卒','短大卒','専門卒','大卒','修士','博士'] },
};

function hmColorRGBObj(ratio) {
  if (ratio <= 0) return { r: 255, g: 255, b: 255 };
  return {
    r: Math.round(255 + (37  - 255) * ratio),
    g: Math.round(255 + (99  - 255) * ratio),
    b: Math.round(255 + (235 - 255) * ratio)
  };
}
function hmColor(ratio) {
  const { r, g, b } = hmColorRGBObj(ratio);
  return ratio <= 0 ? '#FFFFFF' : `rgb(${r},${g},${b})`;
}
function hmTextColor(ratio) { return ratio > 0.55 ? '#FFFFFF' : '#0F172A'; }

function hmGetKeys(axisKey, emps, dir = 'asc') {
  const def = HM_AXES[axisKey];
  const raw = new Set();
  emps.forEach(e => { const v = def.fn(e); if (v !== null) raw.add(v); });
  const keys = [...raw];
  if (def.order) {
    keys.sort((a, b) => { const ia = def.order.indexOf(a), ib = def.order.indexOf(b); return (ia<0?99:ia) - (ib<0?99:ib); });
    if (dir === 'desc') keys.reverse();
  } else if (def.sortNum) {
    keys.sort((a, b) => dir === 'desc' ? parseInt(b) - parseInt(a) : parseInt(a) - parseInt(b));
  } else {
    keys.sort((a, b) => dir === 'desc' ? b.localeCompare(a, 'ja') : a.localeCompare(b, 'ja'));
  }
  return keys;
}

/* ================================================================
   HEATMAP — TOOLTIP
================================================================ */
let hmTooltipTimer = null;
const hmTip = (() => {
  const el = document.getElementById('hm-tooltip');
  return {
    show(emps, cellInfo, x, y) {
      if (hmTooltipTimer) clearTimeout(hmTooltipTimer);
      if (!emps.length) { this.hide(); return; }
      const cnt = emps.length;
      el.innerHTML = `
        <div class="hm-tip-head">
          <div class="hm-tip-badge">
            <span>${cellInfo.yLabel} × ${cellInfo.xLabel}</span>
            <span class="cnt">${cnt}名</span>
          </div>
          <span class="hm-tip-sub">${cellInfo.yAxisLabel}：${cellInfo.yLabel} ／ ${cellInfo.xAxisLabel}：${cellInfo.xLabel}</span>
        </div>
        <div class="hm-tip-list">${emps.map(e => {
          const age   = calcAge(e.birthDate);
          const years = calcYears(e.hireDate);
          const meta  = [e.gender, e.attribute, age !== null ? age+'歳' : null, years !== null ? years+'年目' : null].filter(Boolean).join(' · ');
          return `<div class="hm-tip-emp"><span class="hm-tip-emp-name">${e.lastName} ${e.firstName}</span><span class="hm-tip-emp-meta">${meta}</span></div>`;
        }).join('')}</div>`;
      el.style.left = '0'; el.style.top = '0'; el.style.display = 'block';
      const w = el.offsetWidth, h = el.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      let lx = x + 14, ly = y + 14;
      if (lx + w > vw - 12) lx = x - w - 10;
      if (ly + h > vh - 12) ly = y - h - 10;
      el.style.left = lx + 'px'; el.style.top = ly + 'px';
      el.classList.add('show');
    },
    hide() {
      hmTooltipTimer = setTimeout(() => { el.classList.remove('show'); }, 80);
    }
  };
})();

/* ================================================================
   HEATMAP — HELPERS
================================================================ */
let _hmChartInstances = [];

/**
 * 横軸ラベルの回転方針を決定する。
 * 「軸単位」で統一するため、1つでも長いラベルがあれば全て90°回転とする。
 */
function _hmTickRotation(keys) {
  const maxLen = keys.length ? Math.max(...keys.map(k => String(k).length)) : 0;
  if (keys.length > 8 || (keys.length > 5 && maxLen > 3) || maxLen > 6) {
    return { maxRotation: 90, minRotation: 90 };
  }
  return { maxRotation: 0, minRotation: 0 };
}

/** エリア別グラフ形式セレクタのオプションを生成 */
const _HM_FMT_OPTS = [
  { value: 'table',       label: '表（クロス集計）' },
  { value: '3d',          label: '3D 棒グラフ' },
  { value: '3d_surface',  label: '3D サーフェス（曲面）' },
  { value: '3d_wireframe',label: '3D ワイヤーフレーム' },
  { value: 'bar',         label: '棒グラフ' },
  { value: 'stacked_bar', label: '積み上げ棒グラフ' },
  { value: 'histogram',   label: 'ヒストグラム' },
  { value: 'line',        label: '折線グラフ' },
  { value: 'area',        label: '面グラフ' },
  { value: 'pie',         label: '円グラフ' },
  { value: 'doughnut',    label: 'ドーナツグラフ' },
  { value: 'polarArea',   label: '鶏頭図 (Polar Area)' },
  { value: 'radar',       label: 'レーダーチャート' },
  { value: 'scatter',     label: '散布図' },
  { value: 'bubble',      label: 'バブルチャート' },
  { value: 'boxplot',     label: '箱ひげ図' },
  { value: 'violin',      label: 'バイオリン図' },
  { value: 'boxviolin',   label: '箱ひげ＋バイオリン' },
  { value: 'swarm',       label: 'スウォームプロット' },
  { value: 'swarmviolin', label: 'バイオリン＋スウォーム' },
];
function _buildFmtOptions(sel, selectedValue) {
  _HM_FMT_OPTS.forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.label;
    if (o.value === selectedValue) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderHeatmapHistogramChart(emps, yDef, subCon, index, panel) {
  if (!yDef.numFn) {
    const msg = document.createElement('div');
    msg.className = 'dist-empty';
    msg.style.minHeight = '200px';
    msg.innerHTML = `<i class="fa-solid fa-circle-info" style="color:var(--c-text-3)"></i><p>「${yDef.label}」は数値データではないため、ヒストグラムを描画できません。対象データ（Y軸）に数値軸を選択してください。</p>`;
    subCon.appendChild(msg);
    return;
  }

  const values = emps.map(e => yDef.numFn(e)).filter(v => v !== null && v !== undefined && !isNaN(v)).map(Number);

  if (values.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'dist-empty';
    msg.style.minHeight = '200px';
    msg.innerHTML = `<i class="fa-solid fa-circle-info" style="color:var(--c-text-3)"></i><p>有効な数値データがありません。</p>`;
    subCon.appendChild(msg);
    return;
  }

  values.sort((a, b) => a - b);
  const min = values[0];
  const max = values[values.length - 1];
  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / values.length;
  
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;

  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  const numBins = panel.numBins ? panel.numBins : Math.max(5, Math.ceil(1 + Math.log2(values.length)));
  let binWidth = (max - min) / numBins;
  if (binWidth === 0) binWidth = 1;
  if (!panel.numBins) {
    const mag = Math.pow(10, Math.floor(Math.log10(binWidth)));
    const rel = binWidth / mag;
    if (rel <= 1) binWidth = 1 * mag;
    else if (rel <= 2) binWidth = 2 * mag;
    else if (rel <= 5) binWidth = 5 * mag;
    else binWidth = 10 * mag;
  }

  let niceMin = Math.floor(min / binWidth) * binWidth;
  let niceMax = Math.ceil(max / binWidth) * binWidth;

  const ar = panel.axisRange || {};
  const arMode = ar.mode || 'auto';
  if (arMode === 'manual') {
    if (ar.min !== null && ar.min !== undefined && ar.min !== '') niceMin = +ar.min;
    if (ar.max !== null && ar.max !== undefined && ar.max !== '') niceMax = +ar.max;
  } else if (arMode === 'zero') {
    niceMin = 0;
  }
  
  const actualBins = Math.max(1, Math.ceil((niceMax - niceMin) / binWidth));

  const bins = new Array(actualBins).fill(0);
  const binLabels = [];
  for (let i = 0; i < actualBins; i++) {
    binLabels.push(`${niceMin + i * binWidth}〜${niceMin + (i + 1) * binWidth}`);
  }

  let modeBinIdx = 0;
  let maxFreq = 0;
  values.forEach(v => {
    if (v < niceMin || v > niceMax) return; // 手動範囲外を除外
    let idx = Math.floor((v - niceMin) / binWidth);
    if (idx >= actualBins) idx = actualBins - 1;
    if (idx < 0) idx = 0;
    bins[idx]++;
    if (bins[idx] > maxFreq) {
      maxFreq = bins[idx];
      modeBinIdx = idx;
    }
  });

  const modeStr = `${niceMin + modeBinIdx * binWidth}〜${niceMin + (modeBinIdx + 1) * binWidth}`;

  const chartWrap = document.createElement('div');
  chartWrap.className = 'hm-histogram-wrap';
  // 高さが限られている場合にも対応できるよう min-height の直書きを排除し、flex:1 で親に追従・ラップさせずに固定レイアウト
  chartWrap.style.cssText = 'display:flex; gap:12px; width:100%; flex:1; min-height:0; align-items:stretch; margin-bottom:0;';
  
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'hm-chart-wrap';
  // min-height を 0 にし、エリアの圧縮に対して柔軟に追従させる
  canvasWrap.style.cssText = 'flex: 1 1 0; min-width:0; position:relative; min-height:0; background:#fff; border-radius:8px; border:1px solid var(--c-border); padding:8px; overflow:hidden;';
  const canvasId = `hm-hist-canvas-${index}`;
  canvasWrap.innerHTML = `<canvas id="${canvasId}"></canvas>`;
  
  const statWrap = document.createElement('div');
  // 統計エリアは右側固定幅とし、高さが足りない場合は内部スクロールで情報を欠落させない（グレースフル・デグラデーション）
  statWrap.className = 'hm-histogram-stat-wrap';
  statWrap.style.cssText = 'flex: 0 0 210px; display:flex; flex-direction:column; gap:6px; min-height:0; overflow-y:auto; padding-right:4px;';
  
  const statCard = (lbl, val, icon, color) => `
    <div style="background:var(--c-surface-2); border:1px solid var(--c-border); border-radius:6px; padding:6px 10px; display:flex; align-items:center; gap:8px; box-shadow: 0 1px 2px rgba(0,0,0,0.02); flex-shrink:0;">
      <div style="width:28px; height:28px; border-radius:6px; background:color-mix(in srgb, ${color} 15%, transparent); color:${color}; display:flex; align-items:center; justify-content:center; font-size:12px; flex-shrink:0;">
        <i class="${icon}"></i>
      </div>
      <div style="display:flex; flex-direction:column; min-width:0; flex:1;">
        <span style="font-size:9.5px; font-weight:700; color:var(--c-text-3); text-transform:uppercase; letter-spacing:0.02em; line-height:1.2;">${lbl}</span>
        <span style="font-size:13.5px; font-weight:800; color:var(--c-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.2;" title="${val}">${val}</span>
      </div>
    </div>
  `;

  statWrap.innerHTML = `
    ${statCard('データ数 (N)', `${values.length} 名`, 'fa-solid fa-users', '#3B82F6')}
    ${statCard('平均値 (Mean)', mean.toFixed(1), 'fa-solid fa-scale-balanced', '#10B981')}
    ${statCard('中央値 (Median)', median.toFixed(1), 'fa-solid fa-arrows-down-to-line', '#F59E0B')}
    ${statCard('最頻 (Mode)', modeStr, 'fa-solid fa-chart-column', '#8B5CF6')}
    ${statCard('標準偏差 (StdDev)', stdDev.toFixed(2), 'fa-solid fa-chart-line', '#EC4899')}
    <div style="display:flex; gap:6px; flex-shrink:0;">
      <div style="flex:1; min-width:0;">${statCard('最小', min, 'fa-solid fa-arrow-down', '#64748B')}</div>
      <div style="flex:1; min-width:0;">${statCard('最大', max, 'fa-solid fa-arrow-up', '#64748B')}</div>
    </div>
  `;

  chartWrap.appendChild(canvasWrap);
  chartWrap.appendChild(statWrap);
  subCon.appendChild(chartWrap);

  function drawChart() {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const drawNormalCurve = true;
    const isHorizontal = panel.horizontal || false;

    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: isHorizontal ? 'y' : 'x',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { family: "'DM Sans','Noto Sans JP',sans-serif", size: 11 } } },
        tooltip: {
          callbacks: {
            title: (ctx) => `階級: ${ctx[0].label}`,
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}${ctx.dataset.type === 'line' ? '' : ' 名'}`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: isHorizontal ? '人数 (名)' : yDef.label, font: { size: 12, weight: 'bold' }, color: '#475569' },
          grid: { display: isHorizontal },
          ticks: { font: { size: 11 } }
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: isHorizontal ? yDef.label : '人数 (名)', font: { size: 12, weight: 'bold' }, color: '#475569' },
          grid: { display: !isHorizontal, color: '#F1F5F9' },
          ticks: { stepSize: isHorizontal ? undefined : 1, precision: isHorizontal ? undefined : 0, font: { size: 11 } }
        }
      }
    };

    const datasets = [{
      type: 'bar',
      label: '度数 (人数)',
      data: bins,
      backgroundColor: 'rgba(59, 130, 246, 0.7)',
      borderColor: '#2563EB',
      borderWidth: 1,
      barPercentage: 1.0,
      categoryPercentage: 1.0
    }];

    if (drawNormalCurve && stdDev > 0) {
      const normalData = [];
      const multiplier = values.length * binWidth;
      for (let i = 0; i < actualBins; i++) {
        const xVal = niceMin + (i + 0.5) * binWidth;
        const exponent = Math.exp(-Math.pow(xVal - mean, 2) / (2 * Math.pow(stdDev, 2)));
        const density = (1 / (stdDev * Math.sqrt(2 * Math.PI))) * exponent;
        normalData.push(Number((density * multiplier).toFixed(2)));
      }
      datasets.push({
        type: 'line',
        label: '正規分布曲線',
        data: normalData,
        borderColor: '#EC4899',
        backgroundColor: 'transparent',
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 0,
        borderDash: [5, 5]
      });
    }

    const chartInst = new Chart(canvas, { data: { labels: binLabels, datasets }, options: chartOptions });
    _hmChartInstances.push(chartInst);
  }

  requestAnimationFrame(drawChart);
}

/* ================================================================
   HEATMAP — PANELS & OPTIONS POPOVER
================================================================ */
function initHeatmapEvents() {
  document.getElementById('btn-hm-add-panel')?.addEventListener('click', () => {
    if (!DB.settings.hm.panels) DB.settings.hm.panels = [];
    if (DB.settings.hm.panels.length >= 3) return;
    const pTemplate = DB.settings.hm.panels.length > 0 
      ? JSON.parse(JSON.stringify(DB.settings.hm.panels[DB.settings.hm.panels.length - 1])) 
      : { xAxis: 'gender', yAxis: 'hire', dispMode: 'count', format: 'table', horizontal: false, swapAxis: false, xAxisDir: 'asc', yAxisDir: 'asc', axisRange: { mode: 'auto', min: null, max: null, niceScale: true } };
    pTemplate.id = 'p_' + Date.now();
    DB.settings.hm.panels.push(pTemplate);
    saveDB();
    renderHeatmap();
  });

  const popover = document.getElementById('hm-panel-options-popover');
  document.addEventListener('click', e => {
    if (popover && !popover.contains(e.target) && !e.target.closest('.hm-btn-opt')) {
      popover.style.display = 'none';
    }
  });

  document.getElementById('pop-hm-btn-ydir')?.addEventListener('click', () => {
    const pid = popover.dataset.pid;
    const panel = DB.settings.hm.panels.find(p => p.id === pid);
    if (panel) { panel.yAxisDir = panel.yAxisDir === 'asc' ? 'desc' : 'asc'; saveDB(); syncHmPopover(panel); renderHeatmap(); }
  });
  document.getElementById('pop-hm-btn-xdir')?.addEventListener('click', () => {
    const pid = popover.dataset.pid;
    const panel = DB.settings.hm.panels.find(p => p.id === pid);
    if (panel) { panel.xAxisDir = panel.xAxisDir === 'asc' ? 'desc' : 'asc'; saveDB(); syncHmPopover(panel); renderHeatmap(); }
  });
  document.getElementById('pop-hm-btn-swap')?.addEventListener('click', () => {
    const pid = popover.dataset.pid;
    const panel = DB.settings.hm.panels.find(p => p.id === pid);
    if (panel) { panel.swapAxis = !panel.swapAxis; saveDB(); syncHmPopover(panel); renderHeatmap(); }
  });

  document.querySelectorAll('#hm-panel-options-popover .hm-range-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = popover.dataset.pid;
      const panel = DB.settings.hm.panels.find(p => p.id === pid);
      if (panel) { panel.axisRange.mode = btn.dataset.mode; saveDB(); syncHmPopover(panel); renderHeatmap(); }
    });
  });

  ['pop-hm-range-min', 'pop-hm-range-max'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', e => {
      const pid = popover.dataset.pid;
      const panel = DB.settings.hm.panels.find(p => p.id === pid);
      if (panel) {
        const v = e.target.value;
        if (id.includes('min')) panel.axisRange.min = v === '' ? null : +v;
        else panel.axisRange.max = v === '' ? null : +v;
        saveDB(); renderHeatmap();
      }
    });
  });

  document.getElementById('pop-hm-range-nice-chk')?.addEventListener('change', e => {
    const pid = popover.dataset.pid;
    const panel = DB.settings.hm.panels.find(p => p.id === pid);
    if (panel) { panel.axisRange.niceScale = e.target.checked; saveDB(); renderHeatmap(); }
  });

  document.getElementById('pop-hm-num-bins')?.addEventListener('change', e => {
    const pid = popover.dataset.pid;
    const panel = DB.settings.hm.panels.find(p => p.id === pid);
    if (panel) {
      const v = e.target.value;
      panel.numBins = v === '' ? null : Math.max(1, +v);
      saveDB(); renderHeatmap();
    }
  });
}

function syncHmPopover(panel) {
  if (!panel) return;
  const isValChart = ['bar','stacked_bar','line','area','scatter','bubble'].includes(panel.format);
  const isDistChart = ['boxplot','violin','boxviolin','swarm','swarmviolin'].includes(panel.format);
  const hasValueAxis = isValChart || isDistChart;

  const isHistogram = panel.format === 'histogram';
  document.getElementById('pop-hm-range-section').style.display = (hasValueAxis || isHistogram) ? '' : 'none';
  const binRow = document.getElementById('pop-hm-bin-row');
  if (binRow) binRow.style.display = isHistogram ? '' : 'none';
  const binInput = document.getElementById('pop-hm-num-bins');
  if (binInput) binInput.value = panel.numBins || '';
  const ydirLbl = document.getElementById('pop-hm-lbl-ydir');
  if (ydirLbl) ydirLbl.textContent = panel.yAxisDir === 'asc' ? '昇順' : '降順';
  const xdirLbl = document.getElementById('pop-hm-lbl-xdir');
  if (xdirLbl) xdirLbl.textContent = panel.xAxisDir === 'asc' ? '昇順' : '降順';
  
  const swapBtn = document.getElementById('pop-hm-btn-swap');
  if (swapBtn) swapBtn.style.display = 'none';

  const ar = panel.axisRange || { mode:'auto', min:null, max:null, niceScale:true };
  document.querySelectorAll('#hm-panel-options-popover .hm-range-mode-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.mode === ar.mode);
  });
  document.getElementById('pop-hm-range-manual-row').style.display = ar.mode === 'manual' ? '' : 'none';
  document.getElementById('pop-hm-range-min').value = ar.min !== null ? ar.min : '';
  document.getElementById('pop-hm-range-max').value = ar.max !== null ? ar.max : '';
  document.getElementById('pop-hm-range-nice-chk').checked = ar.niceScale !== false;
}

function openHmPopover(btn, pid) {
  const popover = document.getElementById('hm-panel-options-popover');
  const panel = DB.settings.hm.panels.find(p => p.id === pid);
  if (!popover || !panel) return;
  popover.dataset.pid = pid;
  syncHmPopover(panel);
  popover.style.display = 'block';
  const rect = btn.getBoundingClientRect();
  popover.style.position = 'fixed';
  popover.style.top = (rect.bottom + 6) + 'px';
  let left = rect.right - 260; 
  if (left < 8) left = 8;
  popover.style.left = left + 'px';
}

/* ================================================================
   HEATMAP — RENDER CORE
================================================================ */
function renderHeatmap() {
  if (!DB.settings.hm.panels || DB.settings.hm.panels.length === 0) {
    DB.settings.hm.panels = [{ id: 'p1', xAxis: 'gender', yAxis: 'hire', dispMode: 'count', format: 'table', horizontal: false, swapAxis: false, xAxisDir: 'asc', yAxisDir: 'asc', axisRange: { mode: 'auto', min: null, max: null, niceScale: true } }];
  }
  const panels = DB.settings.hm.panels;
  const emps = applyGlobalFilter(DB.employees);
  const stat = document.getElementById('hm-stat');
  const con  = document.getElementById('hm-container');

  const btnAdd = document.getElementById('btn-hm-add-panel');
  const msgLimit = document.getElementById('hm-panel-limit-msg');
  if (btnAdd && msgLimit) {
    if (panels.length >= 3) { btnAdd.disabled = true; msgLimit.style.display = ''; }
    else { btnAdd.disabled = false; msgLimit.style.display = 'none'; }
  }

  _hmChartInstances.forEach(c => { try { c.destroy(); } catch(e){} });
  _hmChartInstances = [];

  if (con.userData && con.userData.reqIds) {
    con.userData.reqIds.forEach(id => cancelAnimationFrame(id));
    if (con.userData.renderers) con.userData.renderers.forEach(r => r.dispose());
    con.userData = null;
  }
  
  con.innerHTML = '';

  const scrollEl = document.getElementById('hm-scroll');
  const anyChartMode = panels.some(p => p.format !== 'table');
  if (scrollEl) scrollEl.classList.toggle('is-chart-mode', anyChartMode);
  con.classList.toggle('is-chart-mode', anyChartMode);

  if (!emps.length) {
    con.innerHTML = '<div class="dist-empty"><i class="fa-solid fa-table-cells"></i><p>従業員データがありません</p></div>';
    if (stat) stat.textContent = ''; return;
  }

  if (stat) stat.textContent = `${panels.length}つのグラフを表示中`;

  panels.forEach((panel, index) => {
    const xDef = HM_AXES[panel.xAxis] || HM_AXES['gender'];
    const yDef = HM_AXES[panel.yAxis] || HM_AXES['hire'];
    const xKey = panel.xAxis;
    const yKey = panel.yAxis;
    const format = panel.format;
    const isHorizontal = panel.horizontal || false; // グラフの向き（縦/横）
    const disp = panel.dispMode;
    const pid = panel.id;

    const subCon = document.createElement('div');
    subCon.className = 'hm-sub-container';
    if (format === 'table' || format === '3d') subCon.classList.add('hm-area-is-table');

    const subTitle = document.createElement('div');
    subTitle.className = 'hm-sub-title';

    const titleLeft = document.createElement('div');
    titleLeft.className = 'hm-sub-title-left';
    
    const selY = document.createElement('select');
    selY.className = 'sel hm-sub-sel';
    selY.title = 'Y軸（行）';
    Object.keys(HM_AXES).forEach(k => {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = HM_AXES[k].label;
      if (k === yKey) opt.selected = true;
      selY.appendChild(opt);
    });
    selY.addEventListener('change', () => { panel.yAxis = selY.value; saveDB(); renderHeatmap(); });

    const btnYDir = document.createElement('button');
    btnYDir.className = 'btn btn-ghost btn-icon-sm';
    btnYDir.title = 'Y軸の並び順を切替';
    btnYDir.innerHTML = panel.yAxisDir === 'desc' ? '<i class="fa-solid fa-arrow-down-wide-short"></i>' : '<i class="fa-solid fa-arrow-up-wide-short"></i>';
    btnYDir.style.cssText = 'padding: 4px; margin-left: 2px;';
    btnYDir.addEventListener('click', () => {
      panel.yAxisDir = panel.yAxisDir === 'desc' ? 'asc' : 'desc';
      saveDB(); renderHeatmap();
    });
    
    const btnSwap = document.createElement('button');
    btnSwap.className = 'btn btn-ghost btn-icon-sm';
    btnSwap.title = 'X軸とY軸を入れ替え';
    btnSwap.innerHTML = '<i class="fa-solid fa-retweet"></i>';
    btnSwap.style.cssText = 'margin:0 4px; color: var(--c-primary);';
    btnSwap.addEventListener('click', () => {
      const tKey = panel.xAxis;
      const tDir = panel.xAxisDir;
      panel.xAxis = panel.yAxis;
      panel.xAxisDir = panel.yAxisDir;
      panel.yAxis = tKey;
      panel.yAxisDir = tDir;
      saveDB(); renderHeatmap();
    });

    const selX = document.createElement('select');
    selX.className = 'sel hm-sub-sel';
    selX.title = 'X軸（列）';
    Object.keys(HM_AXES).forEach(k => {
      const opt = document.createElement('option');
      opt.value = k; opt.textContent = HM_AXES[k].label;
      if (k === xKey) opt.selected = true;
      selX.appendChild(opt);
    });
    selX.addEventListener('change', () => { panel.xAxis = selX.value; saveDB(); renderHeatmap(); });

    const btnXDir = document.createElement('button');
    btnXDir.className = 'btn btn-ghost btn-icon-sm';
    btnXDir.title = 'X軸の並び順を切替';
    btnXDir.innerHTML = panel.xAxisDir === 'desc' ? '<i class="fa-solid fa-arrow-down-wide-short"></i>' : '<i class="fa-solid fa-arrow-up-wide-short"></i>';
    btnXDir.style.cssText = 'padding: 4px; margin-left: 2px;';
    btnXDir.addEventListener('click', () => {
      panel.xAxisDir = panel.xAxisDir === 'desc' ? 'asc' : 'desc';
      saveDB(); renderHeatmap();
    });

    titleLeft.appendChild(selY);
    titleLeft.appendChild(btnYDir);

    if (format !== 'histogram') {
      titleLeft.appendChild(btnSwap);
      titleLeft.appendChild(selX);
      titleLeft.appendChild(btnXDir);
    } else {
      selY.title = '対象データ（数値軸）';
      titleLeft.innerHTML = `<i class="fa-solid fa-chart-column" style="color:var(--c-primary)"></i>`;
      titleLeft.appendChild(selY);
      titleLeft.appendChild(btnYDir);
      const lblInfo = document.createElement('span');
      lblInfo.style.cssText = 'font-size:11px; color:var(--c-text-3); margin-left:8px;';
      lblInfo.textContent = '※ヒストグラムは単一の数値データの度数分布を表示します。';
      titleLeft.appendChild(lblInfo);
    }

    const titleRight = document.createElement('div');
    titleRight.className = 'hm-sub-title-right';
    titleRight.style.cssText = 'display:flex; align-items:center; gap:6px; flex-shrink:0;';
    const selDisp = document.createElement('select');
    selDisp.className = 'sel hm-sub-sel';
    const dispOpts = [{v:'count', l:'人数'}, {v:'rowpct', l:'行内%'}, {v:'colpct', l:'列内%'}, {v:'totpct', l:'全体%'}];
    dispOpts.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.v; opt.textContent = o.l;
      if (o.v === disp) opt.selected = true;
      selDisp.appendChild(opt);
    });
    selDisp.addEventListener('change', () => { panel.dispMode = selDisp.value; saveDB(); renderHeatmap(); });

    const selFmt = document.createElement('select');
    selFmt.className = 'sel hm-sub-sel';
    _buildFmtOptions(selFmt, format);
    selFmt.addEventListener('change', () => { panel.format = selFmt.value; saveDB(); renderHeatmap(); });

    const btnOrient = document.createElement('button');
    btnOrient.className = 'btn btn-ghost btn-icon-sm hm-btn-orient';
    btnOrient.title = isHorizontal ? '縦向きにする' : '横向きにする';
    btnOrient.innerHTML = isHorizontal ? '<i class="fa-solid fa-bars-staggered"></i>' : '<i class="fa-solid fa-chart-column"></i>';
    // 横向きをサポートするグラフ形式か判定
    const canHorizontal = ['bar', 'stacked_bar', 'histogram', 'line', 'area', 'boxplot', 'violin', 'boxviolin', 'swarm', 'swarmviolin'].includes(format);
    if (!canHorizontal) {
      btnOrient.disabled = true;
      btnOrient.style.opacity = '0.3';
      btnOrient.title = 'この形式では向きを変更できません';
    }
    btnOrient.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.horizontal = !panel.horizontal;
      saveDB();
      renderHeatmap();
    });

    const btnOpt = document.createElement('button');
    btnOpt.className = 'btn btn-ghost btn-icon-sm hm-btn-opt';
    btnOpt.title = '詳細設定';
    btnOpt.innerHTML = '<i class="fa-solid fa-sliders"></i>';
    btnOpt.addEventListener('click', (e) => { e.stopPropagation(); openHmPopover(btnOpt, pid); });

    const btnDel = document.createElement('button');
    btnDel.className = 'btn btn-ghost btn-icon-sm hm-btn-remove';
    btnDel.title = 'このグラフを削除';
    btnDel.style.color = 'var(--c-danger)';
    btnDel.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    btnDel.addEventListener('click', () => {
      if (panels.length <= 1) { toast('最後の1つは削除できません'); return; }
      DB.settings.hm.panels = panels.filter(p => p.id !== pid);
      saveDB(); renderHeatmap();
    });

    titleRight.appendChild(selDisp);
    titleRight.appendChild(selFmt);
    titleRight.appendChild(btnOrient);
    titleRight.appendChild(btnOpt);
    titleRight.appendChild(btnDel);

    subTitle.appendChild(titleLeft);
    subTitle.appendChild(titleRight);
    subCon.appendChild(subTitle);
    con.appendChild(subCon);

    if (xKey === yKey) {
      const msg = document.createElement('div');
      msg.className = 'dist-empty';
      msg.style.minHeight = '100px';
      msg.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--c-warn)"></i><p>X軸とY軸に同じ項目「${xDef.label}」は選択できません</p>`;
      subCon.appendChild(msg);
      return;
    }

    const distXDir = panel.xAxisDir || 'asc';
    const globalXKeys = hmGetKeys(xKey, emps, distXDir);

    if (format === 'histogram') {
      requestAnimationFrame(() => renderHeatmapHistogramChart(emps, yDef, subCon, index, panel));
      return;
    }

    if (['boxplot', 'violin', 'boxviolin', 'swarm', 'swarmviolin'].includes(format)) {
      requestAnimationFrame(() => renderHeatmapDistributionChart(globalXKeys, emps, xDef, yDef, subCon, index, format, isHorizontal, panel));
      return;
    }

    const yDir = panel.yAxisDir || 'asc';
    const xDir = panel.xAxisDir || 'asc';
    const xKeys = hmGetKeys(xKey, emps, xDir);
    const yKeys = hmGetKeys(yKey, emps, yDir);
    const matrix = {};
    yKeys.forEach(y => { matrix[y] = {}; xKeys.forEach(x => { matrix[y][x] = []; }); });
    const others = [];
    emps.forEach(e => {
      const x = xDef.fn(e), y = yDef.fn(e);
      if (x === null || y === null) { others.push(e); return; }
      if (!matrix[y]) matrix[y] = {};
      if (!matrix[y][x]) matrix[y][x] = [];
      matrix[y][x].push(e);
    });

    const total = emps.length - others.length;
    const rowTotals = {}, colTotals = {};
    yKeys.forEach(y => { rowTotals[y] = xKeys.reduce((s, x) => s + (matrix[y][x]?.length || 0), 0); });
    xKeys.forEach(x => { colTotals[x] = yKeys.reduce((s, y) => s + (matrix[y][x]?.length || 0), 0); });
    const maxCount = Math.max(...yKeys.flatMap(y => xKeys.map(x => matrix[y][x]?.length || 0)));

    const statSpan = document.createElement('span');
    statSpan.className = 'stat';
    statSpan.textContent = `${yKeys.length}行 × ${xKeys.length}列`;
    titleLeft.insertBefore(statSpan, titleLeft.firstChild);

    if (format === '3d' || format === '3d_surface' || format === '3d_wireframe') {
      requestAnimationFrame(() => renderHeatmap3D(xKeys, yKeys, matrix, maxCount, xDef, yDef, subCon, index, format));
      return;
    }
    
    if (['bar', 'stacked_bar', 'line', 'area', 'radar', 'pie', 'doughnut', 'polarArea', 'scatter', 'bubble'].includes(format)) {
      requestAnimationFrame(() => renderHeatmapBasicChart(xKeys, yKeys, matrix, xDef, yDef, subCon, index, format, isHorizontal, panel));
      return;
    }

    // テーブル描画
    const wrap = document.createElement('div'); wrap.className = 'hm-table-wrap';
    const tbl  = document.createElement('table'); tbl.className = 'hm-table';

    const thead = document.createElement('thead');
    const trh   = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'hm-corner-hdr';
    corner.innerHTML = `<span style="display:block;text-align:right;font-size:10px;color:var(--c-text-3)">${yDef.label} ↓</span><span style="display:block;font-size:10px;color:var(--c-text-3)">→ ${xDef.label}</span>`;
    trh.appendChild(corner);
    xKeys.forEach(xv => {
      const th = document.createElement('th'); th.className = 'hm-col-hdr'; th.textContent = xv; trh.appendChild(th);
    });
    const thTotal = document.createElement('th'); thTotal.className = 'hm-col-hdr'; thTotal.textContent = '計'; trh.appendChild(thTotal);
    thead.appendChild(trh); tbl.appendChild(thead);

    const tbody = document.createElement('tbody');
    yKeys.forEach(yv => {
      const tr = document.createElement('tr');
      const tdRH = document.createElement('td'); tdRH.className = 'hm-row-hdr'; tdRH.textContent = yv; tr.appendChild(tdRH);
      xKeys.forEach(xv => {
        const cellEmps = matrix[yv][xv] ||[];
        const cnt      = cellEmps.length;
        let   dispVal  = '';
        if      (disp === 'count')  dispVal = cnt;
        else if (disp === 'rowpct') dispVal = rowTotals[yv] ? (cnt / rowTotals[yv] * 100).toFixed(1) + '%' : '—';
        else if (disp === 'colpct') dispVal = colTotals[xv] ? (cnt / colTotals[xv] * 100).toFixed(1) + '%' : '—';
        else if (disp === 'totpct') dispVal = total ? (cnt / total * 100).toFixed(1) + '%' : '—';
        const ratio = maxCount > 0 ? cnt / maxCount : 0;
        const bg    = hmColor(ratio);
        const fg    = hmTextColor(ratio);

        const td = document.createElement('td'); td.className = 'hm-cell';
        td.style.background = bg;
        td.innerHTML = `<div class="hm-cell-inner"><span class="hm-cell-cnt" style="color:${fg}">${disp==='count' ? (cnt||'') : dispVal}</span>${cnt>0&&disp!=='count' ? `<span class="hm-cell-pct" style="color:${fg}">${cnt}名</span>` : ''}</div>`;

        td.addEventListener('mouseenter', ev => {
          if (!cellEmps.length) return;
          hmTip.show(cellEmps, { xLabel: xv, yLabel: yv, xAxisLabel: xDef.label, yAxisLabel: yDef.label }, ev.clientX, ev.clientY);
        });
        td.addEventListener('mousemove', ev => {
          if (!cellEmps.length) return;
          hmTip.show(cellEmps, { xLabel: xv, yLabel: yv, xAxisLabel: xDef.label, yAxisLabel: yDef.label }, ev.clientX, ev.clientY);
        });
        td.addEventListener('mouseleave', () => hmTip.hide());
        tr.appendChild(td);
      });
      const tdRT = document.createElement('td'); tdRT.className = 'hm-total-cell'; tdRT.textContent = rowTotals[yv]; tr.appendChild(tdRT);
      tbody.appendChild(tr);
    });

    const trFoot = document.createElement('tr');
    const tdFL   = document.createElement('td'); tdFL.className = 'hm-row-hdr'; tdFL.style.fontWeight = '800'; tdFL.textContent = '計'; trFoot.appendChild(tdFL);
    xKeys.forEach(xv => { const td = document.createElement('td'); td.className = 'hm-total-cell'; td.textContent = colTotals[xv]; trFoot.appendChild(td); });
    const tdGrand = document.createElement('td'); tdGrand.className = 'hm-total-cell grand'; tdGrand.textContent = total; trFoot.appendChild(tdGrand);
    tbody.appendChild(trFoot);

    tbl.appendChild(tbody);
    wrap.appendChild(tbl);

    const legend = document.createElement('div'); legend.className = 'hm-legend-wrap';
    legend.innerHTML = `<span>0名</span><div class="hm-legend-bar"></div><span>${maxCount}名（最大）</span><span style="margin-left:8px;color:var(--c-text-3)">${others.length ? `※ 集計外 ${others.length}名（軸項目未設定）` : ''}</span>`;

    subCon.appendChild(legend);
    subCon.appendChild(wrap);

    setTimeout(() => {
      const scrollEl = document.getElementById('hm-scroll');
      if (!scrollEl || !wrap || !tbl) return;
      const isOverflowing = (wrap.scrollWidth > scrollEl.clientWidth) || (wrap.scrollHeight > 400);
      if (isOverflowing && !tbl.classList.contains('is-compact')) {
        tbl.classList.add('is-compact');
      }
    }, 0);

  }); // panels.forEach
}

function renderHeatmap3D(xKeys, yKeys, matrix, maxCount, xDef, yDef, subCon, index, format = '3d') {
  const con = document.getElementById('hm-container');
  if (typeof THREE === 'undefined') {
    subCon.innerHTML += '<div class="dist-empty"><i class="fa-solid fa-triangle-exclamation" style="color:var(--c-warn)"></i><p>3Dライブラリを読み込めませんでした。</p></div>';
    return;
  }

  const containerId = `hm-3d-container-${index}`;
  const wrap = document.createElement('div');
  wrap.id = containerId;
  wrap.className = 'active hm-3d-wrap';
  wrap.style.cssText = 'position: relative; width: 100%; flex: 1; min-height: 0; border-radius: var(--r-lg); overflow: hidden; border: 1px solid var(--c-border); background: #F1F5F9; cursor: grab;';
  subCon.appendChild(wrap);

  const container = document.getElementById(containerId);
  const width  = container.offsetWidth > 0 ? container.offsetWidth : (subCon.clientWidth || 800);
  const height = container.offsetHeight > 0 ? container.offsetHeight : (subCon.clientHeight > 50 ? subCon.clientHeight : 480);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#F1F5F9');

  const camera = new THREE.PerspectiveCamera(45, width / height, 1, 1000);
  camera.position.set(xKeys.length * 1.5, Math.max(xKeys.length, yKeys.length) * 1.5, yKeys.length * 2);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setClearColor(0xF1F5F9, 1);
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.background = '#F1F5F9';
  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(xKeys.length / 2, 0, yKeys.length / 2);
  controls.update();

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  function createTextSprite(message) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 24px "DM Sans", "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(4, 1, 1);
    return sprite;
  }

  const barSize = 0.8;
  const gap = 1.0;

  const isSurface = format === '3d_surface' || format === '3d_wireframe';
  const isWireframe = format === '3d_wireframe';

  yKeys.forEach((yv, zIndex) => {
    const yLabel = createTextSprite(yv);
    yLabel.position.set(-1.5, 0, zIndex * gap);
    scene.add(yLabel);
    if (zIndex === 0) {
      xKeys.forEach((xv, xIndex) => {
        const xLabel = createTextSprite(xv);
        xLabel.position.set(xIndex * gap, 0, -1.5);
        scene.add(xLabel);
      });
    }
  });

  if (isSurface) {
    const segX = Math.max(1, xKeys.length - 1);
    const segZ = Math.max(1, yKeys.length - 1);
    const widthGeom = segX * gap;
    const depthGeom = segZ * gap;

    const geometry = new THREE.PlaneGeometry(widthGeom, depthGeom, segX, segZ);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    const colors = new Float32Array(positions.length);

    for (let i = 0; i <= segZ; i++) {
      for (let j = 0; j <= segX; j++) {
        const xIdx = xKeys.length > 1 ? j : 0;
        const yIdx = yKeys.length > 1 ? i : 0;
        const xv = xKeys[xIdx];
        const yv = yKeys[yIdx];

        const cellEmps = matrix[yv]?.[xv] || [];
        const cnt = cellEmps.length;
        const ratio = maxCount > 0 ? cnt / maxCount : 0;
        const h = ratio * 5;

        const vIdx = (i * (segX + 1) + j) * 3;
        
        positions[vIdx + 0] = xIdx * gap;
        positions[vIdx + 1] = h;
        positions[vIdx + 2] = yIdx * gap;

        const rgb = hmColorRGBObj(ratio);
        colors[vIdx + 0] = rgb.r / 255;
        colors[vIdx + 1] = rgb.g / 255;
        colors[vIdx + 2] = rgb.b / 255;
      }
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      wireframe: isWireframe,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: isWireframe ? 0.6 : 0.9,
    });

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    yKeys.forEach((yv, zIndex) => {
      xKeys.forEach((xv, xIndex) => {
        const cellEmps = matrix[yv][xv] || [];
        const cnt = cellEmps.length;
        if (cnt === 0) return;
        const ratio = maxCount > 0 ? cnt / maxCount : 0;
        const h = ratio * 5;
        const hitGeo = new THREE.BoxGeometry(gap, Math.max(0.1, h), gap);
        const hitMat = new THREE.MeshBasicMaterial({ visible: false });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.position.set(xIndex * gap, h / 2, zIndex * gap);
        hitMesh.userData = { xv, yv, cnt, cellEmps };
        scene.add(hitMesh);
      });
    });

  } else {
    yKeys.forEach((yv, zIndex) => {
      xKeys.forEach((xv, xIndex) => {
        const cellEmps = matrix[yv][xv] ||[];
        const cnt = cellEmps.length;
        if (cnt === 0) return;

        const ratio = maxCount > 0 ? cnt / maxCount : 0;
        const barHeight = Math.max(0.05, ratio * 5);
        
        const colorStr = hmColor(ratio);
        const geometry = new THREE.BoxGeometry(barSize, barHeight, barSize);
        const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(colorStr) });
        const cube = new THREE.Mesh(geometry, material);

        cube.position.set(xIndex * gap, barHeight / 2, zIndex * gap);
        cube.userData = { xv, yv, cnt, cellEmps };

        scene.add(cube);
      });
    });
  }

  let reqId;
  function animate() {
    reqId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  if (!con.userData) con.userData = { reqIds: [], renderers: [] };
  con.userData.reqIds.push(reqId);
  con.userData.renderers.push(renderer);

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  function onMouseMove(event) {
    const dRect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - dRect.left) / dRect.width) * 2 - 1;
    mouse.y = -((event.clientY - dRect.top) / dRect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(scene.children);
    const boxIntersects = intersects.filter(i => i.object.geometry && i.object.geometry.type === 'BoxGeometry');

    if (boxIntersects.length > 0) {
      const obj = boxIntersects[0].object;
      const { xv, yv, cnt, cellEmps } = obj.userData;
      if (cnt > 0) {
        hmTip.show(cellEmps, { xLabel: xv, yLabel: yv, xAxisLabel: xDef.label, yAxisLabel: yDef.label }, event.clientX, event.clientY);
      }
    } else {
      hmTip.hide();
    }
  }
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('mouseleave', () => hmTip.hide());
  
  let resizeTimeout;
  const resizeObserver = new ResizeObserver(() => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const w = container.offsetWidth;
      const h = container.offsetHeight > 0 ? container.offsetHeight : 480;
      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    }, 50);
  });
  resizeObserver.observe(container);
  
  const observerCleanUp = new MutationObserver((mutationsList, obs) => {
    for (const mutation of mutationsList) {
      for (const removedNode of mutation.removedNodes) {
        if (removedNode === container || removedNode.contains(container)) {
          resizeObserver.disconnect();
          obs.disconnect();
        }
      }
    }
  });
  observerCleanUp.observe(subCon, { childList: true, subtree: true });
}

function renderHeatmapBasicChart(xKeys, yKeys, matrix, xDef, yDef, subCon, index, format, isHorizontal, panel) {
  if (isHorizontal) {
    const xDir = panel.xAxisDir || 'asc';
    const yDir = panel.yAxisDir || 'asc';
    if (xDir !== yDir) {
      xKeys = [...xKeys].reverse();
      yKeys = [...yKeys].reverse();
    }
  }
  const canvasId = `hm-basic-canvas-${index}`;
  const wrap = document.createElement('div');
  wrap.className = 'hm-chart-wrap';
  wrap.style.cssText = 'position:relative; width:100%; flex: 1; min-height: 100px;';
  wrap.innerHTML = `<canvas id="${canvasId}"></canvas>`;
  subCon.appendChild(wrap);

  const canvas = document.getElementById(canvasId);
  const bgColors =['#3B82F6','#EF4444','#10B981','#F59E0B','#8B5CF6','#06B6D4','#EC4899','#84CC16','#6366F1','#F97316','#14B8A6','#64748B','#F43F5E','#A855F7','#22C55E'];
  const isSequentialY = yDef.sortNum || yDef.bandOf;

  let chartType = format;
  if (format === 'stacked_bar') chartType = 'bar';
  if (format === 'area') chartType = 'line';


  const isPieFamily = ['pie', 'doughnut', 'polarArea'].includes(format);
  const isScatterFamily = ['scatter', 'bubble'].includes(format);

  let datasets = [];
  let chartOptions = {
    responsive: true, maintainAspectRatio: false, layout: { padding: 10 },
    indexAxis: isHorizontal ? 'y' : 'x',
    plugins: { legend: { position: (format === 'radar' || isPieFamily) ? 'bottom' : 'right', labels: { font: { family: "'DM Sans','Noto Sans JP',sans-serif", size: 11 } } }, tooltip: { callbacks: {} } },
    scales: {}
  };

  if (isScatterFamily) {
    const bubbleData = [];
    yKeys.forEach((yv, yi) => {
      let dsData = [];
      xKeys.forEach((xv, xi) => {
        const cellEmps = matrix[yv][xv] || [];
        const cnt = cellEmps.length;
        if (cnt > 0) {
          dsData.push({ x: isHorizontal ? yv : xv, y: isHorizontal ? xv : yv, r: format === 'bubble' ? Math.max(3, cnt * 1.5) : 4, _cnt: cnt, _xv: xv, _yv: yv });
        }
      });
      if (dsData.length > 0) {
        let color = bgColors[yi % bgColors.length];
        if (isSequentialY && yKeys.length > 1) { color = `hsl(${Math.round(240 - (240 * yi / (yKeys.length - 1)))}, 80%, 55%)`; }
        datasets.push({ label: yv, data: dsData, backgroundColor: color.replace('hsl', 'hsla').replace(')', ', 0.6)'), borderColor: color, borderWidth: 1 });
      }
    });

    const scaleCatX = { type: 'category', labels: xKeys, title: { display: true, text: xDef.label, font: { size: 12, weight: 'bold' }, color: '#475569', padding: { top: 3, bottom: 2 } }, grid: { display: true, color: '#f1f5f9' }, ticks: { autoSkip: false, font: { size: 11 } } };
    const scaleCatY = { type: 'category', labels: yKeys, title: { display: true, text: yDef.label, font: { size: 12, weight: 'bold' }, color: '#475569', padding: { top: 2, bottom: 3 } }, grid: { display: true, color: '#f1f5f9' }, ticks: { autoSkip: false } };
    const rotScat = _hmTickRotation(xKeys);
    scaleCatX.ticks.maxRotation = rotScat.maxRotation; scaleCatX.ticks.minRotation = rotScat.minRotation;
    chartOptions.scales = { x: isHorizontal ? scaleCatY : scaleCatX, y: isHorizontal ? scaleCatX : scaleCatY };
    chartOptions.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.raw._yv} × ${ctx.raw._xv}: ${ctx.raw._cnt}名`;
  } else if (isPieFamily) {
    datasets = yKeys.map((yv, i) => ({
      label: yv, data: xKeys.map(xv => (matrix[yv][xv] ||[]).length),
      backgroundColor: bgColors.map(c => c.replace('hsl', 'hsla').replace(')', ', 0.7)')),
      borderColor: '#ffffff', borderWidth: 1
    }));
    chartOptions.scales = {};
    chartOptions.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label} - ${ctx.label}: ${ctx.raw}名`;
  } else {
    // データセットの色をY軸の本来の昇順に基づいて固定化し、ソート時の色の逆転（錯覚）を防ぐ
    const yKeyName = panel.yAxis;
    const emps = DB.employees;
    const yKeysAsc = hmGetKeys(yKeyName, emps, 'asc');

    datasets = yKeys.map((yv, i) => {
      const data = xKeys.map(xv => (matrix[yv][xv] ||[]).length);
      
      const origIndex = yKeysAsc.indexOf(yv);
      const colorIndex = origIndex >= 0 ? origIndex : i;
      
      let color = bgColors[colorIndex % bgColors.length];
      if (isSequentialY && yKeysAsc.length > 1) { color = `hsl(${Math.round(240 - (240 * colorIndex / (yKeysAsc.length - 1)))}, 80%, 55%)`; } 
      else if (isSequentialY && yKeysAsc.length === 1) { color = `hsl(240, 80%, 55%)`; }
      
      const isArea = format === 'area';
      const isLineLike = chartType === 'line' || format === 'radar';
      const ds = { label: yv, data: data, backgroundColor: isLineLike ? color.replace('hsl', 'hsla').replace(')', ', 0.2)') : color, borderColor: isLineLike ? color : '#ffffff', borderWidth: isLineLike ? 2 : 1, pointBackgroundColor: color };
      
      if (chartType === 'line') { ds.tension = 0.3; ds.fill = isArea; }
      if (format === 'radar') { ds.fill = true; ds.backgroundColor = color.replace('hsl', 'hsla').replace(')', ', 0.2)'); }
      return ds;
    });

    const isStacked = format === 'stacked_bar';
    if (format === 'radar') {
      chartOptions.scales = { r: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 } } };
    } else {
      const categoryScale = { stacked: isStacked, title: { display: true, text: xDef.label, font: { size: 12, weight: 'bold' }, color: '#475569', padding: { top: 3, bottom: 2 } }, grid: { display: false }, ticks: { font: { size: 11 } } };
      const ar = panel.axisRange || {};
      const arMode = ar.mode || 'auto';
      const valueScale = { stacked: isStacked, title: { display: true, text: '人数 (名)', font: { size: 12, weight: 'bold' }, color: '#475569', padding: { top: 2, bottom: 2 } }, ticks: { precision: 0, padding: 2 }, grid: { color: 'rgba(0,0,0,0.05)' } };
      if (arMode === 'zero') { valueScale.min = 0; valueScale.beginAtZero = true; } 
      else if (arMode === 'manual') { if (ar.min !== null && ar.min !== undefined && ar.min !== '') valueScale.min = +ar.min; if (ar.max !== null && ar.max !== undefined && ar.max !== '') valueScale.max = +ar.max; } 
      else { valueScale.min = 0; }
      const _rawCounts = yKeys.flatMap(y => xKeys.map(x => matrix[y]?.[x]?.length || 0));

      if (isHorizontal) { chartOptions.scales = { x: valueScale, y: categoryScale }; } 
      else { chartOptions.scales = { x: categoryScale, y: valueScale }; }
    }
    chartOptions.plugins.tooltip.callbacks.label = (ctx) => ` ${ctx.dataset.label}: ${ctx.raw}名`;
  }

  if (!isScatterFamily && !isPieFamily && format !== 'radar') {
    const catAxis = isHorizontal ? 'y' : 'x';
    const catKeys = isHorizontal ? yKeys : xKeys;
    const rot = _hmTickRotation(catKeys);
    if (chartOptions.scales[catAxis] && chartOptions.scales[catAxis].ticks) {
      chartOptions.scales[catAxis].ticks.maxRotation = rot.maxRotation;
      chartOptions.scales[catAxis].ticks.minRotation = rot.minRotation;
      chartOptions.scales[catAxis].ticks.autoSkip = false;
    }
  }

  const chartInst = new Chart(canvas, { type: chartType, data: { labels: xKeys, datasets: datasets }, options: chartOptions });
  _hmChartInstances.push(chartInst);
}

function renderHeatmapDistributionChart(globalXKeys, emps, xDef, yDef, subCon, index, format, isHorizontal, panel) {
  const chartType = format;
  const labelText = format === 'violin' ? 'バイオリン図' : format === 'boxviolin' ? '箱ひげ＋バイオリン図' : format === 'swarm' ? 'スウォームプロット' : format === 'swarmviolin' ? 'バイオリン＋スウォームプロット' : '箱ひげ図';

  if (!yDef.numFn) {
    const msg = document.createElement('div'); msg.className = 'dist-empty'; msg.style.minHeight = '200px';
    msg.innerHTML = `<i class="fa-solid fa-circle-info" style="color:var(--c-text-3)"></i><p>「${yDef.label}」は数値データではないため、${labelText}を描画できません。</p>`;
    subCon.appendChild(msg); return;
  }
  
  const canvasId = `hm-dist-chart-${index}`;
  const chartWrap = document.createElement('div'); chartWrap.className = 'hm-chart-wrap';
  chartWrap.style.cssText = 'position:relative; width:100%; flex: 1; min-height: 150px; padding:10px; background:#fff; border-radius:8px; border:1px solid var(--c-border); overflow:hidden;';
  chartWrap.innerHTML = `<canvas id="${canvasId}"></canvas>`;
  subCon.appendChild(chartWrap);

  const datasetsData = globalXKeys.map(xk => {
    const groupEmps = emps.filter(e => xDef.fn(e) === xk);
    const values = groupEmps.map(e => yDef.numFn(e)).filter(v => v !== null && v !== undefined && !isNaN(v)).map(v => Number(v)).sort((a, b) => a - b);
    return { xk, values, emps: groupEmps };
  });

  function drawChart() {
    const canvas = document.getElementById(canvasId); if (!canvas) return;
    let width = chartWrap.clientWidth - 20, height = chartWrap.clientHeight - 20;
    if (width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d'), dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr; canvas.height = height * dpr; ctx.scale(dpr, dpr);
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';

    function quantile(arr, q) { if (arr.length === 0) return 0; if (arr.length === 1) return arr[0]; const pos = (arr.length - 1) * q; const base = Math.floor(pos); const rest = pos - base; if (arr[base + 1] !== undefined) { return arr[base] + rest * (arr[base + 1] - arr[base]); } else { return arr[base]; } }
    const stats = datasetsData.map(d => {
      const v = d.values; if (v.length === 0) return null;
      const q1 = quantile(v, 0.25), median = quantile(v, 0.5), q3 = quantile(v, 0.75), iqr = q3 - q1;
      const minBoundary = q1 - 1.5 * iqr, maxBoundary = q3 + 1.5 * iqr;
      const outliers = [], inside = [];
      v.forEach(val => { if (val < minBoundary || val > maxBoundary) outliers.push(val); else inside.push(val); });
      const min = inside.length ? Math.min(...inside) : q1, max = inside.length ? Math.max(...inside) : q3;
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      return { xk: d.xk, min, q1, median, q3, max, outliers, mean, count: v.length, values: v, emps: d.emps };
    });

    const validStats = stats.filter(s => s !== null);
    if (validStats.length === 0) { ctx.fillStyle = '#94a3b8'; ctx.font = '14px "DM Sans", "Noto Sans JP", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('データがありません', width / 2, height / 2); return; }

    let globalMin = Math.min(...validStats.map(s => Math.min(s.min, ...(s.outliers.length ? s.outliers : [s.min]))));
    let globalMax = Math.max(...validStats.map(s => Math.max(s.max, ...(s.outliers.length ? s.outliers : [s.max]))));
    if (globalMin === globalMax) { globalMin -= 1; globalMax += 1; }

    const ar = panel.axisRange || {};
    const arMode = ar.mode || 'auto';
    if (arMode === 'manual') { if (ar.min !== null && ar.min !== undefined && ar.min !== '') globalMin = +ar.min; if (ar.max !== null && ar.max !== undefined && ar.max !== '') globalMax = +ar.max; } 
    else if (arMode === 'zero') { globalMin = 0; globalMax += (globalMax - globalMin) * 0.08 || 1; } 
    else { const padY = (globalMax - globalMin) * 0.1 || 1; globalMin -= padY; globalMax += padY; }
    if (ar.niceScale !== false && arMode !== 'manual') { const nice = calcNiceScale(globalMin, globalMax, 5); globalMin = nice.min; globalMax = nice.max; }

    ctx.font = '12px "DM Sans", "Noto Sans JP", sans-serif';
    const estBandSize = globalXKeys.length > 0 ? (width - 80) / globalXKeys.length : (width - 80);
    const maxLabelW = globalXKeys.length > 0 ? Math.max(...globalXKeys.map(k => ctx.measureText(String(k)).width)) : 0;
    const needsLabelRotation = !isHorizontal && maxLabelW > estBandSize - 4;
    const dynamicLeft = isHorizontal ? Math.max(90, Math.min(220, Math.ceil(maxLabelW) + 28)) : 75;
    const margin = isHorizontal ? { top: 20, right: 30, bottom: 40, left: dynamicLeft } : { top: 30, right: 20, bottom: needsLabelRotation ? 100 : 60, left: dynamicLeft };
    const innerW = width - margin.left - margin.right, innerH = height - margin.top - margin.bottom;

    const yDir = (panel && panel.yAxisDir) ? panel.yAxisDir : (DB.settings.hm.yAxisDir || 'asc');
    const isYDesc = yDir === 'desc';

    function getV(val) {
      if (isHorizontal) {
        return margin.left + ((val - globalMin) / (globalMax - globalMin)) * innerW;
      } else {
        if (isYDesc) {
          return margin.top + ((val - globalMin) / (globalMax - globalMin)) * innerH;
        } else {
          return margin.top + innerH - ((val - globalMin) / (globalMax - globalMin)) * innerH;
        }
      }
    }

    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#475569'; ctx.font = '12px "DM Sans", "Noto Sans JP", sans-serif';
    const tickCount = 5;

    if (isHorizontal) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      for (let i = 0; i <= tickCount; i++) {
        const val = globalMin + (globalMax - globalMin) * (i / tickCount), xPos = getV(val);
        ctx.fillText(Math.round(val * 10) / 10, xPos, margin.top + innerH + 5);
        ctx.beginPath(); ctx.moveTo(xPos, margin.top); ctx.lineTo(xPos, margin.top + innerH); ctx.strokeStyle = '#f1f5f9'; ctx.stroke();
      }
      ctx.fillStyle = '#475569'; ctx.font = 'bold 13px "DM Sans", "Noto Sans JP", sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(xDef.label, margin.left - 10, margin.top - 10);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(yDef.label, margin.left + innerW / 2, height - 2);
    } else {
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let i = 0; i <= tickCount; i++) {
        const val = globalMin + (globalMax - globalMin) * (i / tickCount), yPos = getV(val);
        ctx.fillText(Math.round(val * 10) / 10, margin.left - 10, yPos);
        ctx.beginPath(); ctx.moveTo(margin.left - 5, yPos); ctx.lineTo(margin.left + innerW, yPos); ctx.strokeStyle = '#f1f5f9'; ctx.stroke();
      }
      ctx.fillStyle = '#475569'; ctx.font = 'bold 13px "DM Sans", "Noto Sans JP", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(xDef.label, margin.left + innerW / 2, height - 5);
      ctx.save(); ctx.translate(18, margin.top + innerH / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(yDef.label, 0, 0); ctx.restore();
    }

    const bandSize = isHorizontal ? (innerH / globalXKeys.length) : (innerW / globalXKeys.length);
    const boxW = Math.min(bandSize * 0.6, 40);
    function epanechnikov(u) { return Math.abs(u) <= 1 ? 0.75 * (1 - u * u) : 0; }
    function kde(kernel, bandwidth, pts) { return function(x) { let sum = 0; for (let i=0; i<pts.length; i++) sum += kernel((x - pts[i]) / bandwidth); return sum / (bandwidth * pts.length); }; }

    stats.forEach((s, i) => {
      const cCenter = isHorizontal ? (margin.top + i * bandSize + bandSize / 2) : (margin.left + i * bandSize + bandSize / 2);
      ctx.save(); ctx.fillStyle = '#475569'; ctx.font = '12px "DM Sans", "Noto Sans JP", sans-serif';
      let lbl = String(globalXKeys[i]);
      if (isHorizontal) {
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; const maxAllowed = margin.left - 12;
        if (ctx.measureText(lbl).width > maxAllowed) { while (lbl.length > 0 && ctx.measureText(lbl + '…').width > maxAllowed) lbl = lbl.slice(0, -1); lbl += '…'; }
        ctx.fillText(lbl, margin.left - 10, cCenter);
      } else if (needsLabelRotation) {
        ctx.translate(cCenter, height - margin.bottom + 10); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const maxAvail = margin.bottom - 20;
        if (ctx.measureText(lbl).width > maxAvail) { while (lbl.length > 0 && ctx.measureText(lbl + '..').width > maxAvail) lbl = lbl.slice(0, -1); lbl += '..'; }
        ctx.fillText(lbl, 0, 0);
      } else { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(lbl, cCenter, height - margin.bottom + 10); }
      ctx.restore();
      if (!s) return;

      if (format === 'violin') {
        const mainColor = '#EC4899', bgColor = 'rgba(236,72,153,0.4)';
        const bandwidth = 1.06 * (Math.sqrt(s.values.reduce((acc, v) => acc + Math.pow(v - s.mean, 2), 0) / s.count) || 1) * Math.pow(s.count, -0.2);
        const est = kde(epanechnikov, Math.max(0.5, bandwidth), s.values);
        const steps = 50, vMin = s.min - bandwidth * 2, vMax = s.max + bandwidth * 2, stepSize = (vMax - vMin) / steps;
        const curve = []; let maxDensity = 0;
        for (let j = 0; j <= steps; j++) { const val = vMin + j * stepSize; const density = est(val); if (density > maxDensity) maxDensity = density; curve.push({ v: getV(val), d: density }); }
        ctx.beginPath();
        curve.forEach((pt, idx) => { const spread = (pt.d / maxDensity) * (boxW / 2); if (idx === 0) { if (isHorizontal) ctx.moveTo(pt.v, cCenter + spread); else ctx.moveTo(cCenter + spread, pt.v); } else { if (isHorizontal) ctx.lineTo(pt.v, cCenter + spread); else ctx.lineTo(cCenter + spread, pt.v); } });
        for (let j = curve.length - 1; j >= 0; j--) { const pt = curve[j]; const spread = (pt.d / maxDensity) * (boxW / 2); if (isHorizontal) ctx.lineTo(pt.v, cCenter - spread); else ctx.lineTo(cCenter - spread, pt.v); }
        ctx.closePath(); ctx.fillStyle = bgColor; ctx.fill(); ctx.strokeStyle = mainColor; ctx.lineWidth = 1.5; ctx.stroke();
        const vQ1 = getV(s.q1), vQ3 = getV(s.q3), vMed = getV(s.median);
        ctx.beginPath(); if (isHorizontal) { ctx.moveTo(vQ1, cCenter); ctx.lineTo(vQ3, cCenter); } else { ctx.moveTo(cCenter, vQ1); ctx.lineTo(cCenter, vQ3); }
        ctx.lineWidth = 4; ctx.strokeStyle = '#334155'; ctx.stroke();
        ctx.beginPath(); if (isHorizontal) ctx.arc(vMed, cCenter, 3, 0, Math.PI*2); else ctx.arc(cCenter, vMed, 3, 0, Math.PI*2); ctx.fillStyle = '#fff'; ctx.fill();
      } else if (format === 'boxplot') {
        const mainColor = '#2563EB', bgColor = 'rgba(37,99,235,0.4)', vMin = getV(s.min), vMax = getV(s.max), vQ1 = getV(s.q1), vQ3 = getV(s.q3), vMed = getV(s.median);
        if (isHorizontal) {
          ctx.beginPath(); ctx.moveTo(vMin, cCenter); ctx.lineTo(vQ1, cCenter); ctx.moveTo(vQ3, cCenter); ctx.lineTo(vMax, cCenter); ctx.strokeStyle = mainColor; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(vMin, cCenter - boxW/4); ctx.lineTo(vMin, cCenter + boxW/4); ctx.moveTo(vMax, cCenter - boxW/4); ctx.lineTo(vMax, cCenter + boxW/4); ctx.stroke();
          ctx.fillStyle = bgColor; ctx.fillRect(vQ1, cCenter - boxW/2, vQ3 - vQ1, boxW); ctx.strokeRect(vQ1, cCenter - boxW/2, vQ3 - vQ1, boxW);
          ctx.beginPath(); ctx.moveTo(vMed, cCenter - boxW/2); ctx.lineTo(vMed, cCenter + boxW/2); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(cCenter, vMax); ctx.lineTo(cCenter, vQ3); ctx.moveTo(cCenter, vQ1); ctx.lineTo(cCenter, vMin); ctx.strokeStyle = mainColor; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cCenter - boxW/4, vMax); ctx.lineTo(cCenter + boxW/4, vMax); ctx.moveTo(cCenter - boxW/4, vMin); ctx.lineTo(cCenter + boxW/4, vMin); ctx.stroke();
          ctx.fillStyle = bgColor; ctx.fillRect(cCenter - boxW/2, vQ3, boxW, vQ1 - vQ3); ctx.strokeRect(cCenter - boxW/2, vQ3, boxW, vQ1 - vQ3);
          ctx.beginPath(); ctx.moveTo(cCenter - boxW/2, vMed); ctx.lineTo(cCenter + boxW/2, vMed); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
      } else if (format === 'boxviolin') {
        const vColor = 'rgba(14,165,233,0.28)', vStroke = '#0EA5E9', bw = 1.06 * (Math.sqrt(s.values.reduce((acc, v) => acc + Math.pow(v - s.mean, 2), 0) / s.count) || 1) * Math.pow(s.count, -0.2);
        const estBv = kde(epanechnikov, Math.max(0.5, bw), s.values);
        const stepsN = 60, vRangeLo = s.min - bw * 2, vRangeHi = s.max + bw * 2, stepSizeBv = (vRangeHi - vRangeLo) / stepsN;
        const curveBv = []; let maxDensityBv = 0;
        for (let j = 0; j <= stepsN; j++) { const val = vRangeLo + j * stepSizeBv; const density = estBv(val); if (density > maxDensityBv) maxDensityBv = density; curveBv.push({ v: getV(val), d: density }); }
        ctx.beginPath();
        curveBv.forEach((pt, idx) => { const spread = (pt.d / maxDensityBv) * (boxW / 2); if (idx === 0) { if (isHorizontal) ctx.moveTo(pt.v, cCenter + spread); else ctx.moveTo(cCenter + spread, pt.v); } else { if (isHorizontal) ctx.lineTo(pt.v, cCenter + spread); else ctx.lineTo(cCenter + spread, pt.v); } });
        for (let j = curveBv.length - 1; j >= 0; j--) { const pt = curveBv[j]; const spread = (pt.d / maxDensityBv) * (boxW / 2); if (isHorizontal) ctx.lineTo(pt.v, cCenter - spread); else ctx.lineTo(cCenter - spread, pt.v); }
        ctx.closePath(); ctx.fillStyle = vColor; ctx.fill(); ctx.strokeStyle = vStroke; ctx.lineWidth = 1.5; ctx.stroke();
        const bxColor = '#7C3AED', bxBg = 'rgba(124,58,237,0.65)', bxW = boxW * 0.42, bvMin = getV(s.min), bvMax = getV(s.max), bvQ1 = getV(s.q1), bvQ3 = getV(s.q3), bvMed = getV(s.median);
        if (isHorizontal) {
          ctx.beginPath(); ctx.moveTo(bvMin, cCenter); ctx.lineTo(bvQ1, cCenter); ctx.moveTo(bvQ3, cCenter); ctx.lineTo(bvMax, cCenter); ctx.strokeStyle = bxColor; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(bvMin, cCenter - bxW/4); ctx.lineTo(bvMin, cCenter + bxW/4); ctx.moveTo(bvMax, cCenter - bxW/4); ctx.lineTo(bvMax, cCenter + bxW/4); ctx.strokeStyle = bxColor; ctx.stroke();
          ctx.fillStyle = bxBg; ctx.fillRect(bvQ1, cCenter - bxW/2, bvQ3 - bvQ1, bxW); ctx.strokeStyle = bxColor; ctx.strokeRect(bvQ1, cCenter - bxW/2, bvQ3 - bvQ1, bxW);
          ctx.beginPath(); ctx.moveTo(bvMed, cCenter - bxW/2); ctx.lineTo(bvMed, cCenter + bxW/2); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        } else {
          ctx.beginPath(); ctx.moveTo(cCenter, bvMax); ctx.lineTo(cCenter, bvQ3); ctx.moveTo(cCenter, bvQ1);  ctx.lineTo(cCenter, bvMin); ctx.strokeStyle = bxColor; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cCenter - bxW/4, bvMax); ctx.lineTo(cCenter + bxW/4, bvMax); ctx.moveTo(cCenter - bxW/4, bvMin); ctx.lineTo(cCenter + bxW/4, bvMin); ctx.strokeStyle = bxColor; ctx.stroke();
          ctx.fillStyle = bxBg; ctx.fillRect(cCenter - bxW/2, bvQ3, bxW, bvQ1 - bvQ3); ctx.strokeStyle = bxColor; ctx.strokeRect(cCenter - bxW/2, bvQ3, bxW, bvQ1 - bvQ3);
          ctx.beginPath(); ctx.moveTo(cCenter - bxW/2, bvMed); ctx.lineTo(cCenter + bxW/2, bvMed); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        }
      }
      if (format === 'swarm' || format === 'swarmviolin') {
        if (format === 'swarmviolin') {
          const svColor = 'rgba(236,72,153,0.25)', svStroke = '#EC4899', svBw = 1.06 * (Math.sqrt(s.values.reduce((a, v) => a + Math.pow(v - s.mean, 2), 0) / s.count) || 1) * Math.pow(s.count, -0.2);
          const svEst = kde(epanechnikov, Math.max(0.5, svBw), s.values);
          const svSteps = 50, svLo = s.min - svBw * 2, svHi = s.max + svBw * 2, svStep = (svHi - svLo) / svSteps;
          const svCurve = []; let svMaxD = 0;
          for (let j = 0; j <= svSteps; j++) { const val = svLo + j * svStep; const d = svEst(val); if (d > svMaxD) svMaxD = d; svCurve.push({ v: getV(val), d }); }
          ctx.beginPath();
          svCurve.forEach((pt, idx) => { const sp = (pt.d / svMaxD) * (boxW / 2); if (idx === 0) { if (isHorizontal) ctx.moveTo(pt.v, cCenter + sp); else ctx.moveTo(cCenter + sp, pt.v); } else { if (isHorizontal) ctx.lineTo(pt.v, cCenter + sp); else ctx.lineTo(cCenter + sp, pt.v); } });
          for (let j = svCurve.length - 1; j >= 0; j--) { const pt = svCurve[j]; const sp = (pt.d / svMaxD) * (boxW / 2); if (isHorizontal) ctx.lineTo(pt.v, cCenter - sp); else ctx.lineTo(cCenter - sp, pt.v); }
          ctx.closePath(); ctx.fillStyle = svColor; ctx.fill(); ctx.strokeStyle = svStroke; ctx.lineWidth = 1.5; ctx.stroke();
        }
        const ptR = Math.max(3, Math.min(5, Math.floor(bandSize / 8))), step = ptR * 2.4, halfSpread = boxW * 0.5, placed = [], offsets = [];
        for (const val of s.values) {
          const vpx = getV(val); let bestOff = 0; let found = false;
          outer: for (let d = 0; d <= halfSpread + step; d += step) {
            const cands = d === 0 ? [0] : [d, -d];
            for (const off of cands) {
              if (Math.abs(off) > halfSpread) continue;
              const clear = placed.every(p => { const dx = off - p.offset, dy = vpx - p.y; return (dx * dx + dy * dy) >= step * step; });
              if (clear) { bestOff = off; found = true; break outer; }
            }
          }
          placed.push({ y: vpx, offset: bestOff }); offsets.push(bestOff);
        }
        s.values.forEach((val, idx) => {
          const vpx = getV(val), off = offsets[idx];
          ctx.beginPath(); if (isHorizontal) ctx.arc(vpx, cCenter + off, ptR, 0, Math.PI * 2); else ctx.arc(cCenter + off, vpx, ptR, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(59,130,246,0.72)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.5; ctx.stroke();
        });
        const vMedSw = getV(s.median);
        ctx.beginPath();
        if (isHorizontal) { ctx.moveTo(vMedSw, cCenter - boxW * 0.35); ctx.lineTo(vMedSw, cCenter + boxW * 0.35); }
        else { ctx.moveTo(cCenter - boxW * 0.35, vMedSw); ctx.lineTo(cCenter + boxW * 0.35, vMedSw); }
        ctx.strokeStyle = '#1D4ED8'; ctx.lineWidth = 2.5; ctx.stroke();
      }

      if (format !== 'swarm' && format !== 'swarmviolin') {
        s.outliers.forEach(outVal => {
          ctx.beginPath(); if (isHorizontal) ctx.arc(getV(outVal), cCenter, 3, 0, Math.PI * 2); else ctx.arc(cCenter, getV(outVal), 3, 0, Math.PI * 2);
          ctx.fillStyle = '#EF4444'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
        });
      }
    });

    let hideTimer;
    canvas.onmousemove = e => {
      const rect = canvas.getBoundingClientRect(); const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let hoveredStat = null;
      for (let i = 0; i < stats.length; i++) {
        if (!stats[i]) continue;
        const cCenter = isHorizontal ? (margin.top + i * bandSize + bandSize / 2) : (margin.left + i * bandSize + bandSize / 2);
        if (isHorizontal) { if (Math.abs(my - cCenter) < bandSize / 2) { hoveredStat = stats[i]; break; } } else { if (Math.abs(mx - cCenter) < bandSize / 2) { hoveredStat = stats[i]; break; } }
      }
      if (hoveredStat) {
        clearTimeout(hideTimer);
        const { median, mean, max, min, count, emps: hEmps } = hoveredStat;
        const cellInfo = { xLabel: hoveredStat.xk, yLabel: `中央値: ${median.toFixed(1)} / 平均: ${mean.toFixed(1)}`, xAxisLabel: xDef.label, yAxisLabel: yDef.label };
        hmTip.show(hEmps, cellInfo, e.clientX, e.clientY);
      } else { hideTimer = setTimeout(() => hmTip.hide(), 100); }
    };
    canvas.onmouseleave = () => { hideTimer = setTimeout(() => hmTip.hide(), 100); };
  }

  requestAnimationFrame(drawChart);

  const resizeObserver = new ResizeObserver(() => { requestAnimationFrame(drawChart); });
  resizeObserver.observe(chartWrap);

  const observerCleanUp = new MutationObserver((mutationsList, obs) => {
    for (const mutation of mutationsList) {
      for (const removedNode of mutation.removedNodes) {
        if (removedNode === chartWrap || removedNode.contains(chartWrap)) { resizeObserver.disconnect(); obs.disconnect(); }
      }
    }
  });
  observerCleanUp.observe(subCon, { childList: true, subtree: true });
}

/* ================================================================
   IMAGE EXPORT
================================================================ */
function openExportModal(defaultView) {
  document.querySelectorAll('input[name="exp-view"]').forEach(r => { r.checked = r.value === defaultView; });
  document.getElementById('export-progress').style.display = 'none';
  document.getElementById('export-prog-inner').style.width = '0%';
  document.getElementById('btn-do-export').disabled = false;
  document.getElementById('btn-export-cancel').textContent = 'キャンセル';
  openModal('export-img-modal');
}

async function doExportImages() {
  const viewKey  = document.querySelector('input[name="exp-view"]:checked')?.value || 'distribution';
  const count    = Math.max(1, Math.min(10, parseInt(document.getElementById('export-img-count').value) || 1));
  const prefix   = (document.getElementById('export-img-prefix').value.trim() || 'employee_dist').replace(/[^\w\-_]/g, '_');

  const targetId = viewKey === 'heatmap' ? 'hm-scroll' : 'dist-scroll';
  const target   = document.getElementById(targetId);
  if (!target) { toast('出力対象が見つかりません'); return; }

  const prog    = document.getElementById('export-progress');
  const progBar = document.getElementById('export-prog-inner');
  const progLbl = document.getElementById('export-prog-lbl');
  const doBtn   = document.getElementById('btn-do-export');
  prog.style.display = '';
  doBtn.disabled = true;

  const setProgress = (p, msg) => { progBar.style.width = p + '%'; progLbl.textContent = msg; };

  try {
    setProgress(5, '対象ビューを一時展開中...');
    const origOverflow = target.style.overflow;
    const origMaxH     = target.style.maxHeight;
    target.style.overflow  = 'visible';
    target.style.maxHeight = 'none';
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));

    const totalH = target.scrollHeight;
    const totalW = target.scrollWidth;

    setProgress(15, 'html2canvas でキャプチャ中...');
    const canvas = await html2canvas(target, {
      useCORS: true, scale: 1.5, backgroundColor: '#F1F5F9',
      scrollX: 0, scrollY: 0, windowWidth: totalW + 60, windowHeight: totalH + 60,
      logging: false
    });

    target.style.overflow  = origOverflow;
    target.style.maxHeight = origMaxH;

    const pw = canvas.width;
    const ph = canvas.height;
    const slicePx = Math.ceil(ph / count);

    for (let i = 0; i < count; i++) {
      setProgress(20 + ((i / count) * 75), `画像 ${i+1}/${count} 出力中...`);
      await new Promise(r => requestAnimationFrame(r));

      const sY = i * slicePx;
      const sH = Math.min(slicePx, ph - sY);
      if (sH <= 0) continue;

      const slice = document.createElement('canvas');
      slice.width  = pw; slice.height = sH;
      slice.getContext('2d').drawImage(canvas, 0, sY, pw, sH, 0, 0, pw, sH);

      const link = document.createElement('a');
      link.download = count === 1 ? `${prefix}.png` : `${prefix}_${String(i+1).padStart(2,'0')}.png`;
      link.href     = slice.toDataURL('image/png');
      link.click();
      await new Promise(r => setTimeout(r, 180));
    }
    setProgress(100, `完了 — ${count}枚出力しました`);
    document.getElementById('btn-export-cancel').textContent = '閉じる';
    toast(`${count}枚の画像を出力しました`);
  } catch(err) {
    setProgress(0, '');
    prog.style.display = 'none';
    doBtn.disabled = false;
    toast('画像出力に失敗しました: ' + err.message);
  }
}
