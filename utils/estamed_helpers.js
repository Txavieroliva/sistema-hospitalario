const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'autoridades.json');

const DEFAULT_AUTORIDADES = {
    codigo_unidad: 'HOSP-01',
    nombre_unidad: 'Hospital Central de Agudos',
    lema_anio: 'Excelencia Médica y Compromiso Asistencial',
    jefe_unidad_nombre: 'Dr. Alberto Fernández Rivas',
    jefe_unidad_cargo: 'Director Médico General',
    jefe_sanidad_nombre: 'Dra. Carolina Martínez',
    jefe_sanidad_cargo: 'Jefa de Servicios Médicos y Admisión',
    responsable_nombre: 'Lic. Esteban Morales',
    provincia: 'Buenos Aires',
    ciudad: 'CABA',
    circunstancia: 'Servicio General'
};

function getAutoridadesConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            const dir = path.dirname(CONFIG_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_AUTORIDADES, null, 2), 'utf-8');
            return { ...DEFAULT_AUTORIDADES };
        }
        const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return { ...DEFAULT_AUTORIDADES, ...JSON.parse(data) };
    } catch (e) {
        console.error('Error leyendo config autoridades:', e);
        return { ...DEFAULT_AUTORIDADES };
    }
}

function saveAutoridadesConfig(newConfig) {
    try {
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const current = getAutoridadesConfig();
        const merged = { ...current, ...newConfig };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
        return merged;
    } catch (e) {
        console.error('Error guardando config autoridades:', e);
        throw e;
    }
}

/**
 * Mapea la cobertura médica / obra social del paciente a categorías hospitalarias:
 * 1: Prepagas / Privados (OSDE, Swiss Medical, Galeno, Medifé)
 * 2: Obras Sociales (IOMA, OSECAC, etc.)
 * 3: PAMI / Adultos Mayores
 * 4: Derivación / Interconsulta
 * 5: Particular / Sin Cobertura
 */
function mapearCategoriaCobertura(gradoOrCobertura) {
    if (!gradoOrCobertura) return 1;
    const g = String(gradoOrCobertura).trim().toUpperCase();

    // Prepagas (1)
    if (g.includes('OSDE') || g.includes('SWISS') || g.includes('GALENO') || g.includes('MEDIFE') || g.includes('PREPAGA')) {
        return 1;
    }
    // Obras Sociales (2)
    if (g.includes('IOMA') || g.includes('OSECAC') || g.includes('OBRA') || g.includes('SINDICAL')) {
        return 2;
    }
    // PAMI (3)
    if (g.includes('PAMI') || g.includes('JUBILADO')) {
        return 3;
    }
    // Particular (5)
    if (g.includes('PARTICULAR') || g.includes('CIVIL') || g.includes('SIN COBERTURA')) {
        return 5;
    }

    return 1;
}

/**
 * Diccionario de equivalencias epidemiológicas de CIE-10 a CIE-11 (Estándar OMS).
 */
const DICCIONARIO_CIE10_A_CIE11 = {
    // Respiratorio
    'J00': 'CA02',   // Rinofaringitis aguda (Resfriado común)
    'J01': 'CA01',   // Sinusitis aguda
    'J02': 'CA00',   // Faringitis aguda
    'J03': 'CA01',   // Amigdalitis aguda
    'J04': 'CA05',   // Laringitis aguda y traqueítis
    'J06': 'CA03',   // Infección respiratoria alta aguda no especificada
    'J10': 'CA41',   // Influenza / Gripe debida a virus de la influenza identificado
    'J11': 'CA41',   // Influenza / Gripe debida a virus no identificado
    'J18': 'CA40',   // Neumonía no especificada
    'J20': 'CA20',   // Bronquitis aguda
    'J40': 'CA20',   // Bronquitis no especificada
    'J45': 'CA23',   // Asma

    // Digestivo
    'A09': '1A94',   // Gastroenteritis infecciosa y colitis de origen no especificado
    'K29': 'DA42',   // Gastritis y duodenitis
    'K30': 'DB7Y',   // Dispepsia / Trastornos digestivos funcionales
    'K52': '1A94',   // Otras gastroenteritis y colitis no infecciosas
    'K59': 'DB33.Y', // Trastornos funcionales del intestino / Diarrea funcional

    // Signos y síntomas generales
    'R10': 'ME84.Z', // Dolor abdominal y pélvico
    'R50': 'MD81',   // Fiebre de origen desconocido / Fiebre
    'R51': '8B88',   // Cefalea / Dolor de cabeza
    'G43': '8B80',   // Migraña
    'G44': '8B88',   // Otros síndromes de cefalea
    'R07': 'MD30',   // Dolor de garganta y en el pecho

    // Cardiovascular
    'I10': 'BA00',   // Hipertensión esencial (primaria)
    'I11': 'BA01',   // Enfermedad cardíaca hipertensiva
    'I47': 'BC70',   // Taquicardia paroxística

    // Músculo-esquelético
    'M54': 'ME84',   // Dorsalgia / Lumbalgia
    'M79': 'FB3Z',   // Otras afecciones no articulares / Mialgia
    'M25': 'FA20',   // Otros trastornos articulares / Artralgia

    // Traumatismos y causas externas
    'T07': 'ND56',   // Traumatismos múltiples no especificados
    'T14': 'ND5Y',   // Traumatismo de región no especificada del cuerpo
    'S93': 'NC93',   // Luxación, esguince y torcedura de articulaciones del tobillo
    'S63': 'NC33',   // Luxación, esguince y torcedura de articulaciones de la muñeca
    'S83': 'NC72',   // Luxación, esguince y torcedura de la rodilla
    'S43': 'NC12',   // Luxación, esguince y torcedura de articulaciones del hombro
    'S60': 'NC30',   // Traumatismo superficial de muñeca y de la mano
    'T20': 'NE84',   // Quemadura y corrosión
    'T30': 'NE84',   // Quemadura de región no especificada
    'W57': 'PA20',   // Picadura o mordedura de insectos

    // Piel y faneras
    'L03': 'EA90',   // Celulitis
    'L20': 'EA80',   // Dermatitis atópica
    'L30': 'EA80',   // Otras dermatitis
    'L50': 'EB00',   // Urticaria

    // Oftalmología y Otorrino
    'H00': '9A40',   // Orzuelo y calacio
    'H10': '9A60',   // Conjuntivitis
    'H33': '9B73',   // Desprendimiento y desgarro de retina
    'H60': 'AA3Z',   // Otitis externa
    'H65': 'AA3Z',   // Otitis media no supurativa
    'H66': 'AA3Z',   // Otitis media supurativa

    // Genitourinario
    'N39': 'GA00',   // Otros trastornos del sistema urinario / Infección urinaria
    'R30': 'GA00',   // Dolor asociado con la micción

    // Salud mental
    'F41': '6B00',   // Otros trastornos de ansiedad
    'G47': '7A00',   // Trastornos del sueño / Insomnio

    // Consultas generales y exámenes
    'Z00': 'QA21',   // Examen médico general / Consulta de rutina
    'Z02': 'QA20',   // Examen para aptitud física / Ingreso
    'Z09': 'QA1C',   // Examen de seguimiento después de tratamiento
    'Z23': 'QC00'    // Necesidad de inmunización / Vacunación
};

/**
 * Traduce un código CIE-10 (o texto diagnóstico que comience con código) a CIE-11.
 */
function mapearCIE10aCIE11(input) {
    if (!input) return 'QA21';
    const trimmed = String(input).trim().toUpperCase();

    // Extraer código (ej: de "J00 RINOFARINGITIS" -> "J00", o "J00.9" -> "J00")
    const match = trimmed.match(/^([A-Z][0-9]{2})/);
    if (match) {
        const base = match[1];
        if (DICCIONARIO_CIE10_A_CIE11[base]) {
            return DICCIONARIO_CIE10_A_CIE11[base];
        }
    }

    // Si ya viene como código CIE-11 (ej: "CA00", "8B88", "QA21", "ME84.Z", "DB7Y")
    if (/^[0-9A-Z]{3,7}(\.[0-9A-Z]{1,2})?$/.test(trimmed)) {
        return trimmed;
    }

    return trimmed.split(' ')[0] || 'QA21';
}

/**
 * Calcula la edad en años enteros a partir de la fecha de nacimiento.
 */
function calcularEdad(fechaNacimiento, fechaAtencion) {
    if (!fechaNacimiento) return null;
    const fNac = new Date(fechaNacimiento);
    if (isNaN(fNac.getTime())) return null;

    const fRef = fechaAtencion ? new Date(fechaAtencion) : new Date();
    let edad = fRef.getFullYear() - fNac.getFullYear();
    const m = fRef.getMonth() - fNac.getMonth();
    if (m < 0 || (m === 0 && fRef.getDate() < fNac.getDate())) {
        edad--;
    }
    return edad >= 0 && edad <= 120 ? edad : null;
}

module.exports = {
    getAutoridadesConfig,
    saveAutoridadesConfig,
    mapearCategoriaCobertura,
    mapearCIE10aCIE11,
    calcularEdad
};
