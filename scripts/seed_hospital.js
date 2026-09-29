/**
 * Generador de Datos Sintéticos para el Sistema Hospitalario
 * Crea médicos civiles, pacientes sintéticos, atenciones médicas y códigos CIE-10.
 * Exporta a SQLite (hospital.db) y archivos CSV.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'hospital.db');
const db = new DatabaseSync(DB_PATH);

function seed() {
    console.log('--- GENERANDO DATOS SINTÉTICOS DE SISTEMA HOSPITALARIO ---');

    // 1. Limpiar y asegurar tablas
    db.exec(`
        DROP TABLE IF EXISTS atenciones;
        DROP TABLE IF EXISTS pacientes;
        DROP TABLE IF EXISTS usuarios;
        DROP TABLE IF EXISTS diagnosticos_cie10;

        CREATE TABLE usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nombre TEXT NOT NULL,
            rol TEXT NOT NULL,
            matricula TEXT,
            especialidad TEXT,
            grado TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE pacientes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dni TEXT UNIQUE NOT NULL,
            nombre TEXT NOT NULL,
            apellido TEXT NOT NULL,
            fecha_nacimiento TEXT,
            sexo TEXT,
            telefono TEXT,
            email TEXT,
            obra_social TEXT,
            servicio TEXT,
            notas TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE atenciones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            paciente_id INTEGER NOT NULL,
            medico_id INTEGER NOT NULL,
            estado TEXT NOT NULL DEFAULT 'ESPERA',
            diagnostico TEXT,
            cie_10 TEXT,
            observaciones TEXT,
            fecha_atencion TEXT,
            fecha_hora TEXT NOT NULL,
            tiempo_espera_minutos INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE diagnosticos_cie10 (
            codigo TEXT PRIMARY KEY,
            descripcion TEXT NOT NULL,
            capitulo TEXT
        );
    `);

    // 2. Insertar Catálogo CIE-10
    const cie10List = [
        ['J00', 'Rinofaringitis aguda (resfriado común)', 'Enfermedades respiratorias'],
        ['I10', 'Hipertensión esencial (primaria)', 'Enfermedades circulatorias'],
        ['E11', 'Diabetes mellitus tipo 2', 'Enfermedades endocrinas'],
        ['M54', 'Dorsalgia y lumbalgia aguda', 'Enfermedades osteomusculares'],
        ['K29', 'Gastritis y duodenitis', 'Enfermedades digestivas'],
        ['R51', 'Cefalea y dolor de cabeza tensional', 'Síntomas y signos generales'],
        ['J20', 'Bronquitis aguda', 'Enfermedades respiratorias'],
        ['S93', 'Traumatismo y esguince de tobillo', 'Traumatismos y envenenamientos'],
        ['A09', 'Gastroenteritis y colitis de origen infeccioso', 'Enfermedades infecciosas'],
        ['N39', 'Infección del tracto urinario', 'Enfermedades genitourinarias']
    ];

    const stmtCie = db.prepare('INSERT INTO diagnosticos_cie10 (codigo, descripcion, capitulo) VALUES (?, ?, ?)');
    for (const c of cie10List) {
        stmtCie.run(c[0], c[1], c[2]);
    }

    // 3. Insertar Usuarios y Personal Médico Civil
    const usuarios = [
        ['admin@hospital.com', 'admin123', 'Lic. Santiago Quiroga', 'ADMIN', 'MN-9012', 'Dirección Médica'],
        ['recepcion@hospital.com', 'recepcion123', 'Mariana Beltrán', 'RECEPCION', null, 'Admisión Central'],
        ['dr.mendez@hospital.com', 'medico123', 'Dr. Carlos Méndez', 'MEDICO', 'MP-45210', 'Cardiología'],
        ['dra.soto@hospital.com', 'medico123', 'Dra. Valentina Soto', 'MEDICO', 'MP-52119', 'Pediatría'],
        ['dr.benitez@hospital.com', 'medico123', 'Dr. Martín Benítez', 'MEDICO', 'MP-39881', 'Traumatología'],
        ['dra.navarro@hospital.com', 'medico123', 'Dra. Lucía Navarro', 'MEDICO', 'MP-48762', 'Clínica Médica'],
        ['dr.morales@hospital.com', 'medico123', 'Dr. Esteban Morales', 'MEDICO', 'MP-61004', 'Guardia General']
    ];

    const stmtUser = db.prepare('INSERT INTO usuarios (email, password, nombre, rol, matricula, especialidad, grado) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const u of usuarios) {
        stmtUser.run(u[0], u[1], u[2], u[3], u[4], u[5], u[5]);
    }

    // 4. Pacientes Sintéticos (60 pacientes ficticios)
    const nombres = ['Lucas', 'Mateo', 'Agustina', 'Facundo', 'Camila', 'Joaquín', 'Martina', 'Nicolás', 'Sofía', 'Tomás', 'Julieta', 'Gonzalo', 'Florencia', 'Ignacio', 'Paula'];
    const apellidos = ['González', 'Rodríguez', 'López', 'Martínez', 'Pérez', 'Gómez', 'Sánchez', 'Díaz', 'Álvarez', 'Romero', 'Sosa', 'Torres', 'Ramírez', 'Flores', 'Benítez'];
    const obrasSociales = ['OSDE', 'Swiss Medical', 'PAMI', 'Galeno', 'IOMA', 'Particular', 'Medifé'];
    const servicios = ['Consultorios Externos', 'Guardia General', 'Cardiología', 'Traumatología', 'Pediatría'];

    const stmtPac = db.prepare(`
        INSERT INTO pacientes (dni, nombre, apellido, fecha_nacimiento, sexo, telefono, email, obra_social, servicio, notas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const pacientesCreados = [];
    for (let i = 1; i <= 60; i++) {
        const nom = nombres[i % nombres.length];
        const ape = apellidos[(i * 3) % apellidos.length];
        const dni = `${30000000 + i * 217}`;
        const anioNac = 1950 + (i % 55);
        const mesNac = String((i % 12) + 1).padStart(2, '0');
        const diaNac = String((i % 27) + 1).padStart(2, '0');
        const fechaNac = `${anioNac}-${mesNac}-${diaNac}`;
        const sexo = i % 2 === 0 ? 'M' : 'F';
        const os = obrasSociales[i % obrasSociales.length];
        const serv = servicios[i % servicios.length];

        stmtPac.run(
            dni, nom, ape, fechaNac, sexo,
            `11-${4000+i}-${5000+i}`,
            `${nom.toLowerCase()}.${ape.toLowerCase()}@email.com`,
            os, serv, 'Paciente regular sin antecedentes de riesgo agudo.'
        );
        pacientesCreados.push({ id: i, dni, nombre: `${nom} ${ape}` });
    }

    // 5. Atenciones Médicas Sintéticas (150 consultas)
    const medicosIds = [3, 4, 5, 6, 7]; // IDs de médicos
    const estados = ['ATENDIDO', 'ATENDIDO', 'ATENDIDO', 'ATENDIDO', 'ESPERA', 'EN_CONSULTA'];

    const stmtAtenc = db.prepare(`
        INSERT INTO atenciones (paciente_id, medico_id, estado, diagnostico, cie_10, observaciones, fecha_atencion, fecha_hora, tiempo_espera_minutos)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const fechaInicio = new Date('2026-01-05T08:00:00-03:00');
    for (let j = 1; j <= 150; j++) {
        const pacId = (j % 60) + 1;
        const medId = medicosIds[j % medicosIds.length];
        const estado = estados[j % estados.length];
        const cie = cie10List[j % cie10List.length];
        
        // Simular fecha distribuida
        const fechaHora = new Date(fechaInicio.getTime() + j * 36 * 3600 * 1000);
        const fechaStr = fechaHora.toISOString().split('T')[0];
        const tiempoEspera = 10 + (j % 45);

        stmtAtenc.run(
            pacId,
            medId,
            estado,
            estado === 'ATENDIDO' ? cie[1] : null,
            estado === 'ATENDIDO' ? cie[0] : null,
            estado === 'ATENDIDO' ? 'Evolución clínica favorable. Indicación terapéutica farmacológica.' : null,
            fechaStr,
            fechaHora.toISOString(),
            tiempoEspera
        );
    }

    console.log('✓ 10 Códigos CIE-10 cargados');
    console.log('✓ 7 Usuarios (Admin, Recepción, 5 Médicos con especialidad) creados');
    console.log('✓ 60 Pacientes sintéticos creados');
    console.log('✓ 150 Atenciones clínicas simuladas cargadas');
    console.log(`✓ Base de datos persistida en: ${DB_PATH}`);
}

seed();
