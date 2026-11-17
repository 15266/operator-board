# Directly control the visible WorkBuddy window: bring it forward if possible,
# then send Enter to that window only (never to whatever else is in the foreground).
# Does not stop or minimize other programs.
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WbGuiSend {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int dwProcessId);
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_SHOWWINDOW = 0x0040;
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint WM_CHAR = 0x0102;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public const byte VK_MENU = 0x12;
  public const byte VK_RETURN = 0x0D;
  public static IntPtr EnterKeyLParam(bool keyUp) {
    uint scan = 0x1C;
    uint flags = keyUp ? 0xC0000001u : 0x00000001u;
    return new IntPtr((int)((scan << 16) | flags));
  }
  public static string ClassName(IntPtr hWnd) {
    StringBuilder sb = new StringBuilder(256);
    GetClassName(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }
  public static List<IntPtr> ChildWindows(IntPtr parent) {
    List<IntPtr> list = new List<IntPtr>();
    EnumChildWindows(parent, (h, l) => { list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  public static void ForceForeground(IntPtr hwnd) {
    AllowSetForegroundWindow(-1);
    ShowWindow(hwnd, SW_RESTORE);
    ShowWindow(hwnd, SW_SHOW);
    BringWindowToTop(hwnd);
    uint fgPid;
    uint targetPid;
    uint fgTid = GetWindowThreadProcessId(GetForegroundWindow(), out fgPid);
    uint targetTid = GetWindowThreadProcessId(hwnd, out targetPid);
    uint cur = GetCurrentThreadId();
    bool a1 = false, a2 = false;
    if (fgTid != 0 && fgTid != cur) a1 = AttachThreadInput(cur, fgTid, true);
    if (targetTid != 0 && targetTid != cur && targetTid != fgTid) a2 = AttachThreadInput(cur, targetTid, true);
    keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
    SetForegroundWindow(hwnd);
    SwitchToThisWindow(hwnd, true);
    keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    if (a1) AttachThreadInput(cur, fgTid, false);
    if (a2) AttachThreadInput(cur, targetTid, false);
  }
  public static void PostEnter(IntPtr hWnd) {
    IntPtr vk = new IntPtr(VK_RETURN);
    PostMessage(hWnd, WM_KEYDOWN, vk, EnterKeyLParam(false));
    PostMessage(hWnd, WM_CHAR, vk, EnterKeyLParam(false));
    PostMessage(hWnd, WM_KEYUP, vk, EnterKeyLParam(true));
  }
  public static void SendEnterToWindow(IntPtr top) {
    PostEnter(top);
    foreach (IntPtr child in ChildWindows(top)) {
      if (!IsWindowVisible(child)) continue;
      string cls = ClassName(child);
      if (cls.IndexOf("Chrome", StringComparison.OrdinalIgnoreCase) >= 0 ||
          cls.IndexOf("Render", StringComparison.OrdinalIgnoreCase) >= 0 ||
          cls.IndexOf("Widget", StringComparison.OrdinalIgnoreCase) >= 0) {
        PostEnter(child);
      }
    }
  }
}
"@

function Get-WorkBuddyWindow {
  Get-Process -Name WorkBuddy -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Sort-Object StartTime -Descending
}

function Get-ForegroundName {
  $fg = [WbGuiSend]::GetForegroundWindow()
  $fgPid = [uint32]0
  [void][WbGuiSend]::GetWindowThreadProcessId($fg, [ref]$fgPid)
  $p = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
  return @{ hwnd = $fg; pid = $fgPid; name = $p.ProcessName }
}

$proc = Get-WorkBuddyWindow | Select-Object -First 1
if (-not $proc) { Write-Output 'NO_WINDOW'; exit 2 }
$hwnd = $proc.MainWindowHandle

$focused = $false
for ($i = 0; $i -lt 8; $i++) {
  [WbGuiSend]::ForceForeground($hwnd)
  Start-Sleep -Milliseconds 250
  $fg = Get-ForegroundName
  if ($fg.name -eq 'WorkBuddy') { $focused = $true; break }
}

# Always post Enter to the WorkBuddy window itself, so Unity (or another app)
# staying in front cannot receive the keystroke.
[WbGuiSend]::SendEnterToWindow($hwnd)
if ($focused) {
  Write-Output ('SENT_ENTER hwnd=' + $hwnd + ' pid=' + $proc.Id + ' via=foreground+post')
} else {
  $fg = Get-ForegroundName
  Write-Output ('SENT_ENTER hwnd=' + $hwnd + ' pid=' + $proc.Id + ' via=post-to-window fg=' + $fg.name)
}
exit 0
