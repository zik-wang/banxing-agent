$ErrorActionPreference = 'Stop'
$file = $env:BANXING_LOCAL_FILE
$action = $env:BANXING_LOCAL_ACTION
if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'LOCAL_FILE_MISSING' }
$stream = [IO.File]::OpenRead($file)
$hasher = [Security.Cryptography.SHA256]::Create()
try { $actualHash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
finally { $stream.Dispose(); $hasher.Dispose() }
if ($actualHash -ne $env:BANXING_LOCAL_SHA256) { throw 'LOCAL_FILE_CHANGED' }
if ($action -eq 'open') {
 $allowed = @('.xlsx','.docx','.pdf','.txt','.md','.json','.csv','.tsv','.srt','.png','.jpg','.jpeg','.webp','.gif','.bmp','.mp3','.wav','.m4a','.mp4')
 if ([IO.Path]::GetExtension($file).ToLowerInvariant() -notin $allowed) { throw 'LOCAL_FILE_REVEAL_ONLY' }
 $info = New-Object System.Diagnostics.ProcessStartInfo
 $info.FileName = $file
 $info.UseShellExecute = $true
 $info.Verb = 'open'
 [void][System.Diagnostics.Process]::Start($info)
} elseif ($action -eq 'reveal') {
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BanxingLocalShell {
 [DllImport("ole32.dll")] public static extern int CoInitializeEx(IntPtr reserved, uint flags);
 [DllImport("ole32.dll")] public static extern void CoUninitialize();
 [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern int SHParseDisplayName(string name, IntPtr bind, out IntPtr pidl, uint mask, out uint attrs);
 [DllImport("shell32.dll")] public static extern int SHOpenFolderAndSelectItems(IntPtr pidl, uint count, IntPtr children, uint flags);
}
'@
 $initialized = [BanxingLocalShell]::CoInitializeEx([IntPtr]::Zero, 2)
 if ($initialized -lt 0) { [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($initialized) }
 $pidl = [IntPtr]::Zero
 try {
  [uint32]$attributes = 0
  $parsed = [BanxingLocalShell]::SHParseDisplayName($file, [IntPtr]::Zero, [ref]$pidl, 0, [ref]$attributes)
  [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($parsed)
  $shown = [BanxingLocalShell]::SHOpenFolderAndSelectItems($pidl, 0, [IntPtr]::Zero, 0)
  [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($shown)
 } finally {
  if ($pidl -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($pidl) }
  [BanxingLocalShell]::CoUninitialize()
 }
} else { throw 'INVALID_LOCAL_FILE_ACTION' }
