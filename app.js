// =====================================================
// app.js — Junta de Educación · Evaluación Tesorero
// =====================================================

// ══════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════
const state = {
  config: null,
  candidates: [],
  currentCandidateId: null,
  currentCandidateData: null,
  evaluationData: null,
  requirementsState: {},
  firebaseReady: false
};

let db = null;

// ══════════════════════════════════════════════════
// INICIALIZACIÓN
// ══════════════════════════════════════════════════
async function initApp() {
  showLoading(true, 'Iniciando aplicación...');
  try {
    // 1. Inicializar Firebase
    const fbOk = initFirebase();
    if (!fbOk) return;

    // 2. Cargar configuración
    await loadConfig();

    // 3. Cargar candidatos
    await loadCandidates();

    // 4. Mostrar dashboard
    showPage('dashboard');
  } catch (err) {
    showFirebaseError(err.message);
  } finally {
    showLoading(false);
  }
}

function initFirebase() {
  try {
    if (typeof firebaseConfig === 'undefined') {
      throw new Error('firebase-config.js no encontrado o vacío.');
    }
    if (firebaseConfig.apiKey === 'TU_API_KEY_AQUI') {
      showFirebaseError('Configure sus credenciales de Firebase en firebase-config.js');
      return false;
    }
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    state.firebaseReady = true;
    return true;
  } catch (err) {
    showFirebaseError('Error iniciando Firebase: ' + err.message);
    return false;
  }
}

async function loadConfig() {
  try {
    const res = await fetch('./config.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.config = await res.json();
  } catch (err) {
    console.warn('No se pudo cargar config.json, usando valores por defecto.', err);
    state.config = getDefaultConfig();
    showToast('Configuración por defecto cargada (config.json no encontrado)', 'warning');
  }
}

function getDefaultConfig() {
  return {
    criterios: {
      formacion: { peso_maximo: 20, opciones: [{ texto: 'Diplomado o Técnico Medio', porcentaje_default: 10 }, { texto: 'Bachillerato', porcentaje_default: 15 }, { texto: 'Licenciatura o Superior', porcentaje_default: 20 }, { texto: 'Otros', porcentaje_default: 0, permite_texto: true }] },
      capacitacion: { peso_maximo: 15, opciones: [{ texto: '1 hora disponible', porcentaje_default: 10 }, { texto: '2 horas disponibles', porcentaje_default: 12.5 }, { texto: '3 horas o más', porcentaje_default: 15 }, { texto: 'Otro', porcentaje_default: 0, permite_texto: true }] },
      precio: { peso_maximo: 40, calculo_automatico: true },
      experiencia: { peso_maximo: 25, opciones: [{ texto: 'Menos de 1 año', porcentaje_default: 0 }, { texto: '1 año', porcentaje_default: 5 }, { texto: '2 años', porcentaje_default: 10 }, { texto: '3 años', porcentaje_default: 15 }, { texto: '4 años', porcentaje_default: 17 }, { texto: '5 años', porcentaje_default: 19 }, { texto: '6 años', porcentaje_default: 20 }, { texto: '7 años', porcentaje_default: 22 }, { texto: '8 años', porcentaje_default: 24 }, { texto: '9 años o más', porcentaje_default: 25 }] }
    },
    requisitos_excluyentes: ['Oferta presentada en sobre cerrado', 'Oferta foliada (enumerada) y completa', 'Oferta firmada de puño y letra', 'Copia de cédula de identidad (presentada)', 'Copia del título de Contador', 'Certificación del Colegio de Contadores (activo)', 'Constancia de experiencia laboral mínima de 3 años', 'Hoja de delincuencia (no más de 2 meses de vigencia)', 'Póliza de fidelidad', 'Declaraciones juradas requeridas']
  };
}

// ══════════════════════════════════════════════════
// FIRESTORE — CANDIDATOS
// ══════════════════════════════════════════════════
async function loadCandidates() {
  if (!state.firebaseReady) return;
  showLoading(true, 'Cargando candidatos...');
  try {
    const snapshot = await db.collection('candidatos').orderBy('nombre').get();
    state.candidates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderCandidates();
    // Si la página de resultados está activa, actualizarla también
    if (document.getElementById('page-results').classList.contains('active')) {
      renderResults();
    }
  } catch (err) {
    showToast('Error al cargar candidatos: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function saveNewCandidate() {
  const nombre = document.getElementById('input-nombre').value.trim();
  const cedula = document.getElementById('input-cedula').value.trim();

  if (!nombre) { showToast('Ingrese el nombre del candidato', 'error'); return; }
  if (!cedula) { showToast('Ingrese la cédula del candidato', 'error'); return; }

  // Verificar duplicado por cédula
  const dup = state.candidates.find(c => c.cedula === cedula);
  if (dup) { showToast('Ya existe un candidato con esa cédula', 'error'); return; }

  showLoading(true, 'Guardando candidato...');
  try {
    await db.collection('candidatos').add({
      nombre,
      cedula,
      estado: 'pendiente',
      fecha_registro: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeModal('modal-add');
    showToast(`${nombre} agregado exitosamente`, 'success');
    await loadCandidates();
  } catch (err) {
    showToast('Error al guardar candidato: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function disqualifyCandidate() {
  const id = state.currentCandidateId;
  const data = state.currentCandidateData;
  if (!id) return;

  showLoading(true, 'Guardando...');
  try {
    const reqsCumplidos = {};
    state.config.requisitos_excluyentes.forEach((req, i) => {
      reqsCumplidos[`req_${i}`] = { texto: req, cumple: !!state.requirementsState[i] };
    });

    await db.collection('candidatos').doc(id).update({
      estado: 'descalificado',
      requisitos_excluyentes: reqsCumplidos,
      fecha_evaluacion: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeModal('modal-requirements');
    showToast(`${data.nombre} registrado como descalificado`, 'warning');
    await loadCandidates();
  } catch (err) {
    showToast('Error al guardar: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

async function saveEvaluation() {
  const id = state.currentCandidateId;
  const data = state.currentCandidateData;
  if (!id) return;

  // Leer valores del formulario
  const ev = readEvaluationForm();
  if (!ev) return; // validación falló

  showLoading(true, 'Guardando evaluación...');
  try {
    await db.collection('candidatos').doc(id).update({
      estado: 'evaluado',
      evaluacion: ev,
      fecha_evaluacion: firebase.firestore.FieldValue.serverTimestamp()
    });
    closeModal('modal-evaluation');
    showToast(`Evaluación de ${data.nombre} guardada (${ev.puntaje_total.toFixed(2)} pts)`, 'success');
    await loadCandidates();
    // Recalcular precios de otros candidatos si es necesario
    // await checkPriceRecalculation(id, ev.precio.monto);
  } catch (err) {
    showToast('Error al guardar evaluación: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Notifica al usuario si algún candidato previamente evaluado
 * tiene precio calculado auto y el nuevo precio puede cambiar su puntaje.
 */
async function checkPriceRecalculation(savedCandidateId, newMonto) {
  if (!newMonto || newMonto <= 0) return;
  try {
    const snap = await db.collection('candidatos')
      .where('estado', '==', 'evaluado').get();
    const others = snap.docs
      .filter(d => d.id !== savedCandidateId)
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.evaluacion && c.evaluacion.precio && !c.evaluacion.precio.es_manual);

    if (others.length === 0) return;

    const allPrices = snap.docs
      .map(d => d.data().evaluacion?.precio?.monto)
      .filter(p => p > 0);
    const minPrice = Math.min(...allPrices);
    const pesoMaxPrecio = state.config.criterios.precio.peso_maximo;

    let updated = 0;
    for (const cand of others) {
      const newPct = Math.min((minPrice / cand.evaluacion.precio.monto) * pesoMaxPrecio, pesoMaxPrecio);
      const newPtsPonderados = (newPct / 100) * pesoMaxPrecio;
      // Recalcular total
      const ev = { ...cand.evaluacion };
      ev.precio.porcentaje_asignado = parseFloat(newPct.toFixed(4));
      ev.precio.puntaje_ponderado = parseFloat(newPtsPonderados.toFixed(4));
      ev.puntaje_total = calcTotalFromEvaluacion(ev);
      await db.collection('candidatos').doc(cand.id).update({ evaluacion: ev });
      updated++;
    }
    if (updated > 0) {
      showToast(`Puntaje de precio recalculado para ${updated} candidato(s) anterior(es)`, 'info');
      await loadCandidates();
    }
  } catch (err) {
    console.warn('No se pudo recalcular precios:', err);
  }
}

function calcTotalFromEvaluacion(ev) {
  return (
    (ev.formacion?.puntaje_ponderado || 0) +
    (ev.capacitacion?.puntaje_ponderado || 0) +
    (ev.precio?.puntaje_ponderado || 0) +
    (ev.experiencia?.puntaje_ponderado || 0)
  );
}

// ══════════════════════════════════════════════════
// RENDER — DASHBOARD
// ══════════════════════════════════════════════════
function renderCandidates() {
  const container = document.getElementById('candidates-container');
  const candidates = state.candidates;

  // Actualizar meta
  const metaEl = document.getElementById('dashboard-meta');
  if (metaEl) {
    const ev = candidates.filter(c => c.estado === 'evaluado').length;
    const pend = candidates.filter(c => c.estado === 'pendiente').length;
    const desc = candidates.filter(c => c.estado === 'descalificado').length;
    metaEl.textContent = `${candidates.length} candidato(s) — ${ev} evaluado(s) · ${pend} pendiente(s) · ${desc} descalificado(s)`;
  }

  if (candidates.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">👥</div>
        <h3>Sin candidatos registrados</h3>
        <p>Haga clic en "+ Agregar Candidato" para comenzar.</p>
      </div>`;
    return;
  }

  container.innerHTML = candidates.map(c => renderCandidateCard(c)).join('');
}

function renderCandidateCard(c) {
  const initials = c.nombre.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const estado = c.estado || 'pendiente';
  const estadoLabels = { pendiente: '⏳ Pendiente', evaluado: '✅ Evaluado', descalificado: '❌ Descalificado' };
  const score = c.evaluacion?.puntaje_total ?? null;

  let scoreBar = '';
  if (estado === 'evaluado' && score !== null) {
    const pct = Math.min(Math.max(score, 0), 100);
    scoreBar = `
      <div class="card-score-bar">
        <span class="score-label">Puntaje</span>
        <div class="score-track"><div class="score-fill" style="width:${pct}%"></div></div>
        <span class="score-value">${score.toFixed(2)}</span>
      </div>`;
  }

  let actionBtn = '';
  if (estado === 'descalificado') {
    actionBtn = `
      <button class="btn btn-outline-primary btn-sm" onclick="reEvaluateDescalificado('${c.id}')">🔄 Re-evaluar</button>
      <button class="btn btn-secondary btn-sm" onclick="openDetailModal('${c.id}')" ${c.evaluacion ? '' : 'disabled'}>🔍 Ver detalle</button>`;
  } else if (estado === 'evaluado') {
    actionBtn = `
      <button class="btn btn-outline-primary btn-sm" onclick="openRequirementsModal('${c.id}', 1)">✏️ Re-evaluar</button>
      <button class="btn btn-secondary btn-sm" onclick="openDetailModal('${c.id}')">🔍 Ver detalle</button>`;
  } else {
    actionBtn = `<button class="btn btn-primary btn-sm" onclick="openRequirementsModal('${c.id}', 0)">📋 Evaluar</button>`;
  }

  return `
    <div class="candidate-card">
      <div class="card-top">
        <div class="card-avatar">${initials}</div>
        <div class="card-info">
          <div class="card-name">${escHtml(c.nombre)}</div>
          <div class="card-cedula">${escHtml(c.cedula)}</div>
        </div>
        <span class="status-badge ${estado}">${estadoLabels[estado] || estado}</span>
      </div>
      ${scoreBar}
      <div class="card-actions">${actionBtn}</div>
    </div>`;
}

// ══════════════════════════════════════════════════
// MODAL — AGREGAR CANDIDATO
// ══════════════════════════════════════════════════
function openAddCandidateModal() {
  document.getElementById('input-nombre').value = '';
  document.getElementById('input-cedula').value = '';
  openModal('modal-add');
  setTimeout(() => document.getElementById('input-nombre').focus(), 100);
}

// ══════════════════════════════════════════════════
// MODAL — REQUISITOS EXCLUYENTES
// ══════════════════════════════════════════════════
async function openRequirementsModal(candidateId, isReeval) {
  const cand = state.candidates.find(c => c.id === candidateId);
  if (!cand) return;

  if (isReeval) {
    const ok = await confirm2('Re-evaluar candidato', `¿Desea re-evaluar a <strong>${escHtml(cand.nombre)}</strong>? Se sobrescribirá la evaluación anterior.`, 'Sí, re-evaluar', 'btn-primary');
    if (!ok) return;
  }

  state.currentCandidateId = candidateId;
  state.currentCandidateData = cand;
  state.requirementsState = {};

  // Si ya fue evaluado, pre-marcar todos los requisitos como cumplidos
  if (cand.estado === 'evaluado' && cand.requisitos_excluyentes) {
    Object.values(cand.requisitos_excluyentes).forEach((r, i) => {
      if (r.cumple) state.requirementsState[i] = true;
    });
  }

  // Banner candidato
  document.getElementById('req-candidate-info').innerHTML = candidateBanner(cand);

  // Render checklist
  renderRequirements();

  openModal('modal-requirements');
}

async function reEvaluateDescalificado(candidateId) {
  const ok = await confirm2('Re-evaluar candidato', 'Este candidato estaba descalificado. Al re-evaluar se borrará su estado anterior y podrá volver a pasar por requisitos y evaluación. ¿Continuar?', 'Sí, re-evaluar', 'btn-primary');
  if (!ok) return;

  showLoading(true, 'Reiniciando candidato...');
  try {
    await db.collection('candidatos').doc(candidateId).update({
      estado: 'pendiente',
      evaluacion: firebase.firestore.FieldValue.delete(),
      requisitos_excluyentes: firebase.firestore.FieldValue.delete(),
      fecha_evaluacion: firebase.firestore.FieldValue.delete()
    });
    showToast('Candidato reiniciado. Ya puede evaluarlo nuevamente.', 'success');
    await loadCandidates();
  } catch (err) {
    showToast('Error al reiniciar: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function renderRequirements() {
  const reqs = state.config.requisitos_excluyentes;
  const list = document.getElementById('req-checklist');
  list.innerHTML = reqs.map((req, i) => {
    const checked = !!state.requirementsState[i];
    return `
      <div class="req-item ${checked ? 'checked' : ''}" id="req-item-${i}" onclick="toggleRequirement(${i})">
        <div class="req-checkbox">${checked ? '✓' : ''}</div>
        <span class="req-label">${escHtml(req)}</span>
      </div>`;
  }).join('');
  updateRequirementsStatus();
}

function toggleRequirement(index) {
  state.requirementsState[index] = !state.requirementsState[index];
  const item = document.getElementById(`req-item-${index}`);
  const box = item.querySelector('.req-checkbox');
  if (state.requirementsState[index]) {
    item.classList.add('checked');
    box.textContent = '✓';
  } else {
    item.classList.remove('checked');
    box.textContent = '';
  }
  updateRequirementsStatus();
}

function updateRequirementsStatus() {
  const reqs = state.config.requisitos_excluyentes;
  const total = reqs.length;
  const checked = Object.values(state.requirementsState).filter(Boolean).length;
  const allOk = checked === total;
  const statusBox = document.getElementById('req-status');
  const btnCont = document.getElementById('btn-continue');
  const btnDisq = document.getElementById('btn-disqualify');

  if (allOk) {
    statusBox.innerHTML = `<div class="req-status-box all-ok">✅ Todos los requisitos cumplidos. El candidato puede continuar a evaluación.</div>`;
    btnCont.disabled = false;
    btnDisq.style.display = 'none';
  } else {
    const missing = total - checked;
    statusBox.innerHTML = `<div class="req-status-box missing">⚠️ Faltan ${missing} requisito(s). Si no se pueden cumplir, el candidato queda descalificado.</div>`;
    btnCont.disabled = true;
    btnDisq.style.display = 'inline-flex';
  }
}

// ══════════════════════════════════════════════════
// MODAL — EVALUACIÓN DE PUNTAJE
// ══════════════════════════════════════════════════
async function openEvaluationModal() {
  closeModal('modal-requirements');

  const cand = state.currentCandidateData;
  document.getElementById('eval-candidate-info').innerHTML = candidateBanner(cand);

  // Inicializar datos de evaluación
  initEvaluationData(cand);

  // Renderizar criterios
  await renderCriteria();

  openModal('modal-evaluation');
}

function initEvaluationData(cand) {
  const cfg = state.config.criterios;

  // Si el candidato ya tiene evaluación, pre-cargar esos datos
  if (cand.estado === 'evaluado' && cand.evaluacion) {
    state.evaluationData = JSON.parse(JSON.stringify(cand.evaluacion));
    // Limpiar puntaje_total del objeto (se recalcula)
    delete state.evaluationData.puntaje_total;
    delete state.evaluationData.fecha_evaluacion;
  } else {
    state.evaluationData = {
      formacion: { opcion: '', porcentaje_asignado: 0, puntaje_ponderado: 0, otro_texto: '' },
      capacitacion: { opcion: '', porcentaje_asignado: 0, puntaje_ponderado: 0, otro_texto: '' },
      precio: { monto: 1300000, porcentaje_asignado: 40, puntaje_ponderado: 40, es_manual: false },
      experiencia: { opcion: '', porcentaje_asignado: 0, puntaje_ponderado: 0 }
    };
  }
}

async function renderCriteria() {
  const cfg = state.config.criterios;
  const container = document.getElementById('criteria-container');
  const ev = state.evaluationData;

  // Obtener precio mínimo actual de Firestore
  const minPrice = await getMinPrice(state.currentCandidateId);

  container.innerHTML = `<div class="criteria-list">
    ${renderFormacionCriterion(cfg.formacion, ev.formacion)}
    ${renderCapacitacionCriterion(cfg.capacitacion, ev.capacitacion)}
    ${renderPrecioCriterion(cfg.precio, ev.precio, minPrice)}
    ${renderExperienciaCriterion(cfg.experiencia, ev.experiencia)}
  </div>`;

  // Calcular puntaje inicial
  updateAllScores();
}

function renderFormacionCriterion(cfg, val) {
  const peso = cfg.peso_maximo;
  const opts = cfg.opciones.map(o =>
    `<option value="${escHtml(o.texto)}" data-pct="${o.porcentaje_default}" ${val.opcion === o.texto ? 'selected' : ''}>${escHtml(o.texto)}</option>`
  ).join('');
  const curPct = parseFloat(val.porcentaje_asignado) || 0;
  const curScore = parseFloat(val.puntaje_ponderado) || 0;
  const showOtro = val.opcion === 'Otros';

  return `
    <div class="criterion-card">
      <div class="criterion-header">
        <h4><span class="criterion-letter">A</span> Formación Académica</h4>
        <span class="criterion-weight">Peso máx. ${peso}%</span>
      </div>
      <div class="criterion-body">
        <div class="form-group">
          <label class="form-label">Nivel de formación</label>
          <select class="form-control" id="crit-formacion-select" onchange="onFormacionChange()">
            <option value="">-- Seleccione --</option>
            ${opts}
          </select>
        </div>
        <div id="formacion-otro-wrap" class="form-group otros-texto-field" style="${showOtro ? '' : 'display:none'}">
          <label class="form-label">Descripción (Otros)</label>
          <input class="form-control" type="text" id="crit-formacion-otro" placeholder="Describa la formación" value="${escHtml(val.otro_texto || '')}" />
        </div>
        <div class="criterion-row">
          <div class="form-group">
            <label class="form-label">Puntaje asignado (máx. ${peso} pts)</label>
            <div class="pct-input-group">
              <input class="form-control" type="number" id="crit-formacion-pct" min="0" max="${peso}" step="0.5" value="${curPct}" onchange="onPctManualChange('formacion', ${peso})" oninput="onPctManualChange('formacion', ${peso})" />
              <span class="pct-symbol">pts</span>
            </div>
          </div>
          <div class="criterion-score-row" style="margin-top:auto">
            <span class="criterion-score-label">Puntaje ponderado</span>
            <span class="criterion-score-val" id="crit-formacion-score">${curScore.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

function renderCapacitacionCriterion(cfg, val) {
  const peso = cfg.peso_maximo;
  const opts = cfg.opciones.map(o =>
    `<option value="${escHtml(o.texto)}" data-pct="${o.porcentaje_default}" ${val.opcion === o.texto ? 'selected' : ''}>${escHtml(o.texto)}</option>`
  ).join('');
  const curPct = parseFloat(val.porcentaje_asignado) || 0;
  const curScore = parseFloat(val.puntaje_ponderado) || 0;
  const showOtro = val.opcion === 'Otro';

  return `
    <div class="criterion-card">
      <div class="criterion-header">
        <h4><span class="criterion-letter">B</span> Capacitación (Disposición de Tiempo)</h4>
        <span class="criterion-weight">Peso máx. ${peso}%</span>
      </div>
      <div class="criterion-body">
        <div class="form-group">
          <label class="form-label">Horas disponibles</label>
          <select class="form-control" id="crit-capacitacion-select" onchange="onCapacitacionChange()">
            <option value="">-- Seleccione --</option>
            ${opts}
          </select>
        </div>
        <div id="capacitacion-otro-wrap" class="form-group otros-texto-field" style="${showOtro ? '' : 'display:none'}">
          <label class="form-label">Descripción (Otro)</label>
          <input class="form-control" type="text" id="crit-capacitacion-otro" placeholder="Describa la disponibilidad" value="${escHtml(val.otro_texto || '')}" />
        </div>
        <div class="criterion-row">
          <div class="form-group">
            <label class="form-label">Puntaje asignado (máx. ${peso} pts)</label>
            <div class="pct-input-group">
              <input class="form-control" type="number" id="crit-capacitacion-pct" min="0" max="${peso}" step="0.5" value="${curPct}" onchange="onPctManualChange('capacitacion', ${peso})" oninput="onPctManualChange('capacitacion', ${peso})" />
              <span class="pct-symbol">pts</span>
            </div>
          </div>
          <div class="criterion-score-row" style="margin-top:auto">
            <span class="criterion-score-label">Puntaje ponderado</span>
            <span class="criterion-score-val" id="crit-capacitacion-score">${curScore.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

function renderPrecioCriterion(cfg, val, minPrice) {
  const peso = cfg.peso_maximo;  // 40
  const curPct = parseFloat(val.porcentaje_asignado) || 0;
  const curScore = parseFloat(val.puntaje_ponderado) || 0;

  return `
    <div class="criterion-card">
      <div class="criterion-header">
        <h4><span class="criterion-letter">C</span> Precio Cotizado</h4>
        <span class="criterion-weight">Peso máx. ${peso} pts</span>
      </div>
      <div class="criterion-body">
        <div class="form-group">
          <label class="form-label">Monto cotizado (₡ colones)</label>
          <input class="form-control" type="number" id="crit-precio-monto" min="1" step="1" placeholder="Ej. 1300000" value="${val.monto || ''}" />
          <span class="form-hint">Ingrese el monto total de la propuesta económica</span>
        </div>
        <div class="criterion-row">
          <div class="form-group">
            <label class="form-label">Puntaje asignado (máx. ${peso} pts)</label>
            <div class="pct-input-group">
              <input class="form-control" type="number" id="crit-precio-pct" min="0" max="${peso}" step="0.5" value="${curPct}" onchange="onPctManualChange('precio', ${peso})" oninput="onPctManualChange('precio', ${peso})" />
              <span class="pct-symbol">pts</span>
            </div>
          </div>
          <div class="criterion-score-row" style="margin-top:auto">
            <span class="criterion-score-label">Puntaje parcial</span>
            <span class="criterion-score-val" id="crit-precio-score">${curScore.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

function renderExperienciaCriterion(cfg, val) {
  const peso = cfg.peso_maximo;
  const opts = cfg.opciones.map(o =>
    `<option value="${escHtml(o.texto)}" data-pct="${o.porcentaje_default}" ${val.opcion === o.texto ? 'selected' : ''}>${escHtml(o.texto)}</option>`
  ).join('');
  const curPct = parseFloat(val.porcentaje_asignado) || 0;
  const curScore = parseFloat(val.puntaje_ponderado) || 0;

  return `
    <div class="criterion-card">
      <div class="criterion-header">
        <h4><span class="criterion-letter">D</span> Experiencia Laboral</h4>
        <span class="criterion-weight">Peso máx. ${peso}%</span>
      </div>
      <div class="criterion-body">
        <div class="form-group">
          <label class="form-label">Años de experiencia</label>
          <select class="form-control" id="crit-experiencia-select" onchange="onExperienciaChange()">
            <option value="">-- Seleccione --</option>
            ${opts}
          </select>
        </div>
        <div class="criterion-row">
          <div class="form-group">
            <label class="form-label">Puntaje asignado (máx. ${peso} pts)</label>
            <div class="pct-input-group">
              <input class="form-control" type="number" id="crit-experiencia-pct" min="0" max="${peso}" step="0.5" value="${curPct}" onchange="onPctManualChange('experiencia', ${peso})" oninput="onPctManualChange('experiencia', ${peso})" />
              <span class="pct-symbol">pts</span>
            </div>
          </div>
          <div class="criterion-score-row" style="margin-top:auto">
            <span class="criterion-score-label">Puntaje ponderado</span>
            <span class="criterion-score-val" id="crit-experiencia-score">${curScore.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Handlers de criterios ────────────────────────
function onFormacionChange() {
  const sel = document.getElementById('crit-formacion-select');
  const pctIn = document.getElementById('crit-formacion-pct');
  const opt = sel.options[sel.selectedIndex];
  const pct = parseFloat(opt.dataset.pct) || 0;
  const texto = opt.value;
  pctIn.value = pct;
  const otroWrap = document.getElementById('formacion-otro-wrap');
  otroWrap.style.display = (texto === 'Otros') ? '' : 'none';
  updateCriterionScore('formacion', state.config.criterios.formacion.peso_maximo);
}

function onCapacitacionChange() {
  const sel = document.getElementById('crit-capacitacion-select');
  const pctIn = document.getElementById('crit-capacitacion-pct');
  const opt = sel.options[sel.selectedIndex];
  const pct = parseFloat(opt.dataset.pct) || 0;
  const texto = opt.value;
  pctIn.value = pct;
  const otroWrap = document.getElementById('capacitacion-otro-wrap');
  otroWrap.style.display = (texto === 'Otro') ? '' : 'none';
  updateCriterionScore('capacitacion', state.config.criterios.capacitacion.peso_maximo);
}

function onExperienciaChange() {
  const sel = document.getElementById('crit-experiencia-select');
  const pctIn = document.getElementById('crit-experiencia-pct');
  const opt = sel.options[sel.selectedIndex];
  const pct = parseFloat(opt.dataset.pct) || 0;
  pctIn.value = pct;
  updateCriterionScore('experiencia', state.config.criterios.experiencia.peso_maximo);
}

function onPctManualChange(criterio, pesoMax) {
  updateCriterionScore(criterio, pesoMax);
}

async function onMontoChange() {
  const montoInput = document.getElementById('crit-precio-monto');
  const monto = parseFloat(montoInput.value);
  const isManual = document.getElementById('precio-manual-check').checked;

  if (!isManual && monto > 0) {
    const minPrice = await getMinPrice(state.currentCandidateId);
    const peso = state.config.criterios.precio.peso_maximo;
    const autoPct = minPrice ? Math.min((minPrice / monto) * peso, peso) : 0;
    document.getElementById('precio-auto-pct').textContent = autoPct.toFixed(4) + '%';
    document.getElementById('crit-precio-pct').value = autoPct.toFixed(4);
  }
  updateCriterionScore('precio', state.config.criterios.precio.peso_maximo);
}

function onPrecioPctChange(pesoMax) {
  // Si el usuario cambia manualmente, activar override
  document.getElementById('precio-manual-check').checked = true;
  document.getElementById('precio-manual-tag').style.display = '';
  updateCriterionScore('precio', pesoMax);
}

function onPrecioManualToggle(pesoMax) {
  const isManual = document.getElementById('precio-manual-check').checked;
  document.getElementById('precio-manual-tag').style.display = isManual ? '' : 'none';
  if (!isManual) {
    // Re-calcular automáticamente
    onMontoChange();
  }
}

async function recalcularPrecioManual() {
  const montoInput = document.getElementById('crit-precio-monto');
  const monto = parseFloat(montoInput.value);
  if (!monto || monto <= 0) { showToast('Ingrese primero el monto cotizado', 'warning'); return; }
  showLoading(true, 'Consultando precios...');
  try {
    const minPrice = await getMinPrice(state.currentCandidateId);
    const peso = state.config.criterios.precio.peso_maximo;
    const autoPct = minPrice ? Math.min((minPrice / monto) * peso, peso) : 0;
    document.getElementById('precio-auto-pct').textContent = autoPct.toFixed(4) + '%';
    document.getElementById('crit-precio-pct').value = autoPct.toFixed(4);
    document.getElementById('precio-manual-check').checked = false;
    document.getElementById('precio-manual-tag').style.display = 'none';
    updateCriterionScore('precio', peso);
    const mpLabel = minPrice ? `Precio mínimo: ₡${numberFormat(minPrice)}` : 'Sin datos previos';
    showToast(`Recalculado. ${mpLabel}`, 'info');
  } finally {
    showLoading(false);
  }
}

function updateCriterionScore(criterio, pesoMax) {
  const pctInput = document.getElementById(`crit-${criterio}-pct`);
  const scoreEl = document.getElementById(`crit-${criterio}-score`);
  if (!pctInput || !scoreEl) return;
  let pct = parseFloat(pctInput.value) || 0;
  if (pct > pesoMax) {
    pct = pesoMax;
    pctInput.value = pesoMax;
  }
  if (pct < 0) pct = 0;
  // El puntaje ponderado es directamente el valor ingresado (limitado al peso máximo)
  const score = pct;
  scoreEl.textContent = score.toFixed(2);
  updateTotalScore();
}

function updateAllScores() {
  const cfg = state.config.criterios;
  ['formacion', 'capacitacion', 'experiencia'].forEach(c => {
    updateCriterionScore(c, cfg[c].peso_maximo);
  });
  updateCriterionScore('precio', cfg.precio.peso_maximo);
}

function updateTotalScore() {
  const criterios = ['formacion', 'capacitacion', 'precio', 'experiencia'];
  let total = 0;
  criterios.forEach(c => {
    const el = document.getElementById(`crit-${c}-score`);
    if (el) total += parseFloat(el.textContent) || 0;
  });
  const el = document.getElementById('total-score-display');
  if (el) el.textContent = total.toFixed(2);
}

// ── Leer formulario y armar objeto de evaluación ──
function readEvaluationForm() {
  const cfg = state.config.criterios;

  // Formación
  const fSel = document.getElementById('crit-formacion-select');
  const fPct = parseFloat(document.getElementById('crit-formacion-pct').value) || 0;
  const fPeso = cfg.formacion.peso_maximo;
  const fOtro = document.getElementById('crit-formacion-otro')?.value || '';
  if (!fSel.value) { showToast('Seleccione una opción en Formación', 'error'); return null; }

  // Capacitación
  const cSel = document.getElementById('crit-capacitacion-select');
  const cPct = parseFloat(document.getElementById('crit-capacitacion-pct').value) || 0;
  const cPeso = cfg.capacitacion.peso_maximo;
  const cOtro = document.getElementById('crit-capacitacion-otro')?.value || '';
  if (!cSel.value) { showToast('Seleccione una opción en Capacitación', 'error'); return null; }

  // Precio
  const pMonto = parseFloat(document.getElementById('crit-precio-monto').value) || 0;
  const pPct = parseFloat(document.getElementById('crit-precio-pct').value) || 0;
  const pPeso = cfg.precio.peso_maximo;
  if (!pMonto || pMonto <= 0) { showToast('Ingrese el monto cotizado en Precio', 'error'); return null; }

  // Experiencia
  const eSel = document.getElementById('crit-experiencia-select');
  const ePct = parseFloat(document.getElementById('crit-experiencia-pct').value) || 0;
  const ePeso = cfg.experiencia.peso_maximo;
  if (!eSel.value) { showToast('Seleccione una opción en Experiencia', 'error'); return null; }

  const fScore = Math.min(fPct, fPeso);
  const cScore = Math.min(cPct, cPeso);
  const pScore = Math.min(pPct, pPeso);
  const eScore = Math.min(ePct, ePeso);
  const total = fScore + cScore + pScore + eScore;

  return {
    formacion: { opcion: fSel.value, porcentaje_asignado: fPct, puntaje_ponderado: parseFloat(fScore.toFixed(4)), otro_texto: fOtro },
    capacitacion: { opcion: cSel.value, porcentaje_asignado: cPct, puntaje_ponderado: parseFloat(cScore.toFixed(4)), otro_texto: cOtro },
    precio: { monto: pMonto, porcentaje_asignado: pPct, puntaje_ponderado: parseFloat(pScore.toFixed(4)) },
    experiencia: { opcion: eSel.value, porcentaje_asignado: ePct, puntaje_ponderado: parseFloat(eScore.toFixed(4)) },
    puntaje_total: parseFloat(total.toFixed(4))
  };
}

// ── Precio mínimo ────────────────────────────────
async function getMinPrice(excludeCandidateId = null) {
  try {
    const snap = await db.collection('candidatos').where('estado', '==', 'evaluado').get();
    const prices = snap.docs
      .filter(d => d.id !== excludeCandidateId)
      .map(d => d.data().evaluacion?.precio?.monto)
      .filter(p => p && p > 0);
    // También incluir candidatos con estado pendiente si tienen monto... no, solo evaluados

    // Además incluir el precio que está siendo ingresado actualmente si corresponde
    const montoInput = document.getElementById('crit-precio-monto');
    if (montoInput) {
      const monto = parseFloat(montoInput.value);
      if (monto > 0) prices.push(monto);
    }

    return prices.length > 0 ? Math.min(...prices) : null;
  } catch (err) {
    console.warn('Error obteniendo precio mínimo:', err);
    return null;
  }
}

// ══════════════════════════════════════════════════
// MODAL — DETALLE DE EVALUACIÓN
// ══════════════════════════════════════════════════
function openDetailModal(candidateId) {
  const cand = state.candidates.find(c => c.id === candidateId);
  if (!cand || !cand.evaluacion) return;

  const ev = cand.evaluacion;
  const cfg = state.config.criterios;

  document.getElementById('detail-body').innerHTML = `
    ${candidateBanner(cand)}
    <div class="detail-criteria">
      ${detailRow('A) Formación', ev.formacion?.opcion || '—', ev.formacion?.porcentaje_asignado || 0, ev.formacion?.puntaje_ponderado || 0, cfg.formacion.peso_maximo, ev.formacion?.otro_texto)}
      ${detailRow('B) Capacitación', ev.capacitacion?.opcion || '—', ev.capacitacion?.porcentaje_asignado || 0, ev.capacitacion?.puntaje_ponderado || 0, cfg.capacitacion.peso_maximo, ev.capacitacion?.otro_texto)}
      ${detailRowPrecio(ev.precio, cfg.precio.peso_maximo)}
      ${detailRow('D) Experiencia', ev.experiencia?.opcion || '—', ev.experiencia?.porcentaje_asignado || 0, ev.experiencia?.puntaje_ponderado || 0, cfg.experiencia.peso_maximo)}
    </div>
    <div class="detail-total">
      <span class="detail-total-label">Puntaje Total</span>
      <span class="detail-total-val">${(ev.puntaje_total || 0).toFixed(2)} <span style="font-size:.9rem;opacity:.6">/ 100</span></span>
    </div>`;

  openModal('modal-detail');
}

function detailRow(label, opcion, pct, score, pesoMax, otroTexto) {
  const desc = (otroTexto && opcion.toLowerCase().includes('otro')) ? `${opcion} — ${otroTexto}` : opcion;
  return `
    <div class="detail-criterion">
      <div>
        <div class="detail-crit-name">${label}</div>
        <div class="detail-crit-val">${escHtml(desc)}</div>
        <div class="detail-crit-pct">${pct}% asignado de un máximo de ${pesoMax}%</div>
      </div>
      <div class="detail-crit-score">${(score || 0).toFixed(2)}</div>
    </div>`;
}

function detailRowPrecio(precio, pesoMax) {
  if (!precio) return detailRow('C) Precio', 'Sin datos', 0, 0, pesoMax);
  const monto = precio.monto ? `₡${numberFormat(precio.monto)}` : '—';
  // Eliminamos la variable 'tag' y cualquier referencia a es_manual
  return `
    <div class="detail-criterion">
      <div>
        <div class="detail-crit-name">C) Precio Cotizado</div>
        <div class="detail-crit-val">Monto: ${monto}</div>
        <div class="detail-crit-pct">${(precio.porcentaje_asignado || 0).toFixed(4)} pts asignados de ${pesoMax} pts</div>
      </div>
      <div class="detail-crit-score">${(precio.puntaje_ponderado || 0).toFixed(2)}</div>
    </div>`;
}

// ══════════════════════════════════════════════════
// PÁGINA DE RESULTADOS
// ══════════════════════════════════════════════════
async function renderResults() {
  if (!state.firebaseReady) return;
  showLoading(true, 'Cargando resultados...');
  try {
    await loadCandidates();
    const evaluados = state.candidates.filter(c => c.estado === 'evaluado');
    const descalificados = state.candidates.filter(c => c.estado === 'descalificado');
    const pendientes = state.candidates.filter(c => c.estado === 'pendiente');

    evaluados.sort((a, b) => (b.evaluacion?.puntaje_total || 0) - (a.evaluacion?.puntaje_total || 0));

    const container = document.getElementById('results-container');

    if (state.candidates.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📊</div><h3>Sin datos</h3><p>No hay candidatos registrados aún.</p></div>`;
      return;
    }

    container.innerHTML = `
      <div class="results-summary">
        <div class="summary-card">
          <div class="summary-num">${state.candidates.length}</div>
          <div class="summary-label">Total candidatos</div>
        </div>
        <div class="summary-card">
          <div class="summary-num" style="color:var(--emerald)">${evaluados.length}</div>
          <div class="summary-label">Evaluados</div>
        </div>
        <div class="summary-card">
          <div class="summary-num" style="color:var(--amber)">${pendientes.length}</div>
          <div class="summary-label">Pendientes</div>
        </div>
        <div class="summary-card">
          <div class="summary-num" style="color:var(--crimson)">${descalificados.length}</div>
          <div class="summary-label">Descalificados</div>
        </div>
      </div>

      ${evaluados.length > 0 ? rankingTable(evaluados) : '<p style="color:var(--text-muted);padding:20px 0">No hay candidatos evaluados aún.</p>'}
      ${descalificados.length > 0 ? descalificadosSection(descalificados) : ''}
    `;
  } finally {
    showLoading(false);
  }
}

function rankingTable(evaluados) {
  const medalClass = i => i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'other';
  const medalEmoji = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;

  const rows = evaluados.map((c, i) => `
    <tr>
      <td><span class="rank-medal ${medalClass(i)}">${medalEmoji(i)}</span></td>
      <td><div class="rank-name">${escHtml(c.nombre)}</div><div class="rank-cedula">${escHtml(c.cedula)}</div></td>
      <td><span class="rank-score">${(c.evaluacion?.puntaje_total || 0).toFixed(2)}</span></td>
      <td style="text-align:center"><button class="btn btn-secondary btn-sm" onclick="openDetailModal('${c.id}')">🔍 Ver detalle</button></td>
    </tr>`).join('');

  return `
    <div class="ranking-table-wrap">
      <table class="ranking-table">
        <thead>
          <tr>
            <th style="width:60px">Lugar</th>
            <th>Candidato</th>
            <th>Puntaje Total</th>
            <th style="text-align:center">Detalle</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function descalificadosSection(lista) {
  const items = lista.map(c => `
    <div class="disqualified-item">
      <span>❌</span>
      <span>${escHtml(c.nombre)} — ${escHtml(c.cedula)}</span>
    </div>`).join('');
  return `
    <div class="disqualified-section">
      <div class="disqualified-header">❌ Candidatos Descalificados (${lista.length})</div>
      <div class="disqualified-list">${items}</div>
    </div>`;
}

// ══════════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════════
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const navBtn = document.getElementById('nav-' + page);
  if (navBtn) navBtn.classList.add('active');
  if (page === 'results') renderResults();
}

// ══════════════════════════════════════════════════
// MODALES
// ══════════════════════════════════════════════════
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  // Restaurar scroll si no hay otros modales abiertos
  const anyOpen = document.querySelectorAll('.modal-overlay:not(.hidden)').length > 0;
  if (!anyOpen) document.body.style.overflow = '';
}

function confirmCloseEvaluation() {
  confirm2('Cancelar evaluación', '¿Desea cancelar la evaluación? Los cambios no guardados se perderán.', 'Sí, cancelar', 'btn-danger')
    .then(ok => { if (ok) closeModal('modal-evaluation'); });
}

// Promise-based confirm
function confirm2(title, msgHtml, okLabel = 'Confirmar', okClass = 'btn-primary') {
  return new Promise(resolve => {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').innerHTML = msgHtml;
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    okBtn.textContent = okLabel;
    okBtn.className = 'btn ' + okClass;
    openModal('modal-confirm');
    const cleanup = (val) => {
      closeModal('modal-confirm');
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      resolve(val);
    };
    okBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
  });
}

// ══════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════
function showLoading(show, msg = 'Cargando...') {
  const el = document.getElementById('loading-overlay');
  if (show) {
    el.querySelector('p').textContent = msg;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function showToast(message, type = 'info', duration = 4000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
    <span class="toast-msg">${escHtml(message)}</span>
    <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 260);
  }, duration);
}

function showFirebaseError(msg) {
  const banner = document.getElementById('firebase-error-banner');
  banner.innerHTML = `
    <div class="error-card">
      <span class="error-card-icon">🔥</span>
      <div>
        <div class="error-card-title">Error de configuración Firebase</div>
        <div class="error-card-text">${escHtml(msg)}<br>Por favor revise las instrucciones en el archivo <code>firebase-config.js</code>.</div>
      </div>
    </div>`;
  showLoading(false);
}

function candidateBanner(cand) {
  const initials = cand.nombre.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  return `
    <div class="candidate-banner">
      <div class="banner-avatar">${initials}</div>
      <div>
        <div class="banner-name">${escHtml(cand.nombre)}</div>
        <div class="banner-cedula">Cédula: ${escHtml(cand.cedula)}</div>
      </div>
    </div>`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function numberFormat(n) {
  return new Intl.NumberFormat('es-CR').format(n);
}

// ══════════════════════════════════════════════════
// KEYBOARD
// ══════════════════════════════════════════════════
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // Cerrar el modal más reciente abierto
    const modals = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
    if (modals.length > 0) {
      const last = modals[modals.length - 1];
      if (last.id === 'modal-evaluation') { confirmCloseEvaluation(); }
      else { closeModal(last.id); }
    }
  }
  // Enter en el modal de agregar candidato
  if (e.key === 'Enter' && !document.getElementById('modal-add').classList.contains('hidden')) {
    saveNewCandidate();
  }
});



// ══════════════════════════════════════════════════
// PDF
// ══════════════════════════════════════════════════
async function exportToPDF() {
  // Asegurar que los datos estén actualizados
  if (!state.firebaseReady) {
    showToast('Aún cargando datos, intente de nuevo', 'warning');
    return;
  }
  showLoading(true, 'Preparando reporte...');
  await loadCandidates(); // Recargar para tener datos frescos
  showLoading(false);

  if (!state.candidates.length) {
    showToast('No hay datos para exportar', 'warning');
    return;
  }

  const evaluados = state.candidates.filter(c => c.estado === 'evaluado');
  const descalificados = state.candidates.filter(c => c.estado === 'descalificado');
  evaluados.sort((a, b) => (b.evaluacion?.puntaje_total || 0) - (a.evaluacion?.puntaje_total || 0));

  const fecha = new Date().toLocaleString('es-CR');

  // Función para obtener los requisitos NO cumplidos de un candidato descalificado
  function getRequisitosNoCumplidos(cand) {
    if (!cand.requisitos_excluyentes) return [];
    const noCumple = [];
    Object.values(cand.requisitos_excluyentes).forEach(item => {
      if (item && item.cumple === false) {
        noCumple.push(item.texto || 'Requisito sin descripción');
      }
    });
    return noCumple;
  }

  let htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Reporte de Evaluación - Tesorero Contador</title>
      <style>
        body { font-family: 'Outfit', 'Segoe UI', sans-serif; margin: 40px; color: #0f2340; line-height: 1.4; }
        h1 { color: #0f2340; border-bottom: 2px solid #2056c0; padding-bottom: 8px; }
        h2 { color: #1e3a5f; margin-top: 28px; border-left: 4px solid #2056c0; padding-left: 12px; }
        h3 { color: #2056c0; margin-top: 16px; font-size: 1.1rem; }
        .summary { display: flex; gap: 20px; margin: 20px 0; flex-wrap: wrap; }
        .summary-card { background: #f0f4f8; padding: 12px 20px; border-radius: 12px; text-align: center; min-width: 100px; }
        .summary-num { font-size: 28px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        th, td { border: 1px solid #b8c4d8; padding: 10px; text-align: left; vertical-align: top; }
        th { background: #1e3a5f; color: white; }
        .candidato-detalle { margin-bottom: 24px; border: 1px solid #dde3ed; border-radius: 10px; padding: 16px; background: #fefefe; }
        .candidato-detalle h3 { margin-top: 0; }
        .badge-cumple { color: #047857; font-weight: bold; }
        .badge-no-cumple { color: #b91c1c; font-weight: bold; }
        .requisitos-lista { margin: 8px 0 0 20px; }
        .footer { margin-top: 40px; font-size: 0.75rem; text-align: center; color: #8899b0; border-top: 1px solid #e2e8f0; padding-top: 16px; }
      </style>
    </head>
    <body>
      <h1>Junta de Educación Escuela El Carmen</h1>
      <h2>Evaluación de Candidatos a Tesorero-Contador</h2>
      <p><strong>Fecha de reporte:</strong> ${fecha}</p>

      <div class="summary">
        <div class="summary-card"><div class="summary-num">${state.candidates.length}</div><div>Total candidatos</div></div>
        <div class="summary-card"><div class="summary-num" style="color:#047857">${evaluados.length}</div><div>Evaluados</div></div>
        <div class="summary-card"><div class="summary-num" style="color:#b45309">${descalificados.length}</div><div>Descalificados</div></div>
      </div>

      <h2>🏆 Ranking de Candidatos Evaluados</h2>
      <table>
        <thead><tr><th>Lugar</th><th>Nombre</th><th>Cédula</th><th>Puntaje Total</th><th>Formación</th><th>Capacitación</th><th>Precio</th><th>Experiencia</th></tr></thead>
        <tbody>
  `;

  evaluados.forEach((c, idx) => {
    const ev = c.evaluacion;
    const lugar = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
    htmlContent += `<tr>
      <td>${lugar}</td>
      <td>${escHtml(c.nombre)}</td>
      <td>${escHtml(c.cedula)}</td>
      <td><strong>${(ev.puntaje_total || 0).toFixed(2)}</strong></td>
      <td>${ev.formacion?.porcentaje_asignado || 0} pts</td>
      <td>${ev.capacitacion?.porcentaje_asignado || 0} pts</td>
      <td>${ev.precio?.porcentaje_asignado || 0} pts</td>
      <td>${ev.experiencia?.porcentaje_asignado || 0} pts</td>
    </tr>`;
  });

  htmlContent += `</tbody></table>`;

  // --- Desglose detallado de CANDIDATOS EVALUADOS ---
  htmlContent += `<h2>📋 Desglose de Candidatos Evaluados</h2>`;
  evaluados.forEach(c => {
    const ev = c.evaluacion;
    htmlContent += `
      <div class="candidato-detalle">
        <h3>${escHtml(c.nombre)} (Cédula: ${escHtml(c.cedula)})</h3>
        <p><strong>Puntaje total:</strong> ${(ev.puntaje_total || 0).toFixed(2)} / 100</p>
        <p><strong>✅ Requisitos excluyentes:</strong> Cumplidos todos (superó la etapa de verificación).</p>
        <p><strong>📊 Puntajes por criterio:</strong></p>
        <ul>
          <li><strong>Formación:</strong> ${ev.formacion?.opcion || '—'} → ${ev.formacion?.porcentaje_asignado || 0} pts (máx 20 pts)</li>
          <li><strong>Capacitación:</strong> ${ev.capacitacion?.opcion || '—'} → ${ev.capacitacion?.porcentaje_asignado || 0} pts (máx 15 pts)</li>
          <li><strong>Precio cotizado:</strong> ₡${numberFormat(ev.precio?.monto || 0)} → ${ev.precio?.porcentaje_asignado || 0} pts (máx 40 pts)</li>
          <li><strong>Experiencia:</strong> ${ev.experiencia?.opcion || '—'} → ${ev.experiencia?.porcentaje_asignado || 0} pts (máx 25 pts)</li>
        </ul>
        ${ev.formacion?.otro_texto ? `<p><strong>Observación formación:</strong> ${escHtml(ev.formacion.otro_texto)}</p>` : ''}
        ${ev.capacitacion?.otro_texto ? `<p><strong>Observación capacitación:</strong> ${escHtml(ev.capacitacion.otro_texto)}</p>` : ''}
      </div>
    `;
  });

  // --- CANDIDATOS DESCALIFICADOS con razones ---
  if (descalificados.length > 0) {
    htmlContent += `<h2>❌ Candidatos Descalificados</h2>`;
    descalificados.forEach(c => {
      const noCumple = getRequisitosNoCumplidos(c);
      htmlContent += `
        <div class="candidato-detalle" style="border-left-color: #b91c1c;">
          <h3>${escHtml(c.nombre)} (Cédula: ${escHtml(c.cedula)})</h3>
          <p><span class="badge-no-cumple">❌ No superó la verificación de requisitos excluyentes.</span></p>
          ${noCumple.length > 0 ? `
            <p><strong>Requisitos NO cumplidos:</strong></p>
            <ul class="requisitos-lista">
              ${noCumple.map(r => `<li>❌ ${escHtml(r)}</li>`).join('')}
            </ul>
          ` : '<p>No se registraron detalles de los requisitos faltantes.</p>'}
        </div>
      `;
    });
  } else {
    htmlContent += `<p>No hay candidatos descalificados.</p>`;
  }

  htmlContent += `<div class="footer">Este reporte fue generado automáticamente desde el Sistema de Evaluación de la Junta de Educación.</div>
    </body>
    </html>
  `;

  const ventana = window.open();
  ventana.document.write(htmlContent);
  ventana.document.close();

  ventana.document.title = `Reporte_Evaluacion_Tesorero_${new Date().toISOString().slice(0, 10)}`;

  ventana.print();
}

// ══════════════════════════════════════════════════
// ARRANCAR
// ══════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});
