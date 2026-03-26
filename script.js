// ═══════════════════════════════════════════════════════════════
// CONFIG — solo cambiar el SHEET_ID si se mueve el archivo
// ═══════════════════════════════════════════════════════════════
const SHEET_ID  = '1wXQjHUAHEnfTde4xWJujv9xMQOmbGgzaI_27rRnUOQM';
const SHEET_TAB = 'ENTRADAS';       // nombre de la hoja
const API_KEY   = '';               // dejar vacío — se usa exportación pública

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
// FETCH — descarga la hoja como CSV con fallback CORS
// ═══════════════════════════════════════════════════════════════
async function fetchSheetData() {
  const directUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(SHEET_TAB)}`;
  const gvizUrl   = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_TAB)}`;

  // Estrategia 1: fetch directo (funciona cuando se abre como archivo local o desde servidor)
  try {
    const res = await fetch(directUrl, { redirect: 'follow' });
    if (res.ok) {
      const csv = await res.text();
      if (csv && csv.length > 50) return parseCSV(csv);
    }
  } catch(e) { /* CORS bloqueado — intentar proxy */ }

  // Estrategia 2: proxy CORS (funciona desde iframes/previews)
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(gvizUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(gvizUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(gvizUrl)}`,
  ];
  for (const proxy of proxies) {
    try {
      const res = await fetch(proxy);
      if (res.ok) {
        const csv = await res.text();
        if (csv && csv.length > 50 && !csv.includes('<html')) return parseCSV(csv);
      }
    } catch(e) { continue; }
  }
  throw new Error('No se pudo conectar con Google Sheets. Verifica que el Sheet sea público ("Cualquiera con el enlace puede ver").');
}

function parseCSV(csv) {
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('La hoja está vacía o sin datos.');

  // Parse CSV respecting quoted fields
  function parseLine(line) {
    const result = [];
    let current = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { result.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  }

  const headers = parseLine(lines[0]);
  // Normalize headers
  const h = headers.map(h => h.replace(/^"|"$/g,'').trim());

  // Column index map
  const idx = {};
  const COL_MAP = {
    estab:       ['Establecimiento','establecimiento'],
    producto:    ['Producto','producto'],
    codProd:     ['Código Producto','Codigo Producto'],
    servicio:    ['Tipo de Servicio','Servicio'],
    requerida:   ['Cantidad Requerida','Requerida'],
    disponible:  ['Cantidad Disponible','Disponible'],
    noSat:       ['Demanda No Satisfecha','No Satisfecha'],
    cobertura:   ['Cobertura (%)','Cobertura'],
    fecha:       ['Fecha','fecha'],
    obs:         ['Observaciones','observaciones'],
    usuario:     ['Usuario que Registró','Usuario'],
  };
  for (const [key, candidates] of Object.entries(COL_MAP)) {
    for (const c of candidates) {
      const i = h.findIndex(x => x === c);
      if (i !== -1) { idx[key] = i; break; }
    }
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseLine(lines[i]);
    if (!cols.length || !cols[idx.estab || 2]) continue;

    const get = key => idx[key] !== undefined ? (cols[idx[key]] || '').replace(/^"|"$/g,'') : '';
    const getNum = key => parseFloat(get(key).replace(/,/g,'.')) || 0;

    const fechaStr = get('fecha');
    let fecha = null, mes = 'Sin fecha', mesNombre = 'Sin fecha', mesKey = 'Sin fecha';
    if (fechaStr) {
      // Try ISO or various formats
      const d = new Date(fechaStr.replace(/(\d{2})\/(\d{2})\/(\d{4})/,'$3-$2-$1'));
      if (!isNaN(d)) {
        fecha = d;
        mesKey = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
        mesNombre = d.toLocaleDateString('es-PE',{month:'long',year:'numeric'});
      }
    }

    const req  = getNum('requerida');
    const disp = getNum('disponible');
    const noS  = getNum('noSat') || Math.max(0, req - disp);
    const cob  = getNum('cobertura');

    rows.push({
      estab:     get('estab'),
      producto:  get('producto'),
      codProd:   get('codProd'),
      servicio:  get('servicio'),
      requerida: req,
      disponible:disp,
      noSat:     noS,
      cobertura: cob,
      fecha,
      mesKey,
      mesNombre,
      obs:       get('obs'),
      usuario:   get('usuario'),
    });
  }
  return rows.filter(r => r.estab && r.producto);
}

// ═══════════════════════════════════════════════════════════════
// INIT / RELOAD
// ═══════════════════════════════════════════════════════════════
async function reloadData() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');
  document.getElementById('dash-content').innerHTML = `
    <div class="loading-overlay">
      <div class="loader"></div>
      <div class="loading-text">Leyendo hoja "${SHEET_TAB}" desde Google Sheets…</div>
    </div>`;

  try {
    allData = await fetchSheetData();
    if (!allData.length) throw new Error('No se encontraron filas con datos en la hoja.');
    buildPeriodTabs();
    renderAll();
  } catch(err) {
    document.getElementById('dash-content').innerHTML = `
      <div class="error-panel">
        <p>Error al cargar los datos</p>
        <small>${err.message}</small>
        <small style="margin-top:8px;">Verifica que el Google Sheet esté compartido como "Cualquiera con el enlace puede ver".</small>
        <button class="btn-sm" onclick="reloadData()" style="margin-top:16px">↺ Reintentar</button>
      </div>`;
  } finally {
    btn.classList.remove('spinning');
  }
}

// ═══════════════════════════════════════════════════════════════
// PERIOD TABS
// ═══════════════════════════════════════════════════════════════
function buildPeriodTabs() {
  const nav = document.getElementById('period-nav');
  const refreshBtn = nav.querySelector('.nav-refresh');
  nav.innerHTML = '';
  nav.appendChild(refreshBtn);

  // Count per period
  const counts = {};
  allData.forEach(r => { counts[r.mesKey] = (counts[r.mesKey]||0) + 1; });
  const meses = Object.keys(counts).sort();

  // "Todos" tab
  const tabAll = document.createElement('div');
  tabAll.className = 'period-tab' + (currentPeriod === 'todos' ? ' active' : '');
  tabAll.innerHTML = `<span>Todos los períodos</span><span class="tab-badge">${allData.length}</span>`;
  tabAll.onclick = () => setPeriod('todos', tabAll);
  nav.insertBefore(tabAll, refreshBtn);

  const dotColors = ['#6c63ff','#22c55e','#f97316','#3b82f6','#f43f5e','#eab308','#06b6d4','#8b5cf6'];
  meses.forEach((m, i) => {
    const sample = allData.find(r => r.mesKey === m);
    const nombre = sample ? sample.mesNombre : m;
    const tab = document.createElement('div');
    tab.className = 'period-tab' + (currentPeriod === m ? ' active' : '');
    const color = dotColors[i % dotColors.length];
    tab.innerHTML = `
      <div style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></div>
      <span>${nombre}</span>
      <span class="tab-badge">${counts[m]}</span>`;
    tab.onclick = () => setPeriod(m, tab);
    nav.insertBefore(tab, refreshBtn);
  });
}

function setPeriod(p, tabEl) {
  currentPeriod = p;
  document.querySelectorAll('.period-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  page = 1;
  renderAll();
}

function getFiltered() {
  if (currentPeriod === 'todos') return allData;
  return allData.filter(r => r.mesKey === currentPeriod);
}

// ═══════════════════════════════════════════════════════════════
// RENDER ALL
// ═══════════════════════════════════════════════════════════════
function renderAll() {
  filteredData = getFiltered();

  const totalNoSat = filteredData.reduce((s,r)=>s+r.noSat,0);
  const totalReq   = filteredData.reduce((s,r)=>s+r.requerida,0);
  const cobertura  = totalReq > 0 ? (filteredData.reduce((s,r)=>s+r.disponible,0)/totalReq*100) : 0;
  const periodo    = currentPeriod === 'todos' ? 'Todos los períodos' : (filteredData[0]?.mesNombre || currentPeriod);

  document.getElementById('tb-meta').textContent =
    `${periodo} · ${filteredData.length.toLocaleString()} registros · Demanda no sat.: ${totalNoSat.toLocaleString()} u · Cobertura global: ${cobertura.toFixed(1)}%`;

  document.getElementById('footer-txt').textContent =
    `DIRESA Callao · DEMID · Recetas No Atendidas · Fuente: Google Sheets · Período: ${periodo} · ${filteredData.length} registros · Procesado localmente.`;

  // Banner
  renderBanner(cobertura, totalNoSat, filteredData.length);

  // Build HTML
  document.getElementById('dash-content').innerHTML = buildDashHTML();

  // Render sections
  renderKPIs(filteredData);
  renderCharts(filteredData);
  renderAlerts(filteredData);
  populateFilters();
  filterTable();
}

// ═══════════════════════════════════════════════════════════════
// BANNER
// ═══════════════════════════════════════════════════════════════
function renderBanner(cob, noSat, total) {
  const el = document.getElementById('global-banner');
  if (cob < 10) {
    const sinCob = filteredData.filter(r=>r.cobertura===0).length;
    el.style.display = 'block';
    el.innerHTML = `<div class="banner crit">
      <div class="banner-icon">⚠️</div>
      <div>
        <div class="banner-title">Crisis crítica de desabastecimiento — Cobertura global ${cob.toFixed(1)}%</div>
        <div class="banner-body"> Demanda total no atendida: ${noSat.toLocaleString()} unidades. Se requiere acción inmediata en reposición de medicamentos.</div>
      </div></div>`;
  } else if (cob < 50) {
    el.style.display = 'block';
    el.innerHTML = `<div class="banner warn">
      <div class="banner-icon">⚠️</div>
      <div>
        <div class="banner-title">Alerta de abastecimiento — Cobertura ${cob.toFixed(1)}%</div>
        <div class="banner-body">Revisar pedidos pendientes con SISMED y coordinar redistribución entre establecimientos.</div>
      </div></div>`;
  } else {
    el.style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════════
// HTML SCAFFOLD
// ═══════════════════════════════════════════════════════════════
function buildDashHTML() {
  return `
  <div class="main">
    <!-- KPIs -->
    <div>
      <div class="sec-hdr"><span class="sec-title">Indicadores Clave</span><div class="sec-line"></div></div>
      <div class="kpi-grid" id="kpi-grid"></div>
    </div>

    <!-- Fila 1 -->
    <div class="g2">
      <div class="card">
        <div class="card-hdr"><div><div class="card-title">Demanda no satisfecha por establecimiento</div><div class="card-sub">Unidades sin atender — top 12</div></div></div>
        <div class="chart-h320"><canvas id="cEstab"></canvas></div>
      </div>
      <div class="card">
        <div class="card-hdr"><div><div class="card-title">Cobertura por establecimiento (%)</div><div class="card-sub">Porcentaje de atención sobre lo requerido</div></div></div>
        <div class="chart-h320"><canvas id="cCobEstab"></canvas></div>
      </div>
    </div>

    <!-- Fila 2 -->
    <div class="g2">
      <div class="card">
        <div class="card-hdr"><div><div class="card-title">🔴 Alertas críticas</div><div class="card-sub">Productos con cobertura 0% — mayor demanda</div></div></div>
        <div class="alert-scroll" id="alerts-list"></div>
      </div>
      <div class="card">
        <div class="card-hdr"><div><div class="card-title">📈 Top 12 productos — mayor brecha</div><div class="card-sub">Unidades no atendidas</div></div></div>
        <div class="chart-h360"><canvas id="cTopProd"></canvas></div>
      </div>
    </div>

    <!-- Fila 3 -->
    <div class="g3">
      <div class="card">
        <div class="card-hdr"><div><div class="card-title">Distribución por establecimiento</div><div class="card-sub">Proporción de registros</div></div></div>
        <div class="chart-h200"><canvas id="cDonut"></canvas></div>
      </div>
      <div class="card">
        <div class="card-hdr"><div><div class="card-title">Por tipo de servicio</div><div class="card-sub">Registros de no atención</div></div></div>
        <div class="chart-h200"><canvas id="cServicio"></canvas></div>
      </div>
      <div class="card">
        <div class="card-hdr"><div><div class="card-title">Tendencia semanal</div><div class="card-sub">Demanda no satisfecha acumulada</div></div></div>
        <div class="chart-h200"><canvas id="cTendencia"></canvas></div>
      </div>
    </div>

    <!-- Tabla -->
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
            <option value="0">Solo 0%</option>
            <option value="parcial">Parcial</option>
            <option value="completa">Completa</option>
          </select>
          <span class="tbl-count" id="t-count"></span>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr>
              <th onclick="sortTbl('estab')">Establecimiento</th>
              <th onclick="sortTbl('producto')">Producto</th>
              <th onclick="sortTbl('servicio')">Servicio</th>
              <th onclick="sortTbl('requerida')" style="text-align:right">Requerida</th>
              <th onclick="sortTbl('disponible')" style="text-align:right">Disponible</th>
              <th onclick="sortTbl('noSat')" style="text-align:right">No Atendida</th>
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
          <button class="btn-sm" onclick="exportCSV()" style="margin-left:auto">⬇ Exportar CSV</button>
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
  const cobColor   = cob < 10 ? 'c-red' : cob < 50 ? 'c-orange' : 'c-green';
  const p = (a,b) => b ? (a/b*100).toFixed(1)+'%' : '0%';

  const kpis = [
    {lbl:'Productos No satisfechos', val:totalNoSat.toLocaleString(), sub:'unidades sin atender',      icon:'🚫', c:'c-red'},
    {lbl:'Cobertura global', val:cob.toFixed(1)+'%',      sub:`${totalDisp.toLocaleString()} de ${totalReq.toLocaleString()} u`, icon:'📊', c:cobColor},
    //{lbl:'Registros',     val:data.length,                sub:'recetas no atendidas',        icon:'📋', c:'c-cyan'},
    //{lbl:'Sin cobertura', val:sinCob,                     sub:p(sinCob,data.length)+' del total', icon:'🔴', c:'c-red'},
    {lbl:'EESS afectados',val:estabs,                     sub:'establecimientos',             icon:'🏥', c:'c-orange'},
    {lbl:'Productos únicos',val:prods,                    sub:'ítems distintos',              icon:'💊', c:'c-blue'},
    {lbl:'Requerida total',val:totalReq.toLocaleString(), sub:'unidades requeridas',          icon:'📦', c:'c-violet'},
    {lbl:'Disponible total',val:totalDisp.toLocaleString(),sub:'unidades con stock',          icon:'✅', c:'c-green'},
  ];
  document.getElementById('kpi-grid').innerHTML = kpis.map(k=>`
    <div class="kpi ${k.c}">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-lbl">${k.lbl}</div>
      <div class="kpi-val">${k.val}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════════
const baseOpts = (legend=true) => ({
  responsive:true, maintainAspectRatio:false,
  plugins:{
    legend:{display:legend,position:'bottom',labels:{color:'#3d5a73',font:{family:'DM Sans',size:11},padding:12,boxWidth:10}},
    tooltip:{backgroundColor:'#0d2137',borderColor:'rgba(21,101,192,.2)',borderWidth:1,titleColor:'#ffffff',bodyColor:'#90b4c8',padding:11,titleFont:{family:'Space Mono',size:11},bodyFont:{family:'DM Sans',size:12}}
  }
});

function destroyChart(id) { if(charts[id]){try{charts[id].destroy();}catch(e){}delete charts[id];} }

function renderCharts(data) {
  Object.values(charts).forEach(c=>{try{c.destroy();}catch(e){}});
  charts={};

  // Agrupar por establecimiento
  const byEstab = {};
  data.forEach(r=>{
    if(!byEstab[r.estab]) byEstab[r.estab]={noSat:0,requerida:0,disponible:0};
    byEstab[r.estab].noSat     += r.noSat;
    byEstab[r.estab].requerida += r.requerida;
    byEstab[r.estab].disponible+= r.disponible;
  });
  const sortedEstab = Object.entries(byEstab).sort((a,b)=>b[1].noSat-a[1].noSat).slice(0,12);
  const eLabels = sortedEstab.map(([k])=> k.length>28?k.slice(0,26)+'…':k);

  // 1. No satisfecha por EESS
  charts.estab = new Chart(document.getElementById('cEstab'),{
    type:'bar',
    data:{labels:eLabels,datasets:[
      {label:'No satisfecha',data:sortedEstab.map(([,v])=>v.noSat), backgroundColor:'rgba(198,40,40,.75)',borderRadius:4},
      {label:'Disponible',   data:sortedEstab.map(([,v])=>v.disponible), backgroundColor:'rgba(46,125,50,.6)',borderRadius:4}
    ]},
    options:{...baseOpts(true),indexAxis:'y',
      plugins:{
        legend:{display:true,position:'bottom',labels:{color:'#3d5a73',font:{family:'DM Sans',size:11},padding:12,boxWidth:10}},
        tooltip:{backgroundColor:'#0d2137',borderColor:'rgba(21,101,192,.2)',borderWidth:1,titleColor:'#ffffff',bodyColor:'#90b4c8',padding:11,titleFont:{family:'Space Mono',size:11},bodyFont:{family:'DM Sans',size:12}},
        datalabels:{display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,color:'#0d2137',anchor:'end',align:'end',font:{size:9,family:'Space Mono'},formatter:v=>v>0?v.toLocaleString('es-PE'):''}
      },
      scales:{
        x:{grid:{color:'rgba(21,101,192,.08)'},ticks:{color:'#5a7490',font:{size:9}}},
        y:{grid:{display:false},ticks:{color:'#0d2137',font:{size:9}}}
      }
    }
  });

  // 2. Cobertura por EESS
  const cobData = sortedEstab.map(([,v])=> v.requerida>0 ? parseFloat((v.disponible/v.requerida*100).toFixed(1)) : 0);
  charts.cobEstab = new Chart(document.getElementById('cCobEstab'),{
    type:'bar',
    data:{labels:eLabels,datasets:[{
      label:'Cobertura %',data:cobData,
      backgroundColor:cobData.map(v=>v<10?'rgba(198,40,40,.75)':v<50?'rgba(216,67,21,.75)':'rgba(46,125,50,.75)'),
      borderRadius:4
    }]},
    options:{...baseOpts(false),indexAxis:'y',
      plugins:{
        legend:{display:false},
        tooltip:{backgroundColor:'#0d2137',borderColor:'rgba(21,101,192,.2)',borderWidth:1,titleColor:'#ffffff',bodyColor:'#90b4c8',padding:11},
        datalabels:{display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,color:'#0d2137',anchor:'end',align:'end',font:{size:9,family:'Space Mono'},formatter:v=>v>0?v.toFixed(1)+'%':''}
      },
      scales:{
        x:{max:100,grid:{color:'rgba(21,101,192,.08)'},ticks:{color:'#5a7490',font:{size:9},callback:v=>v+'%'}},
        y:{grid:{display:false},ticks:{color:'#0d2137',font:{size:9}}}
      }
    }
  });

  // 3. Donut establecimientos
  const top5E = sortedEstab.slice(0,5);
  const otrosE = sortedEstab.slice(5).reduce((s,[,v])=>s+v.noSat,0);
  charts.donut = new Chart(document.getElementById('cDonut'),{
    type:'doughnut',
    data:{
      labels:[...top5E.map(([k])=>k.length>18?k.slice(0,16)+'…':k), ...(otrosE>0?['Otros']:[])],
      datasets:[{
        data:[...top5E.map(([,v])=>v.noSat), ...(otrosE>0?[otrosE]:[])],
        backgroundColor:['#c62828','#1565c0','#d84315','#2e7d32','#00695c','#546e7a'],
        borderWidth:2,borderColor:'#ffffff',hoverOffset:6
      }]
    },
    options:{...baseOpts(),cutout:'62%',
      plugins:{
        legend:{display:true,position:'bottom',labels:{color:'#3d5a73',font:{family:'DM Sans',size:11},padding:12,boxWidth:10}},
        tooltip:{
          backgroundColor:'#0d2137',borderColor:'rgba(21,101,192,.2)',borderWidth:1,titleColor:'#ffffff',bodyColor:'#90b4c8',padding:11,
          callbacks:{
            label:ctx=>{
              const total=ctx.dataset.data.reduce((a,b)=>a+b,0);
              const pct=total>0?(ctx.parsed/total*100).toFixed(1):'0';
              return ` ${ctx.label}: ${ctx.parsed.toLocaleString('es-PE')} u (${pct}%)`;
            }
          }
        }
      }
    }
  });

  // 4. Por servicio
  const bySvc = {};
  data.forEach(r=>{ bySvc[r.servicio]=(bySvc[r.servicio]||0)+1; });
  const topSvc = Object.entries(bySvc).sort((a,b)=>b[1]-a[1]).slice(0,8);
  charts.servicio = new Chart(document.getElementById('cServicio'),{
    type:'bar',
    data:{labels:topSvc.map(([k])=>k.length>20?k.slice(0,18)+'…':k),datasets:[{
      data:topSvc.map(([,v])=>v),
      backgroundColor:'rgba(59,130,246,.7)',borderRadius:4
    }]},
    options:{...baseOpts(false),indexAxis:'y',
      plugins:{
        legend:{display:false},
        tooltip:{backgroundColor:'#0d2137',borderColor:'rgba(21,101,192,.2)',borderWidth:1,titleColor:'#ffffff',bodyColor:'#90b4c8',padding:11,callbacks:{label:ctx=>{const total=topSvc.reduce((a,[,v])=>a+v,0);const pct=total>0?(ctx.parsed.x/total*100).toFixed(1):'0';return ` ${ctx.parsed.x} registros (${pct}%)`}}},
        datalabels:{display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,color:'#0d2137',anchor:'end',align:'end',font:{size:9,family:'Space Mono'},formatter:(v,ctx)=>{const total=topSvc.reduce((a,[,b])=>a+b,0);return total>0?`${v} (${(v/total*100).toFixed(0)}%)`:`${v}`}}
      },
      scales:{
        x:{grid:{color:'rgba(21,101,192,.08)'},ticks:{color:'#5a7490',font:{size:9}}},
        y:{grid:{display:false},ticks:{color:'#0d2137',font:{size:9}}}
      }
    }
  });

  // 5. Tendencia semanal
  const bySemana = {};
  data.filter(r=>r.fecha).forEach(r=>{
    const d = new Date(r.fecha);
    const day = d.getDay();
    const diff = d.getDate()-day+(day===0?-6:1);
    const lunes = new Date(new Date(r.fecha).setDate(diff));
    const key = lunes.toISOString().slice(0,10);
    bySemana[key] = (bySemana[key]||0) + r.noSat;
  });
  const semanas = Object.keys(bySemana).sort();
  charts.tend = new Chart(document.getElementById('cTendencia'),{
    type:'line',
    data:{
      labels:semanas.map(s=>{ const d=new Date(s); return d.toLocaleDateString('es-PE',{day:'2-digit',month:'short'}); }),
      datasets:[{
        label:'No satisfecha',data:semanas.map(s=>bySemana[s]),
        borderColor:'#c62828',backgroundColor:'rgba(198,40,40,.08)',
        fill:true,tension:.3,pointRadius:4,borderWidth:2,pointBackgroundColor:'#c62828'
      }]
    },
    options:{...baseOpts(false),
      plugins:{
        legend:{display:false},
        tooltip:{backgroundColor:'#0d2137',borderColor:'rgba(21,101,192,.2)',borderWidth:1,titleColor:'#ffffff',bodyColor:'#90b4c8',padding:11},
        datalabels:{display:true,color:'#c62828',anchor:'end',align:'top',font:{size:9,family:'Space Mono',weight:'bold'},formatter:v=>v.toLocaleString('es-PE')}
      },
      scales:{
        x:{grid:{color:'rgba(21,101,192,.08)'},ticks:{color:'#5a7490',font:{size:9},autoSkip:true,maxRotation:45}},
        y:{grid:{color:'rgba(21,101,192,.08)'},ticks:{color:'#5a7490',font:{size:9}}}
      }
    }
  });

  // 6. Top 12 productos
  const byProd = {};
  data.forEach(r=>{
    if(!byProd[r.producto]) byProd[r.producto]=0;
    byProd[r.producto]+=r.noSat;
  });
  const topProd = Object.entries(byProd).sort((a,b)=>b[1]-a[1]).slice(0,12);
  const maxP = Math.max(...topProd.map(([,v])=>v));
  charts.top = new Chart(document.getElementById('cTopProd'),{
    type:'bar',
    data:{labels:topProd.map(([k])=>k.length>45?k.slice(0,43)+'…':k),datasets:[{
      data:topProd.map(([,v])=>v),
      backgroundColor:topProd.map(([,v])=>v>maxP*.5?'rgba(198,40,40,.8)':v>maxP*.15?'rgba(216,67,21,.8)':'rgba(21,101,192,.8)'),
      borderRadius:4
    }]},
    options:{...baseOpts(false),indexAxis:'y',
      plugins:{
        legend:{display:false},
        tooltip:{backgroundColor:'#0d2137',borderColor:'rgba(21,101,192,.2)',borderWidth:1,titleColor:'#ffffff',bodyColor:'#90b4c8',padding:11,callbacks:{label:ctx=>{const total=topProd.reduce((a,[,v])=>a+v,0);const pct=total>0?(ctx.parsed.x/total*100).toFixed(1):'0';return ` ${ctx.parsed.x.toLocaleString('es-PE')} u (${pct}% del total)`}}},
        datalabels:{display:ctx=>ctx.dataset.data[ctx.dataIndex]>0,color:'#0d2137',anchor:'end',align:'end',font:{size:9,family:'Space Mono'},formatter:(v,ctx)=>{const total=topProd.reduce((a,[,b])=>a+b,0);return total>0?`${v.toLocaleString('es-PE')} (${(v/total*100).toFixed(0)}%)`:`${v}`}}
      },
      scales:{
        x:{grid:{color:'rgba(21,101,192,.08)'},ticks:{color:'#5a7490',font:{size:9}}},
        y:{grid:{display:false},ticks:{color:'#0d2137',font:{size:9}}}
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════
function renderAlerts(data) {
  const crit = data.filter(r=>r.cobertura===0).sort((a,b)=>b.noSat-a.noSat).slice(0,20);
  const warn = data.filter(r=>r.cobertura>0&&r.cobertura<30).sort((a,b)=>b.noSat-a.noSat).slice(0,10);
  const el = document.getElementById('alerts-list');
  if(!el) return;
  const items = [
    ...crit.map(r=>`
      <div class="a-item crit">
        <div class="a-dot"></div>
        <div style="flex:1;min-width:0">
          <div class="a-name">${r.producto}</div>
          <div class="a-meta">${r.estab} · ${r.servicio}</div>
          <div class="a-meta" style="color:rgba(198,40,40,.8);margin-top:2px">${r.noSat.toLocaleString()} u no atendidas · ${r.fecha?r.fecha.toLocaleDateString('es-PE'):''}</div>
        </div>
        <span class="a-tag">0% cobertura</span>
      </div>`),
    ...warn.map(r=>`
      <div class="a-item warn">
        <div class="a-dot"></div>
        <div style="flex:1;min-width:0">
          <div class="a-name">${r.producto}</div>
          <div class="a-meta">${r.estab} · ${r.servicio}</div>
          <div class="a-meta" style="color:rgba(216,67,21,.8);margin-top:2px">Cobertura ${r.cobertura.toFixed(1)}% · ${r.noSat.toLocaleString()} u no atendidas</div>
        </div>
        <span class="a-tag" style="background:var(--orange-d);color:var(--orange);border:1px solid rgba(249,115,22,.3)">Parcial</span>
      </div>`)
  ];
  el.innerHTML = items.length
    ? items.join('')
    : '<p style="text-align:center;color:var(--muted);padding:20px;font-size:12px">Sin alertas críticas</p>';
}

// ═══════════════════════════════════════════════════════════════
// TABLE
// ═══════════════════════════════════════════════════════════════
function populateFilters() {
  const estabs   = [...new Set(allData.map(r=>r.estab))].sort();
  const servicios= [...new Set(allData.map(r=>r.servicio))].sort();
  const se = document.getElementById('t-estab');
  const ss = document.getElementById('t-servicio');
  if(!se||!ss) return;
  const pe=se.value, ps=ss.value;
  se.innerHTML = '<option value="">Todos los EESS</option>' + estabs.map(e=>`<option value="${e}">${e}</option>`).join('');
  ss.innerHTML = '<option value="">Todos los servicios</option>' + servicios.map(s=>`<option value="${s}">${s}</option>`).join('');
  se.value=pe; ss.value=ps;
}

function filterTable() {
  const s   = (document.getElementById('t-search')?.value||'').toLowerCase();
  const fe  = document.getElementById('t-estab')?.value||'';
  const fs  = document.getElementById('t-servicio')?.value||'';
  const fc  = document.getElementById('t-cob')?.value||'';

  let rows = filteredData.filter(r=>{
    if(fe && r.estab!==fe) return false;
    if(fs && r.servicio!==fs) return false;
    if(fc==='0'     && r.cobertura!==0) return false;
    if(fc==='parcial' && !(r.cobertura>0&&r.cobertura<100)) return false;
    if(fc==='completa'&& r.cobertura<100) return false;
    if(s && !r.producto.toLowerCase().includes(s) && !r.estab.toLowerCase().includes(s)) return false;
    return true;
  });

  rows.sort((a,b)=>{
    const av=a[sortCol], bv=b[sortCol];
    if(typeof av==='number') return (av-bv)*sortDir;
    return String(av||'').localeCompare(String(bv||''))*sortDir;
  });

  const cnt = document.getElementById('t-count');
  const pager = document.getElementById('t-pager');
  const tbody = document.getElementById('t-body');
  if(!cnt||!pager||!tbody) return;

  const totalP = Math.ceil(rows.length/PAGE)||1;
  if(page>totalP) page=totalP;
  const slice = rows.slice((page-1)*PAGE, page*PAGE);
  cnt.textContent = rows.length.toLocaleString() + ' registros';
  pager.textContent = `Pág. ${page} / ${totalP}`;

  const cobPill = v => {
    if(v===0) return `<span class="pill pill-red">0%</span>`;
    if(v<30)  return `<span class="pill pill-orange">${v.toFixed(1)}%</span>`;
    if(v<100) return `<span class="pill pill-yellow">${v.toFixed(1)}%</span>`;
    return `<span class="pill pill-green">${v.toFixed(1)}%</span>`;
  };
  const barNoSat = v => {
    const maxV = Math.max(...filteredData.map(r=>r.noSat),1);
    const pct = Math.min(v/maxV*80,80);
    const col = v>maxV*.5?'#c62828':v>maxV*.15?'#d84315':'#1565c0';
    return `<div class="prog-row"><div class="prog-bar"><div class="prog-fill" style="width:${pct}px;background:${col}"></div></div><span class="prog-val">${v.toLocaleString()}</span></div>`;
  };

  tbody.innerHTML = slice.length
    ? slice.map(r=>`<tr>
        <td style="font-size:11px;max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${r.estab}">${r.estab}</td>
        <td style="font-size:11px;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${r.producto}">${r.producto}</td>
        <td style="font-size:10px;color:var(--muted2);max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.servicio}</td>
        <td class="mono" style="text-align:right">${r.requerida.toLocaleString()}</td>
        <td class="mono" style="text-align:right">${r.disponible.toLocaleString()}</td>
        <td style="min-width:120px">${barNoSat(r.noSat)}</td>
        <td>${cobPill(r.cobertura)}</td>
        <td class="mono" style="font-size:10px">${r.fecha?r.fecha.toLocaleDateString('es-PE'):'-'}</td>
      </tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--muted)">Sin resultados</td></tr>';
}

function sortTbl(col) {
  if(sortCol===col) sortDir*=-1; else{sortCol=col;sortDir=-1;}
  filterTable();
}
function prevPage(){if(page>1){page--;filterTable();}}
function nextPage(){const tp=Math.ceil(filteredData.length/PAGE);if(page<tp){page++;filterTable();}}

// ═══════════════════════════════════════════════════════════════
// CSV EXPORT
// ═══════════════════════════════════════════════════════════════
function exportCSV() {
  const cols=['estab','producto','servicio','requerida','disponible','noSat','cobertura','fecha','obs','usuario'];
  const heads=['Establecimiento','Producto','Servicio','Requerida','Disponible','No Atendida','Cobertura %','Fecha','Observaciones','Usuario'];
  const rows=[heads.join(','), ...filteredData.map(r=>
    cols.map(c=>`"${String(r[c] instanceof Date ? r[c].toLocaleDateString('es-PE') : (r[c]||'')).replace(/"/g,'""')}"`).join(',')
  )];
  const blob=new Blob(['\uFEFF'+rows.join('\n')],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`RecetasNA_${currentPeriod}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════
window.onload = reloadData;
