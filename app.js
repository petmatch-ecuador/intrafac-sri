// ============================================================================
// CONFIGURACIÓN DE CONEXIÓN SUPABASE (NEXORA SUITE)
// ============================================================================
const SUPABASE_URL = 'https://fmsjkibcczmjsxoodzae.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JY2cBrl5RAp1dqbjgTC3SA_-DAKJknF';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentOrg = null;
let currentRole = 'admin';
let currentUserName = '';
let catalogoCache = [];
let serviciosCache = [];
let facturasCache = [];
let egresosCache = [];
let facturaItems = [];

// ============================================================================
// 1. AUTENTICACIÓN Y REGISTRO MULTI-EMPRESA
// ============================================================================
document.getElementById('toggle-register').onclick = (e) => {
    e.preventDefault();
    document.getElementById('login-form').classList.add('hidden');
    document.getElementById('register-form').classList.remove('hidden');
};

document.getElementById('toggle-login').onclick = (e) => {
    e.preventDefault();
    document.getElementById('register-form').classList.add('hidden');
    document.getElementById('login-form').classList.remove('hidden');
};

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) showAlert(error.message);
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const empresa = document.getElementById('reg-empresa').value;
    const ruc = document.getElementById('reg-ruc').value;
    const direccion = document.getElementById('reg-direccion').value;
    const nombre = document.getElementById('reg-nombre').value;

    const { data: authData, error: authErr } = await sb.auth.signUp({ email, password });
    if (authErr) return showAlert(authErr.message);
    if (!authData?.user?.id) return showAlert('No se pudo obtener el ID del usuario.');

    const { error: rpcErr } = await sb.rpc('registrar_nueva_empresa', {
        p_user_id: authData.user.id,
        p_ruc: ruc,
        p_razon_social: empresa,
        p_direccion: direccion,
        p_nombre_admin: nombre
    });
    if (rpcErr) return showAlert('Error creando organización: ' + rpcErr.message);

    await sb.from('usuarios_roles').update({ correo_contacto: email }).eq('user_id', authData.user.id);
    await sb.auth.signInWithPassword({ email, password });
    location.reload();
});

document.getElementById('btn-logout').onclick = () => sb.auth.signOut();

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
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('app-screen').classList.add('hidden');
    }
});

// ============================================================================
// 2. INICIALIZACIÓN, MENÚ DESPLEGABLE Y NAVEGACIÓN EJECUTIVA
// ============================================================================
window.toggleNavGroup = (groupId, btnEl) => {
    const itemsEl = document.getElementById(groupId);
    if (!itemsEl) return;
    itemsEl.classList.toggle('hidden');
    if (btnEl) btnEl.classList.toggle('expanded', !itemsEl.classList.contains('hidden'));
};

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
    document.getElementById('sidebar-org-name').innerText = `${currentOrg.nombre_comercial} (RUC: ${currentOrg.ruc})`;
    document.getElementById('sidebar-user-info').innerText = `${currentUserName} • ${currentRole.toUpperCase()}`;
    document.getElementById('sidebar-rol-tag').innerText = currentRole.toUpperCase();
    document.getElementById('user-badge').innerText = currentOrg.ambiente_sri === 1 ? 'Ambiente SRI: Pruebas' : 'Ambiente SRI: Producción';

    document.getElementById('sri-ambiente').value = currentOrg.ambiente_sri || 1;
    document.getElementById('sri-regimen').value = currentOrg.regimen_rimpe || 'GENERAL';
    document.getElementById('sri-contabilidad').value = String(currentOrg.obligado_contabilidad || false);
    document.getElementById('sri-ruc-prov').value = currentOrg.ruc_proveedor_software || '1790000000001';
    document.getElementById('sri-estab').value = currentOrg.establecimiento || '001';
    document.getElementById('sri-pto').value = currentOrg.punto_emision || '001';
    document.getElementById('sri-secuencial').value = currentOrg.secuencial_factura || 1;
    if (currentOrg.firma_vigencia_hasta) document.getElementById('sri-firma-vigencia').value = currentOrg.firma_vigencia_hasta;

    document.getElementById('egr-fecha').valueAsDate = new Date();
    calcularResumenFinanciero('vta');
    calcularResumenFinanciero('srv');

    await refreshAllData();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

window.switchTab = (tabId) => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== tabId));

    const activeBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
    if (activeBtn) {
        const groupContainer = activeBtn.closest('.nav-group-items');
        if (groupContainer && groupContainer.classList.contains('hidden')) {
            groupContainer.classList.remove('hidden');
            const toggleBtn = document.querySelector(`.nav-group-toggle[data-group="${groupContainer.id}"]`);
            if (toggleBtn) toggleBtn.classList.add('expanded');
        }
        document.getElementById('page-title').innerText = activeBtn.innerText.replace(/^[^\s]+\s/, '');
    }
};

window.toggleFormPanel = (panelId) => {
    const el = document.getElementById(panelId);
    if (el) el.classList.toggle('hidden');
};

window.openQuickAction = (tabId, panelId) => {
    switchTab(tabId);
    const panel = document.getElementById(panelId);
    if (panel) panel.classList.remove('hidden');
};

window.showFactSubtab = (subId) => {
    ['sub-emitir', 'sub-historial', 'sub-config-sri'].forEach(id => {
        document.getElementById(id).classList.toggle('hidden', id !== subId);
    });
};

window.refreshAllData = async () => {
    await Promise.all([
        loadSalas(),
        loadProductos(),
        loadClientes(),
        loadServicios(),
        loadPlanes(),
        loadFacturas(),
        loadEgresos(),
        loadEquipo(),
        loadSoporte()
    ]);
    recalcularFinanzas();
};

// ============================================================================
// CÁLCULO DE VALOR SERVICIO, DESCUENTO % Y COBERTURA DE SEGURO
// ============================================================================
function calcularMontosServicio(valorServicioRaw, descuentoPctRaw, coberturaSeguroRaw) {
    const valorServicio = Math.max(0, Number(valorServicioRaw) || 0);
    const descuentoPct = Math.min(100, Math.max(0, Number(descuentoPctRaw) || 0));
    const coberturaSeguro = Math.max(0, Number(coberturaSeguroRaw) || 0);

    const valorDescuento = valorServicio * (descuentoPct / 100);
    const subtotalConDescuento = Math.max(0, valorServicio - valorDescuento);
    const totalNeto = Math.max(0, subtotalConDescuento - coberturaSeguro);

    return {
        valorServicio,
        descuentoPct,
        coberturaSeguro,
        valorDescuento,
        totalNeto
    };
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

// ============================================================================
// 3. SALAS DE VELACIÓN, RECOJO Y LIMPIEZA/DESINFECCIÓN
// ============================================================================
async function loadSalas() {
    const { data } = await sb.from('salas_velacion').select('*').eq('organizacion_id', currentOrg.id).order('nombre');
    const salas = data || [];
    document.getElementById('stat-salas').innerText = salas.filter(s => s.estado === 'DISPONIBLE').length;

    document.getElementById('tbody-salas').innerHTML = salas.map(s => `
        <tr>
            <td><strong>${s.nombre}</strong></td>
            <td>${s.capacidad_personas} pers.</td>
            <td>${s.direccion_sucursal || '-'}</td>
            <td><span class="badge ${s.estado === 'DISPONIBLE' ? 'badge-success' : 'badge-warning'}">${s.estado}</span></td>
            <td><button class="btn btn-sm btn-outline" onclick="toggleSala('${s.id}', '${s.estado}')">Marcar Limpieza / Cambiar Estado</button></td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="muted-text">No hay salas registradas.</td></tr>';

    const salaOpts = '<option value="">-- Sin sala asignada --</option>' +
        salas.map(s => `<option value="${s.id}">${s.nombre} (${s.estado})</option>`).join('');
    document.getElementById('srv-sala').innerHTML = salaOpts;
    document.getElementById('vta-sala').innerHTML = salaOpts;
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
    loadSalas();
});

window.toggleSala = async (id, estadoActual) => {
    const nuevo = estadoActual === 'DISPONIBLE' ? 'OCUPADA' : 'DISPONIBLE';
    await sb.from('salas_velacion').update({ estado: nuevo }).eq('id', id);
    await Promise.all([loadSalas(), loadServicios()]);
};

// ============================================================================
// 4. INVENTARIO Y BANNER DE ALERTAS
// ============================================================================
async function loadProductos() {
    const { data } = await sb.from('productos_servicios').select('*').eq('organizacion_id', currentOrg.id).order('nombre');
    const prods = data || [];
    catalogoCache = prods;

    const totalStock = prods.filter(p => p.categoria === 'ATAUD' || p.categoria === 'URNA')
                            .reduce((acc, p) => acc + Number(p.stock_actual), 0);

    const criticos = prods.filter(p => p.tipo === 'BIEN' && Number(p.stock_actual) <= Number(p.stock_minimo));
    const stockBadge = document.getElementById('banner-stock-badge');
    const alertText = document.getElementById('banner-alertas-text');
    if (criticos.length > 0) {
        stockBadge.className = 'badge badge-danger';
        stockBadge.innerText = `${criticos.length} bajo mínimo`;
        alertText.innerText = `Alerta bodega: ${criticos.map(c => `${c.nombre} (${c.stock_actual})`).join(', ')}.`;
    } else {
        stockBadge.className = 'badge badge-success';
        stockBadge.innerText = 'Operación al día';
        alertText.innerText = `${totalStock} ataúdes/urnas en stock. Casos por velar, seguros y descuentos activos.`;
    }

    document.getElementById('tbody-productos').innerHTML = prods.map(p => `
        <tr>
            <td>${p.codigo_principal}</td>
            <td><strong>${p.nombre}</strong></td>
            <td>${p.categoria}</td>
            <td>$${Number(p.precio_unitario).toFixed(2)}</td>
            <td>${p.porcentaje_iva}%</td>
            <td><span class="badge ${p.tipo === 'BIEN' && p.stock_actual <= p.stock_minimo ? 'badge-danger' : 'badge-success'}">${p.stock_actual}</span></td>
            <td><button class="btn btn-sm btn-outline" onclick="sumarStock('${p.id}', ${p.stock_actual})">+1 Ingreso</button></td>
        </tr>
    `).join('') || '<tr><td colspan="7" class="muted-text">No hay ítems en inventario.</td></tr>';

    const ataudOpts = '<option value="">-- Seleccionar Ataúd / Urna --</option>' +
        prods.filter(p => p.categoria === 'ATAUD' || p.categoria === 'URNA')
             .map(p => `<option value="${p.id}">${p.nombre} (Stock: ${p.stock_actual})</option>`).join('');
    document.getElementById('srv-ataud').innerHTML = ataudOpts;
    document.getElementById('vta-ataud').innerHTML = ataudOpts;

    document.getElementById('fac-select-prod').innerHTML = '<option value="">-- Seleccionar ítem del catálogo --</option>' +
        prods.map(p => `<option value="${p.id}">${p.codigo_principal} - ${p.nombre} ($${Number(p.precio_unitario).toFixed(2)} + IVA ${p.porcentaje_iva}%)</option>`).join('');
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
    loadProductos();
});

window.sumarStock = async (id, actual) => {
    await sb.from('productos_servicios').update({ stock_actual: Number(actual) + 1 }).eq('id', id);
    loadProductos();
};

// ============================================================================
// 5. CLIENTES
// ============================================================================
async function loadClientes() {
    const { data } = await sb.from('clientes').select('*').eq('organizacion_id', currentOrg.id).order('razon_social');
    const clis = data || [];

    document.getElementById('tbody-clientes').innerHTML = clis.map(c => `
        <tr>
            <td>${c.identificacion}</td>
            <td><strong>${c.razon_social}</strong></td>
            <td>${c.telefono_whatsapp || '-'}</td>
            <td>${c.correo || '-'}</td>
            <td><button class="btn btn-sm btn-outline" onclick="facturarACliente('${c.id}')">🧾 Facturar</button></td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="muted-text">No hay clientes registrados.</td></tr>';

    const opts = '<option value="">-- Seleccionar Cliente --</option>' + clis.map(c => `<option value="${c.id}">${c.razon_social} (${c.identificacion})</option>`).join('');
    document.getElementById('srv-cliente').innerHTML = opts;
    document.getElementById('vta-cliente').innerHTML = opts;
    document.getElementById('plan-titular').innerHTML = opts;
    document.getElementById('fac-cliente').innerHTML = opts;
}

document.getElementById('form-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    await sb.from('clientes').insert({
        organizacion_id: currentOrg.id,
        tipo_identificacion: document.getElementById('cli-tipo-id').value,
        identificacion: document.getElementById('cli-identificacion').value,
        razon_social: document.getElementById('cli-nombre').value,
        telefono_whatsapp: document.getElementById('cli-telefono').value,
        correo: document.getElementById('cli-correo').value,
        direccion: document.getElementById('cli-direccion').value
    });
    e.target.reset();
    loadClientes();
});

window.facturarACliente = (clienteId) => {
    switchTab('tab-facturacion');
    showFactSubtab('sub-emitir');
    document.getElementById('fac-cliente').value = clienteId;
};

// ============================================================================
// 6. VENTAS, SEGURO ALFABÉTICO, COBERTURA $, DESCUENTO %, MONITOR Y QR
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
    const enVelacion = activos.filter(s => s.estado_expediente === 'EN_VELACION' || (s.salas_velacion && s.estado_expediente !== 'POR_VELAR'));
    const porVelar = activos.filter(s => s.estado_expediente === 'POR_VELAR');

    document.getElementById('stat-servicios').innerText = activos.length;
    document.getElementById('stat-velando-detalle').innerText = `${enVelacion.length} en sala • ${porVelar.length} por velar`;

    document.getElementById('banner-salas-count').innerText = `${enVelacion.length} en sala`;
    document.getElementById('banner-salas-list').innerHTML = enVelacion.length > 0
        ? enVelacion.map(s => `<strong>${s.salas_velacion?.nombre || 'Sala'}:</strong> ${s.fallecido_nombres} (${s.nombre_seguro || 'Seguro'})`).join(' &nbsp;|&nbsp; ')
        : 'No hay velaciones activas en sala en este momento.';

    document.getElementById('tbody-monitor-velando').innerHTML = enVelacion.map(s => {
        const slug = s.obituarios_digitales?.[0]?.slug_publico || s.obituarios_digitales?.slug_publico || '';
        const salaNombre = s.salas_velacion?.nombre || 'Sala Asignada';
        const neto = Number(s.valor_total_neto || 0);
        return `
        <tr>
            <td><span class="badge badge-warning">${salaNombre}</span></td>
            <td><strong>${s.fallecido_nombres}</strong><br><small class="muted-text">${s.codigo_expediente}</small></td>
            <td><span class="badge badge-info">${s.nombre_seguro || 'Sin especificar'}</span><br><small class="muted-text">Cob.: $${Number(s.valor_cobertura_seguro || 0).toFixed(2)}</small></td>
            <td><strong>$${neto.toFixed(2)}</strong></td>
            <td><button class="btn btn-sm btn-primary" onclick="openQRModal('${slug}', '${s.fallecido_nombres}', '${salaNombre}', '${s.tramites_ofrecidos_resumen || ''}')">📲 QR / Info Familia</button></td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted-text">No hay fallecidos velándose en sala en este momento.</td></tr>';

    document.getElementById('tbody-monitor-por-velar').innerHTML = porVelar.map(s => {
        const slug = s.obituarios_digitales?.[0]?.slug_publico || s.obituarios_digitales?.slug_publico || '';
        const salaTxt = s.salas_velacion?.nombre || 'Pendiente sala';
        const origenTxt = `${s.casa_salud_origen || 'Casa de salud'} • ${s.nombre_seguro || 'Seguro'} ($${Number(s.valor_cobertura_seguro || 0).toFixed(2)})`;
        return `
        <tr>
            <td><strong>${s.codigo_expediente}</strong></td>
            <td>${s.fallecido_nombres}</td>
            <td>${origenTxt}</td>
            <td>${salaTxt} <br><small class="muted-text">${s.gestor_tramites_nombre ? 'Gestor: ' + s.gestor_tramites_nombre : ''}</small></td>
            <td class="btn-group">
                <button class="btn btn-sm btn-outline" onclick="pasarAVelacion('${s.id}', '${s.sala_id || ''}')">🕯️ Ingresar a Sala</button>
                <button class="btn btn-sm btn-primary" onclick="openQRModal('${slug}', '${s.fallecido_nombres}', '${salaTxt}', '${s.tramites_ofrecidos_resumen || ''}')">QR</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" class="muted-text">No hay expedientes pendientes por velar.</td></tr>';

    document.getElementById('tbody-ventas').innerHTML = srvs.map(s => {
        const vSrv = Number(s.valor_servicio_funerario || 0);
        const pct = Number(s.descuento_porcentaje || 0);
        const cob = Number(s.valor_cobertura_seguro || 0);
        const neto = Number(s.valor_total_neto || 0);
        return `
        <tr>
            <td><strong>${s.codigo_expediente}</strong><br><small class="muted-text">${s.casa_salud_origen || ''}</small></td>
            <td>${s.fallecido_nombres}</td>
            <td><span class="badge badge-info">${s.nombre_seguro || 'N/A'}</span><br><small class="muted-text">Cubierto: $${cob.toFixed(2)}</small></td>
            <td>Serv: $${vSrv.toFixed(2)}<br><small class="muted-text">Desc.: ${pct.toFixed(1)}%</small></td>
            <td><strong>$${neto.toFixed(2)}</strong></td>
            <td class="btn-group">
                <button class="btn btn-sm btn-secondary" onclick="facturarExpediente('${s.cliente_responsable_id}', '${s.id}')">🧾 Facturar</button>
                <button class="btn btn-sm btn-outline" onclick="switchTab('tab-servicios')">Gestionar</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted-text">No hay ventas o casos registrados aún.</td></tr>';

    document.getElementById('tbody-servicios').innerHTML = srvs.map(s => {
        const slug = s.obituarios_digitales?.[0]?.slug_publico || s.obituarios_digitales?.slug_publico || '';
        const docsCount = [s.doc_cedula_fallecido, s.doc_certificado_defuncion, s.doc_autorizacion_inhumacion, s.doc_cedula_familiar, s.doc_orden_traslado].filter(Boolean).length;
        const esFinalizado = s.estado_expediente === 'FINALIZADO';
        const salaNombre = s.salas_velacion?.nombre || 'Sin sala';
        const vSrv = Number(s.valor_servicio_funerario || 0);
        const pct = Number(s.descuento_porcentaje || 0);
        const cob = Number(s.valor_cobertura_seguro || 0);
        const neto = Number(s.valor_total_neto || 0);
        return `
        <tr>
            <td><strong>${s.codigo_expediente}</strong><br><span class="badge ${esFinalizado ? 'badge-info' : 'badge-warning'}">${s.estado_expediente}</span></td>
            <td>${s.fallecido_nombres}<br><span class="badge badge-info">${s.nombre_seguro || 'Seguro'}</span> • ${salaNombre}</td>
            <td>
                Serv: $${vSrv.toFixed(2)} | Desc: ${pct.toFixed(1)}%<br>
                Cob. Seg.: $${cob.toFixed(2)} | <strong>Neto: $${neto.toFixed(2)}</strong>
            </td>
            <td>
                <span class="badge ${docsCount === 5 ? 'badge-success' : 'badge-info'}">${docsCount}/5 Docs</span>
                <br><small class="muted-text">Trámites: ${s.estado_tramites || 'EN_GESTION'}${s.gestor_tramites_nombre ? ' (' + s.gestor_tramites_nombre + ')' : ''}</small>
            </td>
            <td>${s.creado_por_nombre || currentUserName}</td>
            <td class="btn-group">
                <button class="btn btn-sm btn-primary" onclick="openQRModal('${slug}', '${s.fallecido_nombres}', '${salaNombre}', '${s.tramites_ofrecidos_resumen || ''}')">QR</button>
                <button class="btn btn-sm btn-secondary" onclick="facturarExpediente('${s.cliente_responsable_id}', '${s.id}')">🧾 Facturar</button>
                ${!esFinalizado ? `<button class="btn btn-sm btn-outline" onclick="finalizarServicio('${s.id}', '${s.sala_id || ''}')">✔ Finalizar</button>` : ''}
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted-text">No hay expedientes registrados.</td></tr>';

    const srvOpts = '<option value="">-- Ninguno --</option>' +
        activos.map(s => `<option value="${s.id}">${s.codigo_expediente} - ${s.fallecido_nombres}</option>`).join('');
    document.getElementById('fac-servicio-ref').innerHTML = srvOpts;
    document.getElementById('egr-servicio').innerHTML = srvOpts;

    document.getElementById('tbody-bitacora-admin').innerHTML = srvs.map(s => `
        <tr>
            <td><strong>${s.codigo_expediente}</strong></td>
            <td>${s.fallecido_nombres} (${s.nombre_seguro || 'Seguro'} • Neto $${Number(s.valor_total_neto || 0).toFixed(2)})</td>
            <td><span class="badge badge-info">${s.estado_expediente}</span></td>
            <td><strong>${s.creado_por_nombre || currentUserName}</strong>${s.gestor_tramites_nombre ? ' • Gestor: ' + s.gestor_tramites_nombre : ''}</td>
            <td>${new Date(s.created_at).toLocaleDateString()}</td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="muted-text">Sin registros en bitácora.</td></tr>';
}

async function crearExpedienteBase(payload) {
    const calc = calcularMontosServicio(
        payload.valor_servicio_funerario,
        payload.descuento_porcentaje,
        payload.valor_cobertura_seguro
    );

    const { data: srvData, error } = await sb.from('servicios_funerarios').insert({
        organizacion_id: currentOrg.id,
        creado_por_user_id: currentUser.id,
        creado_por_nombre: currentUserName,
        ...payload,
        valor_servicio_funerario: calc.valorServicio,
        descuento_porcentaje: calc.descuentoPct,
        valor_cobertura_seguro: calc.coberturaSeguro,
        valor_descuento: calc.valorDescuento,
        valor_total_neto: calc.totalNeto
    }).select().single();

    if (error) {
        alert('Error: ' + error.message);
        return null;
    }

    const slug = payload.fallecido_nombres.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-4);
    await sb.from('obituarios_digitales').insert({
        organizacion_id: currentOrg.id,
        servicio_id: srvData.id,
        slug_publico: slug,
        epitafio: payload.epitafio_tmp || ''
    });

    if (payload.sala_id) {
        await sb.from('salas_velacion').update({ estado: 'OCUPADA' }).eq('id', payload.sala_id);
    }

    await refreshAllData();
    return { srvData, slug };
}

document.getElementById('form-venta').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fallecido = document.getElementById('vta-fallecido').value;
    const salaId = document.getElementById('vta-sala').value || null;
    const tramitesTxt = document.getElementById('vta-tramites-resumen').value;
    const res = await crearExpedienteBase({
        codigo_expediente: document.getElementById('vta-codigo').value,
        cliente_responsable_id: document.getElementById('vta-cliente').value,
        fallecido_nombres: fallecido,
        fecha_fallecimiento: document.getElementById('vta-fecha-fall').value,
        nombre_seguro: document.getElementById('vta-nombre-seguro').value,
        valor_cobertura_seguro: document.getElementById('vta-cobertura-seguro').value,
        valor_servicio_funerario: document.getElementById('vta-valor-servicio').value,
        descuento_porcentaje: document.getElementById('vta-descuento-pct').value,
        casa_salud_origen: document.getElementById('vta-casa-salud').value,
        gestor_tramites_nombre: document.getElementById('vta-gestor').value,
        tramites_ofrecidos_resumen: tramitesTxt,
        estado_expediente: salaId ? 'EN_VELACION' : document.getElementById('vta-estado-ini').value,
        sala_id: salaId,
        ataud_urna_id: document.getElementById('vta-ataud').value || null,
        camposanto_destino: document.getElementById('vta-camposanto').value,
        epitafio_tmp: document.getElementById('vta-epitafio').value
    });
    if (res) {
        e.target.reset();
        calcularResumenFinanciero('vta');
        openQRModal(res.slug, fallecido, salaId ? 'Sala Asignada' : 'Por Velar', tramitesTxt);
    }
});

document.getElementById('form-servicio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fallecido = document.getElementById('srv-fallecido').value;
    const salaId = document.getElementById('srv-sala').value || null;
    const estadoSel = document.getElementById('srv-estado').value;
    const tramitesTxt = document.getElementById('srv-tramites-resumen').value;

    const res = await crearExpedienteBase({
        codigo_expediente: document.getElementById('srv-codigo').value,
        cliente_responsable_id: document.getElementById('srv-cliente').value,
        fallecido_nombres: fallecido,
        fecha_fallecimiento: document.getElementById('srv-fecha-fall').value,
        nombre_seguro: document.getElementById('srv-nombre-seguro').value,
        valor_cobertura_seguro: document.getElementById('srv-cobertura-seguro').value,
        valor_servicio_funerario: document.getElementById('srv-valor-servicio').value,
        descuento_porcentaje: document.getElementById('srv-descuento-pct').value,
        casa_salud_origen: document.getElementById('srv-casa-salud').value,
        gestor_tramites_nombre: document.getElementById('srv-gestor').value,
        estado_tramites: document.getElementById('srv-estado-tramites').value,
        tramites_ofrecidos_resumen: tramitesTxt,
        tipo_servicio: document.getElementById('srv-tipo').value,
        estado_expediente: salaId && estadoSel === 'POR_VELAR' ? 'EN_VELACION' : estadoSel,
        sala_id: salaId,
        ataud_urna_id: document.getElementById('srv-ataud').value || null,
        camposanto_destino: document.getElementById('srv-camposanto').value,
        epitafio_tmp: document.getElementById('srv-epitafio').value,
        doc_cedula_fallecido: document.getElementById('doc-ced-fall').checked,
        doc_certificado_defuncion: document.getElementById('doc-cert-def').checked,
        doc_autorizacion_inhumacion: document.getElementById('doc-aut-inh').checked,
        doc_cedula_familiar: document.getElementById('doc-ced-fam').checked,
        doc_orden_traslado: document.getElementById('doc-ord-tras').checked
    });

    if (res) {
        e.target.reset();
        calcularResumenFinanciero('srv');
        openQRModal(res.slug, fallecido, salaId ? 'Sala Asignada' : estadoSel, tramitesTxt);
    }
});

window.pasarAVelacion = async (servicioId, salaId) => {
    await sb.from('servicios_funerarios').update({ estado_expediente: 'EN_VELACION' }).eq('id', servicioId);
    if (salaId) await sb.from('salas_velacion').update({ estado: 'OCUPADA' }).eq('id', salaId);
    await refreshAllData();
};

window.finalizarServicio = async (servicioId, salaId) => {
    await sb.from('servicios_funerarios').update({ estado_expediente: 'FINALIZADO' }).eq('id', servicioId);
    if (salaId) await sb.from('salas_velacion').update({ estado: 'DISPONIBLE' }).eq('id', salaId);
    await refreshAllData();
};

window.facturarExpediente = (clienteId, servicioId) => {
    switchTab('tab-facturacion');
    showFactSubtab('sub-emitir');
    if (clienteId) document.getElementById('fac-cliente').value = clienteId;
    if (servicioId) document.getElementById('fac-servicio-ref').value = servicioId;
};

window.openQRModal = (slug, nombre, salaInfo = '', tramitesInfo = '') => {
    const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    const fullUrl = `${baseUrl}/obituario.html?slug=${slug}`;
    document.getElementById('qr-title').innerText = `Obituario: ${nombre}`;
    const extraTramites = tramitesInfo ? ` | Trámites a cargo: ${tramitesInfo}` : '';
    document.getElementById('qr-sala-info').innerText = `${salaInfo || 'Información para familiares'}${extraTramites}. Comparte este enlace o QR con los familiares.`;
    document.getElementById('qr-url-text').innerText = fullUrl;
    document.getElementById('qr-open-link').href = fullUrl;

    const container = document.getElementById('qrcode-container');
    container.innerHTML = '';
    new QRCode(container, { text: fullUrl, width: 175, height: 175 });
    document.getElementById('qr-modal').classList.remove('hidden');
};

window.copiarEnlaceQR = () => {
    const txt = document.getElementById('qr-url-text').innerText;
    navigator.clipboard.writeText(txt);
    alert('Enlace para familiares copiado al portapapeles.');
};

// ============================================================================
// 7. PREVISIÓN EXEQUIAL
// ============================================================================
async function loadPlanes() {
    const { data } = await sb.from('planes_prevision_exequial').select('*, clientes(razon_social)').eq('organizacion_id', currentOrg.id);
    const planes = data || [];
    document.getElementById('tbody-planes').innerHTML = planes.map(p => `
        <tr><td>${p.numero_contrato}</td><td>${p.clientes?.razon_social}</td><td>${p.nombre_plan}</td><td>$${Number(p.valor_cuota_mensual).toFixed(2)}</td><td><span class="badge badge-success">${p.estado}</span></td></tr>
    `).join('') || '<tr><td colspan="5" class="muted-text">No hay contratos registrados.</td></tr>';
}

document.getElementById('form-plan').addEventListener('submit', async (e) => {
    e.preventDefault();
    await sb.from('planes_prevision_exequial').insert({
        organizacion_id: currentOrg.id,
        numero_contrato: document.getElementById('plan-contrato').value,
        titular_id: document.getElementById('plan-titular').value,
        nombre_plan: document.getElementById('plan-nombre').value,
        valor_cuota_mensual: document.getElementById('plan-cuota').value,
        fecha_inicio: document.getElementById('plan-inicio').value
    });
    e.target.reset();
    loadPlanes();
});

// ============================================================================
// 8. FACTURACIÓN ELECTRÓNICA SRI (MÓDULO 11 + XML)
// ============================================================================
window.agregarItemFactura = () => {
    const prodId = document.getElementById('fac-select-prod').value;
    const cant = Number(document.getElementById('fac-item-cant').value) || 1;
    const prod = catalogoCache.find(p => p.id === prodId);
    if (!prod) return alert('Selecciona un ítem del catálogo.');

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
            <td>${it.codigo_principal}</td>
            <td>${it.descripcion}</td>
            <td>${it.cantidad}</td>
            <td>$${it.precio_unitario.toFixed(2)}</td>
            <td>${it.porcentaje_iva}%</td>
            <td>$${it.precio_total_sin_impuesto.toFixed(2)}</td>
            <td><button type="button" class="btn btn-sm btn-outline" onclick="quitarItemFactura(${idx})">✕</button></td>
        </tr>`;
    }).join('');

    const total = sub15 + sub0 + ivaTotal;
    document.getElementById('fac-sub-15').innerText = `$${sub15.toFixed(2)}`;
    document.getElementById('fac-sub-0').innerText = `$${sub0.toFixed(2)}`;
    document.getElementById('fac-iva-val').innerText = `$${ivaTotal.toFixed(2)}`;
    document.getElementById('fac-total').innerText = `$${total.toFixed(2)}`;
}

function generarClaveAccesoSRI(fechaObj, tipoComprobante, ruc, ambiente, serie, secuencial, codigoNumerico, tipoEmision) {
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

function construirXMLFacturaSRI(factura, cliente, items) {
    const fecha = new Date(factura.fecha_emision);
    const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`;
    const detallesXml = items.map(it => `
    <detalle>
      <codigoPrincipal>${it.codigo_principal}</codigoPrincipal>
      <descripcion>${it.descripcion}</descripcion>
      <cantidad>${it.cantidad.toFixed(2)}</cantidad>
      <precioUnitario>${it.precio_unitario.toFixed(4)}</precioUnitario>
      <descuento>0.00</descuento>
      <precioTotalSinImpuesto>${it.precio_total_sin_impuesto.toFixed(2)}</precioTotalSinImpuesto>
      <impuestos>
        <impuesto>
          <codigo>2</codigo>
          <codigoPorcentaje>${it.codigo_iva}</codigoPorcentaje>
          <tarifa>${it.porcentaje_iva.toFixed(2)}</tarifa>
          <baseImponible>${it.precio_total_sin_impuesto.toFixed(2)}</baseImponible>
          <valor>${it.valor_iva.toFixed(2)}</valor>
        </impuesto>
      </impuestos>
    </detalle>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<factura id="comprobante" version="2.1.0">
  <infoTributaria>
    <ambiente>${currentOrg.ambiente_sri}</ambiente>
    <tipoEmision>1</tipoEmision>
    <razonSocial>${currentOrg.razon_social}</razonSocial>
    <nombreComercial>${currentOrg.nombre_comercial || currentOrg.razon_social}</nombreComercial>
    <ruc>${currentOrg.ruc}</ruc>
    <claveAcceso>${factura.clave_acceso}</claveAcceso>
    <codDoc>01</codDoc>
    <estab>${factura.establecimiento}</estab>
    <ptoEmi>${factura.punto_emision}</ptoEmi>
    <secuencial>${factura.secuencial}</secuencial>
    <dirMatriz>${currentOrg.direccion_matriz}</dirMatriz>
  </infoTributaria>
  <infoFactura>
    <fechaEmision>${fechaStr}</fechaEmision>
    <dirEstablecimiento>${currentOrg.direccion_matriz}</dirEstablecimiento>
    <obligadoContabilidad>${currentOrg.obligado_contabilidad ? 'SI' : 'NO'}</obligadoContabilidad>
    <tipoIdentificacionComprador>${cliente.tipo_identificacion}</tipoIdentificacionComprador>
    <razonSocialComprador>${cliente.razon_social}</razonSocialComprador>
    <identificacionComprador>${cliente.identificacion}</identificacionComprador>
    <totalSinImpuestos>${factura.subtotal_sin_impuestos.toFixed(2)}</totalSinImpuestos>
    <totalDescuento>0.00</totalDescuento>
    <totalConImpuestos>
      <totalImpuesto>
        <codigo>2</codigo>
        <codigoPorcentaje>4</codigoPorcentaje>
        <baseImponible>${factura.subtotal_15.toFixed(2)}</baseImponible>
        <valor>${factura.valor_iva.toFixed(2)}</valor>
      </totalImpuesto>
    </totalConImpuestos>
    <propina>0.00</propina>
    <importeTotal>${factura.importe_total.toFixed(2)}</importeTotal>
    <moneda>DOLAR</moneda>
    <pagos>
      <pago>
        <formaPago>${factura.forma_pago_sri}</formaPago>
        <total>${factura.importe_total.toFixed(2)}</total>
      </pago>
    </pagos>
  </infoFactura>
  <detalles>${detallesXml}
  </detalles>
</factura>`;
}

document.getElementById('form-factura').addEventListener('submit', async (e) => {
    e.preventDefault();
    const clienteId = document.getElementById('fac-cliente').value;
    if (!clienteId || facturaItems.length === 0) return alert('Selecciona un cliente y agrega al menos un ítem.');

    const { data: cli } = await sb.from('clientes').select('*').eq('id', clienteId).single();
    const secNum = Number(currentOrg.secuencial_factura || 1);
    const secStr = String(secNum).padStart(9, '0');
    const estab = currentOrg.establecimiento || '001';
    const pto = currentOrg.punto_emision || '001';
    const ahora = new Date();
    const codNum = String(Math.floor(10000000 + Math.random() * 90000000));
    const claveAcceso = generarClaveAccesoSRI(ahora, '01', currentOrg.ruc, String(currentOrg.ambiente_sri || 1), `${estab}${pto}`, secStr, codNum, '1');

    const sub15 = facturaItems.filter(i => i.porcentaje_iva > 0).reduce((a, b) => a + b.precio_total_sin_impuesto, 0);
    const sub0 = facturaItems.filter(i => i.porcentaje_iva === 0).reduce((a, b) => a + b.precio_total_sin_impuesto, 0);
    const ivaVal = facturaItems.reduce((a, b) => a + b.valor_iva, 0);
    const total = sub15 + sub0 + ivaVal;

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
        forma_pago_sri: document.getElementById('fac-forma-pago').value,
        estado_sri: 'XML_GENERADO'
    };
    facPayload.xml_generado = construirXMLFacturaSRI(facPayload, cli, facturaItems);

    const { data: facSaved, error } = await sb.from('facturas_sri').insert(facPayload).select().single();
    if (error) return alert('Error generando factura: ' + error.message);

    await sb.from('factura_detalles').insert(facturaItems.map(it => ({
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
    })));

    const srvRef = document.getElementById('fac-servicio-ref').value;
    if (srvRef) await sb.from('servicios_funerarios').update({ factura_id: facSaved.id }).eq('id', srvRef);

    currentOrg.secuencial_factura = secNum + 1;
    await sb.from('organizaciones').update({ secuencial_factura: currentOrg.secuencial_factura }).eq('id', currentOrg.id);
    document.getElementById('sri-secuencial').value = currentOrg.secuencial_factura;

    facturaItems = [];
    renderFacturaItems();
    await loadFacturas();
    recalcularFinanzas();
    showFactSubtab('sub-historial');
});

async function loadFacturas() {
    const { data } = await sb
        .from('facturas_sri')
        .select('*, clientes(razon_social)')
        .eq('organizacion_id', currentOrg.id)
        .order('created_at', { ascending: false });

    facturasCache = data || [];
    document.getElementById('tbody-facturas').innerHTML = facturasCache.map(f => `
        <tr>
            <td><strong>${f.establecimiento}-${f.punto_emision}-${f.secuencial}</strong></td>
            <td>${new Date(f.fecha_emision).toLocaleDateString()}</td>
            <td>${f.clientes?.razon_social || '-'}</td>
            <td><strong>$${Number(f.importe_total).toFixed(2)}</strong></td>
            <td><span class="badge badge-info">${f.estado_sri}</span></td>
            <td><button class="btn btn-sm btn-primary" onclick="descargarXML('${f.id}')">⬇ XML</button></td>
        </tr>
    `).join('') || '<tr><td colspan="6" class="muted-text">Aún no se han emitido facturas.</td></tr>';
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
    document.getElementById('user-badge').innerText = currentOrg.ambiente_sri === 1 ? 'Ambiente SRI: Pruebas' : 'Ambiente SRI: Producción';
    alert('Parámetros SRI guardados.');
});

// ============================================================================
// 9. REPORTES FINANCIEROS (INGRESOS, EGRESOS Y GANANCIAS)
// ============================================================================
async function loadEgresos() {
    const { data } = await sb.from('egresos_operativos').select('*').eq('organizacion_id', currentOrg.id).order('created_at', { ascending: false });
    egresosCache = data || [];
    document.getElementById('tbody-egresos').innerHTML = egresosCache.map(g => `
        <tr>
            <td>${g.fecha_egreso || new Date(g.created_at).toLocaleDateString()}</td>
            <td><span class="badge badge-warning">${g.categoria_egreso}</span></td>
            <td><strong>${g.concepto}</strong></td>
            <td>${g.registrado_por_nombre || currentUserName}</td>
            <td><strong>$${Number(g.monto).toFixed(2)}</strong></td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="muted-text">No hay egresos registrados.</td></tr>';
}

document.getElementById('form-egreso').addEventListener('submit', async (e) => {
    e.preventDefault();
    await sb.from('egresos_operativos').insert({
        organizacion_id: currentOrg.id,
        servicio_id: document.getElementById('egr-servicio').value || null,
        registrado_por_nombre: currentUserName,
        categoria_egreso: document.getElementById('egr-categoria').value,
        concepto: document.getElementById('egr-concepto').value,
        monto: document.getElementById('egr-monto').value,
        fecha_egreso: document.getElementById('egr-fecha').value,
        comprobante_ref: document.getElementById('egr-ref').value
    });
    e.target.reset();
    document.getElementById('egr-fecha').valueAsDate = new Date();
    await loadEgresos();
    recalcularFinanzas();
});

function recalcularFinanzas() {
    const ingresos = facturasCache.reduce((acc, f) => acc + Number(f.importe_total || 0), 0);
    const egresos = egresosCache.reduce((acc, g) => acc + Number(g.monto || 0), 0);
    const ganancia = ingresos - egresos;
    const margen = ingresos > 0 ? ((ganancia / ingresos) * 100).toFixed(1) : '0.0';

    document.getElementById('stat-ingresos').innerText = `$${ingresos.toFixed(2)}`;
    document.getElementById('stat-egresos-small').innerText = `Egresos: $${egresos.toFixed(2)}`;
    document.getElementById('stat-ganancia').innerText = `$${ganancia.toFixed(2)}`;

    document.getElementById('rep-ingresos').innerText = `$${ingresos.toFixed(2)}`;
    document.getElementById('rep-egresos').innerText = `$${egresos.toFixed(2)}`;
    document.getElementById('rep-ganancia').innerText = `$${ganancia.toFixed(2)}`;
    document.getElementById('rep-margen').innerText = `Margen neto: ${margen}%`;
}

// ============================================================================
// 10. EQUIPO Y CANAL DIRECTO CON EL ADMINISTRADOR DE LA PLATAFORMA
// ============================================================================
async function loadEquipo() {
    const { data } = await sb.from('usuarios_roles').select('*').eq('organizacion_id', currentOrg.id);
    const eq = data || [];
    document.getElementById('tbody-equipo').innerHTML = eq.map(m => `
        <tr>
            <td><strong>${m.nombre_completo}</strong></td>
            <td>${m.correo_contacto || (m.user_id === currentUser.id ? currentUser.email : 'Usuario vinculado')}</td>
            <td><span class="badge badge-info">${m.rol.toUpperCase()}</span></td>
            <td><span class="badge badge-success">${m.activo ? 'ACTIVO' : 'INACTIVO'}</span></td>
        </tr>
    `).join('');
}

document.getElementById('form-miembro').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('usr-nombre').value;
    const correo = document.getElementById('usr-email').value;
    const rol = document.getElementById('usr-rol').value;

    if (correo.trim().toLowerCase() === currentUser.email.toLowerCase()) {
        await sb.from('usuarios_roles').update({ nombre_completo: nombre, rol, correo_contacto: correo }).eq('user_id', currentUser.id).eq('organizacion_id', currentOrg.id);
        alert('Tu perfil y rol fueron actualizados.');
        e.target.reset();
        await initDashboard();
        return;
    }

    alert(`Para activar el acceso de "${nombre}" (${correo}) con rol "${rol}", crea primero su usuario en Supabase → Authentication → Users y luego vincula su UID en usuarios_roles.`);
});

async function loadSoporte() {
    const { data } = await sb.from('tickets_soporte_plataforma').select('*').eq('organizacion_id', currentOrg.id).order('created_at', { ascending: false });
    const tks = data || [];
    document.getElementById('tbody-soporte').innerHTML = tks.map(t => `
        <tr>
            <td>${new Date(t.created_at).toLocaleDateString()}</td>
            <td><strong>${t.asunto}</strong><br><small class="muted-text">${t.mensaje}</small></td>
            <td>${t.remitente_nombre} (${t.remitente_rol})</td>
            <td><span class="badge ${t.prioridad === 'URGENTE' ? 'badge-danger' : 'badge-info'}">${t.prioridad}</span></td>
            <td><span class="badge badge-warning">${t.estado}</span></td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="muted-text">No hay mensajes enviados al administrador aún.</td></tr>';
}

document.getElementById('form-soporte').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await sb.from('tickets_soporte_plataforma').insert({
        organizacion_id: currentOrg.id,
        usuario_id: currentUser.id,
        remitente_nombre: currentUserName,
        remitente_rol: currentRole,
        asunto: document.getElementById('sup-asunto').value,
        prioridad: document.getElementById('sup-prioridad').value,
        mensaje: document.getElementById('sup-mensaje').value
    });
    if (error) return alert('Error enviando mensaje: ' + error.message);
    e.target.reset();
    alert('Mensaje enviado directamente al administrador de la plataforma.');
    loadSoporte();
});