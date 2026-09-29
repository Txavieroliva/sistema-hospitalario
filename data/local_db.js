/**
 * Local SQLite Database Client & Query Builder
 * Replaces Supabase with a 100% local, offline SQLite engine for "Sistema Hospitalario".
 * Powered by Node.js built-in 'node:sqlite' (DatabaseSync).
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'hospital.db');

class LocalDatabase {
    constructor() {
        this.db = new DatabaseSync(DB_PATH);
        this.initSchema();
    }

    initSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS usuarios (
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

            CREATE TABLE IF NOT EXISTS pacientes (
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

            CREATE TABLE IF NOT EXISTS atenciones (
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
                FOREIGN KEY (medico_id) REFERENCES usuarios(id)
            );

            CREATE TABLE IF NOT EXISTS diagnosticos_cie10 (
                codigo TEXT PRIMARY KEY,
                descripcion TEXT NOT NULL,
                capitulo TEXT
            );
        `);
    }

    from(table) {
        return new QueryBuilder(this.db, table);
    }

    get auth() {
        const self = this;
        return {
            async signInWithPassword({ email, password }) {
                try {
                    const stmt = self.db.prepare('SELECT * FROM usuarios WHERE LOWER(email) = LOWER(?)');
                    const user = stmt.get(email);
                    if (!user) {
                        return { data: null, error: { message: 'Usuario no encontrado' } };
                    }
                    if (user.password !== password) {
                        return { data: null, error: { message: 'Contraseña incorrecta' } };
                    }
                    return { data: { user: { id: user.id, email: user.email } }, error: null };
                } catch (e) {
                    return { data: null, error: e };
                }
            },
            async signOut() {
                return { error: null };
            }
        };
    }
}

class QueryBuilder {
    constructor(db, table) {
        this.db = db;
        this.table = table;
        this.type = 'select';
        this.columns = '*';
        this.conditions = [];
        this.params = [];
        this.orderBy = [];
        this.limitVal = null;
        this.offsetVal = null;
        this.insertData = null;
        this.updateData = null;
    }

    select(cols = '*') {
        this.type = 'select';
        this.columns = cols;
        return this;
    }

    insert(data) {
        this.type = 'insert';
        this.insertData = Array.isArray(data) ? data : [data];
        return this;
    }

    update(data) {
        this.type = 'update';
        this.updateData = data;
        return this;
    }

    delete() {
        this.type = 'delete';
        return this;
    }

    eq(column, value) {
        this.conditions.push(`"${column}" = ?`);
        this.params.push(value);
        return this;
    }

    neq(column, value) {
        this.conditions.push(`"${column}" != ?`);
        this.params.push(value);
        return this;
    }

    gte(column, value) {
        this.conditions.push(`"${column}" >= ?`);
        this.params.push(value);
        return this;
    }

    lte(column, value) {
        this.conditions.push(`"${column}" <= ?`);
        this.params.push(value);
        return this;
    }

    in(column, values) {
        if (!values || values.length === 0) {
            this.conditions.push("1=0");
            return this;
        }
        const placeholders = values.map(() => '?').join(',');
        this.conditions.push(`"${column}" IN (${placeholders})`);
        this.params.push(...values);
        return this;
    }

    or(orExpression) {
        // Simple support for Supabase style: "col1.ilike.%val%,col2.ilike.%val%"
        const parts = orExpression.split(',');
        const sqlParts = [];
        parts.forEach(part => {
            const [col, op, val] = part.split('.');
            if (op === 'ilike' || op === 'like') {
                const cleanVal = val.replace(/%/g, '');
                sqlParts.push(`"${col}" LIKE ?`);
                this.params.push(`%${cleanVal}%`);
            } else if (op === 'eq') {
                sqlParts.push(`"${col}" = ?`);
                this.params.push(val);
            }
        });
        if (sqlParts.length > 0) {
            this.conditions.push(`(${sqlParts.join(' OR ')})`);
        }
        return this;
    }

    order(column, { ascending = true } = {}) {
        this.orderBy.push(`"${column}" ${ascending ? 'ASC' : 'DESC'}`);
        return this;
    }

    limit(num) {
        this.limitVal = num;
        return this;
    }

    range(from, to) {
        this.offsetVal = from;
        this.limitVal = (to - from) + 1;
        return this;
    }

    single() {
        this.isSingle = true;
        this.limitVal = 1;
        return this;
    }

    // Execute when awaited as Promise
    async then(resolve, reject) {
        try {
            const result = this.execute();
            resolve(result);
        } catch (err) {
            resolve({ data: null, error: err });
        }
    }

    execute() {
        if (this.type === 'select') {
            let sql = `SELECT * FROM "${this.table}"`;
            if (this.conditions.length > 0) {
                sql += ` WHERE ${this.conditions.join(' AND ')}`;
            }
            if (this.orderBy.length > 0) {
                sql += ` ORDER BY ${this.orderBy.join(', ')}`;
            }
            if (this.limitVal !== null) {
                sql += ` LIMIT ${this.limitVal}`;
            }
            if (this.offsetVal !== null) {
                sql += ` OFFSET ${this.offsetVal}`;
            }

            const stmt = this.db.prepare(sql);
            let rows = stmt.all(...this.params);

            // Populación de relaciones si la consulta es sobre atenciones
            if (this.table === 'atenciones') {
                const pacStmt = this.db.prepare('SELECT * FROM pacientes WHERE id = ?');
                const medStmt = this.db.prepare('SELECT id, nombre, email, rol, matricula, especialidad, grado FROM usuarios WHERE id = ?');

                rows = rows.map(row => {
                    const pac = pacStmt.get(row.paciente_id) || null;
                    const med = medStmt.get(row.medico_id) || null;
                    return {
                        ...row,
                        pacientes: pac,
                        usuarios: med
                    };
                });
            }

            if (this.isSingle) {
                return { data: rows[0] || null, error: null };
            }
            return { data: rows, error: null };
        }

        if (this.type === 'insert') {
            const inserted = [];
            for (const item of this.insertData) {
                const keys = Object.keys(item);
                const cols = keys.map(k => `"${k}"`).join(', ');
                const placeholders = keys.map(() => '?').join(', ');
                const values = keys.map(k => item[k]);

                const sql = `INSERT INTO "${this.table}" (${cols}) VALUES (${placeholders})`;
                const stmt = this.db.prepare(sql);
                const info = stmt.run(...values);
                inserted.push({ id: info.lastInsertRowid, ...item });
            }
            return { data: inserted, error: null };
        }

        if (this.type === 'update') {
            const keys = Object.keys(this.updateData);
            const setClause = keys.map(k => `"${k}" = ?`).join(', ');
            const values = keys.map(k => this.updateData[k]);

            let sql = `UPDATE "${this.table}" SET ${setClause}`;
            if (this.conditions.length > 0) {
                sql += ` WHERE ${this.conditions.join(' AND ')}`;
            }
            const stmt = this.db.prepare(sql);
            stmt.run(...values, ...this.params);
            return { data: this.updateData, error: null };
        }

        if (this.type === 'delete') {
            let sql = `DELETE FROM "${this.table}"`;
            if (this.conditions.length > 0) {
                sql += ` WHERE ${this.conditions.join(' AND ')}`;
            }
            const stmt = this.db.prepare(sql);
            stmt.run(...this.params);
            return { data: null, error: null };
        }

        return { data: null, error: new Error('Operación no soportada') };
    }
}

const localDbInstance = new LocalDatabase();

module.exports = {
    localDbInstance,
    createLocalSupabaseClient: () => localDbInstance
};
