// ============================================================================
// CONFIGURACIÓN DE CONEXIÓN SUPABASE (NEXORA SUITE)
// ============================================================================
const SUPABASE_URL = 'https://fmsjkibcczmjsxoodzae.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JY2cBrl5RAp1dqbjgTC3SA_-DAKJknF';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentOrg = null;

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

    // Crear Organización y Rol Admin automáticamente
    const { data: orgData, error: orgErr } = await sb.from('organizaciones').insert({
        ruc, razon_social: empresa, nombre_comercial: empresa,
        direccion_matriz: direccion, tipo_negocio: 'FUNERARIA'
    }).select().single();

    if (orgErr) return showAlert('Error creando organización: ' + orgErr.message);

    await sb.from('usuarios_roles').insert({
        user_id: authData.user.id,
        organizacion_id: orgData.id,
        nombre_completo: nombre,
        rol: 'admin'
    });

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
// 2. INICIALIZACIÓN Y NAVEGACIÓN DEL DASHBOARD
// ============================================================================
async function initDashboard() {
    const { data: roleData } = await sb
        .from('usuarios_roles')
        .select('*, organizaciones(*)')
        .eq('user_id', currentUser.id)
        .single();

    if (!roleData) return;
    currentOrg = roleData.organizaciones;

    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('sidebar-org-name').innerText = `${currentOrg.nombre_comercial} (RUC: ${currentOrg.ruc})`;
    document.getElementById('user-badge').innerText = currentOrg.ambiente_sri === 1 ? 'Ambiente SRI: Pruebas' : 'Ambiente SRI: Producción';

    // Cargar configuración SRI en formulario
    document.getElementById('sri-ambiente').value = currentOrg.ambiente_sri;
    document.getElementById('sri-ruc-prov').value = currentOrg.ruc_proveedor_software;
    document.getElementById('sri-estab').value = currentOrg.establecimiento;
    document.getElementById('sri-pto').value = currentOrg.punto_emision;

    await refreshAllData();
}

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('hidden', c.id !== tabId));
    const activeBtn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
    if (activeBtn) document.getElementById('page-title').innerText = activeBtn.innerText;
}

async function refreshAllData() {
    await Promise.all([loadSalas(), loadProductos(), loadClientes(), loadServicios(), loadPlanes()]);
}

// ============================================================================
// 3. SALAS DE VELACIÓN
// ============================================================================
async function loadSalas() {
    const { data } = await sb.from('salas_velacion').select('*').eq('organizacion_id', currentOrg.id);
    const salas = data || [];
    document.getElementById('stat-salas').innerText = salas.filter(s => s.estado === 'DISPONIBLE').length;

    document.getElementById('tbody-salas').innerHTML = salas.map(s => `
        <tr>
            <td><strong>${s.nombre}</strong></td>
            <td>${s.capacidad_personas} pers.</td>
            <td>${s.direccion_sucursal || '-'}</td>
            <td><span class="badge ${s.estado === 'DISPONIBLE' ? 'badge-success' : 'badge-warning'}">${s.estado}</span></td>
            <td><button class="btn btn-sm btn-outline" onclick="toggleSala('${s.id}', '${s.estado}')">Cambiar Estado</button></td>
        </tr>
    `).join('');

    document.getElementById('srv-sala').innerHTML = '<option value="">-- Sin sala asignada --</option>' +
        salas.map(s => `<option value="${s.id}">${s.nombre} (${s.estado})</option>`).join('');
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
    loadSalas();
};

// ============================================================================
// 4. INVENTARIO (ATAÚDES, URNAS, SERVICIOS)
// ============================================================================
async function loadProductos() {
    const { data } = await sb.from('productos_servicios').select('*').eq('organizacion_id', currentOrg.id);
    const prods = data || [];
    const totalStock = prods.filter(p => p.categoria === 'ATAUD' || p.categoria === 'URNA')
                            .reduce((acc, p) => acc + Number(p.stock_actual), 0);
    document.getElementById('stat-stock').innerText = totalStock;

    document.getElementById('tbody-productos').innerHTML = prods.map(p => `
        <tr>
            <td>${p.codigo_principal}</td>
            <td><strong>${p.nombre}</strong></td>
            <td>${p.categoria}</td>
            <td>$${Number(p.precio_unitario).toFixed(2)}</td>
            <td>${p.porcentaje_iva}%</td>
            <td><span class="badge ${p.stock_actual <= p.stock_minimo ? 'badge-danger' : 'badge-success'}">${p.stock_actual}</span></td>
        </tr>
    `).join('');

    document.getElementById('srv-ataud').innerHTML = '<option value="">-- Seleccionar Ataúd / Urna --</option>' +
        prods.filter(p => p.categoria === 'ATAUD' || p.categoria === 'URNA')
             .map(p => `<option value="${p.id}">${p.nombre} (Stock: ${p.stock_actual})</option>`).join('');
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
        stock_actual: document.getElementById('prod-stock').value
    });
    e.target.reset();
    loadProductos();
});

// ============================================================================
// 5. CLIENTES
// ============================================================================
async function loadClientes() {
    const { data } = await sb.from('clientes').select('*').eq('organizacion_id', currentOrg.id);
    const clis = data || [];

    document.getElementById('tbody-clientes').innerHTML = clis.map(c => `
        <tr><td>${c.identificacion}</td><td><strong>${c.razon_social}</strong></td><td>${c.telefono_whatsapp || '-'}</td><td>${c.correo || '-'}</td></tr>
    `).join('');

    const opts = '<option value="">-- Seleccionar Cliente --</option>' + clis.map(c => `<option value="${c.id}">${c.razon_social} (${c.identificacion})</option>`).join('');
    document.getElementById('srv-cliente').innerHTML = opts;
    document.getElementById('plan-titular').innerHTML = opts;
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

// ============================================================================
// 6. SERVICIOS FUNERARIOS & OBITUARIOS DIGITALES QR
// ============================================================================
async function loadServicios() {
    const { data } = await sb
        .from('servicios_funerarios')
        .select('*, salas_velacion(nombre), obituarios_digitales(slug_publico)')
        .eq('organizacion_id', currentOrg.id)
        .order('created_at', { ascending: false });

    const srvs = data || [];
    document.getElementById('stat-servicios').innerText = srvs.filter(s => s.estado_expediente !== 'FINALIZADO').length;

    document.getElementById('tbody-servicios').innerHTML = srvs.map(s => {
        const slug = s.obituarios_digitales?.slug_publico || '';
        return `
        <tr>
            <td><strong>${s.codigo_expediente}</strong></td>
            <td>${s.fallecido_nombres}</td>
            <td>${s.tipo_servicio}</td>
            <td>${s.salas_velacion?.nombre || '-'}</td>
            <td>${s.camposanto_destino || '-'}</td>
            <td><button class="btn btn-sm btn-primary" onclick="openQRModal('${slug}', '${s.fallecido_nombres}')">Ver QR</button></td>
        </tr>`;
    }).join('');
}

document.getElementById('form-servicio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fallecido = document.getElementById('srv-fallecido').value;
    const ataudId = document.getElementById('srv-ataud').value || null;
    const salaId = document.getElementById('srv-sala').value || null;

    const { data: srvData, error } = await sb.from('servicios_funerarios').insert({
        organizacion_id: currentOrg.id,
        codigo_expediente: document.getElementById('srv-codigo').value,
        cliente_responsable_id: document.getElementById('srv-cliente').value,
        fallecido_nombres: fallecido,
        fecha_fallecimiento: document.getElementById('srv-fecha-fall').value,
        tipo_servicio: document.getElementById('srv-tipo').value,
        sala_id: salaId,
        ataud_urna_id: ataudId,
        camposanto_destino: document.getElementById('srv-camposanto').value
    }).select().single();

    if (error) return alert('Error: ' + error.message);

    // Crear Obituario Digital automáticamente
    const slug = fallecido.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, '-') + '-' + Date.now().toString().slice(-4);
    await sb.from('obituarios_digitales').insert({
        organizacion_id: currentOrg.id,
        servicio_id: srvData.id,
        slug_publico: slug,
        epitafio: document.getElementById('srv-epitafio').value
    });

    if (salaId) await sb.from('salas_velacion').update({ estado: 'OCUPADA' }).eq('id', salaId);

    e.target.reset();
    await refreshAllData();
    openQRModal(slug, fallecido);
});

window.openQRModal = (slug, nombre) => {
    const baseUrl = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
    const fullUrl = `${baseUrl}/obituario.html?slug=${slug}`;
    document.getElementById('qr-title').innerText = `Obituario: ${nombre}`;
    document.getElementById('qr-url-text').innerText = fullUrl;
    document.getElementById('qr-open-link').href = fullUrl;
    
    const container = document.getElementById('qrcode-container');
    container.innerHTML = '';
    new QRCode(container, { text: fullUrl, width: 180, height: 180 });
    document.getElementById('qr-modal').classList.remove('hidden');
};

// ============================================================================
// 7. PREVISIÓN EXEQUIAL Y CONFIGURACIÓN SRI
// ============================================================================
async function loadPlanes() {
    const { data } = await sb.from('planes_prevision_exequial').select('*, clientes(razon_social)').eq('organizacion_id', currentOrg.id);
    const planes = data || [];
    document.getElementById('stat-planes').innerText = planes.filter(p => p.estado === 'ACTIVO').length;

    document.getElementById('tbody-planes').innerHTML = planes.map(p => `
        <tr><td>${p.numero_contrato}</td><td>${p.clientes?.razon_social}</td><td>${p.nombre_plan}</td><td>$${Number(p.valor_cuota_mensual).toFixed(2)}</td><td><span class="badge badge-success">${p.estado}</span></td></tr>
    `).join('');
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

document.getElementById('form-sri-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    await sb.from('organizaciones').update({
        ambiente_sri: document.getElementById('sri-ambiente').value,
        ruc_proveedor_software: document.getElementById('sri-ruc-prov').value,
        establecimiento: document.getElementById('sri-estab').value,
        punto_emision: document.getElementById('sri-pto').value
    }).eq('id', currentOrg.id);
    alert('Configuración SRI actualizada correctamente.');
});