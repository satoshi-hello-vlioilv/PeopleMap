'use strict';

/* ================================================================
   DATA EXPORT (CSV)
================================================================ */
function exportDataCSV() {
  // 現在のリストフィルタ（検索・サイドバー等）が適用された一覧を取得
  const emps = typeof getFiltered === 'function' ? getFiltered() : DB.employees;
  if (!emps.length) {
    toast('出力するデータがありません');
    return;
  }

  const headers = [
    '従業員ID', '苗字', '名前', '苗字(ふりがな)', '名前(ふりがな)',
    '性別', '生年月日', '年齢', '入社年月日', '入社年', '在社年数', '退職年月日',
    '在籍状況', '入社区分', '属性', '職群',
    '学歴区分', '学校名', '学部・学科・専攻', '大卒換算入社年',
    '現在の所属(主務)', '現在の役職(主務)', '勤務場所(駐在)', '兼務状況',
    '連絡先', '休職・休業', 'タグ', '個別メモ'
  ];

  const rows = [headers];

  emps.forEach(emp => {
    const age = getEmpAge(emp);
    const years = calcYears(emp.hireDate);
    const hireY = parseHireYear(emp.hireDate);
    const adjInfo = getAdjHireYearInfo(emp);
    const state = getEmpActiveState(emp);
    const tags = empTagObjs(emp).map(t => t.name).join('、');
    
    let concurrentsStr = '';
    if (state.concurrents && state.concurrents.length > 0) {
      concurrentsStr = state.concurrents.map(c => 
        `${c.orgLevels.join(' ＞ ')}${c.position ? `（${c.position}）` : ''}`
      ).join(' ｜ ');
    }

    let orgStr = state.orgLevels.join(' ＞ ');
    if (state.kind === 'secondment') orgStr += ' [出向]';
    if (state.kind === 'transfer')   orgStr += ' [転籍]';

    let contactsStr = '';
    if (emp.contacts && emp.contacts.length > 0) {
      contactsStr = emp.contacts.map(c => {
        const typeLabel = c.label || (c.type === 'phone' ? '電話' : c.type === 'mobile' ? '携帯' : c.type === 'email' ? 'Email' : c.type === 'address' ? '住所' : 'その他');
        return `${typeLabel}:${c.value}`;
      }).join(' ｜ ');
    }
    
    let leavesStr = '';
    if (emp.leaves && emp.leaves.length > 0) {
      leavesStr = emp.leaves.map(l => {
        const typeLabel = l.type === 'absence' ? '休職' : l.type === 'childcare' ? '育休' : l.type === 'maternity' ? '産休' : l.type === 'nursing' ? '介護休' : l.type === 'resignation' ? '離籍' : 'その他';
        return `${l.start || '?'}〜${l.end || '継続中'} (${typeLabel})`;
      }).join(' ｜ ');
    }

    const row = [
      emp.id,
      emp.lastName || '',
      emp.firstName || '',
      emp.lastNameKana || '',
      emp.firstNameKana || '',
      emp.gender || '',
      emp.birthDate || (hasApproxAge(emp) ? '概算' : ''),
      age !== null ? age : '',
      emp.hireDate || '',
      hireY !== null ? hireY : '',
      years !== null ? years : '',
      emp.resignDate || '',
      emp.status || '',
      emp.hireType || '',
      emp.attribute || '',
      emp.course || '',
      emp.education || '',
      emp.school || '',
      emp.eduDept || '',
      adjInfo !== null ? adjInfo.year : '',
      orgStr,
      state.position || '',
      state.workLocation || '',
      concurrentsStr,
      contactsStr,
      leavesStr,
      tags,
      emp.memo || ''
    ];
    rows.push(row);
  });

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  };

  const csvStr = '\uFEFF' + rows.map(r => r.map(escapeCSV).join(',')).join('\n');
  const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  link.download = `employee_data_${new Date().toISOString().slice(0,10).replace(/-/g, '')}.csv`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
  
  toast(`表示中の ${emps.length} 件をCSVで出力しました`);
}

/* ================================================================
   DATA EXPORT (ZIP)
================================================================ */
async function exportDataZIP() {
  const zip = new JSZip();
  const masterConfigExport = {};
  Object.keys(DB.masterConfig).forEach(type => {
    const cfg = DB.masterConfig[type];
    const exp = {};
    if (cfg.levels)    exp.levels    = cfg.levels;
    if (cfg.type)      exp.type      = cfg.type;
    if (cfg.label)     exp.label     = cfg.label;
    if (cfg.icon)      exp.icon      = cfg.icon;
    if (cfg.itemLabel) exp.itemLabel = cfg.itemLabel;
    if (cfg.rootLabel) exp.rootLabel = cfg.rootLabel;
    masterConfigExport[type] = exp;
  });

  const payload = {
    version:      8, // アプリ最新仕様準拠 (住所, 連絡先, 休職, Corporate Events)
    exported:     new Date().toISOString(),
    employees:    DB.employees,
    tags:         DB.tags,
    masters:      DB.masters,
    masterConfig: masterConfigExport,
    settings:     DB.settings,
  };

  zip.file("data.json", JSON.stringify(payload, null, 2));

  const imgFolder = zip.folder("avatars");
  const allAvatars = await getAllAvatarsFromDB();
  allAvatars.forEach(a => { imgFolder.file(a.id, a.data); });

  const blob = await zip.generateAsync({ type: "blob" });
  const link = document.createElement('a');
  link.download = `employee_data_${new Date().toISOString().slice(0,10)}.zip`;
  link.href     = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
  
  DB.settings.lastBackupDate = Date.now();
  saveDB();
  if (typeof updateBackupBadge === 'function') updateBackupBadge();
  
  toast('データをZIPファイルでバックアップしました');
}

/* ================================================================
   DATA IMPORT (ZIP / JSON)
================================================================ */
let pendingImport = null;

async function handleImportFile(file, fromWelcome = false) {
  if (file.name.endsWith('.zip')) {
    try {
      const zip = await JSZip.loadAsync(file);
      const jsonFile = zip.file("data.json");
      if (!jsonFile) throw new Error("ZIP内にdata.jsonが見つかりません");
      const jsonStr = await jsonFile.async("string");

      const avatarFolder = zip.folder("avatars");
      if (avatarFolder) {
        const promises = [];
        avatarFolder.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir) {
            promises.push(zipEntry.async("blob").then(blob => {
              const id = relativePath;
              return saveAvatarToDB(id, blob).then(() => {
                if (avatarMap.has(id)) URL.revokeObjectURL(avatarMap.get(id));
                avatarMap.set(id, URL.createObjectURL(blob));
              });
            }));
          }
        });
        await Promise.all(promises);
      }
      processImportedJSON(jsonStr, fromWelcome);
    } catch(e) {
      toast("ZIPファイルの解析に失敗しました: " + e.message);
    }
  } else {
    const reader = new FileReader();
    reader.onload = e => processImportedJSON(e.target.result, fromWelcome);
    reader.readAsText(file, 'utf-8');
  }
}

function processImportedJSON(jsonStr, fromWelcome) {
  try {
    const d    = JSON.parse(jsonStr);
    const emps = Array.isArray(d.employees) ? d.employees : [];
    const tags = Array.isArray(d.tags)      ? d.tags      : [];
    const importedMasters      = d.masters      || null;
    const importedMasterConfig = d.masterConfig || null;
    const importedSettings     = d.settings     || null;
    if (!emps.length && !tags.length) { toast('インポートできるデータが見つかりません'); return; }

    const existEmpIds = new Set(DB.employees.map(e => e.id));
    const existTagIds = new Set(DB.tags.map(t => t.id));

    const empNew   = emps.filter(e => !existEmpIds.has(e.id));
    const empUpd   = emps.filter(e =>  existEmpIds.has(e.id));
    const empSame  = empUpd.filter(e => { const cur = DB.employees.find(c => c.id === e.id); return cur && JSON.stringify(cur) === JSON.stringify(e); });
    const empDiff  = empUpd.filter(e => !empSame.includes(e));

    const tagNew   = tags.filter(t => !existTagIds.has(t.id));
    const tagUpd   = tags.filter(t =>  existTagIds.has(t.id));
    const tagSame  = tagUpd.filter(t => { const cur = DB.tags.find(c => c.id === t.id); return cur && JSON.stringify(cur) === JSON.stringify(t); });
    const tagDiff  = tagUpd.filter(t => !tagSame.includes(t));

    const ALL_MASTER_TYPES = [...new Set([...Object.keys(DB.masters), ...(importedMasters ? Object.keys(importedMasters) : [])])];
    let masterNew = 0, masterUpd = 0, masterSame = 0;
    const hasMasters = importedMasters && ALL_MASTER_TYPES.some(k => Array.isArray(importedMasters[k]) && importedMasters[k].length);
    if (hasMasters) {
      ALL_MASTER_TYPES.forEach(type => {
        const src  = importedMasters[type] || [];
        const dest = DB.masters[type]      || [];
        const isTree = !!(DB.masterConfig[type]?.levels);
        const flatSrc  = isTree ? masterFlatten(src) : src;
        const flatDest = isTree ? masterFlatten(dest) : dest;
        const destFlatIds = new Set(flatDest.map(n => n.id));
        flatSrc.forEach(n => {
          if (!destFlatIds.has(n.id)) masterNew++;
          else {
            const cur = flatDest.find(x => x.id === n.id);
            if (cur && JSON.stringify(cur) === JSON.stringify(n)) masterSame++;
            else masterUpd++;
          }
        });
      });
    }

    const hasSettings = !!importedSettings;

    pendingImport = { emps, tags, importedMasters, importedMasterConfig, importedSettings,
                      empNew, empDiff, empSame, tagNew, tagDiff, tagSame, fromWelcome };

    renderDiffStats('diff-emp-stats', [
      { num: empNew.length,  lbl: '新規追加', cls: 'ds-add'  },
      { num: empDiff.length, lbl: '更新あり', cls: 'ds-upd'  },
      { num: empSame.length, lbl: '変更なし', cls: 'ds-same' },
    ]);
    renderDiffStats('diff-tag-stats', [
      { num: tagNew.length,  lbl: '新規追加', cls: 'ds-add'  },
      { num: tagDiff.length, lbl: '更新あり', cls: 'ds-upd'  },
      { num: tagSame.length, lbl: '変更なし', cls: 'ds-same' },
    ]);

    const masterSummary = document.getElementById('diff-masters-summary');
    if (masterSummary) {
      masterSummary.style.display = hasMasters ? '' : 'none';
      if (hasMasters) {
        renderDiffStats('diff-master-stats', [
          { num: masterNew,  lbl: '新規追加', cls: 'ds-add'  },
          { num: masterUpd,  lbl: '更新あり', cls: 'ds-upd'  },
          { num: masterSame, lbl: '変更なし', cls: 'ds-same' },
        ]);
      }
    }

    // settings 行の表示制御
    const settingsRow = document.getElementById('diff-settings-row');
    if (settingsRow) settingsRow.style.display = hasSettings ? '' : 'none';

    document.querySelectorAll('.imode-card').forEach(c => {
      c.classList.toggle('is-sel', c.dataset.mode === 'diff_add');
      const r = c.querySelector('input[type="radio"]');
      if (r) r.checked = c.dataset.mode === 'diff_add';
    });

    openModal('import-diff-modal');
  } catch(_) { toast('ファイルの解析に失敗しました。正しい形式を選択してください'); }
}

function renderDiffStats(containerId, items) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.map(i =>
    `<div class="diff-stat-item"><div class="diff-stat-num ${i.cls}">${i.num}</div><div class="diff-stat-lbl">${i.lbl}</div></div>`
  ).join('');
}

function execImport() {
  if (!pendingImport) return;
  const { emps, tags, importedMasters, importedMasterConfig, importedSettings,
          empNew, empDiff, tagNew, tagDiff, fromWelcome } = pendingImport;
  const mode = document.querySelector('input[name="imode"]:checked')?.value || 'diff_add';
  const ALL_IMPORT_MASTER_TYPES = [...new Set([...Object.keys(DB.masters), ...(importedMasters ? Object.keys(importedMasters) : [])])];

  const applyMasterConfig = (cfg, override = false) => {
    if (!cfg) return;
    Object.keys(cfg).forEach(type => {
      if (!DB.masterConfig[type]) DB.masterConfig[type] = {};
      const src = cfg[type];
      if (override || !DB.masterConfig[type]?.levels?.length) {
        if (src.levels) DB.masterConfig[type].levels = src.levels;
      }
      if (src.type)      DB.masterConfig[type].type      = src.type;
      if (src.label)     DB.masterConfig[type].label     = src.label;
      if (src.icon)      DB.masterConfig[type].icon      = src.icon;
      if (src.itemLabel) DB.masterConfig[type].itemLabel = src.itemLabel;
      if (src.rootLabel) DB.masterConfig[type].rootLabel = src.rootLabel;
    });
  };

  // settings チェックボックスの適用判定（diff_merge / replace のみ）
  const applySettingsChk = document.getElementById('import-apply-settings');
  const shouldApplySettings = importedSettings && applySettingsChk?.checked && mode !== 'diff_add';

  if (mode === 'diff_add') {
    DB.employees.push(...empNew);
    tagNew.forEach(t => { if (!DB.tags.find(x => x.id === t.id)) DB.tags.push(t); });
    if (importedMasters) {
      ALL_IMPORT_MASTER_TYPES.forEach(type => {
        if (Array.isArray(importedMasters[type])) {
          if (!DB.masters[type]) DB.masters[type] = [];
          importedMasters[type].forEach(n => { if (!DB.masters[type].find(x => x.id === n.id)) DB.masters[type].push(n); });
        }
      });
    }
    applyMasterConfig(importedMasterConfig, false);
    toast(`${empNew.length}名・${tagNew.length}タグを追加しました`);
  } else if (mode === 'diff_merge') {
    DB.employees.push(...empNew);
    empDiff.forEach(e => { const idx = DB.employees.findIndex(x => x.id === e.id); if (idx >= 0) DB.employees[idx] = e; });
    tagNew.forEach(t => { if (!DB.tags.find(x => x.id === t.id)) DB.tags.push(t); });
    tagDiff.forEach(t => { const idx = DB.tags.findIndex(x => x.id === t.id); if (idx >= 0) DB.tags[idx] = t; });
    if (importedMasters) {
      ALL_IMPORT_MASTER_TYPES.forEach(type => { if (Array.isArray(importedMasters[type])) DB.masters[type] = importedMasters[type]; });
    }
    applyMasterConfig(importedMasterConfig, true);
    if (shouldApplySettings) applySettingsData(importedSettings);
    toast(`${empNew.length + empDiff.length}名・${tagNew.length + tagDiff.length}タグをマージしました`);
  } else {
    DB.employees = emps; DB.tags = tags;
    if (importedMasters) {
      // 完全に置き換えつつ、デフォルトマスタキーが存在しない場合は空配列で初期化
      DB.masters = {};
      ALL_IMPORT_MASTER_TYPES.forEach(type => {
        DB.masters[type] = Array.isArray(importedMasters[type]) ? importedMasters[type] : [];
      });
      ['school','company','status','attribute','hireType','course','position'].forEach(k => {
        if (!DB.masters[k]) DB.masters[k] = [];
      });
    }
    applyMasterConfig(importedMasterConfig, true);
    if (shouldApplySettings) applySettingsData(importedSettings);
    toast(`${emps.length}名・${tags.length}タグをインポートしました`);
  }

  saveDB(); refreshAll(); renderTagMaster();
  if (currentView === 'masters') renderMasterView();
  updateHeaderCnt();
  pendingImport = null;
  closeModal('import-diff-modal');
  if (fromWelcome) closeWelcome();
}

/* ================================================================
   WORK LOCATION AUTOCOMPLETE（駐在勤務場所のサジェスト）
================================================================ */
function initWorkLocationAC() {
  initMasterAC({
    inputId: 'te-work-location',
    dropdownId: 'te-work-location-dd',
    getSuggestions: q => {
      const allPaths = [];
      const roots = DB.masters.company || [];
      function traverse(nodes, cur) {
        nodes.forEach(n => {
          const path = [...cur, n.name];
          allPaths.push(path.join(' ＞ '));
          if (n.children?.length) traverse(n.children, path);
        });
      }
      traverse(roots, []);
      return q ? allPaths.filter(s => s.toLowerCase().includes(q.toLowerCase())) : allPaths.slice(0, 50);
    },
    onSelect: val => { markEmpDirty?.(); },
    allowNew: true,
    getNewLabel: q => `「${q}」を勤務場所として入力`,
  });
}

/* ================================================================
   POSITION AUTOCOMPLETE（役職専用サジェスト）
================================================================ */
function initPositionAC() {
  const inp = document.getElementById('te-position');
  const dd  = document.getElementById('te-position-dd');
  if (!inp || !dd) return;

  let acFocusIdx = -1;

  function renderAC() {
    const q = inp.value.trim().toLowerCase();
    dd.innerHTML = '';
    acFocusIdx = -1;

    const suggestions = [];
    const roots = DB.masters.position ||[];
    
    // 子ノード（具体的な役職）のみを抽出。親（階層グループ）の情報を持たせる
    roots.forEach(parent => {
      (parent.children ||[]).forEach(child => {
        if (!q || child.name.toLowerCase().includes(q)) {
          suggestions.push({ parentName: parent.name, roleName: child.name });
        }
      });
    });

    if (suggestions.length === 0) {
      if (q) {
        const sep = document.createElement('div'); sep.className = 'master-ac-sep';
        const newItem = document.createElement('div'); newItem.className = 'master-ac-item is-new';
        newItem.innerHTML = `<i class="master-ac-icon fa-solid fa-circle-plus"></i>「${q}」を役職として新規使用`;
        newItem.addEventListener('mousedown', e => {
          e.preventDefault(); inp.value = q; dd.classList.remove('open'); markEmpDirty?.();
        });
        dd.append(sep, newItem);
      } else {
        const empty = document.createElement('div'); empty.className = 'master-ac-empty';
        empty.textContent = '役職マスタに役職が登録されていません';
        dd.appendChild(empty);
      }
    } else {
      suggestions.forEach(s => {
        const item = document.createElement('div');
        item.className = 'master-ac-item is-master';
        // 「階層グループ名 ＞ 役職名」の形式でリッチに表示
        item.innerHTML = `
          <i class="master-ac-icon fa-solid fa-user-tie"></i>
          <span class="master-ac-label">
            <span style="font-size:10px;color:var(--c-text-3);margin-right:6px">${s.parentName}</span>
            <b style="font-weight:600;color:var(--c-text)">${s.roleName}</b>
          </span>`;
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          inp.value = s.roleName; // 実際に入力されるのは具体的な役職名のみ
          dd.classList.remove('open');
          markEmpDirty?.();
        });
        dd.appendChild(item);
      });
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
   TRANSFER HISTORY (異動履歴)
================================================================ */
let empTransfers       = [];
let empContacts        = [];
let empLeaves          = [];

/* 休職・休業 種別定義 */
const LEAVE_TYPES = {
  absence:     { label: '休職',        icon: 'fa-solid fa-bed-pulse',            color: '#F59E0B' },
  childcare:   { label: '育児休業',     icon: 'fa-solid fa-baby',                color: '#EC4899' },
  maternity:   { label: '産前産後休業', icon: 'fa-solid fa-person-pregnant',     color: '#8B5CF6' },
  nursing:     { label: '介護休業',     icon: 'fa-solid fa-hands-holding-heart', color: '#10B981' },
  resignation: { label: '退職(離籍)',   icon: 'fa-solid fa-person-walking-arrow-right', color: '#64748B' },
  other:       { label: 'その他',       icon: 'fa-solid fa-ellipsis',            color: '#94A3B8' },
};

/* ────────────────────────────────────────────────────────────
   配属・異動・出向・転籍 種別定義
──────────────────────────────────────────────────────────── */
const TRANSFER_KINDS = {
  assignment: {
    label:     '配属・異動',
    dateLabel: '配属日',
    icon:      'fa-solid fa-rotate',
    color:     '#2563EB',
    dotCss:    'var(--c-primary)',
    borderCss: 'var(--c-border-d)',
    badgeBg:   '#DBEAFE',
    badgeFg:   '#1E40AF',
    hint:      '部署の異動、新規配属（役職の同時変更も可能）',
  },
  positionChange: {
    label:     '役職変更のみ',
    dateLabel: '発令日',
    icon:      'fa-solid fa-user-tie',
    color:     '#D97706',
    dotCss:    '#D97706',
    borderCss: '#FDE68A',
    badgeBg:   '#FEF3C7',
    badgeFg:   '#92400E',
    hint:      '対象の組織（主務・兼務）に対する役職のみを変更します',
  },
  secondment: {
    label:     '出向',
    dateLabel: '出向日（発令日）',
    icon:      'fa-solid fa-right-left',
    color:     '#0891B2',
    dotCss:    '#0891B2',
    borderCss: '#67E8F9',
    badgeBg:   '#CFFAFE',
    badgeFg:   '#155E75',
    hint:      '在籍元の雇用関係を維持しながら他社・グループ会社で勤務',
  },
  stationed: {
    label:     '駐在',
    dateLabel: '駐在開始日',
    icon:      'fa-solid fa-location-dot',
    color:     '#0D9488',
    dotCss:    '#0D9488',
    borderCss: '#5EEAD4',
    badgeBg:   '#CCFBF1',
    badgeFg:   '#115E59',
    hint:      '所属組織はそのまま、勤務場所のみ変わる駐在（帰任日を設定可能）',
  },
  transfer: {
    label:     '転籍',
    dateLabel: '転籍日',
    icon:      'fa-solid fa-right-from-bracket',
    color:     '#7C3AED',
    dotCss:    '#7C3AED',
    borderCss: '#C4B5FD',
    badgeBg:   '#EDE9FE',
    badgeFg:   '#4C1D95',
    hint:      '雇用関係ごと別会社へ移籍（転籍先を所属組織に入力）',
  },
  concurrent: {
    label:     '兼務',
    dateLabel: '兼務開始日',
    icon:      'fa-solid fa-code-branch',
    color:     '#059669',
    dotCss:    '#059669',
    borderCss: '#6EE7B7',
    badgeBg:   '#D1FAE5',
    badgeFg:   '#065F46',
    hint:      '主の配属を維持しながら、別組織・役職を兼務として追加登録',
  },
  removePosition: {
    label:     '役職解除',
    dateLabel: '解除日',
    icon:      'fa-solid fa-user-minus',
    color:     '#DC2626',
    dotCss:    '#EF4444',
    borderCss: '#FCA5A5',
    badgeBg:   '#FEE2E2',
    badgeFg:   '#991B1B',
    hint:      '対象の組織（主務・兼務）の役職を解除します',
  },
  endAssignment: {
    label:     '在籍終了',
    dateLabel: '終了日',
    icon:      'fa-solid fa-door-open',
    color:     '#64748B',
    dotCss:    '#94A3B8',
    borderCss: '#CBD5E1',
    badgeBg:   '#F1F5F9',
    badgeFg:   '#475569',
    hint:      '指定した配属（主務・兼務）を終了します',
  },
};

/* ────────────────────────────────────────────────────────────
   期間計算ユーティリティ
   startStr / endStr : 'YYYY-MM-DD' | 'YYYY-MM' | 'YYYY' | Date
   戻り値 : { years, months, totalMonths } | null
──────────────────────────────────────────────────────────── */
function calcPeriodYM(startStr, endStr) {
  const toDate = s => {
    if (!s) return null;
    if (s instanceof Date) return s;
    const str = String(s).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str);
    if (/^\d{4}-\d{2}$/.test(str))        return new Date(str + '-01');
    if (/^\d{4}$/.test(str))              return new Date(str + '-04-01');
    return null;
  };
  const s = toDate(startStr);
  const e = toDate(endStr || new Date());
  if (!s || !e || isNaN(s) || isNaN(e)) return null;
  let years  = e.getFullYear() - s.getFullYear();
  let months = e.getMonth()    - s.getMonth();
  if (months < 0) { years--; months += 12; }
  const totalMonths = years * 12 + months;
  if (totalMonths < 0) return null;
  return { years, months, totalMonths };
}

function formatPeriodStr(ym) {
  if (!ym || ym.totalMonths < 0) return null;
  if (ym.totalMonths === 0) return '1ヶ月未満';
  if (ym.years === 0) return `${ym.months}ヶ月`;
  if (ym.months === 0) return `${ym.years}年`;
  return `${ym.years}年${ym.months}ヶ月`;
}

/* ────────────────────────────────────────────────────────────
   異動履歴タブの「基本情報参照パネル」を更新する
   基本タブの現在の入力値（f-last, f-hire など）を読んで表示する
──────────────────────────────────────────────────────────── */
function updateTransferInfoPanel() {
  const panel = document.getElementById('transfer-info-panel');
  const tipBody = panel?.querySelector('.tip-body');
  if (!panel || !tipBody) return;

  const lastName  = document.getElementById('f-last')?.value.trim()  || '';
  const firstName = document.getElementById('f-first')?.value.trim() || '';
  const hireDateRaw = document.getElementById('f-hire')?.value.trim() || '';
  
  // 氏名が未入力ならパネル非表示
  if (!lastName && !firstName) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const activePill = document.querySelector('#f-status-group .rpill input:checked');
  const statusText = activePill ? activePill.value : '';
  const statusItem = (DB.masters.status || []).find(i => i.name === statusText);
  const statusColor = statusItem?.color;
  const statusStyle = statusColor ? `background:${lighten(statusColor)};color:${statusColor};padding:2px 8px;border-radius:99px;` : '';

  const normHire = normalizeHireDate(hireDateRaw);
  const hireDateStr = normHire ? normHire.replace(/-/g, '/') : '未入力';
  const ym = normHire ? calcPeriodYM(normHire, new Date()) : null;
  const tenureStr = ym ? formatPeriodStr(ym) : '─';

  const empId = document.getElementById('f-id').value;
  const emp = DB.employees.find(e => e.id === empId) || { transfers: empTransfers };
  const previewEmp = { ...emp, transfers: empTransfers };
  const state = getEmpActiveState(previewEmp);

  let locText = '';
  if (state.kind === 'stationed' && state.workLocation) locText = `<span style="font-size:11px;color:#0D9488;margin-left:6px;background:#CCFBF1;padding:1px 6px;border-radius:4px;"><i class="fa-solid fa-location-dot"></i>${state.workLocation}駐在</span>`;
  else if (state.kind === 'secondment') locText = `<span style="font-size:11px;color:#0891B2;margin-left:6px;background:#CFFAFE;padding:1px 6px;border-radius:4px;"><i class="fa-solid fa-right-left"></i>出向</span>`;

  let orgListHtml = '';
  
  // 主務
  let primaryOrgText = state.orgLevels.length ? state.orgLevels.join(' › ') : '<span style="color:var(--c-text-3);font-weight:400;">組織未設定</span>';
  let primaryPosHtml = state.position ? `<span class="tip-pos-badge"><i class="fa-solid fa-user-tie"></i>${state.position}</span>` : '';
  orgListHtml += `
    <div class="tip-org-row">
      <span class="tip-org-type primary">主務</span>
      <span class="tip-org-path">${primaryOrgText}${locText}</span>
      ${primaryPosHtml}
    </div>
  `;

  // 兼務
  if (state.concurrents && state.concurrents.length > 0) {
    state.concurrents.forEach(c => {
      let concOrgText = c.orgLevels.length ? c.orgLevels.join(' › ') : '<span style="color:var(--c-text-3);font-weight:400;">組織未設定</span>';
      let concPosHtml = c.position ? `<span class="tip-pos-badge concurrent"><i class="fa-solid fa-user-tie"></i>${c.position}</span>` : '';
      orgListHtml += `
        <div class="tip-org-row">
          <span class="tip-org-type concurrent">兼務</span>
          <span class="tip-org-path">${concOrgText}</span>
          ${concPosHtml}
        </div>
      `;
    });
  }

  tipBody.innerHTML = `
    <div class="tip-item tip-item-name">
      <span class="tip-lbl">氏名 / 在籍</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="tip-val tip-val-name">${lastName} ${firstName}</span>
        <span class="tip-val" style="font-size:11px;${statusStyle}">${statusText || '─'}</span>
      </div>
    </div>
    <div class="tip-divider"></div>
    <div class="tip-item">
      <span class="tip-lbl"><i class="fa-solid fa-calendar-days"></i>入社 / 在社年数</span>
      <div style="display:flex;align-items:baseline;gap:6px;">
        <span class="tip-val" style="font-size:12px;color:var(--c-text-2)">${hireDateStr}</span>
        <span class="tip-val tip-val-accent" style="font-size:13px">${tenureStr}</span>
      </div>
    </div>
    <div class="tip-divider"></div>
    <div class="tip-item tip-item-orgs">
      <span class="tip-lbl"><i class="fa-solid fa-building-user" style="color:var(--c-primary)"></i>所属・役職情報</span>
      <div class="tip-org-list">
        ${orgListHtml}
      </div>
    </div>
  `;
}

/* ================================================================
   TRANSFER COMPANY AUTOCOMPLETE — 多段階サジェストエンジン
   ①前方一致 → ②部分一致 → ③ファジー / ④履歴 / ⑤人気ワード
================================================================ */

/** セッション内の選択履歴（最大10件、sessionStorage 永続化） */
const _companyACHistory = (() => {
  try { return JSON.parse(sessionStorage.getItem('_companyACHist') || '[]'); }
  catch { return []; }
})();

function _companyACHistoryAdd(pathStr, pathArr) {
  const idx = _companyACHistory.findIndex(h => h.pathStr === pathStr);
  if (idx >= 0) _companyACHistory.splice(idx, 1);
  _companyACHistory.unshift({ pathStr, pathArr });
  if (_companyACHistory.length > 10) _companyACHistory.pop();
  try { sessionStorage.setItem('_companyACHist', JSON.stringify(_companyACHistory)); } catch {}
}

/** 全従業員の異動履歴から会社パスの使用頻度マップを生成 */
function _getCompanyPopularity() {
  const freq = new Map();
  DB.employees.forEach(emp => {
    (emp.transfers || []).forEach(tr => {
      const levels = Array.isArray(tr.orgLevels)
        ? tr.orgLevels
        : [tr.company || '', tr.department || ''].filter(Boolean);
      if (levels.length) {
        const key = levels.join(' ＞ ');
        freq.set(key, (freq.get(key) || 0) + 1);
      }
    });
  });
  return freq;
}

/** ファジー検索: query の各文字が text に順番通りに含まれるか */
function _fuzzyMatch(text, query) {
  let qi = 0;
  const tl = text.toLowerCase(), ql = query.toLowerCase();
  for (let i = 0; i < tl.length && qi < ql.length; i++) {
    if (tl[i] === ql[qi]) qi++;
  }
  return qi === ql.length;
}

/** マッチ箇所を <mark> でハイライト */
function _acHighlight(text, query) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx >= 0) {
    return text.slice(0, idx)
      + `<mark class="ac-hl">${text.slice(idx, idx + query.length)}</mark>`
      + text.slice(idx + query.length);
  }
  // ファジーハイライト: マッチした文字を一文字ずつ強調
  let result = '', qi = 0;
  const ql = query.toLowerCase();
  for (let i = 0; i < text.length; i++) {
    if (qi < ql.length && text[i].toLowerCase() === ql[qi]) {
      result += `<mark class="ac-hl">${text[i]}</mark>`; qi++;
    } else { result += text[i]; }
  }
  return result;
}

/** 深さに応じたアイコンクラスを返す */
function _acDepthIcon(depth) {
  if (depth <= 1) return 'fa-solid fa-building';
  if (depth === 2) return 'fa-solid fa-sitemap';
  if (depth === 3) return 'fa-solid fa-people-group';
  return 'fa-solid fa-diagram-project';
}

/** 汎用アイテムDOM生成 */
function _acMakeItem({ pathArr, pathStr, isOldName, currentName }, query, matchType, extra = '') {
  const item = document.createElement('div');
  item.className = 'master-ac-item is-master';
  const company = pathArr[0];
  const subPath = pathArr.slice(1).join(' ＞ ');
  const iconCls = _acDepthIcon(pathArr.length);
  const hlCompany = query ? _acHighlight(company, query) : company;
  const hlSub     = query && subPath ? _acHighlight(subPath, query) : subPath;
  const sub = subPath ? `<span class="ac-sub-path"> ＞ ${hlSub}</span>` : '';
  const fuzzBadge = matchType === 'fuzzy'
    ? `<span class="ac-match-badge ac-match-fuzzy"><i class="fa-solid fa-wand-magic-sparkles"></i>ファジー</span>` : '';
  const oldNameBadge = isOldName
    ? `<span class="ac-oldname-badge" title="当時の名称（現在：${currentName}）"><i class="fa-solid fa-clock-rotate-left"></i>当時の名称</span>`
    : '';
  item.innerHTML = `<i class="master-ac-icon ${iconCls}"></i><span class="master-ac-label"><span class="ac-company-name">${hlCompany}</span>${sub}</span>${oldNameBadge}${fuzzBadge}${extra}`;
  item.addEventListener('mousedown', e => {
    e.preventDefault();
    document.getElementById('te-company-input').value = pathStr;
    document.getElementById('te-company-levels').value = JSON.stringify(pathArr);
    document.getElementById('te-company-dd').classList.remove('open');
    _companyACHistoryAdd(pathStr, pathArr);
    markEmpDirty?.();
  });
  return item;
}

const CONTACT_TYPES = {
  phone:   { label: '電話番号',       icon: 'fa-solid fa-phone',          placeholder: '000-0000-0000',               inputMode: 'tel'   },
  mobile:  { label: '携帯電話',       icon: 'fa-solid fa-mobile-screen',  placeholder: '080-0000-0000',               inputMode: 'tel'   },
  email:   { label: 'メールアドレス', icon: 'fa-solid fa-envelope',       placeholder: 'name@example.com',            inputMode: 'email' },
  address: { label: '住所',           icon: 'fa-solid fa-location-dot',   placeholder: '〒000-0000 都道府県市区町村…', inputMode: 'text'  },
  other:   { label: 'その他',         icon: 'fa-solid fa-circle-info',    placeholder: '',                            inputMode: 'text'  },
};

function getTransferOrgLevels(tr) {
  if (Array.isArray(tr.orgLevels)) return tr.orgLevels;
  return [tr.company || '', tr.department || '', tr.division || ''];
}

function buildTransferOrgFields(currentOrgLevels =[]) {
  const inp = document.getElementById('te-company-input');
  const hd  = document.getElementById('te-company-levels');
  if (!inp || !hd) return;
  
  const levels = currentOrgLevels.filter(Boolean);
  inp.value = levels.join(' ＞ ');
  hd.value  = JSON.stringify(levels);
}

function _buildTargetOrgSelect(previewEmp, targetDate) {
 const sel = document.getElementById('te-target-org');
 if (!sel) return;
 sel.innerHTML = '';
 const chkDate = targetDate || new Date().toISOString().slice(0, 10);
 const state = getEmpActiveState(previewEmp, targetDate);
 const KIND_LABELS = { assignment:'主務', secondment:'出向', stationed:'駐在', transfer:'転籍', concurrent:'兼務' };
 const isSameOrg = (a, b) => JSON.stringify(a) === JSON.stringify(b);
 
 // 各組織の開始日を履歴からスキャン
 const transfers = previewEmp.transfers || [];
 const sorted = [...transfers].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
 const startDates = new Map();
 sorted.forEach(tr => {
   if (tr.date && tr.date <= chkDate) {
     const k = tr.kind || 'assignment';
     if (['assignment', 'transfer', 'secondment', 'stationed', 'concurrent'].includes(k)) {
       const orgs = Array.isArray(tr.orgLevels) ? tr.orgLevels.filter(Boolean) : [];
       if (orgs.length) {
         startDates.set(JSON.stringify(orgs), tr.date);
       }
     }
   }
 });

 // ── 候補リスト構築 ──
 const items = [];
 const addedKeys = new Set();
 const addItem = (label, orgLevels, position, extra) => {
  const key = JSON.stringify(orgLevels);
  if (addedKeys.has(key)) return;
  addedKeys.add(key);
  const startDate = startDates.get(key) || '不明';
  items.push({ label, orgLevels, position: position || '', extra: extra || '', startDate });
 };
 // 1. 主務（現在のprimary — 出向/駐在中はその種別で表示）
 if (state.orgLevels.length > 0) {
  const lbl = KIND_LABELS[state.kind] || '主務';
  const extra = (state.kind === 'stationed' && state.workLocation) ? ` [${state.workLocation}]` : '';
  addItem(lbl, state.orgLevels, state.position, extra);
 }
 // 2. 兼務
 (state.concurrents || []).forEach(c => {
  if (c.orgLevels.length > 0) addItem('兼務', c.orgLevels, c.position);
 });
 // 3. 生の異動履歴をスキャンし、endDate未設定の出向・駐在・兼務を追加候補に
 sorted.forEach(tr => {
  const k = tr.kind || 'assignment';
  if (!['secondment', 'stationed', 'concurrent'].includes(k)) return;
  if (tr.date && tr.date > chkDate) return;
  if (tr.endDate && tr.endDate <= chkDate) return;
  const orgs = Array.isArray(tr.orgLevels) ? tr.orgLevels.filter(Boolean) : [];
  if (!orgs.length) return;
  const orgKey = JSON.stringify(orgs);
  if (addedKeys.has(orgKey)) return;
  // endAssignment で既に終了されていないかチェック
  const wasEnded = transfers.some(t => {
   if ((t.kind || '') !== 'endAssignment') return false;
   if (!t.date || t.date > chkDate) return false;
   if (t.date < (tr.date || '')) return false;
   const tOrgs = Array.isArray(t.orgLevels) ? t.orgLevels : [];
   return isSameOrg(tOrgs, orgs);
  });
  if (wasEnded) return;
  const lbl = KIND_LABELS[k] || k;
  const extra = (k === 'stationed' && tr.workLocation) ? ` [${tr.workLocation}]` : '';
  addItem(lbl, orgs, tr.position, extra);
 });
 // ── select 要素の構築 ──
 const allOpt = document.createElement('option');
 allOpt.value = '[]';
 allOpt.textContent = items.length > 0
  ? `[すべて] ${items.length}件の在籍を一括終了`
  : '[すべて] 主務・兼務を一括処理';
 sel.appendChild(allOpt);
 items.forEach(item => {
  const opt = document.createElement('option');
  opt.value = JSON.stringify(item.orgLevels);
  let text = `[${item.label}] ${item.orgLevels.join(' ＞ ') || '組織未設定'}`;
  if (item.position) text += `（${item.position}）`;
  if (item.extra) text += item.extra;
  
  // 日付の整合性（期間）を視覚化して追加
  const startFmt = item.startDate !== '不明' ? item.startDate.replace(/-/g, '/') : '開始日不明';
  const endFmt = targetDate ? targetDate.replace(/-/g, '/') : '未定';
  text += ` 【${startFmt} 〜 ${endFmt}】`;

  opt.textContent = text;
  sel.appendChild(opt);
 });
 if (items.length === 0) {
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '[]';
  emptyOpt.textContent = '（終了可能な在籍がありません）';
  emptyOpt.disabled = true;
  sel.appendChild(emptyOpt);
 }
}

function initTransferCompanyAC() {
  const inp = document.getElementById('te-company-input');
  const dd  = document.getElementById('te-company-dd');
  const hd  = document.getElementById('te-company-levels');
  if (!inp || !dd || !hd) return;

  /* ── 表示件数設定（セッション内で保持） ──
     LIMIT_OPTIONS: 選択肢として提示する件数プリセット
     _acLimit: 現在の表示件数（0 = すべて表示）
  ─────────────────────────────────────── */
  const LIMIT_OPTIONS = [10, 20, 50];
  let _acLimit       = 10;  // デフォルト 10 件
  let acFocusIdx     = -1;
  let _flatItems     = [];
  let _expandedSecs  = new Set(); // 個別展開済みセクションキー
  let _lastQuery     = null;

  /** 指定日時点でのノード名称を返す
   *  oldNames = [{ name: '旧名称', untilDate: 'YYYY-MM-DD|YYYY-MM|YYYY' }, ...]
   *  untilDate: その名称が有効だった最終日
   */
  function _getNodeNameAtDate(node, filterDate) {
    if (!filterDate || !Array.isArray(node.oldNames) || !node.oldNames.length) return node.name;
    // untilDate 降順でソートし、filterDate <= untilDate の最初のものを返す
    const sorted = [...node.oldNames]
      .filter(o => o.name && o.untilDate)
      .sort((a, b) => b.untilDate.localeCompare(a.untilDate));
    for (const old of sorted) {
      if (filterDate <= old.untilDate) return old.name;
    }
    return node.name;
  }

  /** 会社マスタを全階層フラット化してパス配列を返す（発令日による期間フィルタ対応） */
  function getAllPaths(filterDate = null) {
    const paths = [];
    const roots = filterDate
      ? (DB.masters.company || []).filter(n => {
          if (n.foundedDate   && filterDate < n.foundedDate)   return false;
          if (n.dissolvedDate && filterDate > n.dissolvedDate) return false;
          return true;
        })
      : (DB.masters.company || []);
    (function traverse(nodes, cur) {
      nodes.forEach(n => {
        // 発令日指定時は当時の名称を使用（旧名称があれば旧称で記録）
        const displayName = filterDate ? _getNodeNameAtDate(n, filterDate) : n.name;
        const isOldName   = filterDate ? displayName !== n.name : false;
        const path = [...cur, displayName];
        paths.push({ node: n, pathArr: path, pathStr: path.join(' ＞ '), isOldName, currentName: n.name });
        if (n.children?.length) traverse(n.children, path);
      });
    })(roots, []);
    return paths;
  }

  /* ── 件数コントロールバーを生成 ──
     ドロップダウン最下部に固定表示。
     mousedown で e.preventDefault() してフォーカスを奪わない。
  ─────────────────────────────────── */
  function _buildLimitBar() {
    const bar = document.createElement('div');
    bar.className = 'ac-limit-bar';

    const label = document.createElement('span');
    label.className = 'ac-limit-label';
    label.innerHTML = '<i class="fa-solid fa-list-ol"></i>表示件数';
    bar.appendChild(label);

    const pills = document.createElement('div');
    pills.className = 'ac-limit-pills';

    LIMIT_OPTIONS.forEach(n => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ac-limit-pill' + (_acLimit === n ? ' is-active' : '');
      btn.textContent = n + '件';
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        _acLimit = n;
        _expandedSecs.clear();
        renderAC();
      });
      pills.appendChild(btn);
    });

    // 「すべて」ボタン
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'ac-limit-pill' + (_acLimit === 0 ? ' is-active' : '');
    allBtn.innerHTML = '<i class="fa-solid fa-infinity"></i>すべて';
    allBtn.addEventListener('mousedown', e => {
      e.preventDefault();
      _acLimit = 0;
      _expandedSecs.clear();
      renderAC();
    });
    pills.appendChild(allBtn);
    bar.appendChild(pills);
    return bar;
  }

  /* ── セクション DOM 生成（展開対応版） ──
     allPaths : このセクションのすべての候補（スライス前）
     sectionKey: 展開状態を管理するキー文字列
     q         : ハイライト用クエリ
     matchType : 'prefix' | 'partial' | 'fuzzy' | 'hist' | 'pop' | 'all'
     extraBadgeFn: (pathData) => HTML文字列 | null（任意バッジ）
  ──────────────────────────────────────── */
  function _buildSectionEx(iconCls, title, allMatchPaths, sectionKey, q, matchType, extraBadgeFn = null) {
    if (!allMatchPaths.length) return null;

    const limit      = _acLimit === 0 ? Infinity : _acLimit;
    const isExpanded = _expandedSecs.has(sectionKey);
    const effLimit   = isExpanded ? Infinity : limit;
    const shown      = effLimit === Infinity ? allMatchPaths : allMatchPaths.slice(0, effLimit);
    const hasMore    = !isExpanded && limit !== Infinity && allMatchPaths.length > limit;
    const remaining  = hasMore ? allMatchPaths.length - shown.length : 0;

    const sec = document.createElement('div');
    sec.className = 'ac-section';

    // ── ヘッダー ──
    const hdr = document.createElement('div');
    hdr.className = 'ac-section-hdr';
    const cntHtml = hasMore
      ? `<span class="ac-section-cnt is-partial">${shown.length}<span class="ac-cnt-sep">/</span>${allMatchPaths.length}</span>`
      : `<span class="ac-section-cnt">${allMatchPaths.length}</span>`;
    hdr.innerHTML = `<i class="${iconCls}"></i>${title}${cntHtml}`;
    sec.appendChild(hdr);

    // ── アイテム ──
    shown.forEach(p => {
      const extra = extraBadgeFn ? extraBadgeFn(p) : '';
      sec.appendChild(_acMakeItem(p, q, matchType, extra));
    });

    // ── 「さらに N 件を表示」ボタン ──
    if (hasMore) {
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'ac-more-btn';
      moreBtn.innerHTML =
        `<i class="fa-solid fa-chevrons-down"></i>さらに <strong>${remaining}</strong> 件を表示`;
      moreBtn.addEventListener('mousedown', e => {
        e.preventDefault(); // フォーカス維持
        _expandedSecs.add(sectionKey);
        renderAC();
      });
      sec.appendChild(moreBtn);
    }

    return sec;
  }

  function renderAC() {
    const q  = inp.value.trim();
    const ql = q.toLowerCase();
    dd.innerHTML = '';
    acFocusIdx = -1;
    _flatItems = [];

    // クエリが変わったらセクション展開状態をリセット
    if (q !== _lastQuery) {
      _expandedSecs.clear();
      _lastQuery = q;
    }

    // 発令日による期間絞り込み
    const rawTeDate = document.getElementById('te-date')?.value?.trim() || '';
    const filterDate = rawTeDate ? (normalizeHireDate(rawTeDate) || null) : null;
    const allPaths = getAllPaths(filterDate);

    // ── マスタ未登録 or 日付フィルタで全件除外 ──
    if (!allPaths.length) {
      const totalCount = (DB.masters.company || []).length;
      const emptyHtml = (filterDate && totalCount > 0)
        ? `<div class="master-ac-empty"><i class="fa-solid fa-calendar-xmark" style="margin-right:6px;color:var(--c-warn)"></i><b>${filterDate.replace(/-/g,'/')}</b> 時点で存在する組織がありません</div>`
        : `<div class="master-ac-empty"><i class="fa-solid fa-building-circle-exclamation" style="margin-right:6px"></i>会社マスタに組織が登録されていません</div>`;
      dd.innerHTML = emptyHtml;
      dd.classList.add('open');
      return;
    }

    // ── 発令日絞り込みバナー（除外された会社 or 旧称適用がある場合に表示）──
    if (filterDate) {
      const totalRoots    = (DB.masters.company || []).length;
      const filteredRoots = (DB.masters.company || []).filter(n => {
        if (n.foundedDate   && filterDate < n.foundedDate)   return false;
        if (n.dissolvedDate && filterDate > n.dissolvedDate) return false;
        return true;
      }).length;
      const hasOldNames = allPaths.some(p => p.isOldName);
      if (filteredRoots < totalRoots || hasOldNames) {
        const banner = document.createElement('div');
        banner.className = 'ac-date-filter-banner';
        const oldNameNote = hasOldNames
          ? `<span class="ac-filter-oldname"><i class="fa-solid fa-clock-rotate-left"></i>当時の名称で表示</span>`
          : '';
        const cntNote = filteredRoots < totalRoots
          ? `<span class="ac-filter-cnt">${filteredRoots}/${totalRoots}社</span>`
          : '';
        banner.innerHTML =
          `<i class="fa-solid fa-calendar-days"></i>` +
          `発令日 <b>${filterDate.replace(/-/g,'/')}</b> 時点` +
          `${oldNameNote}${cntNote}`;
        dd.appendChild(banner);
      }
    }

    const sections = [];

    if (!q) {
      // ━━━ 空クエリ: ④履歴 + ⑤人気ワード ━━━
      const freq = _getCompanyPopularity();

      // ④ 履歴セクション
      const histAll = _companyACHistory
        .map(h => allPaths.find(p => p.pathStr === h.pathStr))
        .filter(Boolean);
      const histSec = _buildSectionEx(
        'fa-solid fa-clock-rotate-left', '最近選択した組織',
        histAll, 'hist', '', 'hist'
      );
      if (histSec) sections.push(histSec);

      // ⑤ 人気ワードセクション
      const popAll = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([pathStr, cnt]) => {
          const p = allPaths.find(x => x.pathStr === pathStr);
          return p ? { ...p, _cnt: cnt } : null;
        })
        .filter(Boolean);
      const popSec = _buildSectionEx(
        'fa-solid fa-fire-flame-curved', 'よく使われる組織',
        popAll, 'pop', '', 'pop',
        p => `<span class="ac-pop-cnt"><i class="fa-solid fa-user"></i>${p._cnt}</span>`
      );
      if (popSec) sections.push(popSec);

      // 履歴も人気もなければ全件表示
      if (!sections.length) {
        const allSec = _buildSectionEx(
          'fa-solid fa-building', 'すべての組織', allPaths, 'all', '', 'all'
        );
        if (allSec) sections.push(allSec);
      }
    } else {
      // ━━━ クエリあり: ①前方 → ②部分 → ③ファジー ━━━
      const seen = new Set();

      // ① 前方一致
      const prefix = allPaths.filter(p => {
        if (p.pathStr.toLowerCase().startsWith(ql)) return true;
        return p.pathArr.some(part => part.toLowerCase().startsWith(ql));
      });
      prefix.forEach(p => seen.add(p.pathStr));
      const prefixSec = _buildSectionEx(
        'fa-solid fa-arrow-right-to-bracket', '前方一致', prefix, 'prefix', q, 'prefix'
      );
      if (prefixSec) sections.push(prefixSec);

      // ② 部分一致（①除外）
      const partial = allPaths.filter(p =>
        !seen.has(p.pathStr) && p.pathStr.toLowerCase().includes(ql)
      );
      partial.forEach(p => seen.add(p.pathStr));
      const partialSec = _buildSectionEx(
        'fa-solid fa-magnifying-glass', '部分一致', partial, 'partial', q, 'partial'
      );
      if (partialSec) sections.push(partialSec);

      // ③ ファジー（①②除外、2文字以上）
      if (q.length >= 2) {
        const fuzzy = allPaths.filter(p => {
          if (seen.has(p.pathStr)) return false;
          return _fuzzyMatch(p.pathStr, q) || p.pathArr.some(part => _fuzzyMatch(part, q));
        });
        const fuzzySec = _buildSectionEx(
          'fa-solid fa-wand-magic-sparkles', 'ファジー検索', fuzzy, 'fuzzy', q, 'fuzzy'
        );
        if (fuzzySec) sections.push(fuzzySec);
      }

      // 完全ゼロ → 新規登録オプション
      if (!sections.length) {
        const sep = document.createElement('div'); sep.className = 'master-ac-sep';
        const newItem = document.createElement('div');
        newItem.className = 'master-ac-item is-new';
        newItem.innerHTML = `<i class="master-ac-icon fa-solid fa-circle-plus"></i>「${q}」を新規組織として使用`;
        newItem.addEventListener('mousedown', e => {
          e.preventDefault();
          inp.value = q;
          const parts = q.split(/\s*[＞>]\s*/).filter(Boolean);
          hd.value = JSON.stringify(parts);
          dd.classList.remove('open'); markEmpDirty?.();
        });
        dd.append(sep, newItem);
        _flatItems = [newItem];
        dd.classList.add('open');
        return;
      }
    }

    sections.forEach(s => dd.appendChild(s));

    // ── 件数コントロールバー（候補がある場合のみ表示） ──
    const bar = _buildLimitBar();
    dd.appendChild(bar);

    _flatItems = [...dd.querySelectorAll('.master-ac-item')];
    dd.classList.toggle('open', _flatItems.length > 0);
  }

  inp.addEventListener('focus', renderAC);
  inp.addEventListener('blur', () => setTimeout(() => dd.classList.remove('open'), 150));
  inp.addEventListener('input', () => {
    hd.value = '[]';
    renderAC();
  });

  // 発令日が変更されたら会社ACを再フィルタ（期間整合性チェックのため）
  const _teDateEl = document.getElementById('te-date');
  if (_teDateEl) {
    const _refilterAC = () => { if (dd.classList.contains('open')) renderAC(); };
    _teDateEl.addEventListener('input',  _refilterAC);
    _teDateEl.addEventListener('change', _refilterAC);
  }

  inp.addEventListener('keydown', e => {
    const items = _flatItems.length ? _flatItems : [...dd.querySelectorAll('.master-ac-item')];
    if (!items.length || !dd.classList.contains('open')) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acFocusIdx = Math.min(acFocusIdx + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('is-focused', i === acFocusIdx));
      items[acFocusIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acFocusIdx = Math.max(acFocusIdx - 1, 0);
      items.forEach((it, i) => it.classList.toggle('is-focused', i === acFocusIdx));
      items[acFocusIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && acFocusIdx >= 0) {
      e.preventDefault();
      items[acFocusIdx].dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      dd.classList.remove('open');
    }
  });
}

function switchEmpModalTab(paneId) {
  document.querySelectorAll('#emp-modal-tabs .modal-tab').forEach(t => t.classList.toggle('is-active', t.dataset.pane === paneId));
  document.querySelectorAll('#emp-pane-profile, #emp-pane-details, #emp-pane-transfer, #emp-pane-contacts').forEach(p => p.classList.toggle('is-active', p.id === paneId));
  if (paneId === 'emp-pane-transfer') updateTransferInfoPanel();
}
function updateTransferTabBadge() {
  const badge = document.getElementById('transfer-tab-badge');
  if (!badge) return;
  const total = empTransfers.length + empLeaves.length;
  badge.textContent = total;
  badge.classList.toggle('is-zero', total === 0);
}
function updateContactsTabBadge() {
  const badge = document.getElementById('contacts-tab-badge');
  if (!badge) return;
  badge.textContent = empContacts.length; badge.classList.toggle('is-zero', empContacts.length === 0);
}

let transferSortDir = 'asc';

function buildTimelineEntries(transfers, leaves) {
  const allEntries = [];
  transfers.forEach((t, i) => {
    const sortDate = t.date || t.endDate || '';
    allEntries.push({ ...t, _kind: 'transfer', _origIdx: i, _sortDate: sortDate });
    if ((t.kind === 'secondment' || t.kind === 'concurrent' || t.kind === 'stationed') && t.endDate) {
      allEntries.push({ ...t, _kind: 'transfer_end', date: t.endDate, _sortDate: t.endDate, _origIdx: i + 0.5 });
    }
  });
  leaves.forEach((l, i) => {
    const sortDate = l.start || l.end || '';
    allEntries.push({ ...l, _kind: 'leave', date: l.start, _sortDate: sortDate, _origIdx: -1 - i });
    if (l.end) {
      allEntries.push({ ...l, _kind: 'leave_end', date: l.end, _sortDate: l.end, _origIdx: -1 - i - 0.5 });
    }
  });
  allEntries.sort((a, b) => {
    const cmp = (a._sortDate || '').localeCompare(b._sortDate || '');
    if (cmp !== 0) return cmp;
    return a._origIdx - b._origIdx;
  });
  return allEntries;
}

function renderTimelineToContainer(container, entries, sortDir, isEditable, periodEndStr = null, transfersRef = [], empId = null) {
  container.innerHTML = '';
  container.className = `transfer-timeline tr-dir-${sortDir}`;
  if (!entries.length) return;

  const NON_PRIMARY_KINDS = ['concurrent', 'removePosition', 'endAssignment', 'stationed'];
  const orgDurMap = new Map();
  const posDurMap = new Map();
  let lastOrgEntry = null;
  let lastPosEntry = null;
  let currentOrgLevels = [];

  const isSameOrg = (orgA, orgB) => JSON.stringify(orgA) === JSON.stringify(orgB);

  // 1. 基本状態と期間の計算
  entries.forEach(entry => {
    if (entry._kind === 'transfer') {
      const isNonPrimary = NON_PRIMARY_KINDS.includes(entry.kind);
      const isOrgChange  = !isNonPrimary && entry.kind !== 'positionChange';
      const isPosChange  = !isNonPrimary && (entry.kind === 'positionChange' || !!entry.position);
      const orgs = getTransferOrgLevels(entry);

      if (isNonPrimary) {
        entry._inheritedOrgLevels = (entry.kind === 'removePosition' && !orgs.length) ? [...currentOrgLevels] : orgs.filter(Boolean);
      } else if (entry.kind === 'positionChange') {
        entry._inheritedOrgLevels = orgs.length ? orgs : [...currentOrgLevels];
      } else if (orgs.length > 0) {
        currentOrgLevels = orgs;
        entry._inheritedOrgLevels = orgs;
      } else {
        currentOrgLevels = [];
        entry._inheritedOrgLevels = [];
      }

      if (isOrgChange) {
        if (lastOrgEntry && lastOrgEntry.date) {
          let end = entry.date || entry.endDate;
          if (lastOrgEntry.kind === 'secondment' && lastOrgEntry.endDate) end = lastOrgEntry.endDate;
          orgDurMap.set(lastOrgEntry.id, calcPeriodYM(lastOrgEntry.date, end));
        }
        lastOrgEntry = entry;
      }

      if (isPosChange && isSameOrg(entry._inheritedOrgLevels, currentOrgLevels)) {
        if (lastPosEntry && lastPosEntry.date) {
          posDurMap.set(lastPosEntry.id, calcPeriodYM(lastPosEntry.date, entry.date || entry.endDate));
        }
        lastPosEntry = entry;
      }
    }
  });

  if (lastOrgEntry && lastOrgEntry.date) {
    const end = (lastOrgEntry.kind === 'secondment' && lastOrgEntry.endDate) ? lastOrgEntry.endDate : periodEndStr;
    orgDurMap.set(lastOrgEntry.id, calcPeriodYM(lastOrgEntry.date, end));
  }
  if (lastPosEntry && lastPosEntry.date) {
    posDurMap.set(lastPosEntry.id, calcPeriodYM(lastPosEntry.date, periodEndStr));
  }

  // 2. 状態トラッキングと線の色数の計算（常に昇順でシミュレーション）
  let ascEntries = [...entries].sort((a, b) => {
    const cmp = (a.date || '').localeCompare(b.date || '');
    return cmp !== 0 ? cmp : a._origIdx - b._origIdx;
  });

  // 状態の初期化
  // 常に青線(主務)をベースとする
  let currentState = { 
    primaryColor: 'var(--c-primary)',
    positionColor: null,
    eventColors: [], // 出向、駐在、兼務 などの追加線
    leaveColor: null 
  };

  ascEntries.forEach(entry => {
    if (entry._kind === 'transfer') {
      if (entry.kind === 'endAssignment') {
        currentState.primaryColor = null;
        currentState.positionColor = null;
        currentState.eventColors = [];
      } else {
        if (!currentState.primaryColor) {
           currentState.primaryColor = 'var(--c-primary)';
        }

        if (entry.kind === 'concurrent') {
          const kDef = TRANSFER_KINDS.concurrent;
          currentState.eventColors.push({ id: entry.id, color: kDef ? kDef.dotCss : '#059669' });
        } else if (entry.kind === 'secondment' || entry.kind === 'stationed') {
          const kDef = TRANSFER_KINDS[entry.kind];
          currentState.eventColors.push({ id: entry.id, color: kDef ? kDef.dotCss : '#0891B2' });
          if (entry.position !== undefined && entry.position !== null) {
            currentState.positionColor = entry.position === '' ? null : '#D97706';
          }
        } else if (entry.kind === 'removePosition') {
          currentState.positionColor = null;
        } else {
          // assignment, transfer, positionChange
          if (entry.position !== undefined && entry.position !== null) {
            currentState.positionColor = entry.position === '' ? null : '#D97706';
          }
        }
      }
    } else if (entry._kind === 'transfer_end') {
      currentState.eventColors = currentState.eventColors.filter(e => e.id !== entry.id);
    } else if (entry._kind === 'leave') {
      currentState.leaveColor = '#F59E0B'; // 休職・休業のアクティブ色
    } else if (entry._kind === 'leave_end') {
      currentState.leaveColor = null;
    }
    
    // 現在の線色配列を構築（主務＋役職＋兼務等の追加線＋休職）
    let colors = [];
    if (currentState.primaryColor) colors.push(currentState.primaryColor);
    if (currentState.positionColor) colors.push(currentState.positionColor);
    currentState.eventColors.forEach(ec => colors.push(ec.color));
    if (currentState.leaveColor) colors.push(currentState.leaveColor);
    
    // 全てクリアされた場合も1本は表示して繋ぐ
    if (colors.length === 0) colors.push('var(--c-primary)');

    entry._lineColors = [...colors];
  });

  // 3. 同一日付でグループ化
  const grouped = [];
  ascEntries.forEach(entry => {
    const sortDate = entry._sortDate || '';
    let displayDateStr = '';
    if (entry._kind === 'transfer_end' || entry._kind === 'leave_end') {
      displayDateStr = entry.date ? entry.date.replace(/-/g, '/') : '';
    } else {
      if (entry.date) {
        displayDateStr = entry.date.replace(/-/g, '/');
      } else if (entry.endDate) {
        displayDateStr = `〜 ${entry.endDate.replace(/-/g, '/')}`;
      } else {
        displayDateStr = '時期不明';
      }
    }

    if (grouped.length > 0 && grouped[grouped.length - 1].sortDate === sortDate && grouped[grouped.length - 1].displayDateStr === displayDateStr) {
      grouped[grouped.length - 1].items.push(entry);
      grouped[grouped.length - 1].lineColors = entry._lineColors; // グループの最終状態
    } else {
      grouped.push({ sortDate, displayDateStr, items: [entry], lineColors: entry._lineColors });
    }
  });

  const sortedGroups = sortDir === 'asc' ? [...grouped] : [...grouped].reverse();
  const frag = document.createDocumentFragment();

  let currentStatusBadge = '';
  if (empId) {
    const empData = DB.employees.find(e => e.id === empId);
    if (empData && empData.status) {
      const stColor = getFlatMasterColor('status', empData.status);
      let stStyle = '';
      if (stColor) {
        const txtColor = darkenForSolid(stColor, 40);
        stStyle = `background:${lighten(stColor)};color:${txtColor};border:1px solid ${stColor};`;
      } else {
        stStyle = `background:var(--c-surface-2);color:var(--c-text-2);border:1px solid var(--c-border);`;
      }
      currentStatusBadge = `<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:99px;margin-left:6px;${stStyle}">${empData.status}</span>`;
    }
  } else {
    // 新規登録中などで empId が無い場合、フォームの選択状態から取得
    const activePill = document.querySelector('#f-status-group .rpill input:checked');
    if (activePill && activePill.value) {
      const stColor = getFlatMasterColor('status', activePill.value);
      let stStyle = '';
      if (stColor) {
        const txtColor = darkenForSolid(stColor, 40);
        stStyle = `background:${lighten(stColor)};color:${txtColor};border:1px solid ${stColor};`;
      } else {
        stStyle = `background:var(--c-surface-2);color:var(--c-text-2);border:1px solid var(--c-border);`;
      }
      currentStatusBadge = `<span style="font-size:10px;font-weight:700;padding:1px 6px;border-radius:99px;margin-left:6px;${stStyle}">${activePill.value}</span>`;
    }
  }

  const currentItemHtml = `
    <div class="transfer-header">
      <div class="transfer-dot-wrap">
        <div class="transfer-dot" style="background:var(--c-surface);box-shadow:0 0 0 2px var(--c-primary);border:none;"></div>
      </div>
      <div class="transfer-date-row" style="margin-bottom:0;align-items:center;">
        <span class="transfer-date" style="color:var(--c-text-2)">${periodEndStr ? periodEndStr.replace(/-/g, '/') + ' (退職)' : '現在'}</span>
        ${currentStatusBadge}
      </div>
    </div>
    <div class="transfer-content">
      <div class="transfer-lines-wrap">
        <div class="transfer-line"></div>
      </div>
      <div class="transfer-group-events"></div>
    </div>
  `;

  if (sortDir === 'desc') {
    const cur = document.createElement('div');
    cur.className = 'transfer-item tr-kind-current transfer-group-item';
    cur.innerHTML = currentItemHtml;
    frag.appendChild(cur);
  }

  sortedGroups.forEach((group, gIdx) => {
    const item = document.createElement('div');
    item.className = 'transfer-item transfer-group-item';

    // 代表ドットの色決定（優先度：通常異動 > 休業 > 終了系）
    let primaryItem = group.items.find(i => i._kind === 'transfer' && !['removePosition', 'endAssignment'].includes(i.kind)) 
                   || group.items.find(i => i._kind === 'leave')
                   || group.items[0];
    
    let dotColor = '#94A3B8';
    let borderColor = 'transparent';
    if (primaryItem._kind === 'transfer') {
      const kDef = TRANSFER_KINDS[primaryItem.kind] || TRANSFER_KINDS.assignment;
      dotColor = kDef.dotCss;
      borderColor = kDef.borderCss;
    } else if (primaryItem._kind === 'leave') {
      dotColor = '#F59E0B';
      borderColor = '#FCD34D';
    }

    item.style.borderLeftColor = 'transparent';

    // ヘッダー部（ドットと日付）
    const headerWrap = document.createElement('div');
    headerWrap.className = 'transfer-header';

    const dotWrap = document.createElement('div');
    dotWrap.className = 'transfer-dot-wrap';
    const dot = document.createElement('div');
    dot.className = 'transfer-dot';
    dot.style.background = dotColor;
    dot.style.boxShadow  = `0 0 0 2px ${dotColor}`;
    dotWrap.appendChild(dot);

    const dateRow = document.createElement('div'); 
    dateRow.className = 'transfer-date-row';
    const dateEl  = document.createElement('span');
    dateEl.className = 'transfer-date';
    dateEl.style.color = dotColor;
    dateEl.textContent = group.displayDateStr;
    dateRow.appendChild(dateEl);

    headerWrap.appendChild(dotWrap);
    headerWrap.appendChild(dateRow);

    // コンテンツ部（線とイベント群）
    const contentWrap = document.createElement('div');
    contentWrap.className = 'transfer-content';

    const linesWrap = document.createElement('div');
    linesWrap.className = 'transfer-lines-wrap';
    const lineColors = group.lineColors || ['var(--c-border-d)'];
    lineColors.forEach(color => {
      const line = document.createElement('div');
      line.className = 'transfer-line';
      line.style.background = color;
      linesWrap.appendChild(line);
    });

    const eventsWrap = document.createElement('div');
    eventsWrap.className = 'transfer-group-events';

    group.items.forEach(entry => {
      const evBlock = document.createElement('div');
      evBlock.className = 'transfer-ev-block';
      if (primaryItem === entry && borderColor !== 'transparent') {
        evBlock.style.borderLeft = `2px solid ${borderColor}`;
      }

      // すべてのバッジを格納して横並びにするラッパー
      const evBadgesWrap = document.createElement('div');
      evBadgesWrap.className = 'transfer-ev-badges';

      if (entry._kind === 'transfer_end') {
        const kind = entry.kind;
        const kDef = TRANSFER_KINDS[kind] || TRANSFER_KINDS.assignment;
        const kBadge = document.createElement('span');
        kBadge.className = 'tr-kind-badge';
        kBadge.style.background = '#F1F5F9';
        kBadge.style.color      = '#475569';
        const lbl = kind === 'concurrent' ? '兼務終了' : kind === 'stationed' ? '駐在終了（帰任）' : '出向終了（帰任）';
        kBadge.innerHTML = `<i class="fa-solid fa-flag-checkered"></i>${lbl}`;
        evBadgesWrap.appendChild(kBadge);
        if (evBadgesWrap.children.length > 0) dateRow.appendChild(evBadgesWrap);
        
        const orgEl = document.createElement('div'); orgEl.className = 'transfer-org';
        const orgVals = entry._inheritedOrgLevels || (entry.orgLevels || []);
        const orgText = kind === 'stationed'
          ? (entry.workLocation ? `勤務地: ${entry.workLocation}` : '駐在先') + ' からの帰任'
          : (orgVals.length ? orgVals.join(' › ') : '組織情報なし') + ` での${kDef.label}が終了`;
        orgEl.innerHTML = `<span style="color:var(--c-text-3);font-size:12px;">${orgText}</span>`;
        evBlock.appendChild(orgEl);

      } else if (entry._kind === 'leave_end') {
        const typeDef = LEAVE_TYPES[entry.type] || LEAVE_TYPES.other;
        const kBadge = document.createElement('span');
        kBadge.className = 'tr-kind-badge';
        kBadge.style.background = '#F1F5F9';
        kBadge.style.color      = '#475569';
        kBadge.innerHTML = `<i class="fa-solid fa-flag-checkered"></i>${typeDef.label} 終了 (復職)`;
        evBadgesWrap.appendChild(kBadge);
        if (evBadgesWrap.children.length > 0) dateRow.appendChild(evBadgesWrap);

      } else if (entry._kind === 'transfer') {
        const kind  = entry.kind || 'assignment';
        const kDef  = TRANSFER_KINDS[kind] || TRANSFER_KINDS.assignment;
        
        if (kind !== 'assignment') {
          const kBadge = document.createElement('span');
          kBadge.className = 'tr-kind-badge';
          kBadge.style.background = kDef.badgeBg;
          kBadge.style.color      = kDef.badgeFg;
          kBadge.innerHTML = `<i class="${kDef.icon}"></i>${kDef.label}`;
          evBadgesWrap.appendChild(kBadge);
        }

        if (entry.position && kind !== 'endAssignment') {
          const posBadge = document.createElement('span');
          if (kind === 'removePosition') {
            posBadge.className = 'badge b-remove-position';
            posBadge.innerHTML = `<i class="fa-solid fa-user-minus"></i>${entry.position}`;
          } else {
            posBadge.className = 'badge b-position';
            posBadge.innerHTML = `<i class="fa-solid fa-user-tie"></i>${entry.position}`;
          }
          evBadgesWrap.appendChild(posBadge);
        }

        const orgYm = orgDurMap.get(entry.id);
        const posYm = posDurMap.get(entry.id);
        
        if (orgYm) {
          const isActive = (lastOrgEntry && lastOrgEntry.id === entry.id && periodEndStr === null) && !(kind === 'secondment' && entry.endDate);
          const durSpan = document.createElement('span');
          durSpan.className = 'transfer-duration' + (isActive ? ' is-current' : '');
          if (kind === 'secondment' && !entry.endDate) durSpan.className += ' is-secondment';
          durSpan.innerHTML = `<i class="fa-regular fa-clock"></i> 組織: ${formatPeriodStr(orgYm) || '─'}`;
          evBadgesWrap.appendChild(durSpan);
        }

        if ((kind === 'secondment' || kind === 'concurrent' || kind === 'stationed') && !entry.endDate) {
          const onBadge = document.createElement('span');
          onBadge.className = 'leave-ongoing-badge';
          onBadge.style.cssText = `background:${kDef.badgeBg};color:${kDef.badgeFg};border-color:${kDef.borderCss}`;
          onBadge.textContent = kind === 'concurrent' ? '兼務中' : kind === 'stationed' ? '駐在中' : '出向中';
          evBadgesWrap.appendChild(onBadge);
        }
        
        if (entry.position && posYm) {
          const isActivePos = (lastPosEntry && lastPosEntry.id === entry.id && periodEndStr === null);
          const posDurSpan = document.createElement('span');
          posDurSpan.className = 'transfer-duration pos-duration' + (isActivePos ? ' is-current' : '');
          posDurSpan.innerHTML = `<i class="fa-solid fa-user-tie" style="font-size:9px"></i> 役職: ${formatPeriodStr(posYm) || '─'}`;
          evBadgesWrap.appendChild(posDurSpan);
        }
        
        if (evBadgesWrap.children.length > 0) dateRow.appendChild(evBadgesWrap);

        if (kind !== 'removePosition') {
          const orgEl  = document.createElement('div'); orgEl.className = 'transfer-org';
          if (kind === 'stationed') {
            const orgVals = entry._inheritedOrgLevels || [];
            if (orgVals.length) {
              orgEl.innerHTML = `<span style="color:var(--c-text-3);font-size:11px;">所属: ${orgVals.join(' › ')}（変更なし）</span>`;
            }
          } else {
            const orgVals = entry._inheritedOrgLevels || [];
            if (orgVals.length) {
              const rootNode   = findCompanyRoot(orgVals[0]);
              const compLevels = getCompanyLevels(rootNode);
              orgVals.forEach((p, i) => {
                const span = document.createElement('span'); span.className = 'transfer-org-part'; span.textContent = p;
                if (i === 0) span.title = '会社';
                else if (compLevels[i - 1]) span.title = compLevels[i - 1].label;
                orgEl.appendChild(span);
                if (i < orgVals.length - 1) {
                  const sep = document.createElement('span'); sep.className = 'transfer-org-sep';
                  sep.innerHTML = '<i class="fa-solid fa-chevron-right"></i>'; orgEl.appendChild(sep);
                }
              });
            } else if (kind !== 'endAssignment') {
              orgEl.textContent = '（組織情報なし）'; orgEl.style.color = 'var(--c-text-3)';
            }
          }
          evBlock.appendChild(orgEl);
        }

        if (entry.note) { const n = document.createElement('div'); n.className = 'transfer-note'; n.textContent = entry.note; evBlock.appendChild(n); }
        if (kind === 'stationed' && entry.workLocation) {
          const wlEl = document.createElement('div'); wlEl.className = 'transfer-note'; wlEl.style.cssText = 'display:flex;align-items:center;gap:4px;';
          wlEl.innerHTML = `<i class="fa-solid fa-location-dot" style="color:#0D9488;font-size:11px;flex-shrink:0;"></i><span>${entry.workLocation}</span>`;
          evBlock.appendChild(wlEl);
        }
      } else {
        // leave
        const typeDef = LEAVE_TYPES[entry.type] || LEAVE_TYPES.other;
        const typeBadge = document.createElement('span'); typeBadge.className = 'leave-type-badge';
        typeBadge.innerHTML = `<i class="${typeDef.icon}"></i>${typeDef.label}`;
        typeBadge.style.background = lighten(typeDef.color); typeBadge.style.color = typeDef.color;
        evBadgesWrap.appendChild(typeBadge);

        const lym = calcPeriodYM(entry.start, entry.end || new Date());
        if (lym) {
          const durSpan = document.createElement('span'); durSpan.className = 'transfer-duration leave-duration' + (!entry.end ? ' is-ongoing' : '');
          durSpan.innerHTML = `<i class="fa-regular fa-clock"></i> ${formatPeriodStr(lym) || '─'}`; 
          evBadgesWrap.appendChild(durSpan);
        }
        if (!entry.end) {
          const ongoingBadge = document.createElement('span'); ongoingBadge.className = 'leave-ongoing-badge'; ongoingBadge.textContent = '継続中'; 
          evBadgesWrap.appendChild(ongoingBadge);
        }
        if (evBadgesWrap.children.length > 0) dateRow.appendChild(evBadgesWrap);
        
        if (entry.note) { const n = document.createElement('div'); n.className = 'transfer-note'; n.textContent = entry.note; evBlock.appendChild(n); }
      }

      // 個別イベントへのD&D設定
      if (isEditable && (entry._kind === 'transfer' || entry._kind === 'leave')) {
        evBlock.draggable = true;
        evBlock.dataset.trId = entry.id;
        evBlock.dataset.sortDate = entry._sortDate;
        evBlock.addEventListener('dragstart', (e) => {
          if (e.target.closest('button, input, select')) { e.preventDefault(); return; }
          e.dataTransfer.setData('text/plain', entry.id);
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => evBlock.classList.add('is-dragging'), 0);
        });
        evBlock.addEventListener('dragend', () => {
          evBlock.classList.remove('is-dragging');
          document.querySelectorAll('.transfer-ev-block').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        });
        evBlock.addEventListener('dragover', (e) => {
          e.preventDefault(); e.dataTransfer.dropEffect = 'move';
          const draggingId = document.querySelector('.transfer-ev-block.is-dragging')?.dataset.trId;
          if (draggingId === entry.id) return;
          const draggingDate = document.querySelector('.transfer-ev-block.is-dragging')?.dataset.sortDate;
          if (draggingDate !== entry._sortDate) return;
          const rect = evBlock.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          evBlock.classList.remove('drag-over-top', 'drag-over-bottom');
          if (e.clientY < midY) evBlock.classList.add('drag-over-top');
          else evBlock.classList.add('drag-over-bottom');
        });
        evBlock.title = 'ドラッグで並び替え / ダブルクリックで編集';
        evBlock.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          if (empId) {
            openEmpModal(empId);
            switchEmpModalTab('emp-pane-transfer');
            setTimeout(() => entry._kind === 'transfer' ? openTransferEdit(entry.id) : openLeaveEdit(entry.id), 100);
          } else {
            entry._kind === 'transfer' ? openTransferEdit(entry.id) : openLeaveEdit(entry.id);
          }
        });
        evBlock.addEventListener('dragleave', () => evBlock.classList.remove('drag-over-top', 'drag-over-bottom'));
        evBlock.addEventListener('drop', (e) => {
          e.preventDefault(); evBlock.classList.remove('drag-over-top', 'drag-over-bottom');
          const draggingId = e.dataTransfer.getData('text/plain');
          if (draggingId === entry.id) return;
          const draggingDate = document.querySelector('.transfer-ev-block.is-dragging')?.dataset.sortDate;
          if (draggingDate !== entry._sortDate) { toast('並び替えは同一グループ内の項目間でのみ可能です'); return; }
          const rect = evBlock.getBoundingClientRect();
          const insertBeforeVisual = e.clientY < (rect.top + rect.height / 2);
          const insertBeforeLogic = sortDir === 'asc' ? insertBeforeVisual : !insertBeforeVisual;
          
          if (empId) {
            const emp = DB.employees.find(e => e.id === empId);
            if (emp && emp.transfers) {
              const dragIdx = emp.transfers.findIndex(t => t.id === draggingId);
              const dropIdx = emp.transfers.findIndex(t => t.id === entry.id);
              if (dragIdx >= 0 && dropIdx >= 0) {
                const [dragItem] = emp.transfers.splice(dragIdx, 1);
                const newDropIdx = emp.transfers.findIndex(t => t.id === entry.id);
                const insertIdx = insertBeforeLogic ? newDropIdx : newDropIdx + 1;
                emp.transfers.splice(insertIdx, 0, dragItem);
                saveDB();
                if (typeof renderCompareModal === 'function') renderCompareModal();
              }
            }
          } else {
            reorderTransfers(draggingId, entry.id, insertBeforeLogic);
          }
        });
      }

      eventsWrap.appendChild(evBlock);
    });

    contentWrap.appendChild(linesWrap);
    contentWrap.appendChild(eventsWrap);
    
    item.appendChild(headerWrap);
    item.appendChild(contentWrap);

    // グループ全体に対するアクションメニュー
    if (isEditable) {
      const editableItems = group.items.filter(i => i._kind === 'transfer' || i._kind === 'leave');
      if (editableItems.length > 0) {
        const acts = document.createElement('div'); 
        acts.className = 'transfer-acts transfer-acts-group';
        
        if (editableItems.length === 1) {
          const entry = editableItems[0];
          const btnE = document.createElement('button'); btnE.type = 'button'; btnE.className = 'btn btn-ghost btn-icon-sm'; btnE.title = '編集'; btnE.innerHTML = '<i class="fa-solid fa-pen"></i>';
          btnE.addEventListener('click', () => {
            if (empId) {
              openEmpModal(empId);
              switchEmpModalTab('emp-pane-transfer');
              setTimeout(() => entry._kind === 'transfer' ? openTransferEdit(entry.id) : openLeaveEdit(entry.id), 100);
            } else {
              entry._kind === 'transfer' ? openTransferEdit(entry.id) : openLeaveEdit(entry.id);
            }
          });
          const btnD = document.createElement('button'); btnD.type = 'button'; btnD.className = 'btn btn-ghost btn-icon-sm'; btnD.title = '削除'; btnD.style.color = 'var(--c-danger)'; btnD.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
          btnD.addEventListener('click', () => { 
            if (empId) {
              const emp = DB.employees.find(e => e.id === empId);
              if (emp) {
                if (entry._kind === 'transfer') emp.transfers = (emp.transfers || []).filter(t => t.id !== entry.id);
                else emp.leaves = (emp.leaves || []).filter(l => l.id !== entry.id);
                saveDB();
                if (typeof renderCompareModal === 'function') renderCompareModal();
              }
            } else {
              if (entry._kind === 'transfer') empTransfers = empTransfers.filter(t => t.id !== entry.id); 
              else empLeaves = empLeaves.filter(l => l.id !== entry.id); 
              renderTransferTimeline(); 
              updateTransferTabBadge(); 
            }
          });
          acts.append(btnE, btnD);
        } else {
          // 複数ある場合はドロップダウンボタンで選択
          const menuBtn = document.createElement('button');
          menuBtn.type = 'button';
          menuBtn.className = 'btn btn-ghost btn-icon-sm';
          menuBtn.title = '編集する履歴を選択';
          menuBtn.innerHTML = '<i class="fa-solid fa-list-check"></i> <i class="fa-solid fa-caret-down" style="font-size:9px;margin-left:2px;"></i>';
          
          const menuWrap = document.createElement('div');
          menuWrap.className = 'transfer-group-menu';
          
          editableItems.forEach(entry => {
            const row = document.createElement('div');
            row.className = 'tgm-row';
            
            const kDef = entry._kind === 'transfer' ? (TRANSFER_KINDS[entry.kind] || TRANSFER_KINDS.assignment) : (LEAVE_TYPES[entry.type] || LEAVE_TYPES.other);
            const title = entry._kind === 'transfer' 
               ? `${kDef.label}：${entry.position || ''} ${entry.orgLevels ? entry.orgLevels.join('›') : ''}`
               : `${kDef.label}：${entry.note || ''}`;

            row.innerHTML = `<span class="tgm-title" title="${title}">${title}</span>`;
            
            const eBtn = document.createElement('button'); eBtn.innerHTML = '<i class="fa-solid fa-pen"></i>'; eBtn.className = 'tgm-btn';
            eBtn.onclick = (e) => {
              e.stopPropagation();
              if (empId) {
                openEmpModal(empId); switchEmpModalTab('emp-pane-transfer');
                setTimeout(() => entry._kind === 'transfer' ? openTransferEdit(entry.id) : openLeaveEdit(entry.id), 100);
              } else {
                entry._kind === 'transfer' ? openTransferEdit(entry.id) : openLeaveEdit(entry.id);
              }
            };
            
            const dBtn = document.createElement('button'); dBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>'; dBtn.className = 'tgm-btn tgm-btn-danger';
            dBtn.onclick = (e) => {
              e.stopPropagation();
              if (empId) {
                const emp = DB.employees.find(x => x.id === empId);
                if (emp) {
                  if (entry._kind === 'transfer') emp.transfers = (emp.transfers || []).filter(t => t.id !== entry.id);
                  else emp.leaves = (emp.leaves || []).filter(l => l.id !== entry.id);
                  saveDB();
                  if (typeof renderCompareModal === 'function') renderCompareModal();
                }
              } else {
                if (entry._kind === 'transfer') empTransfers = empTransfers.filter(t => t.id !== entry.id); 
                else empLeaves = empLeaves.filter(l => l.id !== entry.id); 
                renderTransferTimeline(); 
                updateTransferTabBadge(); 
              }
            };
            
            row.append(eBtn, dBtn);
            menuWrap.appendChild(row);
          });
          
          acts.appendChild(menuBtn);
          acts.appendChild(menuWrap);
        }
        dateRow.appendChild(acts);
      }
    }

    frag.appendChild(item);
  });

  if (sortDir === 'asc') {
    const cur = document.createElement('div');
    cur.className = 'transfer-item tr-kind-current transfer-group-item';
    cur.innerHTML = currentItemHtml;
    frag.appendChild(cur);
  }
  container.appendChild(frag);
}

function renderTransferTimeline() {
  const timeline = document.getElementById('transfer-timeline');
  const empty    = document.getElementById('transfer-empty');
  if (!timeline) return;
  const entries = buildTimelineEntries(empTransfers, empLeaves);
  if (!entries.length) { timeline.innerHTML = ''; if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';

  const resignRaw  = document.getElementById('f-resign')?.value.trim() || '';
  const resignDate = normalizeHireDate(resignRaw) || null;
  const statusPill = document.querySelector('#f-status-group .rpill input:checked');
  const isRetired  = statusPill?.value === '退職';
  const periodEnd  = isRetired && resignDate ? resignDate : null;

  renderTimelineToContainer(timeline, entries, transferSortDir, true, periodEnd, empTransfers);
}

function reorderTransfers(dragId, dropId, insertBeforeLogic) {
  const dragIdx = empTransfers.findIndex(t => t.id === dragId);
  const dropIdx = empTransfers.findIndex(t => t.id === dropId);
  if (dragIdx < 0 || dropIdx < 0) return;
  
  const [dragItem] = empTransfers.splice(dragIdx, 1);
  const newDropIdx = empTransfers.findIndex(t => t.id === dropId);
  const insertIdx = insertBeforeLogic ? newDropIdx : newDropIdx + 1;
  
  empTransfers.splice(insertIdx, 0, dragItem);
  renderTransferTimeline();
  markEmpDirty?.();
}

function openTransferEdit(trId = null) {
  const wrap = document.getElementById('history-entry-wrap');
  if (wrap) wrap.style.display = '';

  const tr   = trId ? empTransfers.find(t => t.id === trId) : null;
  const kind = tr?.kind || 'assignment';

  document.getElementById('te-id').value       = trId || '';
  document.getElementById('te-kind').value     = kind;
  document.getElementById('te-date').value     = tr?.date    || '';
  document.getElementById('te-end-date').value = tr?.endDate || '';
  document.getElementById('te-note').value     = tr?.note    || '';
  const wlInp = document.getElementById('te-work-location');
  if (wlInp) wlInp.value = tr?.workLocation || '';
  const orgLevels = tr ? getTransferOrgLevels(tr) :[];
  buildTransferOrgFields(orgLevels);
  document.getElementById('te-position').value = tr?.position || '';

  _syncTrKindUI(kind, trId ? 'edit' : 'add');

  let mode = 'start';
  if (!tr?.date && tr?.endDate) mode = 'end';
  else if (kind === 'removePosition' || kind === 'endAssignment') mode = 'end';
  else mode = 'start';
  
  setTransferDateMode(mode);

  setTimeout(() => {
    const focusTarget = mode === 'end' ? document.getElementById('te-end-date') : document.getElementById('te-date');
    if (focusTarget) focusTarget.focus();
  }, 50);
}

/* 対象の配属先プルダウンを最新状態に更新 */
function updateTargetOrgSelect() {
  const kind = document.getElementById('te-kind')?.value || 'assignment';
  if (kind === 'positionChange' || kind === 'removePosition' || kind === 'endAssignment') {
    const empId = document.getElementById('f-id').value;
    const emp = DB.employees.find(e => e.id === empId) || { transfers: empTransfers }; 
    // 現在編集中のレコードを除外して過去の確定状態をプレビュー
    const previewEmp = { ...emp, transfers: empTransfers.filter(t => t.id !== document.getElementById('te-id').value) };
    
    // 現在の入力モードに応じて正しい日付を取得
    let mode = document.getElementById('te-date-mode-seg')?.dataset.mode || 'start';
    let targetDate = mode === 'start' ? document.getElementById('te-date')?.value : document.getElementById('te-end-date')?.value;
    
    if (!targetDate) targetDate = new Date().toISOString().slice(0, 10);
    _buildTargetOrgSelect(previewEmp, targetDate);
  }
}

/* 種別セグメントUI・動的フィールドの同期 */
function _syncTrKindUI(kind, mode = 'add') {
  document.querySelectorAll('.master-ac-dropdown').forEach(dd => dd.classList.remove('open'));

  document.querySelectorAll('#te-kind-seg .trkind-btn').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.kind === kind);
  });

  const trCard = document.getElementById('transfer-edit-card');
  const leCard = document.getElementById('leave-edit-card');
  const reCard = document.getElementById('resignation-edit-card');

  if (kind === 'leave') {
    if (trCard) trCard.style.display = 'none';
    if (reCard) reCard.style.display = 'none';
    if (leCard) leCard.style.display = '';
    const lbl = document.getElementById('leave-edit-title-lbl');
    if (lbl) lbl.textContent = mode === 'edit' ? '休職・休業を編集' : '休職・休業を追加';
  } else if (kind === 'resignation') {
    if (trCard) trCard.style.display = 'none';
    if (leCard) leCard.style.display = 'none';
    if (reCard) reCard.style.display = '';
  } else {
    if (leCard) leCard.style.display = 'none';
    if (reCard) reCard.style.display = 'none';
    if (trCard) trCard.style.display = '';
    
    const def = TRANSFER_KINDS[kind] || TRANSFER_KINDS.assignment;
    const hiddenKind = document.getElementById('te-kind');
    if (hiddenKind) hiddenKind.value = kind;

    const lbl = document.getElementById('transfer-edit-title-lbl');
    if (lbl) lbl.textContent = mode === 'edit' ? `${def.label}を編集` : `${def.label}を追加`;

    const hint = document.getElementById('te-kind-hint');
    if (hint) hint.textContent = def.hint;

    const hideOrg = kind === 'positionChange' || kind === 'removePosition' || kind === 'endAssignment' || kind === 'stationed';
    const orgRow = document.getElementById('te-org-row');
    const targetRow = document.getElementById('te-target-org-row');
    const workLocRow = document.getElementById('te-work-location-row');
    const workLocInp = document.getElementById('te-work-location');
    
    if (orgRow) orgRow.style.display = hideOrg ? 'none' : '';
    const showTarget = kind === 'positionChange' || kind === 'removePosition' || kind === 'endAssignment';
    if (targetRow) targetRow.style.display = showTarget ? '' : 'none';
    if (workLocRow) workLocRow.style.display = kind === 'stationed' ? '' : 'none';
    if (kind !== 'stationed' && workLocInp) workLocInp.value = '';

    if (showTarget) {
      updateTargetOrgSelect();
    }

    const compLbl = orgRow?.querySelector('.flbl');
    if (compLbl) {
      if (kind === 'concurrent') {
        compLbl.innerHTML = '兼務先組織<span class="opt">（任意）</span>';
      } else {
        compLbl.innerHTML = '所属組織（会社マスタから選択）<span class="opt">（任意）</span>';
      }
    }

    const posWrap = document.getElementById('te-position-wrap');
    const posFg   = posWrap?.closest('.fg');
    const posLbl  = posFg?.querySelector('.flbl');
    if (posFg) posFg.style.display = kind === 'endAssignment' ? 'none' : '';
    if (posLbl) {
      if (kind === 'removePosition') {
        posLbl.innerHTML = '解除される役職<span class="opt">（任意）</span>';
      } else if (kind === 'concurrent') {
        posLbl.innerHTML = '兼務役職<span class="opt">（任意）</span>';
      } else {
        posLbl.innerHTML = '役職<span class="opt">（任意）</span>';
      }
    }

    if (trCard) trCard.dataset.kind = kind;
  }
}

function setTransferDateMode(mode) {
  const seg = document.getElementById('te-date-mode-seg');
  if (!seg) return;
  seg.dataset.mode = mode;
  seg.querySelectorAll('.bmt-btn').forEach(b => b.classList.toggle('is-active', b.dataset.mode === mode));
  
  const wStart = document.getElementById('te-start-wrap');
  const wEnd   = document.getElementById('te-end-date-wrap');
  const hint   = document.getElementById('te-date-hint');
  
  if (mode === 'start') {
    if (wStart) wStart.style.display = '';
    if (wEnd)   wEnd.style.display = 'none';
    if (hint)   hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> 次の履歴の開始日で自動的に終了とみなされます';
  } else {
    // end mode
    if (wStart) wStart.style.display = 'none';
    if (wEnd)   wEnd.style.display = '';
    if (hint)   hint.innerHTML = '<i class="fa-solid fa-circle-info"></i> 開始日が不明で、終了日のみを記録したい場合に使用します';
  }
  
  // モード切替時に新しい対象日ベースで配属先を再計算
  updateTargetOrgSelect();
}

function closeTransferEdit() { 
  const wrap = document.getElementById('history-entry-wrap');
  if (wrap) wrap.style.display = 'none';
}

/* ================================================================
   RESIGNATION (退職) EDIT
================================================================ */
function openResignationEdit() {
  const wrap = document.getElementById('history-entry-wrap');
  if (wrap) wrap.style.display = '';
  
  document.getElementById('re-date').value = document.getElementById('f-resign').value || new Date().toISOString().slice(0, 10);
  document.getElementById('re-rejoin-date').value = '';
  
  _syncTrKindUI('resignation');
  setTimeout(() => document.getElementById('re-date').focus(), 50);
}

function closeResignationEdit() {
  closeTransferEdit();
}

function saveResignationEdit() {
  const rawDate = document.getElementById('re-date').value.trim();
  const date = rawDate ? (normalizeHireDate(rawDate) || rawDate) : '';
  
  const rawRejoin = document.getElementById('re-rejoin-date').value.trim();
  const rejoinDate = rawRejoin ? (normalizeHireDate(rawRejoin) || rawRejoin) : '';
  
  if (!date) {
    const inp = document.getElementById('re-date');
    inp.style.borderColor = 'var(--c-danger)';
    setTimeout(() => inp.style.borderColor = '', 1500);
    toast('退職日を入力してください');
    return false;
  }
  if (rawDate && !normalizeHireDate(rawDate)) {
    toast('退職日の形式が正しくありません');
    return false;
  }
  if (rawRejoin && !normalizeHireDate(rawRejoin)) {
    toast('再入社日の形式が正しくありません');
    return false;
  }

  if (rejoinDate) {
    if (rejoinDate <= date) {
      toast('再入社日は退職日より後の日付にしてください');
      return false;
    }
    // 再入社処理
    document.getElementById('f-resign').value = '';
    
    const statusGroup = document.getElementById('f-status-group');
    const activeRadio = statusGroup.querySelector('input[value="在籍"]');
    if (activeRadio) activeRadio.checked = true;
    
    const hireTypeGroup = document.getElementById('f-hiretype-group');
    const midcarRadio = hireTypeGroup.querySelector('input[value="中途"]');
    if (midcarRadio) midcarRadio.checked = true;

    // 離籍期間として休職・休業（その他・離籍）枠に保存
    empLeaves.push({
      id: uid(),
      type: 'resignation',
      start: date,
      end: rejoinDate,
      note: '退職〜再入社による離籍期間'
    });
    
    _updateResignDateVisibility('在籍');
    toast('再入社として処理しました（離籍期間を追加・区分を中途に変更）');
  } else {
    // 通常の退職処理
    document.getElementById('f-resign').value = date;
    const statusGroup = document.getElementById('f-status-group');
    const retiredRadio = statusGroup.querySelector('input[value="退職"]');
    if (retiredRadio) retiredRadio.checked = true;
    _updateResignDateVisibility('退職');
    toast('退職日を設定し、在籍状況を退職に変更しました');
  }
  
  closeResignationEdit();
  renderTransferTimeline();
  updateTransferTabBadge();
  markEmpDirty?.();
  
  return true;
}

/* ================================================================
   LEAVE (休職・休業) EDIT
================================================================ */
function openLeaveEdit(leId = null) {
  const wrap = document.getElementById('history-entry-wrap');
  if (wrap) wrap.style.display = '';
  
  const le = leId ? empLeaves.find(l => l.id === leId) : null;
  document.getElementById('le-id').value    = leId || '';
  document.getElementById('le-type').value  = le?.type  || 'absence';
  document.getElementById('le-start').value = le?.start || '';
  document.getElementById('le-end').value   = le?.end   || '';
  document.getElementById('le-note').value  = le?.note  || '';
  
  _syncTrKindUI('leave', leId ? 'edit' : 'add');
  setTimeout(() => document.getElementById('le-start').focus(), 50);
}

function closeLeaveEdit() {
  closeTransferEdit();
}

function saveLeaveEdit() {
  const rawStart = document.getElementById('le-start').value.trim();
  const start    = rawStart ? (normalizeHireDate(rawStart) || rawStart) : '';
  if (start) document.getElementById('le-start').value = start;
  const rawEnd = document.getElementById('le-end').value.trim();
  const end    = rawEnd ? (normalizeHireDate(rawEnd) || rawEnd) : '';
  if (rawEnd) document.getElementById('le-end').value = end;
  if (end && start && end < start) {
    const inp = document.getElementById('le-end');
    inp.style.borderColor = 'var(--c-danger)';
    setTimeout(() => inp.style.borderColor = '', 1500);
    toast('終了日は開始日より後の日付を入力してください');
    return false;
  }
  const leId   = document.getElementById('le-id').value;
  const record = {
    id:    leId || uid(),
    type:  document.getElementById('le-type').value,
    start, end,
    note:  document.getElementById('le-note').value.trim(),
  };
  if (leId) {
    const idx = empLeaves.findIndex(l => l.id === leId);
    if (idx >= 0) empLeaves[idx] = record;
  } else {
    empLeaves.push(record);
  }
  closeLeaveEdit();
  renderTransferTimeline();
  updateTransferTabBadge();
  markEmpDirty?.();
  return true;
}

function renderContactList() {
  const list  = document.getElementById('contact-list');
  const empty = document.getElementById('contact-empty');
  if (!list) return;
  list.innerHTML = '';
  if (!empContacts.length) { if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';
  const frag = document.createDocumentFragment();
  empContacts.forEach(ct => {
    const typeDef = CONTACT_TYPES[ct.type] || CONTACT_TYPES.other;
    const item = document.createElement('div'); item.className = 'contact-item';
    const iconEl = document.createElement('div'); iconEl.className = 'contact-type-icon'; iconEl.innerHTML = `<i class="${typeDef.icon}"></i>`;
    const colorMap = { phone:'#3B82F6', mobile:'#06B6D4', email:'#8B5CF6', address:'#10B981', other:'#94A3B8' };
    iconEl.style.background = lighten(colorMap[ct.type] || '#94A3B8', 0.82); iconEl.style.color = colorMap[ct.type] || '#94A3B8';
    const body = document.createElement('div'); body.className = 'contact-body';
    const typeLabel = document.createElement('span'); typeLabel.className = 'contact-type-label'; typeLabel.textContent = ct.label ? `${typeDef.label}・${ct.label}` : typeDef.label;
    const val = document.createElement('span'); val.className = 'contact-value'; val.textContent = ct.value;
    body.append(typeLabel, val);
    const acts = document.createElement('div'); acts.className = 'contact-acts';
    const editBtn = document.createElement('button'); editBtn.type = 'button'; editBtn.className = 'btn btn-ghost btn-icon-sm'; editBtn.title = '編集'; editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
    editBtn.addEventListener('click', () => openContactEdit(ct.id));
    const delBtn = document.createElement('button'); delBtn.type = 'button'; delBtn.className = 'btn btn-ghost btn-icon-sm'; delBtn.style.color = 'var(--c-danger)'; delBtn.title = '削除'; delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
    delBtn.addEventListener('click', () => { empContacts = empContacts.filter(c => c.id !== ct.id); renderContactList(); updateContactsTabBadge(); });
    acts.append(editBtn, delBtn); item.append(iconEl, body, acts); frag.appendChild(item);
  });
  list.appendChild(frag);
}

function openContactEdit(ctId = null) {
  const card = document.getElementById('contact-edit-card');
  const lbl  = document.getElementById('contact-edit-title-lbl');
  const ct   = ctId ? empContacts.find(c => c.id === ctId) : null;
  document.getElementById('ct-id').value    = ctId || '';
  document.getElementById('ct-type').value  = ct?.type  || 'phone';
  document.getElementById('ct-label').value = ct?.label || '';
  document.getElementById('ct-value').value = ct?.value || '';
  lbl.textContent = ctId ? '連絡先を編集' : '連絡先を追加';
  _updateContactValueField();
  card.style.display = '';
  document.getElementById('ct-value').focus();
}
function closeContactEdit() { document.getElementById('contact-edit-card').style.display = 'none'; }
function saveContactEdit() {
  const value = document.getElementById('ct-value').value.trim();
  if (!value) { showValErr('ct-value', '値を入力してください'); return false; }
  const ctId = document.getElementById('ct-id').value;
  const record = { id: ctId || uid(), type: document.getElementById('ct-type').value, label: document.getElementById('ct-label').value.trim(), value };
  if (ctId) { const idx = empContacts.findIndex(c => c.id === ctId); if (idx >= 0) empContacts[idx] = record; }
  else       { empContacts.push(record); }
  closeContactEdit(); renderContactList(); updateContactsTabBadge();
  return true;
}
function _updateContactValueField() {
  const type = document.getElementById('ct-type')?.value || 'phone';
  const def  = CONTACT_TYPES[type] || CONTACT_TYPES.other;
  const inp  = document.getElementById('ct-value');
  const lbl  = document.getElementById('ct-value-lbl');
  if (inp) {
    inp.placeholder = def.placeholder;
    inp.inputMode   = def.inputMode;
    inp.dataset.ctType = type;
  }
  if (lbl) lbl.innerHTML = `${def.label}<span class="req">*</span>`;
  const geoSt = document.getElementById('ct-geo-status');
  if (geoSt) { geoSt.style.display = 'none'; geoSt.className = 'geo-status'; }
}

function saveTransferEdit() {
  const mode = document.getElementById('te-date-mode-seg')?.dataset.mode || 'start';
  
  let rawDate = document.getElementById('te-date').value.trim();
  let rawEndDate = document.getElementById('te-end-date').value.trim();
  
  // モードに表示されていないフィールドは保存対象外として空にする
  if (mode === 'start') rawEndDate = '';
  if (mode === 'end') rawDate = '';

  if (!rawDate && !rawEndDate) {
    const targetId = mode === 'end' ? 'te-end-date' : 'te-date';
    const inp = document.getElementById(targetId);
    if (inp) { inp.style.borderColor = 'var(--c-danger)'; setTimeout(() => inp.style.borderColor = '', 1500); }
    toast('日付を入力してください');
    return false;
  }

  const date    = rawDate ? (normalizeHireDate(rawDate) || rawDate) : '';
  if (date) document.getElementById('te-date').value = date;
  const kind    = document.getElementById('te-kind')?.value || 'assignment';
  const endDate = rawEndDate ? (normalizeHireDate(rawEndDate) || rawEndDate) : '';
  if (endDate) document.getElementById('te-end-date').value = endDate;

  if (endDate && date && endDate < date) {
    const inp = document.getElementById('te-end-date');
    inp.style.borderColor = 'var(--c-danger)';
    setTimeout(() => inp.style.borderColor = '', 1500);
    toast('終了日は開始日以降の日付を入力してください');
    return false;
  }
  
  const trId    = document.getElementById('te-id').value;
  const hideOrg = kind === 'positionChange' || kind === 'removePosition' || kind === 'endAssignment' || kind === 'stationed';
  let orgLevels = [];
  
  if (!hideOrg) {
    // rawInput を最優先で使用し、hd.value はフォールバック（エンコード差異・リセット競合を回避）
    const rawInput = document.getElementById('te-company-input').value.trim();
    if (rawInput) {
      const rawParts = rawInput.split(/\s*[＞>]\s*/).map(s => s.trim()).filter(Boolean);
      if (rawParts.length) {
        orgLevels = rawParts;
      } else {
        try { orgLevels = JSON.parse(document.getElementById('te-company-levels').value || '[]'); } catch { orgLevels = []; }
      }
    } else {
      try { orgLevels = JSON.parse(document.getElementById('te-company-levels').value || '[]'); } catch { orgLevels = []; }
    }
    // endAssignment 以外のすべての入力（兼務なども含む）でマスタ登録を連動
    if (orgLevels.length > 0 && kind !== 'endAssignment') {
      try {
        const companyAutoAdded = collectCompanyAutoRegister(orgLevels);
        if (companyAutoAdded.length) {
          saveDB();
          if (currentView === 'masters' && typeof renderMasterView === 'function') renderMasterView();
          const detail = companyAutoAdded.map(s => `  ＋ ${s}`).join('\n');
          toast(`✅ マスタに新規登録しました\n${detail}`);
        }
      } catch (e) {
        toast(`⚠ マスタ登録でエラーが発生しました：${e.message}`);
      }
    }
  } else if (kind !== 'stationed') {
    const targetVal = document.getElementById('te-target-org').value;
    if (targetVal) {
      orgLevels = JSON.parse(targetVal);
    }
  }
  
  const companyName = orgLevels[0] || '';
  if (companyName && kind !== 'endAssignment') {
    const companyNode = (DB.masters.company || []).find(n => n.name === companyName);
    if (companyNode) {
      const checkDate = date || endDate;
      if (checkDate && companyNode.foundedDate && checkDate < companyNode.foundedDate) {
        toast(`「${companyName}」の設立日（${companyNode.foundedDate.replace(/-/g,'/')}）より前の日付は登録できません`);
        const d = date ? document.getElementById('te-date') : document.getElementById('te-end-date'); d.style.borderColor = 'var(--c-danger)'; setTimeout(() => d.style.borderColor = '', 1800); return false;
      }
      if (checkDate && companyNode.dissolvedDate && checkDate > companyNode.dissolvedDate) {
        toast(`「${companyName}」は解散しています（解散日：${companyNode.dissolvedDate.replace(/-/g,'/')}）`);
        const d = date ? document.getElementById('te-date') : document.getElementById('te-end-date'); d.style.borderColor = 'var(--c-danger)'; setTimeout(() => d.style.borderColor = '', 1800); return false;
      }
    }
  }

  const record = {
    id: trId || uid(), kind, date, orgLevels,
    position: document.getElementById('te-position').value.trim(),
    note:     document.getElementById('te-note').value.trim(),
  };
  if (endDate) record.endDate = endDate;
  if (kind === 'stationed') record.workLocation = (document.getElementById('te-work-location')?.value || '').trim();
  if (trId) { const idx = empTransfers.findIndex(t => t.id === trId); if (idx >= 0) empTransfers[idx] = record; }
  else       { empTransfers.push(record); }
  closeTransferEdit(); renderTransferTimeline(); updateTransferTabBadge();
  return true;
}

/* ================================================================
   FLAT MASTER VALUE VALIDATOR
================================================================ */
function validateFlatMasterValue(type, value) {
  if (!value) return true;
  return (DB.masters[type] || []).some(i => i.name === value);
}

/* ================================================================
   RESIGN DATE VISIBILITY
================================================================ */
function _updateResignDateVisibility(status) {
  const fg = document.getElementById('fg-resign-date');
  if (!fg) return;
  // 在籍状況マスタで「退職」に相当するステータスを特定（デフォルト名「退職」）
  const isRetired = status === '退職';
  fg.style.display = isRetired ? '' : 'none';
}

/* ================================================================
   EMPLOYEE MODAL — OPEN
================================================================ */
function openEmpModal(empId = null) {
  const emp = empId ? DB.employees.find(e => e.id === empId) : null;
  document.getElementById('emp-modal-ttl').textContent = emp ? '従業員編集' : '従業員登録';
  document.getElementById('f-id').value = empId || '';

  // ── アバターギャラリー初期化 ──
  // 後方互換: avatarId (旧) または avatarIds (新) を読み込む
  const existingIds = Array.isArray(emp?.avatarIds) && emp.avatarIds.length > 0
    ? emp.avatarIds
    : (emp?.avatarId ? [emp.avatarId] : []);
  avatarGallery = existingIds.map(id => ({
    localId:  id,
    avatarId: id,
    url:      avatarMap.has(id) ? avatarMap.get(id) : null,
    file:     null,
    isNew:    false,
  })).filter(g => g.url);
  activeAvatarIdx = typeof emp?.activeAvatarIdx === 'number'
    ? Math.min(emp.activeAvatarIdx, Math.max(0, avatarGallery.length - 1))
    : 0;
  
  // 新しいアバタースタイル計算関数を利用
  const as = getAvatarStyle(emp || {});
  currentAvatarAspect = as.aspect;
  currentAvatarRadius = as.radius.endsWith('%') ? 50 : parseInt(as.radius);
  currentAvatarFit    = as.fit;

  document.getElementById('f-avatar-aspect').value = currentAvatarAspect;
  document.getElementById('f-avatar-radius').value = currentAvatarRadius;
  document.getElementById('f-avatar-radius-val').textContent = currentAvatarRadius === 50 ? '50%' : currentAvatarRadius + 'px';
  document.getElementById('f-avatar-fit').value = currentAvatarFit;

  renderAvatarGallery();

  document.getElementById('f-last').value       = emp?.lastName      || '';
  document.getElementById('f-first').value      = emp?.firstName     || '';
  document.getElementById('f-last-kana').value  = emp?.lastNameKana  || '';
  document.getElementById('f-first-kana').value = emp?.firstNameKana || '';
  document.querySelectorAll('input[name="f-gender"]').forEach(r => r.checked = r.value === (emp?.gender || ''));
  renderFlatMasterPills('status',    'f-status-group',   'f-status',   emp?.status    || '');
  renderFlatMasterPills('attribute', 'f-attr-group',     'f-attr',     emp?.attribute || '');
  renderFlatMasterPills('hireType',  'f-hiretype-group', 'f-hiretype', emp?.hireType  || '');
  renderFlatMasterPills('course',    'f-course-group',   'f-course',   emp?.course    || '');
  // 退職年月日フィールドの初期化
  document.getElementById('f-resign').value = emp?.resignDate || '';
  const resignNorm = document.getElementById('fresign-norm');
  const resignErr  = document.getElementById('fresign-err');
  if (resignNorm) resignNorm.style.display = 'none';
  if (resignErr)  resignErr.style.display  = 'none';
  _updateResignDateVisibility(emp?.status || '');
  // 削除ボタン: 既存従業員編集時のみ表示
  const delBtn = document.getElementById('btn-delete-emp');
  if (delBtn) delBtn.style.display = empId ? '' : 'none';

  document.getElementById('f-education').value = emp?.education || '';
  document.getElementById('f-school').value    = emp?.school    || '';
  document.getElementById('f-edu-dept').value  = emp?.eduDept   || '';

  document.getElementById('f-hire').value = emp?.hireDate || '';
  const fhireEl = document.getElementById('f-hire');
  fhireEl.classList.remove('hire-norm-ok', 'hire-norm-err');
  document.getElementById('fh-norm').style.display = 'none';
  document.getElementById('fh-err').style.display  = 'none';
  document.getElementById('f-memo').value = emp?.memo || '';

  const useApprox = hasApproxAge(emp) || (!emp?.birthDate && emp?.ageApprox);
  setBirthMode(useApprox ? 'approx' : 'exact');
  document.getElementById('f-birth').value = emp?.birthDate || '';
  const fbEl = document.getElementById('f-birth');
  fbEl.classList.remove('hire-norm-ok', 'hire-norm-err');
  document.getElementById('fbirth-norm').style.display = 'none';
  document.getElementById('fbirth-err').style.display  = 'none';
  const zDisp = document.getElementById('fbirth-zodiac');
  if (zDisp) {
    const z = getZodiac(emp?.birthDate);
    if (z) {
      zDisp.innerHTML = `<i class="${getZodiacIcon(z)}" style="font-size:9px;margin-right:2px"></i>${z}年`;
      zDisp.style.display = 'inline-flex';
    } else {
      zDisp.style.display = 'none';
    }
  }
  renderApproxAgeList(emp?.ageApprox);

  const oldInput = document.getElementById('tag-fuzzy-input');
  const newInput = oldInput.cloneNode(true);
  oldInput.parentNode.replaceChild(newInput, oldInput);
  document.removeEventListener('click', closeTagDropdownOutside);
  document.getElementById('tag-chips-row').innerHTML = '';
  document.getElementById('tag-dropdown').style.display = 'none';
  buildTagFuzzy(emp?.tags || []);

  switchEmpModalTab('emp-pane-profile');
  // ── 編集中フォームを必ずリセット（別人を開いたときの混入防止） ──
  closeTransferEdit();
  closeLeaveEdit();
  closeContactEdit();
  empTransfers = (emp?.transfers || []).map(t => ({ ...t }));
  empLeaves    = (emp?.leaves    || []).map(l => ({ ...l }));
  renderTransferTimeline(); updateTransferTabBadge();
  empContacts = (emp?.contacts || []).map(c => ({ ...c }));
  renderContactList(); updateContactsTabBadge();

  openModal('emp-modal');
  empDirty = false; hideEmpDirtyBanner(); hideEmpDupBanner();
  setTimeout(() => {
    document.getElementById('f-last').focus();
    empOriginalSnapshot = getEmpFormSnapshot();
    attachEmpDirtyListeners();
    if (empId) checkEmpNameDuplicate();
  }, 80);
}

/* ================================================================
   AVATAR GALLERY — RENDER
================================================================ */
function _removeAvatarFromGallery(idx) {
  const item = avatarGallery[idx];
  if (!item) return;
  if (!item.isNew && item.avatarId) {
    deleteAvatarFromDB(item.avatarId);
    if (avatarMap.has(item.avatarId)) { URL.revokeObjectURL(avatarMap.get(item.avatarId)); avatarMap.delete(item.avatarId); }
  } else if (item.isNew && item.url) {
    URL.revokeObjectURL(item.url);
  }
  avatarGallery.splice(idx, 1);
  activeAvatarIdx = Math.min(activeAvatarIdx, Math.max(0, avatarGallery.length - 1));
  renderAvatarGallery(); markEmpDirty();
}

function renderAvatarGallery() {
  const preview     = document.getElementById('f-avatar-preview');
  const placeholder = document.getElementById('f-avatar-placeholder');
  const btnClear    = document.getElementById('btn-avatar-clear');
  const strip       = document.getElementById('avatar-gallery-strip');

  const active = avatarGallery[activeAvatarIdx];
  const btnZoom = document.getElementById('btn-avatar-zoom');
  if (active && active.url) {
    preview.src = active.url;
    preview.style.display = 'block';
    placeholder.style.display  = 'none';
    btnClear.style.display     = 'flex';
    if (btnZoom) btnZoom.style.display = 'flex';
  } else {
    preview.src = ''; preview.style.display = 'none';
    placeholder.style.display = 'flex';
    btnClear.style.display    = 'none';
    if (btnZoom) btnZoom.style.display = 'none';
  }
  _applyAvatarStyle();

  // ── サムネイルストリップ（横列） ──
  if (!strip) return;
  strip.innerHTML = '';

  avatarGallery.forEach((item, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'gallery-thumb' + (idx === activeAvatarIdx ? ' is-active' : '');
    thumb.title = idx === activeAvatarIdx ? 'カード表示写真（選択中）' : 'クリックでカード表示写真に選択';

    const img = document.createElement('img');
    img.src = item.url; img.alt = `写真${idx + 1}`;
    // サムネイルもスタイルを合わせる
    img.style.aspectRatio = currentAvatarAspect;
    img.style.objectFit   = currentAvatarFit;
    thumb.appendChild(img);

    if (idx === activeAvatarIdx) {
      const badge = document.createElement('span');
      badge.className = 'gallery-thumb-badge'; badge.title = 'ポップアップ表示写真';
      badge.innerHTML = '<i class="fa-solid fa-eye"></i>';
      thumb.appendChild(badge);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'gallery-thumb-del'; delBtn.title = 'この写真を削除';
    delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      _removeAvatarFromGallery(idx);
    });
    thumb.appendChild(delBtn);

    thumb.addEventListener('click', () => {
      activeAvatarIdx = idx; renderAvatarGallery(); markEmpDirty();
    });
    strip.appendChild(thumb);
  });

  const addBtn = document.createElement('button');
  addBtn.type = 'button'; addBtn.className = 'gallery-thumb-add'; addBtn.title = '写真を追加';
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i>';
  addBtn.addEventListener('click', () => document.getElementById('f-avatar-input').click());
  strip.appendChild(addBtn);

  const hint = document.getElementById('avatar-gallery-hint');
  if (hint) hint.style.display = avatarGallery.length > 0 ? '' : 'none';
}

/* ================================================================
   AVATAR IMAGE HANDLER
================================================================ */
async function resizeImage(file, maxSize = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round((h * maxSize) / w); w = maxSize; }
          else { w = Math.round((w * maxSize) / h); h = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.88);
      };
      img.onerror = reject; img.src = e.target.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}

function _applyAvatarStyle() {
  const dz   = document.getElementById('avatar-drop-zone');
  const prev = document.getElementById('f-avatar-preview');
  const r    = currentAvatarRadius === 50 ? '50%' : currentAvatarRadius + 'px';
  if (dz) {
    dz.style.aspectRatio  = currentAvatarAspect;
    dz.style.borderRadius = r;
  }
  if (prev) {
    prev.style.aspectRatio  = currentAvatarAspect;
    prev.style.borderRadius = r;
    prev.style.objectFit    = currentAvatarFit;
  }
}

/* ================================================================
   AVATAR EVENTS — カスタムUI連携
================================================================ */
function initAvatarEvents() {
  const dropZone   = document.getElementById('avatar-drop-zone');
  const fileInput  = document.getElementById('f-avatar-input');
  const btnClear   = document.getElementById('btn-avatar-clear');

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) { toast('画像ファイルを選択してください'); return; }
    try {
      const resizedBlob = await resizeImage(file, 800);
      const url = URL.createObjectURL(resizedBlob);
      const localId = 'new_' + uid();
      avatarGallery.push({ localId, avatarId: null, url, file: resizedBlob, isNew: true });
      activeAvatarIdx = avatarGallery.length - 1;
      renderAvatarGallery(); markEmpDirty();
    } catch(e) { toast('画像の読み込みに失敗しました'); }
  };

  let clickTimer = null;
  dropZone.addEventListener('click', e => {
    if (e.target === btnClear || btnClear.contains(e.target)) return;
    const btnZoom = document.getElementById('btn-avatar-zoom');
    if (btnZoom && (e.target === btnZoom || btnZoom.contains(e.target))) {
      const active = avatarGallery[activeAvatarIdx];
      if (active && active.url) openImageViewer(active.url, 'オリジナル写真');
      return;
    }
    
    // 画像が存在する場合はダブルクリックと競合しないよう遅延させる
    if (avatarGallery.length > 0) {
      if (clickTimer) clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        fileInput.click();
      }, 250);
    } else {
      fileInput.click();
    }
  });

  dropZone.addEventListener('dblclick', e => {
    if (e.target === btnClear || btnClear.contains(e.target)) return;
    const btnZoom = document.getElementById('btn-avatar-zoom');
    if (btnZoom && (e.target === btnZoom || btnZoom.contains(e.target))) return;

    if (avatarGallery.length > 0) {
      if (clickTimer) clearTimeout(clickTimer);
      const active = avatarGallery[activeAvatarIdx];
      if (active && active.url) {
        openImageViewer(active.url, 'オリジナル写真');
      }
    }
  });
  fileInput.addEventListener('change', e => {
    const files = [...(e.target.files || [])];
    files.forEach(f => handleFile(f));
    fileInput.value = '';
  });

  dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
  dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
    files.forEach(f => handleFile(f));
  });

  document.addEventListener('paste', e => {
    const modal = document.getElementById('emp-modal');
    if (!modal?.classList.contains('open')) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active.type !== 'file') return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) { const file = item.getAsFile(); if (file) { handleFile(file); break; } }
    }
  });

  btnClear.addEventListener('click', e => {
    e.stopPropagation();
    if (avatarGallery.length === 0) return;
    _removeAvatarFromGallery(activeAvatarIdx);
  });

  // カスタムUIの設定
  document.getElementById('f-avatar-aspect')?.addEventListener('change', e => {
    currentAvatarAspect = e.target.value;
    _applyAvatarStyle(); markEmpDirty();
  });
  document.getElementById('f-avatar-radius')?.addEventListener('input', e => {
    currentAvatarRadius = parseInt(e.target.value);
    document.getElementById('f-avatar-radius-val').textContent = currentAvatarRadius === 50 ? '50%' : currentAvatarRadius + 'px';
    _applyAvatarStyle(); markEmpDirty();
  });
  document.getElementById('f-avatar-fit')?.addEventListener('change', e => {
    currentAvatarFit = e.target.value;
    _applyAvatarStyle(); markEmpDirty();
  });

  document.getElementById('btn-avatar-settings-toggle')?.addEventListener('click', () => {
    const panel   = document.getElementById('avatar-settings-panel');
    const chevron = document.getElementById('avatar-settings-chevron');
    const isOpen  = panel.style.display !== 'none';
    panel.style.display   = isOpen ? 'none' : '';
    chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
  });
}

/* ================================================================
   TAG FUZZY SEARCH
================================================================ */
function buildTagFuzzy(initialIds) {
  selectedTagIds = [...initialIds];
  const hint = document.getElementById('f-tag-hint');
  if (!DB.tags.length) { hint.style.display = ''; return; }
  hint.style.display = 'none';
  renderTagChipsFuzzy();
  const input    = document.getElementById('tag-fuzzy-input');
  const dropdown = document.getElementById('tag-dropdown');
  input.addEventListener('input', updateTagDropdown);
  input.addEventListener('focus', updateTagDropdown);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') dropdown.style.display = 'none';
    if (e.key === 'Enter') { e.preventDefault(); const f = dropdown.querySelector('.tag-dd-item'); if (f) f.click(); }
  });
  document.addEventListener('click', closeTagDropdownOutside);
}
function renderTagChipsFuzzy() {
  const row = document.getElementById('tag-chips-row'); row.innerHTML = '';
  selectedTagIds.forEach(tid => {
    const tag = DB.tags.find(t => t.id === tid); if (!tag) return;
    const chip = document.createElement('span'); chip.className = 'tag-chip-sel';
    chip.style.background = lighten(tag.color); chip.style.color = tag.color;
    chip.innerHTML = `<i class="fa-solid fa-tag" style="font-size:9px"></i>${tag.name}`;
    const rm = document.createElement('span'); rm.className = 'tag-chip-rm'; rm.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    rm.addEventListener('click', () => { selectedTagIds = selectedTagIds.filter(id => id !== tid); renderTagChipsFuzzy(); updateTagDropdown(); });
    chip.appendChild(rm); row.appendChild(chip);
  });
}
function updateTagDropdown() {
  const input    = document.getElementById('tag-fuzzy-input');
  const dropdown = document.getElementById('tag-dropdown');
  const q        = input.value.trim().toLowerCase();
  const avail    = DB.tags.filter(t => !selectedTagIds.includes(t.id));
  const matched  = q ? avail.filter(t => t.name.toLowerCase().includes(q) || tagPath(t.id).toLowerCase().includes(q)) : avail;
  dropdown.innerHTML = '';
  if (!matched.length) { dropdown.innerHTML = '<div class="tag-dd-empty">一致するタグがありません</div>'; dropdown.style.display = 'block'; return; }
  if (q) {
    matched.forEach(tag => {
      const item = document.createElement('div'); item.className = 'tag-dd-item';
      const dot  = document.createElement('span'); dot.className = 'tag-dd-dot'; dot.style.background = tag.color;
      const nm   = document.createElement('span'); nm.textContent = tag.name;
      item.appendChild(dot); item.appendChild(nm);
      const usedCnt = DB.employees.filter(e => (e.tags||[]).includes(tag.id)).length;
      if (usedCnt > 0) { const c = document.createElement('span'); c.className = 'tag-dd-count'; c.textContent = usedCnt + '名'; item.appendChild(c); }
      item.addEventListener('mousedown', e => { e.preventDefault(); selectedTagIds.push(tag.id); input.value = ''; renderTagChipsFuzzy(); updateTagDropdown(); });
      dropdown.appendChild(item);
    });
  } else {
    function renderLevel(parentId, depth) {
      matched.filter(t => (t.parentId || '') === (parentId || '')).forEach(tag => {
        const item = document.createElement('div'); item.className = 'tag-dd-item';
        if (depth > 0) item.style.paddingLeft = (12 + depth * 16) + 'px';
        const dot = document.createElement('span'); dot.className = 'tag-dd-dot'; dot.style.background = tag.color;
        item.appendChild(dot); item.appendChild(document.createTextNode(tag.name));
        const usedCnt = DB.employees.filter(e => (e.tags||[]).includes(tag.id)).length;
        if (usedCnt > 0) { const c = document.createElement('span'); c.className = 'tag-dd-count'; c.textContent = usedCnt + '名'; item.appendChild(c); }
        item.addEventListener('mousedown', e => { e.preventDefault(); selectedTagIds.push(tag.id); input.value = ''; renderTagChipsFuzzy(); updateTagDropdown(); });
        dropdown.appendChild(item); renderLevel(tag.id, depth + 1);
      });
    }
    renderLevel('', 0);
  }
  dropdown.style.display = 'block';
}
function closeTagDropdownOutside(e) {
  const wrap = document.getElementById('tag-fuzzy-wrap');
  const dd   = document.getElementById('tag-dropdown');
  if (wrap && !wrap.contains(e.target) && dd) dd.style.display = 'none';
}
function getSelTagIds() { return [...selectedTagIds]; }

/* ================================================================
   DUPLICATE NAME CHECK
================================================================ */
function checkEmpNameDuplicate() {
  const lastName  = document.getElementById('f-last').value.trim();
  const firstName = document.getElementById('f-first').value.trim();
  const empId     = document.getElementById('f-id').value;
  const banner    = document.getElementById('emp-dup-banner');
  const indicator = document.getElementById('emp-fuzzy-dup-indicator');
  const tt        = indicator ? indicator.querySelector('.fuzzy-dup-tooltip') : null;

  if (!lastName && !firstName) {
    banner.classList.remove('is-visible');
    if (indicator) indicator.style.display = 'none';
    return;
  }

  const normInput = normalizeForDuplicate(lastName + firstName);
  let exactDupes = [];
  let fuzzyDupes = [];

  DB.employees.forEach(e => {
    if (e.id === empId) return;
    const isExact = e.lastName === lastName && e.firstName === firstName;
    if (isExact) {
      exactDupes.push(e);
    } else {
      const normE = normalizeForDuplicate(e.lastName + e.firstName);
      if (normE === normInput && normInput !== '') {
        fuzzyDupes.push(e);
      }
    }
  });

  if (exactDupes.length > 0) {
    document.getElementById('emp-dup-msg').textContent = `同姓名「${lastName} ${firstName}」が ${exactDupes.length} 件存在します`;
    const links = document.getElementById('emp-dup-links'); links.innerHTML = '';
    exactDupes.slice(0, 4).forEach(e => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dup-emp-link';
      const kana = [e.lastNameKana, e.firstNameKana].filter(Boolean).join(' ');
      btn.textContent = kana ? `${e.lastName} ${e.firstName}（${kana}・${e.status || '不明'}）` : `${e.lastName} ${e.firstName}（${e.status || '不明'}）`;
      btn.addEventListener('click', () => openEmpModal(e.id)); links.appendChild(btn);
    });
    banner.classList.add('is-visible');
  } else {
    banner.classList.remove('is-visible');
  }

  if (fuzzyDupes.length > 0 && exactDupes.length === 0) {
    if (indicator && tt) {
      indicator.style.display = 'inline-flex';
      tt.innerHTML = fuzzyDupes.slice(0, 5).map(e => `<div>・${e.lastName} ${e.firstName} (${e.status||'不明'})</div>`).join('');
      if (fuzzyDupes.length > 5) tt.innerHTML += `<div>...他 ${fuzzyDupes.length - 5}件</div>`;
    }
  } else {
    if (indicator) indicator.style.display = 'none';
  }
}
function hideEmpDupBanner() { document.getElementById('emp-dup-banner').classList.remove('is-visible'); }

/* ================================================================
   SAVE EMPLOYEE — 複数アバター対応
================================================================ */
async function saveEmployee() {
  // ── 編集中フォームの自動コミット ──
  // 異動フォームや休職フォームが開いていた場合、親のラッパーの表示状態から正確に判定
  const historyWrap = document.getElementById('history-entry-wrap');
  if (historyWrap && historyWrap.style.display !== 'none') {
    const teCard = document.getElementById('transfer-edit-card');
    const leCard = document.getElementById('leave-edit-card');

    if (teCard && teCard.style.display !== 'none') {
      const dateVal = document.getElementById('te-date')?.value.trim();
      const endVal = document.getElementById('te-end-date')?.value.trim();
      const orgVal = document.getElementById('te-company-levels')?.value || '[]';
      const posVal = document.getElementById('te-position')?.value.trim();
      
      if (dateVal || endVal || orgVal !== '[]' || posVal) {
        if (dateVal && !normalizeHireDate(dateVal)) {
          switchEmpModalTab('emp-pane-transfer');
          showValErr('te-date', '配属日の形式が正しくありません');
          return; 
        }
        if (endVal && !normalizeHireDate(endVal)) {
          switchEmpModalTab('emp-pane-transfer');
          showValErr('te-end-date', '終了日の形式が正しくありません');
          return; 
        }
        const success = saveTransferEdit();
        if (!success) { switchEmpModalTab('emp-pane-transfer'); return; }
      } else {
        closeTransferEdit();
      }
    } else if (leCard && leCard.style.display !== 'none') {
      const startVal = document.getElementById('le-start')?.value.trim();
      if (startVal) {
        const normDate = normalizeHireDate(startVal);
        if (!normDate && startVal) {
          switchEmpModalTab('emp-pane-transfer');
          showValErr('le-start', '開始日の形式が正しくありません');
          return; 
        }
        const success = saveLeaveEdit();
        if (!success) { switchEmpModalTab('emp-pane-transfer'); return; }
      } else {
        closeLeaveEdit();
        toast('開始日が未入力のため、入力途中の休職・休業情報は破棄されました');
      }
    }
  }

  // 連絡先フォームが開いていた場合の自動コミット処理
  const ctCard = document.getElementById('contact-edit-card');
  if (ctCard && ctCard.style.display !== 'none') {
    const val = document.getElementById('ct-value')?.value.trim();
    if (val) {
      const success = saveContactEdit();
      if (!success) { switchEmpModalTab('emp-pane-contacts'); return; }
    } else {
      closeContactEdit();
    }
  }

  const lastName      = document.getElementById('f-last').value.trim();
  const firstName     = document.getElementById('f-first').value.trim();
  if (!lastName || !firstName) { switchEmpModalTab('emp-pane-profile'); showValErr('f-last', '苗字と名前は必須です'); return; }

  const currentEmpId = document.getElementById('f-id').value;
  const exactDupes = DB.employees.filter(e => e.id !== currentEmpId && e.lastName === lastName && e.firstName === firstName);

  if (exactDupes.length > 0 && !document.getElementById('emp-dup-banner').dataset.ignored) {
    openConfirm(
      `同姓名の「${lastName} ${firstName}」がすでに ${exactDupes.length}名 登録されています。\n本当にこのまま保存（新規登録/更新）してよろしいですか？`,
      () => {
        document.getElementById('emp-dup-banner').dataset.ignored = '1';
        closeModal('confirm-modal');
        saveEmployee();
      },
      { title:'同姓名の重複確認', okLabel:'保存する', okIcon:'fa-solid fa-check', okClass:'btn btn-danger', innerIcon:'fa-solid fa-users', innerColor:'var(--c-warn)' }
    );
    return;
  }
  document.getElementById('emp-dup-banner').removeAttribute('data-ignored');

  const lastNameKana  = document.getElementById('f-last-kana').value.trim();
  const firstNameKana = document.getElementById('f-first-kana').value.trim();
  const hireRaw  = document.getElementById('f-hire').value.trim();
  const hireDate = hireRaw ? (normalizeHireDate(hireRaw) ?? '') : '';
  if (hireRaw && !hireDate) { switchEmpModalTab('emp-pane-details'); showValErr('f-hire', '入社年月日の形式が正しくありません'); return; }
  const gender    = document.querySelector('input[name="f-gender"]:checked')?.value   || '';
  const attribute = document.querySelector('input[name="f-attr"]:checked')?.value     || '';
  const status    = document.querySelector('input[name="f-status"]:checked')?.value   || '';
  const hireType  = document.querySelector('input[name="f-hiretype"]:checked')?.value || '';
  const course    = document.querySelector('input[name="f-course"]:checked')?.value   || '';
  const flatValidation = [
    { type:'status',    val:status,    label:DB.masterConfig.status?.label    || '在籍状況' },
    { type:'attribute', val:attribute, label:DB.masterConfig.attribute?.label  || '属性' },
    { type:'hireType',  val:hireType,  label:DB.masterConfig.hireType?.label   || '入社区分' },
    { type:'course',    val:course,    label:DB.masterConfig.course?.label     || '履修系統' },
  ];
  for (const { type, val, label } of flatValidation) {
    if (!validateFlatMasterValue(type, val)) toast(`「${label}」の選択値「${val}」はマスタに存在しません。未設定で保存します。`);
  }
  const education = document.getElementById('f-education').value;
  const school    = document.getElementById('f-school').value.trim();
  const eduDept   = document.getElementById('f-edu-dept').value.trim();
  const memo      = document.getElementById('f-memo').value.trim();
  const tags      = getSelTagIds();
  const empId     = document.getElementById('f-id').value;

  const mode = document.getElementById('birth-mode-seg').dataset.currentMode || 'exact';
  let birthDate = '', ageApprox = null;
  if (mode === 'exact') {
    const birthRaw = document.getElementById('f-birth').value.trim();
    birthDate = birthRaw ? (normalizeBirthDate(birthRaw) ?? '') : '';
    if (birthRaw && !birthDate) { switchEmpModalTab('emp-pane-profile'); showValErr('f-birth', '生年月日の形式が正しくありません'); return; }
  } else {
    const approxList = [];
    let hasErr = false;
    document.querySelectorAll('.approx-age-item').forEach(row => {
      const ageInp = row.querySelector('.inp-approx-age');
      const refInp = row.querySelector('.inp-approx-refdate');
      const ageVal = ageInp.value;
      const refDateRaw = refInp.value.trim();
      const refDate = refDateRaw ? (normalizeFlexDate(refDateRaw) ?? '') : '';
      const rawAge  = parseInt(ageVal, 10);
      
      if (ageVal !== '' || refDateRaw !== '') {
        if (!isNaN(rawAge) && rawAge >= 0 && refDate) {
          approxList.push({ age: rawAge, refDate });
        } else if (isNaN(rawAge) || rawAge < 0) {
          switchEmpModalTab('emp-pane-profile'); showValErr(ageInp.id, '年齢を正しく入力してください'); hasErr = true;
        } else if (!refDate) {
          switchEmpModalTab('emp-pane-profile'); showValErr(refInp.id, '基準日を正しく入力してください'); hasErr = true;
        }
      }
    });
    if (hasErr) return;
    
    if (approxList.length > 0) {
      const range = estimateBirthDateRange(approxList);
      if (!range) {
        switchEmpModalTab('emp-pane-profile'); toast('入力された年齢・基準日の組み合わせに矛盾があります'); return;
      }
      ageApprox = approxList;
    } else {
      ageApprox = null;
    }
  }

  document.removeEventListener('click', closeTagDropdownOutside);
  const safeAttr     = validateFlatMasterValue('attribute', attribute) ? attribute : '';
  const safeStatus   = validateFlatMasterValue('status',    status)    ? status    : '';
  const safeHireType = validateFlatMasterValue('hireType',  hireType)  ? hireType  : '';
  const safeCourse   = validateFlatMasterValue('course',    course)    ? course    : '';

  const finalEmpId = empId || uid();

  // ── アバターギャラリー保存処理 ──
  const savedAvatarIds = [];
  for (const item of avatarGallery) {
    if (item.isNew && item.file) {
      // 新規画像を IndexedDB に保存
      const newId = `avatar_${finalEmpId}_${Date.now()}_${Math.random().toString(36).slice(2,5)}`;
      await saveAvatarToDB(newId, item.file);
      if (item.url) URL.revokeObjectURL(item.url); // 一時URLを解放
      const persistUrl = URL.createObjectURL(item.file);
      avatarMap.set(newId, persistUrl);
      item.avatarId = newId; item.url = persistUrl; item.isNew = false;
      savedAvatarIds.push(newId);
    } else if (item.avatarId) {
      savedAvatarIds.push(item.avatarId);
    }
  }
  const safeActiveIdx = Math.min(activeAvatarIdx, Math.max(0, savedAvatarIds.length - 1));

  // 退職年月日: 在籍状況が「退職」のときのみ保存
  const resignRaw  = document.getElementById('f-resign').value.trim();
  const resignDate = (safeStatus === '退職' && resignRaw) ? (normalizeHireDate(resignRaw) ?? '') : '';
  if (safeStatus === '退職' && resignRaw && !resignDate) { switchEmpModalTab('emp-pane-details'); showValErr('f-resign', '退職年月日の形式が正しくありません'); return; }

  const record = {
    lastName, firstName, lastNameKana, firstNameKana, gender, birthDate, ageApprox, hireDate,
    attribute: safeAttr, status: safeStatus, hireType: safeHireType, course: safeCourse,
    education, school, eduDept, memo, tags, resignDate,
    transfers: [...empTransfers], contacts: [...empContacts],
    leaves:    [...empLeaves],
    avatarIds:       savedAvatarIds,
    activeAvatarIdx: safeActiveIdx,
    avatarId:        savedAvatarIds[safeActiveIdx] || null,  // backward compat
    avatarAspect:    currentAvatarAspect,
    avatarRadius:    currentAvatarRadius,
    avatarFit:       currentAvatarFit,
  };

  if (empId) {
    const emp = DB.employees.find(e => e.id === empId);
    if (emp) Object.assign(emp, record);
  } else {
    DB.employees.push({ id: finalEmpId, ...record });
  }

  const schoolAutoAdded = collectSchoolAutoRegister(school, eduDept);
  empDirty = false; hideEmpDirtyBanner();
  saveDB(); forceCloseModal('emp-modal');
  if (schoolAutoAdded.length) toast(`学校マスタに自動登録しました：${schoolAutoAdded.join('、')}`);
  else toast(empId ? '従業員情報を更新しました' : '従業員を登録しました');
  renderList();
  if (currentView === 'distribution') renderDist();
  if (currentView === 'masters') renderMasterView();
  updateHeaderCnt(); updateDupListBtn();
}

function deleteEmp(id) {
  // 関連する全アバターを削除
  const emp = DB.employees.find(e => e.id === id);
  if (emp) {
    const ids = Array.isArray(emp.avatarIds) && emp.avatarIds.length ? emp.avatarIds : (emp.avatarId ? [emp.avatarId] : []);
    ids.forEach(aid => { deleteAvatarFromDB(aid); if (avatarMap.has(aid)) { URL.revokeObjectURL(avatarMap.get(aid)); avatarMap.delete(aid); } });
  }
  DB.employees = DB.employees.filter(e => e.id !== id);
  saveDB(); toast('従業員を削除しました'); closeModal('confirm-modal');
  renderList(); if (currentView === 'distribution') renderDist(); updateHeaderCnt(); updateDupListBtn();
}

function showValErr(fieldId, msg) {
  const el = document.getElementById(fieldId);
  el.style.borderColor = 'var(--c-danger)'; el.style.boxShadow = '0 0 0 3px rgba(239,68,68,.15)';
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 1800);
  toast(msg); el.focus();
}

/* ================================================================
   TAG MODAL
================================================================ */
function openTagModal(tagId = null, defaultParentId = '') {
  const tag = tagId ? DB.tags.find(t => t.id === tagId) : null;
  document.getElementById('tag-modal-ttl').textContent = tag ? 'タグ編集' : 'タグ追加';
  document.getElementById('tf-id').value   = tagId || '';
  document.getElementById('tf-name').value = tag?.name || '';
  const initClr = tag?.color || PRESET_CLR[10];
  document.getElementById('tf-color').value = initClr;
  buildClrPresets(initClr);
  const pSel = document.getElementById('tf-parent');
  pSel.innerHTML = '<option value="">なし（ルートタグ）</option>';
  const excludeIds = new Set();
  if (tagId) {
    excludeIds.add(tagId);
    function collectDesc(id) { DB.tags.filter(t => t.parentId === id).forEach(t => { excludeIds.add(t.id); collectDesc(t.id); }); }
    collectDesc(tagId);
  }
  function appendTagOpts(parentId, depth) {
    DB.tags.filter(t => (t.parentId || '') === (parentId || '') && !excludeIds.has(t.id)).forEach(t => {
      const opt = document.createElement('option'); opt.value = t.id; opt.textContent = '\u00A0'.repeat(depth * 3) + t.name;
      pSel.appendChild(opt); appendTagOpts(t.id, depth + 1);
    });
  }
  appendTagOpts('', 0); pSel.value = tag?.parentId || defaultParentId || '';
  openModal('tag-modal');
  setTimeout(() => document.getElementById('tf-name').focus(), 80);
}
function buildClrPresets(selected) {
  const box = document.getElementById('clr-presets'); box.innerHTML = '';
  PRESET_CLR.forEach(clr => {
    const dot = document.createElement('div'); dot.className = `clr-dot${clr === selected ? ' is-sel' : ''}`; dot.style.background = clr;
    dot.addEventListener('click', () => { document.querySelectorAll('.clr-dot').forEach(d => d.classList.remove('is-sel')); dot.classList.add('is-sel'); document.getElementById('tf-color').value = clr; });
    box.appendChild(dot);
  });
  document.getElementById('tf-color').oninput = e => {
    document.querySelectorAll('.clr-dot').forEach(d => d.classList.remove('is-sel'));
    const i = PRESET_CLR.indexOf(e.target.value); if (i >= 0) box.children[i]?.classList.add('is-sel');
  };
}
function saveTag() {
  const name = document.getElementById('tf-name').value.trim();
  if (!name) { showValErr('tf-name', 'タグ名を入力してください'); return; }
  const color    = document.getElementById('tf-color').value;
  const tagId    = document.getElementById('tf-id').value;
  const parentId = document.getElementById('tf-parent').value || '';
  const dupTag = DB.tags.find(t => t.id !== tagId && t.name === name && (t.parentId || '') === parentId);
  if (dupTag) { showValErr('tf-name', `同じ階層に「${name}」はすでに存在します`); return; }
  if (tagId) { const tag = DB.tags.find(t => t.id === tagId); if (tag) Object.assign(tag, { name, color, parentId }); }
  else { DB.tags.push({ id: uid(), name, color, parentId }); }
  saveDB(); closeModal('tag-modal'); toast(tagId ? 'タグを更新しました' : 'タグを追加しました');
  renderTagMaster(); refreshTagFilter();
  if (currentView === 'list') renderList();
  if (currentView === 'distribution') renderDist();
}
function deleteTag(id) {
  function collectAll(tid) { const ids = [tid]; DB.tags.filter(t => t.parentId === tid).forEach(c => ids.push(...collectAll(c.id))); return ids; }
  const toDelete = new Set(collectAll(id));
  DB.tags = DB.tags.filter(t => !toDelete.has(t.id));
  DB.employees.forEach(e => { e.tags = (e.tags || []).filter(tid => !toDelete.has(tid)); });
  saveDB(); toast('タグを削除しました'); closeModal('confirm-modal');
  renderTagMaster(); refreshTagFilter();
  if (currentView === 'list') renderList();
  if (currentView === 'distribution') renderDist();
}

/* ================================================================
   BIRTH MODE TOGGLE
================================================================ */
function setBirthMode(mode) {
  const seg = document.getElementById('birth-mode-seg');
  seg.dataset.currentMode = mode;
  seg.querySelectorAll('.bmt-btn').forEach(b => b.classList.toggle('is-active', b.dataset.mode === mode));
  document.getElementById('birth-exact-wrap').style.display  = mode === 'exact'  ? '' : 'none';
  document.getElementById('birth-approx-wrap').style.display = mode === 'approx' ? '' : 'none';
}

/* ================================================================
   AUTOKANA (氏名ふりがな自動入力)
================================================================ */
class AutoKana {
  constructor(srcId, dstId) {
    this.src = document.getElementById(srcId);
    this.dst = document.getElementById(dstId);
    if (!this.src || !this.dst) return;

    this.active = false;
    this.baseKana = "";
    this.currentKana = "";
    this.prevSrcValue = ""; // 前回確定時の文字を保持し削除に追従

    this.src.addEventListener("focus", () => {
      // 宛先が空の時のみ自動入力を有効にする
      if (!this.dst.value) {
        this.active = true;
        this.baseKana = "";
        this.currentKana = "";
        this.prevSrcValue = this.src.value;
      }
    });

    this.src.addEventListener("blur", () => {
      this.active = false;
    });

    this.src.addEventListener("compositionupdate", (e) => {
      if (!this.active) return;
      // 漢字等が含まれていない（ひらがな・カタカナ・長音・半角英数字）場合のみ更新
      // （※バックスペースで空文字が来た場合も許容するため * に修正）
      if (/^[ぁ-んァ-ンーa-zA-Z0-9]*$/.test(e.data)) {
        this.currentKana = e.data;
        this._updateDst();
      }
    });

    this.src.addEventListener("compositionend", (e) => {
      if (!this.active) return;
      this.baseKana += this.currentKana;
      this.currentKana = "";
      this.prevSrcValue = this.src.value;
      this._updateDst();
    });

    this.src.addEventListener("input", (e) => {
      if (!this.active) return;
      
      const currentVal = this.src.value;

      // 入力欄がクリアされたらふりがなもクリア
      if (currentVal === "") {
        this.baseKana = "";
        this.currentKana = "";
        this.prevSrcValue = "";
        this._updateDst();
      } 
      // バックスペース等で確定済みの文字が減った場合、カナもヒューリスティックに削る
      else if (!e.isComposing && currentVal.length < this.prevSrcValue.length) {
        const diff = this.prevSrcValue.length - currentVal.length;
        // 漢字1文字につきカナ2文字相当と仮定して末尾を削る
        this.baseKana = this.baseKana.slice(0, -(diff * 2));
        this.prevSrcValue = currentVal;
        this._updateDst();
      }
      // IMEオフでの直接入力
      else if (!e.isComposing && e.data && /^[ぁ-んァ-ンーa-zA-Z0-9]+$/.test(e.data)) {
        this.baseKana += e.data;
        this.prevSrcValue = currentVal;
        this._updateDst();
      }
    });
  }

  _updateDst() {
    // カタカナをひらがなに変換して反映
    const toHiragana = str => str.replace(/[\u30A1-\u30F6]/g, match => String.fromCharCode(match.charCodeAt(0) - 0x60));
    this.dst.value = toHiragana(this.baseKana + this.currentKana);
    // 変更イベントを発火して dirty state 等をトリガー
    this.dst.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/* ================================================================
   INPUT ASSIST — IME制御・全角半角変換・フォーマット支援
================================================================ */
function initInputAssist() {
  // オートカナの初期化（インスタンス化）
  new AutoKana('f-last', 'f-last-kana');
  new AutoKana('f-first', 'f-first-kana');
  // 全角→半角変換ユーティリティ
  const toHalfWidth = s =>
    s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
     .replace(/[ー－—−]/g, '-')
     .replace(/[／]/g, '/');

  // カタカナ→ひらがな変換
  const toHiragana = s =>
    s.replace(/[\u30A1-\u30F6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

  // ── 苗字・名前: フォーカス時にIME強制ON ──
  // ime-mode CSS (deprecated but still works in some browsers) + lang属性で補完
  ['f-last', 'f-first'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.setAttribute('lang', 'ja');
    // フォーカス時に ime-mode: active を強制再適用（JavaScriptからのhint）
    el.addEventListener('focus', () => { el.style.imeMode = 'active'; });
    el.addEventListener('blur',  () => { el.style.imeMode = ''; });
  });

  // ── ふりがな: カタカナ→ひらがな自動変換 & 全角→半角 ──
  ['f-last-kana', 'f-first-kana'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const pos = el.selectionStart;
      const converted = toHiragana(el.value);
      if (converted !== el.value) { el.value = converted; try { el.setSelectionRange(pos, pos); } catch(_){} }
    });
    el.addEventListener('paste', e => {
      e.preventDefault();
      const text = toHiragana((e.clipboardData || window.clipboardData).getData('text') || '');
      document.execCommand('insertText', false, text);
    });
  });

  // ── 日付/数値系フィールド: 全角→半角変換とスマートマスク（YYYY-MM-DD 自動補完） ──
  const dateInputs = document.querySelectorAll('.finput-num, .flex-date-input, #f-birth, #f-hire, #f-resign, #te-date, #te-end-date, #le-start, #le-end, #mnm-founded-date, #mnm-dissolved-date, #mnm-cef-start-date, #mnm-cef-end-date');
  
  dateInputs.forEach(el => {
    // ブラウザやOSのオートコンプリート、スペルチェック等の入力支援機能を無効化
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('spellcheck', 'false');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('data-lpignore', 'true'); // パスワードマネージャー等のサジェスト防止
    el.setAttribute('data-1p-ignore', 'true');

    el.addEventListener('focus', () => { el.style.imeMode = 'inactive'; });

    let prevValue = el.value;
    
    const applyDateMask = () => {
      let val = el.value;
      // 全角数字・記号を半角に
      val = val.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
               .replace(/[ー－—−]/g, '-')
               .replace(/[／]/g, '/')
               .replace(/[．]/g, '.');
      
      // バックスペース等で削除中の場合は自動補完をスキップ
      if (val.length < prevValue.length) {
        prevValue = val;
        let cleanDel = val.replace(/[^0-9\/\-\.]/g, '');
        if (val !== cleanDel) { el.value = cleanDel; prevValue = cleanDel; }
        return;
      }

      // 数字とハイフンに統一
      let cleaned = val.replace(/[^0-9\/\-\.]/g, '').replace(/[\/\.]/g, '-').replace(/-{2,}/g, '-');
      let p = cleaned.split('-');
      
      // YYYYMMDD と連続入力された場合の自動分割
      if (p.length === 1 && p[0].length > 4) {
        let y = p[0].slice(0, 4);
        let rest = p[0].slice(4);
        p = rest.length > 2 ? [y, rest.slice(0, 2), rest.slice(2)] : [y, rest];
      } else if (p.length === 2 && p[1].length > 2) {
        let m = p[1].slice(0, 2);
        let rest = p[1].slice(2);
        p = [p[0], m, rest];
      }

      // 各セグメントのバリデーション・補正
      if (p[0] && p[0].length > 4) p[0] = p[0].slice(0, 4);
      if (p[1]) {
        if (p[1].length > 2) p[1] = p[1].slice(0, 2);
        if (p[1].length === 1 && /^[2-9]$/.test(p[1]) && !cleaned.endsWith('-')) {
          p[1] = '0' + p[1];
        }
        if (p[1].length === 2) {
          let mv = parseInt(p[1], 10);
          if (mv > 12) p[1] = '12';
          if (mv === 0) p[1] = '01';
        }
      }
      if (p[2]) {
        if (p[2].length > 2) p[2] = p[2].slice(0, 2);
        if (p[2].length === 1 && /^[4-9]$/.test(p[2])) {
          p[2] = '0' + p[2];
        }
        if (p[2].length === 2) {
          let dv = parseInt(p[2], 10);
          if (dv > 31) p[2] = '31';
          if (dv === 0) p[2] = '01';
        }
      }
      p = p.slice(0, 3);

      // 再結合と自動ハイフン挿入
      let res = p[0] || '';
      if (p.length === 1 && res.length === 4 && cleaned.endsWith('-')) res += '-';
      else if (p.length > 1) {
        if (p[1].length === 1 && cleaned.endsWith('-')) p[1] = '0' + p[1];
        res += '-' + p[1];
        if (p.length === 2 && p[1].length === 2 && cleaned.endsWith('-')) res += '-';
        else if (p.length > 2) {
          if (p[2].length === 1 && cleaned.endsWith('-')) p[2] = '0' + p[2];
          res += '-' + p[2];
        }
      }

      // タイピング中の自動ハイフン挿入 (4桁・7桁目)
      if (res.length === 4 && !cleaned.endsWith('-')) res += '-';
      else if (res.length === 7 && !cleaned.endsWith('-')) res += '-';

      // 10文字(YYYY-MM-DD)を超えないように制限
      if (res.length > 10) res = res.slice(0, 10);

      if (el.value !== res) {
        el.value = res;
      }
      prevValue = res;
    };

    el.addEventListener('input', e => { 
      // IME変換（予測変換など）の最中は入力キーと表示文字数が合わなくなるためマスク処理を保留
      if (e.isComposing) return;
      applyDateMask(); 
    });
    el.addEventListener('compositionend', applyDateMask);
    el.addEventListener('paste', e => {
      e.preventDefault();
      let text = (e.clipboardData || window.clipboardData).getData('text') || '';
      text = text.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[^0-9\/\-\.]/g, '');
      document.execCommand('insertText', false, text);
    });
  });

  // ── 汎用日付リアルタイムフィードバック ──
  function setupDateFeedback(inputId, normId, errId, zodiacId, isBirth) {
    const inp     = document.getElementById(inputId);
    const normTag = document.getElementById(normId);
    const errTag  = document.getElementById(errId);
    const zDisp   = zodiacId ? document.getElementById(zodiacId) : null;
    if (!inp) return;
    
    function updateZodiac(dateStr) {
      if (!zDisp) return;
      const z = getZodiac(dateStr);
      if (z) {
        zDisp.innerHTML = `<i class="${getZodiacIcon(z)}" style="font-size:9px;margin-right:2px"></i>${z}年`;
        zDisp.style.display = 'inline-flex';
      } else {
        zDisp.style.display = 'none';
      }
    }

    function update(isBlur) {
      const raw = inp.value.trim();
      normTag.style.display = 'none'; errTag.style.display = 'none';
      inp.classList.remove('hire-norm-ok', 'hire-norm-err');
      if (!raw) { updateZodiac(''); return; }
      const norm = isBirth ? normalizeBirthDate(raw) : normalizeHireDate(raw);
      if (norm) {
        inp.classList.add('hire-norm-ok');
        if (isBlur) {
          inp.value = norm;
          normTag.style.display = 'none'; // 確定時はプレビュー非表示
        } else {
          normTag.innerHTML = `<i class="fa-solid fa-check"></i> ${norm.replace(/-/g, '/')} と認識`;
          normTag.style.display = '';
        }
        updateZodiac(norm);
      } else { 
        // 2文字以上でエラー判定
        if (raw.length >= 2) {
          inp.classList.add('hire-norm-err'); 
          errTag.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> 形式を確認してください`;
          errTag.style.display = ''; 
        }
        updateZodiac('');
      }
    }
    inp.addEventListener('blur',  () => update(true));
    inp.addEventListener('input', e => { if (!e.isComposing) update(false); }); // IME確定前はスキップ
    inp.addEventListener('focus', () => update(false));
  }

  setupDateFeedback('f-birth', 'fbirth-norm', 'fbirth-err', 'fbirth-zodiac', true);
  setupDateFeedback('f-hire', 'fh-norm', 'fh-err', null, false);
  setupDateFeedback('f-resign', 'fresign-norm', 'fresign-err', null, false);

  // ── 連絡先フォーム: 電話番号は半角数値・ハイフンのみ ──
  const ctValue = document.getElementById('ct-value');
  if (ctValue) {
    ctValue.addEventListener('input', () => {
      const type = ctValue.dataset.ctType || '';
      if (type !== 'phone' && type !== 'mobile') return;
      const pos = ctValue.selectionStart;
      const cleaned = toHalfWidth(ctValue.value).replace(/[^0-9\-]/g, '');
      if (cleaned !== ctValue.value) {
        ctValue.value = cleaned;
        try { ctValue.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length)); } catch(_){}
      }
    });
    ctValue.addEventListener('paste', e => {
      const type = ctValue.dataset.ctType || '';
      if (type !== 'phone' && type !== 'mobile') return;
      e.preventDefault();
      const text = toHalfWidth((e.clipboardData || window.clipboardData).getData('text') || '')
                     .replace(/[^0-9\-]/g, '');
      document.execCommand('insertText', false, text);
    });
  }
}

/* ================================================================
   DATE SEGMENT INDICATOR
================================================================ */
function initDateSegmentIndicator() {
  const inputs = document.querySelectorAll('.finput-num, .flex-date-input, #f-birth, #f-hire, #f-resign, #te-date, #te-end-date, #le-start, #le-end, #mnm-founded-date, #mnm-dissolved-date, #mnm-cef-start-date, #mnm-cef-end-date');
  
  const ind = document.createElement('div');
  ind.className = 'date-segment-indicator';
  ind.innerHTML = `
    <div class="ds-seg-wrap">
      <button type="button" class="ds-seg" data-seg="year" tabindex="-1">年</button>
      <button type="button" class="ds-seg" data-seg="month" tabindex="-1">月</button>
      <button type="button" class="ds-seg" data-seg="day" tabindex="-1">日</button>
    </div>
    <div class="ds-spin-wrap">
      <button type="button" class="ds-spin-btn" data-dir="1" tabindex="-1" title="増やす(↑)"><i class="fa-solid fa-chevron-up"></i></button>
      <button type="button" class="ds-spin-btn" data-dir="-1" tabindex="-1" title="減らす(↓)"><i class="fa-solid fa-chevron-down"></i></button>
    </div>
  `;
  document.body.appendChild(ind);

  let activeInput = null;
  let trackingRafId = null;
  let lastRectStr = '';

  function spinDateSegment(inp, seg, delta) {
    let val = inp.value.replace(/[^\d\-\/]/g, '').replace(/\//g, '-');
    let p = val.split('-');
    let y = parseInt(p[0]);
    if (isNaN(y)) y = new Date().getFullYear();
    let m = p.length > 1 ? parseInt(p[1]) : null;
    let d = p.length > 2 ? parseInt(p[2]) : null;

    if (seg === 'year') {
      y += delta;
      // 閏年の2月29日補正
      if (m === 2 && d === 29) {
        let maxD = new Date(y, 2, 0).getDate();
        if (d > maxD) d = maxD;
      }
    } else if (seg === 'month') {
      if (m === null) m = new Date().getMonth() + 1;
      m += delta;
      if (m > 12) { m = 1; y += 1; }
      if (m < 1) { m = 12; y -= 1; }
      // 月末日の超過補正（例: 1月31日 → 2月28日）
      if (d !== null) {
        let maxD = new Date(y, m, 0).getDate();
        if (d > maxD) d = maxD;
      }
    } else if (seg === 'day') {
      if (d === null) d = new Date().getDate();
      if (m === null) m = new Date().getMonth() + 1;
      // Dateオブジェクトで月跨ぎ・年跨ぎの繰り上がり/繰り下がりを安全に計算
      let dateObj = new Date(y, m - 1, d + delta);
      y = dateObj.getFullYear();
      m = dateObj.getMonth() + 1;
      d = dateObj.getDate();
    }

    let res = String(y).padStart(4, '0');
    if (m !== null || seg === 'month' || seg === 'day') res += '-' + String(m || 1).padStart(2, '0');
    if (d !== null || seg === 'day')   res += '-' + String(d || 1).padStart(2, '0');
    
    // スピン操作中フラグを立てて、後続のinputイベントによる意図せぬセグメント切り替えをブロック
    inp._isSpinning = true;
    
    // スピン操作したセグメントの領域内にキャレットを維持する
    let newPos = 0;
    if (seg === 'year') newPos = 4;
    else if (seg === 'month') newPos = res.length >= 7 ? 7 : res.length;
    else if (seg === 'day') newPos = res.length;

    inp.value = res;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    try { inp.setSelectionRange(newPos, newPos); } catch(e) {}
    
    inp._isSpinning = false;
  }

  // セグメントボタンのクリックでキャレットを移動させる
  ind.querySelectorAll('.ds-seg').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault(); // フォーカス喪失防止
      if (!activeInput) return;
      const seg = btn.dataset.seg;
      const val = activeInput.value;
      const parts = val.split(/[-/]/);
      let pos = 0;
      if (seg === 'year') {
        pos = parts[0] ? parts[0].length : 0;
      } else if (seg === 'month') {
        pos = parts[0] ? parts[0].length + 1 + (parts[1] ? parts[1].length : 0) : val.length;
      } else if (seg === 'day') {
        pos = val.length;
      }
      try { activeInput.setSelectionRange(pos, pos); } catch(e) {}
      updateIndicatorState();
    });
  });

  ind.querySelectorAll('.ds-spin-btn').forEach(btn => {
    btn.addEventListener('mousedown', e => {
      e.preventDefault(); // 入力欄からのフォーカス喪失を防止
      if (!activeInput) return;
      const dir = parseInt(btn.dataset.dir);
      const activeSegEl = ind.querySelector('.ds-seg.is-active');
      const seg = activeSegEl ? activeSegEl.dataset.seg : 'day';
      spinDateSegment(activeInput, seg, dir);
    });
  });

  // セグメントのアクティブ状態のみを更新（キャレット位置基準）
  function updateIndicatorState() {
    if (!activeInput || activeInput._isSpinning) return;
    
    const val = activeInput.value;
    const pos = activeInput.selectionStart || 0;
    
    const parts = val.split(/[-/]/);
    let seg = 'year';
    let p0Len = parts[0] ? parts[0].length : 0;
    let p1Len = parts[1] ? parts[1].length : 0;
    
    if (pos <= p0Len) {
      seg = 'year';
    } else if (pos <= p0Len + 1 + p1Len) {
      seg = 'month';
    } else {
      seg = 'day';
    }
    
    ind.querySelectorAll('.ds-seg').forEach(el => {
      el.classList.toggle('is-active', el.dataset.seg === seg);
    });
  }

  // ==========================================
  // レイアウトシフトに完全追従するための位置トラッキング
  // ==========================================
  function trackPosition() {
    if (!activeInput) {
      trackingRafId = null;
      return;
    }
    
    const wrap = activeInput.closest('.hire-wrap') || activeInput;
    const rect = wrap.getBoundingClientRect();
    // 座標とサイズを文字列化して変更を検知する
    const rectStr = `${rect.top},${rect.left},${rect.width},${rect.height}`;
    
    if (rectStr !== lastRectStr) {
      lastRectStr = rectStr;
      
      ind.style.display = 'flex';
      const indRect = ind.getBoundingClientRect();
      
      let top = rect.bottom + 6;
      let left = rect.right - indRect.width; // 常に右揃えに配置
      
      // 画面下端にはみ出す場合は上に表示
      if (top + indRect.height > window.innerHeight) {
        top = rect.top - indRect.height - 6;
      }
      // 幅が足りず左端にはみ出す場合は左揃えにフォールバック
      if (left < 8) left = rect.left;

      ind.style.top = top + 'px';
      ind.style.left = left + 'px';
    }
    
    trackingRafId = requestAnimationFrame(trackPosition);
  }

  function startTracking() {
    lastRectStr = ''; // リセット
    if (!trackingRafId) {
      trackPosition();
    }
  }

  function stopTracking() {
    if (trackingRafId) {
      cancelAnimationFrame(trackingRafId);
      trackingRafId = null;
    }
  }

  window._bindDateSegmentIndicator = function(inp) {
    if (inp._dsiBound) return;
    inp._dsiBound = true;
    inp.addEventListener('focus', () => {
      activeInput = inp;
      ind.classList.add('is-visible');
      updateIndicatorState();
      startTracking();
    });
    inp.addEventListener('blur', () => {
      activeInput = null;
      ind.classList.remove('is-visible');
      stopTracking();
      setTimeout(() => {
        if (!activeInput) ind.style.display = 'none';
      }, 150);
    });
    inp.addEventListener('input', updateIndicatorState);
    inp.addEventListener('keyup', updateIndicatorState);
    inp.addEventListener('click', updateIndicatorState);
  };

  inputs.forEach(inp => window._bindDateSegmentIndicator(inp));
}

/* ================================================================
   FLEX DATE PICKER — 従業員モーダル初期化
================================================================ */
function renderApproxAgeList(approxData) {
  const list = document.getElementById('approx-age-list');
  if (!list) return;
  list.innerHTML = '';
  let arr = [];
  if (Array.isArray(approxData) && approxData.length > 0) {
    arr = approxData;
  } else if (approxData && typeof approxData === 'object' && approxData.age != null) {
    arr = [approxData];
  } else {
    arr = [{ age: '', refDate: '' }];
  }

  arr.forEach((item, idx) => {
    addApproxAgeRow(list, item.age, item.refDate, idx === 0);
  });
  updateApproxHint();
}

function addApproxAgeRow(list, age, refDate, isFirst) {
  const row = document.createElement('div');
  row.className = 'approx-age-row approx-age-item';
  row.style.marginBottom = '6px';
  
  const ageId = 'f-approx-age-' + uid();
  const refId = 'f-approx-refdate-' + uid();
  
  row.innerHTML = `
    <div class="fg" style="margin-bottom:0">
      ${isFirst ? '<span class="approx-flbl">基準日</span>' : ''}
      <div style="display:flex;gap:6px;align-items:center">
        <div class="hire-wrap">
          <input type="text" class="finput finput-num w-sm inp-approx-refdate flex-date-input" id="${refId}" placeholder="YYYY-MM-DD" autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off" data-lpignore="true" data-1p-ignore="true" inputmode="numeric" value="${refDate || ''}">
          <button type="button" class="btn-cal btn-approx-cal" title="カレンダーで選択"><i class="fa-solid fa-calendar-days"></i></button>
        </div>
        <button type="button" class="btn-cal btn-approx-today" title="今日"><i class="fa-regular fa-calendar-check"></i></button>
      </div>
    </div>
    <div class="fg" style="margin-bottom:0">
      ${isFirst ? '<span class="approx-flbl">当時の年齢</span>' : ''}
      <div style="display:flex;align-items:center;gap:6px">
        <input type="number" class="finput w-xs inp-approx-age" id="${ageId}" min="0" max="120" placeholder="35" inputmode="numeric" value="${age !== null && age !== undefined ? age : ''}">
        <span style="font-size:13px;color:var(--c-text-2)">歳</span>
        ${!isFirst ? `<button type="button" class="btn btn-ghost btn-icon-sm btn-remove-approx" title="削除" style="color:var(--c-danger); margin-left:4px;"><i class="fa-solid fa-trash-can"></i></button>` : `<div style="width:34px; margin-left:4px;"></div>`}
      </div>
    </div>
  `;

  list.appendChild(row);

  const inpRef = row.querySelector('.inp-approx-refdate');
  if (typeof FlexDatePicker !== 'undefined') {
    new FlexDatePicker(inpRef, { minPrec: 'year', maxPrec: 'day', normalize: normalizeFlexDate });
  }
  
  inpRef.addEventListener('focus', () => {
    if (typeof _bindDateSegmentIndicator === 'function') {
      _bindDateSegmentIndicator(inpRef);
    }
  });

  row.querySelector('.btn-approx-today').addEventListener('click', () => {
    inpRef.value = new Date().toISOString().slice(0, 10);
    inpRef.dispatchEvent(new Event('input', {bubbles: true}));
    updateApproxHint();
  });

  const btnRm = row.querySelector('.btn-remove-approx');
  if (btnRm) {
    btnRm.addEventListener('click', () => {
      row.remove();
      updateApproxHint();
      markEmpDirty();
    });
  }

  row.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => {
      updateApproxHint();
      markEmpDirty();
    });
    inp.addEventListener('change', markEmpDirty);
  });
}

function updateApproxHint() {
  const hint = document.getElementById('approx-hint-text');
  if (!hint) return;

  const approxList = [];
  document.querySelectorAll('.approx-age-item').forEach(row => {
    const ageVal = row.querySelector('.inp-approx-age').value;
    const refDateRaw = row.querySelector('.inp-approx-refdate').value.trim();
    const refDate = refDateRaw ? (normalizeFlexDate(refDateRaw) ?? '') : '';
    const age = parseInt(ageVal, 10);
    if (!isNaN(age) && age >= 0 && refDate) {
      approxList.push({ age, refDate });
    }
  });

  if (approxList.length === 0) {
    hint.innerHTML = '<i class="fa-solid fa-circle-info" style="color:#D97706"></i>基準日時点の年齢から現在の年齢を概算します';
    return;
  }

  const range = estimateBirthDateRange(approxList);
  if (!range) {
    hint.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:var(--c-danger)"></i>入力されたデータに矛盾があり、推定できません';
    return;
  }

  const minD = new Date(range.minTime);
  const maxD = new Date(range.maxTime);
  const diffDays = Math.round((range.maxTime - range.minTime) / (1000 * 60 * 60 * 24));
  
  const estD = new Date((range.minTime + range.maxTime) / 2);
  const t = new Date();
  let estAge = t.getFullYear() - estD.getFullYear();
  if (t.getMonth() < estD.getMonth() || (t.getMonth() === estD.getMonth() && t.getDate() < estD.getDate())) estAge--;

  let msg = `<i class="fa-solid fa-circle-info" style="color:#10B981"></i>推定生年月日: ${minD.getFullYear()}/${String(minD.getMonth()+1).padStart(2,'0')}/${String(minD.getDate()).padStart(2,'0')} 〜 ${maxD.getFullYear()}/${String(maxD.getMonth()+1).padStart(2,'0')}/${String(maxD.getDate()).padStart(2,'0')}（幅: ${diffDays}日）<br>現在年齢の推定: <strong>${estAge}歳</strong>`;
  
  if (diffDays === 0) {
    msg = `<i class="fa-solid fa-circle-check" style="color:#10B981"></i>生年月日を <strong>${minD.getFullYear()}/${String(minD.getMonth()+1).padStart(2,'0')}/${String(minD.getDate()).padStart(2,'0')}</strong> に特定しました<br>現在年齢: <strong>${estAge}歳</strong>`;
  }
  
  hint.innerHTML = msg;
}

function initFlexDatePickers() {
  if (typeof FlexDatePicker === 'undefined') return;

  const normHire  = s => normalizeHireDate(s);
  const normBirth = s => normalizeBirthDate(s);

  const configs = [
    { id: 'f-hire', minPrec: 'year', maxPrec: 'day', norm: normHire },
    { id: 'f-birth', minPrec: 'year', maxPrec: 'day', norm: normBirth },
    { id: 'f-resign', minPrec: 'year', maxPrec: 'day', norm: normHire },
    { id: 'te-date', minPrec: 'day', maxPrec: 'day', norm: normHire },
    { id: 'te-end-date', minPrec: 'day', maxPrec: 'day', norm: normHire },
    { id: 'le-start', minPrec: 'day', maxPrec: 'day', norm: normHire },
    { id: 'le-end', minPrec: 'day', maxPrec: 'day', norm: normHire },
    { id: 're-date', minPrec: 'day', maxPrec: 'day', norm: normHire },
    { id: 're-rejoin-date', minPrec: 'day', maxPrec: 'day', norm: normHire }
  ];

  configs.forEach(cfg => {
    const el = document.getElementById(cfg.id);
    if (el) {
      new FlexDatePicker(el, { minPrec: cfg.minPrec, maxPrec: cfg.maxPrec, normalize: cfg.norm });
    }
  });
  
  /// (年齢で代用の基準日は動的生成されるため renderApproxAgeList の中で個別に初期化します)
}

/* ================================================================
   EVENTS
================================================================ */
function initEvents() {
  initAvatarEvents();
  initInputAssist();

  // Birth mode
  document.getElementById('birth-mode-seg').addEventListener('click', e => { const btn = e.target.closest('.bmt-btn'); if (btn) setBirthMode(btn.dataset.mode); });
  document.getElementById('btn-add-approx')?.addEventListener('click', () => {
    const list = document.getElementById('approx-age-list');
    addApproxAgeRow(list, '', '', false);
    updateApproxHint();
  });

  // Employee modal tabs
  document.getElementById('emp-modal-tabs').addEventListener('click', e => { const tab = e.target.closest('.modal-tab'); if (tab && tab.dataset.pane) switchEmpModalTab(tab.dataset.pane); });

  // Transfer history
  document.getElementById('btn-transfer-sort')?.addEventListener('click', () => {
    transferSortDir = transferSortDir === 'asc' ? 'desc' : 'asc';
    const icon = document.getElementById('icon-transfer-sort');
    if (icon) icon.className = transferSortDir === 'asc' ? 'fa-solid fa-arrow-down-1-9' : 'fa-solid fa-arrow-down-9-1';
    renderTransferTimeline();
  });
  document.getElementById('btn-transfer-add').addEventListener('click', () => openTransferEdit());
  document.getElementById('btn-transfer-cancel').addEventListener('click', closeTransferEdit);
  document.getElementById('btn-transfer-save').addEventListener('click', saveTransferEdit);
  
  // 種別セグメントコントロール
  document.getElementById('te-kind-seg')?.addEventListener('click', e => {
    const btn = e.target.closest('.trkind-btn');
    if (!btn) return;
    const kind = btn.dataset.kind;
    if (kind === 'leave') {
      openLeaveEdit(); 
    } else if (kind === 'resignation') {
      openResignationEdit();
    } else {
      document.getElementById('te-kind').value = kind;
      _syncTrKindUI(kind, document.getElementById('te-id').value ? 'edit' : 'add');
      // 種別変更時に日付モードをリセット
      let mode = 'start';
      if (kind === 'removePosition' || kind === 'endAssignment') mode = 'end';
      setTransferDateMode(mode);
    }
  });

  // 日付入力モード セグメントコントロール
  document.getElementById('te-date-mode-seg')?.addEventListener('click', e => {
    const btn = e.target.closest('.bmt-btn');
    if (btn) setTransferDateMode(btn.dataset.mode);
  });

  // Leave (休職・休業)
  document.getElementById('btn-leave-cancel')?.addEventListener('click', closeLeaveEdit);
  document.getElementById('btn-leave-save')?.addEventListener('click', saveLeaveEdit);

  // Resignation (退職)
  document.getElementById('btn-resignation-cancel')?.addEventListener('click', closeResignationEdit);
  document.getElementById('btn-resignation-save')?.addEventListener('click', saveResignationEdit);

  // Contacts
  document.getElementById('btn-contact-add')?.addEventListener('click', () => openContactEdit());
  document.getElementById('btn-contact-cancel')?.addEventListener('click', closeContactEdit);
  document.getElementById('btn-contact-save')?.addEventListener('click', saveContactEdit);
  document.getElementById('ct-type')?.addEventListener('change', _updateContactValueField);
  let _ctGeoTimer = null;
  document.getElementById('ct-value')?.addEventListener('input', () => {
    if (document.getElementById('ct-type')?.value !== 'address') return;
    const statusEl = document.getElementById('ct-geo-status');
    const addr = document.getElementById('ct-value')?.value.trim();
    if (!addr) { if (statusEl) statusEl.style.display = 'none'; return; }
    clearTimeout(_ctGeoTimer);
    _ctGeoTimer = setTimeout(() => {
      if (typeof validateAddressUI === 'function') validateAddressUI(addr, statusEl);
    }, 800);
  });

  // Nav
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => { if (btn.dataset.view) switchView(btn.dataset.view); }));

  // Global Filter サイドバー
  document.getElementById('btn-fsb-expand')?.addEventListener('click', toggleGlobalFilterPanel);
  document.getElementById('btn-gfp-reset')?.addEventListener('click', e => { e.stopPropagation(); resetGlobalFilter(); });
  document.getElementById('btn-gfp-close')?.addEventListener('click', () => {
    const panel = document.getElementById('global-filter-panel');
    if (panel) { panel.classList.remove('is-open'); _saveFilterSidebarState(false); }
  });

  // List filters
  ['btn-add-emp', 'btn-dist-add-emp'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => openEmpModal());
  });
  document.getElementById('ls-search').addEventListener('input',   e => { listFilters.search   = e.target.value; renderList(); });
  document.getElementById('dist-search')?.addEventListener('input', updateDistHighlight);
  
  const toggleSearchMarker = () => {
    DB.settings.showSearchMarker = !DB.settings.showSearchMarker;
    saveDB(); updateSearchMarkerBtns();
    if (currentView === 'list') renderList();
    if (currentView === 'distribution') updateDistHighlight();
  };
  document.getElementById('btn-ls-marker-toggle')?.addEventListener('click', toggleSearchMarker);
  document.getElementById('btn-dist-marker-toggle')?.addEventListener('click', toggleSearchMarker);

  document.getElementById('btn-save-emp').addEventListener('click', saveEmployee);
  document.getElementById('btn-save-tag')?.addEventListener('click', saveTag);

  document.getElementById('te-date')?.addEventListener('input', updateTargetOrgSelect);
  document.getElementById('te-end-date')?.addEventListener('input', updateTargetOrgSelect);

  initHeaderVersion();

  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    if (document.body.getAttribute('data-theme') === 'dark') {
      document.body.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
      document.getElementById('btn-theme-toggle').innerHTML = '<i class="fa-solid fa-moon"></i>';
    } else {
      document.body.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
      document.getElementById('btn-theme-toggle').innerHTML = '<i class="fa-solid fa-sun"></i>';
    }
  });

  // FlexDatePicker 初期化（カレンダー入力補助）
  initFlexDatePickers();
  initDateSegmentIndicator();

  // 在籍状況変更 → 退職年月日フィールドの表示切替
  document.getElementById('f-status-group')?.addEventListener('change', e => {
    if (e.target.name === 'f-status') _updateResignDateVisibility(e.target.value);
  });

  // 従業員削除ボタン（モーダルフッター）
  document.getElementById('btn-delete-emp')?.addEventListener('click', () => {
    const empId = document.getElementById('f-id').value;
    if (!empId) return;
    const emp = DB.employees.find(e => e.id === empId);
    if (!emp) return;
    openConfirm(
      `「${emp.lastName} ${emp.firstName}」を削除します。\nアバター画像も含め、この操作は取り消せません。`,
      () => { forceCloseModal('emp-modal'); deleteEmp(empId); },
      { title:'従業員削除の確認', okLabel:'削除する', okIcon:'fa-solid fa-trash-can',
        okClass:'btn btn-danger', innerIcon:'fa-solid fa-user-minus', innerColor:'var(--c-danger)' }
    );
  });

  // Axis sort direction
  document.getElementById('btn-yaxis-dir').addEventListener('click', () => {
    DB.settings.yAxisDir = (DB.settings.yAxisDir || 'desc') === 'desc' ? 'asc' : 'desc'; saveDB(); updateSortDirBtn(); renderDist();
  });

  // Y-axis picker
  const yaxBtn = document.getElementById('btn-yaxis-picker'), yaxWrap = document.getElementById('yaxis-picker-wrap');
  if (yaxBtn && yaxWrap) {
    yaxBtn.addEventListener('click', e => { e.stopPropagation(); if (yaxWrap.classList.contains('is-open')) closeYAxisPanel(); else openYAxisPanel(); });
    document.addEventListener('click', e => { if (yaxWrap && !yaxWrap.contains(e.target)) closeYAxisPanel(); });
  }

  // Split toggle
  const spSel = document.getElementById('dist-split-sel');
  if (spSel) spSel.addEventListener('change', e => { DB.settings.split = e.target.value; saveDB(); updateThreshSlider(); renderDist(); });

  // Threshold slider
  document.getElementById('thresh-slider').addEventListener('input', e => {
    const split = DB.settings.split, val = parseInt(e.target.value);
    if (split === 'age_thresh') { DB.settings.numericThreshold.age = val; document.getElementById('thresh-val-badge').textContent = val + '歳'; }
    else if (split === 'years_thresh') { DB.settings.numericThreshold.years = val; document.getElementById('thresh-val-badge').textContent = val + '年'; }
    saveDB(); renderDist();
  });

  // Card color mode
  document.getElementById('sel-card-color').addEventListener('change', e => { DB.settings.cardColorMode = e.target.value; saveDB(); renderDist(); });

  // Wareki toggle
  document.getElementById('btn-toggle-wareki')?.addEventListener('click', () => {
    DB.settings.showWareki = !DB.settings.showWareki; updateWarekiBtn(); saveDB();
    if (currentView === 'distribution') renderDist();
  });

  // Badge toggles
  document.querySelectorAll('.btog').forEach(lbl => {
    const inp = lbl.querySelector('input'), badge = lbl.dataset.badge;
    inp.addEventListener('change', () => { DB.settings.badges[badge] = inp.checked; lbl.classList.toggle('is-on', inp.checked); saveDB(); renderDist(); });
  });

  // Dist Settings Panel
  const dsBtn = document.getElementById('btn-dist-settings'), dsPanel = document.getElementById('dist-settings-panel');
  if (dsBtn && dsPanel) {
    dsBtn.addEventListener('click', e => { e.stopPropagation(); dsPanel.classList.toggle('open'); dsBtn.classList.toggle('is-active', dsPanel.classList.contains('open')); });
    document.addEventListener('click', e => { const wrap = document.getElementById('dist-settings-wrap'); if (wrap && !wrap.contains(e.target)) { dsPanel.classList.remove('open'); dsBtn.classList.remove('is-active'); } });
  }

  document.getElementById('bfp-all').addEventListener('click', e => { e.stopPropagation(); document.querySelectorAll('.btog').forEach(lbl => { const inp = lbl.querySelector('input'); inp.checked = true; lbl.classList.add('is-on'); DB.settings.badges[lbl.dataset.badge] = true; }); saveDB(); renderDist(); });
  document.getElementById('bfp-none').addEventListener('click', e => { e.stopPropagation(); document.querySelectorAll('.btog').forEach(lbl => { const inp = lbl.querySelector('input'); inp.checked = false; lbl.classList.remove('is-on'); DB.settings.badges[lbl.dataset.badge] = false; }); saveDB(); renderDist(); });

  // Confirm
  document.getElementById('btn-confirm-ok').addEventListener('click', () => { confirmCb?.(); confirmCb = null; closeModal('confirm-modal'); });

  // Duplicate name check
  ['f-last', 'f-first'].forEach(id => document.getElementById(id).addEventListener('blur', checkEmpNameDuplicate));
  document.getElementById('emp-dup-dismiss').addEventListener('click', hideEmpDupBanner);
  document.getElementById('btn-dup-list').addEventListener('click', openDataDupModal);
  document.getElementById('btn-master-dup-check')?.addEventListener('click', openDataDupModal);

  // Context Menu
  if (typeof initListContextMenu === 'function') {
    initListContextMenu();
  }

  // Heatmap
  if (typeof initHeatmapEvents === 'function') {
    initHeatmapEvents();
  }

  // Image capture
  document.getElementById('btn-dist-capture').addEventListener('click', () => openExportModal('distribution'));
  document.getElementById('btn-hm-capture').addEventListener('click',   () => openExportModal('heatmap'));
  document.getElementById('btn-do-export').addEventListener('click',    doExportImages);

  // Data export/import
  document.getElementById('btn-export-csv')?.addEventListener('click', exportDataCSV);
  document.getElementById('btn-export-json').addEventListener('click', exportDataZIP);
  document.getElementById('btn-import-json').addEventListener('click', () => { document.getElementById('import-json-input').dataset.fromWelcome = ''; document.getElementById('import-json-input').value = ''; document.getElementById('import-json-input').click(); });
  document.getElementById('import-json-input').addEventListener('change', e => { if (e.target.files[0]) handleImportFile(e.target.files[0], e.target.dataset.fromWelcome === '1'); });

  document.getElementById('btn-clear-all').addEventListener('click', clearAllData);

  document.getElementById('btn-show-empty-rows').addEventListener('click', () => {
    DB.settings.showEmptyRows = !DB.settings.showEmptyRows; updateEmptyRowsBtn(); saveDB();
    if (currentView === 'distribution') renderDist();
  });

  // Import diff modal
  document.querySelectorAll('.imode-card').forEach(card => { card.addEventListener('click', () => { document.querySelectorAll('.imode-card').forEach(c => c.classList.remove('is-sel')); card.classList.add('is-sel'); const r = card.querySelector('input[type="radio"]'); if (r) r.checked = true; }); });
  document.getElementById('btn-do-import').addEventListener('click', execImport);

  // Column settings
  document.getElementById('btn-col-settings').addEventListener('click', e => { e.stopPropagation(); document.getElementById('col-panel').classList.toggle('open'); });
  document.getElementById('btn-col-reset').addEventListener('click', e => { e.stopPropagation(); resetListCols(); });
  document.addEventListener('click', e => { const wrap = document.getElementById('col-settings-wrap'); if (wrap && !wrap.contains(e.target)) document.getElementById('col-panel').classList.remove('open'); });

  // Close buttons
  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
  
  // 背景（オーバーレイ）クリック時の保護（閉じずにシェイクアニメーションで注意を促す）
  document.querySelectorAll('.overlay').forEach(ov => ov.addEventListener('click', e => {
    if (e.target === ov) {
      const modal = ov.querySelector('.modal');
      if (modal) {
        // アニメーションを再トリガーするために一度クラスを外してリフローを強制
        modal.classList.remove('modal-shake');
        void modal.offsetWidth; 
        modal.classList.add('modal-shake');
        
        // 従業員編集モーダルの場合は、未保存状態を強調表示する
        if (ov.id === 'emp-modal' && typeof empDirty !== 'undefined' && empDirty) {
          showEmpDirtyBanner();
          toast('未保存の変更があります。「変更を破棄して閉じる」か「未保存の変更を保存」を選択してください');
        }
      }
    }
  }));

  // Emp cancel button
  document.getElementById('btn-cancel-emp')?.addEventListener('click', () => {
    if (typeof empDirty !== 'undefined' && empDirty) {
      forceCloseModal('emp-modal');
    } else {
      closeModal('emp-modal');
    }
  });

  // 写真アイコン ON/OFF
  document.getElementById('btn-toggle-card-avatar')?.addEventListener('click', () => { DB.settings.showCardAvatar = !DB.settings.showCardAvatar; updateCardAvatarBtn(); saveDB(); if (currentView === 'distribution') renderDist(); });

  // ポップアップ ON/OFF
  document.getElementById('btn-toggle-popup')?.addEventListener('click', () => { DB.settings.cardPopup.enabled = !DB.settings.cardPopup.enabled; updatePopupBtn(); saveDB(); });

  // ポップアップサイズ
  document.querySelectorAll('input[name="popup-size"]').forEach(r => { r.addEventListener('change', () => { DB.settings.cardPopup.size = r.value; saveDB(); }); });

  // ポップアップ表示内容
  document.querySelectorAll('.btog-popup').forEach(lbl => {
    const inp = lbl.querySelector('input'), key = lbl.dataset.popup;
    inp.addEventListener('change', () => { DB.settings.cardPopup[key] = inp.checked; lbl.classList.toggle('is-on', inp.checked); saveDB(); });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const o = document.querySelector('.overlay.open'); if (o) closeModal(o.id); }
    if (e.ctrlKey && e.key === 'n' && currentView === 'list' && !document.querySelector('.overlay.open')) { e.preventDefault(); openEmpModal(); }
  });
}

/* ================================================================
   RESTORE UI STATE
================================================================ */
function restoreUI() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    const themeBtn = document.getElementById('btn-theme-toggle');
    if (themeBtn) themeBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
  }

  if (typeof syncYAxisPicker === 'function') syncYAxisPicker();
  const splitVal = DB.settings.split || '';
  const spSel = document.getElementById('dist-split-sel'); if (spSel) spSel.value = splitVal;
  Object.entries(DB.settings.badges).forEach(([key, val]) => {
    const lbl = document.querySelector(`.btog[data-badge="${key}"]`); if (!lbl) return;
    lbl.querySelector('input').checked = val; lbl.classList.toggle('is-on', val);
  });
  const ccSel = document.getElementById('sel-card-color'); if (ccSel && DB.settings.cardColorMode) ccSel.value = DB.settings.cardColorMode;
  updateThreshSlider(); updateSortDirBtn(); updateEmptyRowsBtn();
  updateStatusFilterUI(); updateScStyleBtn();
  updateCardAvatarBtn(); updatePopupBtn(); restorePopupSettings(); updateWarekiBtn();
  updateDupListBtn();
  updateSearchMarkerBtns();

  // フィルターサイドバーの初期状態を復元（前回の開閉状態を引き継ぐ）
  _restoreFilterSidebarState();
}

/* ================================================================
   ALL CLEAR
================================================================ */
function clearAllData() {
  openConfirm(
    `従業員 ${DB.employees.length}名・タグ ${DB.tags.length}件を含む、すべてのデータを削除します。\nこの操作は取り消せません。本当によろしいですか？`,
    async () => {
      const db = await initDB();
      db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).clear();
      avatarMap.forEach(url => URL.revokeObjectURL(url)); avatarMap.clear();
      DB.employees = []; DB.tags = [];
      DB.masters = { school:[], company:[], ...getInitialMasters() };
      saveDB(); closeModal('confirm-modal'); refreshAll(); renderTagMaster();
      if (currentView === 'masters') renderMasterView();
      updateHeaderCnt(); toast('すべてのデータを削除しました');
      localStorage.removeItem(WELCOME_KEY); openWelcome();
    },
    { title:'全データ削除の確認', icon:'fa-solid fa-triangle-exclamation', iconColor:'var(--c-danger)', innerIcon:'fa-solid fa-trash-can', innerColor:'var(--c-danger)', okLabel:'全データを削除する', okIcon:'fa-solid fa-trash-can', okClass:'btn btn-danger' }
  );
}

/* ================================================================
   WELCOME SCREEN
================================================================ */
const WELCOME_KEY = 'emp_dist_welcomed';
function openWelcome() {
  const ov = document.getElementById('welcome-overlay'); ov.classList.remove('wc-hidden');
  const hasData = DB.employees.length > 0;
  document.getElementById('wc-existing-note').style.display = hasData ? '' : 'none';
  if (hasData) document.getElementById('wc-existing-msg').textContent = `保存済みのデータが見つかりました（${DB.employees.length}名）。そのまま続けることができます。`;
  document.getElementById('wc-actions-normal').style.display   = hasData ? 'none' : '';
  document.getElementById('wc-actions-existing').style.display = hasData ? '' : 'none';
}
function closeWelcome() { document.getElementById('welcome-overlay').classList.add('wc-hidden'); localStorage.setItem(WELCOME_KEY, '1'); }
function initWelcomeEvents() {
  const fileInput = document.getElementById('import-json-input');
  document.getElementById('wc-btn-sample')?.addEventListener('click', () => { DB.employees = []; DB.tags = []; DB.masters = { school:[], company:[], ...getInitialMasters() }; initSampleData(); refreshAll(); renderTagMaster(); updateHeaderCnt(); closeWelcome(); toast('サンプルデータを読み込みました'); });
  document.getElementById('wc-btn-empty')?.addEventListener('click',  () => { DB.employees = []; DB.tags = []; DB.masters = { school:[], company:[], ...getInitialMasters() }; saveDB(); refreshAll(); renderTagMaster(); updateHeaderCnt(); closeWelcome(); });
  document.getElementById('wc-btn-continue')?.addEventListener('click', () => closeWelcome());
  document.getElementById('wc-btn-reset')?.addEventListener('click', () => {
    openConfirm('すべてのデータを削除して、ウェルカム画面に戻ります。よろしいですか？', () => {
      DB.employees = []; DB.tags = []; DB.masters = { school:[], company:[], ...getInitialMasters() }; saveDB(); localStorage.removeItem(WELCOME_KEY);
      closeModal('confirm-modal'); refreshAll(); updateHeaderCnt();
      document.getElementById('wc-actions-normal').style.display   = '';
      document.getElementById('wc-actions-existing').style.display = 'none';
      document.getElementById('wc-existing-note').style.display    = 'none';
      openWelcome();
    }, { title:'リセットの確認', icon:'fa-solid fa-rotate-left', iconColor:'var(--c-warn)', innerIcon:'fa-solid fa-rotate-left', innerColor:'var(--c-warn)', okLabel:'リセットする', okIcon:'fa-solid fa-rotate-left', okClass:'btn btn-danger' });
  });
  document.getElementById('wc-import-row')?.addEventListener('click', () => { fileInput.dataset.fromWelcome = '1'; fileInput.value = ''; fileInput.click(); });
  document.getElementById('btn-help')?.addEventListener('click', () => openWelcome());
}

/* ================================================================
   UI STATE UPDATE HELPERS
================================================================ */
function updateStatusFilterUI() { renderDistStatusFilter(); }
function updateScStyleBtn() {
  const btn = document.getElementById('btn-sc-style'); if (!btn) return;
  btn.classList.add('is-on'); btn.title = '在籍状況マスタの設定色をカード背景色に連動';
}
function updateSortDirBtn() {
  const dir = DB.settings.yAxisDir || 'desc';
  const btn = document.getElementById('btn-yaxis-dir'), lbl = document.getElementById('sort-dir-lbl');
  if (btn) btn.classList.toggle('is-asc', dir === 'asc');
  if (lbl) lbl.textContent = dir === 'asc' ? '昇順' : '降順';
}
function updateEmptyRowsBtn() {
  const btn = document.getElementById('btn-show-empty-rows'); if (!btn) return;
  const on = !!DB.settings.showEmptyRows; btn.classList.toggle('is-on', on);
  btn.title = on ? '空行を非表示にする' : 'データなし行を表示する';
}
function updateCardAvatarBtn() {
  const btn = document.getElementById('btn-toggle-card-avatar'); if (!btn) return;
  const on = DB.settings.showCardAvatar !== false; btn.classList.toggle('is-on', on);
  btn.querySelector('span').textContent = on ? '写真を表示' : '写真を非表示';
}
function updatePopupBtn() {
  const btn = document.getElementById('btn-toggle-popup'); if (!btn) return;
  const on = DB.settings.cardPopup.enabled !== false; btn.classList.toggle('is-on', on);
  btn.querySelector('span').textContent = on ? 'ポップアップを表示' : 'ポップアップを非表示';
  const sub = document.getElementById('popup-sub-settings'); if (sub) sub.classList.toggle('is-disabled', !on);
}
function updateWarekiBtn() {
  const btn = document.getElementById('btn-toggle-wareki'); if (!btn) return;
  const on = !!DB.settings.showWareki; btn.classList.toggle('is-on', on);
  btn.querySelector('span').textContent = on ? '和暦を表示中' : '和暦を表示';
}
function updateSearchMarkerBtns() {
  const on = !!DB.settings.showSearchMarker;
  document.getElementById('btn-ls-marker-toggle')?.classList.toggle('is-active', on);
  document.getElementById('btn-dist-marker-toggle')?.classList.toggle('is-active', on);
}
function restorePopupSettings() {
  const cfg = DB.settings.cardPopup;
  const sizeVal = cfg.size || 'md';
  document.querySelectorAll('input[name="popup-size"]').forEach(r => { r.checked = r.value === sizeVal; });
  document.querySelectorAll('.btog-popup').forEach(lbl => {
    const key = lbl.dataset.popup, inp = lbl.querySelector('input'), val = cfg[key] !== false;
    inp.checked = val; lbl.classList.toggle('is-on', val);
  });
}

/* ================================================================
   IMAGE VIEWER (Lightbox for Avatar)
================================================================ */
function openImageViewer(url, altText = '') {
  if (!url) return;
  let overlay = document.getElementById('image-viewer-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'image-viewer-overlay';
    overlay.className = 'image-viewer-overlay';
    overlay.innerHTML = `
      <button class="image-viewer-close" title="閉じる"><i class="fa-solid fa-xmark"></i></button>
      <img class="image-viewer-img" src="" alt="High Resolution Image">
      <div class="image-viewer-hint">クリックまたは Escキー で閉じる</div>
    `;
    document.body.appendChild(overlay);

    const closeViewer = () => {
      overlay.classList.remove('is-visible');
      setTimeout(() => overlay.style.display = 'none', 200);
    };

    overlay.addEventListener('click', closeViewer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && overlay.classList.contains('is-visible')) {
        closeViewer();
      }
    });
  }
  
  const img = overlay.querySelector('.image-viewer-img');
  img.src = url;
  img.alt = altText;
  
  overlay.style.display = 'flex';
  // 強制リフローでCSSアニメーションをトリガー
  void overlay.offsetWidth;
  overlay.classList.add('is-visible');
}