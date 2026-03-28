// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const SHEET_ID  = '1wXQjHUAHEnfTde4xWJujv9xMQOmbGgzaI_27rRnUOQM';
const SHEET_TAB = 'ENTRADAS';

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
Chart.register(ChartDataLabels);
let allData      = [];
let filteredData = [];
let currentPeriod= 'todos';
let charts       = {};
let sortCol = 'noSat', sortDir = -1;
let page = 1;
const PAGE = 50;

// ═══════════════════════════════════════════════════════════════
// FETCH CSV con fallback CORS
// ═══════════════════════════════════════════════════════════════
async function fetchSheetData() {
  const directUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(SHEET_TAB)}`;
  const gvizUrl   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;
  try {
    const res = await fetch(directUrl, { redirect: 'follow' });
    if (res.ok) { const csv = await res.text(); if (csv && csv.length > 50) return parseCSV(csv); }
  } catch(e) {}
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(gvizUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(gvizUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(gvizUrl)}`,
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy);
      if (res.ok) { const csv = await res.text(); if (csv && csv.length > 50 && !csv.includes('<html')) return parseCSV(csv); }
    } catch(e) { continue; }
  }
  throw new Error('No se pudo conectar con Google Sheets. Verifica que el Sheet sea público.');
}

function parseCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('La hoja está vacía o sin datos.');
  function parseLine(line) {
    const result = []; let current = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { result.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    result.push(current.trim()); return result;
  }
  const h = parseLine(lines[0]).map(h => h.replace(/^"|"$/g,'').trim());
  const idx = {};
  const COL_MAP = {
    estab:     ['Establecimiento','establecimiento'],
    producto:  ['Producto','producto'],
    servicio:  ['Tipo de Servicio','Servicio'],
    requerida: ['Cantidad Requerida','Requerida'],
    disponible:['Cantidad Disponible','Disponible'],
    noSat:     ['Demanda No Satisfecha','No Satisfecha'],
    cobertura: ['Cobertura (%)','Cobertura'],
    fecha:     ['Fecha','fecha'],
    obs:       ['Observaciones','observaciones'],
    usuario:   ['Usuario que Registró','Usuario'],
  };
  for (const [key, candidates] of Object.entries(COL_MAP)) {
    for (const c of candidates) { const i = h.findIndex(x => x === c); if (i !== -1) { idx[key] = i; break; } }
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (!cols.length || !cols[idx.estab || 2]) continue;
    const get    = key => idx[key] !== undefined ? (cols[idx[key]] || '').replace(/^"|"$/g,'') : '';
    const getNum = key => parseFloat(get(key).replace(/,/g,'.')) || 0;
    const fechaStr = get('fecha');
    let fecha = null, mesKey = 'Sin fecha', mesNombre = 'Sin fecha';
    if (fechaStr) {
      const d = new Date(fechaStr.replace(/(\d{2})\/(\d{2})\/(\d{4})/,'$3-$2-$1'));
      if (!isNaN(d)) { fecha = d; mesKey = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); mesNombre = d.toLocaleDateString('es-PE',{month:'long',year:'numeric'}); }
    }
    const req = getNum('requerida'), disp = getNum('disponible');
    const noS = getNum('noSat') || Math.max(0, req - disp);
    const cob = getNum('cobertura');
    rows.push({ estab:get('estab'), producto:get('producto'), servicio:get('servicio'), requerida:req, disponible:disp, noSat:noS, cobertura:cob, fecha, mesKey, mesNombre, obs:get('obs'), usuario:get('usuario') });
  }
  return rows.filter(r => r.estab && r.producto);
}

// ═══════════════════════════════════════════════════════════════
// INIT / RELOAD
// ═══════════════════════════════════════════════════════════════
async function reloadData() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  document.getElementById('dash-content').innerHTML = `<div class="loading-overlay"><div class="loader"></div><div class="loading-text">Leyendo datos desde Google Sheets…</div></div>`;
  try {
    allData = await fetchSheetData();
    if (!allData.length) throw new Error('No se encontraron filas con datos.');
    buildPeriodTabs();
    renderAll();
  } catch(err) {
    document.getElementById('dash-content').innerHTML = `<div class="error-panel"><p>Error al cargar los datos</p><small>${err.message}</small><small>Verifica que el Google Sheet esté compartido como "Cualquiera con el enlace puede ver".</small><button class="btn-sm" onclick="reloadData()" style="margin-top:20px;background:#1565c0;border-color:#1565c0;">↺ Reintentar</button></div>`;
  } finally { btn.classList.remove('spinning'); }
}

// ═══════════════════════════════════════════════════════════════
// PERIOD TABS
// ═══════════════════════════════════════════════════════════════
function buildPeriodTabs() {
  const nav = document.getElementById('period-nav');
  const refreshBtn = nav.querySelector('.nav-refresh');
  nav.innerHTML = ''; nav.appendChild(refreshBtn);
  const counts = {};
  allData.forEach(r => { counts[r.mesKey] = (counts[r.mesKey]||0) + 1; });
  const meses = Object.keys(counts).sort();
  const tabAll = document.createElement('div');
  tabAll.className = 'period-tab' + (currentPeriod === 'todos' ? ' active' : '');
  tabAll.innerHTML = `<span>Todos los períodos</span><span class="tab-badge">${allData.length}</span>`;
  tabAll.onclick = () => setPeriod('todos', tabAll);
  nav.insertBefore(tabAll, refreshBtn);
  const dotColors = ['#1565c0','#22c55e','#f97316','#a78bfa','#f59e0b','#06b6d4'];
  meses.forEach((m, i) => {
    const sample = allData.find(r => r.mesKey === m);
    const nombre = sample ? sample.mesNombre : m;
    const tab = document.createElement('div');
    tab.className = 'period-tab' + (currentPeriod === m ? ' active' : '');
    tab.innerHTML = `<div style="width:8px;height:8px;border-radius:50%;background:${dotColors[i%dotColors.length]};flex-shrink:0"></div><span>${nombre}</span><span class="tab-badge">${counts[m]}</span>`;
    tab.onclick = () => setPeriod(m, tab);
    nav.insertBefore(tab, refreshBtn);
  });
}
function setPeriod(p, tabEl) {
  currentPeriod = p;
  document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active'); page = 1; renderAll();
}
function getFiltered() {
  return currentPeriod === 'todos' ? allData : allData.filter(r => r.mesKey === currentPeriod);
}

// ═══════════════════════════════════════════════════════════════
// RENDER ALL
// ═══════════════════════════════════════════════════════════════
function renderAll() {
  filteredData = getFiltered();
  const totalNoSat = filteredData.reduce((s,r)=>s+r.noSat,0);
  const totalReq   = filteredData.reduce((s,r)=>s+r.requerida,0);
  const totalDisp  = filteredData.reduce((s,r)=>s+r.disponible,0);
  const cobertura  = totalReq > 0 ? (totalDisp/totalReq*100) : 0;
  const periodo    = currentPeriod === 'todos' ? 'Todos los períodos' : (filteredData[0]?.mesNombre || currentPeriod);

  document.getElementById('tb-meta').textContent =
    `${periodo} · ${filteredData.length.toLocaleString()} registros · ${totalNoSat.toLocaleString()} u sin atender · Cobertura global: ${cobertura.toFixed(1)}%`;
  document.getElementById('footer-txt').textContent =
    `DIRESA Callao · DEMID · Productos No Atendidos · Período: ${periodo} · ${filteredData.length} registros`;

  renderBanner(cobertura, totalNoSat);
  document.getElementById('dash-content').innerHTML = buildDashHTML();
  renderKPIs(filteredData);
  renderGauge(cobertura, totalDisp, totalReq);
  renderEstabChart(filteredData);
  renderTopProds(filteredData);
  renderAlerts(filteredData);
  renderServicioChart(filteredData);
  populateFilters();
  filterTable();
}

// ═══════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════
function renderBanner(cob, noSat) {
  const el = document.getElementById('global-banner');
  if (cob < 10) {
    el.style.display = 'block';
    el.innerHTML = `<div class="banner crit"><div class="banner-icon">🚨</div><div><div class="banner-title">Crisis crítica — Cobertura global ${cob.toFixed(1)}%</div><div class="banner-body">${noSat.toLocaleString()} unidades no atendidas. Se requiere reposición urgente de medicamentos en los establecimientos.</div></div></div>`;
  } else if (cob < 50) {
    el.style.display = 'block';
    el.innerHTML = `<div class="banner warn"><div class="banner-icon">⚠️</div><div><div class="banner-title">Alerta de abastecimiento — Cobertura ${cob.toFixed(1)}%</div><div class="banner-body">Revisar pedidos con SISMED y coordinar redistribución entre establecimientos.</div></div></div>`;
  } else { el.style.display = 'none'; }
}

// ═══════════════════════════════════════════════════════════════
// HTML SCAFFOLD — limpio para exposición a gerencia
// ═══════════════════════════════════════════════════════════════
function buildDashHTML() {
  return `
  <div class="main">

    <!-- ── FILA 1: KPIs ── -->
    <div>
      <div class="sec-hdr"><span class="sec-title">Resumen Ejecutivo</span><div class="sec-line"></div></div>
      <div class="kpi-grid" id="kpi-grid"></div>
    </div>

    <!-- ── FILA 2: Gauge cobertura + Explicación + Por establecimiento ── -->
    <div class="g-wide">

      <div class="card">
        <div class="card-hdr">
          <div>
            <div class="card-title">Brecha por Establecimiento</div>
            <div class="card-sub">Unidades requeridas vs. disponibles — top 10</div>
          </div>
          <span class="card-tag" id="tag-estab">—</span>
        </div>
        <div class="chart-h340"><canvas id="cEstab"></canvas></div>
      </div>

      <div style="display:flex;flex-direction:column;gap:16px;">
        <!-- Gauge -->
        <div class="card" style="flex:0 0 auto;">
          <div class="card-hdr">
            <div>
              <div class="card-title">Cobertura Global</div>
              <div class="card-sub">¿Cuánto se pudo atender del total requerido?</div>
            </div>
          </div>
          <div class="gauge-wrap" id="gauge-wrap"></div>
        </div>
        <!-- Explicación -->
        <div class="explainer">
          <div class="explainer-icon">💡</div>
          <div>
            <div class="explainer-title">¿Qué significa la cobertura?</div>
            <div class="explainer-body">
              Cuando un paciente requiere un medicamento y el establecimiento <strong>no tiene suficiente stock</strong>,
              se registra como "no atendido". La cobertura indica qué porcentaje de esa demanda
              <strong>sí pudo atenderse parcialmente</strong> con el stock disponible.
              <br><br>
              Ejemplo: Se requieren <strong>100 unidades</strong> — hay stock de <strong>40</strong>.
              Se atienden 40 y <strong>60 quedan sin atender</strong>. Cobertura = 40%.
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── FILA 3: Top productos + Alertas críticas ── -->
    <div class="g2">
      <div class="card">
        <div class="card-hdr">
          <div>
            <div class="card-title">Top 10 Productos con Mayor Brecha</div>
            <div class="card-sub">Ordenados por unidades sin atender</div>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="top-table">
            <thead><tr>
              <th style="width:28px">#</th>
              <th>Producto</th>
              <th>Sin atender</th>
              <th>Estado</th>
            </tr></thead>
            <tbody id="top-tbody"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-hdr">
          <div>
            <div class="card-title">🔴 Alertas Críticas</div>
            <div class="card-sub">Productos con 0% de cobertura (nada se pudo atender)</div>
          </div>
        </div>
        <div class="alert-list" id="alerts-list"></div>
      </div>
    </div>

    <!-- ── FILA 4: Por tipo de servicio ── -->
    <div class="card">
      <div class="card-hdr">
        <div>
          <div class="card-title">Distribución por Tipo de Servicio</div>
          <div class="card-sub">¿En qué servicios se concentra la brecha de atención?</div>
        </div>
      </div>
      <div class="chart-h220"><canvas id="cServicio"></canvas></div>
    </div>

    <!-- ── TABLA DETALLE ── -->
    <div>
      <div class="sec-hdr"><span class="sec-title">Detalle Completo</span><div class="sec-line"></div></div>
      <div class="tbl-card">
        <div class="tbl-bar">
          <span class="tbl-bar-title">Registros</span>
          <input class="inp" type="text" id="t-search" placeholder="🔍 Buscar producto o establecimiento…" style="width:240px" oninput="filterTable()">
          <select class="inp" id="t-estab" onchange="filterTable()"><option value="">Todos los EESS</option></select>
          <select class="inp" id="t-servicio" onchange="filterTable()"><option value="">Todos los servicios</option></select>
          <select class="inp" id="t-cob" onchange="filterTable()">
            <option value="">Toda cobertura</option>
            <option value="0">Sin cobertura (0%)</option>
            <option value="parcial">Cobertura parcial</option>
          </select>
          <span class="tbl-count" id="t-count"></span>
          <button class="btn-sm" onclick="exportCSV()">⬇ CSV</button>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th onclick="sortTbl('estab')">Establecimiento</th>
              <th onclick="sortTbl('producto')">Producto</th>
              <th onclick="sortTbl('servicio')">Servicio</th>
              <th onclick="sortTbl('requerida')" style="text-align:right">Requerida</th>
              <th onclick="sortTbl('disponible')" style="text-align:right">Disponible</th>
              <th onclick="sortTbl('noSat')">Sin atender</th>
              <th onclick="sortTbl('cobertura')">Cobertura</th>
              <th onclick="sortTbl('fecha')">Fecha</th>
            </tr></thead>
            <tbody id="t-body"></tbody>
          </table>
        </div>
        <div class="tbl-pager">
          <button class="btn-sm" onclick="prevPage()">← Anterior</button>
          <span id="t-pager"></span>
          <button class="btn-sm" onclick="nextPage()">Siguiente →</button>
        </div>
      </div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════════
function renderKPIs(data) {
  const totalNoSat = data.reduce((s,r)=>s+r.noSat,0);
  const totalReq   = data.reduce((s,r)=>s+r.requerida,0);
  const totalDisp  = data.reduce((s,r)=>s+r.disponible,0);
  const cob        = totalReq > 0 ? (totalDisp/totalReq*100) : 0;
  const sinCob     = data.filter(r=>r.cobertura===0).length;
  const estabs     = new Set(data.map(r=>r.estab)).size;
  const prods      = new Set(data.map(r=>r.producto)).size;
  const cobColor   = cob < 10 ? 'c-red' : cob < 50 ? 'c-orange' : cob < 80 ? 'c-yellow' : 'c-green';

  const kpis = [
    {lbl:'Unidades sin atender', val:totalNoSat.toLocaleString('es-PE'), sub:'demanda no satisfecha total',  icon:'🚫', c:'c-red'},
    {lbl:'Cobertura global',     val:cob.toFixed(1)+'%',                  sub:`${totalDisp.toLocaleString()} de ${totalReq.toLocaleString()} u atendidas`, icon:'📊', c:cobColor},
    {lbl:'EESS afectados',       val:estabs,                               sub:'establecimientos con brecha', icon:'🏥', c:'c-orange'},
    {lbl:'Productos únicos',     val:prods,                                sub:'medicamentos distintos',      icon:'💊', c:'c-blue'},
   // {lbl:'Sin cobertura (0%)',   val:sinCob,                               sub:'registros sin ningún stock',  icon:'🔴', c:'c-red'},
    {lbl:'Stock disponible',     val:totalDisp.toLocaleString('es-PE'),    sub:'unidades entregadas',         icon:'✅', c:'c-green'},
  ];

  document.getElementById('kpi-grid').innerHTML = kpis.map(k=>`
    <div class="kpi ${k.c}">
      <span class="kpi-icon">${k.icon}</span>
      <div class="kpi-lbl">${k.lbl}</div>
      <div class="kpi-val">${k.val}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// GAUGE SVG — cobertura visual
// ═══════════════════════════════════════════════════════════════
function renderGauge(cob, disp, req) {
  const el = document.getElementById('gauge-wrap');
  if (!el) return;

  const pct   = Math.min(Math.max(cob, 0), 100);
  const color = pct < 10 ? '#c62828' : pct < 50 ? '#d84315' : pct < 80 ? '#e65100' : '#2e7d32';
  const r = 70, cx = 100, cy = 95;
  const startAngle = -Math.PI;
  const endAngle   = 0;
  const angle      = startAngle + (pct / 100) * Math.PI;

  const toXY = (a, rr) => ({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });

  // Arc path
  const arcPath = (r2, a1, a2, color) => {
    const s = toXY(a1, r2), e = toXY(a2, r2);
    const large = (a2 - a1) > Math.PI ? 1 : 0;
    return `<path d="M ${s.x} ${s.y} A ${r2} ${r2} 0 ${large} 1 ${e.x} ${e.y}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/>`;
  };

  const needle = toXY(angle, r - 8);

  el.innerHTML = `
    <svg class="gauge-svg" viewBox="0 0 200 110" width="200" height="110">
      <!-- Track -->
      ${arcPath(r, startAngle, endAngle, '#e4eaf3')}
      <!-- Fill -->
      ${pct > 0 ? arcPath(r, startAngle, angle, color) : ''}
      <!-- Needle dot -->
      <circle cx="${needle.x}" cy="${needle.y}" r="5" fill="${color}"/>
      <!-- Labels -->
      <text x="${cx}" y="${cy - 12}" class="gauge-label-big" fill="${color}">${pct.toFixed(1)}%</text>
      <text x="${cx}" y="${cy + 8}" class="gauge-label-sub">cobertura global</text>
      <text x="14" y="${cy + 22}" style="font-size:9px;fill:#5a7490;font-family:Space Mono,monospace">0%</text>
      <text x="172" y="${cy + 22}" style="font-size:9px;fill:#5a7490;font-family:Space Mono,monospace">100%</text>
    </svg>
    <div class="gauge-legend">
      <div class="gauge-leg-item"><div class="gauge-leg-dot" style="background:#2e7d32"></div>Atendido: ${disp.toLocaleString('es-PE')} u</div>
      <div class="gauge-leg-item"><div class="gauge-leg-dot" style="background:#c62828"></div>Sin atender: ${(req-disp).toLocaleString('es-PE')} u</div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════════
// GRÁFICO ESTABLECIMIENTOS — stacked bar
// ═══════════════════════════════════════════════════════════════
function renderEstabChart(data) {
  if (charts.estab) { try { charts.estab.destroy(); } catch(e){} }

  const byEstab = {};
  data.forEach(r => {
    if (!byEstab[r.estab]) byEstab[r.estab] = { noSat:0, disponible:0, requerida:0 };
    byEstab[r.estab].noSat     += r.noSat;
    byEstab[r.estab].disponible+= r.disponible;
    byEstab[r.estab].requerida += r.requerida;
  });
  const sorted = Object.entries(byEstab).sort((a,b)=>b[1].noSat-a[1].noSat).slice(0,10);
  const labels = sorted.map(([k]) => k.length > 30 ? k.slice(0,28)+'…' : k);

  const tag = document.getElementById('tag-estab');
  if (tag) tag.textContent = `${sorted.length} EESS`;

  const canvas = document.getElementById('cEstab');
  if (!canvas) return;

  charts.estab = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Atendido',
          data: sorted.map(([,v]) => v.disponible),
          backgroundColor: 'rgba(46,125,50,.75)',
          borderRadius: 4,
          stack: 'total',
        },
        {
          label: 'Sin atender',
          data: sorted.map(([,v]) => v.noSat),
          backgroundColor: 'rgba(198,40,40,.8)',
          borderRadius: 4,
          stack: 'total',
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display:true, position:'bottom', labels:{ color:'#3d5a73', font:{family:'DM Sans',size:11}, padding:14, boxWidth:10 } },
        tooltip: {
          backgroundColor:'#0d2137', borderColor:'rgba(21,101,192,.2)', borderWidth:1,
          titleColor:'#fff', bodyColor:'#90b4c8', padding:11,
          callbacks: {
            label: ctx => {
              const total = sorted[ctx.dataIndex][1].requerida;
              return ` ${ctx.dataset.label}: ${ctx.parsed.x.toLocaleString('es-PE')} u`;
            }
          }
        },
        datalabels: { display: false }
      },
      scales: {
        x: { stacked:true, grid:{color:'rgba(21,101,192,.07)'}, ticks:{color:'#5a7490',font:{size:9}} },
        y: { stacked:true, grid:{display:false}, ticks:{color:'#0d2137',font:{size:10}} }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// TOP 10 PRODUCTOS — tabla visual
// ═══════════════════════════════════════════════════════════════
function renderTopProds(data) {
  const byProd = {};
  data.forEach(r => { byProd[r.producto] = (byProd[r.producto]||0) + r.noSat; });
  const top = Object.entries(byProd).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const maxV = top[0]?.[1] || 1;
  const tbody = document.getElementById('top-tbody');
  if (!tbody) return;

  tbody.innerHTML = top.map(([prod, val], i) => {
    const pct = Math.round((val/maxV)*100);
    const rankClass = i===0?'r1':i===1?'r2':i===2?'r3':'';
    const badgeColor = val > maxV*.5 ? 'badge-red' : val > maxV*.15 ? 'badge-orange' : 'badge-orange';
    return `<tr>
      <td class="rank ${rankClass}">${i+1}</td>
      <td class="prod-name" title="${prod}">${prod}</td>
      <td>
        <div class="nosat-bar-wrap">
          <div class="nosat-bar-track"><div class="nosat-bar-fill" style="width:${pct}%"></div></div>
          <span class="nosat-val">${val.toLocaleString('es-PE')} u</span>
        </div>
      </td>
      <td><span class="badge ${badgeColor}">${val > maxV*.5?'CRÍTICO':'ALTO'}</span></td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// ALERTAS — productos con 0% cobertura (sin duplicados mismo día)
// ═══════════════════════════════════════════════════════════════
function renderAlerts(data) {
  // Deduplicar: mismo producto + estab + fecha → quedarse con el de mayor noSat
  const dedup = (rows) => {
    const map = {};
    rows.forEach(r => {
      const fechaKey = r.fecha ? r.fecha.toISOString().slice(0,10) : 'sin-fecha';
      const key = `${r.producto}||${r.estab}||${fechaKey}`;
      if (!map[key] || r.noSat > map[key].noSat) map[key] = r;
    });
    return Object.values(map);
  };

  const crit = dedup(data.filter(r=>r.cobertura===0)).sort((a,b)=>b.noSat-a.noSat).slice(0,15);
  const warn = dedup(data.filter(r=>r.cobertura>0&&r.cobertura<30)).sort((a,b)=>b.noSat-a.noSat).slice(0,8);
  const el = document.getElementById('alerts-list');
  if (!el) return;
  const items = [
    ...crit.map(r=>`
      <div class="a-item crit">
        <div class="a-dot"></div>
        <div style="flex:1;min-width:0">
          <div class="a-name">${r.producto}</div>
          <div class="a-meta">${r.estab}</div>
          <div class="a-meta" style="color:rgba(198,40,40,.85);margin-top:2px">${r.noSat.toLocaleString()} u sin atender · ${r.fecha?r.fecha.toLocaleDateString('es-PE'):''}</div>
        </div>
        <span class="a-tag">0% atendido</span>
      </div>`),
    ...warn.map(r=>`
      <div class="a-item warn">
        <div class="a-dot"></div>
        <div style="flex:1;min-width:0">
          <div class="a-name">${r.producto}</div>
          <div class="a-meta">${r.estab}</div>
          <div class="a-meta" style="color:rgba(216,67,21,.85);margin-top:2px">${r.cobertura.toFixed(1)}% atendido · ${r.noSat.toLocaleString()} u sin cubrir</div>
        </div>
        <span class="a-tag">Parcial</span>
      </div>`)
  ];
  el.innerHTML = items.length
    ? items.join('')
    : '<p style="text-align:center;color:var(--muted);padding:24px;font-size:12px">✅ Sin alertas críticas</p>';
}

// ═══════════════════════════════════════════════════════════════
// POR SERVICIO
// ═══════════════════════════════════════════════════════════════
function renderServicioChart(data) {
  if (charts.svc) { try { charts.svc.destroy(); } catch(e){} }
  const bySvc = {};
  data.forEach(r => { bySvc[r.servicio] = (bySvc[r.servicio]||0) + r.noSat; });
  const top = Object.entries(bySvc).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const canvas = document.getElementById('cServicio');
  if (!canvas) return;

  const colors = ['#c62828','#d84315','#e65100','#1565c0','#1976d2','#2196f3','#00695c','#2e7d32','#4527a0','#546e7a'];

  charts.svc = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: top.map(([k]) => k.length > 30 ? k.slice(0,28)+'…' : k),
      datasets: [{
        data: top.map(([,v]) => v),
        backgroundColor: top.map((_,i) => colors[i % colors.length] + 'cc'),
        borderRadius: 5,
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:false,
      indexAxis: 'y',
      plugins: {
        legend: { display:false },
        tooltip: {
          backgroundColor:'#0d2137', borderColor:'rgba(21,101,192,.2)', borderWidth:1,
          titleColor:'#fff', bodyColor:'#90b4c8', padding:11,
          callbacks: { label: ctx => ` ${ctx.parsed.x.toLocaleString('es-PE')} unidades sin atender` }
        },
        datalabels: {
          display: true, color:'#0d2137', anchor:'end', align:'end',
          font:{size:9,family:'Space Mono'},
          formatter: v => v.toLocaleString('es-PE')
        }
      },
      scales: {
        x: { grid:{color:'rgba(21,101,192,.07)'}, ticks:{color:'#5a7490',font:{size:9}} },
        y: { grid:{display:false}, ticks:{color:'#0d2137',font:{size:11}} }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// TABLA DETALLE
// ═══════════════════════════════════════════════════════════════
function populateFilters() {
  const estabs    = [...new Set(allData.map(r=>r.estab))].sort();
  const servicios = [...new Set(allData.map(r=>r.servicio))].sort();
  const se = document.getElementById('t-estab');
  const ss = document.getElementById('t-servicio');
  if (!se||!ss) return;
  const pe=se.value, ps=ss.value;
  se.innerHTML = '<option value="">Todos los EESS</option>' + estabs.map(e=>`<option value="${e}">${e}</option>`).join('');
  ss.innerHTML = '<option value="">Todos los servicios</option>' + servicios.map(s=>`<option value="${s}">${s}</option>`).join('');
  se.value=pe; ss.value=ps;
}

function filterTable() {
  const s  = (document.getElementById('t-search')?.value||'').toLowerCase();
  const fe = document.getElementById('t-estab')?.value||'';
  const fs = document.getElementById('t-servicio')?.value||'';
  const fc = document.getElementById('t-cob')?.value||'';

  let rows = filteredData.filter(r => {
    if (fe && r.estab!==fe) return false;
    if (fs && r.servicio!==fs) return false;
    if (fc==='0' && r.cobertura!==0) return false;
    if (fc==='parcial' && !(r.cobertura>0&&r.cobertura<100)) return false;
    if (s && !r.producto.toLowerCase().includes(s) && !r.estab.toLowerCase().includes(s)) return false;
    return true;
  });
  rows.sort((a,b) => {
    const av=a[sortCol], bv=b[sortCol];
    if (typeof av==='number') return (av-bv)*sortDir;
    return String(av||'').localeCompare(String(bv||''))*sortDir;
  });
  const cnt = document.getElementById('t-count');
  const pager = document.getElementById('t-pager');
  const tbody = document.getElementById('t-body');
  if (!cnt||!pager||!tbody) return;
  const totalP = Math.ceil(rows.length/PAGE)||1;
  if (page>totalP) page=totalP;
  const slice = rows.slice((page-1)*PAGE, page*PAGE);
  cnt.textContent = rows.length.toLocaleString() + ' registros';
  pager.textContent = `Pág. ${page} / ${totalP}`;

  const cobPill = v => {
    if (v===0)  return `<span class="pill pill-red">0%</span>`;
    if (v<30)   return `<span class="pill pill-orange">${v.toFixed(1)}%</span>`;
    if (v<100)  return `<span class="pill pill-yellow">${v.toFixed(1)}%</span>`;
    return `<span class="pill pill-green">${v.toFixed(1)}%</span>`;
  };
  const barNoSat = v => {
    const maxV = Math.max(...filteredData.map(r=>r.noSat),1);
    const pct  = Math.min(v/maxV*80,80);
    const col  = v>maxV*.5?'#c62828':v>maxV*.15?'#d84315':'#1565c0';
    return `<div class="prog-row"><div class="prog-bar"><div class="prog-fill" style="width:${pct}px;background:${col}"></div></div><span class="prog-val">${v.toLocaleString()}</span></div>`;
  };

  tbody.innerHTML = slice.length
    ? slice.map(r=>`<tr>
        <td style="font-size:11px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${r.estab}">${r.estab}</td>
        <td style="font-size:11px;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${r.producto}">${r.producto}</td>
        <td style="font-size:10px;color:var(--muted2)">${r.servicio}</td>
        <td class="mono" style="text-align:right">${r.requerida.toLocaleString()}</td>
        <td class="mono" style="text-align:right">${r.disponible.toLocaleString()}</td>
        <td style="min-width:110px">${barNoSat(r.noSat)}</td>
        <td>${cobPill(r.cobertura)}</td>
        <td class="mono" style="font-size:10px">${r.fecha?r.fecha.toLocaleDateString('es-PE'):'-'}</td>
      </tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--muted)">Sin resultados</td></tr>';
}

function sortTbl(col) {
  if (sortCol===col) sortDir*=-1; else { sortCol=col; sortDir=-1; }
  filterTable();
}
function prevPage(){if(page>1){page--;filterTable();}}
function nextPage(){const tp=Math.ceil(filteredData.length/PAGE);if(page<tp){page++;filterTable();}}

// ═══════════════════════════════════════════════════════════════
// EXPORT CSV
// ═══════════════════════════════════════════════════════════════
function exportCSV() {
  const cols  = ['estab','producto','servicio','requerida','disponible','noSat','cobertura','fecha'];
  const heads = ['Establecimiento','Producto','Servicio','Requerida','Disponible','Sin Atender','Cobertura %','Fecha'];
  const rows  = [heads.join(','), ...filteredData.map(r =>
    cols.map(c=>`"${String(r[c] instanceof Date ? r[c].toLocaleDateString('es-PE') : (r[c]||'')).replace(/"/g,'""')}"`).join(',')
  )];
  const blob = new Blob(['\uFEFF'+rows.join('\n')], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `ProductosNA_${currentPeriod}_${new Date().toISOString().slice(0,10)}.csv`; a.click();
}

window.onload = reloadData;
