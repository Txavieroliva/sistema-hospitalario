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

const formatFechaDate = (isoString) => {
    if (!isoString) return '-';
    if (typeof isoString === 'string' && (isoString.length <= 10 || !isoString.includes('T'))) {
        if (isoString.includes('-')) {
            const partes = isoString.split('-');
            if (partes.length === 3) {
                return `${partes[2].padStart(2, '0')}/${partes[1].padStart(2, '0')}/${partes[0]}`;
            }
        }
        return isoString;
    }
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

// Evaluar estado operativo del parte de enfermo
const evaluarParte = (parte) => {
    if (!parte) return { tieneParte: false };

    // Fecha actual en formato YYYY-MM-DD (Argentina UTC-3)
    const hoyStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

    if (parte.estado === 'ACTIVO') {
        const vencido = parte.fecha_fin < hoyStr;
        const diffMs = new Date(hoyStr).getTime() - new Date(parte.fecha_fin).getTime();
        const diasVencido = vencido ? Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24))) : 0;
        return {
            tieneParte: true,
            estado: 'ACTIVO',
            vencido,
            diasVencido,
            parte
        };
    }

    if (parte.estado === 'ALTA_ADMINISTRATIVA') {
        const fechaAlta = parte.fecha_alta_admin ? new Date(parte.fecha_alta_admin) : new Date(parte.updated_at || parte.created_at);
        const diffMs = Date.now() - fechaAlta.getTime();
        const diasAltaAdmin = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
        const alerta30Dias = diasAltaAdmin >= 25;
        const supero30Dias = diasAltaAdmin >= 30;
        const diasRestantes = Math.max(0, 30 - diasAltaAdmin);

        return {
            tieneParte: true,
            estado: 'ALTA_ADMINISTRATIVA',
            diasAltaAdmin,
            alerta30Dias,
            supero30Dias,
            diasRestantes,
            parte
        };
    }

    return {
        tieneParte: true,
        estado: 'ALTA_DEFINITIVA',
        parte
    };
};

const parseDateToISO = (str) => {
    if (!str) return null;
    if (str.includes('/')) {
        const parts = str.split('/');
        if (parts.length === 3) {
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
    }
    return str;
};

// Control de rol estricto para emisión y modificación de partes
const isMedicoOrAdmin = (req, res, next) => {
    const role = req.signedCookies.user_role;
    if (role !== 'MEDICO' && role !== 'ADMIN') {
        return res.status(403).send('<div class="p-3 bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 text-xs font-semibold rounded-lg">Acceso denegado. Función exclusiva de médicos y administradores.</div>');
    }
    next();
};

// Crear nuevo parte de enfermo
router.post('/crear', isMedicoOrAdmin, async (req, res) => {
    let { paciente_id, fecha_inicio, fecha_fin, cie_10, diagnostico } = req.body;
    const medicoId = req.signedCookies.user_id;

    fecha_inicio = parseDateToISO(fecha_inicio);
    fecha_fin = parseDateToISO(fecha_fin);

    if (!cie_10 || !cie_10.trim()) {
        return res.send(`
            <div class="p-3 bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm font-semibold mb-3">
                Error: El código CIE-10 es estrictamente OBLIGATORIO para emitir un Parte de Enfermo.
            </div>
        `);
    }

    if (!fecha_inicio || !fecha_fin) {
        return res.send(`
            <div class="p-3 bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm font-semibold mb-3">
                Error: Debe especificar fecha Desde y fecha Hasta en formato DD/MM/AAAA.
            </div>
        `);
    }

    if (fecha_fin < fecha_inicio) {
        return res.send(`
            <div class="p-3 bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm font-semibold mb-3">
                Error: La fecha de finalización no puede ser anterior a la de inicio.
            </div>
        `);
    }

    const { error } = await req.supabase
        .from('partes_enfermo')
        .insert([{
            paciente_id,
            medico_id: medicoId,
            fecha_inicio,
            fecha_fin,
            cie_10: cie_10.trim().toUpperCase(),
            diagnostico: diagnostico || null,
            estado: 'ACTIVO',
            historial_extensiones: []
        }]);

    if (error) {
        return res.send(`
            <div class="p-3 bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-800 rounded text-red-700 dark:text-red-300 text-sm font-semibold mb-3">
                Error al guardar parte de enfermo: ${escapeHTML(error.message)}
            </div>
        `);
    }

    res.send(`
        <div class="p-3 bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 rounded text-emerald-800 dark:text-emerald-200 text-sm font-semibold mb-3">
            Parte de Enfermo emitido correctamente (Desde: ${formatFechaDate(fecha_inicio)} Hasta: ${formatFechaDate(fecha_fin)} - CIE-10: ${escapeHTML(cie_10)}).
        </div>
    `);
});

// Extender parte de enfermo
router.post('/extender', isMedicoOrAdmin, async (req, res) => {
    const { parte_id, nueva_fecha_fin, motivo } = req.body;
    const medicoNombre = req.signedCookies.user_name || 'Médico de Guardia';

    const fecha_fin_iso = parseDateToISO(nueva_fecha_fin);

    if (!fecha_fin_iso) {
        return res.send(`<div class="text-red-600 text-xs mt-1 font-semibold">Debe ingresar una fecha válida (DD/MM/AAAA).</div>`);
    }

    const { data: parte, error: errFetch } = await req.supabase
        .from('partes_enfermo')
        .select('*')
        .eq('id', parte_id)
        .single();

    if (errFetch || !parte) {
        return res.send(`<div class="text-red-600 text-xs mt-1 font-semibold">Error al consultar el parte actual.</div>`);
    }

    if (fecha_fin_iso <= parte.fecha_fin) {
        return res.send(`<div class="text-red-600 text-xs mt-1 font-semibold">La nueva fecha Hasta debe ser posterior a la actual (${formatFechaDate(parte.fecha_fin)}).</div>`);
    }

    const extensiones = Array.isArray(parte.historial_extensiones) ? [...parte.historial_extensiones] : [];
    extensiones.push({
        fecha_registro: new Date().toISOString(),
        medico_nombre: medicoNombre,
        fecha_fin_anterior: parte.fecha_fin,
        nueva_fecha_fin: fecha_fin_iso,
        motivo: motivo || 'Extensión de reposo por evolución del cuadro'
    });

    const { error: errUpdate } = await req.supabase
        .from('partes_enfermo')
        .update({
            fecha_fin: fecha_fin_iso,
            estado: 'ACTIVO',
            historial_extensiones: extensiones,
            updated_at: new Date().toISOString()
        })
        .eq('id', parte_id);

    if (errUpdate) {
        return res.send(`<div class="text-red-600 text-xs mt-1 font-semibold">Error al extender parte: ${escapeHTML(errUpdate.message)}</div>`);
    }

    res.send(`
        <div class="p-3 bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 rounded text-emerald-800 dark:text-emerald-200 text-sm font-semibold">
            Parte extendido con éxito hasta el ${formatFechaDate(nueva_fecha_fin)}.
        </div>
    `);
});

// Dar Alta Administrativa
router.post('/alta-admin', isMedicoOrAdmin, async (req, res) => {
    const { parte_id } = req.body;

    const { error } = await req.supabase
        .from('partes_enfermo')
        .update({
            estado: 'ALTA_ADMINISTRATIVA',
            fecha_alta_admin: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', parte_id);

    if (error) {
        return res.send(`<div class="text-red-600 text-xs mt-1 font-semibold">Error: ${escapeHTML(error.message)}</div>`);
    }

    res.send(`
        <div class="p-3 bg-amber-100 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-800 rounded text-amber-800 dark:text-amber-200 text-sm font-semibold">
            Paciente en Alta Administrativa
        </div>
    `);
});

// Dar Alta Definitiva
router.post('/alta-definitiva', isMedicoOrAdmin, async (req, res) => {
    const { parte_id } = req.body;

    const { error } = await req.supabase
        .from('partes_enfermo')
        .update({
            estado: 'ALTA_DEFINITIVA',
            fecha_alta_definitiva: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', parte_id);

    if (error) {
        return res.send(`<div class="text-red-600 text-xs mt-1 font-semibold">Error: ${escapeHTML(error.message)}</div>`);
    }

    res.send(`
        <div class="p-3 bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 rounded text-emerald-800 dark:text-emerald-200 text-sm font-semibold">
            Paciente de Alta de Parte de Enfermo
        </div>
    `);
});

// Ver Historial Completo de Partes de un Paciente (Modal)
router.get('/historial/:paciente_id', async (req, res) => {
    const { paciente_id } = req.params;

    const { data: paciente } = await req.supabase
        .from('pacientes')
        .select('*')
        .eq('id', paciente_id)
        .single();

    const { data: partes } = await req.supabase
        .from('partes_enfermo')
        .select('*, usuarios(nombre, matricula, grado)')
        .eq('paciente_id', paciente_id)
        .order('created_at', { ascending: false });

    if (!paciente) return res.send('Paciente no encontrado');

    let partesHtml = '';
    if (!partes || partes.length === 0) {
        partesHtml = `<p class="text-gray-500 dark:text-slate-400 text-center py-6">No registra partes de enfermo anteriores.</p>`;
    } else {
        partesHtml = partes.map((p, idx) => {
            const extensiones = Array.isArray(p.historial_extensiones) ? p.historial_extensiones : [];
            let badgeEstado = '';
            if (p.estado === 'ACTIVO') {
                const ev = evaluarParte(p);
                if (ev.vencido) {
                    badgeEstado = `<span class="bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200 text-xs px-2.5 py-1 rounded-full font-bold">VENCIDO (${ev.diasVencido}d)</span>`;
                } else {
                    badgeEstado = `<span class="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 text-xs px-2.5 py-1 rounded-full font-bold">ACTIVO</span>`;
                }
            } else if (p.estado === 'ALTA_ADMINISTRATIVA') {
                const ev = evaluarParte(p);
                badgeEstado = `<span class="bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 text-xs px-2.5 py-1 rounded-full font-bold">ALTA ADM (${ev.diasAltaAdmin}d / 30)</span>`;
            } else {
                badgeEstado = `<span class="bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 text-xs px-2.5 py-1 rounded-full font-bold">ALTA DEFINITIVA</span>`;
            }

            let extensionsHtml = '';
            if (extensiones.length > 0) {
                extensionsHtml = `
                    <div class="mt-3 pt-3 border-t border-gray-200 dark:border-slate-700">
                        <p class="text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider mb-2">Historial de Prórrogas / Extensiones:</p>
                        <ul class="space-y-1.5 text-xs text-gray-600 dark:text-slate-400">
                            ${extensiones.map((ext, i) => `
                                <li class="bg-gray-50 dark:bg-slate-800/80 p-2 rounded border border-gray-200 dark:border-slate-700">
                                    <span class="font-semibold text-gray-800 dark:text-slate-200">#${i + 1} - ${formatFechaDate(ext.fecha_registro)}:</span>
                                    Prorrogado de <b>${formatFechaDate(ext.fecha_fin_anterior)}</b> a <b class="text-blue-600 dark:text-blue-400">${formatFechaDate(ext.nueva_fecha_fin)}</b> por <i>${escapeHTML(ext.medico_nombre)}</i>.
                                    ${ext.motivo ? `<div class="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">Motivo: ${escapeHTML(ext.motivo)}</div>` : ''}
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                `;
            }

            return `
                <div class="border border-gray-200 dark:border-slate-700 rounded-lg p-4 bg-white dark:bg-slate-800/90 shadow-sm space-y-2">
                    <div class="flex justify-between items-start">
                        <div>
                            <span class="text-xs text-gray-400 font-mono">Registro #${partes.length - idx}</span>
                            <h4 class="font-bold text-gray-900 dark:text-slate-100 text-base">CIE-10: ${escapeHTML(p.cie_10)}</h4>
                            <p class="text-xs text-gray-600 dark:text-slate-400">Desde: <b>${formatFechaDate(p.fecha_inicio)}</b> - Hasta: <b>${formatFechaDate(p.fecha_fin)}</b></p>
                        </div>
                        <div>${badgeEstado}</div>
                    </div>
                    ${p.diagnostico ? `<p class="text-sm text-gray-700 dark:text-slate-300 italic bg-gray-50 dark:bg-slate-900/50 p-2 rounded border border-gray-100 dark:border-slate-800">${escapeHTML(p.diagnostico)}</p>` : ''}
                    <div class="flex justify-between text-xs text-gray-500 dark:text-slate-400 pt-1">
                        <span>Médico inicial: ${p.usuarios?.grado ? escapeHTML(p.usuarios.grado) + ' ' : ''}Med ${escapeHTML(p.usuarios?.nombre || '-')}</span>
                        <span>Emitido: ${formatFechaDate(p.created_at)}</span>
                    </div>
                    ${extensionsHtml}
                </div>
            `;
        }).join('');
    }

    res.send(`
        <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-200 dark:border-slate-700">
            <div>
                <h3 class="text-lg font-bold text-gray-900 dark:text-slate-100">Historial de Partes de Enfermo</h3>
                <p class="text-xs text-gray-500 dark:text-slate-400">${escapeHTML(paciente.apellido)}, ${escapeHTML(paciente.nombre)} | DNI: ${escapeHTML(paciente.dni)}</p>
            </div>
            <button onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 text-2xl font-bold">&times;</button>
        </div>
        <div class="max-h-[70vh] overflow-y-auto pr-1 space-y-3">
            ${partesHtml}
        </div>
        <div class="mt-4 pt-3 border-t border-gray-200 dark:border-slate-700 flex justify-end">
            <button type="button" onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded font-semibold text-sm hover:bg-gray-300 dark:hover:bg-slate-600 transition">
                Cerrar
            </button>
        </div>
    `);
});

module.exports = {
    router,
    evaluarParte,
    formatFechaDate,
    formatHoraAR
};