'use strict';

/* ================================================================
   STATE
================================================================ */
const DB = {
  employees: [],
  tags: [],
  masters: {
    school:    [],
    company:   [],
    status:    [],
    attribute: [],
    hireType:  [],
    course:    [],
    position:  [],
  },
  masterConfig: {
    school: {
      levels:[
        { label: '学校',        placeholder: '例：名古屋大学' },
        { label: '学部・研究科', placeholder: '例：工学部' },
        { label: '学科・専攻',   placeholder: '例：機械工学科' },
      ]
    },
    company: {
      // 会社名はルートノードの name で表現されるため depth=0 のラベルは不要。
      // ここには depth=1 以降のデフォルト組織階層名を定義する（各会社で上書き可能）。
      levels:[
        { label: '組織',   placeholder: '例：本部、事業部、支社、工場' },
        { label: '部門',   placeholder: '例：製造部、総務部、技術部' },
        { label: '課',     placeholder: '例：仕上課、品質管理課' },
        { label: 'チーム', placeholder: '例：Aチーム、Bライン' },
      ]
    },
    status:    { type:'flat', label:'在籍状況',  icon:'fa-solid fa-circle-dot',       itemLabel:'状況' },
    attribute: { type:'flat', label:'属性',       icon:'fa-solid fa-map-location-dot', itemLabel:'属性' },
    hireType:  { type:'flat', label:'入社区分',  icon:'fa-solid fa-door-open',         itemLabel:'区分' },
    course:    { type:'flat', label:'職群',  icon:'fa-solid fa-user-gear',         itemLabel:'職群' },
    position:  { label:'役職', icon:'fa-solid fa-user-tie',
      levels:[
        { label:'役職グループ', placeholder:'例：取締役、執行役員、管理職' },
        { label:'役職名', placeholder:'例：社長、部長、課長' },
      ]
    },
  },
  settings: {
    yAxis: 'hire',
    split: '',
    yAxisDir: 'desc',
    badges: { gender:true, attribute:true, status:true, hireType:true, course:true, age:true, years:true, tags:true, company:false, education:false, school:false, adjHire:false, birthMonth:false, zodiac:false, orgExp:false, posExp:false },
    cardColorMode: 'attribute',
    numericThreshold: { age: 35, years: 10 },
    showEmptyRows: false,
    listCols: null,
    showSearchMarker: true,
    distStatusFilter: { '在籍':true, '異動':true, '退職':true },
    statusCardStyle: true,
    hm: {
      panels: [
        { id: 'p1', xAxis: 'gender', yAxis: 'hire', dispMode: 'count', format: 'table', horizontal: false, swapAxis: false, xAxisDir: 'asc', yAxisDir: 'asc', axisRange: { mode: 'auto', min: null, max: null, niceScale: true } }
      ]
    },
    masterCountBadge: false,
    companyBadges: { levelBadge:false, empCount:false, levelStrip:false, dateBadge:false, corpBadge:false, soldBadge:false, relBar:false },
    companySearchHistory: [],
    dashLayout: ['gender','age','status','recent','trend','hireType'],
    showCardAvatar: true,
    cardPopup: {
      enabled: true,
      size: 'md',
      showAvatar: true,
      showBadges: true,
      showHireYear: true,
      showMemo: false,
    },
    showWareki: false,
    globalFilter: {
      status:    [],
      attribute: [],
      gender:    [],
      hireType:  [],
      course:    [],
      tags:      [],
      tagMode:   'or',
      company:   [],
      school:    [],
      education: [],
    },
  }
};
let currentView    = 'list';
let listSort       = { key:'hireYear', dir:'desc' };
let listFilters    = { search:'' };
let confirmCb      = null;
let selectedTagIds = [];
let colDragKey     = null;
let colDragOverKey = null;
let currentMasterType = 'company';

// Avatar State
const avatarMap = new Map(); // id -> object URL
// gallery state (managed by employee.js)
let avatarGallery   = [];  // [{localId, avatarId, url, file, isNew}]
let activeAvatarIdx = 0;

let currentAvatarAspect = '1/1';
let currentAvatarRadius = 16;
let currentAvatarFit    = 'contain';

/* ================================================================
   AVATAR HELPERS
================================================================ */
/** 従業員の「アクティブ」アバターIDを返す（複数画像対応・後方互換）*/
function getActiveAvatarId(emp) {
  if (Array.isArray(emp.avatarIds) && emp.avatarIds.length > 0) {
    const idx = typeof emp.activeAvatarIdx === 'number' ? emp.activeAvatarIdx : 0;
    return emp.avatarIds[Math.min(idx, emp.avatarIds.length - 1)] || null;
  }
  return emp.avatarId || null;  // backward compat
}

/** アバターのスタイル（比率・角丸・フィット）を取得する（後方互換含む） */
function getAvatarStyle(emp) {
  if (emp.avatarShape && !emp.avatarAspect) {
    const map = {
      circle: { aspect: '1/1', radius: '50%' },
      rounded: { aspect: '1/1', radius: '16px' },
      square: { aspect: '1/1', radius: '4px' },
      wide: { aspect: '16/9', radius: '4px' },
      wideRounded: { aspect: '16/9', radius: '16px' },
      tall: { aspect: '9/16', radius: '4px' },
      tallRounded: { aspect: '9/16', radius: '16px' }
    };
    const s = map[emp.avatarShape] || map.rounded;
    return { aspect: s.aspect, radius: s.radius, fit: emp.avatarFit || 'contain' };
  }
  const r = emp.avatarRadius !== undefined ? emp.avatarRadius : 16;
  return {
    aspect: emp.avatarAspect || '1/1',
    radius: r === 50 ? '50%' : r + 'px',
    fit: emp.avatarFit || 'contain'
  };
}

/** リストやカード用の縮小版アバタースタイルを取得する */
function getMiniAvatarStyle(emp) {
  const s = getAvatarStyle(emp);
  let r = s.radius;
  if (r.endsWith('px')) {
    r = Math.max(2, Math.round(parseInt(r) * 0.375)) + 'px';
  }
  return { aspect: s.aspect, radius: r, fit: s.fit };
}

/* ================================================================
   INDEXED_DB FOR AVATARS
================================================================ */
const IDB_NAME        = 'emp_dist_db';
const IDB_STORE       = 'avatars';
const IDB_APPDATA_STORE = 'appdata';

let _dbPromise = null;
function initDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE))       db.createObjectStore(IDB_STORE,       { keyPath: 'id'  });
      if (!db.objectStoreNames.contains(IDB_APPDATA_STORE)) db.createObjectStore(IDB_APPDATA_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => { _dbPromise = null; };
      db.onversionchange = () => { db.close(); _dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error);
    };
  });
  return _dbPromise;
}
async function saveAvatarToDB(id, fileBlob) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ id, data: fileBlob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function deleteAvatarFromDB(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function getAllAvatarsFromDB() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(tx.error);
  });
}
async function loadAllAvatarsToMemory() {
  try {
    const all = await getAllAvatarsFromDB();
    all.forEach(item => avatarMap.set(item.id, URL.createObjectURL(item.data)));
  } catch(e) { console.warn('Avatar DB load failed', e); }
}

/* ================================================================
   CONSTANTS
================================================================ */

const COL_DEFS = [
  { key:'name',      label:'氏名',       sortKey:'name',      required:true },
  { key:'kana',      label:'ふりがな',   sortKey:'kana',      defaultHidden:true },
  { key:'gender',    label:'性別',       sortKey:'gender' },
  { key:'age',       label:'年齢',       sortKey:'age' },
  { key:'birthDate', label:'生年月日',   sortKey:'birthDate', defaultHidden:true },
  { key:'hireYear',  label:'入社年',     sortKey:'hireYear' },
  { key:'adjHireYear', label:'大卒換算入社年', sortKey:'adjHireYear', defaultHidden:true },
  { key:'years',     label:'在社年数',   sortKey:'years' },
  { key:'currentOrg',label:'現所属',     sortKey:'currentOrg' },
  { key:'currentPos',label:'現役職',     sortKey:'currentPos' },
  { key:'attr',      label:'属性',       sortKey:'attr' },
  { key:'status',    label:'在籍状況',   sortKey:'status' },
  { key:'hireType',  label:'入社区分',   sortKey:'hireType' },
  { key:'course',    label:'職群',       sortKey:'course' },
  { key:'education', label:'学歴',       sortKey:'education', defaultHidden:true },
  { key:'school',    label:'学校名',     sortKey:'school',    defaultHidden:true },
  { key:'eduDept',   label:'学部・専攻', sortKey:'eduDept',   defaultHidden:true },
  { key:'tags',      label:'タグ' },
  { key:'memo',      label:'メモ' },
];

const CARD_COLOR_CFG = {
  none:      { label:'なし',     fn: ()  => null },
  attribute: { label:'属性',     fn: e   => getFlatMasterColor('attribute', e.attribute) },
  gender:    { label:'性別',     fn: e   => e.gender==='男性'?'#3B82F6':e.gender==='女性'?'#EC4899':e.gender==='その他'?'#8B5CF6':null },
  status:    { label:'在籍状況', fn: e   => getFlatMasterColor('status', e.status) },
  hireType:  { label:'入社区分', fn: e   => getFlatMasterColor('hireType', e.hireType) },
  course:    { label:'職群',     fn: e   => getFlatMasterColor('course', e.course) },
};

function getSplitCfgForFlat(type) {
  const items = getFlatMasterItems(type);
  if (items.length < 2) return null;
  let lefts  = items.filter(i => i.splitSide === 'left');
  let rights = items.filter(i => i.splitSide === 'right');
  if (!lefts.length && !rights.length) {
    lefts = [items[0]];
    rights = [items[1]];
  }
  return {
    label:      DB.masterConfig[type]?.label || type,
    left:       lefts.length  ? lefts.map(i  => i.name).join('・') : '設定なし',
    right:      rights.length ? rights.map(i => i.name).join('・') : '設定なし',
    lColor:     lefts[0]?.color  || '#3B82F6',
    rColor:     rights[0]?.color || '#EC4899',
    leftNames:  lefts.map(i  => i.name),
    rightNames: rights.map(i => i.name),
    leftItems:  lefts,
    rightItems: rights
  };
}

const SPLIT_CONFIG_GENDER = {
  label:'性別', left:'男性', right:'女性', lColor:'#3B82F6', rColor:'#EC4899',
  leftItems: [{ name:'男性', color:'#3B82F6', icon:'fa-solid fa-mars' }],
  rightItems:[{ name:'女性', color:'#EC4899', icon:'fa-solid fa-venus' }]
};

// '' = 背景なし（白）を表す特殊値
const PRESET_CLR = [
  '#FECACA','#FDE68A','#FEF08A','#BBF7D0','#A7F3D0',
  '#BAE6FD','#BFDBFE','#C7D2FE','#DDD6FE','#F5D0FE',
  '#FECDD3','#CBD5E1','#E2E8F0','#F1F5F9',
  '#EF4444','#F97316','#F59E0B','#EAB308','#84CC16',
  '#22C55E','#10B981','#14B8A6','#06B6D4','#3B82F6',
  '#6366F1','#8B5CF6','#A855F7','#EC4899','#F43F5E','#64748B'
];

const PRESET_ICONS = [
  'fa-solid fa-user', 'fa-solid fa-user-tie', 'fa-solid fa-user-check', 'fa-solid fa-user-minus',
  'fa-solid fa-users', 'fa-solid fa-person-walking-arrow-right', 'fa-solid fa-door-open',
  'fa-solid fa-building', 'fa-solid fa-city', 'fa-solid fa-house', 'fa-solid fa-map-pin', 'fa-solid fa-earth-asia',
  'fa-solid fa-graduation-cap', 'fa-solid fa-briefcase', 'fa-solid fa-id-card', 'fa-solid fa-handshake',
  'fa-solid fa-star', 'fa-solid fa-heart', 'fa-solid fa-flag', 'fa-solid fa-award',
  'fa-solid fa-crown', 'fa-solid fa-seedling', 'fa-solid fa-car', 'fa-solid fa-plane'
];

const DEFAULT_MASTERS = {
  status:[
    { id:'sm1', name:'在籍', color:'',        icon:'fa-solid fa-user-check',                  splitSide:'left'  },
    { id:'sm2', name:'異動', color:'#BFDBFE', icon:'fa-solid fa-person-walking-arrow-right',  splitSide:'right' },
    { id:'sm3', name:'退職', color:'#CBD5E1', icon:'fa-solid fa-user-minus',                  splitSide:''      },
  ],
  attribute:[
    { id:'am1', name:'地域系', color:'#10B981', icon:'fa-solid fa-map-pin',    splitSide:'left'  },
    { id:'am2', name:'全国系', color:'#F59E0B', icon:'fa-solid fa-earth-asia', splitSide:'right' },
  ],
  hireType:[
    { id:'hm1', name:'新卒', color:'#14B8A6', icon:'fa-solid fa-graduation-cap', splitSide:'left'  },
    { id:'hm2', name:'中途', color:'#F97316', icon:'fa-solid fa-briefcase',      splitSide:'right' },
  ],
  course:[
    { id:'cm1', name:'技術系', color:'#06B6D4', icon:'fa-solid fa-wrench', splitSide:'left'  },
    { id:'cm2', name:'事務系', color:'#F43F5E', icon:'fa-solid fa-file-lines',  splitSide:'right' },
  ],
  position:[
    { id:'pos1', name:'第1階層', children:[ { id:'pos1_1', name:'代表取締役会長' }, { id:'pos1_2', name:'代表取締役社長' } ] },
    { id:'pos2', name:'第2階層', children:[ { id:'pos2_1', name:'取締役副社長' }, { id:'pos2_2', name:'取締役専務' }, { id:'pos2_3', name:'取締役常務' }, { id:'pos2_4', name:'取締役' } ] },
    { id:'pos3', name:'第3階層', children:[ { id:'pos3_1', name:'上席執行役員' } ] },
    { id:'pos4', name:'第4階層', children:[ { id:'pos4_1', name:'専務執行役員' }, { id:'pos4_2', name:'上級執行役員' } ] },
    { id:'pos5', name:'第5階層', children:[ { id:'pos5_1', name:'常務執行役員' } ] },
    { id:'pos6', name:'第6階層', children:[ { id:'pos6_1', name:'執行役員' } ] },
    { id:'pos7', name:'第7階層', children:[ { id:'pos7_1', name:'部長' } ] },
    { id:'pos8', name:'第8階層', children:[ { id:'pos8_1', name:'次長' }, { id:'pos8_2', name:'工場長' } ] },
    { id:'pos9', name:'第9階層', children:[ { id:'pos9_1', name:'課長' }, { id:'pos9_2', name:'室長' }, { id:'pos9_3', name:'グループリーダー' }, { id:'pos9_4', name:'リーダー' }, { id:'pos9_5', name:'サブリーダー' } ] },
    { id:'pos10', name:'第10階層', children:[ { id:'pos10_1', name:'係長' } ] },
    { id:'pos11', name:'第11階層', children:[ { id:'pos11_1', name:'主任' }, { id:'pos11_2', name:'一般社員' } ] },
  ],
};
function getInitialMasters() { return JSON.parse(JSON.stringify(DEFAULT_MASTERS)); }

/* ================================================================
   SAMPLE MASTERS（初期化時のサンプルデータ）
================================================================ */
const SAMPLE_MASTERS = {
  status:    DEFAULT_MASTERS.status,
  attribute: DEFAULT_MASTERS.attribute,
  hireType:  DEFAULT_MASTERS.hireType,
  course:    DEFAULT_MASTERS.course,
  position:  DEFAULT_MASTERS.position,
  school: [
    { id:'sch01', name:'東京大学',             children:[{ id:'sch01d1', name:'工学部',           children:[{ id:'sch01d1s1', name:'機械工学科' }] }] },
    { id:'sch02', name:'京都大学',             children:[{ id:'sch02d1', name:'工学部',           children:[{ id:'sch02d1s1', name:'工業化学科' }] }] },
    { id:'sch03', name:'大阪大学',             children:[{ id:'sch03d1', name:'基礎工学研究科',   children:[{ id:'sch03d1s1', name:'機能創成専攻' }] }] },
    { id:'sch04', name:'東北大学',             children:[{ id:'sch04d1', name:'工学部',           children:[{ id:'sch04d1s1', name:'化学・バイオ工学科' }] }] },
    { id:'sch05', name:'早稲田大学',           children:[{ id:'sch05d1', name:'政治経済学部',     children:[{ id:'sch05d1s1', name:'経済学科' }] }] },
    { id:'sch06', name:'慶應義塾大学',         children:[{ id:'sch06d1', name:'商学部',           children:[{ id:'sch06d1s1', name:'商学科' }] }] },
    { id:'sch07', name:'一橋大学',             children:[{ id:'sch07d1', name:'商学部',           children:[{ id:'sch07d1s1', name:'経営学科' }] }] },
    { id:'sch08', name:'東京工業大学',         children:[{ id:'sch08d1', name:'理工学研究科',     children:[{ id:'sch08d1s1', name:'機械工学専攻' }] }] },
    { id:'sch09', name:'明治大学',             children:[{ id:'sch09d1', name:'経営学部',         children:[{ id:'sch09d1s1', name:'経営学科' }] }] },
    { id:'sch10', name:'立命館大学',           children:[{ id:'sch10d1', name:'理工学部',         children:[{ id:'sch10d1s1', name:'情報理工学科' }] }] },
    { id:'sch11', name:'同志社大学',           children:[{ id:'sch11d1', name:'経済学部',         children:[{ id:'sch11d1s1', name:'経済学科' }] }] },
    { id:'sch12', name:'関西大学',             children:[{ id:'sch12d1', name:'人間健康学部',     children:[{ id:'sch12d1s1', name:'人間健康学科' }] }] },
    { id:'sch13', name:'法政大学',             children:[{ id:'sch13d1', name:'社会学部',         children:[{ id:'sch13d1s1', name:'社会学科' }] }] },
    { id:'sch14', name:'青山学院大学',         children:[{ id:'sch14d1', name:'文学部',           children:[{ id:'sch14d1s1', name:'日本文学科' }] }] },
    { id:'sch15', name:'筑波大学',             children:[{ id:'sch15d1', name:'理工学群',         children:[{ id:'sch15d1s1', name:'工学システム学類' }] }] },
    { id:'sch16', name:'広島大学',             children:[{ id:'sch16d1', name:'教育学部',         children:[{ id:'sch16d1s1', name:'学校教育学科' }] }] },
    { id:'sch17', name:'お茶の水女子大学',     children:[{ id:'sch17d1', name:'理学部',           children:[{ id:'sch17d1s1', name:'化学科' }] }] },
    { id:'sch18', name:'大阪デザイン専門学校', children:[{ id:'sch18d1', name:'デザイン学科',     children:[{ id:'sch18d1s1', name:'グラフィックデザイン科' }] }] },
    { id:'sch19', name:'神戸女子短期大学',     children:[{ id:'sch19d1', name:'生活学科',         children:[{ id:'sch19d1s1', name:'食物栄養専攻' }] }] },
    { id:'sch20', name:'松江工業高等専門学校', children:[{ id:'sch20d1', name:'工学科',           children:[{ id:'sch20d1s1', name:'機械工学科' }] }] },
  ],
  company: [
    // ── 現存（国内） ──────────────────────────────────────────────
    { // 純粋持株会社（東証プライム上場）
      id: 'co_nlmhd', name: '日本軽金属ホールディングス㈱',
      foundedDate:   '2012-10-01',
      isGroup: true,
      oldNames: [],
      levels: [
        { label: '子会社・事業部門', placeholder: '例：日本軽金属㈱' },
        { label: '部門', placeholder: '例：管理部門、事業部門' },
      ],
      corporateEvents: [
      ],
      children: [],
    },
    { // 総合アルミメーカー（事業子会社）
      id: 'co_nlm', name: '日本軽金属㈱',
      foundedDate:   '1939-03-30',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nlm_01', type: 'subsidiary', date: '2012', endDate: '', relatedCompanyId: 'co_nlmhd', note: '' },
      ],
      children: [],
    },
    { // 押出・加工系7社の中間持株会社
      id: 'co_kakohd', name: '日軽金加工開発ホールディングス㈱',
      foundedDate:   '2011-03',
      isGroup: true,
      oldNames: [],
      levels: [
        { label: '子会社・事業部門', placeholder: '例：日本軽金属㈱' },
        { label: '部門', placeholder: '例：管理部門、事業部門' },
      ],
      corporateEvents: [
        { id: 'ev_kakohd_01', type: 'holding', date: '2011', endDate: '2011', relatedCompanyId: 'co_nlm', note: '押出・加工系7社の中間持株会社' },
        { id: 'ev_kakohd_02', type: 'holding', date: '2012', endDate: '', relatedCompanyId: 'co_nlmhd', note: '' },
      ],
      children: [],
    },
    { // トレーラ・自動車車体製造
      id: 'co_fullhalf', name: '日本フルハーフ㈱',
      foundedDate:   '1963-10',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：設計部、施工部' },
      ],
      corporateEvents: [
        { id: 'ev_fullhalf_01', type: 'subsidiary', date: '1963', endDate: '2011', relatedCompanyId: 'co_nlm', note: 'トレーラ・自動車車体製造' },
        { id: 'ev_fullhalf_02', type: 'subsidiary', date: '2012', endDate: '', relatedCompanyId: 'co_nlmhd', note: '' },
      ],
      children: [],
    },
    { // 箔・粉末・顔料製品
      id: 'co_toyo2', name: '東洋アルミニウム㈱',
      foundedDate:   '2002-10-01',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_toyo2_01', type: 'subsidiary', date: '2002', endDate: '2011', relatedCompanyId: 'co_nlm', note: '箔・粉末・顔料製品' },
        { id: 'ev_toyo2_02', type: 'subsidiary', date: '2012', endDate: '', relatedCompanyId: 'co_nlmhd', note: '' },
      ],
      children: [],
    },
    { // 押出・軽圧加工・自動車部品
      id: 'co_act', name: '日軽金アクト㈱',
      foundedDate:   '2002-10-01',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_act_01', type: 'subsidiary', date: '2002', endDate: '2010', relatedCompanyId: 'co_nlm', note: '押出・軽圧加工・自動車部品' },
        { id: 'ev_act_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    { // 押出形材
      id: 'co_nikkaizai', name: '日軽形材㈱',
      foundedDate:   '2002-10-01',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nikkaizai_01', type: 'subsidiary', date: '2002', endDate: '2010', relatedCompanyId: 'co_nlm', note: '押出形材' },
        { id: 'ev_nikkaizai_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    { // 押出（蒲原拠点）
      id: 'co_kamarbar', name: '日軽蒲原㈱',
      foundedDate:   '2002-10-01',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_kamarbar_01', type: 'subsidiary', date: '2002', endDate: '2010', relatedCompanyId: 'co_nlm', note: '押出（蒲原拠点）' },
        { id: 'ev_kamarbar_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    { // パネルシステム・冷熱事業
      id: 'co_panel', name: '日軽パネルシステム㈱',
      foundedDate:   '2002-10-01',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
        { id: 'ev_panel_01', type: 'subsidiary', date: '2002', endDate: '', relatedCompanyId: 'co_nlm', note: 'パネルシステム・冷熱事業' },
      ],
      children: [],
    },
    { // 鋳物・ダイカスト用アルミ合金
      id: 'co_mcalumi', name: '日軽エムシーアルミ㈱',
      foundedDate:   '2007-04',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
        { id: 'ev_mcalumi_01', type: 'subsidiary', date: '2007', endDate: '', relatedCompanyId: 'co_nlm', note: '鋳物・ダイカスト用アルミ合金' },
      ],
      children: [],
    },
    { // 商社・販売・グループ一元化
      id: 'co_kowa', name: '日軽産業㈱',
      foundedDate:   '1949',
      oldNames: [
        { name: '㈱興和商会', untilDate: '1960' },
      ],
      levels: [
        { label: '支店・営業所', placeholder: '例：東京支店、大阪支店' },
        { label: '部', placeholder: '例：営業部、管理部' },
        { label: '課', placeholder: '例：営業一課、営業二課' },
      ],
      corporateEvents: [
        { id: 'ev_kowa_01', type: 'subsidiary', date: '1949', endDate: '', relatedCompanyId: 'co_nlm', note: '商社・販売・グループ一元化' },
      ],
      children: [],
    },
    { // 物流・倉庫
      id: 'co_unso', name: '日軽物流㈱',
      foundedDate:   '1978',
      oldNames: [
        { name: '日軽運輸倉庫㈱', untilDate: '1992' },
      ],
      levels: [
        { label: '支店・営業所', placeholder: '例：東京支店、大阪支店' },
        { label: '部', placeholder: '例：営業部、管理部' },
        { label: '課', placeholder: '例：営業一課、営業二課' },
      ],
      corporateEvents: [
        { id: 'ev_unso_01', type: 'subsidiary', date: '1978', endDate: '', relatedCompanyId: 'co_nlm', note: '物流・倉庫' },
      ],
      children: [],
    },
    { // アルミ板・加工品
      id: 'co_riken', name: '理研軽金属工業㈱',
      foundedDate:   '1937',
      oldNames: [
        { name: '㈶理化学研究所静岡工場', untilDate: '1950' },
      ],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_riken_01', type: 'subsidiary', date: '1950', endDate: '2010', relatedCompanyId: 'co_nlm', note: '' },
        { id: 'ev_riken_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    { // アルミ加工
      id: 'co_ntc', name: '㈱エヌティーシー',
      foundedDate:   '1938',
      oldNames: [
        { name: '大阪アルミ堺工場', untilDate: '1955' },
      ],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_ntc_01', type: 'subsidiary', date: '1939', endDate: '2010', relatedCompanyId: 'co_nlm', note: '' },
        { id: 'ev_ntc_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    { // 押出（新潟拠点）
      id: 'co_niigata', name: '日軽新潟㈱',
      foundedDate:   '1982-04',
      oldNames: [
        { name: '新潟東港工場', untilDate: '1986' },
      ],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_niigata_01', type: 'subsidiary', date: '1982', endDate: '2010', relatedCompanyId: 'co_nlm', note: '押出（新潟拠点）' },
        { id: 'ev_niigata_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    { // 景観・構造エンジニアリング
      id: 'co_eng', name: '日軽エンジニアリング㈱',
      foundedDate:   '2000-08',
      oldNames: [
        { name: '㈱住軽日軽エンジニアリング', untilDate: '2010' },
      ],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：設計部、施工部' },
      ],
      corporateEvents: [
        { id: 'ev_eng_01', type: 'subsidiary', date: '2000', endDate: '', relatedCompanyId: 'co_nlm', note: '景観・構造エンジニアリング' },
      ],
      children: [],
    },
    { // 熱交換器製造
      id: 'co_netsuko', name: '日軽熱交㈱',
      foundedDate:   '1987',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
        { id: 'ev_netsuko_01', type: 'subsidiary', date: '1987', endDate: '', relatedCompanyId: 'co_nlm', note: '熱交換器製造' },
      ],
      children: [],
    },
    { // 情報システム
      id: 'co_jis', name: '日軽情報システム㈱',
      foundedDate:   '1983',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
        { id: 'ev_jis_01', type: 'subsidiary', date: '1983', endDate: '', relatedCompanyId: 'co_nlm', note: '情報システム' },
      ],
      children: [],
    },
    { // 電極材料
      id: 'co_nipdenki', name: '日本電極㈱',
      foundedDate:   '1945',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
        { id: 'ev_nipdenki_01', type: 'subsidiary', date: '1945', endDate: '', relatedCompanyId: 'co_nlm', note: '電極材料' },
      ],
      children: [],
    },
    { // 自動車部品事業統括
      id: 'co_almo', name: '日軽金ALMO㈱',
      foundedDate:   '2023',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_almo_01', type: 'subsidiary', date: '2023', endDate: '', relatedCompanyId: 'co_nlmhd', note: '自動車部品事業統括' },
      ],
      children: [],
    },
    { // ステンレス・アルミ加工
      id: 'co_toyorikagaku', name: '㈱東陽理化学研究所',
      foundedDate:   '1950',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_toyorikagaku_01', type: 'subsidiary', date: '2015', endDate: '', relatedCompanyId: 'co_nlm', note: '' },
      ],
      children: [],
    },
    // ── 海外・グループ外 ───────────────────────────────────────────
    { // カナダのアルミ世界的企業（グループ外参照会社）
      id: 'co_alcan', name: 'Alcan Inc.',
      foundedDate:   '1902',
      dissolvedDate: '2007-11',
      oldNames: [
        { name: 'Alcan Aluminium Limited', untilDate: '2006' },
      ],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
        { id: 'ev_alcan_01', type: 'sold', date: '2007-11', endDate: '', relatedCompanyId: '', note: '2007年11月 Rio Tinto plcに買収・吸収され法人消滅。日軽グループとの資本関係も終了。' },
      ],
      children: [],
    },
    { // タイのアルミ板・熱交換器の基幹拠点
      id: 'co_nikkeisiam', name: 'Nikkei Siam Aluminium Ltd.',
      foundedDate:   '1990',
      oldNames: [
        { name: 'Alcan Nikkei Siam Co., Ltd.', untilDate: '2003' },
      ],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nikkeisiam_01', type: 'subsidiary', date: '1990', endDate: '2002', relatedCompanyId: 'co_alcan', note: 'タイのアルミ板・熱交換器の基幹拠点。創業時はアルキャンとの合弁（旧社名：Alcan Nikkei Siam）。' },
        { id: 'ev_nikkeisiam_02', type: 'withdrawal', date: '2003', endDate: '2003', relatedCompanyId: 'co_alcan', note: '2003年 アルキャン持分を日軽金が買収し完全子会社化。アルキャンから脱退。' },
        { id: 'ev_nikkeisiam_03', type: 'subsidiary', date: '2003', endDate: '', relatedCompanyId: 'co_nlm', note: '日本軽金属㈱の完全子会社として現在も稼働。' },
      ],
      children: [],
    },
    { // 中国の化学・アルミ大手
      id: 'co_huafeng', name: '華峰集団有限公司',
      foundedDate:   '1995-01-16',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
      ],
      children: [],
    },
    { // 中国のアルミ圧延会社（2017年合弁解消）
      id: 'co_huafengnk', name: '重慶華峰鋁業有限公司',
      foundedDate:   '2008-07-10',
      dissolvedDate: '2017-03',
      oldNames: [
        { name: '重慶華峰铝业有限公司', untilDate: '2012' },
        { name: '重慶華峰日軽鋁業有限公司', untilDate: '2017-03' },
      ],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_huafeng_nk_01', type: 'subsidiary', date: '2008', endDate: '2011', relatedCompanyId: 'co_huafeng', note: '中国・重慶のアルミ圧延会社。創業時は華峰集団の子会社。' },
        { id: 'ev_huafeng_nk_02', type: 'subsidiary', date: '2012', endDate: '2016', relatedCompanyId: 'co_nlm', note: '2012年11月 日軽金が33.4%出資し「華峰日軽アルミ業」に社名変更。合弁化。' },
        { id: 'ev_huafeng_nk_03', type: 'sold', date: '2017-03', endDate: '', relatedCompanyId: 'co_huafeng', note: '2017年3月 日軽金の全持分を華峰集団に売却し合弁解消・グループ離脱。' },
      ],
      children: [],
    },
    { // 北米の自動車用アルミ部品拠点
      id: 'co_nlmna', name: 'Nippon Light Metal North America, Inc.',
      foundedDate:   '2019-10-24',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nlmna_01', type: 'subsidiary', date: '2019', endDate: '', relatedCompanyId: 'co_nlm', note: '北米の自動車用アルミ部品拠点' },
      ],
      children: [],
    },
    // ── 静岡興産・近畿研磨材・アルミ線材（日軽グループ関係会社） ───────────────
    { // 静岡興産（化成品・精製水酸化アルミ）
      id: 'co_shizuokakozan', name: '静岡興産㈱',
      foundedDate:   '1952',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、蒲原工場' },
        { label: '部門', placeholder: '例：製造部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_shizuokakozan_01', type: 'subsidiary', date: '1952', endDate: '', relatedCompanyId: 'co_nlm', note: '化成品・精製水酸化アルミ製造。蒲原製造所近隣。' },
      ],
      children: [],
    },
    { // 近畿研磨材工業（研磨材・砥石製造）
      id: 'co_kinki_kenmazai', name: '近畿研磨材工業㈱',
      foundedDate:   '1948',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_kinki_kenmazai_01', type: 'subsidiary', date: '1948', endDate: '', relatedCompanyId: 'co_nlm', note: '研磨材・砥石製造。日軽金グループの研磨材専業会社。' },
      ],
      children: [],
    },
    { // アルミニウム線材（アルミ線材製造）
      id: 'co_alumi_senzan', name: 'アルミニウム線材㈱',
      foundedDate:   '1943',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_alumi_senzan_01', type: 'subsidiary', date: '1943', endDate: '', relatedCompanyId: 'co_nlm', note: 'アルミ線材・棒材専業。電線・建築用途。' },
      ],
      children: [],
    },
    { // 日軽メタル（地金・合金販売）
      id: 'co_nikkei_metal', name: '日軽メタル㈱',
      foundedDate:   '2006',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、営業所' },
        { label: '部門', placeholder: '例：営業部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_nikkei_metal_01', type: 'subsidiary', date: '2006', endDate: '', relatedCompanyId: 'co_nlm', note: 'アルミ地金・合金・スクラップの販売・調達。' },
      ],
      children: [],
    },
    { // ㈱日伸（アルミ伸線・加工）
      id: 'co_nisshin', name: '㈱日伸',
      foundedDate:   '1951',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_nisshin_01', type: 'subsidiary', date: '1951', endDate: '', relatedCompanyId: 'co_nlm', note: 'アルミ伸線・加工品製造。' },
      ],
      children: [],
    },
    { // ㈱エヌ・エル・エム・エカル（検査・品質サービス）
      id: 'co_nlm_ekar', name: '㈱エヌ・エル・エム・エカル',
      foundedDate:   '2003',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社' },
        { label: '部門', placeholder: '例：技術部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_nlm_ekar_01', type: 'subsidiary', date: '2003', endDate: '', relatedCompanyId: 'co_nlm', note: '品質検査・エンジニアリングサービス。' },
      ],
      children: [],
    },
    { // 滋賀日軽（押出・滋賀拠点）
      id: 'co_shiga_nikkei', name: '滋賀日軽㈱',
      foundedDate:   '2002-10-01',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_shiga_nikkei_01', type: 'subsidiary', date: '2002', endDate: '2010', relatedCompanyId: 'co_nlm', note: '押出形材（滋賀拠点）' },
        { id: 'ev_shiga_nikkei_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    { // 下関日軽（押出・下関拠点）
      id: 'co_shimonoseki_nikkei', name: '下関日軽㈱',
      foundedDate:   '2002-10-01',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_shimonoseki_nikkei_01', type: 'subsidiary', date: '2002', endDate: '2010', relatedCompanyId: 'co_nlm', note: '押出形材（下関拠点）' },
        { id: 'ev_shimonoseki_nikkei_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    { // 日軽北海道（押出・北海道拠点）
      id: 'co_nikkei_hokkaido', name: '日軽北海道㈱',
      foundedDate:   '2002-10-01',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nikkei_hokkaido_01', type: 'subsidiary', date: '2002', endDate: '2010', relatedCompanyId: 'co_nlm', note: '押出形材（北海道拠点）' },
        { id: 'ev_nikkei_hokkaido_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    { // 日軽藤岡（押出・群馬拠点）
      id: 'co_nikkei_fujioka', name: '日軽藤岡㈱',
      foundedDate:   '2002-10-01',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nikkei_fujioka_01', type: 'subsidiary', date: '2002', endDate: '2010', relatedCompanyId: 'co_nlm', note: '押出形材（群馬・藤岡拠点）' },
        { id: 'ev_nikkei_fujioka_02', type: 'subsidiary', date: '2011', endDate: '', relatedCompanyId: 'co_kakohd', note: '' },
      ],
      children: [],
    },
    // ── 日軽金ALMO系（自動車部品） ────────────────────────────────────
    { // 日軽松尾（自動車部品・ダイカスト）
      id: 'co_nikkei_matsuo', name: '日軽松尾㈱',
      foundedDate:   '1946',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nikkei_matsuo_01', type: 'subsidiary', date: '1946', endDate: '2022', relatedCompanyId: 'co_nlm', note: 'アルミダイカスト・自動車部品製造。' },
        { id: 'ev_nikkei_matsuo_02', type: 'subsidiary', date: '2023', endDate: '', relatedCompanyId: 'co_almo', note: '2023年 日軽金ALMO㈱傘下へ移管。' },
      ],
      children: [],
    },
    { // Nippon Light Metal Georgia（北米ジョージア・自動車部品）
      id: 'co_nlm_georgia', name: 'Nippon Light Metal Georgia, Inc.',
      foundedDate:   '2016',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：Georgia Plant' },
        { label: '部門', placeholder: '例：Manufacturing、Quality' },
      ],
      corporateEvents: [
        { id: 'ev_nlm_georgia_01', type: 'subsidiary', date: '2016', endDate: '2022', relatedCompanyId: 'co_nlm', note: '米国ジョージア州の自動車部品工場。' },
        { id: 'ev_nlm_georgia_02', type: 'subsidiary', date: '2023', endDate: '', relatedCompanyId: 'co_almo', note: '2023年 日軽金ALMO㈱傘下へ移管。' },
      ],
      children: [],
    },
    // ── 日軽エムシーアルミ系（海外展開） ─────────────────────────────
    { // Nikkei MC Aluminum America（北米鋳物合金）
      id: 'co_mcalumi_us', name: 'Nikkei MC Aluminum America, Inc.',
      foundedDate:   '2000',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：Kentucky Plant' },
        { label: '部門', placeholder: '例：Manufacturing、Sales' },
      ],
      corporateEvents: [
        { id: 'ev_mcalumi_us_01', type: 'subsidiary', date: '2000', endDate: '', relatedCompanyId: 'co_mcalumi', note: '北米向け鋳物・ダイカスト用アルミ合金製造・販売。' },
      ],
      children: [],
    },
    { // Nikkei MC Aluminum Thailand（タイ・鋳物合金）
      id: 'co_mcalumi_th', name: 'Nikkei MC Aluminum (Thailand) Co., Ltd.',
      foundedDate:   '2012',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、販売部' },
      ],
      corporateEvents: [
        { id: 'ev_mcalumi_th_01', type: 'subsidiary', date: '2012', endDate: '', relatedCompanyId: 'co_mcalumi', note: 'タイ向け鋳物・ダイカスト用アルミ合金。' },
      ],
      children: [],
    },
    { // Nikkei CMR Aluminium India（インド・鋳物合金）
      id: 'co_mcalumi_in', name: 'Nikkei CMR Aluminium India Pvt. Ltd.',
      foundedDate:   '2015',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、販売部' },
      ],
      corporateEvents: [
        { id: 'ev_mcalumi_in_01', type: 'subsidiary', date: '2015', endDate: '', relatedCompanyId: 'co_mcalumi', note: 'インド向け鋳物用アルミ合金製造・販売。合弁会社。' },
      ],
      children: [],
    },
    { // 日軽商菱鋁業（昆山）（中国・鋳物合金）
      id: 'co_mcalumi_cn', name: '日軽商菱鋁業（昆山）有限公司',
      foundedDate:   '2003',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：昆山工場' },
        { label: '部門', placeholder: '例：製造部、販売部' },
      ],
      corporateEvents: [
        { id: 'ev_mcalumi_cn_01', type: 'subsidiary', date: '2003', endDate: '', relatedCompanyId: 'co_mcalumi', note: '中国・昆山の鋳物用アルミ合金製造・販売。' },
      ],
      children: [],
    },
    // ── 日軽グループ海外（販売・トレード系） ─────────────────────────
    { // Nikkei Singapore Aluminium（シンガポール・販売）
      id: 'co_nikkei_sg', name: 'Nikkei Singapore Aluminium Pte. Ltd.',
      foundedDate:   '1997',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：Singapore Office' },
        { label: '部門', placeholder: '例：Sales、Logistics' },
      ],
      corporateEvents: [
        { id: 'ev_nikkei_sg_01', type: 'subsidiary', date: '1997', endDate: '', relatedCompanyId: 'co_nlm', note: '東南アジア向けアルミ製品販売・トレード。' },
      ],
      children: [],
    },
    { // 日軽（上海）国際貿易（中国・販売）
      id: 'co_nikkei_sh', name: '日軽（上海）国際貿易有限公司',
      foundedDate:   '2003',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：上海オフィス' },
        { label: '部門', placeholder: '例：営業部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_nikkei_sh_01', type: 'subsidiary', date: '2003', endDate: '', relatedCompanyId: 'co_nlm', note: '中国・上海のアルミ製品販売・トレード拠点。' },
      ],
      children: [],
    },
    { // Nikkei Panel System Vietnam（ベトナム・パネル製造）
      id: 'co_panel_vn', name: 'Nikkei Panel System Vietnam Co., Ltd.',
      foundedDate:   '2015',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：Hanoi Plant' },
        { label: '部門', placeholder: '例：Manufacturing、Sales' },
      ],
      corporateEvents: [
        { id: 'ev_panel_vn_01', type: 'subsidiary', date: '2015', endDate: '', relatedCompanyId: 'co_panel', note: 'ベトナムのパネルシステム製造拠点。' },
      ],
      children: [],
    },
    { // PT. Nikkei Trading Indonesia（インドネシア・販売）
      id: 'co_nikkei_id', name: 'PT. Nikkei Trading Indonesia',
      foundedDate:   '2013',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：Jakarta Office' },
        { label: '部門', placeholder: '例：Sales、Logistics' },
      ],
      corporateEvents: [
        { id: 'ev_nikkei_id_01', type: 'subsidiary', date: '2013', endDate: '', relatedCompanyId: 'co_nlm', note: 'インドネシアのアルミ製品販売・トレード。' },
      ],
      children: [],
    },
    { // 華日軽金（深圳）（中国・精密部品）
      id: 'co_hn_sz', name: '華日軽金（深圳）有限公司',
      foundedDate:   '2007',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：深圳工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_hn_sz_01', type: 'subsidiary', date: '2007', endDate: '', relatedCompanyId: 'co_nlm', note: '中国・深圳の精密アルミ部品製造。' },
      ],
      children: [],
    },
    { // 華日軽金（蘇州）精密配件（中国・精密部品）
      id: 'co_hn_su', name: '華日軽金（蘇州）精密配件有限公司',
      foundedDate:   '2010',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蘇州工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_hn_su_01', type: 'subsidiary', date: '2010', endDate: '', relatedCompanyId: 'co_nlm', note: '中国・蘇州の精密アルミ部品製造。' },
      ],
      children: [],
    },
    // ── 日本フルハーフ系 ─────────────────────────────────────────────
    { // フルハーフ産業（部品製造・サービス）
      id: 'co_fh_sangyo', name: 'フルハーフ産業㈱',
      foundedDate:   '1979',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、整備部' },
      ],
      corporateEvents: [
        { id: 'ev_fh_sangyo_01', type: 'subsidiary', date: '1979', endDate: '2011', relatedCompanyId: 'co_fullhalf', note: 'トレーラ部品製造・アフターサービス。' },
        { id: 'ev_fh_sangyo_02', type: 'subsidiary', date: '2012', endDate: '', relatedCompanyId: 'co_nlmhd', note: '' },
      ],
      children: [],
    },
    { // フルハーフ北海道
      id: 'co_fh_hokkaido', name: 'フルハーフ北海道㈱',
      foundedDate:   '1977',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、整備部' },
      ],
      corporateEvents: [
        { id: 'ev_fh_hokkaido_01', type: 'subsidiary', date: '1977', endDate: '', relatedCompanyId: 'co_fullhalf', note: '北海道のトレーラ製造・サービス拠点。' },
      ],
      children: [],
    },
    { // フルハーフ岡山
      id: 'co_fh_okayama', name: 'フルハーフ岡山㈱',
      foundedDate:   '1979',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、整備部' },
      ],
      corporateEvents: [
        { id: 'ev_fh_okayama_01', type: 'subsidiary', date: '1979', endDate: '', relatedCompanyId: 'co_fullhalf', note: '岡山のトレーラ製造・サービス拠点。' },
      ],
      children: [],
    },
    { // フルハーフ九州
      id: 'co_fh_kyushu', name: 'フルハーフ九州㈱',
      foundedDate:   '1981',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、整備部' },
      ],
      corporateEvents: [
        { id: 'ev_fh_kyushu_01', type: 'subsidiary', date: '1981', endDate: '', relatedCompanyId: 'co_fullhalf', note: '九州のトレーラ製造・サービス拠点。' },
      ],
      children: [],
    },
    { // フルハーフ滋賀
      id: 'co_fh_shiga', name: 'フルハーフ滋賀㈱',
      foundedDate:   '1985',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、整備部' },
      ],
      corporateEvents: [
        { id: 'ev_fh_shiga_01', type: 'subsidiary', date: '1985', endDate: '', relatedCompanyId: 'co_fullhalf', note: '滋賀のトレーラ製造・サービス拠点。' },
      ],
      children: [],
    },
    { // フルハーフサービス（整備・メンテナンス）
      id: 'co_fh_service', name: 'フルハーフサービス㈱',
      foundedDate:   '2002',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、サービスセンター' },
        { label: '部門', placeholder: '例：整備部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_fh_service_01', type: 'subsidiary', date: '2002', endDate: '', relatedCompanyId: 'co_fullhalf', note: 'トレーラ整備・メンテナンスサービス専業。' },
      ],
      children: [],
    },
    { // Fruehauf Mahajak（タイ・トレーラ）
      id: 'co_fh_mahajak', name: 'Fruehauf Mahajak Co., Ltd.',
      foundedDate:   '1966',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：Bangkok Plant' },
        { label: '部門', placeholder: '例：Manufacturing、Sales' },
      ],
      corporateEvents: [
        { id: 'ev_fh_mahajak_01', type: 'subsidiary', date: '1966', endDate: '', relatedCompanyId: 'co_fullhalf', note: 'タイのトレーラ・自動車車体製造。マハジャク社との合弁。' },
      ],
      children: [],
    },
    // ── 日軽グループ サービス・機能会社 ──────────────────────────────
    { // ケイナラ（アルミ加工・リサイクル）
      id: 'co_keinara', name: 'ケイナラ㈱',
      foundedDate:   '1993',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_keinara_01', type: 'subsidiary', date: '1993', endDate: '', relatedCompanyId: 'co_nlm', note: 'アルミスクラップ処理・再生地金製造。' },
      ],
      children: [],
    },
    { // 日軽ニュービジネス（不動産・福利厚生）
      id: 'co_nikkei_nb', name: '日軽ニュービジネス㈱',
      foundedDate:   '1989',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社' },
        { label: '部門', placeholder: '例：不動産部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_nikkei_nb_01', type: 'subsidiary', date: '1989', endDate: '', relatedCompanyId: 'co_nlm', note: '不動産管理・福利厚生サービス・保険代理。' },
      ],
      children: [],
    },
    { // 日軽金オーリス（人材・福利厚生）
      id: 'co_nlm_auris', name: '日軽金オーリス㈱',
      foundedDate:   '2006',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社' },
        { label: '部門', placeholder: '例：人材部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_nlm_auris_01', type: 'subsidiary', date: '2006', endDate: '', relatedCompanyId: 'co_nlmhd', note: 'グループ人材サービス・福利厚生・健康管理。' },
      ],
      children: [],
    },
    { // ㈱ニッカン（アルミ缶・包材）
      id: 'co_nikkan', name: '㈱ニッカン',
      foundedDate:   '1972',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_nikkan_01', type: 'subsidiary', date: '1972', endDate: '', relatedCompanyId: 'co_nlm', note: 'アルミ缶材・包装材製造。' },
      ],
      children: [],
    },
    { // エヌケイエス（検査・試験）
      id: 'co_nks', name: 'エヌケイエス㈱',
      foundedDate:   '1996',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、試験センター' },
        { label: '部門', placeholder: '例：検査部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_nks_01', type: 'subsidiary', date: '1996', endDate: '', relatedCompanyId: 'co_nlm', note: '材料検査・品質試験・計測サービス。' },
      ],
      children: [],
    },
    { // 日軽パートナーズ（人材・障害者雇用）
      id: 'co_nikkei_partners', name: '日軽パートナーズ㈱',
      foundedDate:   '2010',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社' },
        { label: '部門', placeholder: '例：管理部、サービス部' },
      ],
      corporateEvents: [
        { id: 'ev_nikkei_partners_01', type: 'subsidiary', date: '2010', endDate: '', relatedCompanyId: 'co_nlmhd', note: 'グループ特例子会社。障害者就労支援・各種業務サービス。' },
      ],
      children: [],
    },
    // ── 東洋アルミニウム系 ────────────────────────────────────────────
    { // 東洋アルミエコープロダクツ（リサイクル・環境）
      id: 'co_toyal_eco', name: '東洋アルミエコープロダクツ㈱',
      foundedDate:   '2001',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_eco_01', type: 'subsidiary', date: '2001', endDate: '', relatedCompanyId: 'co_toyo2', note: 'アルミ箔リサイクル・環境配慮型製品製造。' },
      ],
      children: [],
    },
    { // 東海東洋アルミ販売（販売・中部エリア）
      id: 'co_tokai_toyal', name: '東海東洋アルミ販売㈱',
      foundedDate:   '1988',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、営業所' },
        { label: '部門', placeholder: '例：営業部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_tokai_toyal_01', type: 'subsidiary', date: '1988', endDate: '', relatedCompanyId: 'co_toyo2', note: '東海エリアにおける東洋アルミ製品販売。' },
      ],
      children: [],
    },
    { // エー・エル・ピー（アルミ顔料・印刷用途）
      id: 'co_alp', name: 'エー・エル・ピー㈱',
      foundedDate:   '1980',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_alp_01', type: 'subsidiary', date: '1980', endDate: '', relatedCompanyId: 'co_toyo2', note: 'アルミ顔料・印刷用アルミペースト製造・販売。' },
      ],
      children: [],
    },
    { // 東洋アルミ興産（不動産・施設管理）
      id: 'co_toyal_kosan', name: '東洋アルミ興産㈱',
      foundedDate:   '1976',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社' },
        { label: '部門', placeholder: '例：不動産部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_kosan_01', type: 'subsidiary', date: '1976', endDate: '', relatedCompanyId: 'co_toyo2', note: '不動産管理・施設管理・福利厚生サービス。' },
      ],
      children: [],
    },
    { // アルファミック（家庭用アルミ箔製品）
      id: 'co_alphamick', name: 'アルファミック㈱',
      foundedDate:   '1974',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：本社工場' },
        { label: '部門', placeholder: '例：製造部、営業部' },
      ],
      corporateEvents: [
        { id: 'ev_alphamick_01', type: 'subsidiary', date: '1974', endDate: '', relatedCompanyId: 'co_toyo2', note: '家庭用アルミ箔・業務用アルミ製品の製造・販売。' },
      ],
      children: [],
    },
    { // Toyal America（北米・箔・粉末）
      id: 'co_toyal_us', name: 'Toyal America, Inc.',
      foundedDate:   '1987',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：Illinois Plant' },
        { label: '部門', placeholder: '例：Manufacturing、Sales' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_us_01', type: 'subsidiary', date: '1987', endDate: '', relatedCompanyId: 'co_toyo2', note: '北米向けアルミ顔料・粉末製造・販売。' },
      ],
      children: [],
    },
    { // Toyal Europe（欧州・箔・粉末）
      id: 'co_toyal_eu', name: 'Toyal Europe S.A.S.U.',
      foundedDate:   '1988',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：France Plant' },
        { label: '部門', placeholder: '例：Manufacturing、Sales' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_eu_01', type: 'subsidiary', date: '1988', endDate: '', relatedCompanyId: 'co_toyo2', note: '欧州向けアルミ顔料・粉末製造・販売（フランス）。' },
      ],
      children: [],
    },
    { // Toyal Thailand（タイ・箔・粉末）
      id: 'co_toyal_th', name: 'Toyal Thailand Co., Ltd.',
      foundedDate:   '2004',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：Thailand Plant' },
        { label: '部門', placeholder: '例：Manufacturing、Sales' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_th_01', type: 'subsidiary', date: '2004', endDate: '', relatedCompanyId: 'co_toyo2', note: 'タイ向けアルミ箔・粉末製造・販売。' },
      ],
      children: [],
    },
    { // Toyal MMP India（インド・顔料）
      id: 'co_toyal_in', name: 'Toyal MMP India Pvt. Ltd.',
      foundedDate:   '2014',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：India Plant' },
        { label: '部門', placeholder: '例：Manufacturing、Sales' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_in_01', type: 'subsidiary', date: '2014', endDate: '', relatedCompanyId: 'co_toyo2', note: 'インド向けアルミ顔料・粉末製造・販売。合弁会社。' },
      ],
      children: [],
    },
    { // Svam Toyal Packaging（インド・包材）
      id: 'co_svam_toyal', name: 'Svam Toyal Packaging Industries Pvt. Ltd.',
      foundedDate:   '2016',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：India Plant' },
        { label: '部門', placeholder: '例：Manufacturing、Sales' },
      ],
      corporateEvents: [
        { id: 'ev_svam_toyal_01', type: 'subsidiary', date: '2016', endDate: '', relatedCompanyId: 'co_toyo2', note: 'インドのアルミ箔包材製造・販売。Svam社との合弁。' },
      ],
      children: [],
    },
    { // 拓洋鋁（上海）管理（中国・持株管理）
      id: 'co_toyal_sh_mgmt', name: '拓洋鋁（上海）管理有限公司',
      foundedDate:   '2010',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：上海オフィス' },
        { label: '部門', placeholder: '例：管理部、財務部' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_sh_mgmt_01', type: 'subsidiary', date: '2010', endDate: '', relatedCompanyId: 'co_toyo2', note: '中国・上海の持株管理会社。東洋アルミ中国事業統括。' },
      ],
      children: [],
    },
    { // 東洋愛鋁美国際貿易（上海）（中国・貿易）
      id: 'co_toyal_sh_trade', name: '東洋愛鋁美国際貿易（上海）有限公司',
      foundedDate:   '2013',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：上海オフィス' },
        { label: '部門', placeholder: '例：営業部、物流部' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_sh_trade_01', type: 'subsidiary', date: '2013', endDate: '', relatedCompanyId: 'co_toyo2', note: '中国・上海のアルミ製品輸出入・貿易業務。' },
      ],
      children: [],
    },
    { // 蘇州東洋鋁愛科日用品製造（蘇州・家庭用品製造）
      id: 'co_toyal_sz_mfg', name: '蘇州東洋鋁愛科日用品製造有限公司',
      foundedDate:   '2005',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蘇州工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_sz_mfg_01', type: 'subsidiary', date: '2005', endDate: '', relatedCompanyId: 'co_toyo2', note: '中国・蘇州の家庭用アルミ箔製品製造。' },
      ],
      children: [],
    },
    { // 東洋鋁愛科商貿（蘇州）（蘇州・販売）
      id: 'co_toyal_sz_trade', name: '東洋鋁愛科商貿（蘇州）有限公司',
      foundedDate:   '2008',
      oldNames: [],
      levels: [
        { label: '事業所', placeholder: '例：蘇州オフィス' },
        { label: '部門', placeholder: '例：営業部、管理部' },
      ],
      corporateEvents: [
        { id: 'ev_toyal_sz_trade_01', type: 'subsidiary', date: '2008', endDate: '', relatedCompanyId: 'co_toyo2', note: '中国・蘇州のアルミ製品販売・マーケティング。' },
      ],
      children: [],
    },
    { // 湖南寧郷吉唯信金属粉体（中国・アルミ粉末）
      id: 'co_hunan_toyal', name: '湖南寧郷吉唯信金属粉体有限公司',
      foundedDate:   '2012',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：寧郷工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_hunan_toyal_01', type: 'subsidiary', date: '2012', endDate: '', relatedCompanyId: 'co_toyo2', note: '中国・湖南省のアルミ金属粉体製造。東洋アルミとの合弁。' },
      ],
      children: [],
    },
    { // 肇慶東洋鋁業（中国・アルミ箔）
      id: 'co_zhaoqing_toyal', name: '肇慶東洋鋁業有限公司',
      foundedDate:   '2001',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：肇慶工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [
        { id: 'ev_zhaoqing_toyal_01', type: 'subsidiary', date: '2001', endDate: '', relatedCompanyId: 'co_toyo2', note: '中国・広東省肇慶のアルミ箔製造。' },
      ],
      children: [],
    },
    // ── 提携先・協力会社（出向先候補） ───────────────────────────────
    { // UACJ（アルミ大手・販売先・業界提携先）
      id: 'co_uacj', name: 'UACJ㈱',
      foundedDate:   '2013-10-01',
      isGroup: false,
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：名古屋工場、福岡工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 三協立山（アルミ建材大手・主要販売先）
      id: 'co_sankyo_tachiyama', name: '三協立山㈱',
      foundedDate:   '2012-04-02',
      isGroup: false,
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、設計部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // YKK AP（アルミ建材大手・主要販売先）
      id: 'co_ykkap', name: 'YKK AP㈱',
      foundedDate:   '1991-04',
      isGroup: false,
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、設計部' },
      ],
      corporateEvents: [],
      children: [],
    },
    // ── 主要販売先（自動車・建材・包材・電機） ──────────────────────────
    { // トヨタ自動車（アルミ板・押出材・ダイカスト部品の主要販売先）
      id: 'co_toyota', name: 'トヨタ自動車㈱',
      foundedDate:   '1937-08-28',
      oldNames: [
        { name: 'トヨタ自動車工業㈱', untilDate: '1982' },
      ],
      levels: [
        { label: '事業所・工場', placeholder: '例：元町工場、堤工場' },
        { label: '部門', placeholder: '例：製造部、購買部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 本田技研工業（アルミ圧延材・押出材・熱交換器の販売先）
      id: 'co_honda', name: '本田技研工業㈱',
      foundedDate:   '1948-09-24',
      oldNames: [],
      levels: [
        { label: '事業所・工場', placeholder: '例：鈴鹿製作所、栃木工場' },
        { label: '部門', placeholder: '例：製造部、購買部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 日産自動車（アルミ板・部品の販売先）
      id: 'co_nissan', name: '日産自動車㈱',
      foundedDate:   '1933-12-26',
      oldNames: [],
      levels: [
        { label: '事業所・工場', placeholder: '例：追浜工場、栃木工場' },
        { label: '部門', placeholder: '例：製造部、購買部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // マツダ（アルミ板・車体材料の販売先）
      id: 'co_mazda', name: 'マツダ㈱',
      foundedDate:   '1920-01-30',
      oldNames: [
        { name: '東洋工業㈱', untilDate: '1984' },
      ],
      levels: [
        { label: '事業所・工場', placeholder: '例：本社工場、防府工場' },
        { label: '部門', placeholder: '例：製造部、調達部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // ㈱LIXIL（建材・サッシ等の主要販売先。旧・新日軽の後継販売先）
      id: 'co_lixil', name: '㈱LIXIL',
      foundedDate:   '2011-04-01',
      oldNames: [
        { name: '㈱住生活グループ', untilDate: '2011' },
      ],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：建材事業部、購買部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 東洋製罐グループHD（アルミ箔・包材の主要販売先。東洋アルミの主要顧客）
      id: 'co_toyo_seikan', name: '東洋製罐グループHD㈱',
      foundedDate:   '1917-08-01',
      oldNames: [
        { name: '東洋製罐㈱', untilDate: '2013' },
      ],
      levels: [
        { label: '事業所・工場', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、購買部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 大和製罐（アルミ缶・包材の販売先）
      id: 'co_daiwa_can', name: '大和製罐㈱',
      foundedDate:   '1935',
      oldNames: [],
      levels: [
        { label: '事業所・工場', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、購買部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // パナソニックHD（熱交換器・電子材料の販売先）
      id: 'co_panasonic', name: 'パナソニックHD㈱',
      foundedDate:   '1935-12-15',
      oldNames: [
        { name: 'パナソニック㈱', untilDate: '2022' },
        { name: '松下電器産業㈱', untilDate: '2008' },
      ],
      levels: [
        { label: '事業所・工場', placeholder: '例：守口、草津工場' },
        { label: '部門', placeholder: '例：製造部、購買部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 三菱電機（熱交換器・電子機器用アルミ材の販売先）
      id: 'co_mitsubishi_elec', name: '三菱電機㈱',
      foundedDate:   '1921-01-15',
      oldNames: [],
      levels: [
        { label: '事業所・工場', placeholder: '例：名古屋製作所、静岡製作所' },
        { label: '部門', placeholder: '例：製造部、調達部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 凸版印刷（アルミ箔ラミネート・軟包材の販売先。東洋アルミの主要顧客）
      id: 'co_toppan', name: '凸版印刷㈱',
      foundedDate:   '1900-01-15',
      oldNames: [],
      levels: [
        { label: '事業所・工場', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、資材部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 大日本印刷（アルミ箔包材・軟包材の販売先）
      id: 'co_dnp', name: '大日本印刷㈱',
      foundedDate:   '1876-10-09',
      oldNames: [],
      levels: [
        { label: '事業所・工場', placeholder: '例：本社、工場' },
        { label: '部門', placeholder: '例：製造部、資材部' },
      ],
      corporateEvents: [],
      children: [],
    },
    // ── 主要外注先・製造協力会社 ─────────────────────────────────────
    { // 東邦瓦斯（工業ガス・燃料の主要調達先）
      id: 'co_toho_gas', name: '東邦瓦斯㈱',
      foundedDate:   '1922-06-01',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、配送センター' },
        { label: '部門', placeholder: '例：産業用ガス部、営業部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // エア・ウォーター（工業用ガス・LNG等の調達先）
      id: 'co_airwater', name: 'エア・ウォーター㈱',
      foundedDate:   '2000-12-01',
      oldNames: [
        { name: '日本酸素㈱', untilDate: '2000' },
      ],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、製造所' },
        { label: '部門', placeholder: '例：産業ガス部、物流部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 岩谷産業（工業用ガス・液体ガスの調達先）
      id: 'co_iwatani', name: '岩谷産業㈱',
      foundedDate:   '1930-03-10',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、配送基地' },
        { label: '部門', placeholder: '例：産業ガス部、営業部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 日本冶金工業（特殊合金・金属材料の調達先・協力先）
      id: 'co_nihon_yakin', name: '日本冶金工業㈱',
      foundedDate:   '1925-09-09',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：川崎製造所、大江工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 住友化学（薬剤・化成品の調達先）
      id: 'co_sumitomo_chem', name: '住友化学㈱',
      foundedDate:   '1913-06-01',
      oldNames: [],
      levels: [
        { label: '事業所・工場', placeholder: '例：大阪工場、愛媛工場' },
        { label: '部門', placeholder: '例：製造部、営業部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 三菱マテリアル（工具・アルミスクラップ処理の協力先）
      id: 'co_mitsubishi_mat', name: '三菱マテリアル㈱',
      foundedDate:   '1950-04-01',
      oldNames: [
        { name: '三菱金属鉱業㈱', untilDate: '1990' },
      ],
      levels: [
        { label: '事業所・工場', placeholder: '例：本社、製造所' },
        { label: '部門', placeholder: '例：製造部、技術部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 中電工（電気工事・設備保全の協力会社）
      id: 'co_chudenko', name: '中電工㈱',
      foundedDate:   '1944-09-19',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、支店' },
        { label: '部門', placeholder: '例：電気工事部、設備部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 大気社（塗装設備・環境システムの協力会社）
      id: 'co_taikiasahi', name: '㈱大気社',
      foundedDate:   '1918-05-18',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工事事務所' },
        { label: '部門', placeholder: '例：施工部、設備部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // 中部電力（電力調達先。製造の主要エネルギー）
      id: 'co_chubu_ep', name: '中部電力㈱',
      foundedDate:   '1951-05-01',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本店、配電所' },
        { label: '部門', placeholder: '例：営業部、工務部' },
      ],
      corporateEvents: [],
      children: [],
    },
    { // JFEエンジニアリング（プラント・設備工事の協力会社）
      id: 'co_jfe_eng', name: 'JFEエンジニアリング㈱',
      foundedDate:   '2003-04-01',
      oldNames: [
        { name: 'NKK㈱', untilDate: '2003' },
      ],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、工事事務所' },
        { label: '部門', placeholder: '例：プラント部、設備部' },
      ],
      corporateEvents: [],
      children: [],
    },
    // ── 消滅・吸収合併・売却（履歴） ───────────────────────────────
    { // アルミ器物（那須）
      id: 'co_nasu', name: '那須アルミニューム器具',
      foundedDate:   '1903',
      dissolvedDate: '1971',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nasu_01', type: 'subsidiary', date: '1939', endDate: '1971', relatedCompanyId: 'co_nlm', note: '' },
        { id: 'ev_nasu_02', type: 'merger-absorbed', date: '1971', endDate: '', relatedCompanyId: 'co_nikkeialumi', note: '1971年 大阪アルミと合併し日軽アルミ㈱へ。' },
      ],
      children: [],
    },
    { // アルミ器物（大阪）
      id: 'co_osaka', name: '大阪アルミニウム㈱',
      foundedDate:   '1918',
      dissolvedDate: '1971',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_osaka_01', type: 'subsidiary', date: '1939', endDate: '1971', relatedCompanyId: 'co_nlm', note: '' },
        { id: 'ev_osaka_02', type: 'merger-absorbed', date: '1971', endDate: '', relatedCompanyId: 'co_nikkeialumi', note: '1971年 那須アルミと合併し日軽アルミ㈱へ。' },
      ],
      children: [],
    },
    { // アルミ加工統合会社
      id: 'co_nikkeialumi', name: '日軽アルミ㈱',
      foundedDate:   '1971',
      dissolvedDate: '1974-10',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nikkeialumi_01', type: 'subsidiary', date: '1971', endDate: '1974-10', relatedCompanyId: 'co_nlm', note: 'アルミ加工統合会社' },
        { id: 'ev_nikkeialumi_02', type: 'merger-absorbed', date: '1974-10', endDate: '', relatedCompanyId: 'co_nlm', note: '1974年10月 日本軽金属㈱に吸収合併。' },
      ],
      children: [],
    },
    { // アルミ圧延
      id: 'co_tokukin', name: '日軽圧延㈱',
      foundedDate:   '1934',
      dissolvedDate: '1978-10',
      oldNames: [
        { name: '特殊軽合金㈱', untilDate: '1962' },
      ],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_tokukin_01', type: 'subsidiary', date: '1939', endDate: '1978-10', relatedCompanyId: 'co_nlm', note: '' },
        { id: 'ev_tokukin_02', type: 'merger-absorbed', date: '1978-10', endDate: '', relatedCompanyId: 'co_nlm', note: '1978年10月 日本軽金属㈱に吸収合併。' },
      ],
      children: [],
    },
    { // アルミ二次合金
      id: 'co_taishin', name: '大信軽金属㈱',
      foundedDate:   '1948',
      dissolvedDate: '1991-04',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
        { id: 'ev_taishin_01', type: 'subsidiary', date: '1948', endDate: '1991-04', relatedCompanyId: 'co_nlm', note: 'アルミ二次合金' },
        { id: 'ev_taishin_02', type: 'merger-absorbed', date: '1991-04', endDate: '', relatedCompanyId: 'co_nlm', note: '1991年4月 日本軽金属㈱に吸収合併。' },
      ],
      children: [],
    },
    { // 研究・技術開発
      id: 'co_kenkyujo', name: '㈱日軽技研',
      foundedDate:   '1961-04',
      dissolvedDate: '1995',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_kenkyujo_01', type: 'subsidiary', date: '1961', endDate: '1995', relatedCompanyId: 'co_nlm', note: '研究・技術開発' },
        { id: 'ev_kenkyujo_02', type: 'merger-absorbed', date: '1995', endDate: '', relatedCompanyId: 'co_nlm', note: '1995年 日本軽金属㈱に合併（グループ技術センター 発足）。' },
      ],
      children: [],
    },
    { // 化成品（清水）
      id: 'co_nikachem', name: '日軽化工㈱',
      foundedDate:   '1958',
      dissolvedDate: '1989-04',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
        { id: 'ev_nikachem_01', type: 'subsidiary', date: '1958', endDate: '1989-04', relatedCompanyId: 'co_nlm', note: '化成品（清水）' },
        { id: 'ev_nikachem_02', type: 'merger-absorbed', date: '1989-04', endDate: '', relatedCompanyId: 'co_nlm', note: '1989年4月 日本軽金属㈱に吸収合併。' },
      ],
      children: [],
    },
    { // 苫小牧（電解除く）
      id: 'co_tomakomai', name: '日軽苫小牧㈱',
      foundedDate:   '1982-06',
      dissolvedDate: '1989-04',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_tomakomai_01', type: 'subsidiary', date: '1982', endDate: '1989-04', relatedCompanyId: 'co_nlm', note: '苫小牧（電解除く）' },
        { id: 'ev_tomakomai_02', type: 'merger-absorbed', date: '1989-04', endDate: '', relatedCompanyId: 'co_nlm', note: '1989年4月 日本軽金属㈱に吸収合併。' },
      ],
      children: [],
    },
    { // 冷熱事業
      id: 'co_reito', name: '日軽冷熱㈱',
      foundedDate:   '1986',
      dissolvedDate: '1993',
      oldNames: [],
      levels: [
        { label: '拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：管理部門、技術部門' },
      ],
      corporateEvents: [
        { id: 'ev_reito_01', type: 'subsidiary', date: '1986', endDate: '1993', relatedCompanyId: 'co_nlm', note: '冷熱事業' },
        { id: 'ev_reito_02', type: 'merger-absorbed', date: '1993', endDate: '', relatedCompanyId: 'co_nlm', note: '1993年 日本軽金属㈱に合併。2002年に再分社化。' },
      ],
      children: [],
    },
    { // 箔・粉末
      id: 'co_toyo1', name: '東洋アルミニウム㈱(初代)',
      foundedDate:   '1931',
      dissolvedDate: '1999-10',
      oldNames: [
        { name: '住友アルミニウム㈱', untilDate: '1960' },
      ],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_toyo1_01', type: 'subsidiary', date: '1996', endDate: '1999-10', relatedCompanyId: 'co_nlm', note: '' },
        { id: 'ev_toyo1_02', type: 'merger-absorbed', date: '1999-10', endDate: '', relatedCompanyId: 'co_nlm', note: '1999年10月 日本軽金属㈱に合併。2002年に再独立。' },
      ],
      children: [],
    },
    { // アルミ商社
      id: 'co_yurin', name: '日軽商事㈱',
      foundedDate:   '1950',
      dissolvedDate: '2000',
      oldNames: [],
      levels: [
        { label: '支店・営業所', placeholder: '例：東京支店、大阪支店' },
        { label: '部', placeholder: '例：営業部、管理部' },
        { label: '課', placeholder: '例：営業一課、営業二課' },
      ],
      corporateEvents: [
        { id: 'ev_yurin_01', type: 'subsidiary', date: '1950', endDate: '2000', relatedCompanyId: 'co_nlm', note: 'アルミ商社' },
        { id: 'ev_yurin_02', type: 'merger-absorbed', date: '2000', endDate: '', relatedCompanyId: 'co_kowa', note: '2000年 日軽産業㈱に統合。' },
      ],
      children: [],
    },
    { // 押出（蒲原）
      id: 'co_nikkaru', name: 'ニッカル押出㈱',
      foundedDate:   '1973',
      dissolvedDate: '1985-04',
      oldNames: [],
      levels: [
        { label: '製造所・工場', placeholder: '例：蒲原製造所、名古屋工場' },
        { label: '部門', placeholder: '例：製造部、技術部' },
        { label: '課', placeholder: '例：製造課、品質管理課' },
      ],
      corporateEvents: [
        { id: 'ev_nikkaru_01', type: 'subsidiary', date: '1973', endDate: '1985-04', relatedCompanyId: 'co_nlm', note: '押出（蒲原）' },
        { id: 'ev_nikkaru_02', type: 'merger-absorbed', date: '1985-04', endDate: '', relatedCompanyId: 'co_nlm', note: '1985年4月 日本軽金属㈱に吸収合併（蒲原押出工場へ）。' },
      ],
      children: [],
    },
    { // アルミ建材
      id: 'co_hokuriku', name: 'ホクセイアルミニウム㈱',
      foundedDate:   '1944',
      dissolvedDate: '1988',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：設計部、施工部' },
      ],
      corporateEvents: [
        { id: 'ev_hokuriku_01', type: 'subsidiary', date: '1944', endDate: '1988', relatedCompanyId: 'co_nlm', note: 'アルミ建材' },
        { id: 'ev_hokuriku_02', type: 'merger-absorbed', date: '1988', endDate: '', relatedCompanyId: 'co_shin', note: '1988年 新日軽㈱に吸収合併。' },
      ],
      children: [],
    },
    { // 住宅建材
      id: 'co_hoksei77', name: '日軽ホクセイ住宅建材㈱',
      foundedDate:   '1977',
      dissolvedDate: '1984-02',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：設計部、施工部' },
      ],
      corporateEvents: [
        { id: 'ev_hoksei77_01', type: 'subsidiary', date: '1977', endDate: '1984-02', relatedCompanyId: 'co_nlm', note: '住宅建材' },
        { id: 'ev_hoksei77_02', type: 'merger-absorbed', date: '1984-02', endDate: '', relatedCompanyId: 'co_shin', note: '1984年2月 新日軽㈱の設立時に統合。' },
      ],
      children: [],
    },
    { // 建材統合会社
      id: 'co_shin', name: '新日軽㈱',
      foundedDate:   '1984-02',
      dissolvedDate: '2010-04',
      oldNames: [],
      levels: [
        { label: '事業所・拠点', placeholder: '例：本社、支社' },
        { label: '部門', placeholder: '例：設計部、施工部' },
      ],
      corporateEvents: [
        { id: 'ev_shin_01', type: 'subsidiary', date: '1984', endDate: '2010-03', relatedCompanyId: 'co_nlm', note: '建材統合会社' },
        { id: 'ev_shin_02', type: 'sold', date: '2010-04', endDate: '', relatedCompanyId: '', note: '2010年4月 ㈱住生活グループ（現LIXIL）へ全株式を売却しグループ離脱。' },
      ],
      children: [],
    },
  ],
  tag: [
    { id:'t1', name:'リーダー候補', color:'#EF4444', parentId:'' },
    { id:'t2', name:'技術職',       color:'#3B82F6', parentId:'' },
    { id:'t3', name:'営業職',       color:'#10B981', parentId:'' },
    { id:'t4', name:'管理部門',     color:'#8B5CF6', parentId:'' },
    { id:'t5', name:'中途採用',     color:'#F97316', parentId:'' },
    { id:'t6', name:'長期在籍',     color:'#F59E0B', parentId:'' },
  ],
};

/* ================================================================
   SETTINGS APPLY（loadDB・import 共用）
================================================================ */
function applySettingsData(s) {
  if (!s) return;
  if (s.yAxis    !== undefined) DB.settings.yAxis    = s.yAxis;
  if (s.split    !== undefined) DB.settings.split    = s.split;
  if (s.yAxisDir !== undefined) DB.settings.yAxisDir = s.yAxisDir;
  if (s.badges)                  Object.assign(DB.settings.badges, s.badges);
  if (s.cardColorMode)           DB.settings.cardColorMode = s.cardColorMode;
  if (s.numericThreshold)        Object.assign(DB.settings.numericThreshold, s.numericThreshold);
  if (s.showEmptyRows !== undefined) DB.settings.showEmptyRows = !!s.showEmptyRows;
  if (Array.isArray(s.listCols))     DB.settings.listCols = s.listCols;
  if (s.showSearchMarker !== undefined) DB.settings.showSearchMarker = !!s.showSearchMarker;
  if (s.hm) {
    if (s.hm.panels && Array.isArray(s.hm.panels)) {
      DB.settings.hm.panels = s.hm.panels;
    } else {
      // 旧バージョンからのマイグレーション
      let yAxes = Array.isArray(s.hm.yAxis) ? s.hm.yAxis : [s.hm.yAxis || 'hire'];
      let fmts = Array.isArray(s.hm.areaFormats) ? s.hm.areaFormats : [];
      DB.settings.hm.panels = yAxes.map((y, i) => ({
        id: 'p_' + Date.now() + '_' + i,
        xAxis: s.hm.xAxis || 'gender',
        yAxis: y,
        format: fmts[i] || s.hm.format || 'table',
        dispMode: s.hm.dispMode || 'count',
        horizontal: false,
        swapAxis: s.hm.swapAxis || false,
        xAxisDir: s.hm.xAxisDir || 'asc',
        yAxisDir: s.hm.yAxisDir || 'asc',
        axisRange: s.hm.axisRange ? JSON.parse(JSON.stringify(s.hm.axisRange)) : { mode: 'auto', min: null, max: null, niceScale: true }
      }));
    }
  }
  if (s.distStatusFilter)            Object.assign(DB.settings.distStatusFilter, s.distStatusFilter);
  if (s.statusCardStyle !== undefined) DB.settings.statusCardStyle = !!s.statusCardStyle;
  if (s.masterCountBadge !== undefined) DB.settings.masterCountBadge = !!s.masterCountBadge;
  if (s.companyBadges)        Object.assign(DB.settings.companyBadges, s.companyBadges);
  if (Array.isArray(s.companySearchHistory)) DB.settings.companySearchHistory = s.companySearchHistory;
  if (s.showCardAvatar !== undefined) DB.settings.showCardAvatar = !!s.showCardAvatar;
  if (s.cardPopup) Object.assign(DB.settings.cardPopup, s.cardPopup);
  if (s.showWareki !== undefined) DB.settings.showWareki = !!s.showWareki;
  if (s.dashLayout) DB.settings.dashLayout = s.dashLayout;
  if (s.globalFilter) {
    Object.assign(DB.settings.globalFilter, s.globalFilter);
    if (!Array.isArray(DB.settings.globalFilter.company))   DB.settings.globalFilter.company   = [];
    if (!Array.isArray(DB.settings.globalFilter.school))    DB.settings.globalFilter.school    = [];
    if (!Array.isArray(DB.settings.globalFilter.education)) DB.settings.globalFilter.education = [];
  }
}

/* ================================================================
   FLAT MASTER ↔ EMPLOYEE FIELD SYNC
================================================================ */
const FLAT_MASTER_EMP_FIELDS = {
  status:    'status',
  attribute: 'attribute',
  hireType:  'hireType',
  course:    'course',
  // position は異動履歴側フィールドのため employee 直接フィールドとしては不使用
};

function getFlatMasterEmpCount(type, name) {
  // position は異動履歴フィールドなので特別処理
  if (type === 'position') {
    let cnt = 0;
    DB.employees.forEach(e => { (e.transfers || []).forEach(t => { if (t.position === name) cnt++; }); });
    return cnt;
  }
  const field = FLAT_MASTER_EMP_FIELDS[type];
  if (!field) return 0;
  return DB.employees.filter(e => e[field] === name).length;
}

function syncEmpFlatMasterField(type, oldName, newName) {
  const empField = FLAT_MASTER_EMP_FIELDS[type];
  if (!empField || !oldName) return 0;
  let count = 0;
  DB.employees.forEach(emp => {
    if (emp[empField] === oldName) { emp[empField] = newName; count++; }
  });
  const filterKeyMap = { status:'status', attribute:'attr', hireType:'hireType', course:'course' };
  const fk = filterKeyMap[type];
  if (fk && listFilters[fk] === oldName) listFilters[fk] = newName;
  if (type === 'status') {
    const sf = DB.settings.distStatusFilter;
    if (oldName in sf) {
      const prev = sf[oldName];
      delete sf[oldName];
      if (newName) sf[newName] = prev;
    }
    // globalFilter.status も更新
    const gf = DB.settings.globalFilter.status;
    const gi = gf.indexOf(oldName);
    if (gi >= 0) { gf.splice(gi, 1, ...(newName ? [newName] : [])); }
  }
  return count;
}

/* ================================================================
   PERSISTENCE — IndexedDB（メインデータ）
================================================================ */
const STORE_KEY = 'emp_dist_v2'; // localStorage 移行チェック用キー

/** アプリデータを IndexedDB に保存（fire-and-forget）*/
function saveDB() {
  const payload = JSON.stringify({
    employees: DB.employees, tags: DB.tags,
    masters: DB.masters, masterConfig: DB.masterConfig, settings: DB.settings
  });
  _persistToIDB(payload);
}

async function _persistToIDB(payload) {
  try {
    const db = await initDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_APPDATA_STORE, 'readwrite');
      tx.objectStore(IDB_APPDATA_STORE).put({ key: 'main', data: payload });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { /* データは常にメモリ上にあるため無視 */ }
}

/**
 * IndexedDB からアプリデータを読み込む（async）
 * IDB にデータがなければ localStorage から自動移行する。
 * @returns {Promise<boolean>}
 */
async function loadDB() {
  try {
    const db  = await initDB();
    const rec = await new Promise((resolve, reject) => {
      const tx  = db.transaction(IDB_APPDATA_STORE, 'readonly');
      const req = tx.objectStore(IDB_APPDATA_STORE).get('main');
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(tx.error);
    });

    if (rec?.data) return _applyLoadedData(rec.data);

    // localStorage からの初回移行
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const ok = _applyLoadedData(raw);
      if (ok) { await _persistToIDB(raw); localStorage.removeItem(STORE_KEY); }
      return ok;
    }
    return false;
  } catch (_) {
    // IDB 利用不可: localStorage へフォールバック
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) return _applyLoadedData(raw); } catch (_2) {}
    return false;
  }
}

function _applyLoadedData(raw) {
  try {
    const d = JSON.parse(raw);
    if (Array.isArray(d.employees)) DB.employees = d.employees;
    if (Array.isArray(d.tags))      DB.tags      = d.tags;
    if (d.masters) {
      Object.keys(d.masters).forEach(type => {
        if (Array.isArray(d.masters[type])) DB.masters[type] = d.masters[type];
      });
    }
    if (d.masterConfig) {
      Object.keys(d.masterConfig).forEach(type => {
        if (!DB.masterConfig[type]) DB.masterConfig[type] = {};
        const src = d.masterConfig[type];
        if (src.levels)    DB.masterConfig[type].levels    = src.levels;
        if (src.type)      DB.masterConfig[type].type      = src.type;
        if (src.label)     DB.masterConfig[type].label     = src.label;
        if (src.icon)      DB.masterConfig[type].icon      = src.icon;
        if (src.itemLabel) DB.masterConfig[type].itemLabel = src.itemLabel;
        if (src.rootLabel) DB.masterConfig[type].rootLabel = src.rootLabel;
      });
    }
    if (d.settings) applySettingsData(d.settings);

    // corporateRelation（旧形式・単一オブジェクト）→ corporateEvents（新形式・配列）への自動マイグレーション
    function _migrateCorporateEvents(nodes) {
      (nodes || []).forEach(node => {
        if (node.corporateRelation && !node.corporateEvents) {
          const rel = node.corporateRelation;
          if (rel.relationType && rel.relationType !== 'none' && rel.parentCompanyId) {
            node.corporateEvents = [{
              id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              type: rel.relationType,
              date: rel.startDate || '',
              endDate: rel.endDate || '',
              relatedCompanyId: rel.parentCompanyId,
              note: rel.note || '',
            }];
          } else {
            node.corporateEvents = [];
          }
          delete node.corporateRelation;
        } else if (!node.corporateEvents) {
          node.corporateEvents = [];
        }
        if (node.children?.length) _migrateCorporateEvents(node.children);
      });
    }
    _migrateCorporateEvents(DB.masters.company);

    // 会社マスタ masterConfig: 旧形式（depth=0に会社ラベル）→新形式（depth=1以降のみ）への自動マイグレーション
    const compLevels = DB.masterConfig.company?.levels;
    if (Array.isArray(compLevels) && compLevels.length > 0) {
      const firstLabel = (compLevels[0]?.label || '').replace(/[　\s]/g, '');
      // 旧depth=0ラベルの判定：「会社」「グループ」「グループ会社」などが含まれる
      if (firstLabel.includes('会社') || firstLabel.includes('グループ') || firstLabel.includes('Group')) {
        // depth=0ラベルを除去して depth=1以降のみ残す
        const migrated = compLevels.slice(1);
        DB.masterConfig.company.levels = migrated.length > 0 ? migrated : [
          { label: '組織',   placeholder: '例：本部、事業部、支社、工場' },
          { label: '部門',   placeholder: '例：製造部、総務部、技術部' },
          { label: '課',     placeholder: '例：仕上課、品質管理課' },
        ];
      }
    }

    // 役職マスタ: 旧flat/position_grade形式 → 標準ツリー形式への自動移行
    const posMasters = DB.masters.position;
    if (!Array.isArray(posMasters) || !posMasters.length) {
      DB.masters.position = JSON.parse(JSON.stringify(DEFAULT_MASTERS.position));
    }
    
    // masterConfig.position の type 指定（position_grade等）を削除して標準ツリー化
    if (DB.masterConfig.position?.type === 'position_grade' || DB.masterConfig.position?.type === 'flat') {
      delete DB.masterConfig.position.type;
      Object.assign(DB.masterConfig.position, {
        label: '役職', icon: 'fa-solid fa-user-tie',
        levels:[
          { label: '役職グループ', placeholder: '例：取締役、執行役員、管理職' },
          { label: '役職名', placeholder: '例：社長、部長、課長' },
        ]
      });
    }
    return true;

  } catch (_) { return false; }
}

/* ================================================================
   UTILITIES
================================================================ */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function _buildEmpSearchText(e) {
  const state = getEmpActiveState(e);
  const orgs = state.orgLevels.join(' ');
  const conc = (state.concurrents || []).map(c => c.orgLevels.join(' ') + ' ' + (c.position||'')).join(' ');
  const tags = (e.tags || []).map(id => { const t = DB.tags.find(x=>x.id===id); return t ? t.name : ''; }).join(' ');
  const age = getEmpAge(e) !== null ? getEmpAge(e) + '歳' : '';
  const yrs = calcYears(e.hireDate) !== null ? calcYears(e.hireDate) + '年' : '';
  
  return [
    e.lastName, e.firstName, e.lastNameKana, e.firstNameKana,
    e.gender, e.birthDate, e.hireDate, e.attribute, e.status, e.hireType, e.course,
    e.education, e.school, e.eduDept, e.memo,
    orgs, state.position, state.workLocation, conc, tags, age, yrs
  ].filter(Boolean).join(' ').toLowerCase();
}

function _matchSearchTerms(text, queryStr) {
  if (!queryStr) return true;
  const terms = queryStr.toLowerCase().replace(/　/g, ' ').split(/\s+/).filter(Boolean);
  return terms.every(term => text.includes(term));
}

/**
 * 重複検出用の正規化文字列を生成する（表記ゆれ吸収用）
 * 全角英数→半角、大文字→小文字、スペース除去、法人格除去
 */
function normalizeForDuplicate(str) {
  if (!str) return '';
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
    .replace(/[\s　]/g, '')
    .toLowerCase()
    .replace(/株式会社|有限会社|合同会社|㈱|㈲|合/g, '');
}

/* 干支・誕生月・経験年数の計算 */
const ZODIAC_ICONS = {
  '子': 'fa-solid fa-cheese',
  '丑': 'fa-solid fa-cow',
  '寅': 'fa-solid fa-cat',
  '卯': 'fa-solid fa-carrot',
  '辰': 'fa-solid fa-dragon',
  '巳': 'fa-solid fa-staff-snake',
  '午': 'fa-solid fa-chess-knight',
  '未': 'fa-solid fa-cloud',
  '申': 'fa-solid fa-face-smile',
  '酉': 'fa-solid fa-dove',
  '戌': 'fa-solid fa-dog',
  '亥': 'fa-solid fa-piggy-bank'
};
function getZodiacIcon(z) { return ZODIAC_ICONS[z] || 'fa-solid fa-paw'; }

function getZodiac(birthDate) {
  if (!birthDate) return null;
  const match = birthDate.match(/^(\d{4})/);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const zodiacs = ['申','酉','戌','亥','子','丑','寅','卯','辰','巳','午','未'];
  return zodiacs[year % 12];
}

function getBirthMonth(birthDate) {
  if (!birthDate) return null;
  const match = birthDate.match(/^\d{4}-(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

function _calculateExperience(emp) {
  if (!emp) return { orgYears: null, posYears: null };
  const transfers = [...(emp.transfers || [])].map((t, i) => ({ ...t, _origIdx: i })).sort((a, b) => {
    const keyA = a.date || a.endDate || '';
    const keyB = b.date || b.endDate || '';
    const cmp = keyA.localeCompare(keyB);
    return cmp !== 0 ? cmp : a._origIdx - b._origIdx;
  });
  let currentOrgStr = '[]', currentPos = '';
  let orgStartDate = emp.hireDate, posStartDate = emp.hireDate;
  const today = new Date().toISOString().slice(0, 10);

  for (const tr of transfers) {
    if (tr.date && tr.date > today) break;
    const orgs = Array.isArray(tr.orgLevels) ? tr.orgLevels : [tr.company || '', tr.department || '', tr.division || ''].filter(Boolean);
    const kind = tr.kind || 'assignment';

    if (kind === 'assignment' || kind === 'secondment' || kind === 'transfer') {
      const newOrgStr = JSON.stringify(orgs.length > 0 ? orgs : []);
      if (newOrgStr !== currentOrgStr) { currentOrgStr = newOrgStr; orgStartDate = tr.date; }
    }
    if (tr.position !== undefined && tr.position !== null && tr.position !== '') {
      if ((kind === 'positionChange' && (!orgs.length || JSON.stringify(orgs) === currentOrgStr)) || kind === 'assignment' || kind === 'transfer' || kind === 'secondment') {
        if (tr.position !== currentPos) { currentPos = tr.position; posStartDate = tr.date; }
      }
    }
    if (kind === 'removePosition' && (!orgs.length || JSON.stringify(orgs) === currentOrgStr)) {
      currentPos = '';
    }
    if (kind === 'endAssignment' && (!orgs.length || JSON.stringify(orgs) === currentOrgStr)) {
      currentOrgStr = '[]';
      currentPos = '';
    }
  }
  return {
    orgYears: currentOrgStr !== '[]' ? calcYears(orgStartDate) : null,
    posYears: currentPos !== '' ? calcYears(posStartDate) : null
  };
}

function getOrgExperienceYears(emp) { return _calculateExperience(emp).orgYears; }
function getPosExperienceYears(emp) { return _calculateExperience(emp).posYears; }

function estimateBirthDateRange(approxList) {
  if (!approxList || !approxList.length) return null;
  let maxMinTime = -Infinity;
  let minMaxTime = Infinity;

  for (const item of approxList) {
    if (item.age == null || !item.refDate) continue;
    let ds = item.refDate;
    if (ds.length === 4) ds += '-01-01';
    else if (ds.length === 7) ds += '-01';

    const ref = new Date(ds.replace(/-/g, '/'));
    if (isNaN(ref)) continue;
    
    const minD = new Date(ref.getFullYear() - (item.age + 1), ref.getMonth(), ref.getDate() + 1);
    const maxD = new Date(ref.getFullYear() - item.age, ref.getMonth(), ref.getDate());

    if (minD.getTime() > maxMinTime) maxMinTime = minD.getTime();
    if (maxD.getTime() < minMaxTime) minMaxTime = maxD.getTime();
  }

  if (maxMinTime > minMaxTime) return null;
  return { minTime: maxMinTime, maxTime: minMaxTime };
}

function calcAge(d) {
  if (!d) return null;
  let ds = d;
  if (ds.length === 4) ds += '-01-01';
  else if (ds.length === 7) ds += '-01';
  const b = new Date(ds.replace(/-/g, '/')); if (isNaN(b)) return null;
  const t = new Date();
  let age = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) age--;
  return age < 0 ? null : age;
}

function getEmpAge(emp) {
  if (!emp) return null;
  if (emp.birthDate) return calcAge(emp.birthDate);
  let approxList = [];
  if (emp.ageApprox) {
    if (Array.isArray(emp.ageApprox)) approxList = emp.ageApprox;
    else approxList = [emp.ageApprox];
  }
  const range = estimateBirthDateRange(approxList);
  if (range) {
    const est = new Date((range.minTime + range.maxTime) / 2);
    const t = new Date();
    let age = t.getFullYear() - est.getFullYear();
    if (t.getMonth() < est.getMonth() || (t.getMonth() === est.getMonth() && t.getDate() < est.getDate())) age--;
    return age < 0 ? null : age;
  }
  return null;
}

function hasApproxAge(emp) {
  if (!emp) return false;
  if (emp.birthDate) return false;
  if (Array.isArray(emp.ageApprox)) return emp.ageApprox.some(a => a.age != null && a.refDate);
  return emp.ageApprox && emp.ageApprox.age != null && emp.ageApprox.refDate;
}

function getAdjHireYearInfo(emp) {
  if (!emp) return null;
  const y = parseHireYear(emp.hireDate);
  if (y === null) return null;
  const edu = emp.education || '';
  let adj = 0;
  let isUnset = false;
  switch (edu) {
    case '中卒': adj = 7; break;
    case '高卒': adj = 4; break;
    case '短大卒': 
    case '高専卒':
    case '専門卒': adj = 2; break;
    case '大卒': adj = 0; break;
    case '修士': adj = -2; break;
    case '博士': adj = -5; break;
    default: adj = 0; isUnset = true; break;
  }
  return { year: y + adj, isUnset, original: y, adj };
}

/* ================================================================
   和暦テキスト入力パーサー & 共通日付正規化
================================================================ */
const _WAREKI_ERAS = [
  { re: /^(?:令和|令|R|Ｒ)/i, base: 2018 },
  { re: /^(?:平成|平|H|Ｈ)/i, base: 1988 },
  { re: /^(?:昭和|昭|S|Ｓ)/i, base: 1925 },
  { re: /^(?:大正|大|T|Ｔ)/i, base: 1911 },
  { re: /^(?:明治|明|M|Ｍ)/i, base: 1867 },
];

function _parseWareki(s) {
  if (!s) return null;
  for (const { re, base } of _WAREKI_ERAS) {
    if (!re.test(s)) continue;
    const rest = s.replace(re, '').trim();
    // 区切り文字は 年, 月, 日, -, /, . のいずれかを許容
    const mx = rest.match(/^(\d{1,2}|元)(?:[年\/\-\.](\d{1,2})(?:[月\/\-\.](\d{1,2})日?)?)?$/);
    if (!mx) continue;
    const yr   = mx[1] === '元' ? 1 : parseInt(mx[1]);
    const year = base + yr;
    if (year < 1868 || year > 2100) continue;
    const mo = mx[2] ? parseInt(mx[2]) : null;
    const dy = mx[3] ? parseInt(mx[3]) : null;
    if (mo !== null && (mo < 1 || mo > 12)) continue;
    if (dy !== null && (dy < 1 || dy > 31)) continue;
    if (mo !== null && dy !== null) return `${year}-${String(mo).padStart(2,'0')}-${String(dy).padStart(2,'0')}`;
    if (mo !== null)                return `${year}-${String(mo).padStart(2,'0')}`;
    return String(year);
  }
  return null;
}

function normalizeDateStr(s, minYear, maxYear = 2100) {
  if (!s) return null;
  s = s.trim();
  // 全角英数字・記号を半角に変換、ドットやスラッシュをハイフンに統一
  s = s.replace(/[０-９ａ-ｚＡ-Ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
       .replace(/[ー－—]/g, '-').replace(/[／]/g, '/').replace(/[．]/g, '.');
  s = s.replace(/[\/\.]/g, '-');
  
  const wk = _parseWareki(s);
  if (wk) { const y = parseInt(wk.slice(0,4)); if (y >= minYear && y <= maxYear) return wk; }
  
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const yr = parseInt(m[1]), mo = parseInt(m[2]), dy = parseInt(m[3]);
    if (yr >= minYear && yr <= maxYear && mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) 
      return `${m[1]}-${String(mo).padStart(2,'0')}-${String(dy).padStart(2,'0')}`;
  }
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    const yr = parseInt(m[1]), mo = parseInt(m[2]);
    if (yr >= minYear && yr <= maxYear && mo >= 1 && mo <= 12) 
      return `${m[1]}-${String(mo).padStart(2,'0')}`;
  }
  m = s.match(/^(\d{4})$/);
  if (m) {
    const yr = parseInt(m[1]);
    if (yr >= minYear && yr <= maxYear) return m[1];
  }
  return null;
}

function normalizeHireDate(s) { return normalizeDateStr(s, 1900); }
function normalizeBirthDate(s) { return normalizeDateStr(s, 1800); }
function normalizeFlexDate(s) { return normalizeDateStr(s, 1, 9999); }
function parseHireYear(d) {
  if (!d) return null;
  const m = d.trim().match(/^(\d{4})/);
  return m ? parseInt(m[1]) : null;
}
function calcYears(d) {
  if (!d) return null;
  const norm = normalizeHireDate(d);
  if (!norm) return null;
  let dt;
  if      (/^\d{4}-\d{2}-\d{2}$/.test(norm)) dt = new Date(norm);
  else if (/^\d{4}-\d{2}$/.test(norm))        dt = new Date(norm + '-01');
  else                                         dt = new Date(norm + '-04-01');
  if (!dt || isNaN(dt)) return null;
  return Math.floor((Date.now() - dt.getTime()) / (365.25 * 864e5));
}
function tagById(id)     { return DB.tags.find(t => t.id === id); }
function empTagObjs(emp) { return (emp.tags || []).map(tagById).filter(Boolean); }

function tagPath(tagId) {
  const parts = [];
  let t = tagById(tagId);
  while (t) { parts.unshift(t.name); t = t.parentId ? tagById(t.parentId) : null; }
  return parts.join(' › ');
}

function genderClass(g) { return g==='男性'?'b-male':g==='女性'?'b-female':g==='その他'?'b-other':''; }

function makeFlatBadge(type, value) {
  if (!value) return null;
  const item  = (DB.masters[type] || []).find(i => i.name === value);
  const color = item?.color || getFlatMasterColor(type, value);
  const icon  = item?.icon  || null;
  const b = document.createElement('span');
  b.className = 'badge';
  if (color) {
    b.style.background = lighten(color);
    b.style.color = color;
  } else {
    if (type === 'attribute') b.className += value==='地域系'?' b-region':value==='全国系'?' b-nation':'';
    else if (type === 'status')   b.className += value==='在籍'?' b-active':value==='異動'?' b-transfer':value==='退職'?' b-retired':'';
    else if (type === 'hireType') b.className += value==='新卒'?' b-newgrad':value==='中途'?' b-midcar':'';
  }
  if (icon) { const iEl = document.createElement('i'); iEl.className = icon; b.appendChild(iEl); }
  b.appendChild(document.createTextNode(value));
  return b;
}

function lighten(hex, mix = .82) {
  if (!hex || !hex.startsWith('#')) return hex;
  const h6 = hex.length === 4 ? hex.replace(/([^#])/g, '$1$1') : hex;
  const n = parseInt(h6.replace('#',''), 16);
  if (isNaN(n)) return hex;
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  const m = c => Math.round(c + (255 - c) * mix);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/**
 * darkenForSolid — ソリッド充填に使うため、白文字と十分なコントラストを確保する明度に暗くする
 * WCAG AA 基準: 白文字(輝度1.0) vs 背景で 4.5:1 → 背景輝度 ≤ 0.18 が目安
 * HSL の L を maxL%(デフォルト42) 以下にクランプし、彩度は維持する
 */
function darkenForSolid(hex, maxL = 42) {
  if (!hex || !hex.startsWith('#')) return hex;
  try {
    const h6 = hex.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3');
    const n  = parseInt(h6, 16);
    let r = (n>>16)&255, g = (n>>8)&255, b = n&255;
    // RGB → HSL
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    let h=0, s=0, l=(max+min)/2;
    if (max!==min) {
      const d=max-min;
      s = l>.5 ? d/(2-max-min) : d/(max+min);
      switch(max) {
        case r: h=(g-b)/d+(g<b?6:0); break;
        case g: h=(b-r)/d+2; break;
        case b: h=(r-g)/d+4; break;
      }
      h/=6;
    }
    const lPct = l*100;
    if (lPct <= maxL) return hex; // 既に十分暗い
    // 明度をクランプ（彩度は落とさない）
    const newL = maxL / 100;
    // HSL → RGB
    const hue2rgb = (p,q,t) => {
      if (t<0) t+=1; if (t>1) t-=1;
      if (t<1/6) return p+(q-p)*6*t;
      if (t<1/2) return q;
      if (t<2/3) return p+(q-p)*(2/3-t)*6;
      return p;
    };
    let nr,ng,nb;
    if (s===0) { nr=ng=nb=newL; }
    else {
      const q = newL<.5 ? newL*(1+s) : newL+s-newL*s;
      const p = 2*newL-q;
      nr=hue2rgb(p,q,h+1/3); ng=hue2rgb(p,q,h); nb=hue2rgb(p,q,h-1/3);
    }
    const toHex = x => Math.round(x*255).toString(16).padStart(2,'0');
    return `#${toHex(nr)}${toHex(ng)}${toHex(nb)}`;
  } catch(_) { return hex; }
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}
function makeBadge(cls, text) {
  const b = document.createElement('span');
  b.className = 'badge ' + cls; b.textContent = text; return b;
}

/* 学歴ラベル → CSSクラスのマッピング */
const EDUCATION_CLASS = {
  '博士':    'b-edu-phd',
  '修士':    'b-edu-master',
  '大卒':    'b-edu-bachelor',
  '高専卒':  'b-edu-kosen',
  '専門卒':  'b-edu-voc',
  '短大卒':  'b-edu-junior',
  '高卒':    'b-edu-highschool',
};
function makeEducationBadge(education) {
  if (!education) return null;
  const cls = EDUCATION_CLASS[education] || 'b-edu-other';
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  const icon = document.createElement('i'); icon.className = 'fa-solid fa-graduation-cap';
  b.appendChild(icon); b.appendChild(document.createTextNode(education));
  return b;
}
function makeSchoolBadge(school) {
  if (!school) return null;
  const b = document.createElement('span'); b.className = 'badge b-school';
  const icon = document.createElement('i'); icon.className = 'fa-solid fa-school';
  b.appendChild(icon); b.appendChild(document.createTextNode(school));
  return b;
}
function makeCompanyBadge(emp) {
  const state = getEmpActiveState(emp);
  const level0 = state.orgLevels[0] || null;
  if (!level0) return null;
  const b = document.createElement('span'); b.className = 'badge b-company';
  const icon = document.createElement('i'); icon.className = 'fa-solid fa-building';
  b.appendChild(icon); b.appendChild(document.createTextNode(level0));
  return b;
}

/* ================================================================
   和暦ユーティリティ
================================================================ */
/**
 * 西暦年 → 和暦文字列（"令6", "平31", "昭64" etc.）
 * 元年は "元" 表記  → "令元"
 */
function toWareki(year) {
  if (!year || isNaN(year)) return null;
  const y = parseInt(year);
  let era, base;
  if      (y >= 2019) { era = '令'; base = y - 2018; }
  else if (y >= 1989) { era = '平'; base = y - 1988; }
  else if (y >= 1926) { era = '昭'; base = y - 1925; }
  else if (y >= 1912) { era = '大'; base = y - 1911; }
  else                { return null; }
  return era + (base === 1 ? '元' : base);
}

/* ================================================================
   FLEX DATE PICKER — 汎用カレンダー入力補助
   対応精度: year(年) / month(年月) / day(年月日)
   和暦・西暦の両表示対応、精度タブ切替つき
================================================================ */
;(function () {
  'use strict';

  const _st = { popup: null, active: null };

  const PREC   = ['year', 'month', 'day'];
  const PREC_L = { year: '年', month: '年月', day: '年月日' };
  const MON_L  = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const WD_L   = ['日','月','火','水','木','金','土'];

  /* ---- シングルトン Popup DOM 生成 ---- */
  function _ensurePopup() {
    if (_st.popup) return _st.popup;
    const d = document.createElement('div');
    d.className = 'fdp-popup';
    d.innerHTML = `
      <div class="fdp-mode-bar">
        <button class="fdp-mode-btn is-active" data-fdp="mode-cal"><i class="fa-solid fa-calendar-days"></i>カレンダー</button>
        <button class="fdp-mode-btn" data-fdp="mode-reel"><i class="fa-solid fa-arrows-up-down"></i>リール</button>
        <button class="fdp-mode-btn" data-fdp="mode-rel"><i class="fa-solid fa-clock-rotate-left"></i>相対</button>
      </div>
      <div class="fdp-prec-bar" id="fdp-prec-bar"></div>
      <div class="fdp-cal-wrap" id="fdp-cal-wrap">
        <div class="fdp-nav">
          <button class="fdp-nav-btn" data-fdp="prev" title="前へ"><i class="fa-solid fa-chevron-left"></i></button>
          <button class="fdp-nav-lbl" data-fdp="drill"></button>
          <button class="fdp-nav-btn" data-fdp="next" title="次へ"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <div class="fdp-body" id="fdp-body"></div>
      </div>
      <div class="fdp-reel-wrap" id="fdp-reel-wrap" style="display:none">
        <div class="fdp-reel-container">
          <div class="fdp-reel-highlight"></div>
          <div class="fdp-reel-col" id="fdp-reel-y" data-type="y"></div>
          <div class="fdp-reel-col" id="fdp-reel-m" data-type="m"></div>
          <div class="fdp-reel-col" id="fdp-reel-d" data-type="d"></div>
        </div>
        <div style="padding: 0 10px 10px;">
          <button class="fdp-rel-commit-btn" data-fdp="reel-commit">
            <i class="fa-solid fa-check"></i>この日付を設定
          </button>
        </div>
      </div>
      <div class="fdp-rel-wrap" id="fdp-rel-wrap" style="display:none">
        <div class="fdp-rel-presets-scroll">
          <div class="fdp-rel-presets" id="fdp-rel-presets"></div>
        </div>
        <div class="fdp-rel-custom">
          <div class="fdp-rel-custom-hdr">
            <i class="fa-solid fa-sliders"></i>カスタム
          </div>
          <div class="fdp-rel-steppers">
            <div class="fdp-rel-stepper-row">
              <div class="fdp-rel-stepper-grp">
                <button class="fdp-rel-step-btn" data-fdp="rel-ydec" title="1年減"><i class="fa-solid fa-minus"></i></button>
                <div class="fdp-rel-stepper-num">
                  <span class="fdp-rel-val" id="fdp-rel-y">0</span>
                  <span class="fdp-rel-unit">年</span>
                </div>
                <button class="fdp-rel-step-btn" data-fdp="rel-yinc" title="1年増"><i class="fa-solid fa-plus"></i></button>
              </div>
              <div class="fdp-rel-stepper-grp fdp-rel-stepper-m-grp">
                <button class="fdp-rel-step-btn fdp-rel-step-m" data-fdp="rel-mdec" title="1ヶ月減"><i class="fa-solid fa-minus"></i></button>
                <div class="fdp-rel-stepper-num">
                  <span class="fdp-rel-val" id="fdp-rel-m">0</span>
                  <span class="fdp-rel-unit">ヶ月</span>
                </div>
                <button class="fdp-rel-step-btn fdp-rel-step-m" data-fdp="rel-minc" title="1ヶ月増"><i class="fa-solid fa-plus"></i></button>
              </div>
            </div>
            <div class="fdp-rel-dir-seg">
              <button class="fdp-rel-dir-opt is-active" data-fdp="rel-dir" data-dir="prev" id="fdp-rel-dir">
                <i class="fa-solid fa-arrow-left"></i>前
              </button>
              <button class="fdp-rel-dir-opt" data-fdp="rel-dir-next" data-dir="next" id="fdp-rel-dir-next">
                後<i class="fa-solid fa-arrow-right"></i>
              </button>
            </div>
          </div>
          <div class="fdp-rel-preview" id="fdp-rel-preview">
            <i class="fa-solid fa-calendar-day fdp-rel-arrow"></i><span>基準: 今日</span>
          </div>
          <button class="fdp-rel-commit-btn" data-fdp="rel-commit">
            <i class="fa-solid fa-check"></i>この日付を設定
          </button>
        </div>
      </div>
      <div class="fdp-foot">
        <span class="fdp-wareki" id="fdp-wareki"></span>
        <div class="fdp-foot-acts">
          <button class="fdp-btn" data-fdp="clear"><i class="fa-solid fa-eraser"></i>クリア</button>
          <button class="fdp-btn fdp-btn-today" data-fdp="today"><i class="fa-solid fa-calendar-day"></i>今日</button>
        </div>
      </div>`;
    document.body.appendChild(d);

    d.addEventListener('mousedown', e => e.preventDefault());
    d.addEventListener('click', e => {
      if (!_st.active) return;
      const btn = e.target.closest('[data-fdp]');
      if (!btn) return;
      const act = btn.dataset.fdp;
      if      (act === 'prev')       _st.active._navPrev();
      else if (act === 'next')       _st.active._navNext();
      else if (act === 'drill')      _st.active._drillUp();
      else if (act === 'clear')      { _st.active._commit(''); FlexDatePicker.closeAll(); }
      else if (act === 'today')      _st.active._selectToday();
      else if (act === 'prec')       _st.active._setPrec(btn.dataset.prec);
      else if (act === 'mode-cal')   _st.active._setPopMode('cal');
      else if (act === 'mode-reel')  _st.active._setPopMode('reel');
      else if (act === 'mode-rel')   _st.active._setPopMode('rel');
      else if (act === 'rel-ydec')   _st.active._relStep('y', -1);
      else if (act === 'rel-yinc')   _st.active._relStep('y',  1);
      else if (act === 'rel-mdec')   _st.active._relStep('m', -1);
      else if (act === 'rel-minc')   _st.active._relStep('m',  1);
      else if (act === 'rel-dir')    _st.active._relToggleDir('prev');
      else if (act === 'rel-dir-next') _st.active._relToggleDir('next');
      else if (act === 'rel-commit') { _st.active._commitRelDate(); FlexDatePicker.closeAll(); }
      else if (act === 'reel-commit'){ _st.active._commitReelDate(); FlexDatePicker.closeAll(); }
    });

    document.addEventListener('mousedown', e => {
      if (!_st.active || !_st.popup) return;
      if (!_st.popup.contains(e.target) && !e.target.closest('.fdp-trigger')) {
        FlexDatePicker.closeAll();
      }
    }, true);

    document.addEventListener('scroll', () => FlexDatePicker.closeAll(), true);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && _st.active) FlexDatePicker.closeAll();
    });

    _st.popup = d;
    return d;
  }

  /* ================================================================
     FlexDatePicker クラス
  ================================================================ */
  class FlexDatePicker {
    /**
     * @param {HTMLInputElement} inputEl
     * @param {object} opts
     *   minPrec  {string}  'year'|'month'|'day'  最小精度 (default:'year')
     *   maxPrec  {string}  'year'|'month'|'day'  最大精度 (default:'day')
     *   normalize {func}  (rawStr)→'YYYY[-MM[-DD]]'|null  既存値パーサー
     */
    constructor(inputEl, opts = {}) {
      this.inp  = inputEl;
      this.opts = { minPrec: 'year', maxPrec: 'day', normalize: null, ...opts };
      this._prec    = this.opts.maxPrec;
      this._vYear   = new Date().getFullYear();
      this._vMon    = new Date().getMonth();
      this._vDay    = null; // 新設
      this._vMode   = this._modeFor(this.opts.maxPrec);
      this._popMode = 'cal';   // 'cal' | 'rel' | 'reel'
      this._relY    = 0;
      this._relM    = 0;
      this._relDir  = 'prev';
      this._attachTrigger();
    }

    _parseInput() {
      const raw  = this.inp.value.trim();
      const norm = raw && this.opts.normalize ? this.opts.normalize(raw) : raw;
      if (!norm) return;
      const p = norm.split('-');
      if (p[0]) { const y = parseInt(p[0]); if (!isNaN(y)) this._vYear = y; }
      if (p[1]) { const m = parseInt(p[1]) - 1; if (m >= 0 && m <= 11) this._vMon = m; }
      if (p[2]) { const d = parseInt(p[2]); if (d >= 1 && d <= 31) this._vDay = d; }
    }

    _render() {
      _st.popup?.querySelectorAll('.fdp-mode-btn').forEach(b => {
        b.classList.toggle('is-active', b.dataset.fdp === `mode-${this._popMode}`);
      });
      const calWrap  = document.getElementById('fdp-cal-wrap');
      const reelWrap = document.getElementById('fdp-reel-wrap');
      const relWrap  = document.getElementById('fdp-rel-wrap');
      const precBar  = document.getElementById('fdp-prec-bar');
      
      if (calWrap)  calWrap.style.display  = this._popMode === 'cal'  ? '' : 'none';
      if (reelWrap) reelWrap.style.display = this._popMode === 'reel' ? '' : 'none';
      if (relWrap)  relWrap.style.display  = this._popMode === 'rel'  ? '' : 'none';
      if (precBar)  precBar.style.display  = this._popMode === 'cal'  ? '' : 'none';

      if (this._popMode === 'cal') {
        this._renderPrecBar();
        this._renderNavLbl();
        this._renderBody();
      } else if (this._popMode === 'reel') {
        this._renderReel();
      } else {
        this._renderRelPanel();
      }
      this._renderWareki();
    }

    _renderReel() {
      const cY = document.getElementById('fdp-reel-y');
      const cM = document.getElementById('fdp-reel-m');
      const cD = document.getElementById('fdp-reel-d');
      if (!cY || !cM || !cD) return;
      
      cM.style.display = this._prec === 'year' ? 'none' : '';
      cD.style.display = (this._prec === 'year' || this._prec === 'month') ? 'none' : '';

      const buildCol = (col, min, max, val, isOpt, suffix) => {
        col.innerHTML = '';
        const items = [];
        if (isOpt) items.push({ v: null, l: '--' });
        for (let i = min; i <= max; i++) {
          items.push({ v: i, l: String(i).padStart(min < 10 ? 2 : 1, '0') + suffix });
        }
        
        const dummyH = 57; // padding 代わりのスペーサー (150 - 36)/2
        const padTop = document.createElement('div'); padTop.style.height = dummyH + 'px'; col.appendChild(padTop);
        
        items.forEach((item, idx) => {
          const div = document.createElement('div');
          div.className = 'fdp-reel-item' + (item.v === null ? ' is-empty' : '');
          div.textContent = item.l;
          div.dataset.val = item.v;
          
          div.addEventListener('click', () => {
            col.scrollTo({ top: idx * 36, behavior: 'smooth' });
          });
          col.appendChild(div);
        });

        const padBot = document.createElement('div'); padBot.style.height = dummyH + 'px'; col.appendChild(padBot);

        setTimeout(() => {
          let idx = 0;
          if (val !== null) {
            idx = items.findIndex(it => it.v === val);
            if (idx < 0) idx = 0;
          }
          col.scrollTop = idx * 36;
        }, 10);

        col.onscroll = () => {
          clearTimeout(col._to);
          col._to = setTimeout(() => {
            const idx = Math.round(col.scrollTop / 36);
            const item = items[idx];
            if (item) {
              if (col.id === 'fdp-reel-y') this._vYear = item.v;
              if (col.id === 'fdp-reel-m') {
                this._vMon = item.v !== null ? item.v - 1 : null;
                this._renderReel(); // 月末日補正のため再描画
              }
              if (col.id === 'fdp-reel-d') this._vDay = item.v;
            }
            if (col.scrollTop !== idx * 36) {
              col.scrollTo({ top: idx * 36, behavior: 'smooth' });
            }
          }, 150);
        };
      };

      const currentY = new Date().getFullYear();
      const refY = this._vYear || currentY;
      buildCol(cY, 1900, currentY + 10, refY, false, '年');
      buildCol(cM, 1, 12, this._vMon !== null ? this._vMon + 1 : null, true, '月');
      
      const lastDay = (this._vMon !== null) ? new Date(refY, this._vMon + 1, 0).getDate() : 31;
      let dayVal = this._vDay;
      if (dayVal > lastDay) dayVal = lastDay; // 月末補正
      buildCol(cD, 1, lastDay, dayVal, true, '日');
    }

    _commitReelDate() {
      let v = String(this._vYear);
      if (this._prec !== 'year' && this._vMon !== null) {
        v += '-' + String(this._vMon + 1).padStart(2, '0');
        if (this._prec === 'day' && this._vDay !== null) {
          v += '-' + String(this._vDay).padStart(2, '0');
        }
      }
      this._commit(v);
    }

    /* 精度 → 初期表示モード */
    _modeFor(p) {
      return p === 'year' ? 'decade' : p === 'month' ? 'year' : 'day';
    }

    /* btn-cal ボタンへ紐付け */
    _attachTrigger() {
      const wrap = this.inp.closest('.hire-wrap, .fdp-wrap');
      if (!wrap) return;
      const btn = wrap.querySelector('.btn-cal');
      if (!btn) return;
      btn.classList.add('fdp-trigger');
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (_st.active === this && _st.popup?.classList.contains('fdp-open')) {
          FlexDatePicker.closeAll();
        } else {
          this.open();
        }
      });
    }

    open() {
      _ensurePopup();
      _st.active = this;
      this._parseInput();
      this._prec    = this.opts.maxPrec;
      this._vMode   = this._modeFor(this._prec);
      this._popMode = 'cal';
      this._relY    = 0;
      this._relM    = 0;
      this._relDir  = 'prev';
      this._render();
      const pop = _st.popup;
      pop.classList.add('fdp-open');
      this._position();
    }

    static closeAll() {
      if (_st.popup) _st.popup.classList.remove('fdp-open');
      _st.active = null;
    }

    /* ---- モード切替 ---- */
    _setPopMode(mode) {
      this._popMode = mode;
      this._render();
      if (mode === 'rel') this._updateRelPreview();
      this._position();
    }

    /* ---- 精度バー ---- */
    _renderPrecBar() {
      const bar  = document.getElementById('fdp-prec-bar');
      const minI = PREC.indexOf(this.opts.minPrec);
      const maxI = PREC.indexOf(this.opts.maxPrec);
      const avail = PREC.filter((_, i) => i >= minI && i <= maxI);
      bar.innerHTML = '';
      if (avail.length <= 1) { bar.style.display = 'none'; return; }
      bar.style.display = '';
      avail.forEach(p => {
        const b = document.createElement('button');
        b.className    = 'fdp-prec-btn' + (this._prec === p ? ' is-active' : '');
        b.textContent  = PREC_L[p];
        b.dataset.fdp  = 'prec';
        b.dataset.prec = p;
        bar.appendChild(b);
      });
    }

    /* ---- ナビラベル ---- */
    _renderNavLbl() {
      const btn = _st.popup?.querySelector('[data-fdp="drill"]');
      if (!btn) return;
      if (this._vMode === 'decade') {
        const base = Math.floor(this._vYear / 10) * 10;
        btn.textContent = `${base} 〜 ${base + 9}年`;
      } else if (this._vMode === 'year') {
        btn.textContent = `${this._vYear}年`;
      } else {
        btn.textContent = `${this._vYear}年 ${this._vMon + 1}月`;
      }
    }

    _navPrev() {
      if (this._vMode === 'decade')     this._vYear -= 10;
      else if (this._vMode === 'year')  this._vYear--;
      else { this._vMon--; if (this._vMon < 0)  { this._vMon = 11; this._vYear--; } }
      this._renderNavLbl(); this._renderBody(); this._renderWareki();
    }
    _navNext() {
      if (this._vMode === 'decade')     this._vYear += 10;
      else if (this._vMode === 'year')  this._vYear++;
      else { this._vMon++; if (this._vMon > 11) { this._vMon = 0;  this._vYear++; } }
      this._renderNavLbl(); this._renderBody(); this._renderWareki();
    }
    _drillUp() {
      if      (this._vMode === 'day')  this._vMode = 'year';
      else if (this._vMode === 'year') this._vMode = 'decade';
      else return;
      this._renderNavLbl(); this._renderBody();
    }
    _setPrec(p) {
      this._prec  = p;
      this._vMode = this._modeFor(p);
      this._render();
    }

    /* ---- ボディ描画 ---- */
    _renderBody() {
      const body = document.getElementById('fdp-body');
      body.innerHTML = '';
      body.className = `fdp-body fdp-body--${this._vMode}`;
      if      (this._vMode === 'decade') this._renderDecadeGrid(body);
      else if (this._vMode === 'year')   this._renderMonthGrid(body);
      else                               this._renderDayGrid(body);
    }

    /* ---- 年グリッド (前後1年含む 12セル) ---- */
    _renderDecadeGrid(body) {
      const base    = Math.floor(this._vYear / 10) * 10;
      const todayY  = new Date().getFullYear();
      const selNorm = this._getNorm();
      const selYear = selNorm ? parseInt(selNorm.slice(0, 4)) : -1;
      for (let i = -1; i <= 10; i++) {
        const y   = base + i;
        const out = (i < 0 || i > 9);
        const btn = document.createElement('button');
        btn.className = [
          'fdp-cell',
          out        ? 'is-out'   : '',
          y === todayY  ? 'is-today' : '',
          y === selYear ? 'is-sel'   : '',
        ].filter(Boolean).join(' ');
        btn.innerHTML = `<span class="fdp-c-main">${y}</span>`;
        const w = toWareki(y);
        if (w) btn.innerHTML += `<span class="fdp-c-sub">${w}</span>`;
        btn.addEventListener('click', () => {
          this._vYear = y;
          if (this._prec === 'year') { this._commit(String(y)); FlexDatePicker.closeAll(); }
          else { this._vMode = 'year'; this._renderNavLbl(); this._renderBody(); this._renderWareki(); }
        });
        body.appendChild(btn);
      }
    }

    /* ---- 月グリッド ---- */
    _renderMonthGrid(body) {
      const today   = new Date();
      const selNorm  = this._getNorm();
      const [sy, sm] = selNorm
        ? [parseInt(selNorm.slice(0,4)), selNorm.length >= 7 ? parseInt(selNorm.slice(5,7)) - 1 : -1]
        : [-1, -1];
      for (let m = 0; m < 12; m++) {
        const isToday = (this._vYear === today.getFullYear() && m === today.getMonth());
        const isSel   = (this._vYear === sy && m === sm);
        const btn     = document.createElement('button');
        btn.className = ['fdp-cell', isToday ? 'is-today' : '', isSel ? 'is-sel' : ''].filter(Boolean).join(' ');
        btn.innerHTML = `<span class="fdp-c-main">${MON_L[m]}</span>`;
        btn.addEventListener('click', () => {
          this._vMon = m;
          const mo = String(m + 1).padStart(2, '0');
          if (this._prec === 'month') { this._commit(`${this._vYear}-${mo}`); FlexDatePicker.closeAll(); }
          else { this._vMode = 'day'; this._renderNavLbl(); this._renderBody(); this._renderWareki(); }
        });
        body.appendChild(btn);
      }
    }

    /* ---- 日グリッド ---- */
    _renderDayGrid(body) {
      WD_L.forEach((d, i) => {
        const hdr = document.createElement('div');
        hdr.className = 'fdp-wdhdr' + (i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : '');
        hdr.textContent = d;
        body.appendChild(hdr);
      });
      const today   = new Date();
      const selNorm  = this._getNorm();
      const [sy, sm, sd] = selNorm
        ? [parseInt(selNorm.slice(0,4)),
           selNorm.length >= 7 ? parseInt(selNorm.slice(5,7)) - 1 : -1,
           selNorm.length >= 10 ? parseInt(selNorm.slice(8,10)) : -1]
        : [-1, -1, -1];
      const first   = new Date(this._vYear, this._vMon, 1).getDay();
      const lastDay = new Date(this._vYear, this._vMon + 1, 0).getDate();
      for (let i = 0; i < first; i++) {
        const pad = document.createElement('div'); pad.className = 'fdp-cell is-pad'; body.appendChild(pad);
      }
      for (let d = 1; d <= lastDay; d++) {
        const dow     = (first + d - 1) % 7;
        const isToday = (this._vYear === today.getFullYear() && this._vMon === today.getMonth() && d === today.getDate());
        const isSel   = (this._vYear === sy && this._vMon === sm && d === sd);
        const btn     = document.createElement('button');
        btn.className = [
          'fdp-cell',
          dow === 0 ? 'is-sun' : dow === 6 ? 'is-sat' : '',
          isToday ? 'is-today' : '',
          isSel   ? 'is-sel'   : '',
        ].filter(Boolean).join(' ');
        btn.textContent = d;
        btn.addEventListener('click', () => {
          const v = `${this._vYear}-${String(this._vMon + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          this._commit(v); FlexDatePicker.closeAll();
        });
        body.appendChild(btn);
      }
    }

    /* ---- 相対入力パネル ---- */
    _renderRelPanel() {
      this._renderRelPresets();
      this._renderRelCustom();
    }

    _renderRelPresets() {
      const cont = document.getElementById('fdp-rel-presets');
      if (!cont) return;
      cont.innerHTML = '';
      const today = new Date();

      const GROUPS = {
        day: [
          { icon: 'fa-solid fa-bolt', title: '直近',
            items: [{l:'今日',dy:0,dm:0,dd:0},{l:'1週前',dy:0,dm:0,dd:-7},
                    {l:'2週前',dy:0,dm:0,dd:-14},{l:'1ヶ月前',dy:0,dm:-1,dd:0}] },
          { icon: 'fa-regular fa-clock', title: '数ヶ月〜数年',
            items: [{l:'3ヶ月前',dy:0,dm:-3,dd:0},{l:'半年前',dy:0,dm:-6,dd:0},
                    {l:'1年前',dy:-1,dm:0,dd:0},{l:'2年前',dy:-2,dm:0,dd:0},
                    {l:'3年前',dy:-3,dm:0,dd:0},{l:'5年前',dy:-5,dm:0,dd:0}] },
        ],
        month: [
          { icon: 'fa-solid fa-bolt', title: '直近',
            items: [{l:'今月',dy:0,dm:0},{l:'3ヶ月前',dy:0,dm:-3},
                    {l:'半年前',dy:0,dm:-6},{l:'1年前',dy:-1,dm:0}] },
          { icon: 'fa-regular fa-clock', title: '数年',
            items: [{l:'2年前',dy:-2,dm:0},{l:'3年前',dy:-3,dm:0},
                    {l:'5年前',dy:-5,dm:0},{l:'7年前',dy:-7,dm:0},
                    {l:'10年前',dy:-10,dm:0}] },
          { icon: 'fa-solid fa-hourglass', title: '長期',
            items: [{l:'15年前',dy:-15,dm:0},{l:'20年前',dy:-20,dm:0},
                    {l:'25年前',dy:-25,dm:0},{l:'30年前',dy:-30,dm:0}] },
        ],
        year: [
          { icon: 'fa-solid fa-bolt', title: '直近',
            items: [{l:'今年',dy:0},{l:'1年前',dy:-1},{l:'2年前',dy:-2},
                    {l:'3年前',dy:-3},{l:'5年前',dy:-5}] },
          { icon: 'fa-regular fa-clock', title: '中期',
            items: [{l:'7年前',dy:-7},{l:'10年前',dy:-10},
                    {l:'15年前',dy:-15},{l:'20年前',dy:-20}] },
          { icon: 'fa-solid fa-hourglass', title: '長期',
            items: [{l:'25年前',dy:-25},{l:'30年前',dy:-30},
                    {l:'35年前',dy:-35},{l:'40年前',dy:-40},{l:'50年前',dy:-50}] },
        ],
      };

      const groups = GROUPS[this._prec] || GROUPS.day;
      groups.forEach(group => {
        const sec  = document.createElement('div');
        sec.className = 'fdp-rel-group';
        const hdr = document.createElement('div');
        hdr.className = 'fdp-rel-group-hdr';
        hdr.innerHTML  = `<i class="${group.icon}"></i>${group.title}`;
        sec.appendChild(hdr);
        const row = document.createElement('div');
        row.className = 'fdp-rel-group-btns';
        group.items.forEach(p => {
          const btn = document.createElement('button');
          btn.className   = 'fdp-rel-preset-btn';
          btn.textContent = p.l;
          // 「今日/今月/今年」は強調
          if (p.dy === 0 && !p.dm && !p.dd) btn.classList.add('is-now');
          btn.addEventListener('click', () => {
            const dt = new Date(today);
            if (p.dy) dt.setFullYear(dt.getFullYear() + p.dy);
            if (p.dm) dt.setMonth(dt.getMonth() + p.dm);
            if (p.dd) dt.setDate(dt.getDate() + p.dd);
            this._commit(this._dtToStr(dt));
            FlexDatePicker.closeAll();
          });
          row.appendChild(btn);
        });
        sec.appendChild(row);
        cont.appendChild(sec);
      });
    }

    _renderRelCustom() {
      const yEl   = document.getElementById('fdp-rel-y');
      const mEl   = document.getElementById('fdp-rel-m');
      const mGrp  = _st.popup?.querySelector('.fdp-rel-stepper-m-grp');
      if (mGrp) mGrp.style.display = this._prec === 'year' ? 'none' : '';
      if (yEl)  yEl.textContent = this._relY;
      if (mEl)  mEl.textContent = this._relM;
      this._syncDirSeg();
      this._updateRelPreview();
    }

    _syncDirSeg() {
      const prev = document.getElementById('fdp-rel-dir');
      const next = document.getElementById('fdp-rel-dir-next');
      if (prev) prev.classList.toggle('is-active', this._relDir === 'prev');
      if (next) next.classList.toggle('is-active', this._relDir === 'next');
    }

    _relStep(field, delta) {
      if (field === 'y') this._relY = Math.max(0, Math.min(100, this._relY + delta));
      else               this._relM = Math.max(0, Math.min(11,  this._relM + delta));
      const yEl = document.getElementById('fdp-rel-y');
      const mEl = document.getElementById('fdp-rel-m');
      if (yEl) yEl.textContent = this._relY;
      if (mEl) mEl.textContent = this._relM;
      this._updateRelPreview();
    }

    _relToggleDir(dir) {
      this._relDir = dir || (this._relDir === 'prev' ? 'next' : 'prev');
      this._syncDirSeg();
      this._updateRelPreview();
    }

    _updateRelPreview() {
      const prev = document.getElementById('fdp-rel-preview');
      if (!prev) return;
      const relY = this._relY, relM = this._relM;
      if (relY === 0 && relM === 0) {
        prev.innerHTML = '<i class="fa-solid fa-calendar-day fdp-rel-arrow"></i><span>基準: 今日</span>';
        return;
      }
      const dt  = this._calcRelDate();
      if (!dt) return;
      const str = (() => {
        if (this._prec === 'year')  return `${dt.getFullYear()}年`;
        if (this._prec === 'month') return `${dt.getFullYear()}年${dt.getMonth()+1}月`;
        return `${dt.getFullYear()}年${dt.getMonth()+1}月${dt.getDate()}日`;
      })();
      const w = toWareki(dt.getFullYear());
      const dir = this._relDir === 'prev'
        ? `<i class="fa-solid fa-arrow-left fdp-rel-arrow"></i>`
        : `<i class="fa-solid fa-arrow-right fdp-rel-arrow fdp-rel-arrow--next"></i>`;
      prev.innerHTML = `${dir}<b>${str}</b>${w ? `<span class="fdp-rel-wareki">（${w}）</span>` : ''}`;
    }

    _calcRelDate() {
      const today = new Date();
      const sign  = this._relDir === 'prev' ? -1 : 1;
      const dt    = new Date(today);
      dt.setFullYear(dt.getFullYear() + sign * this._relY);
      if (this._relM) dt.setMonth(dt.getMonth() + sign * this._relM);
      return dt;
    }

    _dtToStr(dt) {
      const y  = dt.getFullYear();
      const mo = String(dt.getMonth() + 1).padStart(2, '0');
      const d  = String(dt.getDate()).padStart(2, '0');
      if (this._prec === 'year')  return String(y);
      if (this._prec === 'month') return `${y}-${mo}`;
      return `${y}-${mo}-${d}`;
    }

    _commitRelDate() {
      const dt = this._calcRelDate();
      if (dt) this._commit(this._dtToStr(dt));
    }

    /* ---- 和暦表示 ---- */
    _renderWareki() {
      const el = document.getElementById('fdp-wareki');
      if (!el) return;
      const w = toWareki(this._vYear);
      el.textContent = w ? `${w}年` : '';
    }

    /* ---- 正規化済み文字列を取得 ---- */
    _getNorm() {
      const raw = this.inp.value.trim();
      if (!raw) return null;
      return this.opts.normalize ? this.opts.normalize(raw) : raw;
    }

    /* ---- 値確定 → input に書き込み & イベント発火 ---- */
    _commit(v) {
      this.inp.value = v;
      ['input', 'change', 'blur'].forEach(ev =>
        this.inp.dispatchEvent(new Event(ev, { bubbles: true }))
      );
    }

    /* ---- 今日ボタン ---- */
    _selectToday() {
      const t = new Date();
      let v;
      if (this._prec === 'year')       v = String(t.getFullYear());
      else if (this._prec === 'month') v = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2,'0')}`;
      else v = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
      this._commit(v); FlexDatePicker.closeAll();
    }

    /* ---- 位置決め (fixed) ---- */
    _position() {
      const pop  = _st.popup;
      const rect = this.inp.getBoundingClientRect();
      const W = 292;
      let left = rect.left;
      let top  = rect.bottom + 6;
      if (left + W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - W - 8);
      const H = 340;
      if (top + H > window.innerHeight - 8) {
        const above = rect.top - H - 6;
        top = above >= 8 ? above : 8;
      }
      pop.style.left = `${left}px`;
      pop.style.top  = `${top}px`;
    }
  }

  window.FlexDatePicker = FlexDatePicker;
})();

/* ================================================================
   グローバルフィルタ
================================================================ */
let _gfpFocusState = null;
let _gfpListScrolls = {};

/* ================================================================
   EMPLOYEE STATE UTILITIES
================================================================ */
/**
 * 従業員の指定日（null=現在）における「有効な組織パス(orgLevels)」と「役職(position)」を計算して返す。
 * 過去から順に履歴を辿り、役職変更での組織維持、出向の終了(帰任)などを加味した最終状態を取得する。
 */
function getEmpActiveState(emp, targetDate = null) {
  const transfers = [...(emp.transfers || [])].map((t, i) => ({ ...t, _origIdx: i })).sort((a, b) => {
    const keyA = a.date || a.endDate || '';
    const keyB = b.date || b.endDate || '';
    const cmp = keyA.localeCompare(keyB);
    return cmp !== 0 ? cmp : a._origIdx - b._origIdx;
  });
  let primary = { orgLevels: [], position: '', kind: '', workLocation: '' };
  let concurrents = [];
  let secondmentEndDate = null;
  let preSecondment = null;

  const chkDate = targetDate !== null ? targetDate : new Date().toISOString().slice(0, 10);
  const isSameOrg = (orgA, orgB) => JSON.stringify(orgA) === JSON.stringify(orgB);

  for (const tr of transfers) {
    if (tr.date && tr.date > chkDate) {
      break; 
    }

    const orgs = Array.isArray(tr.orgLevels) ? tr.orgLevels : [tr.company || '', tr.department || '', tr.division || ''].filter(Boolean);
    const kind = tr.kind || 'assignment';
    const pos = tr.position;

    if (kind === 'assignment' || kind === 'transfer') {
      primary.orgLevels = orgs.length > 0 ? orgs : [...primary.orgLevels];
      if (pos !== undefined && pos !== null) primary.position = pos;
      primary.kind = kind;
      primary.workLocation = tr.workLocation || '';
      secondmentEndDate = null;
    } else if (kind === 'secondment' || kind === 'stationed') {
      preSecondment = { ...primary };
      primary.orgLevels = orgs.length > 0 ? orgs : [...primary.orgLevels];
      if (pos !== undefined && pos !== null) primary.position = pos;
      primary.kind = kind;
      primary.workLocation = tr.workLocation || '';
      secondmentEndDate = tr.endDate || null;
    } else if (kind === 'concurrent') {
      const existing = concurrents.find(c => isSameOrg(c.orgLevels, orgs));
      if (existing) {
        if (pos !== undefined && pos !== null) existing.position = pos;
      } else {
        concurrents.push({ orgLevels: orgs, position: pos || '' });
      }
    } else if (kind === 'positionChange') {
      if (orgs.length > 0 && !isSameOrg(primary.orgLevels, orgs)) {
        const existing = concurrents.find(c => isSameOrg(c.orgLevels, orgs));
        if (existing) existing.position = pos || '';
      } else {
        if (pos !== undefined && pos !== null) primary.position = pos;
      }
    } else if (kind === 'removePosition') {
      if (orgs.length > 0) {
        if (isSameOrg(primary.orgLevels, orgs)) {
          primary.position = '';
        } else {
          const existing = concurrents.find(c => isSameOrg(c.orgLevels, orgs));
          if (existing) existing.position = '';
        }
      } else {
        primary.position = '';
        concurrents.forEach(c => c.position = '');
      }
    } else if (kind === 'endAssignment') {
      if (orgs.length > 0) {
        if (isSameOrg(primary.orgLevels, orgs)) {
          // 出向・駐在の終了時は出向前の元配属に復帰する
          if ((primary.kind === 'secondment' || primary.kind === 'stationed') && preSecondment) {
            primary = { ...preSecondment };
            secondmentEndDate = null;
            preSecondment = null;
          } else {
            primary.orgLevels = [];
            primary.position = '';
            primary.kind = '';
            primary.workLocation = '';
          }
        } else {
          concurrents = concurrents.filter(c => !isSameOrg(c.orgLevels, orgs));
        }
      } else {
        primary.orgLevels = [];
        primary.position = '';
        primary.kind = '';
        primary.workLocation = '';
        concurrents = [];
      }
    }
  }

  if (secondmentEndDate && chkDate > secondmentEndDate && preSecondment) {
    primary = { ...preSecondment };
    secondmentEndDate = null;
  }

  return {
    orgLevels: primary.orgLevels,
    position: primary.position,
    kind: primary.kind,
    workLocation: primary.workLocation,
    concurrents
  };
}

/** 従業員の最新配属における所属会社（orgLevels[0]）を返す */
function getEmpLatestCompany(emp) {
  const state = getEmpActiveState(emp);
  return state.orgLevels[0] || '';
}

/**
 * globalFilter 設定を従業員リストに適用して返す
 * 配列が空の次元は絞り込まない
 */
function applyGlobalFilter(emps) {
  const f = DB.settings.globalFilter;
  if (!f) return emps;
  const hasStatus    = f.status.length    > 0;
  const hasAttribute = f.attribute.length > 0;
  const hasGender    = f.gender.length    > 0;
  const hasHireType  = f.hireType.length  > 0;
  const hasCourse    = f.course.length    > 0;
  const hasTags      = f.tags.length      > 0;
  const hasCompany   = (f.company   || []).length > 0;
  const hasSchool    = (f.school    || []).length > 0;
  const hasEducation = (f.education || []).length > 0;
  if (!hasStatus && !hasAttribute && !hasGender && !hasHireType && !hasCourse
      && !hasTags && !hasCompany && !hasSchool && !hasEducation) return emps;

  return emps.filter(e => {
    // 除外モデル: 配列内の値を持つ従業員を非表示にする
    if (hasStatus    && f.status.includes(e.status    || '')) return false;
    if (hasAttribute && f.attribute.includes(e.attribute || '')) return false;
    if (hasGender    && f.gender.includes(e.gender    || '')) return false;
    if (hasHireType  && f.hireType.includes(e.hireType || '')) return false;
    if (hasCourse    && f.course.includes(e.course    || '')) return false;
    if (hasCompany   && f.company.includes(getEmpLatestCompany(e))) return false;
    if (hasSchool) {
      const isExcluded = f.school.some(path => {
        if (path === '') return !e.school && !e.eduDept;
        const parts = path.split(' ＞ ');
        const fullText = (e.school || '') + ' ' + (e.eduDept || '');
        return parts.every(p => fullText.includes(p));
      });
      if (isExcluded) return false;
    }
    if (hasEducation && f.education.includes(e.education || '')) return false;
    if (hasTags) {
      const empTags = e.tags || [];
      const hasNoTagSentinel = f.tags.includes('__notag__');
      const realTags = f.tags.filter(t => t !== '__notag__');

      // 「タグなし」の除外: タグが一件も設定されていない従業員
      if (hasNoTagSentinel && empTags.length === 0) return false;

      // 実タグの除外
      if (realTags.length > 0) {
        const match = f.tagMode === 'and'
          ? realTags.every(tid => empTags.includes(tid))
          : realTags.some( tid => empTags.includes(tid));
        if (match) return false;
      }
    }
    return true;
  });
}

/* ----------------------------------------------------------------
   renderGlobalFilterPanel
   UX設計方針:
   ・composedPath 修正により チップクリック → DOM削除 でパネルは閉じない
   ・アイテム数 CHIP_MAX 以下 → チップ群（一目で全選択肢が見える）
   ・アイテム数 CHIP_MAX 超  → 検索 + チェックボックスリスト
   ・適用中フィルターは上部サマリーバーで可視化（全体把握 & ワンクリック解除）
   ・スクロール位置を保存・復元（複数設定時に位置が戻らない）
---------------------------------------------------------------- */
const GFP_CHIP_MAX = 6; // これ以下ならチップ表示

function renderGlobalFilterPanel() {
  const panel = document.getElementById('global-filter-panel');
  if (!panel) return;
  const f = DB.settings.globalFilter;

  /* ── バッジ更新（ストリップ & パネル内） ── */
  const totalActive =
    f.status.length + f.attribute.length + f.gender.length +
    f.hireType.length + f.course.length + f.tags.length +
    (f.company||[]).length + (f.school||[]).length + (f.education||[]).length;

  const stripBadge = document.getElementById('fsb-strip-cnt');
  if (stripBadge) { stripBadge.textContent = totalActive; stripBadge.style.display = totalActive > 0 ? '' : 'none'; }
  const hdBadge = document.getElementById('global-filter-badge');
  if (hdBadge) { hdBadge.textContent = totalActive; hdBadge.style.display = totalActive > 0 ? '' : 'none'; }

  /* ── サマリーバー（適用中フィルター一覧） ── */
  _renderActiveBar(f);

  /* ── 状態の退避（スクロールとフォーカス） ── */
  const body = document.getElementById('gfp-body');
  if (!body) return;
  const savedScroll = body.scrollTop;

  const activeEl = document.activeElement;
  if (activeEl && activeEl.tagName === 'INPUT' && activeEl.closest('.gfp-list-search')) {
    _gfpFocusState = {
      id: activeEl.dataset.gfpSearchId,
      start: activeEl.selectionStart,
      end: activeEl.selectionEnd,
      val: activeEl.value
    };
  } else {
    _gfpFocusState = null;
  }
  
  body.querySelectorAll('.gfp-check-list').forEach(list => {
    if (list.dataset.gfpListId) {
      _gfpListScrolls[list.dataset.gfpListId] = list.scrollTop;
    }
  });

  /* ── ボディ再描画 ── */
  body.innerHTML = '';

  /* ── 共通ハンドラ生成 ── */
  const handler = (key) => (val, on, clear, excludeAll, allItems) => {
    if (!f[key]) f[key] =[];
    if (clear) { 
      f[key] =[]; 
    } else if (excludeAll && allItems) {
      f[key] = allItems.map(i => i.value);
    } else if (on) { 
      if (!f[key].includes(val)) f[key].push(val); 
    } else { 
      f[key] = f[key].filter(x => x !== val); 
    }
    saveDB(); renderGlobalFilterPanel(); refreshAll();
  };

  /* ================================================================
     各フィルターセクションを追加
  ================================================================ */

  /**
   * _withUnset — 未設定従業員が存在する場合、itemsの末尾に「未設定」アイテムを追加する
   * @param {Array}    items    既存のアイテム配列
   * @param {number}   count    未設定従業員の人数
   * @returns {Array}
   */
  const UNSET_VAL = '';  // フラットフィールド共通センチネル（applyGlobalFilter で e.field||'' と照合）
  const _withUnset = (items, count) => {
    if (count <= 0) return items;
    return [...items, {
      value: UNSET_VAL, label: '未設定',
      icon: 'fa-solid fa-circle-minus', color: null,
      count, isUnset: true,
    }];
  };

  // 在籍状況
  _makeSection(body, panel, {
    id:    'status',
    icon:  'fa-solid fa-circle-dot',
    title: '在籍状況',
    items: _withUnset(
      (DB.masters.status || []).map(i => ({
        value: i.name, label: i.name, icon: i.icon || null, color: i.color || null,
        count: DB.employees.filter(e => e.status === i.name).length,
      })),
      DB.employees.filter(e => !e.status).length
    ),
    selected: f.status,
    onChange: handler('status'),
  });

  // 属性
  _makeSection(body, panel, {
    id:    'attribute',
    icon:  'fa-solid fa-map-location-dot',
    title: '属性',
    items: _withUnset(
      (DB.masters.attribute || []).map(i => ({
        value: i.name, label: i.name, icon: i.icon || null, color: i.color || null,
        count: DB.employees.filter(e => e.attribute === i.name).length,
      })),
      DB.employees.filter(e => !e.attribute).length
    ),
    selected: f.attribute,
    onChange: handler('attribute'),
  });

  // 性別
  _makeSection(body, panel, {
    id:    'gender',
    icon:  'fa-solid fa-venus-mars',
    title: '性別',
    items: _withUnset(
      [
        { value:'男性',  label:'男性',  icon:'fa-solid fa-mars',  color:'#3B82F6',
          count: DB.employees.filter(e=>e.gender==='男性').length },
        { value:'女性',  label:'女性',  icon:'fa-solid fa-venus', color:'#EC4899',
          count: DB.employees.filter(e=>e.gender==='女性').length },
        { value:'その他',label:'その他', icon: null,              color:'#8B5CF6',
          count: DB.employees.filter(e=>e.gender==='その他').length },
      ],
      DB.employees.filter(e => !e.gender).length
    ),
    selected: f.gender,
    onChange: handler('gender'),
  });

  // 入社区分
  _makeSection(body, panel, {
    id:    'hireType',
    icon:  'fa-solid fa-door-open',
    title: '入社区分',
    items: _withUnset(
      (DB.masters.hireType || []).map(i => ({
        value: i.name, label: i.name, icon: i.icon || null, color: i.color || null,
        count: DB.employees.filter(e => e.hireType === i.name).length,
      })),
      DB.employees.filter(e => !e.hireType).length
    ),
    selected: f.hireType,
    onChange: handler('hireType'),
  });

  // 履修系統
  _makeSection(body, panel, {
    id:    'course',
    icon:  'fa-solid fa-book-open',
    title: '履修系統',
    items: _withUnset(
      (DB.masters.course || []).map(i => ({
        value: i.name, label: i.name, icon: i.icon || null, color: i.color || null,
        count: DB.employees.filter(e => e.course === i.name).length,
      })),
      DB.employees.filter(e => !e.course).length
    ),
    selected: f.course,
    onChange: handler('course'),
  });

  // 会社マスタ（所属）
  if (DB.masters.company && DB.masters.company.length) {
    _makeSection(body, panel, {
      id:    'company',
      icon:  'fa-solid fa-building',
      title: '所属会社',
      items: _withUnset(
        DB.masters.company.map(n => ({
          value: n.name, label: n.name, icon: null, color: null,
          count: DB.employees.filter(e => getEmpLatestCompany(e) === n.name).length,
        })),
        DB.employees.filter(e => !getEmpLatestCompany(e)).length
      ),
      selected: f.company || [],
      onChange: handler('company'),
    });
  }

  // 学校マスタ
  if (DB.masters.school && DB.masters.school.length) {
    const schoolPaths = [];
    function traverseSchool(nodes, currentPath) {
      nodes.forEach(n => {
        const path = currentPath ? `${currentPath} ＞ ${n.name}` : n.name;
        schoolPaths.push({ name: n.name, path: path });
        if (n.children && n.children.length) traverseSchool(n.children, path);
      });
    }
    traverseSchool(DB.masters.school, "");

    _makeSection(body, panel, {
      id:    'school',
      icon:  'fa-solid fa-graduation-cap',
      title: '学校名',
      items: _withUnset(
        schoolPaths.map(n => ({
          value: n.path, label: n.path, icon: null, color: null,
          count: DB.employees.filter(e => {
            const fullText = (e.school || '') + ' ' + (e.eduDept || '');
            return n.path.split(' ＞ ').every(p => fullText.includes(p));
          }).length,
        })),
        DB.employees.filter(e => !e.school && !e.eduDept).length
      ),
      selected: f.school || [],
      onChange: handler('school'),
    });
  }

  // 学歴区分（登録済み従業員から収集）
  const EDU_ORDER = ['博士','修士','大卒','高専卒','専門卒','短大卒','高卒','中卒'];
  const usedEdus = [...new Set(DB.employees.map(e=>e.education).filter(Boolean))]
    .sort((a,b) => {
      const ia = EDU_ORDER.indexOf(a), ib = EDU_ORDER.indexOf(b);
      return (ia===-1?99:ia)-(ib===-1?99:ib);
    });
  if (usedEdus.length) {
    _makeSection(body, panel, {
      id:    'education',
      icon:  'fa-solid fa-user-graduate',
      title: '学歴区分',
      items: _withUnset(
        usedEdus.map(v => ({
          value: v, label: v, icon: null, color: null,
          count: DB.employees.filter(e => e.education === v).length,
        })),
        DB.employees.filter(e => !e.education).length
      ),
      selected: f.education || [],
      onChange: handler('education'),
    });
  }

  // タグ（タグなし = '__notag__' センチネル）
  if (DB.tags.length) {
    const noTagCount = DB.employees.filter(e => !(e.tags||[]).length).length;
    const tagItems = [
      ...DB.tags.map(t => ({
        value: t.id, label: t.name, icon: null, color: t.color,
        count: DB.employees.filter(e=>(e.tags||[]).includes(t.id)).length,
      })),
      ...(noTagCount > 0 ? [{
        value: '__notag__', label: '未設定（タグなし）',
        icon: 'fa-solid fa-circle-minus', color: null,
        count: noTagCount, isUnset: true,
      }] : []),
    ];
    // OR/AND モード行はタグ実体が2件以上ある場合のみ表示
    const realTagSelected = f.tags.filter(t => t !== '__notag__');
    _makeSection(body, panel, {
      id:    'tags',
      icon:  'fa-solid fa-tags',
      title: 'タグ',
      items: tagItems,
      selected: f.tags,
      onChange: (val, on, clear, excludeAll, allItems) => {
        if (clear) { 
          f.tags = []; 
        } else if (excludeAll && allItems) {
          f.tags = allItems.map(i => i.value);
        } else if (on) { 
          if (!f.tags.includes(val)) f.tags.push(val); 
        } else { 
          f.tags = f.tags.filter(x => x !== val); 
        }
        saveDB(); renderGlobalFilterPanel(); refreshAll();
      },
      suffix: realTagSelected.length > 1 ? _makeTagModeRow(f) : null,
    });
  }

  body.scrollTop = savedScroll;

  /* ── 状態の復元（スクロールとフォーカス） ── */
  body.querySelectorAll('.gfp-check-list').forEach(list => {
    if (list.dataset.gfpListId && _gfpListScrolls[list.dataset.gfpListId] !== undefined) {
      list.scrollTop = _gfpListScrolls[list.dataset.gfpListId];
    }
  });

  if (_gfpFocusState) {
    const input = body.querySelector(`[data-gfp-search-id="${_gfpFocusState.id}"]`);
    if (input) {
      input.focus();
      try {
        input.setSelectionRange(_gfpFocusState.start, _gfpFocusState.end);
      } catch(_) {}
    }
  }
}

/* ----------------------------------------------------------------
   _renderActiveBar  適用中フィルターをフッターバーに表示
   ・常時固定位置（最下部）でレイアウトシフトなし
   ・フィルターなし: ニュートラル表示
   ・フィルターあり: アクセントカラー + 展開トグルでチップ表示
---------------------------------------------------------------- */
function _renderActiveBar(f) {
  const bar   = document.getElementById('gfp-active-bar');
  const chips = document.getElementById('gfp-active-chips');
  const lbl   = document.getElementById('gfp-active-count-lbl');
  const icon  = document.getElementById('gfp-active-bar-icon');
  if (!bar || !chips) return;

  // 除外モデル: 配列内 = 非表示項目
  const all = [
    ...(f.status    || []).map(v=>({ key:'status',    val:v, label:v,
        color: (DB.masters.status||[]).find(i=>i.name===v)?.color||null })),
    ...(f.attribute || []).map(v=>({ key:'attribute',  val:v, label:v,
        color: (DB.masters.attribute||[]).find(i=>i.name===v)?.color||null })),
    ...(f.gender    || []).map(v=>({ key:'gender',     val:v, label:v,
        color: v==='男性'?'#3B82F6':v==='女性'?'#EC4899':'#8B5CF6' })),
    ...(f.hireType  || []).map(v=>({ key:'hireType',   val:v, label:v,
        color: (DB.masters.hireType||[]).find(i=>i.name===v)?.color||null })),
    ...(f.course    || []).map(v=>({ key:'course',     val:v, label:v,
        color: (DB.masters.course||[]).find(i=>i.name===v)?.color||null })),
    ...(f.company   || []).map(v=>({ key:'company',    val:v, label:v, color:null })),
    ...(f.school    || []).map(v=>({ key:'school',     val:v, label:v, color:null })),
    ...(f.education || []).map(v=>({ key:'education',  val:v, label:v, color:null })),
    ...(f.tags      || []).map(id=>{
      const t = DB.tags.find(x=>x.id===id);
      return { key:'tags', val:id, label:t?t.name:id, color:t?.color||null };
    }),
  ];

  const hasFilters = all.length > 0;

  /* ── クラス制御 ── */
  bar.classList.toggle('has-filters', hasFilters);

  /* ── アイコン切替 ── */
  if (icon) {
    icon.className = hasFilters
      ? 'fa-solid fa-eye-slash gfp-active-bar-icon'
      : 'fa-solid fa-eye gfp-active-bar-icon';
  }

  /* ── ラベルテキスト更新（除外モデル表現） ── */
  if (lbl) {
    lbl.textContent = hasFilters ? `${all.length}件を非表示中` : 'すべて表示中';
  }

  /* ── チップ群を再描画（非表示項目 → クリックで復元） ── */
  chips.innerHTML = '';
  all.forEach(item => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'gfp-active-chip gfp-active-chip--excluded';
    chip.title = `クリックすると「${item.label}」を再表示します`;
    if (item.color) {
      chip.style.background   = lighten(item.color, 0.88);
      chip.style.borderColor  = item.color;
      chip.style.color        = item.color;
    }
    chip.innerHTML = `<i class="fa-solid fa-eye-slash gfp-excl-chip-icon"></i><span>${item.label}</span><span class="gfp-active-chip-x" title="クリックで再表示"><i class="fa-solid fa-rotate-left"></i></span>`;
    chip.addEventListener('click', () => {
      const arr = f[item.key] || [];
      f[item.key] = arr.filter(x => x !== item.val);
      saveDB(); renderGlobalFilterPanel(); refreshAll();
    });
    chips.appendChild(chip);
  });

  /* 除外がなくなった場合は展開状態を閉じる */
  if (!hasFilters) bar.classList.remove('is-chips-open');

  /* ── 展開トグルボタンのイベント（1回だけ登録） ── */
  if (!bar.dataset.toggleBound) {
    bar.dataset.toggleBound = '1';
    const toggleBtn = document.getElementById('btn-gfp-chips-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        bar.classList.toggle('is-chips-open');
      });
    }
  }
}

/* ----------------------------------------------------------------
   _makeSection  各フィルターセクションを生成
   ・items.length <= GFP_CHIP_MAX → チップ群
   ・items.length > GFP_CHIP_MAX  → 検索 + チェックボックスリスト
---------------------------------------------------------------- */
function _makeSection(body, panel, { id, icon, title, items, selected, onChange, suffix }) {
  if (!items.length) return;

  const sect = document.createElement('div');
  sect.className = 'gfp-section';

  const isCollapsed = !!panel.dataset['col_' + id];
  if (isCollapsed) sect.classList.add('is-collapsed');

  // 除外モデル: selected = 除外中の値リスト
  const excludedCnt = selected.filter(v => items.some(i => i.value === v)).length;

  /* ── ヘッダー ── */
  const hd = document.createElement('button');
  hd.type = 'button';
  hd.className = 'gfp-section-hd';
  
  hd.innerHTML = `
    <span class="gfp-section-hd-left">
      <i class="${icon}"></i>
      <span>${title}</span>
      ${excludedCnt ? `<span class="gfp-sect-cnt gfp-sect-cnt--excl"><i class="fa-solid fa-eye-slash"></i>${excludedCnt}</span>` : ''}
    </span>
    <span class="gfp-section-hd-right">
      <div class="gfp-sect-bulk-acts">
        <span class="gfp-btn-bulk on" title="すべて表示">全ON</span>
        <span class="gfp-btn-bulk off" title="すべて非表示">全OFF</span>
      </div>
      <i class="fa-solid fa-chevron-down gfp-chevron"></i>
    </span>`;
    
  hd.addEventListener('click', (e) => {
    const btnOn = e.target.closest('.gfp-btn-bulk.on');
    const btnOff = e.target.closest('.gfp-btn-bulk.off');
    if (btnOn) {
      e.stopPropagation();
      onChange(null, false, true, false, items);
      return;
    }
    if (btnOff) {
      e.stopPropagation();
      onChange(null, false, false, true, items);
      return;
    }
    const c = sect.classList.toggle('is-collapsed');
    panel.dataset['col_' + id] = c ? '1' : '';
  });

  /* ── ボディ ── */
  const bd = document.createElement('div');
  bd.className = 'gfp-sect-body';

  if (items.length <= GFP_CHIP_MAX) {
    /* チップモード */
    const grp = document.createElement('div');
    grp.className = 'gfp-chip-group';
    items.forEach(item => {
      const excluded = selected.includes(item.value);
      const chip = document.createElement('button');
      chip.type = 'button';
      // is-on = 表示中（デフォルト）, is-excluded = 除外中（非表示）
      chip.className = 'gfp-chip' + (!excluded ? ' is-on' : ' is-excluded') + (item.isUnset ? ' is-unset' : '');
      chip.title = excluded
        ? `クリックすると「${item.label}」を再表示します`
        : `クリックすると「${item.label}」を非表示にします`;

      if (item.color) {
        chip.classList.add('is-colored');
        if (!excluded) {
          // ON: WCAG AA 基準を満たす明度に暗くしてから充填（白文字で高コントラスト）
          const solidColor = darkenForSolid(item.color);
          chip.style.background  = solidColor;
          chip.style.borderColor = solidColor;
          chip.style.color       = '#fff';
        }
        // 除外中: CSSの is-excluded スタイルに任せる（inline styleリセット）
      }

      const iconHtml  = item.icon ? `<i class="${item.icon}"></i>` : '';
      const countHtml = item.count != null
        ? `<span class="gfp-chip-cnt">${item.count}</span>` : '';

      if (!excluded) {
        chip.innerHTML = `${iconHtml}${item.label}${countHtml}`;
      } else {
        chip.innerHTML = `<i class="fa-solid fa-eye-slash gfp-chip-excl-icon"></i><s>${item.label}</s>${countHtml}`;
      }

      // 除外モデルのクリックハンドラ:
      //   表示中(excluded=false) → !excluded=true → onChange add  → 除外配列に追加
      //   除外中(excluded=true)  → !excluded=false→ onChange remove→ 除外配列から削除
      chip.addEventListener('click', () => onChange(item.value, !excluded));
      grp.appendChild(chip);
    });
    bd.appendChild(grp);
  } else {
    /* チェックボックスリストモード（検索付き） */
    let filterText = '';
    // フォーカス状態があれば復元
    if (_gfpFocusState && _gfpFocusState.id === id) {
      filterText = _gfpFocusState.val;
    }

    const searchWrap = document.createElement('div');
    searchWrap.className = 'gfp-list-search';
    searchWrap.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i><input type="text" data-gfp-search-id="${id}" placeholder="${title}で絞り込む…" autocomplete="off" value="${filterText.replace(/"/g, '&quot;')}">`;
    const searchInput = searchWrap.querySelector('input');
    bd.appendChild(searchWrap);

    const listEl = document.createElement('div');
    listEl.className = 'gfp-check-list';
    listEl.dataset.gfpListId = id;
    bd.appendChild(listEl);

    const renderList = (q) => {
      listEl.innerHTML = '';
      const lower = q.toLowerCase();
      const filtered = q
        ? items.filter(i => i.label.toLowerCase().includes(lower))
        : items;
      if (!filtered.length) {
        listEl.innerHTML = `<div class="gfp-check-empty"><i class="fa-solid fa-magnifying-glass" style="opacity:.3"></i> 該当なし</div>`;
        return;
      }
      filtered.forEach(item => {
        const excluded = selected.includes(item.value);
        const row = document.createElement('label');
        // is-checked = 表示中（チェックON）, is-excluded = 除外中（チェックOFF）
        row.className = 'gfp-check-item'
          + (!excluded ? ' is-checked' : ' is-excluded')
          + (item.isUnset ? ' is-unset' : '');
        row.title = excluded
          ? `クリックすると「${item.label}」を再表示します`
          : `クリックすると「${item.label}」を非表示にします`;
        row.innerHTML = `
          <input type="checkbox" ${!excluded ? 'checked' : ''}>
          <span class="gfp-check-box"><i class="fa-solid fa-check"></i></span>
          ${item.color ? `<span class="gfp-check-dot" style="background:${!excluded ? item.color : '#CBD5E1'}"></span>` : ''}
          <span class="gfp-check-label">${excluded ? `<s>${q ? _hl(item.label, q) : item.label}</s>` : (q ? _hl(item.label, q) : item.label)}</span>
          ${item.count != null ? `<span class="gfp-check-count">${item.count}</span>` : ''}`;
        row.addEventListener('click', (e) => {
          e.preventDefault();
          onChange(item.value, !excluded);
        });
        listEl.appendChild(row);
      });
    };

    renderList('');

    searchInput.addEventListener('input', e => {
      filterText = e.target.value;
      renderList(filterText);
    });
  }

  /* suffix（タグ OR/AND モード行など） */
  if (suffix) bd.appendChild(suffix);

  sect.append(hd, bd);
  body.appendChild(sect);
}

/* ----------------------------------------------------------------
   _makeTagModeRow  タグ OR/AND モード切替行を生成
---------------------------------------------------------------- */
function _makeTagModeRow(f) {
  const row = document.createElement('div');
  row.className = 'gfp-tag-mode';
  row.innerHTML = `
    <span class="gfp-tag-mode-lbl">絞り込みモード</span>
    <div class="rpill-group" style="margin:0">
      <label class="rpill"><input type="radio" name="gfp-tag-mode" value="or"  ${f.tagMode!=='and'?'checked':''}><span class="rpill-lbl">OR</span></label>
      <label class="rpill"><input type="radio" name="gfp-tag-mode" value="and" ${f.tagMode==='and'?'checked':''}><span class="rpill-lbl">AND</span></label>
    </div>`;
  row.querySelectorAll('input[name="gfp-tag-mode"]').forEach(r => {
    r.addEventListener('change', () => { f.tagMode = r.value; saveDB(); refreshAll(); });
  });
  return row;
}

/* ----------------------------------------------------------------
   _hl  検索文字列をハイライト（HTML文字列を返す）
---------------------------------------------------------------- */
function _hl(text, query) {
  if (!query) return text;
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(esc, 'gi'), m => `<span class="gfp-hl">${m}</span>`);
}

/** グローバルフィルタサイドバーの開閉 */
function toggleGlobalFilterPanel() {
  const panel = document.getElementById('global-filter-panel');
  if (!panel) return;
  const isOpen = panel.classList.toggle('is-open');
  if (isOpen) {
    renderGlobalFilterPanel();
    _saveFilterSidebarState(true);
  } else {
    _saveFilterSidebarState(false);
  }
}

/** サイドバー開閉状態を sessionStorage に保存 */
function _saveFilterSidebarState(open) {
  try { sessionStorage.setItem('fsb-open', open ? '1' : '0'); } catch(_) {}
}

/** 起動時にサイドバー開閉状態を復元（デフォルト：展開） */
function _restoreFilterSidebarState() {
  const panel = document.getElementById('global-filter-panel');
  if (!panel) return;
  let open = true; // デフォルトは展開
  try {
    const saved = sessionStorage.getItem('fsb-open');
    if (saved === '0') open = false;
  } catch(_) {}
  if (open) {
    panel.classList.add('is-open');
    renderGlobalFilterPanel();
  }
}

/** フィルタをすべてリセット */
function resetGlobalFilter() {
  const f = DB.settings.globalFilter;
  f.status = []; f.attribute = []; f.gender = [];
  f.hireType = []; f.course = []; f.tags = [];
  f.company = []; f.school = []; f.education = [];
  saveDB(); renderGlobalFilterPanel(); refreshAll();
}

/* ================================================================
   MODAL UTILITIES
================================================================ */
let modalZIndexCounter = 1000;

function openModal(id) {
  const el = document.getElementById(id);
  const modal = el.querySelector('.modal');
  // 開くときは必ずシェイククラスをリセット（開いた瞬間の意図しない揺れを防止）
  if (modal) modal.classList.remove('modal-shake');
  
  modalZIndexCounter += 10;
  el.style.zIndex = modalZIndexCounter;
  
  el.classList.add('open');
}

function closeModal(id) {
  if (id === 'emp-modal' && empDirty) {
    // 未保存状態でキャンセルボタンや×ボタンを押した場合もシェイクして警告
    const modal = document.querySelector('#emp-modal .modal');
    if (modal) {
      modal.classList.remove('modal-shake');
      void modal.offsetWidth;
      modal.classList.add('modal-shake');
    }
    showEmpDirtyBanner();
    toast('未保存の変更があります。「変更を破棄して閉じる」か「未保存の変更を保存」を選択してください');
    return;
  }
  const el = document.getElementById(id);
  const modal = el.querySelector('.modal');
  // 閉じるときもクラスをリセットして状態をクリーンに保つ
  if (modal) modal.classList.remove('modal-shake');
  el.classList.remove('open');
  setTimeout(() => { if (!el.classList.contains('open')) el.style.zIndex = ''; }, 200);
  if (id === 'emp-modal') empDirty = false;
  if (!document.querySelector('.overlay.open')) modalZIndexCounter = 1000;
}

function forceCloseModal(id) {
  const el = document.getElementById(id);
  const modal = el.querySelector('.modal');
  if (modal) modal.classList.remove('modal-shake');
  el.classList.remove('open');
  el.style.zIndex = '';
  if (id === 'emp-modal') { empDirty = false; hideEmpDirtyBanner(); }
  if (!document.querySelector('.overlay.open')) modalZIndexCounter = 1000;
}

/* ================================================================
   EMP MODAL DIRTY STATE
================================================================ */
let empDirty = false;
let empOriginalSnapshot = '';

function getEmpFormSnapshot() {
  const fields = ['f-last','f-first','f-last-kana','f-first-kana','f-hire','f-birth',
    'f-education','f-school','f-edu-dept','f-memo','f-resign'];
  const vals = fields.map(id => (document.getElementById(id)?.value || ''));
  
  let approxVals = '';
  document.querySelectorAll('.approx-age-item').forEach(row => {
    approxVals += (row.querySelector('.inp-approx-age')?.value || '') + '|' + (row.querySelector('.inp-approx-refdate')?.value || '') + '|';
  });

  const gender   = document.querySelector('input[name="f-gender"]:checked')?.value   || '';
  const attr     = document.querySelector('input[name="f-attr"]:checked')?.value     || '';
  const status   = document.querySelector('input[name="f-status"]:checked')?.value   || '';
  const hireType = document.querySelector('input[name="f-hiretype"]:checked')?.value || '';
  const course   = document.querySelector('input[name="f-course"]:checked')?.value   || '';
  // ギャラリー変更フラグと新しいアバタースタイル
  const galleryState = JSON.stringify(avatarGallery.map(g => g.avatarId || g.localId)) + '|' + activeAvatarIdx;
  return JSON.stringify([...vals, approxVals, gender, attr, status, hireType, course, ...selectedTagIds, galleryState, currentAvatarAspect, currentAvatarRadius, currentAvatarFit]);
}
function markEmpDirty() {
  const snap = getEmpFormSnapshot();
  if (snap !== empOriginalSnapshot) { empDirty = true; showEmpDirtyBanner(); }
  else { empDirty = false; hideEmpDirtyBanner(); }
}
function showEmpDirtyBanner() { 
  const saveBtn = document.getElementById('btn-save-emp');
  const cancelBtn = document.getElementById('btn-cancel-emp');
  if (saveBtn) {
    saveBtn.classList.add('is-dirty');
    saveBtn.innerHTML = '<i class="fa-solid fa-check-double"></i>未保存の変更を保存';
  }
  if (cancelBtn) {
    cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>変更を破棄して閉じる';
    cancelBtn.classList.add('is-dirty-cancel');
  }
}
function hideEmpDirtyBanner() { 
  const saveBtn = document.getElementById('btn-save-emp');
  const cancelBtn = document.getElementById('btn-cancel-emp');
  if (saveBtn) {
    saveBtn.classList.remove('is-dirty');
    saveBtn.innerHTML = '<i class="fa-solid fa-check"></i>保存';
  }
  if (cancelBtn) {
    cancelBtn.innerHTML = 'キャンセル';
    cancelBtn.classList.remove('is-dirty-cancel');
  }
}
function attachEmpDirtyListeners() {
  const modal = document.getElementById('emp-modal');
  modal.querySelectorAll('.finput, input[type="radio"], input[type="date"]').forEach(el => {
    el.addEventListener('input',  markEmpDirty);
    el.addEventListener('change', markEmpDirty);
  });
}

/* ================================================================
   SPLIT CONFIG HELPERS
================================================================ */
function getSplitCfg(split) {
  if (split === 'age_thresh') {
    const t = DB.settings.numericThreshold.age;
    return {
      label:'年齢', left:`${t}歳未満`, right:`${t}歳以上`, lColor:'#14B8A6', rColor:'#F97316', isNumeric:true,
      leftItems: [{ name:`${t}歳未満`, color:'#14B8A6', icon:'fa-solid fa-arrow-down' }],
      rightItems:[{ name:`${t}歳以上`, color:'#F97316', icon:'fa-solid fa-arrow-up'   }]
    };
  }
  if (split === 'years_thresh') {
    const t = DB.settings.numericThreshold.years;
    return {
      label:'在社年数', left:`${t}年未満`, right:`${t}年以上`, lColor:'#8B5CF6', rColor:'#EF4444', isNumeric:true,
      leftItems: [{ name:`${t}年未満`, color:'#8B5CF6', icon:'fa-solid fa-arrow-down' }],
      rightItems:[{ name:`${t}年以上`, color:'#EF4444', icon:'fa-solid fa-arrow-up'   }]
    };
  }
  if (split === 'gender') return SPLIT_CONFIG_GENDER;
  if (split === 'attribute' || split === 'hireType' || split === 'status' || split === 'course')
    return getSplitCfgForFlat(split);
  return null;
}
function getSplitVal(emp, split) {
  if (split === 'position')   return getEmpActiveState(emp).position || '未設定';
  if (split === 'birthMonth') { const m = getBirthMonth(emp.birthDate); return m !== null ? m + '月' : '未設定'; }
  if (split === 'zodiac')     return getZodiac(emp.birthDate) || '未設定';

  if (split === 'attribute' || split === 'hireType' || split === 'status' || split === 'course') {
    const cfg = getSplitCfgForFlat(split);
    if (!cfg) return '';
    const val = emp[split] || '';
    if (cfg.leftNames.includes(val))  return cfg.left;
    if (cfg.rightNames.includes(val)) return cfg.right;
    return '';
  }
  if (split === 'gender')      return emp.gender || '';
  if (split === 'age_thresh') {
    const age = getEmpAge(emp); if (age === null) return '';
    const t = DB.settings.numericThreshold.age;
    return age < t ? `${t}歳未満` : `${t}歳以上`;
  }
  if (split === 'years_thresh') {
    const y = calcYears(emp.hireDate); if (y === null) return '';
    const t = DB.settings.numericThreshold.years;
    return y < t ? `${t}年未満` : `${t}年以上`;
  }
  return '';
}

/* ================================================================
   THRESHOLD SLIDER
================================================================ */
function isNumericSplit(split) { return split === 'age_thresh' || split === 'years_thresh'; }
function updateThreshSlider() {
  const split  = DB.settings.split;
  const row    = document.getElementById('thresh-row');
  const slider = document.getElementById('thresh-slider');
  const badge  = document.getElementById('thresh-val-badge');
  const lbl    = document.getElementById('thresh-axis-lbl');
  if (!isNumericSplit(split)) { row.classList.remove('visible'); return; }
  row.classList.add('visible');
  if (split === 'age_thresh') {
    lbl.textContent = '年齢閾値';
    slider.min = 18; slider.max = 65;
    slider.value = DB.settings.numericThreshold.age;
    badge.textContent = slider.value + '歳';
  } else {
    lbl.textContent = '在社年数閾値';
    slider.min = 1; slider.max = 40;
    slider.value = DB.settings.numericThreshold.years;
    badge.textContent = slider.value + '年';
  }
}

/* ================================================================
   COLUMN MANAGEMENT
================================================================ */
function getListCols() {
  if (DB.settings.listCols) {
    const saved    = DB.settings.listCols;
    const savedKeys = new Set(saved.map(c => c.key));
    const merged   = [...saved];
    COL_DEFS.forEach(def => {
      if (!savedKeys.has(def.key)) merged.push({ key:def.key, visible:!def.defaultHidden });
    });
    return merged;
  }
  return COL_DEFS.map(d => ({ key:d.key, visible:!d.defaultHidden }));
}
function getColDef(key) { return COL_DEFS.find(d => d.key === key); }
function resetListCols() {
  DB.settings.listCols = null;
  saveDB();
  renderColPanel();
  renderListHeader();
  renderList();
}

/* ================================================================
   NAVIGATION
================================================================ */
function switchView(view) {
  if (view === 'tags') {
    view = 'masters';
    currentMasterType = 'tag';
    document.querySelectorAll('.master-tab').forEach(t =>
      t.classList.toggle('is-active', t.dataset.master === 'tag'));
  }
  currentView = view;
  document.querySelectorAll('.view').forEach(v  => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('view-' + view).classList.add('active');
  const navBtn = document.querySelector(`[data-view="${view}"]`);
  if (navBtn) navBtn.classList.add('active');

  // マスタ管理ビュー時はフィルターサイドバーを非表示
  const sidebar = document.getElementById('global-filter-panel');
  if (sidebar) sidebar.classList.toggle('is-masters-view', view === 'masters');

  if (view === 'list')         renderList();
  if (view === 'distribution') renderDist();
  if (view === 'masters')      renderMasterView();
  if (view === 'heatmap')      renderHeatmap();
  if (view === 'dashboard')    renderDashboard();
  if (view === 'map')          renderMapView();
}
function updateHeaderCnt() {
  document.getElementById('header-cnt').textContent = `${DB.employees.length}名登録`;
  const btnHelp = document.getElementById('btn-help');
  if (btnHelp) btnHelp.disabled = DB.employees.length > 0;
}

function updateBackupBadge() {
  const btn = document.getElementById('btn-export-json');
  if (!btn) return;
  const last = DB.settings.lastBackupDate || 0;
  const days = (Date.now() - last) / (1000 * 60 * 60 * 24);
  if (days >= 30) {
    btn.classList.add('needs-backup');
    btn.title = '前回のバックアップから30日以上経過しています。バックアップを推奨します。';
  } else {
    btn.classList.remove('needs-backup');
    btn.title = 'バックアップ(ZIP)';
  }
}

/* ================================================================
   CONFIRM MODAL
================================================================ */
function openConfirm(msg, cb, opts = {}) {
  document.getElementById('confirm-msg').textContent = msg;
  document.getElementById('confirm-modal-title').textContent = opts.title || '削除の確認';
  const ico   = document.getElementById('confirm-modal-icon');
  ico.className   = opts.icon      || 'fa-solid fa-triangle-exclamation';
  ico.style.color = opts.iconColor || 'var(--c-warn)';
  const inner = document.getElementById('confirm-ico-inner');
  inner.className   = opts.innerIcon  || 'fa-solid fa-trash-can';
  inner.style.color = opts.innerColor || 'var(--c-danger)';
  const okBtn = document.getElementById('btn-confirm-ok');
  okBtn.innerHTML = `<i class="${opts.okIcon||'fa-solid fa-trash-can'}"></i>${opts.okLabel||'削除する'}`;
  okBtn.className = opts.okClass || 'btn btn-danger';

  const promptWrap = document.getElementById('confirm-prompt-wrap');
  const promptInput = document.getElementById('confirm-prompt-input');
  if (opts.promptText) {
    if (promptWrap && promptInput) {
      promptWrap.style.display = 'block';
      const lbl = document.getElementById('confirm-prompt-lbl');
      if(lbl) lbl.textContent = `確認のため「${opts.promptText}」と入力してください`;
      promptInput.value = '';
      promptInput.placeholder = opts.promptText;
      okBtn.disabled = true;
      okBtn.style.opacity = '0.5';
      okBtn.style.cursor = 'not-allowed';
      
      promptInput.oninput = (e) => {
        if (e.target.value === opts.promptText) {
          okBtn.disabled = false;
          okBtn.style.opacity = '1';
          okBtn.style.cursor = 'pointer';
        } else {
          okBtn.disabled = true;
          okBtn.style.opacity = '0.5';
          okBtn.style.cursor = 'not-allowed';
        }
      };
    }
  } else {
    if (promptWrap) promptWrap.style.display = 'none';
    if (promptInput) promptInput.oninput = null;
    okBtn.disabled = false;
    okBtn.style.opacity = '1';
    okBtn.style.cursor = 'pointer';
  }

  confirmCb = cb; openModal('confirm-modal');
  if (opts.promptText && promptInput) {
    setTimeout(() => promptInput.focus(), 100);
  }
}

/* ================================================================
   MASTER MANAGEMENT — CONFIG
================================================================ */
function getFlatMasterItems(type) { return DB.masters[type] || []; }
function getFlatMasterColor(type, value) {
  if (!value) return null;
  return (DB.masters[type] || []).find(i => i.name === value)?.color || null;
}
function getMasterCfg(type) {
  const cfg = DB.masterConfig[type];
  if (!cfg) return null;
  if (cfg.type === 'flat') {
    return {
      label: cfg.label,
      icon:  cfg.icon || 'fa-solid fa-list',
      itemLabel: cfg.itemLabel || cfg.label,
      isFlat: true,
    };
  }
  const ICONS = {
    school:  { icon:'fa-solid fa-graduation-cap', levelIcons:['fa-solid fa-school','fa-solid fa-building-columns','fa-solid fa-flask','fa-solid fa-book','fa-solid fa-circle-dot'] },
    company: { icon:'fa-solid fa-building',       levelIcons:['fa-solid fa-building','fa-solid fa-sitemap','fa-solid fa-people-group','fa-solid fa-diagram-project','fa-solid fa-circle-dot'] },
    position:{ icon:'fa-solid fa-user-tie',       levelIcons:['fa-solid fa-users','fa-solid fa-user','fa-solid fa-circle-dot'] },
  };
  const ic = ICONS[type] || { icon:'fa-solid fa-folder', levelIcons:['fa-solid fa-folder','fa-solid fa-circle-dot','fa-solid fa-circle-dot','fa-solid fa-circle-dot','fa-solid fa-circle-dot'] };
  const levels = (cfg.levels ||[]).map((lv, i) => ({
    label:       lv.label,
    icon:        ic.levelIcons[i] || 'fa-solid fa-circle-dot',
    placeholder: lv.placeholder  || '',
  }));
  const addRootLabel = levels[0] ? `${levels[0].label}を追加` : '追加';
  const labelMap = { school:'学校マスタ', company:'会社マスタ', position:'役職マスタ' };
  return {
    label: labelMap[type] || `${type}マスタ`,
    icon: ic.icon, levels, addRootLabel, isFlat: false,
  };
}
const MASTER_CFG = new Proxy({}, { get: (_, k) => getMasterCfg(k) });

/* ================================================================
   COMPANY — PER-NODE LEVEL HELPERS
================================================================ */
/**
 * 会社ルートノードに設定された階層ラベルを返す。
 * ノード固有の levels がない場合は masterConfig.company.levels をデフォルトとして使用。
 * ※ depth=0 は会社名そのものなので levels[0] が depth=1 に相当する。
 */
function getCompanyLevels(rootNode) {
  return (rootNode && Array.isArray(rootNode.levels) && rootNode.levels.length)
    ? rootNode.levels
    : (DB.masterConfig.company?.levels || []);
}

/**
 * 会社ルートノード（depth=0）の種別名称を返す。
 * 優先順: ノード固有 rootLabel → グローバルデフォルト → '会社'
 * 例: '会社', '事業部', '部署', '工場', '支社' など自由に設定可能。
 */
function getCompanyRootLabel(rootNode) {
  if (rootNode?.rootLabel) return rootNode.rootLabel;
  if (DB.masterConfig.company?.rootLabel) return DB.masterConfig.company.rootLabel;
  return '会社';
}

/** orgLevels[0] から対応する会社ルートノードを返す */
function findCompanyRoot(companyName) {
  if (!companyName) return null;
  return (DB.masters.company || []).find(c => c.name === companyName) || null;
}

/* ================================================================
   REFRESH ALL
================================================================ */
function refreshAll() {
  renderDistStatusFilter();
  if (currentView === 'list')         renderList();
  if (currentView === 'distribution') renderDist();
  if (currentView === 'heatmap')      renderHeatmap();
  if (currentView === 'dashboard')    renderDashboard();
  // ヘッダーボタンのバッジ常時更新
  _syncGfpHeaderBadge();
  // パネルが開いていれば再描画
  if (document.getElementById('global-filter-panel')?.classList.contains('is-open')) {
    renderGlobalFilterPanel();
  }
}
/** フィルターバッジ数を常に最新に保つ */
function _syncGfpHeaderBadge() {
  const f = DB.settings.globalFilter;
  if (!f) return;
  const total = f.status.length + f.attribute.length + f.gender.length +
    f.hireType.length + f.course.length + f.tags.length +
    (f.company||[]).length + (f.school||[]).length + (f.education||[]).length;

  // サイドバーストリップバッジ
  const strip = document.getElementById('fsb-strip-cnt');
  if (strip) {
    strip.textContent = total;
    strip.style.display = total > 0 ? '' : 'none';
  }
  // パネル内ヘッダーバッジ
  const hdBadge = document.getElementById('global-filter-badge');
  if (hdBadge) {
    hdBadge.textContent = total;
    hdBadge.style.display = total > 0 ? '' : 'none';
  }
}

/* ================================================================
   FLAT MASTER — 分布ビュー在籍状況フィルタ 動的生成
================================================================ */
function renderDistStatusFilter() {
  const container = document.getElementById('dist-status-filter');
  if (!container) return;
  const items = DB.masters.status || [];
  const sf    = DB.settings.distStatusFilter || {};
  container.innerHTML = '';
  items.forEach(item => {
    const on  = sf[item.name] !== false;
    const lbl = document.createElement('label');
    lbl.className  = 'status-pill' + (on ? '' : ' is-off');
    lbl.dataset.sf = item.name;
    if (item.color && on) {
      lbl.style.background  = item.color;
      lbl.style.borderColor = lighten(item.color, 0.3);
      lbl.style.color       = '#334155';
    }
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = on;
    const dot = document.createElement('i');
    dot.className = 'fa-solid fa-circle'; dot.style.fontSize = '8px';
    const txt = document.createTextNode(item.name);
    lbl.appendChild(chk); lbl.appendChild(dot); lbl.appendChild(txt);
    chk.addEventListener('change', () => {
      DB.settings.distStatusFilter[lbl.dataset.sf] = chk.checked;
      saveDB(); renderDistStatusFilter(); renderDist();
    });
    container.appendChild(lbl);
  });
}

/* ================================================================
   FLAT MASTER — 従業員フォーム ラジオpills 動的生成
================================================================ */
function renderFlatMasterPills(type, groupId, radioName, currentVal) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.innerHTML = '';
  const empField = FLAT_MASTER_EMP_FIELDS[type];

  // 入社区分は「新卒→中途→その他マスタ順」の優先ソートを適用
  const HIRETYPE_ORDER = ['新卒', '中途'];
  let items = DB.masters[type] || [];
  if (type === 'hireType' && items.length) {
    const preferred = HIRETYPE_ORDER.map(n => items.find(i => i.name === n)).filter(Boolean);
    const rest = items.filter(i => !HIRETYPE_ORDER.includes(i.name));
    items = [...preferred, ...rest];
  }

  items.forEach(item => {
    const lbl = document.createElement('label');
    lbl.className = 'rpill';
    const r = document.createElement('input');
    r.type = 'radio'; r.name = radioName; r.value = item.name;
    r.checked = (item.name === currentVal);
    const span = document.createElement('span');
    span.className = 'rpill-lbl';
    if (item.icon) { const i = document.createElement('i'); i.className = item.icon; span.appendChild(i); }
    span.appendChild(document.createTextNode(item.name));
    if (empField) {
      const cnt = DB.employees.filter(e => e[empField] === item.name).length;
      const cntSpan = document.createElement('span');
      cntSpan.className = 'rpill-count';
      cntSpan.textContent = cnt;
      cntSpan.dataset.zero = cnt === 0 ? 'true' : 'false';
      span.appendChild(cntSpan);
    }
    if (item.color) {
      lbl.style.setProperty('--pill-color', item.color);
      lbl.style.setProperty('--pill-bg',    lighten(item.color));
    }
    lbl.appendChild(r); lbl.appendChild(span);
    group.appendChild(lbl);
  });
  // 未設定
  const lbl2 = document.createElement('label'); lbl2.className = 'rpill';
  const r2 = document.createElement('input'); r2.type = 'radio'; r2.name = radioName; r2.value = '';
  r2.checked = !currentVal;
  const span2 = document.createElement('span'); span2.className = 'rpill-lbl';
  span2.appendChild(document.createTextNode('未設定'));
  lbl2.appendChild(r2); lbl2.appendChild(span2); group.appendChild(lbl2);
}

/* ================================================================
   MASTER TREE FLATTEN
================================================================ */
function masterFlatten(nodes = [], depth = 0, result = []) {
  nodes.forEach(n => {
    result.push({ ...n, depth });
    if (Array.isArray(n.children) && n.children.length) {
      masterFlatten(n.children, depth + 1, result);
    }
  });
  return result;
}
function masterGetValuesAtDepth(type, depth) {
  const flat = masterFlatten(DB.masters[type] || []);
  return flat.filter(n => n.depth === depth).map(n => n.name);
}

/* ================================================================
   SAMPLE DATA
================================================================ */
function initSampleData() {
  DB.masters.status    = JSON.parse(JSON.stringify(SAMPLE_MASTERS.status));
  DB.masters.attribute = JSON.parse(JSON.stringify(SAMPLE_MASTERS.attribute));
  DB.masters.hireType  = JSON.parse(JSON.stringify(SAMPLE_MASTERS.hireType));
  DB.masters.course    = JSON.parse(JSON.stringify(SAMPLE_MASTERS.course));
  DB.masters.position  = JSON.parse(JSON.stringify(SAMPLE_MASTERS.position));
  DB.tags              = JSON.parse(JSON.stringify(SAMPLE_MASTERS.tag));
  DB.masters.school   = JSON.parse(JSON.stringify(SAMPLE_MASTERS.school));
  DB.masters.company  = JSON.parse(JSON.stringify(SAMPLE_MASTERS.company));

  DB.employees = [
{ id:'s01', lastName:'山田',  firstName:'太郎',   lastNameKana:'やまだ',  firstNameKana:'たろう',   gender:'男性', birthDate:'1985-03-15', ageApprox:null, hireDate:'2010-04-01', attribute:'地域系', status:'在籍', hireType:'新卒', course:'事務系', education:'大卒',   school:'早稲田大学',       eduDept:'政治経済学部 経済学科',      tags:['t1','t6'], memo:'将来の部門長候補', transfers:[{id:'tr01',date:'2010-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','仕上課'],note:'新卒配属'},{id:'tr02',date:'2018-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','品質管理課'],note:'品質管理へ異動'},{id:'tr03',date:'2022-10-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','仕上課'],note:'係長昇格・仕上課復帰'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s02', lastName:'佐藤',  firstName:'花子',   lastNameKana:'さとう',  firstNameKana:'はなこ',   gender:'女性', birthDate:'1990-07-22', ageApprox:null, hireDate:'2013-04-01', attribute:'地域系', status:'在籍', hireType:'新卒', course:'事務系', education:'大卒',   school:'慶應義塾大学',     eduDept:'商学部 商学科',              tags:['t4','t5'], memo:'', transfers:[{id:'tr04',date:'2013-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','総務部','総務課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s03', lastName:'田中',  firstName:'健二',   lastNameKana:'たなか',  firstNameKana:'けんじ',   gender:'男性', birthDate:'1988-11-08', ageApprox:null, hireDate:'2015-10-01', attribute:'全国系', status:'在籍', hireType:'中途', course:'技術系', education:'修士',   school:'東京工業大学',     eduDept:'理工学研究科 機械工学専攻',  tags:['t2','t5'], memo:'前職：ITエンジニア', transfers:[{id:'tr05',date:'2015-10-01',orgLevels:['日本軽金属㈱','蒲原製造所','技術部','開発課'],note:'中途入社'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s04', lastName:'鈴木',  firstName:'美咲',   lastNameKana:'すずき',  firstNameKana:'みさき',   gender:'女性', birthDate:'1995-05-30', ageApprox:null, hireDate:'2018-04-01', attribute:'全国系', status:'在籍', hireType:'新卒', course:'事務系', education:'大卒',   school:'明治大学',         eduDept:'経営学部 経営学科',          tags:['t3'],      memo:'', transfers:[{id:'tr06',date:'2018-04-01',orgLevels:['日軽産業㈱','東京支店','営業部','営業一課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s05', lastName:'高橋',  firstName:'誠',     lastNameKana:'たかはし',firstNameKana:'まこと',   gender:'男性', birthDate:'1992-09-12', ageApprox:null, hireDate:'2016-07-01', attribute:'地域系', status:'異動', hireType:'中途', course:'技術系', education:'大卒',   school:'立命館大学',       eduDept:'理工学部 情報理工学科',      tags:['t2'],      memo:'2025年4月 東京支店へ異動', transfers:[{id:'tr07',date:'2016-07-01',orgLevels:['日本軽金属㈱','蒲原製造所','技術部','開発課'],note:'中途入社'},{id:'tr08',date:'2025-04-01',orgLevels:['日軽産業㈱','東京支店','営業部','営業一課'],note:'アルミ販売へ出向'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s06', lastName:'伊藤',  firstName:'由美',   lastNameKana:'いとう',  firstNameKana:'ゆみ',     gender:'女性', birthDate:'1987-02-28', ageApprox:null, hireDate:'2012-04-01', attribute:'全国系', status:'退職', hireType:'新卒', course:'事務系', education:'大卒',   school:'青山学院大学',     eduDept:'文学部 日本文学科',          tags:['t4'],      memo:'2024年3月退職', transfers:[{id:'tr09',date:'2012-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','総務部','総務課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s07', lastName:'渡辺',  firstName:'大輔',   lastNameKana:'わたなべ',firstNameKana:'だいすけ', gender:'男性', birthDate:'1996-12-03', ageApprox:null, hireDate:'2019-04-01', attribute:'地域系', status:'在籍', hireType:'新卒', course:'事務系', education:'大卒',   school:'同志社大学',       eduDept:'経済学部 経済学科',          tags:['t3','t5'], memo:'', transfers:[{id:'tr10',date:'2019-04-01',orgLevels:['日軽産業㈱','東京支店','営業部','営業二課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s08', lastName:'中村',  firstName:'さくら', lastNameKana:'なかむら',firstNameKana:'さくら',   gender:'女性', birthDate:'1993-04-17', ageApprox:null, hireDate:'2017-10-01', attribute:'地域系', status:'在籍', hireType:'中途', course:'事務系', education:'専門卒', school:'大阪デザイン専門学校', eduDept:'デザイン学科 グラフィックデザイン科', tags:['t2'], memo:'', transfers:[{id:'tr11',date:'2017-10-01',orgLevels:['日本軽金属㈱','蒲原製造所','技術部','設計課'],note:'中途入社'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s09', lastName:'小林',  firstName:'雄介',   lastNameKana:'こばやし',firstNameKana:'ゆうすけ', gender:'男性', birthDate:'1980-08-25', ageApprox:null, hireDate:'2010-04-01', attribute:'全国系', status:'在籍', hireType:'新卒', course:'事務系', education:'大卒',   school:'一橋大学',         eduDept:'商学部 経営学科',            tags:['t1','t6'], memo:'', transfers:[{id:'tr12',date:'2010-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','成形課'],note:'新卒配属'},{id:'tr13',date:'2016-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','仕上課'],note:'課内異動'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s10', lastName:'加藤',  firstName:'奈々',   lastNameKana:'かとう',  firstNameKana:'なな',     gender:'女性', birthDate:'1998-01-14', ageApprox:null, hireDate:'2021-04-01', attribute:'全国系', status:'在籍', hireType:'新卒', course:'技術系', education:'大卒',   school:'お茶の水女子大学', eduDept:'理学部 化学科',              tags:['t3'],      memo:'', transfers:[{id:'tr14',date:'2021-04-01',orgLevels:['日軽産業㈱','東京支店','営業部','営業一課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s11', lastName:'吉田',  firstName:'修平',   lastNameKana:'よしだ',  firstNameKana:'しゅうへい',gender:'男性', birthDate:'1975-06-09', ageApprox:null, hireDate:'2000-04-01', attribute:'地域系', status:'在籍', hireType:'新卒', course:'技術系', education:'大卒',  school:'京都大学',         eduDept:'工学部 工業化学科',          tags:['t1'],      memo:'最古参メンバー', transfers:[{id:'tr15',date:'2000-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','仕上課'],note:'新卒配属'},{id:'tr16',date:'2010-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','仕上課'],note:'主任昇格'},{id:'tr17',date:'2015-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','仕上課'],note:'係長昇格'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s12', lastName:'山本',  firstName:'恵子',   lastNameKana:'やまもと',firstNameKana:'けいこ',   gender:'女性', birthDate:'1991-10-21', ageApprox:null, hireDate:'2016-04-01', attribute:'地域系', status:'異動', hireType:'新卒', course:'技術系', education:'短大卒', school:'神戸女子短期大学', eduDept:'生活学科 食物栄養専攻',      tags:['t4','t5'], memo:'大阪支社へ異動中', transfers:[{id:'tr18',date:'2016-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','総務部','総務課'],note:'新卒配属'},{id:'tr19',date:'2024-04-01',orgLevels:['日軽産業㈱','大阪支店','営業部','営業一課'],note:'アルミ販売大阪支店へ異動'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s13', lastName:'松本',  firstName:'浩二',   lastNameKana:'まつもと',firstNameKana:'こうじ',   gender:'男性', birthDate:'1994-03-05', ageApprox:null, hireDate:'2018-10-01', attribute:'全国系', status:'在籍', hireType:'中途', course:'技術系', education:'高専卒', school:'松江工業高等専門学校', eduDept:'工学科 機械工学科',         tags:['t2','t5'], memo:'前職：製造業', transfers:[{id:'tr20',date:'2018-10-01',orgLevels:['日本軽金属㈱','蒲原製造所','技術部','設計課'],note:'中途入社'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s14', lastName:'井上',  firstName:'彩',     lastNameKana:'いのうえ',firstNameKana:'あや',     gender:'女性', birthDate:'1997-07-18', ageApprox:null, hireDate:'2020-04-01', attribute:'地域系', status:'在籍', hireType:'新卒', course:'事務系', education:'大卒',   school:'法政大学',         eduDept:'社会学部 社会学科',          tags:['t3'],      memo:'', transfers:[{id:'tr21',date:'2020-04-01',orgLevels:['日軽産業㈱','東京支店','営業部','営業二課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s15', lastName:'木村',  firstName:'剛',     lastNameKana:'きむら',  firstNameKana:'つよし',   gender:'男性', birthDate:'1983-12-30', ageApprox:null, hireDate:'2008-04-01', attribute:'全国系', status:'退職', hireType:'新卒', course:'技術系', education:'修士',   school:'大阪大学',         eduDept:'基礎工学研究科 機能創成専攻', tags:['t1','t6'], memo:'2023年12月退職', transfers:[{id:'tr22',date:'2008-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','技術部','開発課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s16', lastName:'林',    firstName:'真由美', lastNameKana:'はやし',  firstNameKana:'まゆみ',   gender:'女性', birthDate:'1999-04-11', ageApprox:null, hireDate:'2022-04-01', attribute:'地域系', status:'在籍', hireType:'新卒', course:'事務系', education:'大卒',   school:'関西大学',         eduDept:'人間健康学部 人間健康学科',  tags:[],          memo:'', transfers:[{id:'tr23',date:'2022-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','仕上課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s17', lastName:'清水',  firstName:'徹',     lastNameKana:'しみず',  firstNameKana:'とおる',   gender:'男性', birthDate:'1989-09-04', ageApprox:null, hireDate:'2019-07-01', attribute:'全国系', status:'在籍', hireType:'中途', course:'技術系', education:'大卒',   school:'筑波大学',         eduDept:'理工学群 工学システム学類',  tags:['t2'],      memo:'', transfers:[{id:'tr24',date:'2019-07-01',orgLevels:['日本軽金属㈱','蒲原製造所','技術部','開発課'],note:'中途入社'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s18', lastName:'山口',  firstName:'裕美',   lastNameKana:'やまぐち',firstNameKana:'ひろみ',   gender:'女性', birthDate:'1986-05-27', ageApprox:null, hireDate:'2015-04-01', attribute:'地域系', status:'在籍', hireType:'中途', course:'事務系', education:'大卒',   school:'広島大学',         eduDept:'教育学部 学校教育学科',      tags:['t4','t6'], memo:'', transfers:[{id:'tr25',date:'2015-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','総務部','人事課'],note:'中途入社'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s19', lastName:'森',    firstName:'健太郎', lastNameKana:'もり',    firstNameKana:'けんたろう',gender:'男性', birthDate:'2000-02-14', ageApprox:null, hireDate:'2023-04-01', attribute:'地域系', status:'在籍', hireType:'新卒', course:'技術系', education:'大卒',  school:'東北大学',         eduDept:'工学部 化学・バイオ工学科',  tags:['t3'],      memo:'', transfers:[{id:'tr26',date:'2023-04-01',orgLevels:['日本軽金属㈱','蒲原製造所','製造部','仕上課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
    { id:'s20', lastName:'野口',  firstName:'亜希子', lastNameKana:'のぐち',  firstNameKana:'あきこ',   gender:'女性', birthDate:'2001-08-23', ageApprox:null, hireDate:'2024-04-01', attribute:'全国系', status:'在籍', hireType:'新卒', course:'技術系', education:'大卒',   school:'名古屋大学',       eduDept:'情報学部 コンピュータ科学科', tags:[],         memo:'', transfers:[{id:'tr27',date:'2024-04-01',orgLevels:['日軽産業㈱','東京支店','営業部','営業一課'],note:'新卒配属'}], avatarIds:[], activeAvatarIdx:0 },
  ];
  saveDB();
}
