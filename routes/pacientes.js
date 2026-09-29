const express = require('express');
const router = express.Router();

// Funciones de seguridad y formato
const escapeHTML = (str) => {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const formatFechaDate = (isoString) => {
    if (!isoString) return '-';
    // Si es solo fecha sin hora (ej: fecha de nacimiento 'YYYY-MM-DD')
    if (typeof isoString === 'string' && (isoString.length <= 10 || !isoString.includes('T'))) {
        if (isoString.includes('-')) {
            const partes = isoString.split('-');
            if (partes.length === 3) {
                return `${partes[2].padStart(2, '0')}/${partes[1].padStart(2, '0')}/${partes[0]}`;
            }
        }
        return isoString;
    }
    // Si tiene timestamp completo (ISO), formatear en la zona horaria oficial de Argentina (UTC-3)
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
};

const formatHoraAR = (isoString) => {
    if (!isoString) return '-';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
};

// Lista de servicios y áreas hospitalarias
const DESTINOS = [
    "Cardiología",
    "Cirugía General",
    "Clínica Médica",
    "Consultorios Externos",
    "Dermatología",
    "Diagnóstico por Imágenes",
    "Gastroenterología",
    "Guardia General",
    "Infectología",
    "Kinesiología",
    "Laboratorio Central",
    "Neurología",
    "Oftalmología",
    "Pediatría",
    "Salud Mental",
    "Terapia Intensiva",
    "Traumatología",
    "Urología"
];

// Búsqueda de paciente (Usado por HTMX)
router.get('/buscar', async (req, res) => {
    const q = req.query.q || req.query.dni; // Acepta q o dni
    if (!q || q.length < 3) {
        return res.send(`<p class="text-gray-500 text-center">Ingrese un DNI o Apellido válido (mínimo 3 caracteres).</p>`);
    }

    const isNumeric = /^\d+$/.test(q); // Verifica si son solo numeros
    
    let pacientesData;
    let error;

    if (isNumeric) {
        const result = await req.supabase.from('pacientes').select('*').eq('dni', q);
        pacientesData = result.data;
        error = result.error;
    } else {
        const terms = q.trim().split(/\s+/); // Separar por espacios
        let query = req.supabase.from('pacientes').select('*').order('apellido', { ascending: true }).limit(25);
        
        // Para cada palabra, exigimos que coincida con el apellido O el nombre
        terms.forEach(term => {
            query = query.or(`apellido.ilike.%${term}%,nombre.ilike.%${term}%`);
        });

        const result = await query;
        pacientesData = result.data;
        error = result.error;
    }

    if (error || !pacientesData || pacientesData.length === 0) {
        return res.send(`
            <div class="bg-yellow-50 border border-yellow-200 p-4 rounded text-center">
                <p class="text-yellow-800 text-sm mb-3">Paciente no encontrado.</p>
                <button hx-get="/pacientes/formulario-alta?dni=${isNumeric ? q : ''}" hx-target="#resultado-paciente" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm">Registrar Nuevo Paciente</button>
            </div>
        `);
    }

    const userRole = req.signedCookies.user_role;
    const canAssign = userRole === 'RECEPCION' || userRole === 'ADMIN';

    // Función auxiliar para renderizar la tarjeta del paciente
    const renderPaciente = (p) => {
        let edad = '-';
        if (p.fecha_nacimiento) {
            const diff = Date.now() - new Date(p.fecha_nacimiento).getTime();
            edad = Math.abs(new Date(diff).getUTCFullYear() - 1970);
        }
        
        let turnosHtml = '';
        if (canAssign) {
            turnosHtml = `
                <div class="mt-4 pt-4 border-t border-green-200">
                    <button hx-get="/atenciones/modal-turno/${p.id}" 
                            hx-target="#modal-content" 
                            onclick="document.getElementById('modal-atencion').classList.remove('hidden')" 
                            class="bg-green-600 text-white px-5 py-2 rounded font-semibold hover:bg-green-700 transition shadow-sm w-full sm:w-auto">
                        Asignar Médico
                    </button>
                </div>
            `;
        }

        return `
            <div class="bg-emerald-50/60 dark:bg-slate-850 border border-emerald-200 dark:border-slate-700 p-5 rounded-2xl shadow-sm transition">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                ${escapeHTML(p.grado || 'S/G')}
                            </span>
                            <h3 class="font-bold text-slate-900 dark:text-slate-100 text-lg">${escapeHTML(p.apellido)}, ${escapeHTML(p.nombre)}</h3>
                        </div>
                        <p class="text-xs text-slate-600 dark:text-slate-400 mt-1">
                            DNI: <span class="font-mono font-semibold text-slate-800 dark:text-slate-200">${escapeHTML(p.dni)}</span> 
                            | Destino: <span class="font-semibold text-slate-800 dark:text-slate-200">${escapeHTML(p.destino || '-')}</span>
                        </p>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Fecha Nac: ${formatFechaDate(p.fecha_nacimiento)} (Edad: ${edad} años)${p.genero ? ` | Género: <span class="font-medium text-slate-700 dark:text-slate-300">${escapeHTML(p.genero)}</span>` : ''}</p>
                    </div>
                    <div class="flex items-center gap-2 self-end sm:self-auto">
                        <button hx-get="/partes/historial/${p.id}" hx-target="#modal-content" onclick="document.getElementById('modal-atencion').classList.remove('hidden')" class="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-xl hover:bg-amber-100 dark:hover:bg-amber-900/50 text-xs font-bold transition">
                            Partes
                        </button>
                        ${userRole !== 'RECEPCION' ? `
                            <button hx-get="/pacientes/historial/${p.id}" hx-target="#modal-content" onclick="document.getElementById('modal-atencion').classList.remove('hidden')" class="bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 px-3.5 py-1.5 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/50 text-xs font-bold transition">
                                Historia Clínica
                            </button>
                        ` : ''}
                    </div>
                </div>
                ${turnosHtml}
            </div>
        `;
    };

    // Si solo hay un resultado
    if (pacientesData.length === 1) {
        return res.send(renderPaciente(pacientesData[0]));
    }

    // Si hay multiples resultados, agrupar por grado
    const grupos = {
        'Oficial': [],
        'Suboficial': [],
        'SV': [],
        'A/C': [],
        'Otros': []
    };

    pacientesData.forEach(p => {
        if (grupos[p.grado]) grupos[p.grado].push(p);
        else grupos['Otros'].push(p);
    });

    let html = `<div class="space-y-6">`;
    html += `<div class="bg-slate-100 dark:bg-slate-800 p-2.5 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 text-center border border-slate-200 dark:border-slate-700">Se encontraron ${pacientesData.length} pacientes coincidentes</div>`;

    for (const [grado, lista] of Object.entries(grupos)) {
        if (lista.length > 0) {
            html += `
                <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm">
                    <h4 class="font-bold text-slate-900 dark:text-slate-100 mb-4 border-b border-slate-200 dark:border-slate-800 pb-2.5 flex items-center gap-2 text-sm">
                        <span class="bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded-full text-xs font-mono font-bold">${lista.length}</span>
                        Categoría: ${grado}
                    </h4>
                    <div class="space-y-4">
                        ${lista.map(p => renderPaciente(p)).join('')}
                    </div>
                </div>
            `;
        }
    }
    html += `</div>`;

    res.send(html);
});

// Control de acceso para altas de pacientes
const isRecepcionOrAdmin = (req, res, next) => {
    const role = req.signedCookies.user_role;
    if (role !== 'RECEPCION' && role !== 'ADMIN') {
        return res.status(403).send('<p class="text-red-500 text-xs">Acceso denegado. Función exclusiva de recepción.</p>');
    }
    next();
};

// Registro de auditoría conforme Ley 25.326 y Ley 27.706
const registrarAuditoria = async (req, paciente, accion) => {
    try {
        await req.supabase.from('auditoria_accesos').insert([{
            usuario_id: req.signedCookies.user_id || null,
            usuario_nombre: req.signedCookies.user_name || 'Personal Autorizado',
            usuario_rol: req.signedCookies.user_role || 'DESCONOCIDO',
            paciente_id: paciente.id,
            paciente_dni: paciente.dni,
            paciente_nombre: `${paciente.apellido}, ${paciente.nombre}`,
            accion: accion || 'CONSULTA_HISTORIAL_CLINICO',
            ip: req.ip || req.connection?.remoteAddress || '127.0.0.1',
            fecha_hora: new Date().toISOString()
        }]);
    } catch (e) {
        // No bloquear flujo si la tabla aún no fue creada
    }
};

// Formulario de alta (vía HTMX)
router.get('/formulario-alta', isRecepcionOrAdmin, (req, res) => {
    const dni = req.query.dni || '';
    res.send(`
        <form hx-post="/pacientes/alta" hx-target="#resultado-paciente" class="space-y-4 bg-slate-50/50 dark:bg-slate-855 p-6 border border-slate-200 dark:border-slate-800 rounded-2xl">
            <div class="flex justify-between items-center border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 class="font-bold text-slate-900 dark:text-slate-100 text-base">Registrar Nuevo Paciente</h3>
                <span class="text-xs text-slate-500">Sanidad Militar</span>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">DNI</label>
                    <input type="text" name="dni" value="${dni}" required placeholder="Ej: 38450123" class="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Fecha de Nacimiento</label>
                    <input type="text" name="fecha_nacimiento" placeholder="DD/MM/AAAA" pattern="\\d{2}/\\d{2}/\\d{4}" title="Formato: DD/MM/AAAA" maxlength="10" required class="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500">
                    <p id="fecha-error" class="text-red-500 text-[11px] hidden mt-1 font-semibold">Fecha inválida (revisa día, mes o año).</p>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Género</label>
                    <select name="genero" required class="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500">
                        <option value="">Seleccione...</option>
                        <option value="Masculino">Masculino</option>
                        <option value="Femenino">Femenino</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Nombre</label>
                    <input type="text" name="nombre" required placeholder="Ej: Juan Carlos" class="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Apellido</label>
                    <input type="text" name="apellido" required placeholder="Ej: Perez" class="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Grado / Escalafón</label>
                    <select name="grado" required class="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500">
                        <option value="">Seleccione...</option>
                        <option value="Oficial">Oficial</option>
                        <option value="Suboficial">Suboficial</option>
                        <option value="SV">SV (Soldado Voluntario)</option>
                        <option value="A/C">A/C (Agente Civil)</option>
                    </select>
                </div>
                <div class="sm:col-span-2 md:col-span-3">
                    <label class="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Destino</label>
                    <select name="destino" required class="w-full p-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500">
                        <option value="">Seleccione...</option>
                        ${DESTINOS.map(d => `<option value="${escapeHTML(d)}">${escapeHTML(d)}</option>`).join('')}
                    </select>
                </div>
            </div>
            
            <div class="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button type="button" hx-get="/pacientes/buscar?dni=${dni}" hx-target="#resultado-paciente" class="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-300 dark:hover:bg-slate-600 transition">Cancelar</button>
                <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition">Guardar Paciente</button>
            </div>
        </form>
    `);
});

router.post('/alta', isRecepcionOrAdmin, async (req, res) => {
    const { dni, nombre, apellido, grado, destino, fecha_nacimiento, genero } = req.body;
    
    // Convertir DD/MM/AAAA a YYYY-MM-DD para Supabase
    let fecha_nac_iso = null;
    if (fecha_nacimiento && fecha_nacimiento.includes('/')) {
        const partes = fecha_nacimiento.split('/');
        if (partes.length === 3) {
            fecha_nac_iso = `${partes[2]}-${partes[1]}-${partes[0]}`;
        }
    } else {
        fecha_nac_iso = fecha_nacimiento;
    }

    const insertData = { dni, nombre, apellido, grado, destino, fecha_nacimiento: fecha_nac_iso };
    if (genero) insertData.genero = genero;

    let { data: nuevoPaciente, error } = await req.supabase
        .from('pacientes')
        .insert([insertData])
        .select()
        .single();
        
    // Si da error por columna desconocida 'genero' (antes de correr la migración SQL), reintentar sin ella
    if (error && error.message && error.message.includes('genero')) {
        delete insertData.genero;
        const retry = await req.supabase.from('pacientes').insert([insertData]).select().single();
        error = retry.error;
        nuevoPaciente = retry.data;
    }

    if (error) {
        return res.send(`<p class="text-red-500">Error al registrar: ${escapeHTML(error.message)}</p>`);
    }

    // Tras guardar, recargamos la vista de busqueda con el nuevo DNI
    res.set('HX-Trigger', 'search');
    res.send(`
        <div class="bg-green-100 p-4 rounded-xl text-green-800 text-center font-semibold">
            Paciente guardado con éxito.
            <button hx-get="/pacientes/buscar?dni=${dni}" hx-target="#resultado-paciente" class="ml-4 bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-lg text-sm transition">Ver Paciente</button>
        </div>
    `);
});

// Ver Historial Clinico (Exclusivo para Médico y Admin)
router.get('/historial/:id', async (req, res) => {
    const userRole = req.signedCookies.user_role;
    if (userRole === 'RECEPCION') {
        return res.send(`
            <div class="p-8 text-center bg-white dark:bg-slate-900 rounded-2xl">
                <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center font-bold text-xs tracking-wider border border-slate-200 dark:border-slate-700">PRIVADO</div>
                <h4 class="font-bold text-slate-900 dark:text-slate-100 text-base">Acceso Reservado a Personal Médico</h4>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">Por secreto médico profesional y confidencialidad clínica (Ley 25.326 y Ley 26.529), el rol de Recepción tiene restringida la visualización de antecedentes médicos y evoluciones clínicas.</p>
                <button onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="mt-5 px-5 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-300 transition">Cerrar</button>
            </div>
        `);
    }

    const { id } = req.params;
    
    const { data: paciente } = await req.supabase.from('pacientes').select('*').eq('id', id).single();
    if (!paciente) return res.send('Error cargando historial.');

    const { data: atenciones, error } = await req.supabase
        .from('atenciones')
        .select(`
            id, fecha_hora, fecha_atencion, diagnostico, cie_10,
            usuarios ( nombre, matricula, grado )
        `)
        .eq('paciente_id', id)
        .eq('estado', 'ATENDIDO')
        .order('fecha_atencion', { ascending: false, nullsFirst: false })
        .order('fecha_hora', { ascending: false });

    // Ordenamiento cronológico descendente estricto por momento real de atención
    if (atenciones && atenciones.length > 0) {
        atenciones.sort((a, b) => {
            const tA = new Date(a.fecha_atencion || a.fecha_hora || 0).getTime();
            const tB = new Date(b.fecha_atencion || b.fecha_hora || 0).getTime();
            return tB - tA;
        });
    }

    // Registro de auditoría conforme Ley 25.326 y Ley 27.706
    registrarAuditoria(req, paciente, 'CONSULTA_HISTORIAL_CLINICO');

    let edad = '-';
    if (paciente.fecha_nacimiento) {
        const diff = Date.now() - new Date(paciente.fecha_nacimiento).getTime();
        edad = Math.abs(new Date(diff).getUTCFullYear() - 1970);
    }

    let html = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-gray-200 dark:border-slate-700">
            <div>
                <h3 class="text-lg font-bold text-gray-900 dark:text-slate-100">Historia Clínica</h3>
                <p class="text-sm font-semibold text-gray-800 dark:text-slate-200">[${escapeHTML(paciente.grado || '-')}] ${escapeHTML(paciente.apellido)}, ${escapeHTML(paciente.nombre)}</p>
                <p class="text-xs text-gray-500 dark:text-slate-400">
                    DNI: ${escapeHTML(paciente.dni)} | Edad: ${edad} años | Destino: ${escapeHTML(paciente.destino || '-')}
                    ${paciente.genero ? ` | Género: <span class="font-semibold text-gray-700 dark:text-slate-300">${escapeHTML(paciente.genero)}</span>` : ''}
                </p>
            </div>
            <div class="flex items-center gap-2 self-end sm:self-auto">
                <a href="/pacientes/historial/${paciente.id}/imprimir" target="_blank" class="text-xs bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 rounded-lg font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition flex items-center gap-1 shadow-sm" title="Imprimir copia legal o guardar en PDF (Ley 26.529)">
                    Imprimir / PDF
                </a>
                <button hx-get="/partes/historial/${paciente.id}" hx-target="#modal-content" class="text-xs bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-3 py-1.5 rounded-lg font-bold hover:bg-amber-100 dark:hover:bg-amber-900/50 transition">
                    Partes
                </button>
                <button onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-2xl font-bold ml-1">&times;</button>
            </div>
        </div>
        <div class="max-h-[70vh] overflow-y-auto pr-1 space-y-3">
    `;

    if (!atenciones || atenciones.length === 0) {
        html += `<p class="text-gray-500 dark:text-slate-400 text-center py-6">No hay atenciones registradas.</p>`;
    } else {
        atenciones.forEach(a => {
            const fechaStr = a.fecha_atencion || a.fecha_hora;
            const fecha = `${formatFechaDate(fechaStr)} a las ${formatHoraAR(fechaStr)} hs`;
            
            html += `
                <div class="border border-gray-200 dark:border-slate-700 rounded-xl p-4 bg-gray-50 dark:bg-slate-750">
                    <div class="flex justify-between items-center text-xs text-gray-500 dark:text-slate-400 mb-2 pb-2 border-b border-gray-200/60 dark:border-slate-700/60">
                        <span class="font-medium text-gray-700 dark:text-slate-300">${fecha}</span>
                        <span class="font-medium">Médico: <b>${a.usuarios?.grado ? escapeHTML(a.usuarios.grado) + ' ' : ''}Med ${escapeHTML(a.usuarios?.nombre || '-')}</b> (Mat: ${escapeHTML(a.usuarios?.matricula || '-')})</span>
                    </div>
                    <p class="text-sm text-gray-800 dark:text-slate-200 whitespace-pre-wrap">${escapeHTML(a.diagnostico)}</p>
                    ${a.cie_10 ? `<p class="text-xs text-blue-600 dark:text-blue-400 font-mono mt-2 font-semibold">CIE-10: ${escapeHTML(a.cie_10)}</p>` : ''}
                </div>
            `;
        });
    }

    html += `</div>`;
    res.send(html);
});

// Imprimir / Exportar Historia Clínica Oficial (Ley 26.529 y Ley 27.706)
router.get('/historial/:id/imprimir', async (req, res) => {
    const userRole = req.signedCookies.user_role;
    if (userRole === 'RECEPCION') {
        return res.status(403).send('Acceso denegado. Función reservada para Médicos y Administradores (Ley 25.326).');
    }

    const { id } = req.params;
    
    const { data: paciente } = await req.supabase.from('pacientes').select('*').eq('id', id).single();
    if (!paciente) return res.status(404).send('Paciente no encontrado.');

    const { data: atenciones } = await req.supabase
        .from('atenciones')
        .select(`
            id, fecha_hora, fecha_atencion, diagnostico, cie_10,
            usuarios ( nombre, matricula, grado )
        `)
        .eq('paciente_id', id)
        .eq('estado', 'ATENDIDO')
        .order('fecha_atencion', { ascending: false, nullsFirst: false })
        .order('fecha_hora', { ascending: false });

    // Ordenamiento cronológico descendente estricto por momento real de atención
    if (atenciones && atenciones.length > 0) {
        atenciones.sort((a, b) => {
            const tA = new Date(a.fecha_atencion || a.fecha_hora || 0).getTime();
            const tB = new Date(b.fecha_atencion || b.fecha_hora || 0).getTime();
            return tB - tA;
        });
    }

    // Registrar en auditoría de accesos
    registrarAuditoria(req, paciente, 'IMPRESION_COPIA_LEGAL');

    let edad = '-';
    if (paciente.fecha_nacimiento) {
        const diff = Date.now() - new Date(paciente.fecha_nacimiento).getTime();
        edad = Math.abs(new Date(diff).getUTCFullYear() - 1970);
    }

    const ahora = new Date();
    const fechaEmision = `${ahora.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} a las ${ahora.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })} hs`;

    res.render('historial_imprimir', {
        paciente,
        atenciones: atenciones || [],
        edad,
        fechaEmision,
        formatFechaDate,
        formatHoraAR,
        escapeHTML
    });
});

router.DESTINOS = DESTINOS;
module.exports = router;
