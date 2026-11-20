// ============================================================================
// NEXORA SUITE - GESTIÓN FUNERARIA, PROFORMAS, OPERACIÓN Y CONTROL GERENCIAL
// ============================================================================
const SUPABASE_URL = 'https://fmsjkibcczmjsxoodzae.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JY2cBrl5RAp1dqbjgTC3SA_-DAKJknF';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentOrg = null;
let currentRole = 'admin';
let currentUserName = '';
let catalogoCache = [];
let clientesCache = [];
let serviciosCache = [];
let facturasCache = [];
let egresosCache = [];
let proformasCache = [];
let auditoriaCache = [];
let facturaItems = [];

let chartEvolucionInstance = null;
let chartGastosInstance = null;

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 3 * 60 * 1000;
let sessionTimeoutMinutes = 30;
let blurLockMinutes = 0;
let sessionExpiresAt = null;
let hiddenAtTimestamp = null;
let sessionTickerInterval = null;

const NOMBRES_MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const TAB_DESCRIPTIONS = {
    'tab-gerencial': 'Consolidado gerencial de ingresos, gastos, ganancias brutas e indicadores estadísticos por mes o por año',
    'tab-resumen': 'Estado operativo diario de servicios, salas de velación y alertas de inventario',
    'tab-proformas': 'Directorio de clientes con datos validados, emisión de facturas al cerrar trato y proformas por plan y categoría',
    'tab-servicios': 'Ejecución del servicio: contrato, búsqueda/retiro, laboratorio/estética/cofre, velación, inhumación o cremación y desinfección',
    'tab-inventario': 'Control de existencias de cofres, urnas y tarifario de servicios',
    'tab-finanzas': 'Seguimiento de ingresos, gastos operativos y ganancias brutas',
    'tab-configuracion': 'Parámetros de emisión, control de sesión, seguridad y usuarios'
};

const ETIQUETA_ETAPA_SERVICIO = {
    'CONTRATO_Y_COBRO': 'Contrato y Cobro Registrado',
    'TRAMITES_Y_ESTETICA': 'Búsqueda, Trámites y Laboratorio/Estética',
    'EN_VELACION': 'Aprobación Familiar, Sala y Velación',
    'SEPULTURA_Y_RECOJO': 'Inhumación / Cremación y Entrega',
    'FINALIZADO': 'Limpieza y Desinfección (Fin)'
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function mostrarFeedbackComercial(mensaje) {
    const box = document.getElementById('comercial-feedback');
    if (!box) return;
    box.innerText = mensaje;
    box.classList.remove('hidden');
    setTimeout(() => box.classList.add('hidden'), 6000);
}

// ============================================================================
// 1. AUTENTICACIÓN Y SEGURIDAD
// ============================================================================
window.evaluarFortalezaClave = (pwd) => {
    const bar = document.getElementById('pwd-meter-bar');
    const txt = document.getElementById('pwd-meter-text');
    if (!bar || !txt) return;

    let score = 0;
    if (pwd.length >= 8) score++;
    if (/[A-Z]/.test(pwd)) score++;
    if (/[a-z]/.test(pwd)) score++;
    if (/[0-9]/.test(pwd)) score++;
    if (/[^A-Za-z0-9]/.test(pwd)) score++;

    bar.style.width = `${Math.min(100, score * 20)}%`;
    if (score <= 2) {
        bar.style.backgroundColor = '#991b1b';
        txt.innerText = 'Nivel de seguridad: Débil';
    } else if (score <= 4) {
        bar.style.backgroundColor = '#92400e';
        txt.innerText = 'Nivel de seguridad: Intermedio';
    } else {
        bar.style.backgroundColor = '#166534';
        txt.innerText = 'Nivel de seguridad: Óptimo';
    }
};

function validarPoliticaClave(pwd) {
    return pwd.length >= 8 &&
        /[A-Z]/.test(pwd) &&
        /[a-z]/.test(pwd) &&
        /[0-9]/.test(pwd) &&
        /[^A-Za-z0-9]/.test(pwd);
}

function obtenerEstadoBloqueoLogin() {
    try {
        const raw = localStorage.getItem('nexora_login_guard');
        if (!raw) return { locked: false, remainingSec: 0, attempts: 0 };
        const st = JSON.parse(raw);
        if (st.lockedUntil && Date.now() < st.lockedUntil) {
            return {
                locked: true,
                remainingSec: Math.ceil((st.lockedUntil - Date.now()) / 1000),
                attempts: st.attempts || MAX_LOGIN_ATTEMPTS
            };
        }
        if (st.lockedUntil && Date.now() >= st.lockedUntil) {
            localStorage.removeItem('nexora_login_guard');
        }
        return { locked: false, remainingSec: 0, attempts: st.attempts || 0 };
    } catch {
        return { locked: false, remainingSec: 0, attempts: 0 };
    }
}

function registrarFalloLogin() {
    const cur = obtenerEstadoBloqueoLogin();
    const nextAttempts = (cur.attempts || 0) + 1;
    localStorage.setItem('nexora_login_guard', JSON.stringify({
        attempts: nextAttempts,
        lockedUntil: nextAttempts >= MAX_LOGIN_ATTEMPTS ? Date.now() + LOCKOUT_DURATION_MS : null
    }));
}

function limpiarFalloLogin() {
    localStorage.removeItem('nexora_login_guard');
}

document.getElementById('toggle-register').onclick = (e) => {
    e.preventDefault();
    document.getElementById('auth-alert').classList.add('hidden');
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
};

document.getElementById('toggle-login').onclick = (e) => {
    e.preventDefault();
    document.getElementById('auth-alert').classList.add('hidden');
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
};

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const lock = obtenerEstadoBloqueoLogin();
    if (lock.locked) {
        return showAlert(`Acceso bloqueado temporalmente por seguridad. Intente nuevamente en ${lock.remainingSec} segundos.`);
    }

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
        registrarFalloLogin();
        const after = obtenerEstadoBloqueoLogin();
        if (after.locked) {
            return showAlert(`Se superó el límite de intentos. Acceso bloqueado por ${Math.ceil(LOCKOUT_DURATION_MS / 60000)} minutos.`);
        }
        return showAlert(`Credenciales incorrectas (Intento ${after.attempts} de ${MAX_LOGIN_ATTEMPTS}).`);
    }
    limpiarFalloLogin();
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const empresa = document.getElementById('reg-empresa').value.trim();
    const ruc = document.getElementById('reg-ruc').value.trim();
    const direccion = document.getElementById('reg-direccion').value.trim();
    const nombre = document.getElementById('reg-nombre').value.trim();

    if (!validarPoliticaClave(password)) {
        return showAlert('La contraseña debe cumplir con mínimo 8 caracteres, mayúscula, minúscula, número y símbolo especial.');
    }

    const { data: authData, error: authErr } = await sb.auth.signUp({ email, password });
    if (authErr) return showAlert(authErr.message);
    if (!authData?.user?.id) return showAlert('No se pudo completar el registro del usuario.');

    const { error: rpcErr } = await sb.rpc('registrar_nueva_empresa', {
        p_user_id: authData.user.id,
        p_ruc: ruc,
        p_razon_social: empresa,
        p_direccion: direccion,
        p_nombre_admin: nombre
    });
    if (rpcErr) return showAlert('Error al registrar la organización: ' + rpcErr.message);

    await sb.from('usuarios_roles').update({ correo_contacto: email }).eq('user_id', authData.user.id);
    await sb.auth.signInWithPassword({ email, password });
    location.reload();
});

document.getElementById('btn-logout').onclick = () => cerrarSesionSegura('Cierre de sesión manual');

function showAlert(msg) {
    const el = document.getElementById('auth-alert');
    el.innerText = msg;
    el.classList.remove('hidden');
}

sb.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
        currentUser = session.user;
        await initDashboard();
    } else {
        detenerMonitorSesion();
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

// ============================================================================
// 2. CONTROL DE SESIÓN Y AUDITORÍA
// ============================================================================
function storageKey(prefix) {
    return `nexora_${prefix}_${currentOrg?.id || 'default'}`;
}

function registrarEventoAuditoria(evento, detalle) {
    try {
        auditoriaCache = JSON.parse(localStorage.getItem(storageKey('auditoria')) || '[]');
    } catch {
        auditoriaCache = [];
    }
    auditoriaCache.unshift({
        fecha: new Date().toLocaleString(),
        usuario: currentUserName || currentUser?.email || 'Sistema',
        evento,
        detalle
    });
    auditoriaCache = auditoriaCache.slice(0, 50);
    localStorage.setItem(storageKey('auditoria'), JSON.stringify(auditoriaCache));
    renderAuditoriaSeguridad();
}

function renderAuditoriaSeguridad() {
    const tbody = document.getElementById('tbody-auditoria-seg');
    if (!tbody) return;
    tbody.innerHTML = auditoriaCache.map(a => `
        <tr>
            <td>${escapeHtml(a.fecha)}</td>
            <td><strong>${escapeHtml(a.usuario)}</strong></td>
            <td><span class="badge badge-neutral">${escapeHtml(a.evento)}</span></td>
            <td>${escapeHtml(a.detalle)}</td>
        </tr>
    `).join('') || '<tr><td colspan="4" class="muted-text">Sin eventos registrados.</td></tr>';
}

function cargarConfiguracionSesion() {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey('sesion_cfg')) || '{}');
        sessionTimeoutMinutes = Number(saved.timeoutMin) || 30;
        blurLockMinutes = Number(saved.blurLockMin) || 0;
    } catch {
        sessionTimeoutMinutes = 30;
        blurLockMinutes = 0;
    }
    const selTimeout = document.getElementById('sec-timeout-min');
    const selBlur = document.getElementById('sec-blur-lock');
    if (selTimeout) selTimeout.value = String(sessionTimeoutMinutes);
    if (selBlur) selBlur.value = String(blurLockMinutes);
}

window.extenderSesionActiva = () => {
    sessionExpiresAt = Date.now() + sessionTimeoutMinutes * 60 * 1000;
    hiddenAtTimestamp = null;
    const warnModal = document.getElementById('session-warning-modal');
    if (warnModal) warnModal.classList.add('hidden');
    actualizarRelojSesion();
};

window.cerrarSesionSegura = async (motivo = 'Sesión finalizada') => {
    registrarEventoAuditoria('CIERRE_SESION', motivo);
    detenerMonitorSesion();
    const warnModal = document.getElementById('session-warning-modal');
    if (warnModal) warnModal.classList.add('hidden');
    await sb.auth.signOut();
};

function actualizarRelojSesion() {
    const label = document.getElementById('session-countdown-sidebar');
    const modalLabel = document.getElementById('session-modal-countdown');
    const warnModal = document.getElementById('session-warning-modal');
    if (!sessionExpiresAt) return;

    const restMs = sessionExpiresAt - Date.now();
    if (restMs <= 0) {
        cerrarSesionSegura(`Expiración automática (${sessionTimeoutMinutes} min)`);
        return;
    }

    const totalSec = Math.floor(restMs / 1000);
    const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
    const sec = String(totalSec % 60).padStart(2, '0');
    const formatted = `${min}:${sec}`;

    if (label) label.innerText = `Sesión (${sessionTimeoutMinutes}m): ${formatted}`;
    if (modalLabel) modalLabel.innerText = formatted;

    if (restMs <= 2 * 60 * 1000 && warnModal) {
        warnModal.classList.remove('hidden');
    } else if (warnModal) {
        warnModal.classList.add('hidden');
    }
}

function iniciarMonitorSesion() {
    cargarConfiguracionSesion();
    extenderSesionActiva();
    detenerMonitorSesion();
    sessionTickerInterval = setInterval(actualizarRelojSesion, 1000);
}

function detenerMonitorSesion() {
    if (sessionTickerInterval) {
        clearInterval(sessionTickerInterval);
        sessionTickerInterval = null;
    }
}

['click', 'keydown', 'scroll', 'mousemove'].forEach(evt => {
    window.addEventListener(evt, () => {
        if (!currentUser || !sessionExpiresAt) return;
        const warnModal = document.getElementById('session-warning-modal');
        if (warnModal && !warnModal.classList.contains('hidden')) return;
        sessionExpiresAt = Date.now() + sessionTimeoutMinutes * 60 * 1000;
    }, { passive: true });
});

document.addEventListener('visibilitychange', () => {
    if (!currentUser) return;
    if (document.hidden) {
        hiddenAtTimestamp = Date.now();
    } else if (hiddenAtTimestamp && blurLockMinutes > 0) {
        const elapsedMin = (Date.now() - hiddenAtTimestamp) / 60000;
        if (elapsedMin >= blurLockMinutes) {
            cerrarSesionSegura(`Inactividad en pestaña oculta (${blurLockMinutes} min)`);
        }
        hiddenAtTimestamp = null;
    }
});

document.getElementById('form-seguridad-sesion').addEventListener('submit', (e) => {
    e.preventDefault();
    sessionTimeoutMinutes = Number(document.getElementById('sec-timeout-min').value) || 30;
    blurLockMinutes = Number(document.getElementById('sec-blur-lock').value) || 0;
    localStorage.setItem(storageKey('sesion_cfg'), JSON.stringify({
        timeoutMin: sessionTimeoutMinutes,
        blurLockMin: blurLockMinutes
    }));
    extenderSesionActiva();
    registrarEventoAuditoria('POLITICA_SESION', `Duración: ${sessionTimeoutMinutes} min, bloqueo pestaña: ${blurLockMinutes} min`);
    alert('Política de seguridad actualizada correctamente.');
});

// ============================================================================
// 3. INICIALIZACIÓN Y NAVEGACIÓN
// ============================================================================
function inicializarSelectoresGerenciales() {
    const selAnio = document.getElementById('ger-anio');
    const selMes = document.getElementById('ger-mes');
    const ahora = new Date();
    const anioActual = ahora.getFullYear();

    if (selAnio && selAnio.options.length === 0) {
        for (let y = anioActual; y >= anioActual - 5; y--) {
            const opt = document.createElement('option');
            opt.value = String(y);
            opt.textContent = String(y);
            selAnio.appendChild(opt);
        }
    }
    if (selAnio) selAnio.value = String(anioActual);
    if (selMes) selMes.value = String(ahora.getMonth());
}

async function initDashboard() {
    const { data: roleData } = await sb
        .from('usuarios_roles')
        .select('*, organizaciones(*)')
        .eq('user_id', currentUser.id)
        .single();

    if (!roleData) return;
    currentOrg = roleData.organizaciones;
    currentRole = roleData.rol || 'admin';
    currentUserName = roleData.nombre_completo || currentUser.email;

    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('sidebar-org-name').innerText = `${currentOrg.nombre_comercial} • RUC ${currentOrg.ruc}`;
    document.getElementById('sidebar-user-info').innerText = `${currentUserName} (${currentRole.toUpperCase()})`;
    document.getElementById('sidebar-rol-tag').innerText = currentRole.toUpperCase();
    document.getElementById('user-badge').innerText = currentOrg.ambiente_sri === 1 ? 'Ambiente: Pruebas' : 'Ambiente: Producción';

    document.getElementById('sri-ambiente').value = currentOrg.ambiente_sri || 1;
    document.getElementById('sri-regimen').value = currentOrg.regimen_rimpe || 'GENERAL';
    document.getElementById('sri-contabilidad').value = String(currentOrg.obligado_contabilidad || false);
    document.getElementById('sri-ruc-prov').value = currentOrg.ruc_proveedor_software || '1790000000001';
    document.getElementById('sri-estab').value = currentOrg.establecimiento || '001';
    document.getElementById('sri-pto').value = currentOrg.punto_emision || '001';
    document.getElementById('sri-secuencial').value = currentOrg.secuencial_factura || 1;
    if (currentOrg.firma_vigencia_hasta) {
        document.getElementById('sri-firma-vigencia').value = currentOrg.firma_vigencia_hasta;
        verificarVigenciaFirma(currentOrg.firma_vigencia_hasta);
    }

    inicializarSelectoresGerenciales();
    actualizarReglaIdentificacionCliente();
    iniciarMonitorSesion();
    registrarEventoAuditoria('INICIO_SESION', `Acceso autorizado (${currentRole})`);

    document.getElementById('egr-fecha').valueAsDate = new Date();
    recalcularProformaMercado();
    calcularResumenFinanciero('srv');

    await refreshAllData();
}

function verificarVigenciaFirma(fechaStr) {
    const alertBox = document.getElementById('firma-vigencia-alert');
    if (!alertBox || !fechaStr) return;
    const dias = Math.ceil((new Date(fechaStr) - new Date()) / 86400000);
    if (dias < 0) {
        alertBox.innerText = 'Aviso: el certificado de firma electrónica (.p12) se encuentra vencido.';
        alertBox.classList.remove('hidden');
    } else if (dias <= 15) {
        alertBox.innerText = `Aviso: el certificado de firma electrónica (.p12) vence en ${dias} día(s).`;
        alertBox.classList.remove('hidden');
    } else {
        alertBox.classList.add('hidden');
    }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

window.switchTab = (tabId) => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== tabId));

    const activeBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
    if (activeBtn) {
        document.getElementById('page-title').innerText = activeBtn.innerText.trim();
        document.getElementById('page-subtitle').innerText = TAB_DESCRIPTIONS[tabId] || '';
    }
    if (tabId === 'tab-gerencial') {
        actualizarVistaGerencial();
    }
};

window.switchSubView = (sectionId, subviewId, btnEl) => {
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.querySelectorAll('.subnav-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    section.querySelectorAll('.subview-panel').forEach(p => p.classList.toggle('hidden', p.id !== subviewId));
};

window.abrirModuloFinanciero = (subviewId) => {
    switchTab('tab-finanzas');
    const btn = document.querySelector(`#tab-finanzas .subnav-btn[data-sub="${subviewId}"]`);
    switchSubView('tab-finanzas', subviewId, btn);
};

window.irAEmitirFacturaEnClientes = () => {
    switchTab('tab-proformas');
    const btnCli = document.querySelector('#tab-proformas .subnav-btn[data-sub="prf-clientes"]');
    switchSubView('tab-proformas', 'prf-clientes', btnCli);
    document.getElementById('panel-facturar-cliente').classList.remove('hidden');
};

window.toggleFormPanel = (panelId) => {
    const el = document.getElementById(panelId);
    if (el) el.classList.toggle('hidden');
};

window.refreshAllData = async () => {
    await Promise.all([
        loadSalas(),
        loadProductos(),
        loadClientes(),
        loadServicios(),
        loadFacturas(),
        loadEgresos(),
        loadEquipo()
    ]);
    await loadProformas();
    renderAuditoriaSeguridad();
    recalcularFinanzas();
    actualizarVistaGerencial();
};

// ============================================================================
// 4. CONTROL GERENCIAL Y GRÁFICOS ESTADÍSTICOS (POR MES / POR AÑO)
// ============================================================================
function parseFechaLocal(fechaStr) {
    if (!fechaStr) return new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(fechaStr)) {
        const [y, m, d] = fechaStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    return new Date(fechaStr);
}

window.cambiarModoGerencial = () => {
    const modo = document.getElementById('ger-modo-periodo').value;
    document.getElementById('ger-wrap-anio').classList.toggle('hidden', modo === 'TODO');
    document.getElementById('ger-wrap-mes').classList.toggle('hidden', modo !== 'MES');
    actualizarVistaGerencial();
};

window.actualizarVistaGerencial = () => {
    const modo = document.getElementById('ger-modo-periodo')?.value || 'MES';
    const anioSel = Number(document.getElementById('ger-anio')?.value || new Date().getFullYear());
    const mesSel = Number(document.getElementById('ger-mes')?.value || new Date().getMonth());

    const cumpleFiltro = (fechaObj) => {
        if (modo === 'TODO') return true;
        if (fechaObj.getFullYear() !== anioSel) return false;
        if (modo === 'MES') return fechaObj.getMonth() === mesSel;
        return true;
    };

    const facsFiltradas = facturasCache.filter(f => cumpleFiltro(parseFechaLocal(f.fecha_emision)));
    const egrsFiltrados = egresosCache.filter(g => cumpleFiltro(parseFechaLocal(g.fecha_egreso || g.created_at)));
    const srvsFiltrados = serviciosCache.filter(s => cumpleFiltro(parseFechaLocal(s.fecha_fallecimiento || s.created_at)));

    const totalIngresos = facsFiltradas.reduce((acc, f) => acc + Number(f.importe_total || 0), 0);
    const totalGastos = egrsFiltrados.reduce((acc, g) => acc + Number(g.monto || 0), 0);
    const gananciaBruta = totalIngresos - totalGastos;
    const margenBruto = totalIngresos > 0 ? ((gananciaBruta / totalIngresos) * 100).toFixed(1) : '0.0';
    const ticketPromedio = facsFiltradas.length > 0 ? (totalIngresos / facsFiltradas.length) : 0;

    document.getElementById('ger-kpi-ingresos').innerText = `$${totalIngresos.toFixed(2)}`;
    document.getElementById('ger-kpi-ingresos-sub').innerText = `${facsFiltradas.length} facturas en el período`;
    document.getElementById('ger-kpi-gastos').innerText = `$${totalGastos.toFixed(2)}`;
    document.getElementById('ger-kpi-gastos-sub').innerText = `${egrsFiltrados.length} gastos registrados`;
    document.getElementById('ger-kpi-ganancia').innerText = `$${gananciaBruta.toFixed(2)}`;
    document.getElementById('ger-kpi-margen').innerText = `Margen bruto: ${margenBruto}%`;
    document.getElementById('ger-kpi-servicios').innerText = srvsFiltrados.length;
    document.getElementById('ger-kpi-ticket').innerText = `Promedio factura: $${ticketPromedio.toFixed(2)}`;

    let labels = [];
    let serieIngresos = [];
    let serieGastos = [];
    let serieGanancias = [];

    if (modo === 'MES') {
        const diasEnMes = new Date(anioSel, mesSel + 1, 0).getDate();
        document.getElementById('chart-evolucion-titulo').innerText = `Evolución Diaria — ${NOMBRES_MESES[mesSel]} ${anioSel}`;
        document.getElementById('chart-evolucion-sub').innerText = 'Comparativo diario de ingresos, gastos y ganancia bruta';

        for (let d = 1; d <= diasEnMes; d++) {
            labels.push(`Día ${d}`);
            const ingDia = facsFiltradas
                .filter(f => parseFechaLocal(f.fecha_emision).getDate() === d)
                .reduce((a, b) => a + Number(b.importe_total || 0), 0);
            const gasDia = egrsFiltrados
                .filter(g => parseFechaLocal(g.fecha_egreso || g.created_at).getDate() === d)
                .reduce((a, b) => a + Number(b.monto || 0), 0);
            serieIngresos.push(Number(ingDia.toFixed(2)));
            serieGastos.push(Number(gasDia.toFixed(2)));
            serieGanancias.push(Number((ingDia - gasDia).toFixed(2)));
        }
    } else if (modo === 'ANIO') {
        document.getElementById('chart-evolucion-titulo').innerText = `Evolución Mensual — Año ${anioSel}`;
        document.getElementById('chart-evolucion-sub').innerText = 'Comparativo mensual (Enero a Diciembre) de ingresos, gastos y ganancia bruta';

        for (let m = 0; m < 12; m++) {
            labels.push(NOMBRES_MESES[m].slice(0, 3));
            const ingMes = facsFiltradas
                .filter(f => parseFechaLocal(f.fecha_emision).getMonth() === m)
                .reduce((a, b) => a + Number(b.importe_total || 0), 0);
            const gasMes = egrsFiltrados
                .filter(g => parseFechaLocal(g.fecha_egreso || g.created_at).getMonth() === m)
                .reduce((a, b) => a + Number(b.monto || 0), 0);
            serieIngresos.push(Number(ingMes.toFixed(2)));
            serieGastos.push(Number(gasMes.toFixed(2)));
            serieGanancias.push(Number((ingMes - gasMes).toFixed(2)));
        }
    } else {
        document.getElementById('chart-evolucion-titulo').innerText = 'Evolución Anual Histórica';
        document.getElementById('chart-evolucion-sub').innerText = 'Comparativo consolidado por año';
        const aniosSet = new Set([new Date().getFullYear()]);
        facturasCache.forEach(f => aniosSet.add(parseFechaLocal(f.fecha_emision).getFullYear()));
        egresosCache.forEach(g => aniosSet.add(parseFechaLocal(g.fecha_egreso || g.created_at).getFullYear()));
        const aniosOrdenados = Array.from(aniosSet).sort((a, b) => a - b);

        aniosOrdenados.forEach(y => {
            labels.push(String(y));
            const ingY = facturasCache
                .filter(f => parseFechaLocal(f.fecha_emision).getFullYear() === y)
                .reduce((a, b) => a + Number(b.importe_total || 0), 0);
            const gasY = egresosCache
                .filter(g => parseFechaLocal(g.fecha_egreso || g.created_at).getFullYear() === y)
                .reduce((a, b) => a + Number(b.monto || 0), 0);
            serieIngresos.push(Number(ingY.toFixed(2)));
            serieGastos.push(Number(gasY.toFixed(2)));
            serieGanancias.push(Number((ingY - gasY).toFixed(2)));
        });
    }

    const filasTabla = labels.map((lbl, i) => {
        const ing = serieIngresos[i];
        const gas = serieGastos[i];
        const gan = serieGanancias[i];
        if (modo === 'MES' && ing === 0 && gas === 0) return '';
        const mrg = ing > 0 ? ((gan / ing) * 100).toFixed(1) : '0.0';
        return `
        <tr>
            <td><strong>${escapeHtml(lbl)}</strong></td>
            <td>$${ing.toFixed(2)}</td>
            <td>$${gas.toFixed(2)}</td>
            <td><strong>$${gan.toFixed(2)}</strong></td>
            <td><span class="badge ${gan >= 0 ? 'badge-success' : 'badge-danger'}">${mrg}%</span></td>
        </tr>`;
    }).filter(Boolean);

    document.getElementById('tbody-gerencial-consolidado').innerHTML = filasTabla.join('') ||
        '<tr><td colspan="5" class="muted-text">No existen movimientos financieros registrados en el período seleccionado.</td></tr>';

    renderizarGraficosGerenciales(labels, serieIngresos, serieGastos, serieGanancias, egrsFiltrados);
};

function renderizarGraficosGerenciales(labels, serieIngresos, serieGastos, serieGanancias, egrsFiltrados) {
    if (typeof Chart === 'undefined') return;

    const ctxEv = document.getElementById('chart-gerencial-evolucion');
    if (ctxEv) {
        if (chartEvolucionInstance) chartEvolucionInstance.destroy();
        chartEvolucionInstance = new Chart(ctxEv, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Ingresos ($)', data: serieIngresos, backgroundColor: '#0f172a', borderRadius: 4 },
                    { label: 'Gastos ($)', data: serieGastos, backgroundColor: '#94a3b8', borderRadius: 4 },
                    {
                        type: 'line',
                        label: 'Ganancia Bruta ($)',
                        data: serieGanancias,
                        borderColor: '#b45309',
                        backgroundColor: '#b45309',
                        borderWidth: 2,
                        tension: 0.25,
                        pointRadius: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: { y: { beginAtZero: true } }
            }
        });
    }

    const ctxGas = document.getElementById('chart-gerencial-gastos');
    if (ctxGas) {
        if (chartGastosInstance) chartGastosInstance.destroy();
        const porCat = {};
        egrsFiltrados.forEach(g => {
            const cat = g.categoria_egreso || 'OTROS';
            porCat[cat] = (porCat[cat] || 0) + Number(g.monto || 0);
        });
        const catLabels = Object.keys(porCat);
        const catVals = Object.values(porCat);

        chartGastosInstance = new Chart(ctxGas, {
            type: 'doughnut',
            data: {
                labels: catLabels.length > 0 ? catLabels : ['Sin gastos en período'],
                datasets: [{
                    data: catVals.length > 0 ? catVals : [1],
                    backgroundColor: catVals.length > 0
                        ? ['#0f172a', '#b45309', '#334155', '#64748b', '#d97706', '#94a3b8']
                        : ['#e2e8f0']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }
}

// ============================================================================
// CÁLCULOS DE PROFORMAS POR PLAN / CATEGORÍA / GAMA / CANTIDAD Y SEGURO
// ============================================================================
window.recalcularProformaMercado = () => {
    const ids = ['prf-cat-sala', 'prf-cat-ataud', 'prf-cat-cafeteria', 'prf-cat-nicho', 'prf-cat-arreglo'];
    const sumaUnitaria = ids.reduce((acc, id) => {
        const el = document.getElementById(id);
        return acc + (el ? Number(el.value) || 0 : 0);
    }, 0);
    const cant = Math.max(1, Number(document.getElementById('prf-cantidad')?.value) || 1);
    const totalCalculado = sumaUnitaria * cant;

    const srvInput = document.getElementById('prf-valor-servicio');
    if (srvInput) srvInput.value = totalCalculado.toFixed(2);
    calcularResumenFinanciero('prf');
};

function calcularMontosServicio(valorServicioRaw, descuentoPctRaw, coberturaSeguroRaw) {
    const valorServicio = Math.max(0, Number(valorServicioRaw) || 0);
    const descuentoPct = Math.min(100, Math.max(0, Number(descuentoPctRaw) || 0));
    const coberturaSeguro = Math.max(0, Number(coberturaSeguroRaw) || 0);

    const valorDescuento = valorServicio * (descuentoPct / 100);
    const subtotalConDescuento = Math.max(0, valorServicio - valorDescuento);
    const totalNeto = Math.max(0, subtotalConDescuento - coberturaSeguro);

    return { valorServicio, descuentoPct, coberturaSeguro, valorDescuento, totalNeto };
}

window.calcularResumenFinanciero = (prefijo) => {
    const srvEl = document.getElementById(`${prefijo}-valor-servicio`);
    const descEl = document.getElementById(`${prefijo}-descuento-pct`);
    const segEl = document.getElementById(`${prefijo}-cobertura-seguro`);
    if (!srvEl || !descEl || !segEl) return;

    const calc = calcularMontosServicio(srvEl.value, descEl.value, segEl.value);
    document.getElementById(`${prefijo}-calc-servicio`).innerText = `$${calc.valorServicio.toFixed(2)}`;
    document.getElementById(`${prefijo}-calc-pct-lbl`).innerText = `${calc.descuentoPct.toFixed(1)}%`;
    document.getElementById(`${prefijo}-calc-desc-monto`).innerText = `-$${calc.valorDescuento.toFixed(2)}`;
    document.getElementById(`${prefijo}-calc-seguro`).innerText = `-$${calc.coberturaSeguro.toFixed(2)}`;
    document.getElementById(`${prefijo}-calc-neto`).innerText = `$${calc.totalNeto.toFixed(2)}`;
};

function normalizarTelefonoWA(rawPhone) {
    let digits = String(rawPhone || '').replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) digits = '593' + digits.slice(1);
    return digits;
}

window.abrirContactoExterno = (telefonoRaw, mensajeTexto) => {
    const tel = normalizarTelefonoWA(telefonoRaw);
    if (!tel) {
        alert('El registro no dispone de un número telefónico válido.');
        return;
    }
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(mensajeTexto || '')}`, '_blank', 'noopener,noreferrer');
};

// ============================================================================
// PROFORMAS Y CIERRE DE TRATO
// ============================================================================
function resumenCategoriasProforma() {
    const modalidad = document.getElementById('prf-modalidad-plan')?.value || 'INHUMACION';
    const ids = ['prf-cat-sala', 'prf-cat-ataud', 'prf-cat-cafeteria', 'prf-cat-nicho', 'prf-cat-arreglo'];
    const rubros = ids.map(id => {
        const sel = document.getElementById(id);
        const opt = sel?.options[sel.selectedIndex];
        return opt?.dataset?.label || '';
    }).filter(Boolean).join(' • ');
    return `[${modalidad}] ${rubros}`;
}

async function loadProformas() {
    let loaded = [];
    try {
        const { data, error } = await sb.from('proformas_cotizaciones').select('*').eq('organizacion_id', currentOrg.id).order('created_at', { ascending: false });
        if (!error && Array.isArray(data)) {
            loaded = data.map(r => ({
                id: r.id,
                fecha: new Date(r.created_at).toLocaleDateString(),
                codigo: r.codigo_proforma,
                nombre: r.prospecto_nombre,
                tipoId: r.tipo_identificacion || 'CEDULA',
                identificacion: r.identificacion || '',
                telefono: r.prospecto_telefono || '',
                ubicacion: r.ubicacion_sector || '',
                rubrosResumen: r.rubros_resumen || '',
                cantidad: Number(r.cantidad || 1),
                nombreSeguro: r.nombre_seguro || 'Particular',
                coberturaSeguro: Number(r.valor_cobertura_seguro || 0),
                valorServicio: Number(r.valor_servicio_funerario || 0),
                descuentoPct: Number(r.descuento_porcentaje || 0),
                totalNeto: Number(r.valor_total_neto || 0),
                formaPago: r.forma_pago || 'Efectivo',
                estado: r.estado_seguimiento || 'COTIZACION_EMITIDA',
                notas: r.notas || ''
            }));
        }
    } catch {
        loaded = [];
    }

    if (loaded.length === 0) {
        try {
            loaded = JSON.parse(localStorage.getItem(storageKey('proformas')) || '[]');
        } catch {
            loaded = [];
        }
    }
    proformasCache = loaded;
    renderProformas();
    poblarSelectProformasFactura();
}

function poblarSelectProformasFactura() {
    const sel = document.getElementById('fac-proforma-ref');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Sin proforma vinculada --</option>' +
        proformasCache.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.codigo)} - ${escapeHtml(p.nombre)} ($${Number(p.totalNeto).toFixed(2)})</option>`).join('');
}

document.getElementById('form-proforma').addEventListener('submit', async (e) => {
    e.preventDefault();
    const calc = calcularMontosServicio(
        document.getElementById('prf-valor-servicio').value,
        document.getElementById('prf-descuento-pct').value,
        document.getElementById('prf-cobertura-seguro').value
    );

    const item = {
        id: Date.now().toString(),
        fecha: new Date().toLocaleDateString(),
        codigo: document.getElementById('prf-codigo').value.trim(),
        nombre: document.getElementById('prf-nombre').value.trim(),
        tipoId: document.getElementById('prf-tipo-id').value,
        identificacion: document.getElementById('prf-identificacion').value.trim(),
        telefono: document.getElementById('prf-telefono').value.trim(),
        ubicacion: document.getElementById('prf-ubicacion').value.trim(),
        rubrosResumen: resumenCategoriasProforma(),
        cantidad: Math.max(1, Number(document.getElementById('prf-cantidad').value) || 1),
        nombreSeguro: document.getElementById('prf-nombre-seguro').value.trim(),
        coberturaSeguro: calc.coberturaSeguro,
        valorServicio: calc.valorServicio,
        descuentoPct: calc.descuentoPct,
        totalNeto: calc.totalNeto,
        formaPago: document.getElementById('prf-forma-pago').value,
        estado: document.getElementById('prf-estado').value,
        notas: document.getElementById('prf-notas').value.trim()
    };

    try {
        await sb.from('proformas_cotizaciones').insert({
            organizacion_id: currentOrg.id,
            codigo_proforma: item.codigo,
            prospecto_nombre: item.nombre,
            prospecto_telefono: item.telefono,
            ubicacion_sector: item.ubicacion,
            nombre_seguro: item.nombreSeguro,
            valor_cobertura_seguro: item.coberturaSeguro,
            valor_servicio_funerario: item.valorServicio,
            descuento_porcentaje: item.descuentoPct,
            valor_total_neto: item.totalNeto,
            estado_seguimiento: item.estado,
            notas: item.notas
        });
    } catch {}

    proformasCache.unshift(item);
    localStorage.setItem(storageKey('proformas'), JSON.stringify(proformasCache));
    e.target.reset();
    recalcularProformaMercado();
    document.getElementById('panel-form-proforma').classList.add('hidden');
    renderProformas();
    poblarSelectProformasFactura();
});

function construirTextoProforma(p) {
    return `Proforma ${p.codigo} - ${currentOrg?.nombre_comercial || 'Nexora Suite'}\n` +
        `Solicitante: ${p.nombre}\n` +
        `Detalle: ${p.rubrosResumen}\n` +
        `Cantidad: ${p.cantidad} | Valor: $${Number(p.valorServicio).toFixed(2)}\n` +
        `Descuento: ${Number(p.descuentoPct).toFixed(1)}% | Seguro: -$${Number(p.coberturaSeguro).toFixed(2)}\n` +
        `Total neto estimado: $${Number(p.totalNeto).toFixed(2)}`;
}

window.renderProformas = () => {
    document.getElementById('tbody-proformas').innerHTML = proformasCache.map(p => {
        const badgeClass = p.estado === 'TRATO_CERRADO'
            ? 'badge-success'
            : (p.estado === 'NO_ACEPTA' ? 'badge-danger' : 'badge-warning');
        return `
        <tr>
            <td><strong>${escapeHtml(p.codigo)}</strong><br><small class="muted-text">${escapeHtml(p.fecha)}</small></td>
            <td><strong>${escapeHtml(p.nombre)}</strong><br><small class="muted-text">${escapeHtml(p.tipoId)}: ${escapeHtml(p.identificacion || '-')} • Tel: ${escapeHtml(p.telefono)}</small></td>
            <td><small>${escapeHtml(p.rubrosResumen || p.notas)}</small><br><small class="muted-text">Cant.: ${escapeHtml(p.cantidad)} • Convenio: ${escapeHtml(p.nombreSeguro)} • Pago: ${escapeHtml(p.formaPago || 'Efectivo')}</small></td>
            <td><strong>$${Number(p.totalNeto).toFixed(2)}</strong></td>
            <td><span class="badge ${badgeClass}">${escapeHtml(p.estado.replace(/_/g, ' '))}</span></td>
            <td class="btn-group">
                <button type="button" class="btn btn-sm btn-outline" onclick="abrirContactoExterno('${escapeHtml(p.telefono)}', ${JSON.stringify(construirTextoProforma(p))})">Enviar</button>
                <button type="button" class="btn btn-sm btn-primary" onclick="cerrarTratoYFacturarProforma('${escapeHtml(p.id)}')">Cerrar Trato y Facturar</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted-text">No existen proformas registradas.</td></tr>';
};

window.cerrarTratoYFacturarProforma = async (proformaId) => {
    const prf = proformasCache.find(x => x.id === proformaId);
    if (!prf) return;

    prf.estado = 'TRATO_CERRADO';
    localStorage.setItem(storageKey('proformas'), JSON.stringify(proformasCache));
    renderProformas();

    let clienteObj = clientesCache.find(c => c.identificacion === prf.identificacion && prf.identificacion);
    if (!clienteObj) {
        const { data: cliCreado } = await sb.from('clientes').insert({
            organizacion_id: currentOrg.id,
            tipo_identificacion: prf.tipoId || 'CEDULA',
            identificacion: prf.identificacion || '9999999999',
            razon_social: prf.nombre,
            telefono_whatsapp: prf.telefono,
            correo: 'cliente@registro.local',
            direccion: prf.ubicacion || currentOrg.direccion_matriz
        }).select().single();
        if (cliCreado) {
            guardarMetadatosCliente(cliCreado.id, prf.nombreSeguro || 'Particular', prf.ubicacion || 'Quito');
            await loadClientes();
            clienteObj = cliCreado;
        }
    }

    const btnCli = document.querySelector('#tab-proformas .subnav-btn[data-sub="prf-clientes"]');
    switchSubView('tab-proformas', 'prf-clientes', btnCli);
    document.getElementById('panel-facturar-cliente').classList.remove('hidden');
    if (clienteObj) document.getElementById('fac-cliente').value = clienteObj.id;
    document.getElementById('fac-forma-pago').value = prf.formaPago || 'Efectivo';
    document.getElementById('fac-proforma-ref').value = prf.id;

    const subtotal = Number(prf.totalNeto) / 1.15;
    const iva = Number(prf.totalNeto) - subtotal;
    facturaItems = [{
        producto_id: null,
        codigo_principal: prf.codigo,
        descripcion: `Servicio Proforma ${prf.codigo} (${prf.rubrosResumen || prf.nombreSeguro})`,
        cantidad: prf.cantidad || 1,
        precio_unitario: subtotal / (prf.cantidad || 1),
        codigo_iva: '4',
        porcentaje_iva: 15,
        precio_total_sin_impuesto: subtotal,
        valor_iva: iva
    }];
    renderFacturaItems();
    mostrarFeedbackComercial(`Trato cerrado para ${prf.nombre}. Revise la factura y pulse "Emitir Factura y Registrar Ingreso".`);
};

// ============================================================================
// SALAS DE VELACIÓN
// ============================================================================
async function loadSalas() {
    const { data } = await sb.from('salas_velacion').select('*').eq('organizacion_id', currentOrg.id).order('nombre');
    const salas = data || [];
    document.getElementById('stat-salas').innerText = salas.filter(s => s.estado === 'DISPONIBLE').length;

    document.getElementById('tbody-salas').innerHTML = salas.map(s => `
        <tr>
            <td><strong>${escapeHtml(s.nombre)}</strong></td>
            <td>${escapeHtml(s.capacidad_personas)} personas</td>
            <td>${escapeHtml(s.direccion_sucursal || '-')}</td>
            <td><span class="badge ${s.estado === 'DISPONIBLE' ? 'badge-success' : 'badge-warning'}">${escapeHtml(s.estado)}</span></td>
            <td><button class="btn btn-sm btn-outline" onclick="toggleSala('${escapeHtml(s.id)}', '${escapeHtml(s.estado)}')">Cambiar Estado / Desinfección</button></td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="muted-text">No hay salas registradas.</td></tr>';

    document.getElementById('srv-sala').innerHTML = '<option value="">-- Sin sala asignada --</option>' +
        salas.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.nombre)} (${escapeHtml(s.estado)})</option>`).join('');
}

document.getElementById('form-sala').addEventListener('submit', async (e) => {
    e.preventDefault();
    await sb.from('salas_velacion').insert({
        organizacion_id: currentOrg.id,
        nombre: document.getElementById('sala-nombre').value,
        capacidad_personas: document.getElementById('sala-capacidad').value,
        direccion_sucursal: document.getElementById('sala-direccion').value
    });
    e.target.reset();
    document.getElementById('panel-form-sala').classList.add('hidden');
    loadSalas();
});

window.toggleSala = async (id, estadoActual) => {
    const nuevo = estadoActual === 'DISPONIBLE' ? 'OCUPADA' : 'DISPONIBLE';
    await sb.from('salas_velacion').update({ estado: nuevo }).eq('id', id);
    await Promise.all([loadSalas(), loadServicios()]);
};

// ============================================================================
// INVENTARIO Y TARIFARIO
// ============================================================================
async function loadProductos() {
    const { data } = await sb.from('productos_servicios').select('*').eq('organizacion_id', currentOrg.id).order('nombre');
    const prods = data || [];
    catalogoCache = prods;

    const criticos = prods.filter(p => p.tipo === 'BIEN' && Number(p.stock_actual) <= Number(p.stock_minimo));
    const alertasEl = document.getElementById('resumen-alertas-lista');
    if (alertasEl) {
        const itemsHtml = [];
        if (criticos.length > 0) {
            itemsHtml.push(`<div class="status-item"><strong>Stock mínimo alcanzado:</strong> ${escapeHtml(criticos.map(c => `${c.nombre} (${c.stock_actual} unid.)`).join(', '))}</div>`);
        } else {
            itemsHtml.push('<div class="status-item">Inventario de cofres, urnas y suministros dentro de niveles operativos normales.</div>');
        }
        itemsHtml.push(`<div class="status-item"><strong>Ambiente Operativo:</strong> ${currentOrg.ambiente_sri === 1 ? 'Pruebas' : 'Producción'} • Secuencial actual: ${escapeHtml(currentOrg.secuencial_factura || 1)}</div>`);
        alertasEl.innerHTML = itemsHtml.join('');
    }

    document.getElementById('tbody-productos').innerHTML = prods.map(p => `
        <tr>
            <td>${escapeHtml(p.codigo_principal)}</td>
            <td><strong>${escapeHtml(p.nombre)}</strong></td>
            <td>${escapeHtml(p.categoria)}</td>
            <td>$${Number(p.precio_unitario).toFixed(2)}</td>
            <td>${escapeHtml(p.porcentaje_iva)}%</td>
            <td><span class="badge ${p.tipo === 'BIEN' && p.stock_actual <= p.stock_minimo ? 'badge-danger' : 'badge-success'}">${escapeHtml(p.stock_actual)}</span></td>
            <td><button class="btn btn-sm btn-outline" onclick="sumarStock('${escapeHtml(p.id)}', ${Number(p.stock_actual)})">+1 Ingreso</button></td>
        </tr>
    `).join('') || '<tr><td colspan="7" class="muted-text">No hay ítems registrados.</td></tr>';

    document.getElementById('srv-ataud').innerHTML = '<option value="">-- Seleccionar Cofre / Urna --</option>' +
        prods.filter(p => p.categoria === 'ATAUD' || p.categoria === 'URNA')
             .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)} (Disponible: ${escapeHtml(p.stock_actual)})</option>`).join('');

    document.getElementById('fac-select-prod').innerHTML = '<option value="">-- Seleccionar ítem del tarifario --</option>' +
        prods.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.codigo_principal)} - ${escapeHtml(p.nombre)} ($${Number(p.precio_unitario).toFixed(2)} + IVA ${escapeHtml(p.porcentaje_iva)}%)</option>`).join('');
}

document.getElementById('form-producto').addEventListener('submit', async (e) => {
    e.preventDefault();
    const iva = document.getElementById('prod-iva').value;
    await sb.from('productos_servicios').insert({
        organizacion_id: currentOrg.id,
        codigo_principal: document.getElementById('prod-codigo').value,
        nombre: document.getElementById('prod-nombre').value,
        categoria: document.getElementById('prod-categoria').value,
        tipo: document.getElementById('prod-tipo').value,
        precio_unitario: document.getElementById('prod-precio').value,
        codigo_iva: iva === '15' ? '4' : '0',
        porcentaje_iva: iva,
        stock_actual: document.getElementById('prod-stock').value,
        stock_minimo: document.getElementById('prod-stock-min').value
    });
    e.target.reset();
    document.getElementById('panel-form-producto').classList.add('hidden');
    loadProductos();
});

window.sumarStock = async (id, actual) => {
    await sb.from('productos_servicios').update({ stock_actual: Number(actual) + 1 }).eq('id', id);
    loadProductos();
};

// ============================================================================
// INGRESO ESTRUCTURADO DE CLIENTES Y EMISIÓN DE FACTURA EN PROFORMAS
// ============================================================================
function formatearTipoIdLimpio(tipoRaw) {
    const t = String(tipoRaw || '').toUpperCase();
    if (t === '04' || t.includes('RUC')) return 'RUC';
    if (t === '06' || t.includes('PASAPORTE')) return 'Pasaporte';
    return 'Cédula';
}

window.actualizarReglaIdentificacionCliente = () => {
    const tipo = document.getElementById('cli-tipo-id')?.value || 'CEDULA';
    const lbl = document.getElementById('lbl-cli-identificacion');
    const inp = document.getElementById('cli-identificacion');
    if (!lbl || !inp) return;

    if (tipo === 'CEDULA') {
        lbl.innerText = 'Número de Cédula (10 dígitos) *';
        inp.maxLength = 10;
        inp.placeholder = 'Ej. 1712345678';
    } else if (tipo === 'RUC') {
        lbl.innerText = 'Número de RUC (13 dígitos) *';
        inp.maxLength = 13;
        inp.placeholder = 'Ej. 1790000000001';
    } else {
        lbl.innerText = 'Número de Pasaporte (6 a 15 caracteres) *';
        inp.maxLength = 15;
        inp.placeholder = 'Ej. AB123456';
    }
};

function validarIdentificacionPorTipo(tipo, numero) {
    const limpio = String(numero || '').trim();
    if (tipo === 'CEDULA') return /^\d{10}$/.test(limpio);
    if (tipo === 'RUC') return /^\d{13}$/.test(limpio);
    return /^[A-Za-z0-9]{6,15}$/.test(limpio);
}

function obtenerMetadatosClientes() {
    try {
        return JSON.parse(localStorage.getItem(storageKey('clientes_meta')) || '{}');
    } catch {
        return {};
    }
}

function guardarMetadatosCliente(clienteId, convenio, sector) {
    const meta = obtenerMetadatosClientes();
    meta[clienteId] = { convenio: convenio || 'Particular', sector: sector || 'Quito' };
    localStorage.setItem(storageKey('clientes_meta'), JSON.stringify(meta));
}

async function loadClientes() {
    const { data } = await sb.from('clientes').select('*').eq('organizacion_id', currentOrg.id).order('razon_social');
    const clis = data || [];
    clientesCache = clis;
    const metaMap = obtenerMetadatosClientes();

    document.getElementById('tbody-clientes').innerHTML = clis.map(c => {
        const m = metaMap[c.id] || { convenio: 'Particular', sector: 'Quito' };
        return `
        <tr>
            <td><span class="badge badge-neutral">${escapeHtml(formatearTipoIdLimpio(c.tipo_identificacion))}</span> ${escapeHtml(c.identificacion)}</td>
            <td><strong>${escapeHtml(c.razon_social)}</strong><br><small class="muted-text">Convenio: ${escapeHtml(m.convenio)}</small></td>
            <td>${escapeHtml(c.telefono_whatsapp || '-')}<br><small class="muted-text">${escapeHtml(m.sector)}</small></td>
            <td>${escapeHtml(c.correo || '-')}</td>
            <td class="btn-group">
                <button class="btn btn-sm btn-primary" onclick="abrirFacturaDesdeCliente('${escapeHtml(c.id)}')">Emitir Factura</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted-text">No hay clientes registrados.</td></tr>';

    const opts = '<option value="">-- Seleccionar Cliente --</option>' + clis.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.razon_social)} (${escapeHtml(c.identificacion)})</option>`).join('');
    document.getElementById('srv-cliente').innerHTML = opts;
    document.getElementById('fac-cliente').innerHTML = opts;
}

document.getElementById('form-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const tipoLimpio = document.getElementById('cli-tipo-id').value;
    const numId = document.getElementById('cli-identificacion').value.trim();
    const telefono = document.getElementById('cli-telefono').value.trim();

    if (!validarIdentificacionPorTipo(tipoLimpio, numId)) {
        return alert(
            tipoLimpio === 'CEDULA'
                ? 'La cédula debe tener exactamente 10 dígitos numéricos.'
                : (tipoLimpio === 'RUC' ? 'El RUC debe tener exactamente 13 dígitos numéricos.' : 'El pasaporte debe tener entre 6 y 15 caracteres alfanuméricos.')
        );
    }
    if (!/^[0-9+\-\s]{7,15}$/.test(telefono)) {
        return alert('Ingrese un número de teléfono válido.');
    }

    const codigoId = tipoLimpio === 'RUC' ? '04' : (tipoLimpio === 'PASAPORTE' ? '06' : '05');
    const convenio = document.getElementById('cli-convenio').value;
    const sector = document.getElementById('cli-sector').value;

    const { data: creado } = await sb.from('clientes').insert({
        organizacion_id: currentOrg.id,
        tipo_identificacion: codigoId,
        identificacion: numId,
        razon_social: document.getElementById('cli-nombre').value.trim(),
        telefono_whatsapp: telefono,
        correo: document.getElementById('cli-correo').value.trim(),
        direccion: document.getElementById('cli-direccion').value.trim()
    }).select().single();

    if (creado?.id) {
        guardarMetadatosCliente(creado.id, convenio, sector);
    }

    e.target.reset();
    actualizarReglaIdentificacionCliente();
    document.getElementById('panel-form-cliente').classList.add('hidden');
    await loadClientes();
    mostrarFeedbackComercial('Cliente registrado con datos validados y convenio asignado.');
});

window.abrirFacturaDesdeCliente = (clienteId) => {
    switchTab('tab-proformas');
    const btnCli = document.querySelector('#tab-proformas .subnav-btn[data-sub="prf-clientes"]');
    switchSubView('tab-proformas', 'prf-clientes', btnCli);
    document.getElementById('panel-facturar-cliente').classList.remove('hidden');
    if (clienteId) document.getElementById('fac-cliente').value = clienteId;
};

// ============================================================================
// SERVICIOS FUNERARIOS (FLUJO OPERATIVO COMPLETO) Y OBITUARIO QR
// ============================================================================
async function loadServicios() {
    const { data } = await sb
        .from('servicios_funerarios')
        .select('*, salas_velacion(id, nombre, estado), obituarios_digitales(slug_publico)')
        .eq('organizacion_id', currentOrg.id)
        .order('created_at', { ascending: false });

    const srvs = data || [];
    serviciosCache = srvs;

    const activos = srvs.filter(s => s.estado_expediente !== 'FINALIZADO');
    const enVelacion = activos.filter(s => s.estado_expediente === 'EN_VELACION');
    const porVelar = activos.filter(s => s.estado_expediente !== 'EN_VELACION');

    document.getElementById('stat-servicios').innerText = activos.length;
    document.getElementById('stat-velando-detalle').innerText = `${enVelacion.length} en sala • ${porVelar.length} en proceso`;

    const resumenSalasEl = document.getElementById('tbody-resumen-salas');
    if (resumenSalasEl) {
        resumenSalasEl.innerHTML = activos.slice(0, 6).map(s => `
            <tr>
                <td><strong>${escapeHtml(s.salas_velacion?.nombre || 'Por asignar')}</strong></td>
                <td>${escapeHtml(s.fallecido_nombres)}</td>
                <td>${escapeHtml(s.nombre_seguro || 'Particular')}</td>
                <td><span class="badge ${s.estado_expediente === 'EN_VELACION' ? 'badge-warning' : 'badge-info'}">${escapeHtml(ETIQUETA_ETAPA_SERVICIO[s.estado_expediente] || s.estado_expediente)}</span></td>
            </tr>
        `).join('') || '<tr><td colspan="4" class="muted-text">No hay velaciones activas en este momento.</td></tr>';
    }

    document.getElementById('tbody-servicios').innerHTML = srvs.map(s => {
        const slug = s.obituarios_digitales?.[0]?.slug_publico || s.obituarios_digitales?.slug_publico || '';
        const docsCount = [s.doc_cedula_fallecido, s.doc_certificado_defuncion, s.doc_autorizacion_inhumacion, s.doc_cedula_familiar, s.doc_orden_traslado].filter(Boolean).length;
        const esFinalizado = s.estado_expediente === 'FINALIZADO';
        const salaNombre = s.salas_velacion?.nombre || 'Sin sala';
        const vSrv = Number(s.valor_servicio_funerario || 0);
        const pct = Number(s.descuento_porcentaje || 0);
        const cob = Number(s.valor_cobertura_seguro || 0);
        const neto = Number(s.valor_total_neto || 0);
        const etapaTexto = ETIQUETA_ETAPA_SERVICIO[s.estado_expediente] || s.estado_expediente;
        return `
        <tr>
            <td><strong>${escapeHtml(s.codigo_expediente)}</strong><br><span class="badge ${esFinalizado ? 'badge-neutral' : 'badge-warning'}">${escapeHtml(etapaTexto)}</span></td>
            <td><strong>${escapeHtml(s.fallecido_nombres)}</strong><br><small class="muted-text">Sala: ${escapeHtml(salaNombre)} • ${escapeHtml(s.tipo_servicio || '')}: ${escapeHtml(s.camposanto_destino || '')}</small></td>
            <td>
                ${escapeHtml(s.nombre_seguro || 'Particular')} (Cob. $${cob.toFixed(2)})<br>
                <small class="muted-text">Servicio: $${vSrv.toFixed(2)} | Desc.: ${pct.toFixed(1)}% | <strong>Neto: $${neto.toFixed(2)}</strong></small>
            </td>
            <td>
                <span class="badge ${docsCount === 5 ? 'badge-success' : 'badge-info'}">${docsCount}/5 Controles</span>
                <br><small class="muted-text">Origen: ${escapeHtml(s.casa_salud_origen || '-')} • ${escapeHtml(s.tramites_ofrecidos_resumen || '')}</small>
            </td>
            <td class="btn-group">
                <button class="btn btn-sm btn-outline" onclick="openQRModal(${JSON.stringify(slug)}, ${JSON.stringify(s.fallecido_nombres)}, ${JSON.stringify(salaNombre)})">Obituario QR</button>
                <button class="btn btn-sm btn-secondary" onclick="abrirFacturaDesdeCliente('${escapeHtml(s.cliente_responsable_id)}')">Facturar</button>
                ${!esFinalizado ? `<button class="btn btn-sm btn-outline" onclick="finalizarServicio('${escapeHtml(s.id)}', '${escapeHtml(s.sala_id || '')}')">Finalizar</button>` : ''}
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted-text">No hay servicios registrados.</td></tr>';

    const srvOpts = '<option value="">-- Ninguno --</option>' +
        activos.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.codigo_expediente)} - ${escapeHtml(s.fallecido_nombres)}</option>`).join('');
    document.getElementById('egr-servicio').innerHTML = srvOpts;
}

document.getElementById('form-servicio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fallecido = document.getElementById('srv-fallecido').value.trim();
    const salaId = document.getElementById('srv-sala').value || null;
    const estadoSel = document.getElementById('srv-estado').value;

    const calc = calcularMontosServicio(
        document.getElementById('srv-valor-servicio').value,
        document.getElementById('srv-descuento-pct').value,
        document.getElementById('srv-cobertura-seguro').value
    );

    const { data: srvData, error } = await sb.from('servicios_funerarios').insert({
        organizacion_id: currentOrg.id,
        creado_por_user_id: currentUser.id,
        creado_por_nombre: currentUserName,
        codigo_expediente: document.getElementById('srv-codigo').value.trim(),
        cliente_responsable_id: document.getElementById('srv-cliente').value,
        fallecido_nombres: fallecido,
        fecha_fallecimiento: document.getElementById('srv-fecha-fall').value,
        nombre_seguro: document.getElementById('srv-nombre-seguro').value.trim(),
        valor_cobertura_seguro: calc.coberturaSeguro,
        valor_servicio_funerario: calc.valorServicio,
        descuento_porcentaje: calc.descuentoPct,
        valor_descuento: calc.valorDescuento,
        valor_total_neto: calc.totalNeto,
        casa_salud_origen: document.getElementById('srv-casa-salud').value.trim(),
        gestor_tramites_nombre: document.getElementById('srv-gestor').value.trim(),
        estado_tramites: 'EN_GESTION',
        tramites_ofrecidos_resumen: document.getElementById('srv-tramites-resumen').value.trim(),
        tipo_servicio: document.getElementById('srv-tipo').value,
        estado_expediente: salaId && estadoSel !== 'FINALIZADO' ? 'EN_VELACION' : estadoSel,
        sala_id: salaId,
        ataud_urna_id: document.getElementById('srv-ataud').value || null,
        camposanto_destino: document.getElementById('srv-camposanto').value.trim(),
        doc_cedula_fallecido: document.getElementById('doc-ced-fall').checked,
        doc_certificado_defuncion: document.getElementById('doc-cert-def').checked,
        doc_autorizacion_inhumacion: document.getElementById('doc-aut-inh').checked,
        doc_cedula_familiar: document.getElementById('doc-ced-fam').checked,
        doc_orden_traslado: document.getElementById('doc-ord-tras').checked
    }).select().single();

    if (error) return alert('Error al guardar servicio: ' + error.message);

    const slug = fallecido.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-4);
    await sb.from('obituarios_digitales').insert({
        organizacion_id: currentOrg.id,
        servicio_id: srvData.id,
        slug_publico: slug,
        epitafio: document.getElementById('srv-epitafio').value || ''
    });

    if (salaId) {
        await sb.from('salas_velacion').update({ estado: 'OCUPADA' }).eq('id', salaId);
    }

    e.target.reset();
    calcularResumenFinanciero('srv');
    document.getElementById('panel-form-servicio').classList.add('hidden');
    await refreshAllData();
    openQRModal(slug, fallecido, salaId ? 'Sala Asignada' : (ETIQUETA_ETAPA_SERVICIO[estadoSel] || estadoSel));
});

window.finalizarServicio = async (servicioId, salaId) => {
    await sb.from('servicios_funerarios').update({ estado_expediente: 'FINALIZADO' }).eq('id', servicioId);
    if (salaId) await sb.from('salas_velacion').update({ estado: 'DISPONIBLE' }).eq('id', salaId);
    await refreshAllData();
};

window.openQRModal = (slug, nombre, salaInfo = '') => {
    const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    const fullUrl = `${baseUrl}/obituario.html?slug=${encodeURIComponent(slug)}`;
    document.getElementById('qr-title').innerText = `Obituario: ${nombre}`;
    document.getElementById('qr-sala-info').innerText = `Estado / Sala: ${salaInfo || 'Por confirmar'}`;
    document.getElementById('qr-url-text').innerText = fullUrl;
    document.getElementById('qr-open-link').href = fullUrl;

    const container = document.getElementById('qrcode-container');
    container.innerHTML = '';
    new QRCode(container, { text: fullUrl, width: 170, height: 170 });
    document.getElementById('qr-modal').classList.remove('hidden');
};

window.copiarEnlaceQR = () => {
    navigator.clipboard.writeText(document.getElementById('qr-url-text').innerText);
    alert('Enlace copiado al portapapeles.');
};

// ============================================================================
// EMISIÓN DE FACTURA (PERMANECE EN CLIENTES) E INGRESOS
// ============================================================================
window.agregarItemFactura = () => {
    const prodId = document.getElementById('fac-select-prod').value;
    const cant = Number(document.getElementById('fac-item-cant').value) || 1;
    const prod = catalogoCache.find(p => p.id === prodId);
    if (!prod) return alert('Seleccione un ítem del tarifario.');

    const precio = Number(prod.precio_unitario);
    const pctIva = Number(prod.porcentaje_iva);
    const subtotal = precio * cant;
    const valorIva = subtotal * (pctIva / 100);

    facturaItems.push({
        producto_id: prod.id,
        codigo_principal: prod.codigo_principal,
        descripcion: prod.nombre,
        cantidad: cant,
        precio_unitario: precio,
        codigo_iva: prod.codigo_iva || (pctIva === 15 ? '4' : '0'),
        porcentaje_iva: pctIva,
        precio_total_sin_impuesto: subtotal,
        valor_iva: valorIva
    });

    renderFacturaItems();
};

window.quitarItemFactura = (idx) => {
    facturaItems.splice(idx, 1);
    renderFacturaItems();
};

function renderFacturaItems() {
    let sub15 = 0, sub0 = 0, ivaTotal = 0;
    document.getElementById('tbody-fac-items').innerHTML = facturaItems.map((it, idx) => {
        if (it.porcentaje_iva > 0) sub15 += it.precio_total_sin_impuesto;
        else sub0 += it.precio_total_sin_impuesto;
        ivaTotal += it.valor_iva;
        return `
        <tr>
            <td>${escapeHtml(it.codigo_principal)}</td>
            <td>${escapeHtml(it.descripcion)}</td>
            <td>${escapeHtml(it.cantidad)}</td>
            <td>$${it.precio_unitario.toFixed(2)}</td>
            <td>${escapeHtml(it.porcentaje_iva)}%</td>
            <td>$${it.precio_total_sin_impuesto.toFixed(2)}</td>
            <td><button type="button" class="btn btn-sm btn-outline" onclick="quitarItemFactura(${idx})">Quitar</button></td>
        </tr>`;
    }).join('');

    const total = sub15 + sub0 + ivaTotal;
    document.getElementById('fac-sub-15').innerText = `$${sub15.toFixed(2)}`;
    document.getElementById('fac-sub-0').innerText = `$${sub0.toFixed(2)}`;
    document.getElementById('fac-iva-val').innerText = `$${ivaTotal.toFixed(2)}`;
    document.getElementById('fac-total').innerText = `$${total.toFixed(2)}`;
}

function mapearCodigoFormaPago(textoPago) {
    if (textoPago === 'Tarjeta de crédito/débito') return '19';
    if (textoPago === 'Transferencia bancaria') return '20';
    return '01';
}

function mostrarFormaPagoLegible(codigoOrTexto) {
    if (codigoOrTexto === '19') return 'Tarjeta de crédito/débito';
    if (codigoOrTexto === '20') return 'Transferencia bancaria';
    if (codigoOrTexto === '01') return 'Efectivo';
    return codigoOrTexto || 'Efectivo';
}

function generarClaveAcceso(fechaObj, tipoComprobante, ruc, ambiente, serie, secuencial, codigoNumerico, tipoEmision) {
    const dd = String(fechaObj.getDate()).padStart(2, '0');
    const mm = String(fechaObj.getMonth() + 1).padStart(2, '0');
    const yyyy = String(fechaObj.getFullYear());
    const base48 = `${dd}${mm}${yyyy}${tipoComprobante}${ruc}${ambiente}${serie}${secuencial}${codigoNumerico}${tipoEmision}`;
    const pesos = [2, 3, 4, 5, 6, 7];
    let suma = 0, pesoIdx = 0;
    for (let i = base48.length - 1; i >= 0; i--) {
        suma += parseInt(base48[i], 10) * pesos[pesoIdx];
        pesoIdx = (pesoIdx + 1) % pesos.length;
    }
    let digito = 11 - (suma % 11);
    if (digito === 11) digito = 0;
    if (digito === 10) digito = 1;
    return `${base48}${digito}`;
}

function construirXMLFactura(factura, cliente, items) {
    const fecha = new Date(factura.fecha_emision);
    const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`;
    const detallesXml = items.map(it => `
    <detalle>
      <codigoPrincipal>${escapeHtml(it.codigo_principal)}</codigoPrincipal>
      <descripcion>${escapeHtml(it.descripcion)}</descripcion>
      <cantidad>${Number(it.cantidad).toFixed(2)}</cantidad>
      <precioUnitario>${Number(it.precio_unitario).toFixed(4)}</precioUnitario>
      <descuento>0.00</descuento>
      <precioTotalSinImpuesto>${Number(it.precio_total_sin_impuesto).toFixed(2)}</precioTotalSinImpuesto>
      <impuestos>
        <impuesto>
          <codigo>2</codigo>
          <codigoPorcentaje>${escapeHtml(it.codigo_iva)}</codigoPorcentaje>
          <tarifa>${Number(it.porcentaje_iva).toFixed(2)}</tarifa>
          <baseImponible>${Number(it.precio_total_sin_impuesto).toFixed(2)}</baseImponible>
          <valor>${Number(it.valor_iva).toFixed(2)}</valor>
        </impuesto>
      </impuestos>
    </detalle>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="2.1.0">
  <infoTributaria>
    <ambiente>${escapeHtml(currentOrg.ambiente_sri)}</ambiente>
    <tipoEmision>1</tipoEmision>
    <razonSocial>${escapeHtml(currentOrg.razon_social)}</razonSocial>
    <nombreComercial>${escapeHtml(currentOrg.nombre_comercial || currentOrg.razon_social)}</nombreComercial>
    <ruc>${escapeHtml(currentOrg.ruc)}</ruc>
    <claveAcceso>${escapeHtml(factura.clave_acceso)}</claveAcceso>
    <codDoc>01</codDoc>
    <estab>${escapeHtml(factura.establecimiento)}</estab>
    <ptoEmi>${escapeHtml(factura.punto_emision)}</ptoEmi>
    <secuencial>${escapeHtml(factura.secuencial)}</secuencial>
    <dirMatriz>${escapeHtml(currentOrg.direccion_matriz)}</dirMatriz>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>${fechaStr}</fechaEmision>
    <dirEstablecimiento>${escapeHtml(currentOrg.direccion_matriz)}</dirEstablecimiento>
    <obligadoContabilidad>${currentOrg.obligado_contabilidad ? 'SI' : 'NO'}</obligadoContabilidad>
    <tipoIdentificacionComprador>${escapeHtml(cliente.tipo_identificacion)}</tipoIdentificacionComprador>
    <razonSocialComprador>${escapeHtml(cliente.razon_social)}</razonSocialComprador>
    <identificacionComprador>${escapeHtml(cliente.identificacion)}</identificacionComprador>
    <totalSinImpuestos>${Number(factura.subtotal_sin_impuestos).toFixed(2)}</totalSinImpuestos>
    <totalDescuento>0.00</totalDescuento>
    <totalConImpuestos>
      <totalImpuesto>
        <codigo>2</codigo>
        <codigoPorcentaje>4</codigoPorcentaje>
        <baseImponible>${Number(factura.subtotal_15).toFixed(2)}</baseImponible>
        <valor>${Number(factura.valor_iva).toFixed(2)}</valor>
      </totalImpuesto>
    </totalConImpuestos>
    <propina>0.00</propina>
    <importeTotal>${Number(factura.importe_total).toFixed(2)}</importeTotal>
    <moneda>DOLAR</moneda>
    <pagos>
      <pago>
        <formaPago>${escapeHtml(factura.forma_pago_sri)}</formaPago>
        <total>${Number(factura.importe_total).toFixed(2)}</total>
      </pago>
    </pagos>
  </infoFactura>
  <detalles>${detallesXml}
  </detalles>
</factura>`;
}

document.getElementById('form-factura-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clienteId = document.getElementById('fac-cliente').value;
    if (!clienteId || facturaItems.length === 0) return alert('Seleccione un cliente y agregue al menos un ítem.');

    const { data: cli } = await sb.from('clientes').select('*').eq('id', clienteId).single();
    const secNum = Number(currentOrg.secuencial_factura || 1);
    const secStr = String(secNum).padStart(9, '0');
    const estab = currentOrg.establecimiento || '001';
    const pto = currentOrg.punto_emision || '001';
    const ahora = new Date();
    const codNum = String(Math.floor(10000000 + Math.random() * 90000000));
    const claveAcceso = generarClaveAcceso(ahora, '01', currentOrg.ruc, String(currentOrg.ambiente_sri || 1), `${estab}${pto}`, secStr, codNum, '1');

    const sub15 = facturaItems.filter(i => i.porcentaje_iva > 0).reduce((a, b) => a + b.precio_total_sin_impuesto, 0);
    const sub0 = facturaItems.filter(i => i.porcentaje_iva === 0).reduce((a, b) => a + b.precio_total_sin_impuesto, 0);
    const ivaVal = facturaItems.reduce((a, b) => a + b.valor_iva, 0);
    const total = sub15 + sub0 + ivaVal;
    const formaPagoTexto = document.getElementById('fac-forma-pago').value;

    const facPayload = {
        organizacion_id: currentOrg.id,
        cliente_id: clienteId,
        establecimiento: estab,
        punto_emision: pto,
        secuencial: secStr,
        clave_acceso: claveAcceso,
        fecha_emision: ahora.toISOString(),
        subtotal_sin_impuestos: sub15 + sub0,
        subtotal_15: sub15,
        subtotal_0: sub0,
        valor_iva: ivaVal,
        importe_total: total,
        forma_pago_sri: mapearCodigoFormaPago(formaPagoTexto),
        estado_sri: 'EMITIDA'
    };
    facPayload.xml_generado = construirXMLFactura(facPayload, cli, facturaItems);

    const { data: facSaved, error } = await sb.from('facturas_sri').insert(facPayload).select().single();
    if (error) return alert('Error al emitir factura: ' + error.message);

    const detallesConId = facturaItems.filter(it => it.producto_id).map(it => ({
        factura_id: facSaved.id,
        producto_id: it.producto_id,
        codigo_principal: it.codigo_principal,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        precio_unitario: it.precio_unitario,
        precio_total_sin_impuesto: it.precio_total_sin_impuesto,
        codigo_iva: it.codigo_iva,
        porcentaje_iva: it.porcentaje_iva,
        valor_iva: it.valor_iva
    }));
    if (detallesConId.length > 0) {
        await sb.from('factura_detalles').insert(detallesConId);
    }

    const prfRefId = document.getElementById('fac-proforma-ref').value;
    if (prfRefId) {
        const idxPrf = proformasCache.findIndex(p => p.id === prfRefId);
        if (idxPrf !== -1) {
            proformasCache[idxPrf].estado = 'TRATO_CERRADO';
            localStorage.setItem(storageKey('proformas'), JSON.stringify(proformasCache));
            renderProformas();
        }
    }

    currentOrg.secuencial_factura = secNum + 1;
    await sb.from('organizaciones').update({ secuencial_factura: currentOrg.secuencial_factura }).eq('id', currentOrg.id);
    document.getElementById('sri-secuencial').value = currentOrg.secuencial_factura;

    facturaItems = [];
    renderFacturaItems();
    document.getElementById('panel-facturar-cliente').classList.add('hidden');
    await loadFacturas();
    recalcularFinanzas();
    actualizarVistaGerencial();

    mostrarFeedbackComercial(`Factura ${estab}-${pto}-${secStr} emitida por $${total.toFixed(2)} (${formaPagoTexto}). El ingreso ya se encuentra reflejado en Ingresos, Ganancias Brutas y Control Gerencial.`);
};

async function loadFacturas() {
    const { data } = await sb
        .from('facturas_sri')
        .select('*, clientes(razon_social)')
        .eq('organizacion_id', currentOrg.id)
        .order('created_at', { ascending: false });

    facturasCache = data || [];
    document.getElementById('tbody-facturas').innerHTML = facturasCache.map(f => `
        <tr>
            <td><strong>${escapeHtml(f.establecimiento)}-${escapeHtml(f.punto_emision)}-${escapeHtml(f.secuencial)}</strong></td>
            <td>${new Date(f.fecha_emision).toLocaleDateString()}</td>
            <td>${escapeHtml(f.clientes?.razon_social || '-')}</td>
            <td>${escapeHtml(mostrarFormaPagoLegible(f.forma_pago_sri))}</td>
            <td>$${Number(f.subtotal_sin_impuestos || 0).toFixed(2)}</td>
            <td>$${Number(f.valor_iva || 0).toFixed(2)}</td>
            <td><strong>$${Number(f.importe_total).toFixed(2)}</strong></td>
            <td><button class="btn btn-sm btn-outline" onclick="descargarXML('${escapeHtml(f.id)}')">Descargar XML</button></td>
        </tr>
    `).join('') || '<tr><td colspan="8" class="muted-text">No existen ingresos facturados registrados.</td></tr>';
}

window.descargarXML = async (facturaId) => {
    const { data: fac } = await sb.from('facturas_sri').select('clave_acceso, xml_generado').eq('id', facturaId).single();
    if (!fac?.xml_generado) return;
    const blob = new Blob([fac.xml_generado], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fac.clave_acceso}.xml`;
    a.click();
    URL.revokeObjectURL(url);
};

// ============================================================================
// GASTOS Y GANANCIAS BRUTAS
// ============================================================================
async function loadEgresos() {
    const { data } = await sb.from('egresos_operativos').select('*').eq('organizacion_id', currentOrg.id).order('created_at', { ascending: false });
    egresosCache = data || [];
    document.getElementById('tbody-egresos').innerHTML = egresosCache.map(g => `
        <tr>
            <td>${escapeHtml(g.fecha_egreso || new Date(g.created_at).toLocaleDateString())}</td>
            <td><span class="badge badge-neutral">${escapeHtml(g.categoria_egreso)}</span></td>
            <td><strong>${escapeHtml(g.concepto)}</strong></td>
            <td>${escapeHtml(g.comprobante_ref || '-')}</td>
            <td>${escapeHtml(g.registrado_por_nombre || currentUserName)}</td>
            <td><strong>$${Number(g.monto).toFixed(2)}</strong></td>
        </tr>
    `).join('') || '<tr><td colspan="6" class="muted-text">No hay gastos registrados.</td></tr>';
}

document.getElementById('form-egreso').addEventListener('submit', async (e) => {
    e.preventDefault();
    await sb.from('egresos_operativos').insert({
        organizacion_id: currentOrg.id,
        servicio_id: document.getElementById('egr-servicio').value || null,
        registrado_por_nombre: currentUserName,
        categoria_egreso: document.getElementById('egr-categoria').value,
        concepto: document.getElementById('egr-concepto').value.trim(),
        monto: document.getElementById('egr-monto').value,
        fecha_egreso: document.getElementById('egr-fecha').value,
        comprobante_ref: document.getElementById('egr-ref').value.trim()
    });
    e.target.reset();
    document.getElementById('egr-fecha').valueAsDate = new Date();
    document.getElementById('panel-form-egreso').classList.add('hidden');
    await loadEgresos();
    recalcularFinanzas();
    actualizarVistaGerencial();
});

function recalcularFinanzas() {
    const ingresos = facturasCache.reduce((acc, f) => acc + Number(f.importe_total || 0), 0);
    const subtotales = facturasCache.reduce((acc, f) => acc + Number(f.subtotal_sin_impuestos || 0), 0);
    const ivas = facturasCache.reduce((acc, f) => acc + Number(f.valor_iva || 0), 0);
    const egresos = egresosCache.reduce((acc, g) => acc + Number(g.monto || 0), 0);
    const ganancia = ingresos - egresos;
    const margen = ingresos > 0 ? ((ganancia / ingresos) * 100).toFixed(1) : '0.0';

    document.getElementById('stat-ingresos').innerText = `$${ingresos.toFixed(2)}`;
    document.getElementById('stat-egresos-small').innerText = `Gastos: $${egresos.toFixed(2)}`;
    document.getElementById('stat-ganancia').innerText = `$${ganancia.toFixed(2)}`;

    document.getElementById('mod-ing-total').innerText = `$${ingresos.toFixed(2)}`;
    document.getElementById('mod-ing-count').innerText = `${facturasCache.length} facturas emitidas`;
    document.getElementById('mod-ing-subtotal').innerText = `$${subtotales.toFixed(2)}`;
    document.getElementById('mod-ing-iva').innerText = `$${ivas.toFixed(2)}`;

    document.getElementById('mod-gas-total').innerText = `$${egresos.toFixed(2)}`;
    document.getElementById('mod-gas-count').innerText = `${egresosCache.length} gastos registrados`;
    const promGasto = egresosCache.length > 0 ? (egresos / egresosCache.length) : 0;
    document.getElementById('mod-gas-promedio').innerText = `$${promGasto.toFixed(2)}`;

    const catTotals = {};
    egresosCache.forEach(g => {
        const c = g.categoria_egreso || 'OTROS';
        catTotals[c] = (catTotals[c] || 0) + Number(g.monto || 0);
    });
    const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];
    document.getElementById('mod-gas-top').innerText = topCat ? topCat[0] : '-';
    document.getElementById('mod-gas-top-val').innerText = topCat ? `$${topCat[1].toFixed(2)}` : '$0.00';

    document.getElementById('rep-ingresos').innerText = `$${ingresos.toFixed(2)}`;
    document.getElementById('rep-egresos').innerText = `$${egresos.toFixed(2)}`;
    document.getElementById('rep-ganancia').innerText = `$${ganancia.toFixed(2)}`;
    document.getElementById('rep-margen').innerText = `Margen bruto: ${margen}%`;

    const mapaMeses = {};
    facturasCache.forEach(f => {
        const d = parseFechaLocal(f.fecha_emision);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!mapaMeses[key]) mapaMeses[key] = { ing: 0, gas: 0 };
        mapaMeses[key].ing += Number(f.importe_total || 0);
    });
    egresosCache.forEach(g => {
        const d = parseFechaLocal(g.fecha_egreso || g.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!mapaMeses[key]) mapaMeses[key] = { ing: 0, gas: 0 };
        mapaMeses[key].gas += Number(g.monto || 0);
    });

    const clavesOrdenadas = Object.keys(mapaMeses).sort().reverse();
    document.getElementById('tbody-ganancias-mensuales').innerHTML = clavesOrdenadas.map(k => {
        const [yStr, mStr] = k.split('-');
        const nombreMes = NOMBRES_MESES[Number(mStr) - 1] || mStr;
        const { ing, gas } = mapaMeses[k];
        const gan = ing - gas;
        const mrg = ing > 0 ? ((gan / ing) * 100).toFixed(1) : '0.0';
        return `
        <tr>
            <td><strong>${escapeHtml(nombreMes)} ${escapeHtml(yStr)}</strong></td>
            <td>$${ing.toFixed(2)}</td>
            <td>$${gas.toFixed(2)}</td>
            <td><strong>$${gan.toFixed(2)}</strong></td>
            <td><span class="badge ${gan >= 0 ? 'badge-success' : 'badge-danger'}">${mrg}%</span></td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted-text">Sin movimientos mensuales registrados.</td></tr>';
}

// ============================================================================
// CONFIGURACIÓN Y EQUIPO
// ============================================================================
document.getElementById('form-sri-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {
        ambiente_sri: Number(document.getElementById('sri-ambiente').value),
        regimen_rimpe: document.getElementById('sri-regimen').value,
        obligado_contabilidad: document.getElementById('sri-contabilidad').value === 'true',
        ruc_proveedor_software: document.getElementById('sri-ruc-prov').value,
        establecimiento: document.getElementById('sri-estab').value,
        punto_emision: document.getElementById('sri-pto').value,
        secuencial_factura: Number(document.getElementById('sri-secuencial').value),
        firma_vigencia_hasta: document.getElementById('sri-firma-vigencia').value || null
    };
    await sb.from('organizaciones').update(updates).eq('id', currentOrg.id);
    Object.assign(currentOrg, updates);
    document.getElementById('user-badge').innerText = currentOrg.ambiente_sri === 1 ? 'Ambiente: Pruebas' : 'Ambiente: Producción';
    if (updates.firma_vigencia_hasta) verificarVigenciaFirma(updates.firma_vigencia_hasta);
    alert('Parámetros guardados.');
});

async function loadEquipo() {
    const { data } = await sb.from('usuarios_roles').select('*').eq('organizacion_id', currentOrg.id);
    const eq = data || [];
    document.getElementById('tbody-equipo').innerHTML = eq.map(m => `
        <tr>
            <td><strong>${escapeHtml(m.nombre_completo)}</strong></td>
            <td>${escapeHtml(m.correo_contacto || (m.user_id === currentUser.id ? currentUser.email : 'Usuario registrado'))}</td>
            <td><span class="badge badge-neutral">${escapeHtml(m.rol.toUpperCase())}</span></td>
            <td><span class="badge badge-success">${m.activo ? 'ACTIVO' : 'INACTIVO'}</span></td>
        </tr>
    `).join('');
}