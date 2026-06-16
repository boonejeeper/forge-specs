/**
 * SQL export for the ERD model. Delegates to @dbml/core's exporter, which
 * round-trips DBML → a target SQL dialect. Kept separate from the pure
 * erd-model transforms so the model code stays dependency-light; this module is
 * the only place that touches @dbml/core at runtime.
 *
 * The ERD designer's "Export SQL" action serializes its table model to DBML
 * (generateDbml) and then hands the DBML here.
 */
import { exporter } from "@dbml/core";

export type SqlDialect = "postgres" | "mysql" | "mssql" | "oracle";

/** Generate SQL DDL for a DBML source string in the given dialect. */
export function dbmlToSql(dbml: string, dialect: SqlDialect = "postgres"): string {
  return exporter.export(dbml, dialect);
}
