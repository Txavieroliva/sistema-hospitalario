const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'autoridades.json');

const DEFAULT_AUTORIDADES = {
    codigo_unidad: 'U20004',
    nombre_unidad: 'Cuartel General- EMGE',
    lema_anio: 'Año de la Grandeza Argentina',
    jefe_unidad_nombre: 'CR C JUAN MIGUEL ALBORNOZ',
    jefe_unidad_cargo: 'J Cu Grl EMGE',
    jefe_sanidad_nombre: 'TC Med Diego CORDERO',
    jefe_sanidad_cargo: 'J Ca San-Cu Grl EMGE',
    responsable_nombre: 'SG Enf Grl Gustavo Joel CRUZ',
    provincia: 'Buenos Aires',
    ciudad: 'CABA',
    circunstancia: '2B'
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
 * Mapea la jerarquía militar del paciente a la Categoría oficial de la Directiva Técnica 03/23:
 * 1: Oficiales (Subteniente hasta Teniente General)
 * 2: Suboficiales (Cabo hasta Suboficial Mayor)
 * 3: Soldados Voluntarios (SV)
 * 4: Cadetes / Aspirantes
 * 5: Agentes Civiles / Personal Civil (AC)
 */
function mapearCategoriaMilitar(grado) {
    if (!grado) return 3;
    const g = String(grado).trim().toUpperCase();

    // Oficiales (1)
    const oficiales = [
        'SUBTENIENTE', 'TENIENTE', 'TENIENTE PRIMERO', 'CAPITAN', 'CAPITÁN',
        'MAYOR', 'TENIENTE CORONEL', 'CORONEL', 'GENERAL DE BRIGADA',
        'GENERAL DE DIVISION', 'GENERAL DE DIVISIÓN', 'TENIENTE GENERAL',
        'GENERAL', 'OFICIAL', 'ST', 'TT', 'TP', 'CAP', 'MY', 'TC', 'CR', 'GB', 'GD', 'TG'
    ];
    if (oficiales.some(o => g === o || g.startsWith(o + ' ') || g.endsWith(' ' + o))) {
        return 1;
    }

    // Suboficiales (2)
    const suboficiales = [
        'CABO', 'CABO PRIMERO', 'SARGENTO', 'SARGENTO PRIMERO',
        'SARGENTO AYUDANTE', 'SUBOFICIAL PRINCIPAL', 'SUBOFICIAL MAYOR',
        'SUBOFICIAL', 'SUBOFICAL', 'CB', 'CI', 'SG', 'SI', 'SA', 'SP', 'SM'
    ];
    if (suboficiales.some(s => g === s || g.startsWith(s + ' ') || g.endsWith(' ' + s))) {
        return 2;
    }

    // Agentes Civiles / Personal Civil (5)
    const civiles = ['AC', 'AGENTE CIVIL', 'PERSONAL CIVIL', 'DOCENTE CIVIL', 'CIVIL'];
    if (civiles.some(c => g === c || g.startsWith(c + ' ') || g.endsWith(' ' + c))) {
        return 5;
    }

    // Cadetes / Aspirantes (4)
    const cadetes = ['CADETE', 'ASPIRANTE', 'CAD', 'ASP'];
    if (cadetes.some(c => g === c || g.startsWith(c + ' '))) {
        return 4;
    }

    // Soldados Voluntarios (3)
    const soldados = ['SV', 'SOLDADO', 'VOLUNTARIO', 'SOLDADO VOLUNTARIO'];
    if (soldados.some(s => g === s || g.startsWith(s + ' ') || g.includes('SV'))) {
        return 3;
    }

    return 3;
}

/**
 * Diccionario de equivalencias epidemiológicas de CIE-10 (utilizado por el médico en guardia)
 * hacia CIE-11 (exigido por la DGS en la Directiva Técnica 03/23).
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
    mapearCategoriaMilitar,
    mapearCIE10aCIE11,
    calcularEdad
};
