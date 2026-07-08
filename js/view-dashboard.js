'use strict';

/* ================================================================
   DASHBOARD VIEW  ―  Chart.js v4 ベース
================================================================ */

const _dc = {};
let _dbResizeObs = null;

/* ── ドーナツ中央テキスト描画プラグイン ── */
const _centerPlugin = {
  id: '_centerPlugin',
  beforeDraw(chart) {
    const opts = chart.options?.plugins?.centerLabel;
    if (!opts?.text) return;
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top  + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = "700 17px 'DM Sans','Noto Sans JP',sans-serif";
    ctx.fillStyle    = '#0F172A';
    ctx.fillText(opts.text, cx, cy - (opts.sub ? 8 : 0));
    if (opts.sub) {
      ctx.font      = "400 10px 'DM Sans','Noto Sans JP',sans-serif";
      ctx.fillStyle = '#94A3B8';
      ctx.fillText(opts.sub, cx, cy + 10);
    }
    ctx.restore();
  }
};

/* ================================================================
   CHART CARD DEFINITIONS
================================================================ */
const _CHART_DEFS = {
  gender:   { icon:'fa-solid fa-venus-mars',    title:'性別比率',       sub:null,        type:'donut',  canvasId:'db-c-gender',   render: _renderGender   },
  age:      { icon:'fa-solid fa-people-group',  title:'年代別分布',     sub:null,        type:'bar',    canvasId:'db-c-age',      render: _renderAge      },
  status:   { icon:'fa-solid fa-circle-dot',    title:'在籍状況',       sub:null,        type:'donut',  canvasId:'db-c-status',   render: _renderStatus   },
  recent:   { icon:'fa-solid fa-user-plus',     title:'直近入社者',     sub:'過去12ヶ月', type:'list',   canvasId:null,            render: _renderRecentList },
  trend:    { icon:'fa-solid fa-chart-column',  title:'入社年別人数推移', sub:null,       type:'trend',  canvasId:'db-c-trend',    render: _renderTrend    },
  hireType: { icon:'fa-solid fa-door-open',     title:'入社区分',       sub:null,        type:'donut',  canvasId:'db-c-hiretype', render: _renderHireType },
};

const _DASH_DEFAULT_LAYOUT = ['gender','age','status','recent','trend','hireType'];

function _getLayout() {
  const s = DB.settings.dashLayout;
  if (Array.isArray(s) && s.length === 6 && s.every(id => id in _CHART_DEFS)) return [...s];
  return [..._DASH_DEFAULT_LAYOUT];
}

/* ================================================================
   STATISTICS
================================================================ */
function _dashStats() {
  const emps = applyGlobalFilter(DB.employees);
  const now  = new Date();
  const byStatus={}, byGender={}, byHireType={}, byHireYear={};
  const AGE_KEYS = ['10代','20代','30代','40代','50代','60代以上'];
  const ageGroups = Object.fromEntries(AGE_KEYS.map(k=>[k,0]));

  emps.forEach(e => {
    const s=e.status||'不明';   byStatus[s]  =(byStatus[s]  ||0)+1;
    const g=e.gender||'不明';   byGender[g]  =(byGender[g]  ||0)+1;
    const h=e.hireType||'不明'; byHireType[h]=(byHireType[h]||0)+1;
    const y=parseHireYear(e.hireDate); if(y) byHireYear[y]=(byHireYear[y]||0)+1;
    const age=getEmpAge(e);
    if(age!==null){
      if(age<20)ageGroups['10代']++;
      else if(age<30)ageGroups['20代']++;
      else if(age<40)ageGroups['30代']++;
      else if(age<50)ageGroups['40代']++;
      else if(age<60)ageGroups['50代']++;
      else ageGroups['60代以上']++;
    }
  });

  const ageList=emps.map(e=>getEmpAge(e)).filter(a=>a!==null).sort((a,b)=>a-b);
  const yrsList=emps.map(e=>calcYears(e.hireDate)).filter(y=>y!==null).sort((a,b)=>a-b);
  const avgAge  =ageList.length?ageList.reduce((a,b)=>a+b,0)/ageList.length:null;
  const avgYears=yrsList.length?yrsList.reduce((a,b)=>a+b,0)/yrsList.length:null;
  const medAge = ageList.length ? (ageList.length % 2 === 0 ? (ageList[ageList.length/2 - 1] + ageList[ageList.length/2]) / 2 : ageList[Math.floor(ageList.length/2)]) : null;
  const medYears = yrsList.length ? (yrsList.length % 2 === 0 ? (yrsList[yrsList.length/2 - 1] + yrsList[yrsList.length/2]) / 2 : yrsList[Math.floor(yrsList.length/2)]) : null;

  const cutoff=new Date(now.getFullYear()-1,now.getMonth(),now.getDate());
  const allRecent=[...emps]
    .filter(e=>e.hireDate&&new Date(e.hireDate)>=cutoff)
    .sort((a,b)=>new Date(b.hireDate)-new Date(a.hireDate));

  return {
    total:emps.length, byStatus, byGender, byHireType, byHireYear,
    ageGroups, avgAge, avgYears, medAge, medYears, ageWithData:ageList.length,
    hireYears:Object.keys(byHireYear).map(Number).sort((a,b)=>a-b),
    recentHires:allRecent.slice(0,8), recentHireCount:allRecent.length,
  };
}

/* ================================================================
   HTML BUILDERS
================================================================ */
function _kpiCard(icon, iconBg, iconColor, value, unit, label, sub) {
  return `<div class="db-kpi-card">
    <div class="db-kpi-icon" style="background:${iconBg};color:${iconColor}"><i class="${icon}"></i></div>
    <div class="db-kpi-body">
      <div class="db-kpi-value">${value}<span class="db-kpi-unit">${unit}</span></div>
      <div class="db-kpi-label">${label}</div>
      ${sub?`<div class="db-kpi-sub">${sub}</div>`:''}
    </div>
  </div>`;
}

function _chartCardHTML(chartId, idx, total) {
  const def = _CHART_DEFS[chartId];
  if (!def) return '';
  const canLeft  = idx > 0;
  const canRight = idx < total - 1;
  const bodyType = chartId==='trend'?'trend': def.type==='list'?'list': def.type==='bar'?'bar':'donut';
  const bodyInner = def.type==='list'
    ? `<div class="db-recent-list" id="db-recent-list"></div>`
    : `<div class="db-chart-wrap"><canvas id="${def.canvasId}"></canvas></div>`;
  return `<div class="db-card" data-chart-id="${chartId}" draggable="true">
    <div class="db-card-hd">
      <div class="db-card-icon-wrap"><i class="${def.icon} db-card-icon"></i></div>
      <span class="db-card-title">${def.title}</span>
      ${def.sub?`<span class="db-card-subtitle">${def.sub}</span>`:''}
      <div class="db-card-swap-btns">
        <button class="db-swap-btn" data-dir="left"  data-idx="${idx}" ${!canLeft ?'disabled':''} title="左へ移動"><i class="fa-solid fa-chevron-left"></i></button>
        <button class="db-swap-btn" data-dir="right" data-idx="${idx}" ${!canRight?'disabled':''} title="右へ移動"><i class="fa-solid fa-chevron-right"></i></button>
      </div>
    </div>
    <div class="db-card-body db-body-${bodyType}">${bodyInner}</div>
  </div>`;
}

function _dashHTML(S) {
  const fmt=v=>v!==null?v.toFixed(1):'---';
  const act=S.byStatus['在籍']||0, tra=S.byStatus['異動']||0, ret=S.byStatus['退職']||0;
  const pct=S.total?Math.round(act/S.total*100):0;
  const layout=_getLayout();
  return `
<div class="db-inner">
  <div class="db-kpi-grid">
    ${_kpiCard('fa-solid fa-users',         '#EFF6FF','#2563EB', S.total,'名','総登録人数',`在籍 ${act} ／ 異動 ${tra} ／ 退職 ${ret}`)}
    ${_kpiCard('fa-solid fa-user-check',    '#F0FDF4','#10B981', act,'名','在籍者数',`全体の ${pct}%`)}
    ${_kpiCard('fa-solid fa-cake-candles',  '#FFFBEB','#D97706', S.avgAge!==null?fmt(S.avgAge):'---',S.avgAge!==null?'歳':'','平均年齢',`中央値: ${S.medAge!==null?fmt(S.medAge)+'歳':'---'} ／ データ: ${S.ageWithData}名`)}
    ${_kpiCard('fa-solid fa-hourglass-half','#F5F3FF','#7C3AED', S.avgYears!==null?fmt(S.avgYears):'---',S.avgYears!==null?'年':'','平均在社年数',`中央値: ${S.medYears!==null?fmt(S.medYears)+'年':'---'} ／ 直近入社: ${S.recentHireCount}名`)}
  </div>
  <div class="db-row2">${layout.slice(0,4).map((id,i)=>_chartCardHTML(id,i,6)).join('')}</div>
  <div class="db-row3">${layout.slice(4,6).map((id,i)=>_chartCardHTML(id,i+4,6)).join('')}</div>
</div>`;
}

/* ================================================================
   CHART RENDERERS
================================================================ */
const _FONT = { family:"'DM Sans','Noto Sans JP',sans-serif", size:11 };
const _GRID = { color:'#F1F5F9' };

function _donutOpts(total, centerText, centerSub) {
  return {
    responsive:true, maintainAspectRatio:false, cutout:'65%',
    plugins:{
      legend:{ position:'bottom', labels:{ font:_FONT, padding:8, boxWidth:9, boxHeight:9 } },
      tooltip:{ callbacks:{ label:ctx=>` ${ctx.label}: ${ctx.raw}名 (${total?Math.round(ctx.raw/total*100):0}%)` } },
      centerLabel:{ text:centerText, sub:centerSub },
    }
  };
}

function _renderGender(S) {
  const el=document.getElementById('db-c-gender'); if(!el)return;
  const CM={'男性':'#3B82F6','女性':'#EC4899','その他':'#8B5CF6','不明':'#94A3B8'};
  const labels=Object.keys(S.byGender), data=labels.map(l=>S.byGender[l]);
  _dc.gender=new Chart(el,{ type:'doughnut',
    data:{ labels, datasets:[{ data, backgroundColor:labels.map(l=>CM[l]||'#CBD5E1'), borderWidth:2, borderColor:'#fff', hoverOffset:4 }] },
    options:_donutOpts(S.total,`${S.total}名`,'全体'), plugins:[_centerPlugin] });
}

function _renderAge(S) {
  const el=document.getElementById('db-c-age'); if(!el)return;
  
  // 認知心理学に基づき、青(10代)〜赤(60代以上)へ連続的な色相変化を適用
  const BASE_HUES = {'10代': 240, '20代': 192, '30代': 144, '40代': 96, '50代': 48, '60代以上': 0};
  const CM = {};
  for(let k in BASE_HUES) CM[k] = `hsl(${BASE_HUES[k]}, 80%, 55%)`;
  
  const total=Object.values(S.ageGroups).reduce((a,b)=>a+b,0);
  const labels=Object.keys(S.ageGroups).filter(k=>S.ageGroups[k]>0), data=labels.map(l=>S.ageGroups[l]);
  
  _dc.age=new Chart(el,{ type:'bar',
    data:{ labels, datasets:[{ label:'人数', data,
      backgroundColor:labels.map(l=>(CM[l]||'hsl(210, 20%, 60%)').replace(')', ', 0.8)').replace('hsl', 'hsla')),
      borderColor:labels.map(l=>CM[l]||'#94A3B8'),
      borderWidth:1.5, borderRadius:4, borderSkipped:false }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false},
        tooltip:{callbacks:{ label:ctx=>` ${ctx.raw}名 (${total?Math.round(ctx.raw/total*100):0}%)` }} },
      scales:{ x:{grid:{display:false},ticks:{font:_FONT,maxRotation:0,minRotation:0}}, y:{beginAtZero:true,grid:_GRID,ticks:{font:_FONT,precision:0}} }
    }
  });
}

function _renderStatus(S) {
  const el=document.getElementById('db-c-status'); if(!el)return;
  const MC={};
  (DB.masters.status||[]).forEach(m=>{ if(m.color)MC[m.name]=m.color; });
  const DEF={'在籍':'#10B981','異動':'#3B82F6','退職':'#94A3B8','不明':'#CBD5E1'};
  const labels=Object.keys(S.byStatus), data=labels.map(l=>S.byStatus[l]);
  const colors=labels.map(l=>MC[l]||DEF[l]||'#CBD5E1');
  _dc.status=new Chart(el,{ type:'doughnut',
    data:{ labels, datasets:[{ data, backgroundColor:colors, borderWidth:2, borderColor:'#fff', hoverOffset:4 }] },
    options:_donutOpts(S.total,`${S.total}名`,'全体'), plugins:[_centerPlugin] });
}

function _renderTrend(S) {
  const el=document.getElementById('db-c-trend'); if(!el||!S.hireYears.length)return;
  const data=S.hireYears.map(y=>S.byHireYear[y]);
  const count = S.hireYears.length;
  
  // 時系列順に青(古い)〜赤(新しい)のグラデーションを動的生成
  const getTrendColor = (idx, isBorder) => {
    if (count <= 1) return isBorder ? 'hsl(240, 80%, 55%)' : 'hsla(240, 80%, 55%, 0.8)';
    const h = 240 - (240 * idx / (count - 1));
    return isBorder ? `hsl(${Math.round(h)}, 80%, 55%)` : `hsla(${Math.round(h)}, 80%, 55%, 0.8)`;
  };

  _dc.trend=new Chart(el,{ type:'bar',
    data:{ labels:S.hireYears.map(String), datasets:[{ label:'入社人数', data,
      backgroundColor: data.map((v, i) => getTrendColor(i, false)),
      borderColor: data.map((v, i) => getTrendColor(i, true)),
      borderWidth:1.5, borderRadius:3, borderSkipped:false }] },
    options:{ responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${ctx.raw}名入社`}} },
      scales:{ x:{grid:{display:false},ticks:{font:_FONT,maxRotation:0,minRotation:0}}, y:{beginAtZero:true,grid:_GRID,ticks:{font:_FONT,precision:0,stepSize:1}} }
    }
  });
}

function _renderHireType(S) {
  const el=document.getElementById('db-c-hiretype'); if(!el)return;
  const MC={};
  (DB.masters.hireType||[]).forEach(m=>{ if(m.color)MC[m.name]=m.color; });
  const DEF={'新卒':'#14B8A6','中途':'#F97316','不明':'#94A3B8'};
  const labels=Object.keys(S.byHireType), data=labels.map(l=>S.byHireType[l]);
  const total=data.reduce((a,b)=>a+b,0);
  _dc.hireType=new Chart(el,{ type:'doughnut',
    data:{ labels, datasets:[{ data, backgroundColor:labels.map(l=>MC[l]||DEF[l]||'#CBD5E1'), borderWidth:2, borderColor:'#fff', hoverOffset:4 }] },
    options:_donutOpts(total,`${total}名`,'全体'), plugins:[_centerPlugin] });
}

function _renderRecentList(S, listEl) {
  if(!listEl)return;
  if(!S.recentHires.length){
    listEl.innerHTML=`<div class="db-empty-list"><i class="fa-solid fa-calendar-xmark"></i><br>直近12ヶ月の入社者なし</div>`;
    return;
  }
  listEl.innerHTML=S.recentHires.map(e=>{
    const attrItem=(DB.masters.attribute||[]).find(i=>i.name===e.attribute);
    const attrColor=attrItem?.color||'';
    const badgeStyle=attrColor?`background:${lighten(attrColor)};color:${attrColor}`:'';
    const badge=e.attribute?`<span class="badge" style="${badgeStyle}">${e.attribute}</span>`:'';
    const ymd=(e.hireDate||'').slice(0,7).replace('-','/');
    return `<div class="db-recent-item">
      <span class="db-recent-name">${e.lastName}${e.firstName}</span>
      <span class="db-recent-meta">${ymd?`<span class="db-recent-date">${ymd}</span>`:''}${badge}</span>
    </div>`;
  }).join('');
}

/* ================================================================
   CHART SWAP（入替ボタン）
================================================================ */
function _initSwapButtons(el, S) {
  if (el.dataset.swapInit) return;
  el.dataset.swapInit = '1';
  el.addEventListener('click', ev => {
    const btn = ev.target.closest('.db-swap-btn');
    if (!btn || btn.disabled) return;
    const dir     = btn.dataset.dir;
    const idx     = parseInt(btn.dataset.idx, 10);
    const layout  = _getLayout();
    const swapIdx = dir === 'left' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= layout.length) return;
    [layout[idx], layout[swapIdx]] = [layout[swapIdx], layout[idx]];
    DB.settings.dashLayout = layout;
    saveDB();
    _rebuildDash(_dashStats());
  });
}

/* ================================================================
   DRAG & DROP（グラフ並び替え）
================================================================ */
function _initDragDrop(el, S) {
  if (el.dataset.dndInit) return;
  el.dataset.dndInit = '1';
  let dragId      = null;
  let dragOverId  = null;

  el.addEventListener('dragstart', ev => {
    const card = ev.target.closest('.db-card[data-chart-id]');
    if (!card) return;
    dragId = card.dataset.chartId;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', dragId);
    setTimeout(() => card.classList.add('is-dragging'), 0);
  });

  el.addEventListener('dragover', ev => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    const card = ev.target.closest('.db-card[data-chart-id]');
    if (!card) return;
    const overId = card.dataset.chartId;
    if (overId === dragId) return;
    if (overId !== dragOverId) {
      el.querySelectorAll('.db-card').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');
      dragOverId = overId;
    }
  });

  el.addEventListener('dragleave', ev => {
    if (!el.contains(ev.relatedTarget)) {
      el.querySelectorAll('.db-card').forEach(c => c.classList.remove('drag-over'));
      dragOverId = null;
    }
  });

  el.addEventListener('drop', ev => {
    ev.preventDefault();
    const target = ev.target.closest('.db-card[data-chart-id]');
    if (!target || !dragId) return;
    const toId = target.dataset.chartId;
    if (toId === dragId) return;
    const layout = _getLayout();
    const fi = layout.indexOf(dragId);
    const ti = layout.indexOf(toId);
    if (fi < 0 || ti < 0) return;
    layout.splice(fi, 1);
    layout.splice(ti, 0, dragId);
    DB.settings.dashLayout = layout;
    saveDB();
    _rebuildDash(_dashStats());
  });

  el.addEventListener('dragend', () => {
    el.querySelectorAll('.db-card').forEach(c => c.classList.remove('drag-over', 'is-dragging'));
    dragId = dragOverId = null;
  });
}

/* ================================================================
   HEIGHT — ResizeObserver でビューポートに収める
   maintainAspectRatio:false はコンテナが先に高さを持っていることが前提。
   ResizeObserver で親の高さ変化を監視し、Row2/Row3 に明示的な高さを与える。
================================================================ */
function _applyChartHeights(inner) {
  const kpiGrid = inner.querySelector('.db-kpi-grid');
  const row2    = inner.querySelector('.db-row2');
  const row3    = inner.querySelector('.db-row3');
  if (!row2 || !row3) return;

  const viewH  = (inner.parentElement?.clientHeight || window.innerHeight);
  const kpiH   = kpiGrid ? kpiGrid.offsetHeight : 0;
  // padding(12px top + 8px bottom) + gap(12px × 2) = 44px
  const reserved = kpiH + 44;
  const remain  = viewH - reserved;
  const row2H   = Math.max(130, Math.floor(remain * 0.55));
  const row3H   = Math.max(110, Math.floor(remain * 0.45));
  row2.style.height = row2H + 'px';
  row3.style.height = row3H + 'px';
  // Chart.jsに再描画を促す
  Object.values(_dc).forEach(c => { try { c.resize(); } catch(_){} });
}

function _setupResizeObserver(inner) {
  if (_dbResizeObs) { _dbResizeObs.disconnect(); _dbResizeObs = null; }
  const target = inner.parentElement || inner;
  _applyChartHeights(inner);
  _dbResizeObs = new ResizeObserver(() => _applyChartHeights(inner));
  _dbResizeObs.observe(target);
}

/* ================================================================
   BUILD / REBUILD
================================================================ */
function _destroyCharts() {
  Object.values(_dc).forEach(c=>{ try{c.destroy();}catch(_){} });
  Object.keys(_dc).forEach(k=>delete _dc[k]);
}

function _rebuildDash(S) {
  _destroyCharts();
  const el = document.getElementById('view-dashboard');
  el.innerHTML = _dashHTML(S);
  const inner = el.querySelector('.db-inner');
  _setupResizeObserver(inner);
  _initSwapButtons(el, S);
  _initDragDrop(el, S);

  // ResizeObserver が初回高さを設定した後にチャートを描画
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const layout = _getLayout();
      layout.forEach(chartId => {
        const def = _CHART_DEFS[chartId];
        if (!def) return;
        if (def.type === 'list') _renderRecentList(S, document.getElementById('db-recent-list'));
        else def.render(S);
      });
    });
  });
}

/* ================================================================
   MAIN ENTRY POINT
================================================================ */
function renderDashboard() {
  if (_dbResizeObs) { _dbResizeObs.disconnect(); _dbResizeObs = null; }
  _destroyCharts();

  const el = document.getElementById('view-dashboard');
  if (!DB.employees.length) {
    el.innerHTML = `<div class="empty-state" style="margin-top:60px">
      <i class="fa-solid fa-chart-pie"></i>
      <h3>データがありません</h3>
      <p>従業員を登録するとダッシュボードが表示されます</p>
    </div>`;
    return;
  }

  const S = _dashStats();
  _rebuildDash(S);
}
