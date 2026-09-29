const express = require('express');
const router = express.Router();

const escapeHTML = (str) => {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const { evaluarParte, formatFechaDate, formatHoraAR } = require('./partes');

// Middlewares de control de acceso por rol
const isMedicoOrAdmin = (req, res, next) => {
    const role = req.signedCookies.user_role;
    if (role !== 'MEDICO' && role !== 'ADMIN') {
        return res.status(403).send('<span class="text-red-500 font-semibold p-2">Acceso denegado. Función exclusiva de médicos.</span>');
    }
    next();
};

const isRecepcionOrAdmin = (req, res, next) => {
    const role = req.signedCookies.user_role;
    if (role !== 'RECEPCION' && role !== 'ADMIN') {
        return res.status(403).send('<span class="text-red-500 font-semibold p-2">Acceso denegado. Función exclusiva de recepción.</span>');
    }
    next();
};

// Asignar turno (desde recepcion) - POST Final
router.post('/turno', isRecepcionOrAdmin, async (req, res) => {
    const { paciente_id, medico_id } = req.body;
    
    const { error } = await req.supabase
        .from('atenciones')
        .insert([{ 
            paciente_id, 
            medico_id, 
            estado: 'ESPERA',
            fecha_hora: new Date().toISOString()
        }]);

    if (error) {
        return res.send(`<span class="text-red-500 font-bold">Error al asignar turno.</span>`);
    }

    res.set('HX-Trigger', 'turnoAsignado');
    res.send(`
        <div id="modal-content" hx-swap-oob="true" class="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-xl w-full max-w-lg relative border border-gray-100 dark:border-slate-700">
            <div class="text-center py-4">
                <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300 flex items-center justify-center font-bold text-lg">OK</div>
                <h3 class="text-xl font-bold text-gray-800 dark:text-slate-100">Médico Asignado</h3>
                <p class="text-gray-600 dark:text-slate-300 mt-2">El paciente ha sido enviado a la sala de espera del médico.</p>
                <button onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="mt-6 px-6 py-2 bg-gray-200 dark:bg-slate-700 font-semibold rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 dark:text-slate-100 transition">Aceptar</button>
            </div>
        </div>
    `);
});

// Modal de confirmación de turno (GET)
router.get('/modal-turno/:id', isRecepcionOrAdmin, async (req, res) => {
    const { id } = req.params;
    
    const { data: paciente } = await req.supabase.from('pacientes').select('*').eq('id', id).single();
    const { data: medicos } = await req.supabase.from('usuarios').select('id, nombre, grado').eq('rol', 'MEDICO').order('nombre');

    if (!paciente) return res.send('Paciente no encontrado');

    // Consultar si el paciente tiene un parte de enfermo activo o en alta administrativa
    let alertaParteHtml = '';
    try {
        const { data: partesActivos } = await req.supabase
            .from('partes_enfermo')
            .select('*')
            .eq('paciente_id', id)
            .in('estado', ['ACTIVO', 'ALTA_ADMINISTRATIVA'])
            .order('created_at', { ascending: false })
            .limit(1);

        const parteActivo = partesActivos && partesActivos.length > 0 ? partesActivos[0] : null;
        const estadoParte = evaluarParte(parteActivo);

        if (estadoParte.tieneParte) {
            if (estadoParte.vencido) {
                alertaParteHtml = `
                    <div class="p-3 mb-4 bg-red-50 dark:bg-red-950/60 border-l-4 border-red-500 rounded-r-lg text-red-800 dark:text-red-200">
                        <div class="flex items-center gap-2 font-bold text-sm">
                            <span>ALERTA: PARTE DE ENFERMO VENCIDO</span>
                        </div>
                        <p class="text-xs mt-1">
                            El parte venció el <b>${formatFechaDate(parteActivo.fecha_fin)}</b> (hace ${estadoParte.diasVencido} días). 
                            CIE-10: <b>${escapeHTML(parteActivo.cie_10)}</b>. El médico será notificado para resolver su situación.
                        </p>
                    </div>
                `;
            } else if (estadoParte.alerta30Dias) {
                alertaParteHtml = `
                    <div class="p-3 mb-4 bg-amber-50 dark:bg-amber-950/60 border-l-4 border-amber-500 rounded-r-lg text-amber-800 dark:text-amber-200">
                        <div class="flex items-center gap-2 font-bold text-sm">
                            <span>ADVERTENCIA: ALTA ADMINISTRATIVA (${estadoParte.diasAltaAdmin} / 30 DÍAS)</span>
                        </div>
                        <p class="text-xs mt-1">
                            ${estadoParte.supero30Dias ? '¡Superó los 30 días de Alta Administrativa! Corresponde actuación por enfermedad.' : `Lleva ${estadoParte.diasAltaAdmin} días. Faltan ${estadoParte.diasRestantes} días para el límite de 30 días (actuación por enfermedad).`}
                        </p>
                    </div>
                `;
            }
        }
    } catch (e) {
        // En caso de que la tabla aún no exista, continúa sin romper
    }

    let medicosHtml = medicos?.map(m => `
        <label class="block p-3 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-blue-50 dark:hover:bg-slate-700/50 cursor-pointer transition flex items-center gap-3">
            <input type="radio" name="medico_id" value="${m.id}" required class="w-4 h-4 text-blue-600">
            <span class="font-medium text-gray-800 dark:text-slate-200">${m.grado ? m.grado + ' ' : ''}Med ${escapeHTML(m.nombre)}</span>
        </label>
    `).join('') || '<p class="text-gray-500 dark:text-slate-400">No hay médicos disponibles.</p>';

    res.send(`
        <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-200 dark:border-slate-700">
            <h3 class="text-xl font-bold text-blue-800 dark:text-blue-400">Asignar Médico</h3>
            <button onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-2xl font-bold">&times;</button>
        </div>
        
        ${alertaParteHtml}

        <div class="bg-blue-50 dark:bg-slate-800/80 p-4 rounded-xl mb-4 border border-blue-100 dark:border-slate-700">
            <p class="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider mb-1">Datos del Paciente</p>
            <p class="text-lg font-bold text-gray-900 dark:text-slate-100">${escapeHTML(paciente.apellido)}, ${escapeHTML(paciente.nombre)}</p>
            <p class="text-sm text-gray-700 dark:text-slate-300">DNI: <span class="font-semibold">${escapeHTML(paciente.dni)}</span> | Grado: <span class="font-semibold">${escapeHTML(paciente.grado || '-')}</span></p>
            <p class="text-sm text-gray-700 dark:text-slate-300">Destino: <span class="font-semibold">${escapeHTML(paciente.destino || '-')}</span></p>
        </div>

        <form hx-post="/atenciones/turno" hx-target="#turno-error-msg" class="space-y-4">
            <input type="hidden" name="paciente_id" value="${paciente.id}">
            
            <div>
                <label class="block text-sm text-gray-700 dark:text-slate-300 font-semibold mb-2">Seleccione el Médico de Guardia:</label>
                <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
                    ${medicosHtml}
                </div>
            </div>

            <div id="turno-error-msg"></div>

            <div class="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-slate-700">
                <button type="button" onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-slate-600 transition">Cancelar</button>
                <button type="submit" class="px-6 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 shadow-sm transition">Confirmar Asignación</button>
            </div>
        </form>
    `);
});

// Lista de espera para el médico (HTMX Polling)
router.get('/espera', async (req, res) => {
    const medicoId = req.signedCookies.user_id;

    const { data: turnos, error } = await req.supabase
        .from('atenciones')
        .select(`
            id, fecha_hora, estado, paciente_id,
            pacientes ( id, nombre, apellido, dni, grado )
        `)
        .eq('medico_id', medicoId)
        .eq('estado', 'ESPERA')
        .order('fecha_hora', { ascending: true });

    if (error || !turnos || turnos.length === 0) {
        return res.send(`<p class="text-gray-500 dark:text-slate-400 text-center py-6">No hay pacientes en espera en este momento.</p>`);
    }

    // Consultar si alguno de estos pacientes tiene parte vencido o en alta admin
    const pacienteIds = turnos.map(t => t.paciente_id);
    let partesMap = {};
    try {
        const { data: partes } = await req.supabase
            .from('partes_enfermo')
            .select('*')
            .in('paciente_id', pacienteIds)
            .in('estado', ['ACTIVO', 'ALTA_ADMINISTRATIVA'])
            .order('created_at', { ascending: false });

        if (partes) {
            partes.forEach(p => {
                if (!partesMap[p.paciente_id]) {
                    partesMap[p.paciente_id] = evaluarParte(p);
                }
            });
        }
    } catch (e) {}

    let html = '<ul class="divide-y divide-gray-200 dark:divide-slate-700">';
    const hoyStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

    turnos.forEach((t, index) => {
        const hora = formatHoraAR(t.fecha_hora);
        const fechaTurnoStr = new Date(t.fecha_hora).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
        const detalleEspera = fechaTurnoStr === hoyStr ? `${hora} hs` : `${formatFechaDate(t.fecha_hora)} ${hora} hs`;

        const estParte = partesMap[t.paciente_id];
        let badgeAlerta = '';

        if (estParte && estParte.tieneParte) {
            if (estParte.vencido) {
                badgeAlerta = `<span class="bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200 text-xs px-2 py-0.5 rounded font-bold ml-2">Parte Vencido</span>`;
            } else if (estParte.alerta30Dias) {
                badgeAlerta = `<span class="bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 text-xs px-2 py-0.5 rounded font-bold ml-2">Alta Adm (${estParte.diasAltaAdmin}d/30)</span>`;
            }
        }

        html += `
            <li class="py-3.5 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-slate-750 px-2 rounded-lg transition">
                <div>
                    <span class="inline-block bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 text-xs font-bold px-2 py-0.5 rounded-full mr-2">#${index + 1}</span>
                    <p class="inline font-bold text-gray-900 dark:text-slate-100">[${escapeHTML(t.pacientes.grado || '-')}] ${escapeHTML(t.pacientes.apellido)}, ${escapeHTML(t.pacientes.nombre)}</p>
                    ${badgeAlerta}
                    <p class="text-xs text-gray-500 dark:text-slate-400 mt-1">DNI: ${escapeHTML(t.pacientes.dni)} | Espera desde: <span class="font-semibold text-blue-600 dark:text-blue-400">${detalleEspera}</span></p>
                </div>
                <div class="flex gap-2">
                    <button hx-post="/atenciones/ausente" 
                            hx-vals='{"id": "${t.id}"}'
                            hx-target="closest li"
                            hx-swap="outerHTML"
                            hx-confirm="¿Marcar paciente como ausente?"
                            class="bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 text-red-700 dark:text-red-300 px-3 py-1.5 rounded text-sm font-semibold transition border border-red-200 dark:border-red-800/60">
                        Ausente
                    </button>
                    <button hx-get="/pacientes/historial/${t.paciente_id}" 
                            hx-target="#modal-content"
                            onclick="document.getElementById('modal-atencion').classList.remove('hidden')"
                            class="border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 px-3 py-1.5 rounded text-sm font-semibold hover:bg-gray-100 dark:hover:bg-slate-700 transition">
                        Historial
                    </button>
                    <button hx-get="/atenciones/atender/${t.id}" 
                            hx-target="#modal-content"
                            onclick="document.getElementById('modal-atencion').classList.remove('hidden')"
                            class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-bold shadow-sm transition">
                        Atender
                    </button>
                </div>
            </li>
        `;
    });
    html += '</ul>';

    res.send(html);
});

// Sala de espera general para Recepción y Administración (HTMX Polling)
router.get('/espera-general', async (req, res) => {
    const { data: turnos, error } = await req.supabase
        .from('atenciones')
        .select(`
            id, fecha_hora, estado, paciente_id, medico_id,
            pacientes ( id, nombre, apellido, dni, grado, destino ),
            usuarios ( id, nombre, grado )
        `)
        .eq('estado', 'ESPERA')
        .order('fecha_hora', { ascending: true });

    if (error || !turnos || turnos.length === 0) {
        return res.send(`
            <div class="text-center py-10 text-slate-400 dark:text-slate-500">
                <p class="text-xs font-semibold">No hay pacientes esperando en este momento.</p>
                <p class="text-[11px] text-slate-400 mt-0.5">Los pacientes asignados aparecerán automáticamente aquí.</p>
            </div>
        `);
    }

    const hoyStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

    let html = '<ul class="divide-y divide-slate-100 dark:divide-slate-800">';
    turnos.forEach((t, index) => {
        const hora = formatHoraAR(t.fecha_hora);
        const fechaTurnoStr = new Date(t.fecha_hora).toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
        const detalleEspera = fechaTurnoStr === hoyStr ? `${hora} hs` : `${formatFechaDate(t.fecha_hora)} ${hora} hs`;
        const medicoNom = t.usuarios ? `${t.usuarios.grado ? escapeHTML(t.usuarios.grado) + ' ' : ''}Med. ${escapeHTML(t.usuarios.nombre)}` : 'Sin asignar';

        html += `
            <li class="py-2.5 px-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded-xl transition flex justify-between items-center gap-2">
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5 mb-0.5">
                        <span class="bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono">#${index + 1}</span>
                        <p class="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">[${escapeHTML(t.pacientes?.grado || '-')}] ${escapeHTML(t.pacientes?.apellido || '')}, ${escapeHTML(t.pacientes?.nombre || '')}</p>
                    </div>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400">
                        DNI: ${escapeHTML(t.pacientes?.dni || '-')} | <span class="text-slate-700 dark:text-slate-300 font-medium">${medicoNom}</span>
                    </p>
                    <p class="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                        Espera desde: <span class="text-blue-600 dark:text-blue-400 font-semibold">${detalleEspera}</span>
                    </p>
                </div>
                <button hx-post="/atenciones/ausente"
                        hx-vals='{"id": "${t.id}"}'
                        hx-target="closest li"
                        hx-swap="outerHTML"
                        hx-confirm="¿Cancelar turno de espera para este paciente?"
                        class="text-[10px] bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 dark:bg-slate-800 dark:hover:bg-red-950/40 dark:text-slate-400 dark:hover:text-red-300 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 transition" title="Cancelar o quitar de espera">
                    Quitar
                </button>
            </li>
        `;
    });
    html += '</ul>';
    res.send(html);
});

// Listado de pacientes atendidos hoy para Recepción (se reinicia automáticamente a las 00:00 hs de Argentina)
router.get('/atendidos-hoy', async (req, res) => {
    const hoyStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
    const inicioDiaArgentina = new Date(`${hoyStr}T00:00:00-03:00`).toISOString();
    const finDiaArgentina = new Date(`${hoyStr}T23:59:59.999-03:00`).toISOString();

    const { data: atenciones, error } = await req.supabase
        .from('atenciones')
        .select(`
            id, fecha_atencion, fecha_hora, estado, paciente_id, medico_id,
            pacientes ( id, nombre, apellido, dni, grado, destino ),
            usuarios ( id, nombre, grado )
        `)
        .eq('estado', 'ATENDIDO')
        .gte('fecha_atencion', inicioDiaArgentina)
        .lte('fecha_atencion', finDiaArgentina)
        .order('fecha_atencion', { ascending: false });

    if (error || !atenciones || atenciones.length === 0) {
        return res.send(`
            <div class="text-center py-16 text-slate-400 dark:text-slate-500">
                <h4 class="text-sm font-semibold text-slate-700 dark:text-slate-300">Aún no hay pacientes atendidos en el día de hoy</h4>
                <p class="text-xs text-slate-400 mt-1">A medida que los médicos finalicen las consultas de guardia, se registrarán aquí.</p>
                <p class="text-[11px] text-slate-500 mt-3 font-mono">Fecha operativa: ${formatFechaDate(inicioDiaArgentina)} (Reinicio diario a las 00:00 hs)</p>
            </div>
        `);
    }

    let html = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4 pb-3 border-b border-slate-200 dark:border-slate-800">
            <div>
                <h3 class="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                    <span>Nómina de Pacientes Atendidos Hoy</span>
                    <span class="bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-xs font-bold px-2.5 py-0.5 rounded-full font-mono">${atenciones.length} atendidos</span>
                </h3>
                <p class="text-xs text-slate-500 dark:text-slate-400">Atenciones completadas el ${formatFechaDate(inicioDiaArgentina)} (Se reinicia a las 00:00 hs).</p>
            </div>
            <button hx-get="/atenciones/atendidos-hoy" hx-target="#lista-atendidos-hoy" class="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-3 py-1.5 rounded-lg text-slate-700 dark:text-slate-300 font-semibold transition flex items-center gap-1">
                Actualizar
            </button>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
                <thead>
                    <tr class="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">
                        <th class="py-2.5 px-3">Hora</th>
                        <th class="py-2.5 px-3">Paciente</th>
                        <th class="py-2.5 px-3">DNI</th>
                        <th class="py-2.5 px-3">Destino</th>
                        <th class="py-2.5 px-3">Médico Actuante</th>
                        <th class="py-2.5 px-3 text-center">Acciones</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
    `;

    atenciones.forEach(a => {
        const fechaStr = a.fecha_atencion || a.fecha_hora;
        const hora = formatHoraAR(fechaStr);
        const p = a.pacientes || {};
        const medicoNom = a.usuarios ? `${a.usuarios.grado ? escapeHTML(a.usuarios.grado) + ' ' : ''}Med. ${escapeHTML(a.usuarios.nombre)}` : 'Guardia';

        html += `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                <td class="py-2.5 px-3 font-bold text-slate-700 dark:text-slate-300">${hora} hs</td>
                <td class="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100 font-sans">
                    [${escapeHTML(p.grado || '-')}] ${escapeHTML(p.apellido || '')}, ${escapeHTML(p.nombre || '')}
                </td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-400">${escapeHTML(p.dni || '-')}</td>
                <td class="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-sans">${escapeHTML(p.destino || '-')}</td>
                <td class="py-2.5 px-3 text-slate-700 dark:text-slate-300 font-sans font-medium">${medicoNom}</td>
                <td class="py-2.5 px-3 text-center font-sans">
                    <button hx-get="/partes/historial/${p.id}" 
                            hx-target="#modal-content" 
                            onclick="document.getElementById('modal-atencion').classList.remove('hidden')" 
                            class="bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-lg text-xs font-bold transition">
                        Partes
                    </button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    res.send(html);
});

// Formulario para atender (Modal)
router.get('/atender/:id', isMedicoOrAdmin, async (req, res) => {
    const { id } = req.params;
    
    // Obtener datos de la atencion
    const { data: atencion } = await req.supabase
        .from('atenciones')
        .select('id, paciente_id, pacientes(nombre, apellido, dni, grado, destino)')
        .eq('id', id)
        .single();

    if (!atencion) return res.send('Error al cargar atención');

    // Consultar parte de enfermo del paciente
    let parteActivo = null;
    let estadoParte = { tieneParte: false };
    try {
        const { data: partes } = await req.supabase
            .from('partes_enfermo')
            .select('*')
            .eq('paciente_id', atencion.paciente_id)
            .in('estado', ['ACTIVO', 'ALTA_ADMINISTRATIVA'])
            .order('created_at', { ascending: false })
            .limit(1);

        if (partes && partes.length > 0) {
            parteActivo = partes[0];
            estadoParte = evaluarParte(parteActivo);
        }
    } catch (e) {}

    // Generar sección de Parte de Enfermo
    let seccionParteHtml = '';
    const hoyDDMMAAAA = formatFechaDate(new Date().toISOString());

    if (estadoParte.tieneParte) {
        let alertaBanner = '';
        if (estadoParte.vencido) {
            alertaBanner = `
                <div class="p-3 mb-3 bg-red-100 dark:bg-red-950/80 border-l-4 border-red-500 rounded text-red-800 dark:text-red-200 text-xs">
                    <p class="font-bold flex items-center gap-1">PARTE DE ENFERMO VENCIDO</p>
                    <p class="mt-0.5">El reposo finalizó el <b>${formatFechaDate(parteActivo.fecha_fin)}</b> (hace ${estadoParte.diasVencido} días). Corresponde extender el parte o conceder el Alta.</p>
                </div>
            `;
        } else if (estadoParte.alerta30Dias) {
            alertaBanner = `
                <div class="p-3 mb-3 bg-amber-100 dark:bg-amber-950/80 border-l-4 border-amber-500 rounded text-amber-800 dark:text-amber-200 text-xs">
                    <p class="font-bold flex items-center gap-1">ADVERTENCIA: 30 DÍAS DE ALTA ADMINISTRATIVA</p>
                    <p class="mt-0.5">${estadoParte.supero30Dias ? '¡Superó los 30 días de Alta Administrativa! Corresponde actuación por enfermedad.' : `Lleva ${estadoParte.diasAltaAdmin} días acumulados. Restan ${estadoParte.diasRestantes} días para el plazo de 30 días (actuación por enfermedad).`}</p>
                </div>
            `;
        }

        seccionParteHtml = `
            <div class="bg-gray-50 dark:bg-slate-750 p-4 rounded-xl border border-gray-200 dark:border-slate-700 mb-4">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                        <span>Parte de Enfermo Activo</span>
                        ${estadoParte.vencido ? '<span class="bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 text-[10px] px-2 py-0.5 rounded font-bold">VENCIDO</span>' : ''}
                        ${estadoParte.estado === 'ALTA_ADMINISTRATIVA' ? `<span class="bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 text-[10px] px-2 py-0.5 rounded font-bold">ALTA ADM (${estadoParte.diasAltaAdmin}d)</span>` : ''}
                        ${estadoParte.estado === 'ACTIVO' && !estadoParte.vencido ? '<span class="bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 text-[10px] px-2 py-0.5 rounded font-bold">EN VIGENCIA</span>' : ''}
                    </h4>
                    <button type="button" hx-get="/partes/historial/${atencion.paciente_id}" hx-target="#modal-content" class="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold">
                        Ver Historial de Extensiones
                    </button>
                </div>

                ${alertaBanner}

                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-600 dark:text-slate-300 mb-3 bg-white dark:bg-slate-800 p-2.5 rounded-lg border border-gray-200 dark:border-slate-700">
                    <div><b>Vigencia:</b> ${formatFechaDate(parteActivo.fecha_inicio)} al ${formatFechaDate(parteActivo.fecha_fin)}</div>
                    <div><b>CIE-10:</b> <span class="font-mono font-bold text-blue-600 dark:text-blue-400">${escapeHTML(parteActivo.cie_10)}</span></div>
                    <div><b>Estado:</b> ${escapeHTML(parteActivo.estado)}</div>
                </div>

                <div id="parte-actions-msg" class="text-xs mb-2"></div>

                <!-- Botones de Acción de Parte -->
                <div class="flex flex-wrap gap-2 pt-1 border-t border-gray-200 dark:border-slate-700">
                    <button type="button" onclick="document.getElementById('form-extender-parte').classList.toggle('hidden')" class="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/50 transition">
                        Extender Parte
                    </button>
                    ${parteActivo.estado === 'ACTIVO' ? `
                        <button type="button" 
                                hx-post="/partes/alta-admin" 
                                hx-vals='{"parte_id": "${parteActivo.id}"}' 
                                hx-target="#parte-actions-msg"
                                hx-confirm="¿Confirmar Alta Administrativa?"
                                class="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/50 transition">
                            Alta Administrativa
                        </button>
                    ` : ''}
                    <button type="button" 
                            hx-post="/partes/alta-definitiva" 
                            hx-vals='{"parte_id": "${parteActivo.id}"}' 
                            hx-target="#parte-actions-msg"
                            hx-confirm="¿Confirmar Alta de Parte de Enfermo?"
                            class="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition">
                        Alta Definitiva
                    </button>
                </div>

                <!-- Formulario desplegable para Extender Parte -->
                <div id="form-extender-parte" class="hidden mt-3 p-3 bg-white dark:bg-slate-800 rounded-lg border border-blue-200 dark:border-blue-900 space-y-2">
                    <p class="text-xs font-bold text-blue-700 dark:text-blue-300">Extender Parte de Enfermo:</p>
                    <form hx-post="/partes/extender" hx-target="#parte-actions-msg" class="space-y-2">
                        <input type="hidden" name="parte_id" value="${parteActivo.id}">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                                <label class="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Nueva Fecha Hasta (DD/MM/AAAA):</label>
                                <input type="text" name="nueva_fecha_fin" placeholder="DD/MM/AAAA" pattern="\\d{2}/\\d{2}/\\d{4}" title="Formato: DD/MM/AAAA" maxlength="10" required class="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded text-xs bg-white dark:bg-slate-900 dark:text-slate-100 font-mono">
                                <p class="fecha-error text-red-500 text-[10px] hidden mt-0.5 font-semibold">Fecha inválida.</p>
                            </div>
                            <div>
                                <label class="block text-[11px] text-gray-500 dark:text-slate-400 mb-1">Motivo / Evolución:</label>
                                <input type="text" name="motivo" placeholder="Ej: Continuidad de reposo" class="w-full p-1.5 border border-gray-300 dark:border-slate-600 rounded text-xs bg-white dark:bg-slate-900 dark:text-slate-100">
                            </div>
                        </div>
                        <div class="flex justify-end gap-2">
                            <button type="button" onclick="document.getElementById('form-extender-parte').classList.add('hidden')" class="px-2.5 py-1 text-xs bg-gray-200 dark:bg-slate-700 rounded hover:bg-gray-300">Cancelar</button>
                            <button type="submit" class="px-3 py-1 text-xs bg-blue-600 text-white font-semibold rounded hover:bg-blue-700">Guardar Extensión</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    } else {
        // No tiene parte activo: Ofrecer emitir uno
        seccionParteHtml = `
            <div class="mb-4">
                <button type="button" onclick="document.getElementById('form-nuevo-parte').classList.toggle('hidden')" class="w-full text-left p-3 rounded-lg border border-dashed border-gray-300 dark:border-slate-600 hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-slate-800 transition flex justify-between items-center text-xs font-semibold text-gray-700 dark:text-slate-300">
                    <span>+ Emitir Parte de Enfermo para este Paciente (Opcional)</span>
                    <span class="text-blue-600 dark:text-blue-400 font-bold">Desplegar</span>
                </button>

                <div id="form-nuevo-parte" class="hidden mt-2 p-4 bg-gray-50 dark:bg-slate-750 rounded-xl border border-gray-200 dark:border-slate-700 space-y-3">
                    <p class="text-xs font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider">Nuevo Parte de Enfermo</p>
                    <div id="nuevo-parte-msg"></div>
                    <form hx-post="/partes/crear" hx-target="#nuevo-parte-msg" class="space-y-3">
                        <input type="hidden" name="paciente_id" value="${atencion.paciente_id}">
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="block text-[11px] font-semibold text-gray-700 dark:text-slate-300 mb-1">Fecha Desde (DD/MM/AAAA):</label>
                                <input type="text" name="fecha_inicio" value="${hoyDDMMAAAA}" placeholder="DD/MM/AAAA" pattern="\\d{2}/\\d{2}/\\d{4}" title="Formato: DD/MM/AAAA" maxlength="10" required class="w-full p-2 border border-gray-300 dark:border-slate-600 rounded-lg text-xs bg-white dark:bg-slate-900 dark:text-slate-100 font-mono">
                                <p class="fecha-error text-red-500 text-[10px] hidden mt-0.5 font-semibold">Fecha inválida.</p>
                            </div>
                            <div>
                                <label class="block text-[11px] font-semibold text-gray-700 dark:text-slate-300 mb-1">Fecha Hasta (DD/MM/AAAA):</label>
                                <input type="text" name="fecha_fin" placeholder="DD/MM/AAAA" pattern="\\d{2}/\\d{2}/\\d{4}" title="Formato: DD/MM/AAAA" maxlength="10" required class="w-full p-2 border border-gray-300 dark:border-slate-600 rounded-lg text-xs bg-white dark:bg-slate-900 dark:text-slate-100 font-mono">
                                <p class="fecha-error text-red-500 text-[10px] hidden mt-0.5 font-semibold">Fecha inválida.</p>
                            </div>
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-gray-700 dark:text-slate-300 mb-1">Código CIE-10 <span class="text-red-500 font-bold">(Obligatorio)</span>:</label>
                            <input type="text" name="cie_10" placeholder="Ej: J06.9, K29.7, M54.5" required class="w-full p-2 border border-gray-300 dark:border-slate-600 rounded-lg text-xs bg-white dark:bg-slate-900 dark:text-slate-100 font-mono font-semibold">
                        </div>
                        <div>
                            <label class="block text-[11px] text-gray-700 dark:text-slate-300 mb-1">Motivo / Reposo Indicado:</label>
                            <input type="text" name="diagnostico" placeholder="Ej: Reposo laboral por cuadro infeccioso respiratorio" class="w-full p-2 border border-gray-300 dark:border-slate-600 rounded-lg text-xs bg-white dark:bg-slate-900 dark:text-slate-100">
                        </div>
                        <div class="flex justify-end gap-2 pt-1">
                            <button type="button" onclick="document.getElementById('form-nuevo-parte').classList.add('hidden')" class="px-3 py-1.5 text-xs bg-gray-200 dark:bg-slate-700 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">Cancelar</button>
                            <button type="submit" class="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm">Emitir Parte</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
    }

    res.send(`
        <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-200 dark:border-slate-700">
            <div>
                <h3 class="text-lg font-bold text-gray-900 dark:text-slate-100">Atención Médica</h3>
                <p class="text-xs text-gray-500 dark:text-slate-400">
                    [${escapeHTML(atencion.pacientes.grado || '-')}] <b>${escapeHTML(atencion.pacientes.apellido)}, ${escapeHTML(atencion.pacientes.nombre)}</b> 
                    | DNI: ${escapeHTML(atencion.pacientes.dni)} | Destino: ${escapeHTML(atencion.pacientes.destino || '-')}
                </p>
            </div>
            <button onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-2xl font-bold">&times;</button>
        </div>

        ${seccionParteHtml}

        <form hx-post="/atenciones/finalizar" hx-target="#atender-msg" class="space-y-4">
            <input type="hidden" name="id" value="${id}">
            
            <div>
                <label class="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">Diagnóstico / Evolución Clínica:</label>
                <textarea name="diagnostico" rows="4" required placeholder="Escriba la evolución clínica del paciente, síntomas, indicaciones y tratamiento..." class="w-full p-2.5 border border-gray-300 dark:border-slate-600 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-sm bg-white dark:bg-slate-900 dark:text-slate-100"></textarea>
            </div>

            <div>
                <label class="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">
                    Código CIE-10 <span class="text-gray-400 font-normal text-xs">(Opcional para consulta común)</span>:
                </label>
                <input type="text" name="cie_10" placeholder="Ej: J00 (Opcional)" class="w-full p-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm font-mono bg-white dark:bg-slate-900 dark:text-slate-100">
            </div>

            <div class="pt-1">
                <label class="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-gray-700 dark:text-slate-300">
                    <input type="checkbox" name="derivado" value="true" class="rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 w-4 h-4">
                    <span>¿Paciente derivado a Centro Externo / Hospital Militar? (Marca 'X' en ESTAMED)</span>
                </label>
            </div>

            <div id="atender-msg" class="text-sm font-semibold"></div>

            <div class="flex justify-between items-center pt-4 border-t border-gray-200 dark:border-slate-700">
                <button type="button" hx-get="/pacientes/historial/${atencion.paciente_id}" hx-target="#modal-content" class="text-sm text-blue-600 dark:text-blue-400 hover:underline font-semibold">
                    Ver Historia Clínica
                </button>
                <div class="flex gap-2">
                    <button type="button" onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg font-semibold text-sm hover:bg-gray-300 dark:hover:bg-slate-600 transition">Cancelar</button>
                    <button type="submit" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-sm shadow-sm transition">Finalizar Atención</button>
                </div>
            </div>
        </form>
    `);
});

// Finalizar atencion (sin requerir PIN)
router.post('/finalizar', isMedicoOrAdmin, async (req, res) => {
    const { id, diagnostico, cie_10, derivado } = req.body;
    const firma_digital = derivado === 'true' ? 'DERIVADO: SI' : null;

    const { error } = await req.supabase
        .from('atenciones')
        .update({ 
            diagnostico, 
            cie_10, 
            estado: 'ATENDIDO',
            fecha_atencion: new Date().toISOString(),
            firma_digital
        })
        .eq('id', id);

    if (error) {
        return res.send(`<div class="text-red-500 text-center font-semibold">Error al guardar la atención: ${escapeHTML(error.message)}</div>`);
    }

    res.set('HX-Trigger', 'turnoAsignado');
    res.send(`
        <div id="modal-content" hx-swap-oob="true" class="bg-white dark:bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-lg relative max-h-[90vh] overflow-y-auto border border-gray-100 dark:border-slate-700">
            <div class="text-center py-4">
                <div class="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300 flex items-center justify-center font-bold text-lg">OK</div>
                <h3 class="text-xl font-bold text-gray-900 dark:text-slate-100">Atención Registrada con Éxito</h3>
                <p class="text-xs text-gray-500 dark:text-slate-400 mt-1">La evolución clínica ha sido guardada en la historia clínica del paciente.</p>
                <button onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="mt-6 px-6 py-2 bg-gray-200 dark:bg-slate-700 font-semibold rounded-lg text-sm text-gray-800 dark:text-slate-200 hover:bg-gray-300 dark:hover:bg-slate-600 transition">Cerrar</button>
            </div>
        </div>
    `);
});

// Marcar como ausente o cancelar turno de espera
router.post('/ausente', async (req, res) => {
    const role = req.signedCookies.user_role;
    if (!['MEDICO', 'RECEPCION', 'ADMIN'].includes(role)) {
        return res.status(403).send('No autorizado');
    }
    const { id } = req.body;
    const { error } = await req.supabase
        .from('atenciones')
        .update({ estado: 'AUSENTE' })
        .eq('id', id);
    if (error) return res.send('<li class="text-red-500 p-2">Error al actualizar</li>');
    res.set('HX-Trigger', 'turnoAsignado');
    res.send(''); // Elimina el elemento de la lista al instante
});

// Estadisticas para Admin
router.get('/stats', async (req, res) => {
    // Obtener conteo de atenciones de hoy (considerando zona horaria Argentina UTC-3)
    const hoyStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
    const inicioDiaArgentina = new Date(`${hoyStr}T00:00:00-03:00`).toISOString();
    
    const { count, error } = await req.supabase
        .from('atenciones')
        .select('*', { count: 'exact', head: true })
        .eq('estado', 'ATENDIDO')
        .gte('fecha_atencion', inicioDiaArgentina);

    if (error) {
        return res.send(`<p class="text-red-500">Error cargando stats.</p>`);
    }

    res.send(`
        <div class="text-center p-4 bg-blue-50 rounded border border-blue-100">
            <div class="text-3xl font-bold text-blue-600">${count}</div>
            <div class="text-sm text-gray-600">Pacientes atendidos hoy</div>
        </div>
    `);
});

module.exports = router;
