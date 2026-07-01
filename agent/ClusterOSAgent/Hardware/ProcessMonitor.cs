using ClusterOSAgent.Models;
using Microsoft.Extensions.Logging;
using System.Diagnostics;

namespace ClusterOSAgent.Hardware;

public class ProcessMonitor
{
    private readonly ILogger<ProcessMonitor> _logger;
    private readonly Dictionary<int, double> _prevCpuTimes = new();
    private DateTime _prevCheck = DateTime.UtcNow;

    public ProcessMonitor(ILogger<ProcessMonitor> logger)
    {
        _logger = logger;
    }

    public List<ProcessInfo> GetTopProcesses(int count = 20)
    {
        var result = new List<ProcessInfo>();

        try
        {
            var now = DateTime.UtcNow;
            var elapsed = (now - _prevCheck).TotalSeconds;
            _prevCheck = now;

            var processes = Process.GetProcesses();
            var processList = new List<(Process proc, float cpu, long ram)>();

            foreach (var proc in processes)
            {
                try
                {
                    if (proc.HasExited) continue;

                    var ramMB = proc.WorkingSet64 / 1_048_576; // bytes to MB
                    float cpuPercent = 0f;

                    try
                    {
                        var totalCpuTime = proc.TotalProcessorTime.TotalSeconds;

                        if (_prevCpuTimes.TryGetValue(proc.Id, out var prevCpu) && elapsed > 0)
                        {
                            cpuPercent = (float)((totalCpuTime - prevCpu) / elapsed / Environment.ProcessorCount * 100);
                            cpuPercent = Math.Max(0f, Math.Min(100f, cpuPercent));
                        }

                        _prevCpuTimes[proc.Id] = totalCpuTime;
                    }
                    catch { /* Some processes deny access to CPU times */ }

                    processList.Add((proc, cpuPercent, ramMB));
                }
                catch { /* Process may exit during enumeration */ }
            }

            // Clean up PIDs that no longer exist
            var activePids = processList.Select(p => p.proc.Id).ToHashSet();
            var deadPids = _prevCpuTimes.Keys.Where(k => !activePids.Contains(k)).ToList();
            foreach (var pid in deadPids) _prevCpuTimes.Remove(pid);

            // Sort by CPU then RAM, take top N
            result = processList
                .OrderByDescending(p => p.cpu)
                .ThenByDescending(p => p.ram)
                .Take(count)
                .Select(p => new ProcessInfo
                {
                    Pid = p.proc.Id,
                    Name = p.proc.ProcessName,
                    CpuPercent = (float)Math.Round(p.cpu, 2),
                    RamMB = p.ram,
                    Status = p.proc.Responding ? "running" : "not responding"
                })
                .ToList();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error enumerating processes");
        }

        return result;
    }

    public bool KillProcess(int pid)
    {
        try
        {
            var proc = Process.GetProcessById(pid);
            proc.Kill(entireProcessTree: true);
            _logger.LogInformation("Killed process {Pid}", pid);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to kill process {Pid}", pid);
            return false;
        }
    }
}
