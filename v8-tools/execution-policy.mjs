// Host-owned policy. Tool arguments and document text cannot change execution limits.
export const isAdaptive = config => config.executionPolicy?.mode === 'adaptive';

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
