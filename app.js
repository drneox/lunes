/* ============================================================
   Seguimiento de Tareas — app sin backend (localStorage)
   ============================================================ */
'use strict';

/* ---------- Constantes ---------- */
const LS_TASKS = 'seguimiento.tasks';
const LS_CONFIG = 'seguimiento.config';
const LS_RESP = 'seguimiento.responsables';

// Estados cerrados/cancelados/riesgo los marca el usuario; en-curso y
// vencida se derivan automáticamente de la fecha compromiso.
const ESTADOS = {
  'en-curso':   { label: '⏳ En Curso',                  auto: true,  color: '#c4c4c4' },
  'riesgo':     { label: '⚠️ En Riesgo de Retraso',     auto: false, color: '#ff642e' },
  'vencida':    { label: '🟡 Con Retraso',              auto: true,  color: '#ffcb00' },
  'tarde':      { label: '🟠 Terminado con Retraso',     auto: false, color: '#fdab3d' },
  'anticipado': { label: '🔵 Terminado Anticipadamente', auto: false, color: '#579bfc' },
  'a-tiempo':   { label: '✅ Terminado a Tiempo',        auto: false, color: '#00c875' },
  'suspendido': { label: '⏸️ Suspendido',               auto: false, color: '#a25ddc' },
  'cancelado':  { label: '❌ Cancelado',                 auto: false, color: '#e2445c' },
};
const ESTADOS_MANUALES = ['riesgo', 'anticipado', 'a-tiempo', 'tarde', 'suspendido', 'cancelado'];

const COMPLEJIDADES = ['baja', 'media', 'alta', 'critica'];
const COMPLEJIDAD_LABEL = { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Muy Alta' };

const DEFAULT_CONFIG = {
  puntosEstado: { anticipado: 15, 'a-tiempo': 10, tarde: 5, vencida: 0, riesgo: 0, suspendido: 0, cancelado: 0, 'en-curso': 0 },
  factorComplejidad: { baja: 1, media: 2, alta: 3, critica: 5 },
  horasComplejidad: { baja: 3, media: 6, alta: 12, critica: null },
  penalidadAplazamiento: 2,
  // El catálogo de puntos extra empieza vacío: cada quien registra las suyas desde la app
  extrasCatalogo: [],
};

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/* ---------- Estado y persistencia ---------- */
let tasks = load(LS_TASKS, []);
// Merge por sección para no perder claves nuevas al actualizar la app
const storedConfig = load(LS_CONFIG, {});
let config = structuredClone(DEFAULT_CONFIG);
if (storedConfig.puntosEstado) config.puntosEstado = Object.assign(config.puntosEstado, storedConfig.puntosEstado);
if (storedConfig.factorComplejidad) config.factorComplejidad = Object.assign(config.factorComplejidad, storedConfig.factorComplejidad);
if (storedConfig.horasComplejidad) {
  // Migración a número fijo: de textos viejos ('0–4 h', 'máx 3 h') se toma la cota superior; 'critica' no lleva número
  for (const c of COMPLEJIDADES) {
    if (c === 'critica') continue;
    const v = storedConfig.horasComplejidad[c];
    if (typeof v === 'number' && v > 0) { config.horasComplejidad[c] = v; continue; }
    const nums = String(v ?? '').match(/\d+(?:\.\d+)?/g);
    if (nums) config.horasComplejidad[c] = Number(nums[nums.length - 1]);
  }
}
if (storedConfig.penalidadAplazamiento != null) config.penalidadAplazamiento = storedConfig.penalidadAplazamiento;
if (Array.isArray(storedConfig.extrasCatalogo)) config.extrasCatalogo = storedConfig.extrasCatalogo;
// Si ya había tareas pero no lista de responsables, se deriva de las tareas (migración)
let responsables = load(LS_RESP, null);
if (responsables === null) {
  responsables = [...new Set(tasks.flatMap(t => [t.responsable, t.apoyo]).filter(Boolean))].sort();
  localStorage.setItem(LS_RESP, JSON.stringify(responsables));
}
let editingId = null;
let sortKey = 'fechaCompromiso';
let sortDir = 1;

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveTasks() { localStorage.setItem(LS_TASKS, JSON.stringify(tasks)); scheduleBackup(); }
function saveConfig() { localStorage.setItem(LS_CONFIG, JSON.stringify(config)); scheduleBackup(); }
function saveResponsables() { localStorage.setItem(LS_RESP, JSON.stringify(responsables)); scheduleBackup(); }

// Agrega un nombre a la lista si no existe (insensible a mayúsculas)
function ensureResponsable(nombre) {
  const n = (nombre || '').trim();
  if (!n) return false;
  if (responsables.some(r => r.toLowerCase() === n.toLowerCase())) return false;
  responsables.push(n);
  responsables.sort((a, b) => a.localeCompare(b));
  return true;
}

/* ---------- Utilidades de fecha ---------- */
function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// Texto de horas por complejidad: número fijo; sin número no se muestra sufijo
function horasLabel(c) {
  const h = config.horasComplejidad[c];
  return h ? `${h} h` : '';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}-${MESES[m - 1]}-${y}`;
}
function monthKey(iso) { return iso ? iso.slice(0, 7) : ''; }
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}

/* ---------- Lógica de negocio ---------- */
function estadoEfectivo(t) {
  if (ESTADOS_MANUALES.includes(t.estado)) {
    // "En riesgo" que se venció pasa a "Con retraso" automáticamente
    if (t.estado === 'riesgo' && t.fechaCompromiso && t.fechaCompromiso < todayISO()) return 'vencida';
    return t.estado;
  }
  if (t.fechaCompromiso && t.fechaCompromiso < todayISO()) return 'vencida';
  return 'en-curso';
}

function puntaje(t) {
  const est = estadoEfectivo(t);
  if (est === 'en-curso' || est === 'riesgo') return null; // pendiente: aún no se evalúa
  const base = (config.puntosEstado[est] || 0) * (config.factorComplejidad[t.complejidad] || 0);
  const pen = (Number(t.vecesAplazada) || 0) * (Number(config.penalidadAplazamiento) || 0);
  return base - pen + (Number(t.puntosExtra) || 0);
}

function sugerirEstadoPorCierre(fechaCierre, fechaCompromiso) {
  if (!fechaCierre || !fechaCompromiso) return null;
  if (fechaCierre < fechaCompromiso) return 'anticipado';
  if (fechaCierre > fechaCompromiso) return 'tarde';
  return 'a-tiempo';
}

// La puntualidad se mide contra la PRIMERA fecha compromiso, no contra la aplazada
function fechaBaseCierre(t) {
  return t?.fechaOriginal || t?.historialAplazamientos?.[0]?.de || t?.fechaCompromiso || '';
}

function desglosePuntaje(t) {
  const est = estadoEfectivo(t);
  const pts = config.puntosEstado[est] || 0;
  const fac = config.factorComplejidad[t.complejidad] || 0;
  const pen = (Number(t.vecesAplazada) || 0) * (Number(config.penalidadAplazamiento) || 0);
  const extra = Number(t.puntosExtra) || 0;
  return { est, pts, fac, pen, extra, total: pts * fac - pen + extra };
}

/* ---------- Toast ---------- */
let toastTimer = null;
function toast(msg, ms = 2600, esError = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('error', esError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Cualquier error de JS se muestra en pantalla (diagnóstico visible)
window.addEventListener('error', (e) => toast('Error: ' + e.message, 8000, true));
window.addEventListener('unhandledrejection', (e) => toast('Error: ' + (e.reason?.message || e.reason), 8000, true));

/* ============================================================
   RENDER: Tareas
   ============================================================ */
function filteredTasks() {
  const q = document.getElementById('filter-text').value.trim().toLowerCase();
  const fResp = document.getElementById('filter-responsable').value;
  const fEst = document.getElementById('filter-estado').value;
  const fComp = document.getElementById('filter-complejidad').value;
  const fMes = document.getElementById('filter-mes').value;

  return tasks.filter(t => {
    if (q && ![t.tarea, t.descripcion, t.comentario, t.responsable].some(v => (v || '').toLowerCase().includes(q))) return false;
    if (fResp && t.responsable !== fResp) return false;
    if (fEst && estadoEfectivo(t) !== fEst) return false;
    if (fComp && t.complejidad !== fComp) return false;
    if (fMes && monthKey(t.fechaCompromiso) !== fMes) return false;
    return true;
  }).sort((a, b) => {
    let va, vb;
    if (sortKey === 'puntaje') { va = puntaje(a); vb = puntaje(b); }
    else if (sortKey === 'estado') { va = estadoEfectivo(a); vb = estadoEfectivo(b); }
    else { va = a[sortKey]; vb = b[sortKey]; }
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb) * sortDir;
    return (va - vb) * sortDir;
  });
}

function renderTasks() {
  const tbody = document.getElementById('tasks-tbody');
  closeInlineForm();
  const list = filteredTasks();
  document.getElementById('tasks-empty').hidden = list.length > 0;
  tbody.innerHTML = '';

  for (const t of list) {
    const est = estadoEfectivo(t);
    const p = puntaje(t);
    const tr = document.createElement('tr');
    tr.dataset.taskId = t.id;

    const tdTarea = document.createElement('td');
    tdTarea.className = 'tarea-cell';
    tdTarea.textContent = t.tarea;
    if (t.comentario) {
      const c = document.createElement('span');
      c.className = 'comment';
      c.textContent = t.comentario;
      tdTarea.appendChild(c);
    }
    tr.appendChild(tdTarea);

    for (const val of [t.responsable, t.apoyo || '—']) {
      const td = document.createElement('td');
      td.textContent = val;
      tr.appendChild(td);
    }

    const tdDep = document.createElement('td');
    tdDep.textContent = t.dependencia ? 'SÍ' : 'NO';
    tr.appendChild(tdDep);

    const tdFecha = document.createElement('td');
    tdFecha.textContent = fmtDate(t.fechaCompromiso);
    const fechaBase = fechaBaseCierre(t);
    const titleParts = [];
    if (fechaBase && fechaBase !== t.fechaCompromiso) titleParts.push(`Original: ${fmtDate(fechaBase)}`);
    if (t.fechaCierre) titleParts.push(`Cerrada: ${fmtDate(t.fechaCierre)}`);
    tdFecha.title = titleParts.join('\n');
    tr.appendChild(tdFecha);

    const tdEst = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${est}`;
    badge.textContent = ESTADOS[est].label;
    tdEst.appendChild(badge);
    tr.appendChild(tdEst);

    const tdComp = document.createElement('td');
    const bComp = document.createElement('span');
    bComp.className = `badge ${t.complejidad}`;
    bComp.textContent = COMPLEJIDAD_LABEL[t.complejidad] || t.complejidad;
    const lblHoras = horasLabel(t.complejidad);
    if (lblHoras) bComp.title = lblHoras;
    tdComp.appendChild(bComp);
    tr.appendChild(tdComp);

    const tdApl = document.createElement('td');
    tdApl.textContent = t.vecesAplazada || 0;
    const histApl = t.historialAplazamientos || [];
    if (histApl.length) {
      tdApl.title = histApl.map(h =>
        `${fmtDate(h.de)} → ${fmtDate(h.a)}${h.motivo ? ' — ' + h.motivo : ''}`
      ).join('\n');
    }
    tr.appendChild(tdApl);

    const tdP = document.createElement('td');
    tdP.className = 'puntaje' + (p != null && p < 0 ? ' neg' : '');
    tdP.textContent = p == null ? '—' : p;
    if (p != null) {
      const d = desglosePuntaje(t);
      tdP.title = `(${d.pts} × ${d.fac}) − ${d.pen} + ${d.extra} = ${d.total}`;
    }
    tr.appendChild(tdP);

    const tdAcc = document.createElement('td');
    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn secondary icon';
    btnEdit.textContent = 'Editar';
    btnEdit.onclick = () => openInlineForm(t.id);
    const btnDone = document.createElement('button');
    btnDone.className = 'btn secondary icon';
    btnDone.textContent = 'Cerrar';
    btnDone.title = 'Marcar como terminada hoy';
    btnDone.onclick = () => quickClose(t.id);
    const btnDel = document.createElement('button');
    btnDel.className = 'btn danger icon';
    btnDel.textContent = '✕';
    btnDel.onclick = () => deleteTask(t.id);
    tdAcc.append(btnEdit, ' ', btnDone, ' ', btnDel);
    tr.appendChild(tdAcc);

    tbody.appendChild(tr);
  }

  // Flechas de orden
  document.querySelectorAll('#tasks-table th').forEach(th => {
    th.querySelector('.arrow')?.remove();
    if (th.dataset.sort === sortKey) {
      const s = document.createElement('span');
      s.className = 'arrow';
      s.textContent = sortDir === 1 ? '▲' : '▼';
      th.appendChild(s);
    }
  });
}

function renderFilterOptions() {
  // Unión de la lista oficial y los nombres presentes en tareas
  const respSet = [...new Set([...responsables, ...tasks.map(t => t.responsable)].filter(Boolean))].sort();
  const selResp = document.getElementById('filter-responsable');
  const current = selResp.value;
  selResp.innerHTML = '<option value="">Responsable: todos</option>';
  for (const r of respSet) {
    const o = document.createElement('option');
    o.value = o.textContent = r;
    selResp.appendChild(o);
  }
  selResp.value = current;

  const selEst = document.getElementById('filter-estado');
  const curEst = selEst.value;
  selEst.innerHTML = '<option value="">Estado: todos</option>';
  for (const [id, e] of Object.entries(ESTADOS)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = e.label;
    selEst.appendChild(o);
  }
  selEst.value = curEst;

  const selComp = document.getElementById('filter-complejidad');
  if (selComp.options.length <= 1) {
    for (const c of COMPLEJIDADES) {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = COMPLEJIDAD_LABEL[c];
      selComp.appendChild(o);
    }
  }
}

/* ============================================================
   FORMULARIO INLINE (nueva / editar tarea)
   ============================================================ */
function closeInlineForm() {
  document.querySelector('#tasks-table tr.inline-form')?.remove();
  document.querySelector('#tasks-table tr.row-hidden')?.classList.remove('row-hidden');
  // Si la barra guardar/cancelar estaba junto al formulario (edición), volver a su sitio
  const acciones = document.querySelector('#tasks-table tr.inline-actions-row');
  if (acciones) {
    const barra = acciones.querySelector('.add-task-bar');
    if (barra) document.querySelector('.table-wrap').insertAdjacentElement('afterend', barra);
    acciones.remove();
  }
  editingId = null;
  // Restaurar la barra inferior
  const btn = document.getElementById('btn-new-task');
  btn.textContent = '+ Nueva tarea';
  btn.classList.remove('saving');
  document.getElementById('btn-cancel-task').hidden = true;
}

// Transformar la barra inferior mientras el formulario está abierto
function setBarraGuardar(esEdicion) {
  const btn = document.getElementById('btn-new-task');
  btn.textContent = esEdicion ? '✓ Guardar cambios' : '✓ Guardar tarea';
  btn.classList.add('saving');
  document.getElementById('btn-cancel-task').hidden = false;
}

function openInlineForm(id) {
  closeInlineForm();
  editingId = id || null;
  const t = id ? tasks.find(x => x.id === id) : null;

  const tr = document.createElement('tr');
  tr.className = 'inline-form';
  const td = document.createElement('td');
  td.colSpan = 10;
  td.innerHTML = `
    <div class="form-title">${t ? 'Editar tarea' : 'Nueva tarea'}</div>
    <div class="form-grid">
      <label class="full">Tarea *<input type="text" id="f-tarea"></label>
      <label class="full">Descripción<textarea id="f-descripcion" rows="2"></textarea></label>
      <label>Responsable *
        <span class="resp-row"><select id="f-responsable"></select><button type="button" id="btn-nuevo-resp" class="btn secondary small" title="Agregar responsable nuevo">+ Nuevo</button></span>
        <span class="resp-new" hidden><input type="text" id="f-resp-nuevo" placeholder="Nombre nuevo"><button type="button" id="btn-resp-ok" class="btn primary small">Agregar</button></span>
      </label>
      <label>Apoyo<select id="f-apoyo"></select></label>
      <label>Complejidad<select id="f-complejidad"></select></label>
      <label class="check">Tiene dependencia<input type="checkbox" id="f-dependencia"></label>
      <label>Fecha compromiso *<input type="date" id="f-fecha"></label>
      <label>Fecha de cierre<input type="date" id="f-fecha-cierre"><small>Al ponerla, el estado se sugiere solo</small></label>
      <label>Estado<select id="f-estado"></select></label>
      <label>Veces aplazada
        <div class="apl-box" id="f-apl-box"></div>
        <small>Automático al postergar la fecha; ajustable a mano</small>
      </label>
      <label class="full" id="f-motivo-apl-wrap" hidden><small class="apl-aviso" id="f-apl-aviso"></small>Motivo del aplazamiento (opcional)<input type="text" id="f-motivo-apl" placeholder="¿Por qué se posterga?"></label>
      <label class="full">Puntos extra<input type="number" id="f-extra" step="any" value="0"></label>
      <div class="full" id="extras-chips"></div>
      <div class="full resp-new" id="extras-new" hidden>
        <input type="text" id="f-extra-nombre" placeholder="Nueva razón">
        <input type="number" id="f-extra-puntos" step="any" placeholder="Puntos">
        <button type="button" id="btn-extra-ok" class="btn primary small">Agregar</button>
      </div>
      <label class="full">Comentario<textarea id="f-comentario" rows="2"></textarea></label>
    </div>
    <div class="form-score" id="form-score"></div>`;
  tr.appendChild(td);

  // Selects de responsables desde la lista oficial
  const selResp = td.querySelector('#f-responsable');
  const selApoyo = td.querySelector('#f-apoyo');
  fillResponsableSelect(selResp, t?.responsable, false);
  fillResponsableSelect(selApoyo, t?.apoyo, true);

  // Complejidad (con el rango de horas al costado)
  const selComp = td.querySelector('#f-complejidad');
  for (const c of COMPLEJIDADES) {
    const o = document.createElement('option');
    o.value = c;
    const lbl = horasLabel(c);
    o.textContent = COMPLEJIDAD_LABEL[c] + (lbl ? ` · ${lbl}` : '');
    selComp.appendChild(o);
  }

  // Estado
  const selEst = td.querySelector('#f-estado');
  const optAuto = document.createElement('option');
  optAuto.value = '';
  optAuto.textContent = 'Automático (En curso / Con retraso)';
  selEst.appendChild(optAuto);
  for (const idEst of ESTADOS_MANUALES) {
    const o = document.createElement('option');
    o.value = idEst;
    o.textContent = ESTADOS[idEst].label;
    selEst.appendChild(o);
  }

  // Valores iniciales
  if (t) {
    td.querySelector('#f-tarea').value = t.tarea || '';
    td.querySelector('#f-descripcion').value = t.descripcion || '';
    td.querySelector('#f-dependencia').checked = !!t.dependencia;
    td.querySelector('#f-fecha').value = t.fechaCompromiso || '';
    td.querySelector('#f-fecha-cierre').value = t.fechaCierre || '';
    td.querySelector('#f-extra').value = t.puntosExtra || 0;
    td.querySelector('#f-comentario').value = t.comentario || '';
    selComp.value = t.complejidad || 'media';
    selEst.value = ESTADOS_MANUALES.includes(t.estado) ? t.estado : '';
  } else {
    selComp.value = 'media';
  }
  renderAplBox(td, t);

  // Insertar la fila: edición justo debajo de la tarea (que se oculta);
  // nueva al final, junto al botón "+ Nueva tarea"
  const tbody = document.getElementById('tasks-tbody');
  if (t) {
    const row = tbody.querySelector(`tr[data-task-id="${t.id}"]`);
    if (row) {
      row.classList.add('row-hidden');
      row.after(tr);
    } else {
      tbody.appendChild(tr);
    }
    // Barra guardar/cancelar justo debajo del formulario que se está editando
    const acciones = document.createElement('tr');
    acciones.className = 'inline-actions-row';
    const tdAcc = document.createElement('td');
    tdAcc.colSpan = 10;
    tdAcc.appendChild(document.querySelector('.add-task-bar'));
    acciones.appendChild(tdAcc);
    tr.after(acciones);
    acciones.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else {
    tbody.appendChild(tr);
    tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Eventos del formulario
  // Agregar responsable sin salir del formulario
  const respNew = td.querySelector('.resp-new');
  td.querySelector('#btn-nuevo-resp').onclick = () => {
    respNew.hidden = !respNew.hidden;
    if (!respNew.hidden) td.querySelector('#f-resp-nuevo').focus();
  };
  const confirmarNuevoResp = () => {
    const inp = td.querySelector('#f-resp-nuevo');
    const nombre = inp.value.trim();
    if (!nombre) return;
    if (ensureResponsable(nombre)) {
      saveResponsables();
      renderFilterOptions();
      toast(`Responsable "${nombre}" agregado`);
    }
    const valor = nombre;
    fillResponsableSelect(td.querySelector('#f-responsable'), valor, false);
    fillResponsableSelect(td.querySelector('#f-apoyo'), td.querySelector('#f-apoyo').value, true);
    inp.value = '';
    respNew.hidden = true;
  };
  td.querySelector('#btn-resp-ok').onclick = confirmarNuevoResp;
  td.querySelector('#f-resp-nuevo').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmarNuevoResp(); }
  });

  // Aviso en vivo + campo motivo cuando se posterga la fecha compromiso
  const fechaOriginal = t?.fechaCompromiso || '';
  const fechaCierreOriginal = t?.fechaCierre || '';
  const actualizarAvisoAplazamiento = () => {
    const wrap = td.querySelector('#f-motivo-apl-wrap');
    const nueva = td.querySelector('#f-fecha').value;
    const esPostergacion = !!t && !!fechaOriginal && !fechaCierreOriginal && nueva > fechaOriginal;
    wrap.hidden = !esPostergacion;
    if (esPostergacion) {
      const nro = (Number(td.dataset.aplManual) || 0) + 1;
      td.querySelector('#f-apl-aviso').textContent = `⚠️ Este cambio contará como el aplazamiento N.º ${nro}`;
    }
    return esPostergacion;
  };
  td.dataset.postergando = '';

  // Quitar marca de error al corregir
  for (const el of td.querySelectorAll('input, select, textarea')) {
    el.addEventListener('input', () => el.classList.remove('invalid'));
  }
  for (const fid of ['f-fecha', 'f-fecha-cierre', 'f-estado', 'f-complejidad', 'f-extra']) {
    td.querySelector('#' + fid).addEventListener('input', () => {
      if (fid === 'f-fecha-cierre') {
        const sel = td.querySelector('#f-estado');
        if (!sel.value) {
          const base = t ? fechaBaseCierre(t) : td.querySelector('#f-fecha').value;
          const sug = sugerirEstadoPorCierre(td.querySelector('#f-fecha-cierre').value, base);
          if (sug) sel.value = sug;
        }
      }
      if (fid === 'f-fecha') td.dataset.postergando = actualizarAvisoAplazamiento() ? '1' : '';
      updateFormScore();
    });
  }
  renderExtrasChips();
  // Registrar razón nueva desde el formulario: va al catálogo y suma sus puntos
  const confirmarNuevoExtra = () => {
    const inpN = td.querySelector('#f-extra-nombre');
    const inpP = td.querySelector('#f-extra-puntos');
    const nombre = inpN.value.trim();
    if (!nombre) { inpN.classList.add('invalid'); inpN.focus(); return; }
    const puntos = Number(inpP.value) || 0;
    config.extrasCatalogo.push({ nombre, puntos });
    saveConfig();
    renderExtrasChips();
    aplicarExtra(nombre, puntos);
    inpN.value = '';
    inpP.value = '';
    td.querySelector('#extras-new').hidden = true;
    updateFormScore();
    toast(`"${nombre}" registrado en el catálogo`);
  };
  td.querySelector('#btn-extra-ok').onclick = confirmarNuevoExtra;
  td.querySelector('#f-extra-nombre').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmarNuevoExtra(); }
  });
  updateFormScore();
  setBarraGuardar(!!t);
  // Abrir el calendario al hacer clic en cualquier parte del campo de fecha
  for (const fid of ['f-fecha', 'f-fecha-cierre']) activarPickerTotal(td.querySelector('#' + fid));
  td.querySelector('#f-tarea').focus();
}

function fillResponsableSelect(sel, valorActual, permitirVacio) {
  sel.innerHTML = '';
  if (permitirVacio) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '—';
    sel.appendChild(o);
  }
  for (const r of responsables) {
    const o = document.createElement('option');
    o.value = o.textContent = r;
    sel.appendChild(o);
  }
  // Si la tarea tiene un nombre que ya no está en la lista, se ofrece igual
  if (valorActual && !responsables.some(r => r.toLowerCase() === valorActual.toLowerCase())) {
    const o = document.createElement('option');
    o.value = o.textContent = valorActual + ' (no registrado)';
    o.value = valorActual;
    sel.appendChild(o);
  }
  sel.value = valorActual || '';
}

function formTaskData(td) {
  return {
    tarea: td.querySelector('#f-tarea').value.trim(),
    descripcion: td.querySelector('#f-descripcion').value.trim(),
    responsable: td.querySelector('#f-responsable').value,
    apoyo: td.querySelector('#f-apoyo').value,
    dependencia: td.querySelector('#f-dependencia').checked,
    complejidad: td.querySelector('#f-complejidad').value,
    fechaCompromiso: td.querySelector('#f-fecha').value,
    fechaCierre: td.querySelector('#f-fecha-cierre').value,
    estado: td.querySelector('#f-estado').value,
    puntosExtra: Number(td.querySelector('#f-extra').value) || 0,
    comentario: td.querySelector('#f-comentario').value.trim(),
  };
}

// Contador manual (stepper) + historial de aplazamientos en el formulario
function renderAplBox(td, t) {
  const box = td.querySelector('#f-apl-box');
  const hist = t?.historialAplazamientos || [];
  td.dataset.aplManual = String(Number(t?.vecesAplazada) || 0);
  box.innerHTML = `
    <div class="apl-row">
      <button type="button" class="btn secondary icon" id="apl-menos" title="Quitar 1">−</button>
      <strong id="apl-num">${td.dataset.aplManual}</strong>
      <button type="button" class="btn secondary icon" id="apl-mas" title="Sumar 1">+</button>
    </div>` +
    (hist.length ? '<ul>' + hist.map(h =>
      `<li>${fmtDate(h.de)} → ${fmtDate(h.a)}${h.motivo ? ` — ${escXml(h.motivo)}` : ''}</li>`
    ).join('') + '</ul>' : '');
  const mover = (delta) => {
    td.dataset.aplManual = String(Math.max(0, (Number(td.dataset.aplManual) || 0) + delta));
    box.querySelector('#apl-num').textContent = td.dataset.aplManual;
    updateFormScore();
  };
  box.querySelector('#apl-menos').onclick = () => mover(-1);
  box.querySelector('#apl-mas').onclick = () => mover(1);
}

function updateFormScore() {
  const formTr = document.querySelector('#tasks-table tr.inline-form');
  if (!formTr) return;
  const el = formTr.querySelector('#form-score');
  const t = formTaskData(formTr);
  // Contador manual (stepper) + el aplazamiento pendiente si se está postergando la fecha
  const tdForm = formTr.querySelector('td');
  t.vecesAplazada = (Number(tdForm.dataset.aplManual) || 0) + (tdForm.dataset.postergando ? 1 : 0);
  if (!t.fechaCompromiso) { el.textContent = 'Ingresa la fecha compromiso para ver el puntaje estimado.'; return; }
  const d = desglosePuntaje(t);
  const estLabel = ESTADOS[d.est].label;
  if (d.est === 'en-curso') {
    el.innerHTML = `Estado: <strong>${estLabel}</strong> — el puntaje se calcula al cerrar o vencer la tarea.`;
    return;
  }
  el.innerHTML = `Estado: <strong>${estLabel}</strong> · Puntaje: <strong>${d.total}</strong> ` +
    `<span>(${d.pts} pts estado × ${d.fac} complejidad − ${d.pen} aplazamientos + ${d.extra} extra)</span>`;
}

// Suma puntos extra y anota la razón en el comentario
function aplicarExtra(nombre, puntos) {
  const inp = document.getElementById('f-extra');
  inp.value = (Number(inp.value) || 0) + puntos;
  const com = document.getElementById('f-comentario');
  if (nombre && !com.value.includes(nombre)) {
    com.value = com.value.trim() ? com.value.trim().replace(/[.\s]+$/, '') + '. ' + nombre : nombre;
  }
  updateFormScore();
}

function renderExtrasChips() {
  const box = document.getElementById('extras-chips');
  if (!box) return;
  box.innerHTML = '';
  for (const item of config.extrasCatalogo) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = `${item.nombre} +${item.puntos}`;
    chip.title = 'Clic para sumar estos puntos extra y anotar la razón en el comentario';
    chip.onclick = () => aplicarExtra(item.nombre, item.puntos);
    box.appendChild(chip);
  }
  // Chip para registrar una razón nueva sin salir del formulario
  const chipNuevo = document.createElement('span');
  chipNuevo.className = 'chip chip-add';
  chipNuevo.textContent = '+ Nueva razón';
  chipNuevo.title = 'Registrar una razón nueva en el catálogo';
  chipNuevo.onclick = () => {
    const nuevo = document.getElementById('extras-new');
    nuevo.hidden = !nuevo.hidden;
    if (!nuevo.hidden) document.getElementById('f-extra-nombre').focus();
  };
  box.appendChild(chipNuevo);
}

function saveInlineForm() {
  const formTr = document.querySelector('#tasks-table tr.inline-form');
  if (!formTr) return;
  const eraEdicion = !!editingId;
  let sePostergo = false;
  const data = formTaskData(formTr);

  // Marcar en rojo los obligatorios que falten
  const faltantes = [];
  if (!data.tarea) faltantes.push('#f-tarea');
  if (!data.responsable) faltantes.push('#f-responsable');
  if (!data.fechaCompromiso) faltantes.push('#f-fecha');
  if (faltantes.length) {
    for (const sel of faltantes) formTr.querySelector(sel)?.classList.add('invalid');
    const msg = !data.responsable && !responsables.length
      ? 'Falta el responsable: agrégalo con "+ Nuevo" aquí mismo'
      : 'Completa los campos marcados en rojo';
    toast(msg, 4000);
    formTr.querySelector(faltantes[0])?.focus();
    return;
  }
  // Por si acaso el nombre no estaba en la lista
  ensureResponsable(data.responsable);
  ensureResponsable(data.apoyo);
  saveResponsables();

  if (editingId) {
    const t = tasks.find(x => x.id === editingId);
    const fechaAnterior = t.fechaCompromiso;
    const estabaCerrada = !!t.fechaCierre;
    Object.assign(t, data);
    // El stepper manda: el valor a mano reemplaza al contador guardado
    t.vecesAplazada = Number(formTr.querySelector('td').dataset.aplManual) || 0;
    // Si se postergó la fecha compromiso de una tarea abierta, contar aplazamiento y registrar historial
    if (fechaAnterior && !estabaCerrada && data.fechaCompromiso > fechaAnterior) {
      t.vecesAplazada = t.vecesAplazada + 1;
      t.historialAplazamientos = t.historialAplazamientos || [];
      t.historialAplazamientos.push({
        de: fechaAnterior,
        a: data.fechaCompromiso,
        motivo: formTr.querySelector('#f-motivo-apl')?.value.trim() || '',
        cuando: todayISO(),
      });
      sePostergo = true;
      t.fechaOriginal = t.fechaOriginal || t.historialAplazamientos?.[0]?.de || fechaAnterior;
    }
  } else {
    tasks.push(Object.assign({
      id: crypto.randomUUID(),
      vecesAplazada: Number(formTr.querySelector('td').dataset.aplManual) || 0,
      historialAplazamientos: [],
    }, data));
  }
  saveTasks();
  closeInlineForm();
  renderAll();
  toast(sePostergo ? 'Tarea actualizada ✓ (se sumó 1 aplazamiento)' : (eraEdicion ? 'Tarea actualizada ✓' : 'Tarea guardada ✓'));
}

function quickClose(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  if (!t.fechaCierre) t.fechaCierre = todayISO();
  t.estado = sugerirEstadoPorCierre(t.fechaCierre, fechaBaseCierre(t)) || 'a-tiempo';
  saveTasks();
  renderAll();
  toast(`Cerrada como "${ESTADOS[t.estado].label}"`);
}

function deleteTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`¿Eliminar la tarea "${t.tarea}"?`)) return;
  tasks = tasks.filter(x => x.id !== id);
  saveTasks();
  renderAll();
}

/* ============================================================
   RENDER: Responsables
   ============================================================ */
function renderResponsables() {
  const tbl = document.getElementById('responsables-table');
  tbl.innerHTML = '';
  if (!responsables.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.textContent = 'Aún no hay responsables. Agrega uno o importa tu Excel.';
    td.style.color = 'var(--muted)';
    tr.appendChild(td);
    tbl.appendChild(tr);
    return;
  }
  for (const r of responsables) {
    const nTasks = tasks.filter(t => t.responsable === r || t.apoyo === r).length;
    const tr = document.createElement('tr');
    const tdN = document.createElement('td');
    tdN.textContent = r;
    const tdC = document.createElement('td');
    tdC.className = 'count';
    tdC.textContent = `${nTasks} tarea${nTasks === 1 ? '' : 's'}`;
    const tdD = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'del';
    btn.textContent = '✕';
    btn.title = 'Quitar de la lista (no borra sus tareas)';
    btn.onclick = () => {
      if (!confirm(`¿Quitar a "${r}" de la lista? Sus ${nTasks} tareas conservarán el nombre.`)) return;
      responsables = responsables.filter(x => x !== r);
      saveResponsables();
      renderResponsables();
      renderFilterOptions();
      toast('Responsable eliminado de la lista');
    };
    tdD.appendChild(btn);
    tr.append(tdN, tdC, tdD);
    tbl.appendChild(tr);
  }
}

/* ============================================================
   RENDER: Dashboard
   ============================================================ */
let dashDesde = '';
let dashHasta = '';

// Tareas dentro del rango de fechas del dashboard (por fecha compromiso)
function dashTasks() {
  return tasks.filter(t => {
    if (!dashDesde && !dashHasta) return true;
    if (!t.fechaCompromiso) return false;
    if (dashDesde && t.fechaCompromiso < dashDesde) return false;
    if (dashHasta && t.fechaCompromiso > dashHasta) return false;
    return true;
  });
}

function statsPorResponsable(list) {
  const puntos = {};
  const anticipadas = {};
  for (const t of list) {
    const r = t.responsable || '(sin responsable)';
    const p = puntaje(t);
    if (p != null) puntos[r] = (puntos[r] || 0) + p;
    if (estadoEfectivo(t) === 'anticipado') anticipadas[r] = (anticipadas[r] || 0) + 1;
  }
  return { puntos, anticipadas };
}

// Vencidas, en riesgo y próximas a vencer (7 días) dentro de la lista dada
function atencionListas(list) {
  const today = todayISO();
  const lim = new Date();
  lim.setDate(lim.getDate() + 7);
  const limiteISO = lim.getFullYear() + '-' + String(lim.getMonth() + 1).padStart(2, '0') + '-' + String(lim.getDate()).padStart(2, '0');
  const byFecha = (a, b) => (a.fechaCompromiso || '').localeCompare(b.fechaCompromiso || '');
  return {
    vencidas: list.filter(t => estadoEfectivo(t) === 'vencida').sort(byFecha),
    enRiesgo: list.filter(t => estadoEfectivo(t) === 'riesgo').sort(byFecha),
    proximas: list.filter(t => estadoEfectivo(t) === 'en-curso' && t.fechaCompromiso >= today && t.fechaCompromiso <= limiteISO).sort(byFecha),
  };
}

function renderDashboard() {
  const list = dashTasks();
  const counts = {};
  for (const id of Object.keys(ESTADOS)) counts[id] = 0;
  let totalPuntos = 0;
  const porResponsable = {};

  for (const t of list) {
    const est = estadoEfectivo(t);
    counts[est]++;
    const p = puntaje(t);
    if (p != null) {
      totalPuntos += p;
      const r = t.responsable || '(sin responsable)';
      porResponsable[r] = (porResponsable[r] || 0) + p;
    }
  }
  const completadas = counts['anticipado'] + counts['a-tiempo'] + counts['tarde'];
  const pctCumplimiento = list.length ? Math.round((completadas / list.length) * 100) : null;
  const pctAnticipadas = completadas ? Math.round((counts['anticipado'] / completadas) * 100) : null;

  // Nota del rango activo
  document.getElementById('range-note').textContent = (dashDesde || dashHasta)
    ? `Mostrando ${list.length} tareas entre ${dashDesde ? fmtDate(dashDesde) : 'el inicio'} y ${dashHasta ? fmtDate(dashHasta) : 'hoy'}`
    : 'Mostrando todo el historial';

  // Tarjetas
  const cards = document.getElementById('dash-cards');
  cards.innerHTML = '';
  const cardData = [
    ['Total tareas', list.length],
    ['En curso', counts['en-curso']],
    ['En riesgo', counts['riesgo']],
    ['Con retraso', counts['vencida']],
    ['Completadas', completadas],
    ['Puntaje total', totalPuntos],
    ['% Cumplimiento', pctCumplimiento == null ? '—' : pctCumplimiento + '%'],
    ['% Anticipadas', pctAnticipadas == null ? '—' : pctAnticipadas + '%'],
  ];
  for (const [lbl, num] of cardData) {
    const div = document.createElement('div');
    div.className = 'card';
    const n = document.createElement('div');
    n.className = 'num';
    n.textContent = num;
    const l = document.createElement('div');
    l.className = 'lbl';
    l.textContent = lbl;
    div.append(n, l);
    cards.appendChild(div);
  }

  renderDonut(counts);
  renderBarChart('chart-responsables', porResponsable, 'puntos');
  const { puntos, anticipadas } = statsPorResponsable(list);
  renderPodio('podio-puntos', puntos, 'pts');
  renderPodio('podio-anticipadas', anticipadas, 'anticipadas');
  renderMensual(list);
  renderAlertas(list);
}

const MEDALLAS = ['🥇', '🥈', '🥉'];

function renderPodio(elId, dataByLabel, unit) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  const entries = Object.entries(dataByLabel).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!entries.length) {
    el.innerHTML = '<p class="podio-empty">Sin datos en el rango seleccionado.</p>';
    return;
  }
  entries.forEach(([nombre, valor], i) => {
    const div = document.createElement('div');
    div.className = 'podio-item' + (i === 0 ? ' first' : '');
    const medal = document.createElement('span');
    medal.className = 'medal';
    medal.textContent = MEDALLAS[i];
    const name = document.createElement('span');
    name.textContent = nombre;
    const val = document.createElement('span');
    val.className = 'valor';
    val.textContent = `${valor} ${unit}`;
    div.append(medal, name, val);
    el.appendChild(div);
  });
}

function renderDonut(counts) {
  const el = document.getElementById('chart-estados');
  el.innerHTML = '';
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) { el.textContent = 'Sin datos'; return; }

  const R = 60, CX = 75, CY = 75;
  let angle = -Math.PI / 2;
  let svg = `<svg viewBox="0 0 150 150" style="max-width:220px;margin:0 auto">`;
  for (const [id, n] of Object.entries(counts)) {
    if (!n) continue;
    const frac = n / total;
    const a2 = angle + frac * 2 * Math.PI;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = CX + R * Math.cos(angle), y1 = CY + R * Math.sin(angle);
    const x2 = CX + R * Math.cos(a2), y2 = CY + R * Math.sin(a2);
    svg += `<path d="M ${CX} ${CY} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${ESTADOS[id].color}"/>`;
    angle = a2;
  }
  svg += `<circle cx="${CX}" cy="${CY}" r="34" fill="var(--panel)"/>`;
  svg += `<text x="${CX}" y="${CY + 5}" text-anchor="middle" fill="var(--text)" font-size="16" font-weight="700">${total}</text>`;
  svg += `</svg>`;
  el.innerHTML = svg;

  const legend = document.createElement('div');
  legend.className = 'legend';
  for (const [id, n] of Object.entries(counts)) {
    if (!n) continue;
    const s = document.createElement('span');
    s.innerHTML = `<i style="background:${ESTADOS[id].color}"></i> ${ESTADOS[id].label}: ${n}`;
    legend.appendChild(s);
  }
  el.appendChild(legend);
}

function renderBarChart(elId, dataByLabel, unit) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  const entries = Object.entries(dataByLabel).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { el.textContent = 'Sin datos'; return; }
  const max = Math.max(...entries.map(e => Math.abs(e[1])), 1);
  let html = '<svg viewBox="0 0 400 ' + entries.length * 30 + '">';
  entries.forEach(([label, val], i) => {
    const y = i * 30;
    const w = Math.max((Math.abs(val) / max) * 55, 1.5);
    const color = val < 0 ? 'var(--red)' : 'var(--accent)';
    const name = label.length > 18 ? label.slice(0, 17) + '…' : label;
    html += `<text class="bar-label" x="0" y="${y + 14}">${escXml(name)}</text>`;
    html += `<rect x="130" y="${y + 3}" width="${w * 2.2}" height="16" rx="4" fill="${color}"/>`;
    html += `<text class="bar-value" x="${135 + w * 2.2}" y="${y + 15}">${val} ${unit}</text>`;
  });
  html += '</svg>';
  el.innerHTML = html;
}

function renderMensual(list) {
  const el = document.getElementById('chart-mensual');
  el.innerHTML = '';
  const byMonth = {};
  for (const t of list) {
    const k = monthKey(t.fechaCompromiso);
    if (!k) continue;
    byMonth[k] = byMonth[k] || { total: 0, completadas: 0, puntos: 0 };
    byMonth[k].total++;
    const est = estadoEfectivo(t);
    if (['anticipado', 'a-tiempo', 'tarde'].includes(est)) byMonth[k].completadas++;
    const p = puntaje(t);
    if (p != null) byMonth[k].puntos += p;
  }
  const keys = Object.keys(byMonth).sort();
  if (!keys.length) { el.textContent = 'Sin datos'; return; }
  const data = {};
  for (const k of keys) {
    data[`${monthLabel(k)} — ${byMonth[k].completadas}/${byMonth[k].total} compl.`] = byMonth[k].puntos;
  }
  renderBarChart('chart-mensual', data, 'pts');
}

function renderAlertas(list) {
  const el = document.getElementById('alertas');
  el.innerHTML = '';
  const { vencidas, enRiesgo, proximas } = atencionListas(list);

  if (!vencidas.length && !enRiesgo.length && !proximas.length) {
    el.textContent = 'Nada requiere atención en el rango seleccionado.';
    return;
  }
  const grupos = [
    ['Vencidas', vencidas, 'vencida', t => `Venció ${fmtDate(t.fechaCompromiso)}`],
    ['En riesgo de retraso', enRiesgo, 'riesgo', t => `Vence ${fmtDate(t.fechaCompromiso)}`],
    ['Vencen en 7 días', proximas, 'proxima', t => `Vence ${fmtDate(t.fechaCompromiso)}`],
  ];
  for (const [titulo, items, cls, fechaFn] of grupos) {
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'alert-group';
    h.textContent = titulo;
    el.appendChild(h);
    for (const t of items) el.appendChild(alertItem(t, cls, fechaFn(t)));
  }
}

function alertItem(t, cls, fechaTxt) {
  const div = document.createElement('div');
  div.className = `alert-item ${cls}`;
  const name = document.createElement('span');
  name.textContent = `${t.tarea} — ${t.responsable || ''}`;
  const fecha = document.createElement('span');
  fecha.className = 'fecha';
  fecha.textContent = fechaTxt;
  div.append(name, fecha);
  return div;
}

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Clic en cualquier parte del campo abre el selector de fecha/mes
function activarPickerTotal(el) {
  if (!el) return;
  el.addEventListener('click', () => {
    try { el.showPicker?.(); } catch { /* gesto no permitido */ }
  });
}

/* ============================================================
   RENDER: Configuración
   ============================================================ */
function renderConfig() {
  // Puntos por estado
  const tblEst = document.getElementById('config-estados');
  tblEst.innerHTML = '';
  for (const [id, e] of Object.entries(ESTADOS)) {
    const tr = document.createElement('tr');
    const tdL = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${id}`;
    badge.textContent = e.label;
    tdL.appendChild(badge);
    if (e.auto) {
      const small = document.createElement('small');
      small.style.color = 'var(--muted)';
      small.textContent = ' (automático)';
      tdL.appendChild(small);
    }
    const tdI = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.value = config.puntosEstado[id] ?? 0;
    inp.onchange = () => {
      config.puntosEstado[id] = Number(inp.value) || 0;
      saveConfig();
      renderTasks();
      toast('Peso actualizado');
    };
    tdI.appendChild(inp);
    tr.append(tdL, tdI);
    tblEst.appendChild(tr);
  }

  // Factor por complejidad + rango de horas
  const tblComp = document.getElementById('config-complejidad');
  tblComp.innerHTML = '';
  for (const c of COMPLEJIDADES) {
    const tr = document.createElement('tr');
    const tdL = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${c}`;
    badge.textContent = COMPLEJIDAD_LABEL[c];
    tdL.appendChild(badge);
    const tdI = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.value = config.factorComplejidad[c] ?? 0;
    inp.onchange = () => {
      config.factorComplejidad[c] = Number(inp.value) || 0;
      saveConfig();
      renderTasks();
      toast('Factor actualizado');
    };
    tdI.appendChild(inp);
    const tdH = document.createElement('td');
    const inpH = document.createElement('input');
    inpH.type = 'number';
    inpH.className = 'input-horas';
    inpH.min = '0';
    inpH.step = 'any';
    inpH.value = config.horasComplejidad[c] ?? '';
    inpH.onchange = () => {
      config.horasComplejidad[c] = inpH.value === '' ? null : Number(inpH.value) || 0;
      saveConfig();
      toast('Horas actualizadas');
    };
    tdH.appendChild(inpH);
    tdH.appendChild(document.createTextNode(' h'));
    tr.append(tdL, tdI, tdH);
    tblComp.appendChild(tr);
  }

  // Penalidad
  const inpPen = document.getElementById('config-penalidad');
  inpPen.value = config.penalidadAplazamiento;
  inpPen.onchange = () => {
    config.penalidadAplazamiento = Number(inpPen.value) || 0;
    saveConfig();
    renderTasks();
    toast('Penalidad actualizada');
  };

  // Catálogo de extras
  renderExtrasCatalog();
}

function renderExtrasCatalog() {
  const tbl = document.getElementById('config-extras');
  tbl.innerHTML = '';
  config.extrasCatalogo.forEach((item, idx) => {
    const tr = document.createElement('tr');
    const tdN = document.createElement('td');
    tdN.textContent = item.nombre;
    const tdP = document.createElement('td');
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.value = item.puntos;
    inp.onchange = () => {
      config.extrasCatalogo[idx].puntos = Number(inp.value) || 0;
      saveConfig();
      renderExtrasChips();
      toast('Catálogo actualizado');
    };
    tdP.appendChild(inp);
    const tdD = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'del';
    btn.textContent = '✕';
    btn.onclick = () => {
      config.extrasCatalogo.splice(idx, 1);
      saveConfig();
      renderExtrasCatalog();
      renderExtrasChips();
    };
    tdD.appendChild(btn);
    tr.append(tdN, tdP, tdD);
    tbl.appendChild(tr);
  });
}

/* ============================================================
   IMPORTAR / EXPORTAR
   ============================================================ */
function normalizeKey(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[́-ͯ]/g, '').trim();
}

const MESES_MAP = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

function parseExcelDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  }
  if (typeof v === 'number') {
    // Serial de Excel
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  const s = String(v).trim();
  // "24-Ago" o "24-Ago-2025"
  const m = s.match(/^(\d{1,2})[-/\s]([A-Za-zá]{3,})[-/\s]?(\d{4})?$/);
  if (m) {
    const mes = MESES_MAP[normalizeKey(m[2]).slice(0, 3)];
    if (mes) {
      const year = m[3] || new Date().getFullYear();
      return `${year}-${String(mes).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    }
  }
  // ISO o DD/MM/YYYY
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  return '';
}

function mapEstadoExcel(s) {
  const k = normalizeKey(s);
  if (k.includes('anticipad')) return 'anticipado';
  if (k.includes('terminado con retraso')) return 'tarde';
  if (k.includes('a tiempo')) return 'a-tiempo';
  if (k.includes('riesgo')) return 'riesgo';
  if (k.includes('suspend')) return 'suspendido';
  if (k.includes('cancelad')) return 'cancelado';
  return ''; // "Con Retraso", "Pendiente", vacío → automático
}

function mapComplejidadExcel(s) {
  const k = normalizeKey(s);
  if (k.startsWith('crit')) return 'critica';
  if (k.startsWith('alt')) return 'alta';
  if (k.startsWith('med')) return 'media';
  return 'baja';
}

function importXLSX(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
      const sheetName = wb.SheetNames.includes('Data') ? 'Data' : wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      let imported = 0;
      let nuevosResp = 0;
      for (const row of rows) {
        const r = {};
        for (const [k, v] of Object.entries(row)) r[normalizeKey(k)] = v;
        const tarea = String(r['tarea'] || '').trim();
        if (!tarea) continue;
        const resp = String(r['responsable'] || '').trim();
        const apoyo = String(r['apoyo'] || '').trim();
        // Crear responsables nuevos automáticamente
        if (ensureResponsable(resp)) nuevosResp++;
        if (ensureResponsable(apoyo)) nuevosResp++;
        tasks.push({
          id: crypto.randomUUID(),
          tarea,
          descripcion: String(r['descripcion'] || '').trim(),
          responsable: resp,
          apoyo,
          dependencia: normalizeKey(r['tiene dependencia']) === 'si',
          fechaCompromiso: parseExcelDate(r['fecha de compromiso']),
          fechaCierre: parseExcelDate(r['fecha de cierre'] || r['fecha cierre'] || ''),
          estado: mapEstadoExcel(r['status'] || r['estado']),
          complejidad: mapComplejidadExcel(r['complejidad'] || r['com']),
          vecesAplazada: Number(r['veces aplazada']) || 0,
          puntosExtra: Number(r['puntos extra']) || 0,
          comentario: String(r['comentario'] || '').trim(),
        });
        imported++;
      }
      saveTasks();
      saveResponsables();
      renderAll();
      renderResponsables();
      toast(`${imported} tareas importadas desde "${sheetName}"` + (nuevosResp ? ` · ${nuevosResp} responsables nuevos` : ''));
    } catch (err) {
      console.error(err);
      alert('No se pudo leer el archivo Excel: ' + err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function exportJSON() {
  const blob = new Blob([JSON.stringify({ tasks, config, responsables, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  download(blob, `seguimiento-${todayISO()}.json`);
  markBackupDone();
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.tasks)) throw new Error('formato inválido');
      if (!confirm(`Se reemplazarán las ${tasks.length} tareas actuales por ${data.tasks.length} del archivo. ¿Continuar?`)) return;
      tasks = data.tasks;
      if (data.config) config = Object.assign(structuredClone(DEFAULT_CONFIG), data.config);
      if (Array.isArray(data.responsables)) responsables = data.responsables;
      saveTasks();
      saveConfig();
      saveResponsables();
      renderAll();
      renderConfig();
      renderResponsables();
      toast('Respaldo restaurado');
    } catch (err) {
      alert('No se pudo importar el JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function exportCSV() {
  const header = ['Tarea', 'Descripción', 'Responsable', 'Apoyo', 'Tiene Dependencia', 'Fecha De Compromiso', 'Fecha De Cierre', 'Status', 'Complejidad', 'Veces Aplazada', 'Puntos Extra', 'Puntaje Final', 'Comentario'];
  const lines = [header];
  for (const t of tasks) {
    const est = estadoEfectivo(t);
    const p = puntaje(t);
    lines.push([
      t.tarea, t.descripcion, t.responsable, t.apoyo,
      t.dependencia ? 'SI' : 'NO',
      t.fechaCompromiso, t.fechaCierre || '',
      ESTADOS[est].label, COMPLEJIDAD_LABEL[t.complejidad] || t.complejidad,
      t.vecesAplazada || 0, t.puntosExtra || 0, p == null ? '' : p,
      t.comentario,
    ]);
  }
  const csv = lines.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  download(blob, `seguimiento-${todayISO()}.csv`);
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   RESPALDO AUTOMÁTICO (File System Access API + IndexedDB)
   ============================================================ */
const LS_LAST_EXPORT = 'seguimiento.lastExport';
let backupHandle = null;
let backupTimer = null;

// Mini wrapper de IndexedDB para guardar el FileSystemFileHandle
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('seguimiento', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const rq = db.transaction('kv').objectStore('kv').get(key);
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

const backupSoportado = 'showSaveFilePicker' in window;

function markBackupDone() {
  localStorage.setItem(LS_LAST_EXPORT, new Date().toISOString());
}

// Se llama tras cada guardado; escribe el archivo con un pequeño debounce
function scheduleBackup() {
  if (!backupHandle) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(writeBackupFile, 600);
}

async function writeBackupFile() {
  try {
    const writable = await backupHandle.createWritable();
    await writable.write(JSON.stringify({ tasks, config, responsables, exportedAt: new Date().toISOString() }, null, 2));
    await writable.close();
    markBackupDone();
    renderBackupStatus();
  } catch (err) {
    console.warn('Respaldo automático falló:', err);
    renderBackupStatus('error');
  }
}

async function elegirArchivoBackup() {
  try {
    const handle = await showSaveFilePicker({
      suggestedName: 'seguimiento-backup.json',
      types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    });
    backupHandle = handle;
    await idbSet('backupHandle', handle);
    await writeBackupFile();
    toast(`Respaldo automático activo en "${handle.name}"`);
  } catch (err) {
    if (err.name !== 'AbortError') console.warn(err);
  }
  renderBackupStatus();
}

// Re-pedir permiso (el navegador lo revoca al cerrar la sesión)
async function reconectarBackup() {
  try {
    const perm = await backupHandle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      await writeBackupFile();
      toast(`Respaldo reconectado a "${backupHandle.name}"`);
    }
  } catch (err) { console.warn(err); }
  renderBackupStatus();
}

async function desconectarBackup() {
  backupHandle = null;
  await idbDel('backupHandle');
  renderBackupStatus();
  toast('Respaldo automático desactivado');
}

// Estado: 'granted' activo · 'prompt' necesita clic · 'error' última escritura falló
async function renderBackupStatus(forzarEstado) {
  const el = document.getElementById('backup-status');
  if (!el) return;
  const btnChoose = document.getElementById('btn-backup-choose');
  const btnDisc = document.getElementById('btn-backup-disconnect');
  el.className = 'backup-status';

  if (!backupSoportado) {
    el.textContent = 'Tu navegador no soporta escritura a disco. Usa "Exportar JSON" periódicamente.';
    btnChoose.hidden = true;
    btnDisc.hidden = true;
    return;
  }
  if (!backupHandle) {
    el.textContent = 'No configurado.';
    btnChoose.textContent = 'Elegir archivo…';
    btnChoose.hidden = false;
    btnDisc.hidden = true;
    btnChoose.onclick = elegirArchivoBackup;
    return;
  }
  btnDisc.hidden = false;
  btnChoose.hidden = false;
  const perm = forzarEstado === 'error' ? 'granted' : await backupHandle.queryPermission({ mode: 'readwrite' });
  if (forzarEstado === 'error') {
    el.classList.add('warn');
    el.textContent = `⚠ Falló la última escritura en "${backupHandle.name}". Revisa que el archivo exista y vuelve a elegirlo.`;
    btnChoose.textContent = 'Elegir archivo…';
    btnChoose.onclick = elegirArchivoBackup;
  } else if (perm === 'granted') {
    el.classList.add('ok');
    const last = localStorage.getItem(LS_LAST_EXPORT);
    el.textContent = `✔ Activo en "${backupHandle.name}"` + (last ? ` · último respaldo ${new Date(last).toLocaleString()}` : '');
    btnChoose.textContent = 'Cambiar archivo…';
    btnChoose.onclick = elegirArchivoBackup;
  } else {
    el.classList.add('warn');
    el.textContent = `⚠ "${backupHandle.name}" necesita permiso para escribir.`;
    btnChoose.textContent = 'Reconectar respaldo';
    btnChoose.onclick = reconectarBackup;
  }
}

// Aviso si lleva 7+ días sin respaldar (solo sin respaldo automático activo)
async function checkBackupReminder() {
  if (!backupSoportado && !localStorage.getItem(LS_LAST_EXPORT) && !tasks.length) return;
  try {
    const handle = await idbGet('backupHandle');
    if (handle) {
      backupHandle = handle;
      renderBackupStatus();
      return; // con respaldo automático configurado no hay recordatorio
    }
  } catch { /* IndexedDB no disponible */ }
  const last = localStorage.getItem(LS_LAST_EXPORT);
  const dias = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  if (dias !== null && dias >= 7) {
    toast(`Han pasado ${dias} días sin respaldar. Usa "Exportar JSON".`, 6000);
  } else if (dias === null && tasks.length) {
    toast('Aún no has hecho ningún respaldo. Usa "Exportar JSON".', 6000);
  }
}

/* ============================================================
   REPORTE imprimible
   ============================================================ */
const REPORTE_SECCIONES = [
  ['resumen', 'Resumen y porcentajes'],
  ['estados', 'Tareas por estado'],
  ['puntos', 'Puntaje por responsable'],
  ['podio-puntos', 'Podio de puntajes'],
  ['podio-anticipadas', 'Podio de entregas anticipadas'],
  ['mensual', 'Evolución mensual'],
  ['detalle', 'Detalle por cumplimiento y próximos compromisos'],
  ['atencion', 'Tareas que demandan atención'],
];

function renderReporteChecks() {
  const box = document.getElementById('reporte-checks');
  box.innerHTML = '';
  for (const [id, label] of REPORTE_SECCIONES) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = id;
    cb.checked = true; // por defecto todas
    l.append(cb, ' ' + label);
    box.appendChild(l);
  }
}

function repTable(headers, rows) {
  let h = '<table><thead><tr>' + headers.map(x => `<th>${escXml(x)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of rows) h += '<tr>' + r.map(c => `<td>${escXml(String(c))}</td>`).join('') + '</tr>';
  return h + '</tbody></table>';
}

function generarReporte() {
  const marcadas = [...document.querySelectorAll('#reporte-checks input:checked')].map(i => i.value);
  if (!marcadas.length) { toast('Marca al menos una sección'); return; }

  const list = dashTasks();
  const counts = {};
  for (const id of Object.keys(ESTADOS)) counts[id] = 0;
  for (const t of list) counts[estadoEfectivo(t)]++;
  const completadas = counts['anticipado'] + counts['a-tiempo'] + counts['tarde'];
  const { puntos, anticipadas } = statsPorResponsable(list);
  const rangoTxt = (dashDesde || dashHasta)
    ? `${dashDesde ? fmtDate(dashDesde) : 'inicio'} → ${dashHasta ? fmtDate(dashHasta) : 'hoy'}`
    : 'Todo el historial';

  let html = `<div class="rep-brand">
      <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0073ea"/><path d="M 12.5 8 v 13.5 h 9" stroke="#ffffff" stroke-width="4.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <div>
        <h1>Reporte de seguimiento</h1>
        <p class="rep-app">lunes — seguimiento de tareas</p>
      </div>
    </div>
    <p class="rep-meta">Rango: ${rangoTxt} · Generado el ${fmtDate(todayISO())} · ${list.length} tareas</p>`;

  if (marcadas.includes('resumen')) {
    const totalPuntos = Object.values(puntos).reduce((a, b) => a + b, 0);
    html += '<h2>Resumen</h2>' + repTable(['Métrica', 'Valor'], [
      ['Total tareas', list.length],
      ['En curso', counts['en-curso']],
      ['En riesgo de retraso', counts['riesgo']],
      ['Con retraso (vencidas)', counts['vencida']],
      ['Completadas', completadas],
      ['Suspendidas', counts['suspendido']],
      ['Canceladas', counts['cancelado']],
      ['Puntaje total', totalPuntos],
      ['% Cumplimiento', list.length ? Math.round(completadas / list.length * 100) + '%' : '—'],
      ['% Entregas anticipadas', completadas ? Math.round(counts['anticipado'] / completadas * 100) + '%' : '—'],
    ]);
  }

  if (marcadas.includes('estados')) {
    const rows = Object.entries(counts).filter(([, n]) => n > 0).map(([id, n]) => [ESTADOS[id].label, n]);
    html += '<h2>Tareas por estado</h2>' + (rows.length ? repTable(['Estado', 'Cantidad'], rows) : '<p>Sin datos.</p>');
  }

  if (marcadas.includes('puntos')) {
    const rows = Object.entries(puntos).sort((a, b) => b[1] - a[1]);
    html += '<h2>Puntaje por responsable</h2>' + (rows.length ? repTable(['Responsable', 'Puntos'], rows) : '<p>Sin datos.</p>');
  }

  if (marcadas.includes('podio-puntos')) {
    const rows = Object.entries(puntos).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([r, v], i) => [MEDALLAS[i], r, v]);
    html += '<h2>Podio de puntajes</h2>' + (rows.length ? repTable(['Puesto', 'Responsable', 'Puntos'], rows) : '<p>Sin datos.</p>');
  }

  if (marcadas.includes('podio-anticipadas')) {
    const rows = Object.entries(anticipadas).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([r, v], i) => [MEDALLAS[i], r, v]);
    html += '<h2>Podio de entregas anticipadas</h2>' + (rows.length ? repTable(['Puesto', 'Responsable', 'Anticipadas'], rows) : '<p>Sin datos.</p>');
  }

  if (marcadas.includes('mensual')) {
    const byMonth = {};
    for (const t of list) {
      const k = monthKey(t.fechaCompromiso);
      if (!k) continue;
      byMonth[k] = byMonth[k] || { total: 0, completadas: 0, puntos: 0 };
      byMonth[k].total++;
      if (['anticipado', 'a-tiempo', 'tarde'].includes(estadoEfectivo(t))) byMonth[k].completadas++;
      const p = puntaje(t);
      if (p != null) byMonth[k].puntos += p;
    }
    const rows = Object.keys(byMonth).sort()
      .map(k => [monthLabel(k), byMonth[k].total, byMonth[k].completadas, byMonth[k].puntos]);
    html += '<h2>Evolución mensual</h2>' + (rows.length ? repTable(['Mes', 'Tareas', 'Completadas', 'Puntos'], rows) : '<p>Sin datos.</p>');
  }

  if (marcadas.includes('detalle')) {
    // Un cuadro por estado: pendientes primero, luego terminadas
    const orden = ['vencida', 'riesgo', 'en-curso', 'tarde', 'a-tiempo', 'anticipado'];
    let bloques = '';
    for (const est of orden) {
      const filas = list
        .filter(t => estadoEfectivo(t) === est)
        .sort((a, b) => (a.fechaCompromiso || '').localeCompare(b.fechaCompromiso || ''))
        .map(t => [t.tarea, t.responsable, fmtDate(t.fechaCompromiso), t.comentario || '—']);
      if (!filas.length) continue;
      bloques += `<h3>${escXml(ESTADOS[est].label)} (${filas.length})</h3>` +
        repTable(['Tarea', 'Responsable', 'Fecha', 'Comentario'], filas);
    }
    html += '<h2>Detalle por cumplimiento y próximos compromisos</h2>' +
      (bloques || '<p>Sin tareas en estas categorías.</p>');
  }

  if (marcadas.includes('atencion')) {
    const { vencidas, enRiesgo, proximas } = atencionListas(list);
    const rows = [
      ...vencidas.map(t => [t.tarea, t.responsable, fmtDate(t.fechaCompromiso), '🟡 Vencida']),
      ...enRiesgo.map(t => [t.tarea, t.responsable, fmtDate(t.fechaCompromiso), '⚠️ En riesgo']),
      ...proximas.map(t => [t.tarea, t.responsable, fmtDate(t.fechaCompromiso), '⏳ Vence pronto']),
    ];
    html += '<h2>Tareas que demandan atención</h2>' + (rows.length ? repTable(['Tarea', 'Responsable', 'F. Compromiso', 'Situación'], rows) : '<p>Ninguna.</p>');
  }

  document.getElementById('reporte-contenido').innerHTML = html;
  document.getElementById('reporte').hidden = false;
}

/* ============================================================
   Navegación y eventos
   ============================================================ */
function renderAll() {
  renderFilterOptions();
  renderTasks();
  renderDashboard();
}

function init() {
  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'dashboard') renderDashboard();
      if (btn.dataset.view === 'responsables') renderResponsables();
      if (btn.dataset.view === 'config') { renderConfig(); renderBackupStatus(); }
    };
  });

  // Filtros
  for (const id of ['filter-text', 'filter-responsable', 'filter-estado', 'filter-complejidad', 'filter-mes']) {
    document.getElementById(id).addEventListener('input', renderTasks);
  }
  // Calendario al hacer clic en cualquier parte del campo
  for (const id of ['filter-mes', 'dash-desde', 'dash-hasta']) activarPickerTotal(document.getElementById(id));
  document.getElementById('btn-clear-filters').onclick = () => {
    document.getElementById('filter-text').value = '';
    document.getElementById('filter-responsable').value = '';
    document.getElementById('filter-estado').value = '';
    document.getElementById('filter-complejidad').value = '';
    document.getElementById('filter-mes').value = '';
    renderTasks();
  };

  // Orden por columnas
  document.querySelectorAll('#tasks-table th[data-sort]').forEach(th => {
    th.onclick = () => {
      if (sortKey === th.dataset.sort) sortDir *= -1;
      else { sortKey = th.dataset.sort; sortDir = 1; }
      renderTasks();
    };
  });

  // Botón inferior: abre el formulario; con el form abierto, guarda
  document.getElementById('btn-new-task').onclick = () => {
    if (document.querySelector('#tasks-table tr.inline-form')) saveInlineForm();
    else openInlineForm(null);
  };
  document.getElementById('btn-cancel-task').onclick = closeInlineForm;

  // Responsables
  document.getElementById('btn-add-resp').onclick = addResponsable;
  document.getElementById('resp-nombre').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addResponsable();
  });

  // Importar / exportar
  const fileXlsx = document.getElementById('file-xlsx');
  document.getElementById('btn-import-xlsx').onclick = () => fileXlsx.click();
  fileXlsx.onchange = () => { if (fileXlsx.files[0]) importXLSX(fileXlsx.files[0]); fileXlsx.value = ''; };

  const fileJson = document.getElementById('file-json');
  document.getElementById('btn-import-json').onclick = () => fileJson.click();
  fileJson.onchange = () => { if (fileJson.files[0]) importJSON(fileJson.files[0]); fileJson.value = ''; };

  document.getElementById('btn-export-json').onclick = exportJSON;
  document.getElementById('btn-export-csv').onclick = exportCSV;

  // Config: catálogo extras
  document.getElementById('btn-add-extra').onclick = () => {
    const nombre = document.getElementById('extra-nombre').value.trim();
    const puntos = Number(document.getElementById('extra-puntos').value);
    if (!nombre || isNaN(puntos)) return;
    config.extrasCatalogo.push({ nombre, puntos });
    document.getElementById('extra-nombre').value = '';
    document.getElementById('extra-puntos').value = '';
    saveConfig();
    renderExtrasCatalog();
    renderExtrasChips();
    toast('Agregado al catálogo');
  };

  document.getElementById('btn-reset-config').onclick = () => {
    if (!confirm('¿Restaurar todos los pesos a los valores por defecto?')) return;
    config = structuredClone(DEFAULT_CONFIG);
    saveConfig();
    renderConfig();
    renderAll();
    toast('Configuración restaurada');
  };

  // Dashboard: rango de fechas y reporte
  document.getElementById('dash-desde').addEventListener('input', (e) => { dashDesde = e.target.value; renderDashboard(); });
  document.getElementById('dash-hasta').addEventListener('input', (e) => { dashHasta = e.target.value; renderDashboard(); });
  document.getElementById('btn-clear-range').onclick = () => {
    dashDesde = dashHasta = '';
    document.getElementById('dash-desde').value = '';
    document.getElementById('dash-hasta').value = '';
    renderDashboard();
  };
  renderReporteChecks();
  document.getElementById('btn-generar-reporte').onclick = generarReporte;
  document.getElementById('btn-imprimir').onclick = () => window.print();

  // Política de privacidad (modal)
  const modalPriv = document.getElementById('modal-privacidad');
  document.getElementById('link-privacidad').onclick = (e) => { e.preventDefault(); modalPriv.hidden = false; };
  document.getElementById('btn-cerrar-privacidad').onclick = () => { modalPriv.hidden = true; };
  modalPriv.addEventListener('click', (e) => { if (e.target === modalPriv) modalPriv.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modalPriv.hidden = true; });
  document.getElementById('btn-cerrar-reporte').onclick = () => { document.getElementById('reporte').hidden = true; };

  // Respaldo automático
  document.getElementById('btn-backup-disconnect').onclick = desconectarBackup;
  renderBackupStatus();
  checkBackupReminder();

  renderAll();
}

function addResponsable() {
  const inp = document.getElementById('resp-nombre');
  const nombre = inp.value.trim();
  if (!nombre) return;
  if (!ensureResponsable(nombre)) {
    toast(`"${nombre}" ya está en la lista`);
    return;
  }
  inp.value = '';
  saveResponsables();
  renderResponsables();
  renderFilterOptions();
  toast('Responsable agregado');
}

document.addEventListener('DOMContentLoaded', init);
