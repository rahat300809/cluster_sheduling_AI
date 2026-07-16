using ClusterOSAgent.Hardware;
using ClusterOSAgent.Models;
using ClusterOSAgent.Firebase;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
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
    private readonly HttpClient _http;

    // Firebase Storage bucket for artifact uploads
    private const string STORAGE_BUCKET = "cluster300809.firebasestorage.app";

    // Max artifact file size: 100 MB
    private const long MAX_ARTIFACT_SIZE_BYTES = 100L * 1024 * 1024;

    // Extensions to detect as output artifacts after script execution
    private static readonly HashSet<string> ArtifactExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pkl", ".joblib", ".h5", ".hdf5", ".pt", ".pth", ".onnx", ".pb",
        ".tflite", ".safetensors", ".keras", ".model", ".weights",
        ".csv", ".json", ".jsonl", ".txt", ".log",
        ".png", ".jpg", ".jpeg", ".svg", ".pdf",
        ".npy", ".npz", ".parquet", ".feather"
    };

    // Standard Python modules to ignore from pip installation
    private static readonly HashSet<string> StdLib = new(StringComparer.OrdinalIgnoreCase)
    {
        "os", "sys", "time", "datetime", "math", "json", "random", "re", "subprocess",
        "threading", "collections", "itertools", "functools", "pathlib", "glob", "shutil",
        "tempfile", "hashlib", "urllib", "argparse", "logging", "traceback", "io", "socket",
        "struct", "pickle", "copy", "uuid", "abc", "typing", "contextlib", "weakref", "ctypes",
        "warnings", "xml", "csv", "sqlite3", "stat", "platform", "sysconfig", "gc", "select",
        "enum", "inspect"
    };

    // ── GPU-SAFE: ML framework packages that must NEVER be pip-reinstalled automatically.
    // pip install torch / tensorflow installs CPU-only builds by default, which DESTROYS
    // existing CUDA-enabled installations and breaks GPU training entirely.
    // These packages are always pre-checked via 'python -c "import X"' before any action.
    private static readonly HashSet<string> GpuSensitivePackages = new(StringComparer.OrdinalIgnoreCase)
    {
        // PyTorch ecosystem
        "torch", "torchvision", "torchaudio", "torchtext", "torch_geometric",
        // TensorFlow / Keras ecosystem
        "tensorflow", "tensorflow_gpu", "tf", "keras",
        // JAX
        "jax", "jaxlib",
        // NVIDIA / CUDA
        "cudf", "cuml", "cupy", "numba",
        // Large ML libs that may have GPU-specific sub-dependencies
        "transformers", "accelerate", "diffusers", "optimum", "peft", "trl",
        "bitsandbytes", "flash_attn", "xformers", "apex",
        // Commonly pre-installed ML utilities
        "numpy", "pandas", "matplotlib", "scipy", "seaborn",
        "sklearn", "xgboost", "lightgbm", "catboost",
        "onnx", "onnxruntime", "onnxruntime_gpu",
        "einops", "timm", "datasets", "tokenizers"
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
        _http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) }; // generous timeout for large dataset downloads
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
            _ = _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, line);
        }, timeoutSeconds: 600);
    }

    private async Task<(bool, string)> ExecuteRunScriptAsync(string deviceId, CommandModel command, CancellationToken ct)
    {
        object? scriptObj = null;
        if (!command.Payload.TryGetValue("script", out scriptObj) && !command.Payload.TryGetValue("Script", out scriptObj))
            return (false, "No script provided");

        var scriptText = scriptObj.ToString()!;
        int lineIndex = 0;

        // Force work: terminate heavy background applications
        bool forceWork = false;
        object? forceVal = null;
        if (command.Payload.TryGetValue("forceWork", out forceVal) || command.Payload.TryGetValue("ForceWork", out forceVal))
        {
            if (forceVal is bool fb) forceWork = fb;
            else if (forceVal?.ToString()?.ToLower() == "true") forceWork = true;
        }

        if (forceWork)
        {
            var cleanMsg = "[ClusterOS] Force Work enabled. Cleaning up heavy background programs to free up resources...";
            await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, cleanMsg);
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
                        await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, $"[ClusterOS] Terminating background app '{name}'...");
                        foreach (var p in runningProcs)
                        {
                            try { p.Kill(true); } catch { }
                        }
                    }
                }
                catch { }
            }
            await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, "[ClusterOS] Background optimization complete.\n");
        }

        // ── Create an isolated working directory for this run ────────────────
        var workDir = Path.Combine(Path.GetTempPath(), "clusteros_runs", command.CommandId);
        Directory.CreateDirectory(workDir);

        // ── Download datasets from Firebase Storage if provided ──────────────
        string? datasetDir = null;
        object? datasetsObj = null;
        if ((command.Payload.TryGetValue("datasets", out datasetsObj) || command.Payload.TryGetValue("Datasets", out datasetsObj)) && datasetsObj != null)
        {
            try
            {
                var datasetList = ParseDatasetPayload(datasetsObj);
                if (datasetList.Count > 0)
                {
                    datasetDir = await DownloadDatasetsAsync(deviceId, command.CommandId, datasetList, lineIndex, ct);
                    lineIndex += datasetList.Count + 2; // account for log lines added by download
                }
            }
            catch (Exception ex)
            {
                await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1,
                    $"[ClusterOS WARNING] Dataset download failed: {ex.Message}");
            }
        }

        // Use datasetDir as the working directory if datasets were downloaded, otherwise use the isolated workDir
        var effectiveWorkDir = !string.IsNullOrEmpty(datasetDir) ? datasetDir : workDir;

        // Auto-install required packages before running Python script
        var packages = ParsePythonImports(scriptText);
        if (packages.Count > 0)
        {
            // ── GPU-SAFE pre-check ─────────────────────────────────────────────
            // Before any pip install, test if the package is already importable.
            // This prevents pip from overwriting CUDA-enabled builds (e.g. torch+cu121)
            // with CPU-only versions, which would break GPU training silently.
            var pythonExeForCheck = FindPython();
            var packagesToInstall = new List<string>();
            foreach (var pkg in packages)
            {
                if (ct.IsCancellationRequested) break;
                // Determine the import name to test (strip pip extras like "package[extra]")
                var importName = pkg.Split('[')[0].Trim();
                // Map pip name back to import name if needed
                var importTest = importName.ToLowerInvariant() switch
                {
                    "scikit-learn" => "sklearn",
                    "opencv-python" => "cv2",
                    "pillow" => "PIL",
                    "beautifulsoup4" => "bs4",
                    "pyyaml" => "yaml",
                    _ => importName
                };

                var (alreadyOk, _) = await RunProcessAsync(
                    pythonExeForCheck,
                    $"-c \"import {importTest}\"",
                    ct, _ => { }, timeoutSeconds: 15);

                if (alreadyOk)
                {
                    // Package is already importable — skip installation
                    var skipReason = GpuSensitivePackages.Contains(importName)
                        ? $"[ClusterOS] ✓ '{pkg}' already installed (GPU-safe skip — will not reinstall to preserve CUDA build)."
                        : $"[ClusterOS] ✓ '{pkg}' already installed (skip).";
                    await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, skipReason);
                }
                else
                {
                    if (GpuSensitivePackages.Contains(importName))
                    {
                        var noticeMsg = $"[ClusterOS] '{pkg}' not found. This is a GPU-sensitive ML package — initiating automated background setup (this may take up to 20-30 minutes for large libraries)...";
                        await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, noticeMsg);
                    }
                    packagesToInstall.Add(pkg);
                }
            }

            if (packagesToInstall.Count > 0)
            {
                await _rtdbClient.UpdateCommandStatusAsync(deviceId, command.CommandId, "installing");
                var msg = $"[ClusterOS] Installing {packagesToInstall.Count} missing package(s): {string.Join(", ", packagesToInstall)}...";
                await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, msg);
                _logger.LogInformation(msg);

                var pipExe = FindPip();
                foreach (var pkg in packagesToInstall)
                {
                    if (ct.IsCancellationRequested) break;

                    await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, $"[ClusterOS] pip install {pkg}...");
                    var (pipOk, pipOut) = await RunProcessAsync(pipExe, $"install {pkg} --quiet", ct, (pipLine) =>
                    {
                        // Skip noisy pip lines — only stream meaningful output
                        if (IsMeaningfulPipLine(pipLine))
                            _ = _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, $"[pip] {pipLine}");
                    }, timeoutSeconds: 1800); // 30 minutes timeout

                    if (pipOk)
                        await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, $"[ClusterOS] ✓ Package '{pkg}' ready.");
                    else
                        await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, $"[ClusterOS WARNING] Failed to install package '{pkg}': {pipOut}");
                }
            }

            await _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, "[ClusterOS] All dependencies ready. Starting execution...\n");
        }

        await _rtdbClient.UpdateCommandStatusAsync(deviceId, command.CommandId, "running");

        // ── Inject dataset directory + output directory preamble into the Python script ─────────
        var preambleLines = new List<string> { "import os" };
        if (!string.IsNullOrEmpty(datasetDir))
        {
            preambleLines.Add($"DATASET_DIR = r\"{datasetDir}\"");
            preambleLines.Add("os.environ['CLUSTEROS_DATASET_DIR'] = DATASET_DIR");
        }
        preambleLines.Add($"OUTPUT_DIR = r\"{effectiveWorkDir}\"");
        preambleLines.Add("os.environ['CLUSTEROS_OUTPUT_DIR'] = OUTPUT_DIR");
        scriptText = string.Join("\n", preambleLines) + "\n" + scriptText;

        // Snapshot files present BEFORE script execution (to detect new outputs)
        var preExistingFiles = new HashSet<string>(
            Directory.Exists(effectiveWorkDir)
                ? Directory.GetFiles(effectiveWorkDir, "*", SearchOption.AllDirectories)
                : Array.Empty<string>(),
            StringComparer.OrdinalIgnoreCase);

        // Write script to temp file and execute
        var tempPath = Path.Combine(Path.GetTempPath(), $"clusteros_{Guid.NewGuid()}.py");
        await File.WriteAllTextAsync(tempPath, scriptText, ct);

        var pythonExe = FindPython();
        var envVars = new Dictionary<string, string>
        {
            ["CLUSTEROS_OUTPUT_DIR"] = effectiveWorkDir
        };
        if (!string.IsNullOrEmpty(datasetDir))
            envVars["CLUSTEROS_DATASET_DIR"] = datasetDir;

        var result = await RunProcessAsync(pythonExe, $"-W ignore -u \"{tempPath}\"", ct, (line) =>
        {
            _ = _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, line);
        }, timeoutSeconds: 600, environmentVars: envVars, workingDirectory: effectiveWorkDir);

        try { File.Delete(tempPath); } catch { }

        // ── Collect & upload output artifacts ────────────────────────────────
        try
        {
            await CollectAndUploadArtifactsAsync(deviceId, command.CommandId, effectiveWorkDir, preExistingFiles, lineIndex, ct);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Artifact collection failed for command {CommandId}", command.CommandId);
        }

        // Clean up working directories AFTER artifact upload
        if (!string.IsNullOrEmpty(datasetDir))
        {
            try { Directory.Delete(datasetDir, true); } catch { }
        }
        if (Directory.Exists(workDir))
        {
            try { Directory.Delete(workDir, true); } catch { }
        }

        return result;
    }

    private async Task<(bool, string)> ExecuteRunCmdAsync(string deviceId, CommandModel command, CancellationToken ct)
    {
        if (!command.Payload.TryGetValue("command", out var cmdObj))
            return (false, "No command provided");

        int lineIndex = 0;
        return await RunProcessAsync("cmd.exe", $"/c {cmdObj}", ct, (line) =>
        {
            _ = _rtdbClient.AppendJobOutputLineAsync(deviceId, command.CommandId, Interlocked.Increment(ref lineIndex) - 1, line);
        }, timeoutSeconds: 60);
    }

    private async Task<(bool, string)> RunProcessAsync(
        string exe, string args, CancellationToken ct, Action<string> onLineReceived,
        int timeoutSeconds = 60, Dictionary<string, string>? environmentVars = null,
        string? workingDirectory = null)
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
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };

            // Set working directory if provided
            if (!string.IsNullOrEmpty(workingDirectory))
            {
                psi.WorkingDirectory = workingDirectory;
            }

            // Set UTF-8 encoding for Python processes by default
            psi.Environment["PYTHONIOENCODING"] = "utf-8";
            psi.Environment["PYTHONUNBUFFERED"] = "1";

            // Set environment variables if provided
            if (environmentVars != null)
            {
                foreach (var (key, value) in environmentVars)
                    psi.Environment[key] = value;
            }

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

    public class DatasetDownloadInfo
    {
        public string Name { get; set; } = "";
        public string DownloadUrl { get; set; } = "";
        public string? AccessToken { get; set; }
    }

    // ─── Dataset Download (from Firebase Storage, Google Drive or external URL) ───

    /// <summary>
    /// Downloads dataset files from Firebase Storage, Google Drive or direct URLs to a local temp directory.
    /// Returns the local directory path containing all downloaded files.
    /// </summary>
    private async Task<string> DownloadDatasetsAsync(
        string deviceId, string commandId,
        List<DatasetDownloadInfo> datasets,
        int lineIndex, CancellationToken ct)
    {
        var datasetDir = Path.Combine(Path.GetTempPath(), "clusteros_datasets", commandId);
        Directory.CreateDirectory(datasetDir);

        await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId, lineIndex++,
            $"[ClusterOS] 📦 Downloading {datasets.Count} dataset file(s) to target PC...");

        foreach (var dataset in datasets)
        {
            if (ct.IsCancellationRequested) break;
            try
            {
                await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId, lineIndex++,
                    $"[ClusterOS] ↓ Downloading '{dataset.Name}'...");

                var filePath = Path.Combine(datasetDir, dataset.Name);
                var gdriveId = ExtractGoogleDriveFileId(dataset.DownloadUrl);

                if (!string.IsNullOrEmpty(gdriveId))
                {
                    if (!string.IsNullOrEmpty(dataset.AccessToken))
                    {
                        await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId, lineIndex++,
                            $"[ClusterOS] Google Drive OAuth detected. Downloading via secure API...");
                        await DownloadFileFromGoogleDriveApiAsync(gdriveId, dataset.AccessToken, filePath, ct);
                    }
                    else
                    {
                        await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId, lineIndex++,
                            $"[ClusterOS] Detect public Google Drive link. Performing download...");
                        await DownloadFileFromGoogleDriveAsync(gdriveId, filePath, ct);
                    }
                }
                else
                {
                    using var response = await _http.GetAsync(dataset.DownloadUrl, ct);
                    response.EnsureSuccessStatusCode();
                    await using var fs = File.Create(filePath);
                    await response.Content.CopyToAsync(fs, ct);
                }

                var sizeKb = new FileInfo(filePath).Length / 1024.0;
                var sizeStr = sizeKb > 1024 ? $"{sizeKb / 1024:F1} MB" : $"{sizeKb:F0} KB";
                await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId, lineIndex++,
                    $"[ClusterOS] ✓ '{dataset.Name}' downloaded ({sizeStr})");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to download dataset file: {Name}", dataset.Name);
                await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId, lineIndex++,
                    $"[ClusterOS WARNING] Failed to download '{dataset.Name}': {ex.Message}");
            }
        }

        await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId, lineIndex++,
            $"[ClusterOS] ✓ All datasets ready at: {datasetDir}\n");

        return datasetDir;
    }

    /// <summary>
    /// Extract Google Drive File ID from typical sharing links or API endpoints.
    /// </summary>
    private static string? ExtractGoogleDriveFileId(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;

        var match = System.Text.RegularExpressions.Regex.Match(url, @"/files/([a-zA-Z0-9_-]+)");
        if (match.Success) return match.Groups[1].Value;

        match = System.Text.RegularExpressions.Regex.Match(url, @"/d/([a-zA-Z0-9_-]+)");
        if (match.Success) return match.Groups[1].Value;

        match = System.Text.RegularExpressions.Regex.Match(url, @"id=([a-zA-Z0-9_-]+)");
        if (match.Success) return match.Groups[1].Value;

        return null;
    }

    /// <summary>
    /// Downloads a Google Drive file, bypassing large-file virus scan warnings.
    /// </summary>
    private async Task DownloadFileFromGoogleDriveAsync(string fileId, string outputPath, CancellationToken ct)
    {
        var cookieContainer = new System.Net.CookieContainer();
        using var handler = new HttpClientHandler { CookieContainer = cookieContainer, AllowAutoRedirect = true };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(45) };
        client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

        var initialUrl = $"https://drive.google.com/uc?export=download&id={fileId}";
        var response = await client.GetAsync(initialUrl, ct);

        if (response.IsSuccessStatusCode)
        {
            var content = await response.Content.ReadAsStringAsync(ct);
            // Check for large file warning confirmation code
            var match = System.Text.RegularExpressions.Regex.Match(content, @"confirm=([a-zA-Z0-9_-]+)");
            if (match.Success)
            {
                var confirmToken = match.Groups[1].Value;
                var confirmUrl = $"https://drive.google.com/uc?export=download&confirm={confirmToken}&id={fileId}";
                response = await client.GetAsync(confirmUrl, ct);
            }
            else if (content.Contains("Google Drive - Quota exceeded") || content.Contains("Too many users have viewed or downloaded this file"))
            {
                throw new Exception("Google Drive download quota exceeded for this file.");
            }
        }

        response.EnsureSuccessStatusCode();
        await using var fs = File.Create(outputPath);
        await response.Content.CopyToAsync(fs, ct);
    }

    /// <summary>
    /// Downloads a file from the Google Drive API using a Bearer Access Token.
    /// </summary>
    private async Task DownloadFileFromGoogleDriveApiAsync(string fileId, string accessToken, string outputPath, CancellationToken ct)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(45) };
        client.DefaultRequestHeaders.Add("Authorization", $"Bearer {accessToken}");
        client.DefaultRequestHeaders.Add("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

        var url = $"https://www.googleapis.com/drive/v3/files/{fileId}?alt=media";
        var response = await client.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        await using var fs = File.Create(outputPath);
        await response.Content.CopyToAsync(fs, ct);
    }

    /// <summary>
    /// Parses the datasets payload from the command into a list of DatasetDownloadInfo elements.
    /// Supports both Newtonsoft JArray and plain object lists.
    /// </summary>
    private static List<DatasetDownloadInfo> ParseDatasetPayload(object datasetsObj)
    {
        var result = new List<DatasetDownloadInfo>();
        try
        {
            if (datasetsObj is Newtonsoft.Json.Linq.JArray jArray)
            {
                foreach (var item in jArray)
                {
                    var name = item["name"]?.ToString() ?? "";
                    var url = item["downloadUrl"]?.ToString() ?? "";
                    var token = item["accessToken"]?.ToString();
                    if (!string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(url))
                    {
                        result.Add(new DatasetDownloadInfo { Name = name, DownloadUrl = url, AccessToken = token });
                    }
                }
            }
            else if (datasetsObj is IEnumerable<object> list)
            {
                foreach (var item in list)
                {
                    var json = Newtonsoft.Json.JsonConvert.SerializeObject(item);
                    var dict = Newtonsoft.Json.JsonConvert.DeserializeObject<Dictionary<string, string>>(json);
                    if (dict != null && dict.TryGetValue("name", out var n) && dict.TryGetValue("downloadUrl", out var u))
                    {
                        dict.TryGetValue("accessToken", out var t);
                        result.Add(new DatasetDownloadInfo { Name = n, DownloadUrl = u, AccessToken = t });
                    }
                }
            }
        }
        catch { }
        return result;
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

    /// <summary>
    /// Returns true only for pip lines that are meaningful to show in the dashboard console.
    /// Filters out progress bars, "Requirement already satisfied", download chatter, etc.
    /// </summary>
    private static bool IsMeaningfulPipLine(string line)
    {
        if (string.IsNullOrWhiteSpace(line)) return false;
        var t = line.Trim();
        // Remove prepended ERROR prefix if present
        if (t.StartsWith("ERROR:", StringComparison.OrdinalIgnoreCase))
        {
            t = t.Substring(6).Trim();
        }
        if (string.IsNullOrWhiteSpace(t)) return false;

        // Skip noisy pip patterns
        if (t.StartsWith("Requirement already satisfied", StringComparison.OrdinalIgnoreCase)) return false;
        if (t.StartsWith("Downloading", StringComparison.OrdinalIgnoreCase)) return false;
        if (t.StartsWith("Using cached", StringComparison.OrdinalIgnoreCase)) return false;
        if (t.StartsWith("Obtaining", StringComparison.OrdinalIgnoreCase)) return false;
        if (t.StartsWith("Collecting", StringComparison.OrdinalIgnoreCase)) return false;
        if (t.Contains("━━") || t.Contains("───") || t.Contains("---")) return false;
        if (t.StartsWith("Notice:", StringComparison.OrdinalIgnoreCase) || t.Contains("[notice]")) return false;
        if (t.Contains("kB/s") || t.Contains("MB/s")) return false;
        // Always show errors and warnings
        if (t.StartsWith("ERROR", StringComparison.OrdinalIgnoreCase)) return true;
        if (t.StartsWith("WARNING", StringComparison.OrdinalIgnoreCase)) return true;
        if (t.StartsWith("Successfully installed", StringComparison.OrdinalIgnoreCase)) return true;
        // Skip anything else short/cryptic
        return t.Length > 5;
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
                if (p != null)
                {
                    p.WaitForExit(1000);
                    return candidate;
                }
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
                if (p != null)
                {
                    p.WaitForExit(1000);
                    return candidate;
                }
            }
            catch { }
        }
        // As a fallback try python -m pip
        return "pip";
    }

    // ─── Artifact Collection & Upload ─────────────────────────────────────────

    /// <summary>
    /// Scans the working directory for new output files (model weights, CSVs, images, etc.),
    /// uploads them to Firebase Storage, and publishes download metadata to RTDB.
    /// </summary>
    private async Task CollectAndUploadArtifactsAsync(
        string deviceId, string commandId, string workDir,
        HashSet<string> preExistingFiles, int lineIndex, CancellationToken ct)
    {
        if (!Directory.Exists(workDir)) return;

        // Find all NEW files created by the script
        var allFiles = Directory.GetFiles(workDir, "*", SearchOption.AllDirectories);
        var newFiles = allFiles
            .Where(f => !preExistingFiles.Contains(f))
            .Where(f =>
            {
                var ext = Path.GetExtension(f);
                return ArtifactExtensions.Contains(ext);
            })
            .Where(f =>
            {
                try { return new FileInfo(f).Length > 0 && new FileInfo(f).Length <= MAX_ARTIFACT_SIZE_BYTES; }
                catch { return false; }
            })
            .ToList();

        if (newFiles.Count == 0) return;

        await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId,
            Interlocked.Increment(ref lineIndex) - 1,
            $"\n[ClusterOS] 📦 Found {newFiles.Count} output artifact(s). Uploading...");

        var artifacts = new List<Dictionary<string, object>>();
        long totalSize = 0;
        const long MAX_TOTAL_ARTIFACTS_SIZE = 500L * 1024 * 1024; // 500 MB total cap

        foreach (var filePath in newFiles)
        {
            if (ct.IsCancellationRequested) break;

            var fileInfo = new FileInfo(filePath);
            if (totalSize + fileInfo.Length > MAX_TOTAL_ARTIFACTS_SIZE)
            {
                await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId,
                    Interlocked.Increment(ref lineIndex) - 1,
                    $"[ClusterOS WARNING] Artifact upload cap reached (500 MB). Skipping remaining files.");
                break;
            }

            var fileName = fileInfo.Name;
            var storagePath = $"artifacts/{deviceId}/{commandId}/{fileName}";

            try
            {
                await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId,
                    Interlocked.Increment(ref lineIndex) - 1,
                    $"[ClusterOS] ↑ Saving '{fileName}' ({FormatSize(fileInfo.Length)})...");

                string downloadUrl = "";
                string? base64Content = null;
                bool storageAvailable = false;

                // Try Firebase Storage first; fall back to RTDB-embedded base64 for small files
                try
                {
                    downloadUrl = await UploadFileToFirebaseStorageAsync(filePath, storagePath, ct);
                    storageAvailable = true;
                }
                catch
                {
                    // Firebase Storage not available — embed small files (<= 500 KB) as base64 in RTDB
                    const long MAX_INLINE_SIZE = 500 * 1024;
                    if (fileInfo.Length <= MAX_INLINE_SIZE)
                    {
                        var bytes = await File.ReadAllBytesAsync(filePath, ct);
                        base64Content = Convert.ToBase64String(bytes);
                        downloadUrl = $"rtdb://artifacts/{deviceId}/{commandId}/{fileName}";
                    }
                    else
                    {
                        downloadUrl = "";
                    }
                }

                var artEntry = new Dictionary<string, object>
                {
                    ["name"] = fileName,
                    ["storagePath"] = storagePath,
                    ["downloadUrl"] = downloadUrl,
                    ["size"] = fileInfo.Length,
                    ["uploadedAt"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                };
                if (base64Content != null) artEntry["base64"] = base64Content;
                artifacts.Add(artEntry);

                totalSize += fileInfo.Length;

                var saveMsg = storageAvailable
                    ? $"[ClusterOS] ✓ '{fileName}' uploaded to Firebase Storage."
                    : base64Content != null
                        ? $"[ClusterOS] ✓ '{fileName}' saved inline (Storage unavailable)."
                        : $"[ClusterOS] ⚠ '{fileName}' too large to save inline (Storage unavailable).";  
                await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId,
                    Interlocked.Increment(ref lineIndex) - 1, saveMsg);

                // For text/JSON artifacts, also print contents to the output console
                var ext = Path.GetExtension(filePath).ToLowerInvariant();
                if ((ext == ".json" || ext == ".txt" || ext == ".log" || ext == ".csv") && fileInfo.Length <= 8192)
                {
                    var content = await File.ReadAllTextAsync(filePath, ct);
                    await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId,
                        Interlocked.Increment(ref lineIndex) - 1,
                        $"[ClusterOS] 📄 {fileName} contents:\n{content}");
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to save artifact {File}", fileName);
                await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId,
                    Interlocked.Increment(ref lineIndex) - 1,
                    $"[ClusterOS WARNING] Failed to save '{fileName}': {ex.Message}");
            }
        }

        if (artifacts.Count > 0)
        {
            // Publish artifact metadata to RTDB for the dashboard to read
            await _rtdbClient.PublishJobArtifactsAsync(deviceId, commandId, artifacts);

            await _rtdbClient.AppendJobOutputLineAsync(deviceId, commandId,
                Interlocked.Increment(ref lineIndex) - 1,
                $"\n[ClusterOS] ✓ {artifacts.Count} artifact(s) uploaded ({FormatSize(totalSize)}). Download from your dashboard.");
        }
    }

    /// <summary>
    /// Upload a local file to Firebase Storage via the REST API.
    /// Returns the public download URL with token.
    /// </summary>
    private async Task<string> UploadFileToFirebaseStorageAsync(string localPath, string storagePath, CancellationToken ct)
    {
        var encodedPath = Uri.EscapeDataString(storagePath);
        var url = $"https://firebasestorage.googleapis.com/v0/b/{STORAGE_BUCKET}/o/{encodedPath}";

        using var fileStream = File.OpenRead(localPath);
        using var content = new StreamContent(fileStream);

        // Determine content type from extension
        var ext = Path.GetExtension(localPath).ToLowerInvariant();
        var contentType = ext switch
        {
            ".csv" => "text/csv",
            ".json" or ".jsonl" => "application/json",
            ".txt" or ".log" => "text/plain",
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".svg" => "image/svg+xml",
            ".pdf" => "application/pdf",
            ".parquet" => "application/octet-stream",
            _ => "application/octet-stream"
        };

        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);

        var response = await _http.PostAsync(url, content, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new Exception($"Firebase Storage upload failed ({response.StatusCode}): {body}");
        }

        // Parse response to get the download token
        var responseJson = await response.Content.ReadAsStringAsync(ct);
        var responseObj = Newtonsoft.Json.JsonConvert.DeserializeObject<Dictionary<string, object>>(responseJson);
        var downloadToken = "";
        if (responseObj != null && responseObj.TryGetValue("downloadTokens", out var tokenObj))
            downloadToken = tokenObj?.ToString() ?? "";

        var downloadUrl = $"https://firebasestorage.googleapis.com/v0/b/{STORAGE_BUCKET}/o/{encodedPath}?alt=media";
        if (!string.IsNullOrEmpty(downloadToken))
            downloadUrl += $"&token={downloadToken}";

        return downloadUrl;
    }

    private static string FormatSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        if (bytes < 1024 * 1024) return $"{bytes / 1024.0:F0} KB";
        return $"{bytes / (1024.0 * 1024.0):F1} MB";
    }
}
