# Sistema Hospitalario — Gestión Clínica, Turnos y Analítica (Edición Simulada)

Este proyecto es una réplica sintética y desacoplada de un sistema real de gestión de pacientes y guardias hospitalarias, adaptado como **caso de estudio de Healthtech y Business Intelligence** para Google Cloud Platform (BigQuery, Looker y Vertex AI).

---

## 🛡️ Seguridad, Privacidad y Gobernanza de Datos (Compliance)

* **100% Datos Sintéticos:** Todos los pacientes, números de documento (DNI), médicos y notas clínicas son ficticios y generados por algoritmos reproducibles.
* **Estructura Hospitalaria Estándar y Civil:** Arquitectura abierta orientada a centros de salud modernos (Especialidades médicas, Servicios de Guardia/Consultorios, Obras Sociales y Coberturas de Salud).
* **Códigos Médicos Estándar:** Utiliza la codificación diagnóstica oficial **CIE-10 (Clasificación Internacional de Enfermedades de la OMS)**.

---

## 🏥 Arquitectura del Sistema

```
[ Aplicación Web Local (Node.js + Express + EJS + HTMX) ]
                     │  (Puerto: 3001)
                     ▼
[ Base de Datos SQLite Local: data/hospital.db ]
   ├── usuarios (Personal médico, especialidades, administración)
   ├── pacientes (Identificadores, demografía, coberturas médicas)
   ├── atenciones (Consultas médicas, tiempos de espera, diagnósticos CIE-10)
   └── diagnosticos_cie10 (Catálogo CIE-10 oficial)
                     │
                     ▼
[ Motor Analítico Local (DuckDB / Python: run_query_hospital.py) ]
                     │
                     ▼
[ Próximo Paso (Proyecto 3): Modelo Dimensional en BigQuery + Looker ]
```

---

## 🚀 Cómo Iniciar el Sistema en tu Máquina

### 1. Iniciar con un solo clic (Windows):
Haz doble clic sobre el archivo:
📁 **`iniciar_sistema.bat`**

Esto abrirá automáticamente tu navegador en **`http://localhost:3001`** con el servidor en marcha.

### 2. O desde la terminal:
```bash
cd "D:\SQL Cursos\sistema-hospitalario"
node server.js
```

---

## 🔑 Credenciales Rápidas de Acceso (Simulación)

En la pantalla de login (`http://localhost:3001`) dispones de botones de acceso rápido o puedes ingresar manualmente:

| Rol | Correo Electrónico | Contraseña | Permisos |
| :--- | :--- | :--- | :--- |
| **Administrador** | `admin@hospital.com` | `admin123` | Gestión global, estadísticas y usuarios. |
| **Médico (Cardiología)** | `dr.mendez@hospital.com` | `medico123` | Sala de espera médica en vivo, atención y diagnóstico. |
| **Recepción / Admisión** | `recepcion@hospital.com` | `recepcion123` | Búsqueda de pacientes, admisión y asignación de turnos. |

---

## 📊 Cómo Ejecutar Consultas SQL Analíticas

Puedes consultar la base de datos clínica directamente desde tu terminal ejecutando:

```bash
# Ver los 5 diagnósticos más frecuentes
python run_query_hospital.py "SELECT cie_10, diagnostico, COUNT(*) AS total FROM atenciones WHERE estado = 'ATENDIDO' GROUP BY cie_10, diagnostico ORDER BY total DESC LIMIT 5;"

# Promedio de tiempo de espera por médico
python run_query_hospital.py "SELECT u.nombre AS medico, u.especialidad, ROUND(AVG(a.tiempo_espera_minutos), 1) AS espera_prom_min FROM atenciones a JOIN usuarios u ON a.medico_id = u.id GROUP BY u.nombre, u.especialidad ORDER BY espera_prom_min DESC;"
```

---

## 🔄 Regenerar Datos Sintéticos

Si deseas reiniciar la base de datos con un nuevo lote aleatorio:
```bash
node scripts/seed_hospital.js
```
