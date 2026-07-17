// Builds an OData @odata.bind reference value for a Dataverse lookup column, e.g. bindRef('cr9cd_games', id) -> "/cr9cd_games(guid)".
export function bindRef(entitySet: string, id: string): string {
  return `/${entitySet}(${id})`;
}

// Escapes a single-quoted OData string literal, e.g. for use inside a contains(...) filter.
export function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}
