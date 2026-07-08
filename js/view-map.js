'use strict';
/* ============================================================
   view-map.js — 住所マップビュー
   Leaflet.js + Nominatim OpenStreetMap ジオコーディング
   ・従業員連絡先 (type=address)
   ・会社マスタ node.address
   ・学校マスタ node.address
   を日本地図にピン表示する。
   ============================================================ */

// ── ジオコードキャッシュ（セッション内永続、IndexedDB不使用） ──────
const _geoCache = new Map();
let   _geoLastReq = 0;

/**
 * Nominatim で住所文字列 → {lat, lng} を返す。
 * 失敗時は段階的なフォールバック（建物名の除去など）を行い、最も精度が高い有効住所を抽出する。
 */
async function _geocode(addr) {
  if (!addr) return null;
  const key = addr.trim();
  if (_geoCache.has(key)) return _geoCache.get(key);

  const queries = [key];
  const noSpace = key.replace(/[\s　,，].*$/, '');
  if (noSpace !== key) queries.push(noSpace);
  const noRoom = noSpace.replace(/[0-9０-９A-Za-zＡ-Ｚａ-ｚ]+(?:F|Ｆ|階|号室?)$/i, '');
  if (noRoom !== noSpace && noRoom.length > 2) queries.push(noRoom);
  const noDetail = noRoom.replace(/[0-9０-９\-\－ーの丁目番地号]+$/, '');
  if (noDetail !== noRoom && noDetail !== noSpace && noDetail.length > 2) queries.push(noDetail);
  const matchCity = noDetail.match(/^(.+?[都道府県])(.+?[市区町村])/);
  if (matchCity) {
    const cityLevel = matchCity[1] + matchCity[2];
    if (cityLevel !== noDetail) queries.push(cityLevel);
  }

  const uniqueQueries = [...new Set(queries)].filter(q => q && q.length >= 2);

  for (const q of uniqueQueries) {
    const now  = Date.now();
    const wait = Math.max(0, 1100 - (now - _geoLastReq));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _geoLastReq = Date.now();

    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=jp&accept-language=ja`;
      const res  = await fetch(url, { headers: { 'User-Agent': 'EmployeeMapViewer/1.0' } });
      if (!res.ok) continue;
      const json = await res.json();
      if (json && json.length > 0) {
        const pt = { lat: +json[0].lat, lng: +json[0].lon, display_name: json[0].display_name || '', matched_query: q };
        _geoCache.set(key, pt); // キャッシュのキーはユーザー入力の全文で保持
        return pt;
      }
    } catch {
      // ネットワークエラー等はスキップして次のフォールバックへ
    }
  }

  _geoCache.set(key, null);
  return null;
}

/**
 * 住所文字列のジオコード結果を statusEl DOM 要素に反映する。
 * 一部のみ有効な場合は、有効範囲をマーカーで強調表示してユーザーにフィードバックする。
 */
async function _validateAddressUI(addr, statusEl) {
  if (!statusEl) return;
  const trimmed = addr?.trim();
  if (!trimmed) { statusEl.style.display = 'none'; return; }

  statusEl.className = 'geo-status is-loading';
  statusEl.style.display = '';
  statusEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span class="geo-status-text">住所を確認中...</span>';

  const geo = await _geocode(trimmed);

  if (geo) {
    const matchIdx = trimmed.indexOf(geo.matched_query);
    if (matchIdx >= 0) {
      const before = trimmed.slice(0, matchIdx);
      const matched = trimmed.slice(matchIdx, matchIdx + geo.matched_query.length);
      const after = trimmed.slice(matchIdx + geo.matched_query.length);
      
      if (before === '' && after === '') {
        statusEl.className = 'geo-status is-ok';
        statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i><span class="geo-status-text">${matched}</span>`;
      } else {
        statusEl.className = 'geo-status is-ok is-partial-ok';
        const displayHtml = `<span class="geo-status-text">${before}<mark class="geo-hl" title="地図上の検索有効範囲">${matched}</mark><span class="geo-unmatched">${after}</span></span>`;
        statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i><div class="geo-status-body">${displayHtml}<div class="geo-status-sub"><i class="fa-solid fa-circle-info"></i>ハイライト部分で地図に配置されます（以降は建物名等として保持）</div></div>`;
      }
    } else {
      statusEl.className = 'geo-status is-ok';
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i><span class="geo-status-text">${trimmed}</span>`;
    }
  } else {
    statusEl.className = 'geo-status is-err';
    statusEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span class="geo-status-text">地図に表示できない可能性があります（住所を確認してください）</span>';
  }
}
window.validateAddressUI = _validateAddressUI;

// ── Leaflet マップ / レイヤーグループ ──────────────────────────────
let _map       = null;
let _lgCompany = null;
let _lgSchool  = null;

// フィルター ON/OFF 状態
const _filter = { company: true, school: true };

// 最後にレンダリングしたデータの件数（差分検知用）
let _lastHash = '';

// ── カスタムピンアイコン生成 ─────────────────────────────────────
function _makeIcon(hexColor, faClass) {
  const c = hexColor;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">`,
    `<path d="M14 0C6.27 0 0 6.27 0 14c0 9.33 14 26 14 26S28 23.33 28 14C28 6.27 21.73 0 14 0z" fill="${c}"/>`,
    `<circle cx="14" cy="14" r="8.5" fill="white" opacity="0.95"/>`,
    `</svg>`,
  ].join('');

  return L.divIcon({
    html: `<div style="position:relative;width:28px;height:36px">
             ${svg}
             <i class="${faClass}" style="
               position:absolute;left:50%;top:38%;
               transform:translate(-50%,-50%);
               font-size:10px;color:${c};
             "></i>
           </div>`,
    iconSize:    [28, 36],
    iconAnchor:  [14, 36],
    popupAnchor: [0, -36],
    className:   '',
  });
}

const _icon = {
  company:  () => _makeIcon('#10B981', 'fa-solid fa-building'),
  school:   () => _makeIcon('#F59E0B', 'fa-solid fa-graduation-cap'),
};

// ── 地図初期化 ────────────────────────────────────────────────────
function _initMap() {
  if (_map) return;

  _map = L.map('map-canvas', {
    center: [36.5, 137.5],
    zoom:   5,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(_map);

  _lgCompany  = L.layerGroup().addTo(_map);
  _lgSchool   = L.layerGroup().addTo(_map);

  // 再読み込みボタン
  document.getElementById('btn-map-refresh')?.addEventListener('click', () => {
    _lastHash = '';
    _geoCache.clear();
    _renderMarkers();
  });

  // フィルタートグル
  ['company', 'school'].forEach(k => {
    document.getElementById(`map-filter-${k}`)?.addEventListener('click', () => {
      _filter[k] = !_filter[k];
      _applyFilter();
    });
  });
}

// ── データ収集 ────────────────────────────────────────────────────
function _collectPoints() {
  const pts = { company: [], school: [] };

  // 会社マスタ — address を持つ全ノード（階層ツリーをフラット化して探索）
  const companyNodes = typeof masterFlatten === 'function' ? masterFlatten(DB.masters?.company || []) : (DB.masters?.company || []);
  companyNodes.forEach(node => {
    if (node.address?.trim()) {
      pts.company.push({
        id:    node.id,
        type:  'company',
        addr:  node.address.trim(),
        label: node.name || '会社',
        sub:   node.address.trim(),
        lat:   node.lat,
        lng:   node.lng,
        manualLocation: node.manualLocation
      });
    }
  });

  // 学校マスタ — address を持つ全ノード（階層ツリーをフラット化して探索）
  const schoolNodes = typeof masterFlatten === 'function' ? masterFlatten(DB.masters?.school || []) : (DB.masters?.school || []);
  schoolNodes.forEach(node => {
    if (node.address?.trim()) {
      pts.school.push({
        id:    node.id,
        type:  'school',
        addr:  node.address.trim(),
        label: node.name || '学校',
        sub:   node.address.trim(),
        lat:   node.lat,
        lng:   node.lng,
        manualLocation: node.manualLocation
      });
    }
  });

  return pts;
}

function _hashPts(pts) {
  return JSON.stringify(
    Object.values(pts).map(arr => arr.map(p => p.addr)).flat()
  );
}

// ── プログレス表示 ────────────────────────────────────────────────
function _setProgress(done, total, msg) {
  const wrap = document.getElementById('map-progress-wrap');
  const bar  = document.getElementById('map-progress-bar');
  const lbl  = document.getElementById('map-progress-lbl');
  if (!wrap) return;
  if (total === 0) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  if (bar) bar.style.width = pct + '%';
  if (lbl) lbl.textContent  = msg || `ジオコーディング中… ${done} / ${total}`;
  if (done >= total) {
    setTimeout(() => { if (wrap) wrap.style.display = 'none'; }, 2500);
  }
}

// ── 統計バッジ ────────────────────────────────────────────────────
function _updateStats(pts) {
  ['company', 'school'].forEach(k => {
    const el = document.getElementById(`map-stat-${k}`);
    if (el) el.textContent = pts[k].length;
  });
}

// ── フィルター適用 ────────────────────────────────────────────────
function _applyFilter() {
  if (!_map) return;
  ['company', 'school'].forEach(k => {
    const lg  = k === 'company' ? _lgCompany : _lgSchool;
    const btn = document.getElementById(`map-filter-${k}`);
    if (_filter[k]) { if (!_map.hasLayer(lg)) _map.addLayer(lg); }
    else            { if ( _map.hasLayer(lg)) _map.removeLayer(lg); }
    btn?.classList.toggle('is-active', _filter[k]);
  });
}

// ── 逆ジオコーディング ────────────────────────────────────────────
async function _reverseGeocode(lat, lng) {
  const now = Date.now();
  const wait = Math.max(0, 1100 - (now - _geoLastReq));
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  _geoLastReq = Date.now();
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ja`;
    const res = await fetch(url, { headers: { 'User-Agent': 'EmployeeMapViewer/1.0' } });
    if (!res.ok) return null;
    const json = await res.json();
    if (json && json.display_name) {
      // 日本の住所形式に近付けるため、カンマ区切りを逆順にして結合
      const parts = json.display_name.split(',').map(s => s.trim()).reverse();
      // 国名「日本」などは省略する
      const jpIndex = parts.indexOf('日本');
      if (jpIndex >= 0) parts.splice(jpIndex, 1);
      return parts.join(' ').replace(/〒\d{3}-\d{4}\s*/, '').trim();
    }
  } catch (e) {
    console.warn('Reverse geocode error:', e);
  }
  return null;
}

// ── マーカードラッグ後の住所更新モーダル ─────────────────────────
function _openMapAddressEditModal(pt, newLat, newLng, newAddrObj) {
  let overlay = document.getElementById('map-address-edit-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'map-address-edit-modal';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="modal modal-sm">
        <div class="modal-head">
          <div class="modal-title"><i class="fa-solid fa-map-location-dot" style="color:var(--c-primary)"></i><span>位置情報の更新</span></div>
          <button class="modal-close" data-close="map-address-edit-modal"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="modal-body" style="padding-top:16px;">
          <p style="font-size:12.5px;color:var(--c-text-2);margin-bottom:12px;">マーカーが移動されました。登録する住所を確認・修正して保存してください。</p>
          <div class="fg">
            <div class="flbl">対象ノード</div>
            <div style="font-size:13px; font-weight:700; color:var(--c-text); background:var(--c-surface-2); padding:6px 10px; border-radius:var(--r); border:1px solid var(--c-border);"><span id="map-edit-label"></span></div>
          </div>
          <div class="fg">
            <div class="flbl" style="display:flex; justify-content:space-between;">
              <span>登録する住所<span class="req">*</span></span>
            </div>
            <input type="text" class="finput" id="map-edit-new-addr" value="">
          </div>
          <div id="map-edit-suggest-wrap" style="display:none; margin-top:8px;">
            <div style="font-size:10.5px; color:var(--c-text-3); margin-bottom:4px;"><i class="fa-solid fa-lightbulb" style="color:var(--c-warn); margin-right:4px;"></i>新しい位置から取得した住所候補</div>
            <div id="map-edit-suggest-btn" style="font-size:11.5px; color:var(--c-primary-d); background:var(--c-primary-xl); border:1px dashed var(--c-primary-l, #BFDBFE); padding:6px 10px; border-radius:6px; cursor:pointer; transition:background .15s; line-height:1.4;"></div>
          </div>
          <p class="f-hint" style="margin-top:12px"><i class="fa-solid fa-circle-info"></i> 「保存する」を押すと、指定した位置（座標）がマスタに記憶され、次回からこの位置にピンが表示されます。</p>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-close="map-address-edit-modal">キャンセル</button>
          <button class="btn btn-primary" id="btn-map-edit-save"><i class="fa-solid fa-check"></i>保存する</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.modal-close').addEventListener('click', () => {
      overlay.classList.remove('open');
      _lastHash = ''; _renderMarkers(); // キャンセル時はマーカーを元の位置に戻す
    });
    overlay.querySelector('[data-close="map-address-edit-modal"]').addEventListener('click', () => {
      overlay.classList.remove('open');
      _lastHash = ''; _renderMarkers();
    });
  }

  document.getElementById('map-edit-label').textContent = pt.label;
  const inputEl = document.getElementById('map-edit-new-addr');
  
  // デフォルトは元の住所とする
  inputEl.value = pt.addr;

  // 逆ジオコーディング結果のサジェスト表示
  const suggestWrap = document.getElementById('map-edit-suggest-wrap');
  const suggestBtn = document.getElementById('map-edit-suggest-btn');
  if (newAddrObj && newAddrObj !== pt.addr) {
    suggestWrap.style.display = 'block';
    suggestBtn.textContent = newAddrObj;
    suggestBtn.onclick = () => {
      inputEl.value = newAddrObj;
      inputEl.focus();
    };
  } else {
    suggestWrap.style.display = 'none';
  }

  const saveBtn = document.getElementById('btn-map-edit-save');
  saveBtn.onclick = () => {
    const finalAddr = inputEl.value.trim();
    if (!finalAddr) {
      inputEl.style.borderColor = 'var(--c-danger)';
      setTimeout(() => inputEl.style.borderColor = '', 1500);
      if (typeof toast === 'function') toast('住所を入力してください');
      return;
    }
    
    // マスタデータの更新（座標も保存する）
    let updated = false;
    const updateTarget = (nodes) => {
      for (const n of nodes) {
        if (n.id === pt.id) {
          n.address = finalAddr;
          n.lat = newLat;
          n.lng = newLng;
          n.manualLocation = true;
          updated = true;
          return true;
        }
        if (n.children && updateTarget(n.children)) return true;
      }
      return false;
    };
    updateTarget(DB.masters[pt.type] || []);

    if (updated) {
      if (typeof saveDB === 'function') saveDB();
      // キャッシュも更新しておく
      _geoCache.set(finalAddr, { lat: newLat, lng: newLng, display_name: finalAddr, matched_query: finalAddr });
      _lastHash = ''; // 強制再描画
      overlay.classList.remove('open');
      if (typeof toast === 'function') toast(`「${pt.label}」の位置情報を更新しました`);
      _renderMarkers();
      
      // マスタツリー表示中なら再描画
      if (currentView === 'masters' && typeof renderMasterView === 'function') {
        renderMasterView();
      }
    } else {
      if (typeof toast === 'function') toast('対象ノードが見つかりませんでした');
    }
  };

  overlay.classList.add('open');
}

// ── マーカー描画（非同期） ────────────────────────────────────────
async function _buildLayerGroup(list, lg, iconFn, progressCb) {
  const placed = [];
  for (const pt of list) {
    let geo = null;
    if (pt.manualLocation && pt.lat !== undefined && pt.lng !== undefined) {
      geo = { lat: pt.lat, lng: pt.lng };
      progressCb();
    } else {
      geo = await _geocode(pt.addr);
      progressCb();
    }
    if (!geo) continue;
    const popup = `<div class="map-popup"><strong>${pt.label}</strong><br><span>${pt.sub}</span><br><div style="font-size:9.5px;color:var(--c-primary);margin-top:6px;padding:3px 6px;background:var(--c-primary-xl);border-radius:4px;display:inline-block;"><i class="fa-solid fa-up-down-left-right"></i> ピンをドラッグして位置を修正できます</div></div>`;
    
    const marker = L.marker([geo.lat, geo.lng], { 
      icon: iconFn(),
      draggable: true,
      autoPan: true
    }).bindPopup(popup).addTo(lg);

    marker.on('dragend', async (e) => {
      const pos = e.target.getLatLng();
      const newLat = pos.lat;
      const newLng = pos.lng;

      const wrap = document.getElementById('map-progress-wrap');
      const lbl  = document.getElementById('map-progress-lbl');
      if (wrap) {
        wrap.style.display = '';
        if (lbl) lbl.textContent = '新しい位置の住所を取得中...';
      }

      const revAddr = await _reverseGeocode(newLat, newLng);

      if (wrap) wrap.style.display = 'none';

      _openMapAddressEditModal(pt, newLat, newLng, revAddr);
    });

    placed.push([geo.lat, geo.lng]);
  }
  return placed;
}

async function _renderMarkers() {
  const pts   = _collectPoints();
  const hash  = _hashPts(pts);
  const total = pts.company.length + pts.school.length;

  _updateStats(pts);

  const emptyEl = document.getElementById('map-empty');

  if (total === 0) {
    if (emptyEl) emptyEl.style.display = '';
    _setProgress(0, 0);
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  // データ変化なし → 再ジオコード不要
  if (hash === _lastHash) return;
  _lastHash = hash;

  // レイヤークリア
  _lgCompany.clearLayers();
  _lgSchool.clearLayers();

  _setProgress(0, total, `ジオコーディング中… 0 / ${total}`);
  let done = 0;
  const tick = () => { done++; _setProgress(done, total, `ジオコーディング中… ${done} / ${total}`); };

  // Nominatim 1req/sec 制限遵守のため完全直列処理（Promise.all はレース条件を生む）
  const cpPts = await _buildLayerGroup(pts.company,  _lgCompany,  _icon.company,  tick);
  const spPts = await _buildLayerGroup(pts.school,   _lgSchool,   _icon.school,   tick);

  _applyFilter();

  // 全ピンが収まるように自動フィット
  const allPts = [...cpPts, ...spPts];
  if (allPts.length > 0) {
    try {
      _map.fitBounds(L.latLngBounds(allPts).pad(0.15), { maxZoom: 12 });
    } catch { /* 1点の場合など */ }
  }

  _setProgress(total, total, 'ピン配置完了');
}

// ── エントリポイント ──────────────────────────────────────────────
function renderMapView() {
  _initMap();
  // ビューが display:flex になり、DOMのサイズ計算が完了するのを待つ
  setTimeout(() => {
    if (_map) _map.invalidateSize();
    _renderMarkers();
  }, 50);
}
