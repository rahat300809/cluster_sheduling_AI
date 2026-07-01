using ClusterOSAgent.Hardware;
using ClusterOSAgent.Models;
using ClusterOSAgent.Firebase;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ClusterOSAgent.Commands;

public class CommandExecutor
{
    private readonly ILogger<CommandExecutor> _logger;
    private readonly ProcessMonitor _processMonitor;
    private readonly RealtimeDbClient _rtdbClient;

    // Standard Python modules to ignore from pip installation
    private static readonly HashSet<string> StdLib = new(StringComparer.OrdinalIgnoreCase)
    {
        "os", "sys", "time", "datetime", "math", "json", "random", "re", "subprocess",
        "threading", "collections", "itertools", "functools", "pathlib", "glob", "shutil",
        "tempfile", "hashlib", "urllib", "argparse", "logging", "traceback", "io", "socket",
        "struct", "pickle", "copy", "uuid", "abc", "typing", "contextlib", "weakref", "ctypes",
        "warnings", "xml", "csv", "sqlite3"
    };

    // Mapping import names to their corresponding pip package names
    private static readonly Dictionary<string, string> ImportToPipMap = new(StringComparer.OrdinalIgnoreCase)
    {
        { "sklearn", "scikit-learn" },
        { "cv2", "opencv-python" },
        { "PIL", "pillow" },
        { "bs4", "beautifulsoup4" },
        { "yaml", "pyyaml" }
    };

    // Win32 API for system actions
    [DllImport("PowrProf.dll", CharSet = CharSet.Auto, ExactSpelling = true)]
    private static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);

    [DllImport("user32.dll")]
    private static extern bool LockWorkStation();

    public CommandExecutor(ILogger<CommandExecutor> logger, ProcessMonitor processMonitor, RealtimeDbClient rtdbClient)
    {
        _logger = logger;
        _processMonitor = processMonitor;
        _rtdbClient = rtdbClient;
    }

    public async Task<(bool success, string output)> ExecuteAsync(string deviceId, CommandModel command, CancellationToken ct)
    {
        return command.Type.ToLowerInvariant() switch
        {
            "shutdown" => ExecuteShutdown(),
            "restart" => ExecuteRestart(),
            "sleep" => ExecuteSleep(),
            "lock" => ExecuteLock(),
            "kill_process" => ExecuteKillProcess(command),
            // Long-running: 10-minute timeout with real-time output streaming
            "run_exe" => await ExecuteRunExeAsync(deviceId, command, ct),
            "run_script" => await ExecuteRunScriptAsync(deviceId, command, ct),
            // Short commands: 60-second timeout with real-time output streaming
            "run_cmd" => await ExecuteRunCmdAsync(deviceId, command, ct),
            _ => (false, $"Unknown command type: {command.Type}")
        };
    }

    private (bool, string) ExecuteShutdown()
    {
        _logger.LogWarning("Executing SHUTDOWN command");
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "shutdown.exe",
                Arguments = "/s /f /t 10",
                CreateNoWindow = true,
                UseShellExecute = false
            });
            return (true, "Shutdown initiated in 10 seconds");
        }
        catch (Exception ex)
        {
            return (false, $"Failed to shutdown: {ex.Message}");
        }
    }

    private (bool, string) ExecuteRestart()
    {
        _logger.LogWarning("Executing RESTART command");
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "shutdown.exe",
                Arguments = "/r /f /t 10",
                CreateNoWindow = true,
                UseShellExecute = false
            });
            return (true, "Restart initiated in 10 seconds");
        }
        catch (Exception ex)
        {
            return (false, $"Failed to restart: {ex.Message}");
        }
    }

    private (bool, string) ExecuteSleep()
    {
        _logger.LogInformation("Executing SLEEP command");
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "rundll32.exe",
                Arguments = "powrprof.dll,SetSuspendState 0,1,0",
                CreateNoWindow = true,
                UseShellExecute = false
            });
            return (true, "System sleep initiated");
        }
        catch (Exception ex)
        {
            return (false, $"Failed to sleep: {ex.Message}");
        }
    }

    private (bool, string) ExecuteLock()
    {
        _logger.LogInformation("Executing LOCK command");
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "rundll32.exe",
                Arguments = "user32.dll,LockWorkStation",
                CreateNoWindow = true,
                UseShellExecute = false
            });
            return (true, "Workstation locked");
        }
        catch (Exception ex)
        {
            return (false, $"Failed to lock: {ex.Message}");
        }
    }

    private (bool, string) ExecuteKillProcess(CommandModel command)
    {
        if (!command.Payload.TryGetValue("pid", out var pidObj))
            return (false, "No PID provided in command payload");

        if (!int.TryParse(pidObj.ToString(), out var pid))
            return (false, $"Invalid PID: {pidObj}");

        var success = _processMonitor.KillProcess(pid);
        return (success, success ? $"Process {pid} killed" : $"Failed to kill process {pid}");
    }

    private async Task<(bool, string)> ExecuteRunExeAsync(string deviceId, CommandModel command, CancellationToken ct)
    {
        if (!command.Payload.TryGetValue("path", out var pathObj))
            return (false, "No path provided");

        var path = pathObj.ToString()!;
        if (!File.Exists(path))
            return (false, $"File not found: {path}");

        int lineIndex = 0;
        return await RunProcessAsync(path, "", ct, (line) =>
        {
            _ = _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, line);
        }, timeoutSeconds: 600);
    }

    private async Task<(bool, string)> ExecuteRunScriptAsync(string deviceId, CommandModel command, CancellationToken ct)
    {
        if (!command.Payload.TryGetValue("script", out var scriptObj))
            return (false, "No script provided");

        var scriptText = scriptObj.ToString()!;
        int lineIndex = 0;

        // Force work: terminate heavy background applications
        bool forceWork = false;
        if (command.Payload.TryGetValue("forceWork", out var forceVal) && forceVal is bool fb)
        {
            forceWork = fb;
        }
        else if (command.Payload.TryGetValue("forceWork", out var forceStr) && forceStr.ToString()!.ToLower() == "true")
        {
            forceWork = true;
        }

        if (forceWork)
        {
            var cleanMsg = "[ClusterOS] Force Work enabled. Cleaning up heavy background programs to free up resources...";
            await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, cleanMsg);
            _logger.LogInformation(cleanMsg);

            var targets = new[] { "chrome", "msedge", "firefox", "discord", "spotify", "steam", "epicgameslauncher", "teams", "slack", "code" };
            foreach (var name in targets)
            {
                if (ct.IsCancellationRequested) break;
                try
                {
                    var runningProcs = Process.GetProcessesByName(name);
                    if (runningProcs.Length > 0)
                    {
                        await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, $"[ClusterOS] Terminating background app '{name}'...");
                        foreach (var p in runningProcs)
                        {
                            try { p.Kill(true); } catch { }
                        }
                    }
                }
                catch { }
            }
            await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, "[ClusterOS] Background optimization complete.\n");
        }

        // Auto-install required packages before running Python script
        var packages = ParsePythonImports(scriptText);
        if (packages.Count > 0)
        {
            await _rtdbClient.UpdateCommandStatusAsync(deviceId, command.CommandId, "installing");
            var msg = $"[ClusterOS] Found external python dependencies: {string.Join(", ", packages)}. Auto-installing...";
            await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, msg);
            _logger.LogInformation(msg);

            var pipExe = FindPip();
            foreach (var pkg in packages)
            {
                if (ct.IsCancellationRequested) break;

                await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, $"[ClusterOS] pip install {pkg}...");
                var (pipOk, pipOut) = await RunProcessAsync(pipExe, $"install {pkg}", ct, (pipLine) =>
                {
                    _ = _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, pipLine);
                }, timeoutSeconds: 120);

                if (!pipOk)
                {
                    await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, $"[ClusterOS WARNING] Failed to install package '{pkg}': {pipOut}");
                }
            }
            await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, "[ClusterOS] Dependencies verified. Starting execution...\n");
        }

        await _rtdbClient.UpdateCommandStatusAsync(deviceId, command.CommandId, "running");

        // Write script to temp file and execute
        var tempPath = Path.Combine(Path.GetTempPath(), $"clusteros_{Guid.NewGuid()}.py");
        await File.WriteAllTextAsync(tempPath, scriptText, ct);

        var pythonExe = FindPython();
        var result = await RunProcessAsync(pythonExe, $"\"{tempPath}\"", ct, (line) =>
        {
            _ = _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, line);
        }, timeoutSeconds: 600);

        try { File.Delete(tempPath); } catch { }
        return result;
    }

    private async Task<(bool, string)> ExecuteRunCmdAsync(string deviceId, CommandModel command, CancellationToken ct)
    {
        if (!command.Payload.TryGetValue("command", out var cmdObj))
            return (false, "No command provided");

        int lineIndex = 0;
        return await RunProcessAsync("cmd.exe", $"/c {cmdObj}", ct, (line) =>
        {
            _ = _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, lineIndex++, line);
        }, timeoutSeconds: 60);
    }

    private async Task<(bool, string)> RunProcessAsync(
        string exe, string args, CancellationToken ct, Action<string> onLineReceived, int timeoutSeconds = 60)
    {
        var outputAccumulator = new StringBuilder();
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var proc = new Process { StartInfo = psi };
            
            proc.OutputDataReceived += (sender, e) =>
            {
                if (e.Data != null)
                {
                    lock (outputAccumulator)
                    {
                        outputAccumulator.AppendLine(e.Data);
                    }
                    onLineReceived?.Invoke(e.Data);
                }
            };

            proc.ErrorDataReceived += (sender, e) =>
            {
                if (e.Data != null)
                {
                    lock (outputAccumulator)
                    {
                        outputAccumulator.AppendLine($"ERROR: {e.Data}");
                    }
                    onLineReceived?.Invoke($"ERROR: {e.Data}");
                }
            };

            if (!proc.Start())
            {
                return (false, "Failed to start process");
            }

            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));

            // Wait for exit with cancel token support
            await proc.WaitForExitAsync(cts.Token);

            string finalOutput;
            lock (outputAccumulator)
            {
                finalOutput = outputAccumulator.ToString().Trim();
            }
            return (proc.ExitCode == 0, finalOutput);
        }
        catch (OperationCanceledException)
        {
            return (false, $"Command timed out after {timeoutSeconds} seconds");
        }
        catch (Exception ex)
        {
            return (false, $"Error: {ex.Message}");
        }
    }

    private List<string> ParsePythonImports(string script)
    {
        var imports = new HashSet<string>();
        var lines = script.Split(new[] { "\r\n", "\r", "\n" }, StringSplitOptions.None);

        var importRegex = new System.Text.RegularExpressions.Regex(@"^\s*import\s+([a-zA-Z0-9_,\s]+)");
        var fromRegex = new System.Text.RegularExpressions.Regex(@"^\s*from\s+([a-zA-Z0-9_]+)");

        foreach (var line in lines)
        {
            var matchImport = importRegex.Match(line);
            if (matchImport.Success)
            {
                var parts = matchImport.Groups[1].Value.Split(',');
                foreach (var part in parts)
                {
                    var clean = part.Trim().Split(new[] { ' ', '\t' })[0].Trim();
                    if (!string.IsNullOrEmpty(clean)) imports.Add(clean);
                }
                continue;
            }

            var matchFrom = fromRegex.Match(line);
            if (matchFrom.Success)
            {
                var clean = matchFrom.Groups[1].Value.Trim();
                if (!string.IsNullOrEmpty(clean)) imports.Add(clean);
            }
        }

        var result = new List<string>();
        foreach (var imp in imports)
        {
            if (StdLib.Contains(imp)) continue;

            if (ImportToPipMap.TryGetValue(imp, out var pipName))
            {
                result.Add(pipName);
            }
            else
            {
                result.Add(imp);
            }
        }
        return result;
    }

    private static string FindPython()
    {
        foreach (var candidate in new[] { "python", "python3", "py" })
        {
            try
            {
                using var p = Process.Start(new ProcessStartInfo
                {
                    FileName = candidate,
                    Arguments = "--version",
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
                if (p != null) return candidate;
            }
            catch { }
        }
        return "python";
    }

    private static string FindPip()
    {
        foreach (var candidate in new[] { "pip", "pip3", "pip.exe" })
        {
            try
            {
                using var p = Process.Start(new ProcessStartInfo
                {
                    FileName = candidate,
                    Arguments = "--version",
                    UseShellExecute = false,
                    CreateNoWindow = true
                });
                if (p != null) return candidate;
            }
            catch { }
        }
        // As a fallback try python -m pip
        return "pip";
    }
}
