import {execFile} from 'node:child_process';
import path from 'node:path';
export function chooseLocalFolder(){
 if(process.platform!=='win32')throw Object.assign(Error('当前系统请直接填写本机绝对文件夹路径'),{status:400});
 const script="Add-Type -AssemblyName System.Windows.Forms; $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description='选择要连接给伴行助理的资料文件夹'; $dialog.ShowNewFolderButton=$false; if($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Console]::Write($dialog.SelectedPath)}; $dialog.Dispose()";
 return new Promise((resolve,reject)=>execFile(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-STA','-Command',script],{windowsHide:true,timeout:120000,maxBuffer:65536},(error,stdout)=>error?reject(Object.assign(Error('文件夹选择未完成；也可以直接填写路径'),{status:409})):resolve(stdout.trim()||null)));
}
