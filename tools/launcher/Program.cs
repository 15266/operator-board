using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    const int WebPort = 5173;
    const int BridgePort = 5180;
    const string BoardUrl = "http://127.0.0.1:5173/#projects";
    const string HealthUrl = "http://127.0.0.1:5180/bridge/health";
    const string WebUrl = "http://127.0.0.1:5173/";

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool stop = false;
        foreach (var a in args)
        {
            if (string.Equals(a, "-Stop", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(a, "/Stop", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(a, "--stop", StringComparison.OrdinalIgnoreCase))
                stop = true;
        }

        string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        string root = FindRoot(exeDir);
        if (root == null)
        {
            MessageBox.Show(
                "找不到 start-board.ps1。请把本程序放在操作台项目根目录，或放在该目录的 tools\\launcher 下。",
                "圆桌会议",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }

        string script = Path.Combine(root, "start-board.ps1");

        if (stop)
        {
            int code = RunScript(script, root, "-Stop");
            if (code == 0)
                MessageBox.Show("已停止桥接和界面。", "圆桌会议", MessageBoxButtons.OK, MessageBoxIcon.Information);
            else
                ShowFail(root, code, "停止失败");
            return code;
        }

        if (IsUp())
        {
            OpenBoard();
            return 0;
        }

        var form = new Form
        {
            Text = "圆桌会议",
            FormBorderStyle = FormBorderStyle.FixedDialog,
            StartPosition = FormStartPosition.CenterScreen,
            ClientSize = new Size(360, 96),
            MaximizeBox = false,
            MinimizeBox = false,
            ShowInTaskbar = true,
        };
        var label = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            Text = "正在启动圆桌会议…",
            Font = new Font("Microsoft YaHei UI", 10.5f),
        };
        form.Controls.Add(label);

        int exitCode = 1;
        form.Shown += (s, e) =>
        {
            ThreadPool.QueueUserWorkItem(_ =>
            {
                exitCode = RunScript(script, root, null);
                if (form.IsHandleCreated && !form.IsDisposed)
                {
                    form.BeginInvoke(new Action(() =>
                    {
                        if (!form.IsDisposed) form.Close();
                    }));
                }
            });
        };
        Application.Run(form);

        if (exitCode == 0)
            return 0;

        ShowFail(root, exitCode, "启动失败");
        return exitCode;
    }

    static string FindRoot(string start)
    {
        var dir = start;
        for (int i = 0; i < 4; i++)
        {
            if (File.Exists(Path.Combine(dir, "start-board.ps1")) &&
                Directory.Exists(Path.Combine(dir, "bridge")))
                return dir;
            var parent = Directory.GetParent(dir);
            if (parent == null) break;
            dir = parent.FullName;
        }
        return null;
    }

    static bool IsUp()
    {
        return HttpOk(HealthUrl) && HttpOk(WebUrl);
    }

    static bool HttpOk(string url)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Proxy = null;
            req.Timeout = 2000;
            req.ReadWriteTimeout = 2000;
            req.Method = "GET";
            using (var resp = (HttpWebResponse)req.GetResponse())
                return (int)resp.StatusCode == 200;
        }
        catch
        {
            return false;
        }
    }

    static void OpenBoard()
    {
        try
        {
            Process.Start(new ProcessStartInfo(BoardUrl) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "看板已在运行，但打不开浏览器：\n" + ex.Message + "\n请手动打开 " + BoardUrl,
                "圆桌会议",
                MessageBoxButtons.OK,
                MessageBoxIcon.Warning);
        }
    }

    static int RunScript(string script, string root, string extra)
    {
        var psi = new ProcessStartInfo();
        string systemPs = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
        psi.FileName = File.Exists(systemPs) ? systemPs : "powershell.exe";
        string args = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"";
        if (!string.IsNullOrEmpty(extra))
            args += " " + extra;
        psi.Arguments = args;
        psi.WorkingDirectory = root;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WindowStyle = ProcessWindowStyle.Hidden;
        try
        {
            using (var p = Process.Start(psi))
            {
                if (p == null) return 1;
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch
        {
            return 1;
        }
    }

    static void ShowFail(string root, int code, string title)
    {
        string log = Path.Combine(root, "logs", "launcher.log");
        string msg = title + "（退出码 " + code + "）。";
        if (File.Exists(log))
            msg += "\n请查看日志：\n" + log;
        else
            msg += "\n未找到启动日志。请确认已安装 Node.js，并在项目目录执行过 npm install。";
        MessageBox.Show(msg, "圆桌会议", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
