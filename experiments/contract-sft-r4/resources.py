"""Read-only Windows memory accounting. Never modifies pagefiles or other processes."""
import ctypes,os
def memory_status():
 if os.name!='nt':return {'windows':False}
 class Status(ctypes.Structure):
  _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(n,ctypes.c_ulonglong) for n in ['total_physical','available_physical','total_commit','available_commit','total_virtual','available_virtual','available_extended_virtual']]
 s=Status();s.length=ctypes.sizeof(s)
 if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(s)):raise ctypes.WinError()
 return {'windows':True,'available_physical':s.available_physical,'available_commit':s.available_commit,'total_commit':s.total_commit}
def require_capacity(status,quantized=False,pre_torch=False):
 # Execution-only revision: BF16 base + selective supervised logits + per-
 # microbatch cache release was calibrated on longest training/target examples.
 # Still a guard, not a guarantee against another application's allocations.
 # Launcher allowance includes ~1GiB of local Torch/CUDA library initialization.
 # The NF4 calibration checks>=5GiB after those libraries are already imported.
 commit_gib=(6 if pre_torch else 5) if quantized else 7
 if status.get('windows') and (status['available_commit']<commit_gib*1024**3 or status['available_physical']<1024**3):raise RuntimeError('SYSTEM_MEMORY_PREFLIGHT_BLOCKED:'+str(status))
