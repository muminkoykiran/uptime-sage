// Validator for the keyword subset used by analysis-schema.json.
export function matchesSchema(value, schema) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (schema.required?.some(key => !Object.hasOwn(value, key))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties, key))) return false;
    return Object.entries(value).every(([key, item]) => !schema.properties?.[key] || matchesSchema(item, schema.properties[key]));
  }
  if (schema.type === 'array') return Array.isArray(value) && value.every(item => matchesSchema(item, schema.items));
  if (schema.type === 'string') return typeof value === 'string' && (schema.maxLength === undefined || [...value].length <= schema.maxLength);
  if (schema.type === 'integer') return Number.isInteger(value) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  return false;
}
