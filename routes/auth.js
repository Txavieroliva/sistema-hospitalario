const express = require('express');
const router = express.Router();

// Función de escape seguro HTML
const escapeHTML = (str) => {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Middleware de seguridad para proteger acciones de administrador
const isAdmin = (req, res, next) => {
    if (req.signedCookies.user_role !== 'ADMIN') {
        return res.status(403).send('<span class="text-red-500">Acceso denegado. Función exclusiva de administradores.</span>');
    }
    next();
};

// Rate limiter simple en memoria contra ataques de fuerza bruta
const loginAttempts = new Map();

// Limpieza automática cada 15 minutos
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of loginAttempts.entries()) {
        if (now - data.lastAttempt > 15 * 60 * 1000) {
            loginAttempts.delete(ip);
        }
    }
}, 15 * 60 * 1000);

router.post('/login', async (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const attempts = loginAttempts.get(clientIp) || { count: 0, lastAttempt: Date.now() };

    // Bloquear si superó 5 intentos fallidos en menos de 5 minutos
    if (attempts.count >= 5 && Date.now() - attempts.lastAttempt < 5 * 60 * 1000) {
        const segundosRestantes = Math.ceil((5 * 60 * 1000 - (Date.now() - attempts.lastAttempt)) / 1000);
        return res.send(`Demasiados intentos fallidos. Por seguridad, intente en ${segundosRestantes} segundos.`);
    }

    const { email, password } = req.body;
    const { data, error } = await req.supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) {
        loginAttempts.set(clientIp, { count: attempts.count + 1, lastAttempt: Date.now() });
        return res.send(`Credenciales inválidas o error de red.`);
    }

    // Login exitoso: limpiar historial de intentos
    loginAttempts.delete(clientIp);

    // Obtener rol del usuario desde la tabla usuarios
    const { data: userData, error: userError } = await req.supabase
        .from('usuarios')
        .select('rol, nombre')
        .eq('id', data.user.id)
        .single();

    if (userError || !userData) {
        return res.send(`Error al obtener el perfil de usuario.`);
    }

    // Configuración de cookies seguras
    const cookieOptions = {
        httpOnly: true,
        signed: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 12 * 60 * 60 * 1000
    };

    res.cookie('user_id', data.user.id, cookieOptions);
    res.cookie('user_role', userData.rol, cookieOptions);
    res.cookie('user_name', userData.nombre, cookieOptions);

    let redirectUrl = '/';
    if (userData.rol === 'ADMIN') redirectUrl = '/admin';
    if (userData.rol === 'RECEPCION') redirectUrl = '/recepcion';
    if (userData.rol === 'MEDICO') redirectUrl = '/medico';

    res.set('HX-Redirect', redirectUrl);
    res.send('');
});

router.post('/logout', (req, res) => {
    const clearOptions = { sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };
    res.clearCookie('user_id', clearOptions);
    res.clearCookie('user_role', clearOptions);
    res.clearCookie('user_name', clearOptions);
    res.set('HX-Redirect', '/');
    res.send('');
});

router.post('/register', isAdmin, async (req, res) => {
    const { email, password, nombre, rol, matricula, grado } = req.body;

    let authUserId = null;
    const { data, error } = await req.supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
    });

    if (error) {
        // Auto-recuperación: si el usuario ya existe en auth.users pero fue borrado de public.usuarios
        if (error.message.toLowerCase().includes('already') || error.status === 422) {
            const { data: listData } = await req.supabase.auth.admin.listUsers();
            const existingUser = listData?.users?.find(u => u.email.toLowerCase() === email.toLowerCase());
            if (existingUser) {
                const { data: publicUser } = await req.supabase.from('usuarios').select('id').eq('id', existingUser.id).maybeSingle();
                if (!publicUser) {
                    // Borrar cuenta huérfana y recrearla
                    await req.supabase.auth.admin.deleteUser(existingUser.id);
                    const { data: retryData, error: retryError } = await req.supabase.auth.admin.createUser({
                        email,
                        password,
                        email_confirm: true
                    });
                    if (retryError || !retryData?.user) {
                        return res.send(`<span class="text-red-500">Error: ${escapeHTML(retryError?.message || 'No se pudo regenerar la cuenta.')}</span>`);
                    }
                    authUserId = retryData.user.id;
                } else {
                    return res.send(`<span class="text-red-500 font-semibold">El usuario ya existe en el sistema.</span>`);
                }
            } else {
                return res.send(`<span class="text-red-500">Error: ${escapeHTML(error.message)}</span>`);
            }
        } else {
            return res.send(`<span class="text-red-500">Error: ${escapeHTML(error.message)}</span>`);
        }
    } else {
        authUserId = data.user.id;
    }

    // Insertar perfil en tabla usuarios (sin PIN)
    const { error: profileError } = await req.supabase
        .from('usuarios')
        .insert([{ 
            id: authUserId, 
            email, 
            nombre, 
            rol, 
            matricula: matricula || null,
            grado: grado || null
        }]);

    if (profileError) {
        return res.send(`<span class="text-red-500">Error al guardar perfil: ${escapeHTML(profileError.message)}</span>`);
    }

    res.set('HX-Trigger', 'updateUsers');
    res.send(`<span class="text-green-600 font-semibold">Usuario registrado con éxito.</span>`);
});

// Listar usuarios (para el panel admin)
router.get('/lista', isAdmin, async (req, res) => {
    const currentAdminId = req.signedCookies.user_id;

    const { data: usuarios, error } = await req.supabase
        .from('usuarios')
        .select('*')
        .order('rol', { ascending: true })
        .order('nombre', { ascending: true });

    if (error) return res.send('<p class="text-xs text-red-500">Error cargando usuarios.</p>');

    let html = '<ul class="divide-y divide-slate-200 dark:divide-slate-800 text-sm mt-4 border-t border-slate-200 dark:border-slate-800 pt-4">';
    usuarios.forEach(u => {
        const esPropiaCuenta = u.id === currentAdminId;
        const deleteButton = esPropiaCuenta 
            ? `<span class="text-[11px] text-slate-400 italic px-2">(Tú)</span>` 
            : `
                <button type="button" 
                        hx-post="/auth/eliminar" 
                        hx-vals='{"id": "${u.id}"}' 
                        hx-confirm="¿Seguro que desea eliminar permanentemente al usuario ${escapeHTML(u.nombre)}?"
                        hx-target="closest li"
                        hx-swap="outerHTML"
                        class="px-2 py-1 text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/50 rounded-lg transition font-semibold"
                        title="Eliminar Usuario">
                    Eliminar
                </button>
            `;

        html += `
            <li class="py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <p class="font-bold text-slate-900 dark:text-slate-100">
                        ${u.grado ? escapeHTML(u.grado) + ' ' : ''}${escapeHTML(u.nombre)}
                    </p>
                    <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${u.rol==='ADMIN'?'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300':u.rol==='MEDICO'?'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300':'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300'} mr-1">${u.rol}</span>
                        ${escapeHTML(u.email)} ${u.matricula ? `| Mat: ${escapeHTML(u.matricula)}` : ''}
                    </p>
                </div>
                <div class="flex items-center gap-2 self-end sm:self-auto">
                    <!-- Botón Restablecer Contraseña -->
                    <details class="relative">
                        <summary class="cursor-pointer text-xs bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold transition list-none flex items-center gap-1">
                            Restablecer Clave
                        </summary>
                        <div class="absolute right-0 mt-1 p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 w-64">
                            <form hx-post="/auth/reset-password" hx-target="#reset-msg-${u.id}" class="space-y-2">
                                <input type="hidden" name="id" value="${u.id}">
                                <label class="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">Nueva Contraseña:</label>
                                <input type="password" name="new_password" required minlength="6" placeholder="Mínimo 6 caracteres" class="w-full p-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500">
                                <div class="flex justify-between items-center pt-1">
                                    <span id="reset-msg-${u.id}" class="text-[11px]"></span>
                                    <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg text-xs font-bold shadow-sm transition">Guardar</button>
                                </div>
                            </form>
                        </div>
                    </details>
                    ${deleteButton}
                </div>
            </li>
        `;
    });
    html += '</ul>';
    res.send(html);
});

// Resetear contraseña de usuario desde Admin
router.post('/reset-password', isAdmin, async (req, res) => {
    const { id, new_password } = req.body;

    if (!new_password || new_password.trim().length < 6) {
        return res.send(`<span class="text-red-500 text-xs font-semibold">Mínimo 6 caracteres.</span>`);
    }

    const { error } = await req.supabase.auth.admin.updateUserById(id, {
        password: new_password.trim()
    });

    if (error) {
        return res.send(`<span class="text-red-500 text-xs">Error: ${escapeHTML(error.message)}</span>`);
    }

    res.send(`<span class="text-emerald-600 text-xs font-bold">Actualizada</span>`);
});

// Eliminar usuario
router.post('/eliminar', isAdmin, async (req, res) => {
    const { id } = req.body;
    const currentAdminId = req.signedCookies.user_id;

    if (id === currentAdminId) {
        return res.send(`<span class="text-red-500 text-xs">No puedes borrar tu propia cuenta.</span>`);
    }

    // 1. Eliminar atenciones y partes asociados a este usuario para evitar error de clave foránea
    try {
        await req.supabase.from('atenciones').delete().eq('medico_id', id);
        await req.supabase.from('partes_enfermo').delete().eq('medico_id', id);
    } catch (e) {}

    // 2. Eliminar perfil en tabla usuarios
    const { error: errPerfil } = await req.supabase.from('usuarios').delete().eq('id', id);
    
    // 3. Eliminar cuenta de auth.users
    try {
        await req.supabase.auth.admin.deleteUser(id);
    } catch (e) {}

    if (errPerfil) {
        return res.send(`<span class="text-red-500 text-xs">Error: ${escapeHTML(errPerfil.message)}</span>`);
    }

    // Éxito: retorna vacío para que hx-swap="outerHTML" remueva el <li>
    res.send('');
});

// Obtener registro de auditoría de accesos a historias clínicas (Ley 25.326 & Ley 27.706)
router.get('/auditoria', isAdmin, async (req, res) => {
    const { data: logs, error } = await req.supabase
        .from('auditoria_accesos')
        .select('*')
        .order('fecha_hora', { ascending: false })
        .limit(30);

    if (error || !logs || logs.length === 0) {
        return res.send(`
            <div class="text-center py-6 text-slate-500 dark:text-slate-400 text-xs">
                <p>No hay eventos de auditoría registrados todavía.</p>
                <p class="text-[11px] text-slate-400 mt-1">Los accesos a historias clínicas e impresiones oficiales se registrarán automáticamente aquí.</p>
            </div>
        `);
    }

    let html = `
        <table class="w-full text-left text-xs border-collapse">
            <thead>
                <tr class="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-semibold uppercase text-[10px]">
                    <th class="py-2 px-2">Fecha y Hora</th>
                    <th class="py-2 px-2">Usuario Actuante</th>
                    <th class="py-2 px-2">Rol</th>
                    <th class="py-2 px-2">Paciente Consultado</th>
                    <th class="py-2 px-2">Acción</th>
                    <th class="py-2 px-2">IP Origen</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 dark:divide-slate-800 font-mono text-[11px]">
    `;

    logs.forEach(l => {
        const d = new Date(l.fecha_hora);
        const fecha = `${d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} ${d.toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        const accionBadge = l.accion === 'IMPRESION_COPIA_LEGAL'
            ? `<span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold">IMPRESIÓN / PDF</span>`
            : `<span class="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 font-bold">CONSULTA HC</span>`;

        html += `
            <tr class="hover:bg-slate-100/50 dark:hover:bg-slate-800/50 transition">
                <td class="py-2 px-2 text-slate-600 dark:text-slate-400">${fecha}</td>
                <td class="py-2 px-2 font-bold text-slate-900 dark:text-slate-100">${escapeHTML(l.usuario_nombre)}</td>
                <td class="py-2 px-2"><span class="px-1 py-0.5 rounded text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold">${escapeHTML(l.usuario_rol)}</span></td>
                <td class="py-2 px-2 text-slate-800 dark:text-slate-200">${escapeHTML(l.paciente_nombre)} (DNI: ${escapeHTML(l.paciente_dni)})</td>
                <td class="py-2 px-2">${accionBadge}</td>
                <td class="py-2 px-2 text-slate-400 text-[10px]">${escapeHTML(l.ip || '-')}</td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    res.send(html);
});

module.exports = router;
