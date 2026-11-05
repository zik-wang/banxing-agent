// Host-owned policy. Tool arguments and document text cannot change execution limits.
export const isAdaptive = config => config.executionPolicy?.mode === 'adaptive';
export const isPerMessage = config => config.executionPolicy?.mode === 'per_message';
export function applyMessagePolicy(profile){
  if(!profile.continuity?.conversationId||profile.meetingPolicy)return profile;
  profile.executionPolicy={mode:'per_message',maxModelRequests:70};profile.maxRounds=70;profile.maxCalls=null;
  if(profile.continuity){profile.continuity.maxCumulativeModelRequests=null;profile.continuity.maxCumulativeToolAttempts=null;}
  return profile;
}

export function applyAdaptivePolicy(profile) {
  profile.executionPolicy = {mode: 'adaptive'};
  // JSON null is intentional: unlimited, not the legacy default or zero attempts.
  for (const key of ['maxRounds', 'maxCalls', 'maxVisionCalls', 'maxDiscoveryCalls', 'maxDiscoveryStreak', 'maxNoProgress', 'timeoutMs']) profile[key] = null;
  if (profile.continuity) {
    profile.continuity.maxCumulativeModelRequests = null;
    profile.continuity.maxCumulativeToolAttempts = null;
  }
  return profile;
}
