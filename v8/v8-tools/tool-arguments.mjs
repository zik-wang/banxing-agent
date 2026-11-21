// Repair unambiguous provider serialization errors before normal validation.
export function normalizeToolArguments(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {arguments: args, changes: []};
  const changes = [];
  let normalized = args;
  for (const [field, definition] of Object.entries(schema?.properties || {})) {
    const value = args[field];
    if (typeof value !== 'string') continue;

    let parsed;
    if (definition.type === 'array' && value.trim().startsWith('[')) {
      try { parsed = JSON.parse(value); } catch { continue; }
      if (!Array.isArray(parsed)) continue;
    } else if (definition.type === 'integer') {
      parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || String(parsed) !== value) continue;
    } else {
      continue;
    }

    if (normalized === args) normalized = {...args};
    normalized[field] = parsed;
    changes.push({field, from: 'json_string', to: definition.type});
  }
  return {arguments: normalized, changes};
}
