import path from 'node:path';

// Display names can contain time ranges, punctuation and user text. Never use
// them as storage paths. The immutable asset ID and parser format own the path.
export function assetStoragePath(directory, asset) {
 if(!/^[a-zA-Z0-9_-]{1,160}$/.test(asset.id||''))throw Object.assign(Error('Invalid stored asset ID'),{code:'INVALID_STORED_ASSET_ID'});
 const format=String(asset.format||'').toLowerCase();
 const named=path.extname(String(asset.name||'')).toLowerCase();
 const extension=/^[a-z0-9]{1,12}$/.test(format)?'.'+format:/^\.[a-z0-9]{1,12}$/.test(named)?named:'.bin';
 return path.join(directory,'assets',asset.id+extension);
}
