"""
Ejecutor de Consultas SQL Analíticas - Sistema Hospitalario.
Permite consultar la base de datos clínica (data/hospital.db) con sintaxis SQL estándar / GoogleSQL.

Uso:
    python run_query_hospital.py "SELECT * FROM atenciones LIMIT 5;"
    python run_query_hospital.py "SELECT cie_10, COUNT(*) AS casos FROM atenciones WHERE estado = 'ATENDIDO' GROUP BY cie_10 ORDER BY casos DESC;"
"""
import sys
import os
import time
import duckdb
from tabulate import tabulate

if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "hospital.db")

def execute_sql(sql_statement, con):
    sql_clean = sql_statement.strip()
    if not sql_clean:
        return
    
    print("\n" + "=" * 75)
    print(f"CONSULTA SQL CLÍNICA:\n{sql_clean}")
    print("=" * 75)
    
    start_time = time.time()
    try:
        result = con.execute(sql_clean)
        if result.description:
            columns = [col[0] for col in result.description]
            rows = result.fetchall()
            elapsed = time.time() - start_time
            
            if rows:
                print(tabulate(rows, headers=columns, tablefmt="psql"))
            else:
                print("(0 filas retornadas)")
            print(f"-> Registros: {len(rows)} | Tiempo: {elapsed*1000:.2f} ms\n")
        else:
            elapsed = time.time() - start_time
            print(f"-> OK. Ejecutado en {elapsed*1000:.2f} ms\n")
    except Exception as e:
        print(f"\n[ERROR EN SQL]: {e}\n")

def main():
    if len(sys.argv) < 2:
        print("Uso:")
        print('  python run_query_hospital.py "SELECT * FROM pacientes LIMIT 5;"')
        print('  python run_query_hospital.py "SELECT especialidad, COUNT(*) FROM usuarios WHERE rol = \'MEDICO\' GROUP BY especialidad;"')
        sys.exit(1)

    if not os.path.exists(DB_PATH):
        print(f"[!] Base de datos no encontrada en: {DB_PATH}")
        sys.exit(1)

    con = duckdb.connect()
    # Conectar y adjuntar SQLite a DuckDB para consultas SQL analíticas de alto rendimiento
    con.execute(f"ATTACH '{DB_PATH}' AS hospital (TYPE SQLITE);")
    con.execute("USE hospital;")

    query = " ".join(sys.argv[1:])
    execute_sql(query, con)
    con.close()

if __name__ == "__main__":
    main()
