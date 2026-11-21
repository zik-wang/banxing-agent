export type UnitStatus='pending'|'running'|'extracted'|'reviewed'|'needs_recovery'|'failed'|'blocked';
export type StageName='extract'|'audit';
export interface UnitStage {
 status:'pending'|'running'|'done'|'needs_recovery'|'failed'|'blocked';
 attemptCount:number;lastError:{code:string;message:string}|null;lastRunId:string|null;
 candidateIds:string[];verificationIds:string[];
}
export interface UnitRecoveryState {
 sourceUnitId:string;inputHash:string;promptVersion:Partial<Record<StageName,string>>;
 modelConfigFingerprint:string;attemptCount:number;lastError:{code:string;message:string}|null;
 lastRunId:string|null;candidateIds:string[];verificationIds:string[];updatedAt:string;
 status:UnitStatus;stages:Partial<Record<StageName,UnitStage>>;
}
export interface InferenceProfile {
 version:string;provider:'cloud'|'intranet'|'unknown'|string;model_id:string;endpoint:string|null;
 quantization:string|'unknown';inference_backend:string|'unknown';chat_template:string|'unknown';
 analysis_mode:'structured-json'|'native-tools';temperature:number;top_p:null;
 max_output_tokens:number;context_budget_tokens:number;timeout_ms:number;
 output_constraint:'prompt-json-and-strict-parser';input_projection:'unit-text-once-v1'|'legacy-duplicate-text';
 parameter_support:Record<string,string>;retry_transport:0;
}
export interface RecoveryCheckpoint<Payload> {
 version:'v7-p2-recovery-1'|'v7-p2-recovery-2'|'v7-p2-recovery-3';taskId:string;rootTaskId:string;
 parent:{taskId:string;checkpointSha256:string|null}|null;round:number;
 identity:{scopeHash:string;unitsHash:string;modelConfigFingerprint:string;promptVersions:Partial<Record<StageName,string>>};
 units:UnitRecoveryState[];counters:{roundAnalysis:number;roundRequests:number;cumulativeAnalysis:number;cumulativeRequests:number;cumulativeWallMs:number};
 counts:Partial<Record<StageName,number>>;remaining:Partial<Record<StageName,string[]>>;
 stopReason:'source_disposition_complete'|'cumulative_budget_exhausted'|'blocked_or_attempts_exhausted'|'round_budget_exhausted'|'remaining_targets'|'running'|'window_reserved_for_delivery';
 payload:Payload;lineage:{taskId:string;checkpointSha256:string|null;legacy?:boolean}[];at:string;
}
export interface ReferenceFact {
 reference_item_id:string;source_file:string;
 source_location:{page?:number|null;start:number;end:number;unit_id?:string|null};
 expected_fact:string;subject:string;relation:string;object:unknown;
 condition:string[];exception:string[];scope?:string|null;change_type:string|null;
 risk_level:'critical'|'high'|'normal';
}
