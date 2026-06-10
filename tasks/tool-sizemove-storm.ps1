# [resize-perf] Fix-A smoke driver — reproduces the modal sizemove loop's
# message sequence against the running editor without interactive input:
#   control:   SetWindowPos storm with NO sizemove bracket (per-tick resets)
#   bracketed: WM_ENTERSIZEMOVE + storm + WM_EXITSIZEMOVE (deferred resets)
# Then read %LOCALAPPDATA%\AloParticleEditor\host.log for [resize-perf] lines.
param(
    [switch]$Bracketed,
    [int]$Ticks = 50,
    [int]$StepPx = 4,
    [int]$TickMs = 12
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowW(string cls, string title);
    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageW(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$WM_ENTERSIZEMOVE = 0x0231
$WM_EXITSIZEMOVE  = 0x0232
$SWP_NOZORDER     = 0x0004
$SWP_NOACTIVATE   = 0x0010

$h = [Win32]::FindWindowW($null, "AloParticleEditor")
if ($h -eq [IntPtr]::Zero) { Write-Error "editor window not found"; exit 1 }

$r = New-Object Win32+RECT
[Win32]::GetWindowRect($h, [ref]$r) | Out-Null
$x = $r.Left; $y = $r.Top
$w0 = $r.Right - $r.Left; $h0 = $r.Bottom - $r.Top

if ($Bracketed) { [Win32]::SendMessageW($h, $WM_ENTERSIZEMOVE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }

for ($i = 1; $i -le $Ticks; $i++) {
    $w = $w0 + ($i * $StepPx)
    [Win32]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $h0, $SWP_NOZORDER -bor $SWP_NOACTIVATE) | Out-Null
    Start-Sleep -Milliseconds $TickMs
}

if ($Bracketed) { [Win32]::SendMessageW($h, $WM_EXITSIZEMOVE, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null }

# restore original size (outside any bracket -> immediate reset, like maximize)
[Win32]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w0, $h0, $SWP_NOZORDER -bor $SWP_NOACTIVATE) | Out-Null
Write-Output ("storm done: bracketed={0} ticks={1}" -f $Bracketed.IsPresent, $Ticks)
