const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const {
    getAutoridadesConfig,
    saveAutoridadesConfig,
    mapearCategoriaMilitar,
    mapearCIE10aCIE11,
    calcularEdad
} = require('../utils/estamed_helpers');

// Middleware estricto: Sólo Administradores
function isAdmin(req, res, next) {
    if (req.signedCookies.user_role !== 'ADMIN') {
        return res.status(403).send('Acceso reservado a Administradores del Sistema.');
    }
    next();
}

router.use(isAdmin);

function escapar(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Resuelve fechas de inicio y fin y texto según el período solicitado
function resolverPeriodo(query) {
    const anio = parseInt(query.anio, 10) || new Date().getFullYear();
    const tipo = query.periodo || 'semestre1';
    let inicioISO, finISO, periodoNombre, periodoSlug;

    if (tipo === 'semestre1') {
        inicioISO = new Date(`${anio}-01-01T00:00:00-03:00`).toISOString();
        finISO = new Date(`${anio}-06-30T23:59:59.999-03:00`).toISOString();
        periodoNombre = `1er Semestre: Año ${anio}`;
        periodoSlug = `1Sem_${anio}`;
    } else if (tipo === 'semestre2') {
        inicioISO = new Date(`${anio}-07-01T00:00:00-03:00`).toISOString();
        finISO = new Date(`${anio}-12-31T23:59:59.999-03:00`).toISOString();
        periodoNombre = `2do Semestre: Año ${anio}`;
        periodoSlug = `2Sem_${anio}`;
    } else if (tipo === 'anio') {
        inicioISO = new Date(`${anio}-01-01T00:00:00-03:00`).toISOString();
        finISO = new Date(`${anio}-12-31T23:59:59.999-03:00`).toISOString();
        periodoNombre = `Año Completo: ${anio}`;
        periodoSlug = `Anual_${anio}`;
    } else if (tipo === 'personalizado') {
        const regexFecha = /^\d{4}-\d{2}-\d{2}$/;
        const desde = query.desde && regexFecha.test(query.desde.trim()) ? query.desde.trim() : `${anio}-01-01`;
        const hasta = query.hasta && regexFecha.test(query.hasta.trim()) ? query.hasta.trim() : `${anio}-12-31`;
        try {
            inicioISO = new Date(`${desde}T00:00:00-03:00`).toISOString();
            finISO = new Date(`${hasta}T23:59:59.999-03:00`).toISOString();
        } catch (e) {
            inicioISO = new Date(`${anio}-01-01T00:00:00-03:00`).toISOString();
            finISO = new Date(`${anio}-12-31T23:59:59.999-03:00`).toISOString();
        }
        periodoNombre = `Período ${desde} al ${hasta}`;
        periodoSlug = `${desde}_al_${hasta}`;
    } else {
        inicioISO = new Date(`${anio}-01-01T00:00:00-03:00`).toISOString();
        finISO = new Date(`${anio}-06-30T23:59:59.999-03:00`).toISOString();
        periodoNombre = `1er Semestre: Año ${anio}`;
        periodoSlug = `1Sem_${anio}`;
    }

    return { anio, tipo, inicioISO, finISO, periodoNombre, periodoSlug };
}

// Obtiene todas las atenciones del período paginando de a 1000
async function obtenerAtencionesPeriodo(supabase, inicioISO, finISO, destinoFiltro) {
    const atenciones = [];
    const step = 1000;
    let from = 0;

    while (true) {
        let q = supabase
            .from('atenciones')
            .select(`
                id, fecha_atencion, fecha_hora, diagnostico, cie_10, firma_digital, estado,
                pacientes ( id, dni, nombre, apellido, grado, destino, genero, fecha_nacimiento )
            `)
            .eq('estado', 'ATENDIDO')
            .gte('fecha_atencion', inicioISO)
            .lte('fecha_atencion', finISO)
            .order('fecha_atencion', { ascending: true })
            .range(from, from + step - 1);

        const { data: chunk, error } = await q;
        if (error) {
            console.error('Error consultando atenciones para estadísticas:', error.message);
            break;
        }
        if (!chunk || chunk.length === 0) break;

        chunk.forEach(a => {
            if (!destinoFiltro || destinoFiltro === 'TODOS' || a.pacientes?.destino === destinoFiltro) {
                atenciones.push(a);
            }
        });

        if (chunk.length < step) break;
        from += step;
    }

    return atenciones;
}

// API de Métricas y Datos para Gráficos (Chart.js)
router.get('/datos', async (req, res) => {
    const { inicioISO, finISO, periodoNombre } = resolverPeriodo(req.query);
    const destinoFiltro = req.query.destino && req.query.destino !== 'TODOS' ? req.query.destino.trim() : null;

    const atenciones = await obtenerAtencionesPeriodo(req.supabase, inicioISO, finISO, destinoFiltro);

    // Contadores
    const total = atenciones.length;
    const categorias = { 1: 0, 2: 0, 3: 0, 5: 0 };
    const generos = { Masculino: 0, Femenino: 0 };
    const rangosEdad = { '18-25': 0, '26-35': 0, '36-45': 0, '46-55': 0, '56+': 0 };
    let sumaEdades = 0;
    let edadesValidas = 0;
    let derivaciones = 0;

    const destinosMap = {};
    const diagnosticosMap = {};
    const mesesMap = {};

    atenciones.forEach(a => {
        const p = a.pacientes || {};
        const cat = mapearCategoriaMilitar(p.grado);
        if (categorias[cat] !== undefined) categorias[cat]++;
        else categorias[3]++;

        const gen = p.genero === 'Femenino' ? 'Femenino' : 'Masculino';
        generos[gen]++;

        const fAtencion = a.fecha_atencion || a.fecha_hora;
        const edad = calcularEdad(p.fecha_nacimiento, fAtencion);
        if (edad !== null) {
            sumaEdades += edad;
            edadesValidas++;
            if (edad <= 25) rangosEdad['18-25']++;
            else if (edad <= 35) rangosEdad['26-35']++;
            else if (edad <= 45) rangosEdad['36-45']++;
            else if (edad <= 55) rangosEdad['46-55']++;
            else rangosEdad['56+']++;
        }

        const esDerivado = (a.firma_digital && a.firma_digital.includes('DERIVADO')) ||
                           (a.diagnostico && a.diagnostico.toLowerCase().includes('derivad'));
        if (esDerivado) derivaciones++;

        const dest = (p.destino || 'SIN DESTINO').trim().toUpperCase();
        destinosMap[dest] = (destinosMap[dest] || 0) + 1;

        const cie11 = mapearCIE10aCIE11(a.cie_10 || a.diagnostico);
        diagnosticosMap[cie11] = (diagnosticosMap[cie11] || 0) + 1;

        if (fAtencion) {
            const mesStr = fAtencion.slice(0, 7); // YYYY-MM
            mesesMap[mesStr] = (mesesMap[mesStr] || 0) + 1;
        }
    });

    const topDestinos = Object.entries(destinosMap)
        .map(([nombre, cantidad]) => ({ nombre, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 8);

    const topDiagnosticos = Object.entries(diagnosticosMap)
        .map(([cie, cantidad]) => ({ cie, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 8);

    const mesesLabels = [
        'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
        'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
    ];
    const mesesOrdenados = Object.keys(mesesMap).sort();
    const serieTemporal = mesesOrdenados.map(m => {
        const [yyyy, mm] = m.split('-');
        const idx = parseInt(mm, 10) - 1;
        return {
            label: `${mesesLabels[idx] || mm} ${yyyy}`,
            cantidad: mesesMap[m]
        };
    });

    res.json({
        total,
        periodoNombre,
        categorias,
        generos,
        derivaciones,
        edadPromedio: edadesValidas > 0 ? (sumaEdades / edadesValidas).toFixed(1) : '-',
        rangosEdad,
        topDestinos,
        topDiagnosticos,
        serieTemporal
    });
});

// Vista de Impresión Oficial ESTAMED (HTML imprimible / PDF en A4)
router.get('/estamed/imprimir', async (req, res) => {
    const { inicioISO, finISO, periodoNombre, periodoSlug } = resolverPeriodo(req.query);
    const destinoFiltro = req.query.destino && req.query.destino !== 'TODOS' ? req.query.destino.trim() : null;

    const autoridades = getAutoridadesConfig();
    const atenciones = await obtenerAtencionesPeriodo(req.supabase, inicioISO, finISO, destinoFiltro);

    // Mapeo a las 10 columnas reglamentarias de ESTAMED (¡Sin nombres ni DNI!)
    const filas = atenciones.map(a => {
        const p = a.pacientes || {};
        const fAtencion = a.fecha_atencion || a.fecha_hora;
        const fechaStr = fAtencion ? fAtencion.slice(0, 10) : '-';
        const edad = calcularEdad(p.fecha_nacimiento, fAtencion);
        const cie11 = mapearCIE10aCIE11(a.cie_10 || a.diagnostico);
        const categoria = mapearCategoriaMilitar(p.grado);
        const esDerivado = (a.firma_digital && a.firma_digital.includes('DERIVADO')) ||
                           (a.diagnostico && a.diagnostico.toLowerCase().includes('derivad'));

        return {
            uumm: (p.destino || 'CU GRL').trim().toUpperCase(),
            provincia: autoridades.provincia || 'Buenos Aires',
            ciudad: autoridades.ciudad || 'CABA',
            fecha: fechaStr,
            edad: edad !== null ? edad : '-',
            genero: p.genero || 'Masculino',
            cie11,
            categoria,
            circunstancia: autoridades.circunstancia || '2B',
            derivacion: esDerivado ? 'X' : ''
        };
    });

    // Fechas formateadas para membretes
    const hoy = new Date();
    const mesesES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const fechaEmision = `${hoy.getDate()}${mesesES[hoy.getMonth()].slice(0, 3).charAt(0).toUpperCase() + mesesES[hoy.getMonth()].slice(1, 3)}${String(hoy.getFullYear()).slice(-2)}`;
    const fechaPie = `${hoy.getDate()} de ${mesesES[hoy.getMonth()]} de ${hoy.getFullYear()}`;

    const urlParams = new URLSearchParams(req.query).toString();
    const urlExcel = `/estadisticas/estamed/excel?${urlParams}`;

    res.render('estamed_imprimir', {
        autoridades,
        periodoNombre,
        fechaEmision,
        fechaPie,
        filas,
        urlExcel
    });
});

// Descarga Directa de Planilla Oficial en Excel (.xlsx)
router.get('/estamed/excel', async (req, res) => {
    const { anio, inicioISO, finISO, periodoNombre, periodoSlug } = resolverPeriodo(req.query);
    const destinoFiltro = req.query.destino && req.query.destino !== 'TODOS' ? req.query.destino.trim() : null;

    const autoridades = getAutoridadesConfig();
    const atenciones = await obtenerAtencionesPeriodo(req.supabase, inicioISO, finISO, destinoFiltro);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Compañía Sanidad';
    workbook.created = new Date();

    const ws = workbook.addWorksheet('Hoja1', {
        pageSetup: {
            orientation: 'portrait',
            paperSize: 9 // A4
        }
    });

    // Anchos de columna idénticos a la planilla de referencia
    ws.columns = [
        { width: 14 }, // A: UUMM
        { width: 14 }, // B: Provincia
        { width: 10 }, // C: Ciudad
        { width: 13 }, // D: Fecha
        { width: 12 }, // E: Edad
        { width: 14 }, // F: Genero
        { width: 12 }, // G: CIE-11
        { width: 12 }, // H: Categoria
        { width: 14 }, // I: Circunstancia
        { width: 14 }  // J: Derivacion
    ];

    // Fila 2: Encabezado institucional
    ws.getCell('A2').value = '   Ejército Argentino';
    ws.getCell('A2').font = { name: 'Times New Roman', size: 16, bold: true, italic: true };

    ws.getCell('H2').value = `  “${autoridades.lema_anio}”`;
    ws.getCell('H2').font = { name: 'Times New Roman', size: 11, italic: false };

    // Fila 3: Unidad
    ws.getCell('A3').value = autoridades.nombre_unidad;
    ws.getCell('A3').font = { name: 'Times New Roman', size: 14, bold: true, italic: true };

    // Cuadro reglamentario 1: PUBLICO MILITAR (centrado en filas 2 a 3, columnas D a G)
    ws.mergeCells('D2:G3');
    const cellPub = ws.getCell('D2');
    cellPub.value = 'PUBLICO MILITAR';
    cellPub.font = { name: 'Times New Roman', size: 12, bold: true };
    cellPub.alignment = { horizontal: 'center', vertical: 'middle' };
    cellPub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

    for (let r = 2; r <= 3; r++) {
        for (let c = 4; c <= 7; c++) {
            const cell = ws.getCell(r, c);
            cell.border = {
                top: r === 2 ? { style: 'medium' } : undefined,
                bottom: r === 3 ? { style: 'medium' } : undefined,
                left: c === 4 ? { style: 'medium' } : undefined,
                right: c === 7 ? { style: 'medium' } : undefined
            };
        }
    }

    // Cuadro reglamentario 2: ADVERTENCIA (centrado en filas 5 a 9, columnas C a G)
    ws.mergeCells('D5:G5');
    const cellAdvTitle = ws.getCell('D5');
    cellAdvTitle.value = 'ADVERTENCIA';
    cellAdvTitle.font = { name: 'Times New Roman', size: 10, bold: true };
    cellAdvTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    cellAdvTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

    ws.mergeCells('D6:G9');
    const cellAdvText = ws.getCell('D6');
    cellAdvText.value = 'Este documento es de carácter PUBLICO MILITAR y el conocimiento de su contenido está limitado exclusivamente al personal de la Fuerza, siempre y cuando por orden de la autoridad superior no se dispusiere lo contrario(ROP-11-06 Art. 2.013 Inc e)';
    cellAdvText.font = { name: 'Times New Roman', size: 9 };
    cellAdvText.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cellAdvText.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };

    for (let r = 5; r <= 9; r++) {
        for (let c = 4; c <= 7; c++) {
            const cell = ws.getCell(r, c);
            cell.border = {
                top: r === 5 ? { style: 'medium' } : undefined,
                bottom: r === 9 ? { style: 'medium' } : undefined,
                left: c === 4 ? { style: 'medium' } : undefined,
                right: c === 7 ? { style: 'medium' } : undefined
            };
        }
    }

    // Fila 13: Título Normativo
    ws.mergeCells('A13:J13');
    ws.getCell('A13').value = 'ANEXO 1- (ESTAMED) A LA DIRECTIVA TECNICA DEL DIRECTOR GENERAL DE SALUD NRO 03/23 (Estadísticas Médicas)';
    ws.getCell('A13').font = { name: 'Calibri', size: 10, bold: false };
    ws.getCell('A13').alignment = { horizontal: 'left', vertical: 'middle' };

    // Fila 15: Datos de cabecera
    const hoy = new Date();
    const mesesES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const fechaEmision = `${hoy.getDate()}${mesesES[hoy.getMonth()]}${String(hoy.getFullYear()).slice(-2)}`;

    ws.getCell('A15').value = `Código de Unidad: ${autoridades.codigo_unidad}`;
    ws.getCell('A15').font = { name: 'Times New Roman', size: 9 };

    ws.getCell('E15').value = periodoNombre;
    ws.getCell('E15').font = { name: 'Times New Roman', size: 9 };

    ws.getCell('H15').value = `Fecha: ${fechaEmision}`;
    ws.getCell('H15').font = { name: 'Times New Roman', size: 9 };

    // Filas 16-18: Autoridades
    ws.getCell('A16').value = `Nombre del Jefe de Unidad: ${autoridades.jefe_unidad_nombre}`;
    ws.getCell('A16').font = { name: 'Times New Roman', size: 9 };

    ws.getCell('A17').value = `Nombre del Jefe del Servicio de Sanidad: ${autoridades.jefe_sanidad_nombre}`;
    ws.getCell('A17').font = { name: 'Times New Roman', size: 9 };

    ws.getCell('A18').value = `Nombre del Responsable Directo: ${autoridades.responsable_nombre}`;
    ws.getCell('A18').font = { name: 'Times New Roman', size: 9 };

    // Fila 21: Bloque reglamentario superior a los encabezados (A21:F21)
    ws.mergeCells('A21:F21');
    for (let c = 1; c <= 6; c++) {
        ws.getCell(21, c).border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: c === 1 ? { style: 'thin' } : undefined,
            right: c === 6 ? { style: 'thin' } : undefined
        };
    }
    for (let c = 7; c <= 10; c++) {
        ws.getCell(21, c).border = {
            bottom: { style: 'thin' },
            left: c === 7 ? { style: 'thin' } : undefined
        };
    }

    // Fila 22: Encabezado de la tabla de 10 columnas
    const headers = ['UUMM', 'Provincia', 'Ciudad', 'Fecha', 'Edad', 'Genero', 'CIE-11', 'Categoria', 'Circunstancia', 'Derivacion'];
    headers.forEach((h, idx) => {
        const cell = ws.getCell(22, idx + 1);
        cell.value = h;
        cell.font = { name: 'Times New Roman', size: 11, bold: false };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
        };
    });

    // Filas 23+: Datos (estrictamente anónimos, sin nombres ni DNI)
    let curRow = 23;
    atenciones.forEach(a => {
        const p = a.pacientes || {};
        const fAtencion = a.fecha_atencion || a.fecha_hora;
        const fechaVal = fAtencion ? new Date(fAtencion) : null;
        const edad = calcularEdad(p.fecha_nacimiento, fAtencion);
        const cie11 = mapearCIE10aCIE11(a.cie_10 || a.diagnostico);
        const categoria = mapearCategoriaMilitar(p.grado);
        const esDerivado = (a.firma_digital && a.firma_digital.includes('DERIVADO')) ||
                           (a.diagnostico && a.diagnostico.toLowerCase().includes('derivad'));

        const rowValues = [
            (p.destino || 'CU GRL').trim().toUpperCase(),
            autoridades.provincia || 'Buenos Aires',
            autoridades.ciudad || 'CABA',
            fechaVal,
            edad !== null ? edad : null,
            p.genero || 'Masculino',
            cie11,
            categoria,
            autoridades.circunstancia || '2B',
            esDerivado ? 'X' : null
        ];

        rowValues.forEach((val, idx) => {
            const cell = ws.getCell(curRow, idx + 1);
            cell.value = val;
            const colIdx = idx + 1;
            const isText12 = (colIdx === 2 || colIdx === 3 || colIdx === 4 || colIdx === 9 || colIdx === 10);
            cell.font = { name: 'Times New Roman', size: isText12 ? 12 : 10 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
                top: { style: 'thin' },
                bottom: { style: 'thin' },
                left: { style: 'thin' },
                right: { style: 'thin' }
            };

            if (idx === 3 && val instanceof Date) {
                cell.numFmt = 'dd/mm/yyyy';
            }
        });

        curRow++;
    });

    // Fila vacía tras la tabla
    curRow++;

    // Bloque de cierre con fecha de emisión oficial (ej. D1888:J1888)
    const rowLugar = curRow;
    ws.mergeCells(`D${rowLugar}:J${rowLugar}`);
    const mesCompleto = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][hoy.getMonth()];
    const cellLugar = ws.getCell(`D${rowLugar}`);
    cellLugar.value = `CIUDAD AUTÓNOMA DE BUENOS AIRES,       de ${mesCompleto} de ${hoy.getFullYear()}`;
    cellLugar.font = { name: 'Times New Roman', size: 12 };
    cellLugar.alignment = { horizontal: 'right', vertical: 'middle' };

    // 2 Filas vacías intermedias
    curRow += 3;
    const rowFirmas = curRow;

    // Fila 1 de Firmas (rowFirmas):
    ws.getRow(rowFirmas).height = 27.75;

    // Columna A: Box con "Ca San\nCu Grl"
    const cellA1 = ws.getCell(`A${rowFirmas}`);
    cellA1.value = 'Ca San                     Cu Grl';
    cellA1.font = { name: 'Times New Roman', size: 11 };
    cellA1.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cellA1.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

    // Columna D: FIRMADO (bold, centered)
    const cellD1 = ws.getCell(`D${rowFirmas}`);
    cellD1.value = 'FIRMADO';
    cellD1.font = { name: 'Times New Roman', size: 11, bold: true };
    cellD1.alignment = { horizontal: 'center', vertical: 'middle' };

    // Columna J: FIRMADO (bold, centered)
    const cellJ1 = ws.getCell(`J${rowFirmas}`);
    cellJ1.value = 'FIRMADO';
    cellJ1.font = { name: 'Times New Roman', size: 11, bold: true };
    cellJ1.alignment = { horizontal: 'center', vertical: 'middle' };

    // Fila 2 de Firmas (rowFirmas + 1):
    const cellA2 = ws.getCell(`A${rowFirmas + 1}`);
    cellA2.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

    const cellD2 = ws.getCell(`D${rowFirmas + 1}`);
    cellD2.value = (autoridades.jefe_sanidad_nombre || '').toUpperCase();
    cellD2.font = { name: 'Times New Roman', size: 11, bold: false };
    cellD2.alignment = { horizontal: 'center', vertical: 'middle' };

    const cellJ2 = ws.getCell(`J${rowFirmas + 1}`);
    cellJ2.value = (autoridades.jefe_unidad_nombre || '').toUpperCase();
    cellJ2.font = { name: 'Times New Roman', size: 11, bold: false };
    cellJ2.alignment = { horizontal: 'center', vertical: 'middle' };

    // Fila 3 de Firmas (rowFirmas + 2):
    const cellA3 = ws.getCell(`A${rowFirmas + 2}`);
    cellA3.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

    const cellD3 = ws.getCell(`D${rowFirmas + 2}`);
    cellD3.value = autoridades.jefe_sanidad_cargo;
    cellD3.font = { name: 'Times New Roman', size: 11, bold: false };
    cellD3.alignment = { horizontal: 'center', vertical: 'middle' };

    const cellJ3 = ws.getCell(`J${rowFirmas + 2}`);
    cellJ3.value = autoridades.jefe_unidad_cargo;
    cellJ3.font = { name: 'Times New Roman', size: 11, bold: false };
    cellJ3.alignment = { horizontal: 'center', vertical: 'middle' };

    // Fila 4 de Firmas (caja vacía de Columna A correspondiente al cuadro inferior de 4 casillas):
    const cellA4 = ws.getCell(`A${rowFirmas + 3}`);
    cellA4.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ESTAMED_Anexo1_${periodoSlug}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
});

// Guardar Configuración de Autoridades
router.post('/autoridades', (req, res) => {
    try {
        const {
            codigo_unidad,
            nombre_unidad,
            lema_anio,
            jefe_unidad_nombre,
            jefe_unidad_cargo,
            jefe_sanidad_nombre,
            jefe_sanidad_cargo,
            responsable_nombre,
            provincia,
            ciudad,
            circunstancia
        } = req.body;

        saveAutoridadesConfig({
            codigo_unidad,
            nombre_unidad,
            lema_anio,
            jefe_unidad_nombre,
            jefe_unidad_cargo,
            jefe_sanidad_nombre,
            jefe_sanidad_cargo,
            responsable_nombre,
            provincia,
            ciudad,
            circunstancia
        });

        res.send(`
            <div class="p-3 bg-emerald-100 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-200 text-xs font-semibold text-center">
                Autoridades y datos de unidad actualizados correctamente.
            </div>
        `);
    } catch (e) {
        res.send(`
            <div class="p-3 bg-red-100 dark:bg-red-950/80 border border-red-300 dark:border-red-800 rounded-xl text-red-800 dark:text-red-200 text-xs font-semibold text-center">
                Error al guardar: ${escapar(e.message)}
            </div>
        `);
    }
});

// Formulario Modal para Editar Autoridades
router.get('/autoridades-modal', (req, res) => {
    const a = getAutoridadesConfig();
    res.send(`
        <div class="p-2 sm:p-4">
            <div class="flex justify-between items-center pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                    <h3 class="font-bold text-slate-900 dark:text-slate-100 text-base">Configuración de Autoridades Militares</h3>
                    <p class="text-xs text-slate-500 dark:text-slate-400">Datos institucionales para el membrete y firmas de la planilla ESTAMED (DGS 03/23).</p>
                </div>
                <button onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 text-2xl font-bold">&times;</button>
            </div>

            <div id="msg-autoridades" class="mb-3"></div>

            <form hx-post="/estadisticas/autoridades" hx-target="#msg-autoridades" class="space-y-4">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Código de Unidad</label>
                        <input type="text" name="codigo_unidad" value="${escapar(a.codigo_unidad)}" required class="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Nombre de la Unidad</label>
                        <input type="text" name="nombre_unidad" value="${escapar(a.nombre_unidad)}" required class="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs">
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Lema / Frase Institucional del Año</label>
                    <input type="text" name="lema_anio" value="${escapar(a.lema_anio)}" placeholder="Ej: Año de la Grandeza Argentina" required class="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs">
                </div>

                <div class="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <p class="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Jefe de Unidad</p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Grado y Nombre Completo</label>
                            <input type="text" name="jefe_unidad_nombre" value="${escapar(a.jefe_unidad_nombre)}" required class="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold">
                        </div>
                        <div>
                            <label class="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Cargo para Firma</label>
                            <input type="text" name="jefe_unidad_cargo" value="${escapar(a.jefe_unidad_cargo)}" required class="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs">
                        </div>
                    </div>
                </div>

                <div class="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
                    <p class="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">Jefe del Servicio de Sanidad</p>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Grado y Nombre Completo</label>
                            <input type="text" name="jefe_sanidad_nombre" value="${escapar(a.jefe_sanidad_nombre)}" required class="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold">
                        </div>
                        <div>
                            <label class="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Cargo para Firma</label>
                            <input type="text" name="jefe_sanidad_cargo" value="${escapar(a.jefe_sanidad_cargo)}" required class="w-full p-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-xs">
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Responsable Directo / Encargado de Sanidad</label>
                    <input type="text" name="responsable_nombre" value="${escapar(a.responsable_nombre)}" required class="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-semibold">
                </div>

                <div class="grid grid-cols-3 gap-3">
                    <div>
                        <label class="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Provincia</label>
                        <input type="text" name="provincia" value="${escapar(a.provincia)}" required class="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs">
                    </div>
                    <div>
                        <label class="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Ciudad</label>
                        <input type="text" name="ciudad" value="${escapar(a.ciudad)}" required class="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs">
                    </div>
                    <div>
                        <label class="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Circunstancia</label>
                        <input type="text" name="circunstancia" value="${escapar(a.circunstancia)}" required class="w-full p-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-mono">
                    </div>
                </div>

                <div class="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                    <button type="button" onclick="document.getElementById('modal-atencion').classList.add('hidden')" class="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold hover:bg-slate-300">Cerrar</button>
                    <button type="submit" class="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm">Guardar Autoridades</button>
                </div>
            </form>
        </div>
    `);
});

module.exports = router;
