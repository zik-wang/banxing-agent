param([ValidateSet('start','stop','status','pause','resume','enable-startup','disable-startup','accept','reopen')][string]$Action='status',[string]$TaskId)
$ErrorActionPreference='Stop'
$boardRoot=$PSScriptRoot
$nodeExe=(Get-Command node -ErrorAction Stop).Source
if($Action -in @('pause','resume')){& $nodeExe (Join-Path $boardRoot 'control.mjs') $Action;exit $LASTEXITCODE}
$runtimeDir=Join-Path $boardRoot 'runtime'
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$startupFile=Join-Path ([Environment]::GetFolderPath('Startup')) 'CodexLocalProgress.cmd'
if($Action -eq 'enable-startup'){
  $shellExe=(Get-Process -Id $PID).Path
  $startupLine='@start "" /min "'+$shellExe+'" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" start'
  Set-Content -LiteralPath $startupFile -Value $startupLine -Encoding ascii
  Write-Output "已设置当前用户登录时启动（不是登录前系统服务）：$startupFile"
  exit
}
if($Action -eq 'disable-startup'){if(Test-Path -LiteralPath $startupFile){Remove-Item -LiteralPath $startupFile};Write-Output '已移除当前用户登录启动';exit}
if($Action -in @('accept','reopen')){
  if($TaskId -notin @('T1','T2','T3','T4')){throw '请指定 -TaskId T1/T2/T3/T4；accept 仅供用户实际验收后执行'}
  $creds=Get-Content (Join-Path $boardRoot 'data\credentials.json') -Raw | ConvertFrom-Json
  $cfg=Get-Content (Join-Path $boardRoot 'config.json') -Raw | ConvertFrom-Json
  Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($cfg.port)/api/accept" -Headers @{Authorization="Bearer $($creds.admin)"} -ContentType 'application/json' -Body (@{task_id=$TaskId;accepted=($Action -eq 'accept')}|ConvertTo-Json)
  exit
}
foreach($role in @('server','inspector')){
  $pidFile=Join-Path $runtimeDir "$role.pid"
  $proc=$null
  $processId=0
  if(Test-Path -LiteralPath $pidFile){$processId=[int](Get-Content $pidFile);$proc=Get-Process -Id $processId -ErrorAction SilentlyContinue}
  # Validate ownership using a per-instance loopback health check / heartbeat before stopping.
  $owned=$false
  if($processId -gt 0){
    try{
      if($role -eq 'server'){$cfg=Get-Content (Join-Path $boardRoot 'config.json') -Raw|ConvertFrom-Json;$h=Invoke-RestMethod "http://127.0.0.1:$($cfg.port)/health" -TimeoutSec 3;$owned=($h.pid -eq $processId -and $h.service -eq 'local-progress')}
      else{
        $h=Get-Content (Join-Path $boardRoot 'data\inspector.json') -Raw|ConvertFrom-Json
        $heartbeatUtc=if($h.heartbeat_at -is [datetime]){$h.heartbeat_at.ToUniversalTime()}else{[datetimeoffset]::Parse($h.heartbeat_at).UtcDateTime}
        $heartbeatAge=((Get-Date).ToUniversalTime()-$heartbeatUtc).TotalSeconds
        $owned=($h.pid -eq $processId -and $heartbeatAge -ge -5 -and $heartbeatAge -lt 60)
      }
    }catch{}
  }
  if($Action -eq 'stop'){
    if($owned){Stop-Process -Id $processId;Write-Output "$role stopped PID=$processId";Remove-Item -LiteralPath $pidFile}
    elseif($proc){Write-Warning "$role PID 无法核实归属，未终止。请检查 runtime 日志。"}
    else{Write-Output "$role already stopped"}
  }elseif($Action -eq 'start'){
    if($owned){Write-Output "$role already running PID=$processId";continue}
    if($proc){throw "$role 有存活但无法核实的 PID，先检查后清除过期 runtime/$role.pid"}
    $scriptPath=Join-Path $boardRoot "$role.mjs"
    $child=Start-Process -FilePath $nodeExe -ArgumentList @('"'+$scriptPath+'"') -WorkingDirectory $boardRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir "$role.stdout.log") -RedirectStandardError (Join-Path $runtimeDir "$role.stderr.log") -PassThru
    Set-Content -LiteralPath $pidFile -Value $child.Id
    Start-Sleep -Milliseconds 700
    if($child.HasExited){throw "$role 启动失败，检查 runtime/$role.stderr.log"}
    Write-Output "$role started PID=$($child.Id)"
  }else{Write-Output "$role PID=$(if($processId){$processId}else{'-'}), verified_alive=$owned"}
}
if($Action -in @('status','start')){
  $cfg=Get-Content (Join-Path $boardRoot 'config.json') -Raw|ConvertFrom-Json
  Write-Output "看板 http://127.0.0.1:$($cfg.port)/；正式巡检 $($cfg.interval_ms/60000) 分钟"
  if(Test-Path (Join-Path $boardRoot 'data\inspector.json')){Get-Content (Join-Path $boardRoot 'data\inspector.json')}
  Write-Output "日志与汇总：$boardRoot\data\summaries；开机登录启动已启用：$(Test-Path -LiteralPath $startupFile)"
}
