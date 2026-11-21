import {ToolError} from './harness.mjs';

// A workspace resource ID and a run-local asset ID are different namespaces.
// Resolve only aliases already imported in this run. Never search, import, or
// select a newer workspace revision as a side effect of citing a source.
export function resolveSourceIds(docs, ids = []) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id)) {
    throw new ToolError('INVALID_ARGUMENT', 'source_ids must contain nonempty IDs returned by tools');
  }
  const resolved = [];
  for (const id of ids) {
    let assetId = id;
    if (!docs.assets.has(id)) {
      const candidates = [...docs.assets.values()].filter(a => a.resourceRef?.resourceId === id && a.resourceRef?.revisionId);
      if (candidates.length > 1) {
        throw new ToolError('AMBIGUOUS_SOURCE_ID', 'This resource has multiple imported assets or revisions; use the exact asset ID returned by inspect_material.', {
          requestedId: id,
          candidates: candidates.map(a => ({assetId:a.id, revisionId:a.resourceRef.revisionId, name:a.name})),
          next_action: 'Choose the intended imported revision; do not omit source_ids to hide the ambiguity'
        });
      }
      if (candidates.length === 1) assetId = candidates[0].id;
    }
    // This remains the existing hash and current authorization check. An unknown
    // ID is not silently ignored, and no source body or disk path is guessed.
    const asset = docs.asset(assetId);
    if (!resolved.some(s => s.id === asset.id)) resolved.push({id:asset.id, sha256:asset.sha256});
  }
  return resolved;
}
