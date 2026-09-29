// =============================================================================
// SISTEMA HOSPITALARIO - GESTIÓN CLÍNICA Y ANALÍTICA (SIMULACIÓN LOCAL)
// =============================================================================
process.env.TZ = 'America/Argentina/Buenos_Aires';
require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createLocalSupabaseClient } = require('./data/local_db');

const app = express();
const port = process.env.PORT || 3001;

// Base de datos SQLite local (Emulación offline de Supabase)
const supabase = createLocalSupabaseClient();

// Inyectar cliente a las solicitudes
app.use((req, res, next) => {
    req.supabase = supabase;
    next();
});

// Cabeceras de seguridad HTTP
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'secreto-sistema-hospitalario-2026'));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// Configurar EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware de autenticación y rol
const requireAuth = (rolesPermitidos) => {
    return async (req, res, next) => {
        const { user_id, user_role, user_name } = req.signedCookies;
        
        if (!user_id || !user_role) {
            if (req.headers['hx-request']) {
                res.set('HX-Redirect', '/');
                return res.send('');
            }
            return res.redirect('/');
        }
        
        if (rolesPermitidos && !rolesPermitidos.includes(user_role)) {
            return res.status(403).send('<span class="text-red-500 font-semibold p-2">Acceso denegado. Permisos insuficientes.</span>');
        }
        
        req.user = { id: user_id, role: user_role, name: user_name };
        next();
    };
};

// Rutas de Vistas Principales
app.get('/', (req, res) => {
    const { user_role } = req.signedCookies;
    if (user_role === 'ADMIN') return res.redirect('/admin');
    if (user_role === 'RECEPCION') return res.redirect('/recepcion');
    if (user_role === 'MEDICO') return res.redirect('/medico');

    res.render('layout', { title: 'Acceso - Sistema Hospitalario', view: 'login', user: null });
});

app.get('/recepcion', requireAuth(['RECEPCION', 'ADMIN']), (req, res) => {
    res.render('layout', { title: 'Recepción', view: 'recepcion', user: req.user });
});

app.get('/medico', requireAuth(['MEDICO', 'ADMIN']), (req, res) => {
    res.render('layout', { title: 'Panel Médico', view: 'medico', user: req.user });
});

app.get('/admin', requireAuth(['ADMIN']), (req, res) => {
    res.render('layout', { title: 'Panel Administración', view: 'admin', user: req.user });
});

// Rutas de Módulos
const authRoutes = require('./routes/auth');
const pacientesRoutes = require('./routes/pacientes');
const atencionesRoutes = require('./routes/atenciones');
const { router: partesRoutes } = require('./routes/partes');
const estadisticasRoutes = require('./routes/estadisticas');

app.use('/auth', authRoutes);
app.use('/pacientes', requireAuth(['RECEPCION', 'MEDICO', 'ADMIN']), pacientesRoutes);
app.use('/atenciones', requireAuth(['RECEPCION', 'MEDICO', 'ADMIN']), atencionesRoutes);
app.use('/partes', requireAuth(['RECEPCION', 'MEDICO', 'ADMIN']), partesRoutes);
app.use('/estadisticas', requireAuth(['ADMIN']), estadisticasRoutes);

// Manejador 404
app.use((req, res) => {
    res.status(404).send('Página no encontrada en Sistema Hospitalario');
});

// Iniciar Servidor
app.listen(port, () => {
    console.log(`\n============================================================`);
    console.log(`   SISTEMA HOSPITALARIO - SIMULACIÓN CLÍNICA Y BI`);
    console.log(`============================================================`);
    console.log(`-> Servidor activo en: http://localhost:${port}`);
    console.log(`-> Base de datos local: data/hospital.db (SQLite)`);
    console.log(`-> Acceso rápido:`);
    console.log(`   - Admin:      admin@hospital.com     / admin123`);
    console.log(`   - Médico:     dr.mendez@hospital.com  / medico123`);
    console.log(`   - Recepción:  recepcion@hospital.com / recepcion123`);
    console.log(`============================================================\n`);
});
