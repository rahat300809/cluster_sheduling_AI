using ClusterOSAgent.Models;
using LibreHardwareMonitor.Hardware;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;
using System.Net.NetworkInformation;

namespace ClusterOSAgent.Hardware;

/// <summary>
/// Collects all hardware metrics from LibreHardwareMonitor plus OS-level data.
/// Fills every field used by the ClusterOS Intelligent Scheduler.
/// </summary>
public class HardwareMonitor : IDisposable
{
    private readonly ILogger<HardwareMonitor> _logger;
    private Computer? _computer;

    // ── Network I/O tracking ──────────────────────────────────────────────
    private long _prevBytesReceived;
    private long _prevBytesSent;
    private DateTime _prevNetworkCheck = DateTime.UtcNow;

    // ── CPU load averages (rolling queues) ────────────────────────────────
    // We keep 1-min, 5-min, 15-min windows using a ConcurrentQueue of (time, value) pairs
    private readonly ConcurrentQueue<(DateTime t, float v)> _cpuHistory = new();
    private const int CPU_HISTORY_MAX_MINUTES = 16;

    private HardwareSnapshot? _lastSnapshot;
    public HardwareSnapshot? LastSnapshot => _lastSnapshot;

    public HardwareMonitor(ILogger<HardwareMonitor> logger)
    {
        _logger = logger;
    }

    public void Initialize()
    {
        try
        {
            _logger.LogInformation("Initializing hardware monitor...");
            _computer = new Computer
            {
                IsCpuEnabled = true,
                IsGpuEnabled = true,
                IsMemoryEnabled = true,
                IsStorageEnabled = true,
                IsNetworkEnabled = true,
                IsMotherboardEnabled = true,   // needed for some temp sensors
                IsControllerEnabled = false
            };
            _computer.Open();
            _computer.Accept(new UpdateVisitor());
            _logger.LogInformation("Hardware monitor initialized successfully.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize hardware monitor. Running with limited metrics.");
            _computer = null;
        }
    }

    public HardwareSnapshot GetSnapshot()
    {
        if (_computer == null)
        {
            // Fallback: try to collect basic OS-level metrics without LibreHardwareMonitor
            return GetFallbackSnapshot();
        }

        // Force update all hardware sensors
        foreach (var hardware in _computer.Hardware)
        {
            hardware.Update();
            foreach (var sub in hardware.SubHardware)
                sub.Update();
        }

        var cpu = GetCpuMetrics();

        // Record this reading in our rolling history
        var now = DateTime.UtcNow;
        _cpuHistory.Enqueue((now, cpu.Total));
        // Prune old entries (keep last CPU_HISTORY_MAX_MINUTES worth)
        while (_cpuHistory.TryPeek(out var oldest) && (now - oldest.t).TotalMinutes > CPU_HISTORY_MAX_MINUTES)
            _cpuHistory.TryDequeue(out _);

        // Compute rolling averages
        cpu.Load1  = RollingAvg(1);
        cpu.Load5  = RollingAvg(5);
        cpu.Load15 = RollingAvg(15);

        var snapshot = new HardwareSnapshot
        {
            Cpu          = cpu,
            Ram          = GetRamMetrics(),
            Gpu          = GetGpuMetrics(),
            Disk         = GetDiskMetrics(),
            Network      = GetNetworkMetrics(),
            Temperatures = GetTemperatures()
        };

        _lastSnapshot = snapshot;
        return snapshot;
    }

    // ─── CPU ───────────────────────────────────────────────────────────────────

    private CpuMetrics GetCpuMetrics()
    {
        var cpu = new CpuMetrics();
        var cpuHardware = _computer!.Hardware
            .FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);

        if (cpuHardware == null) return cpu;

        cpu.Name = cpuHardware.Name;

        foreach (var sensor in cpuHardware.Sensors)
        {
            if (sensor.SensorType == SensorType.Load)
            {
                if (sensor.Name == "CPU Total")
                    cpu.Total = sensor.Value ?? 0f;
                else if (sensor.Name.StartsWith("CPU Core #", StringComparison.Ordinal))
                    cpu.Cores.Add(sensor.Value ?? 0f);
            }
        }

        return cpu;
    }

    private float RollingAvg(int minutes)
    {
        var cutoff = DateTime.UtcNow.AddMinutes(-minutes);
        var samples = _cpuHistory.Where(e => e.t >= cutoff).Select(e => e.v).ToList();
        return samples.Count > 0 ? samples.Average() : (_lastSnapshot?.Cpu.Total ?? 0f);
    }

    // ─── RAM ──────────────────────────────────────────────────────────────────

    private RamMetrics GetRamMetrics()
    {
        var ram = new RamMetrics();

        // Try LibreHardwareMonitor first
        var ramHardware = _computer!.Hardware
            .FirstOrDefault(h => h.HardwareType == HardwareType.Memory);

        if (ramHardware != null)
        {
            foreach (var sensor in ramHardware.Sensors)
            {
                if (sensor.SensorType == SensorType.Load && sensor.Name == "Memory")
                    ram.UsedPercent = sensor.Value ?? 0f;
                else if (sensor.SensorType == SensorType.Data)
                {
                    if (sensor.Name == "Memory Used")
                        ram.Used = sensor.Value ?? 0f;
                    else if (sensor.Name == "Memory Available")
                        ram.Available = sensor.Value ?? 0f;
                }
            }
            ram.Total = ram.Used + ram.Available;
        }
        else
        {
            // Fallback: OS-level GC info
            var gcInfo = GC.GetGCMemoryInfo();
            ram.Total = (float)(gcInfo.TotalAvailableMemoryBytes / 1_073_741_824.0);
            ram.Used = (float)(gcInfo.MemoryLoadBytes / 1_073_741_824.0);
            ram.Available = ram.Total - ram.Used;
            ram.UsedPercent = ram.Total > 0 ? (ram.Used / ram.Total) * 100f : 0f;
        }

        return ram;
    }

    // ─── GPU ──────────────────────────────────────────────────────────────────

    private GpuMetrics GetGpuMetrics()
    {
        var gpu = new GpuMetrics();
        var gpuList = _computer!.Hardware
            .Where(h => h.HardwareType == HardwareType.GpuNvidia
                     || h.HardwareType == HardwareType.GpuAmd
                     || h.HardwareType == HardwareType.GpuIntel)
            .ToList();

        if (gpuList.Count == 0) return gpu;

        // Priority: Nvidia > AMD > Intel
        var gpuHardware = gpuList.FirstOrDefault(h => h.HardwareType == HardwareType.GpuNvidia)
                       ?? gpuList.FirstOrDefault(h => h.HardwareType == HardwareType.GpuAmd)
                       ?? gpuList.First();

        gpu.Name = gpuHardware.Name;

        foreach (var sensor in gpuHardware.Sensors)
        {
            switch (sensor.SensorType)
            {
                case SensorType.Load:
                    if (sensor.Name == "GPU Core")
                        gpu.UsagePercent = sensor.Value ?? 0f;
                    else if (sensor.Name is "GPU Memory" or "GPU Memory Controller")
                        gpu.MemUsedPercent = sensor.Value ?? 0f;
                    break;

                case SensorType.SmallData:
                    if (sensor.Name == "GPU Memory Used")
                        gpu.MemUsed = sensor.Value ?? 0f;
                    else if (sensor.Name is "GPU Memory Total" or "GPU Memory Capacity")
                        gpu.MemTotal = sensor.Value ?? 0f;
                    break;

                case SensorType.Data:
                    // Some GPUs report memory in GB under SensorType.Data
                    if (sensor.Name == "GPU Memory Used" && gpu.MemUsed == 0)
                        gpu.MemUsed = (sensor.Value ?? 0f) * 1024f; // GB → MB
                    else if (sensor.Name is "GPU Memory Total" or "GPU Memory Capacity" && gpu.MemTotal == 0)
                        gpu.MemTotal = (sensor.Value ?? 0f) * 1024f;
                    break;
            }
        }

        // Calculate MemUsedPercent if not directly available
        if (gpu.MemUsedPercent == 0 && gpu.MemTotal > 0)
            gpu.MemUsedPercent = (gpu.MemUsed / gpu.MemTotal) * 100f;

        return gpu;
    }

    // ─── Disk ─────────────────────────────────────────────────────────────────

    private DiskMetrics GetDiskMetrics()
    {
        var disk = new DiskMetrics();

        try
        {
            // Usage from OS DriveInfo
            var drive = DriveInfo.GetDrives()
                .FirstOrDefault(d => d.IsReady && d.DriveType == DriveType.Fixed);

            if (drive != null)
            {
                disk.DriveName   = drive.Name;
                disk.Total       = (float)(drive.TotalSize / 1_073_741_824.0);
                disk.Used        = (float)((drive.TotalSize - drive.AvailableFreeSpace) / 1_073_741_824.0);
                disk.UsedPercent = disk.Total > 0 ? (disk.Used / disk.Total) * 100f : 0f;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read disk usage");
        }

        // I/O throughput from LibreHardwareMonitor storage hardware
        try
        {
            var storageList = _computer!.Hardware
                .Where(h => h.HardwareType == HardwareType.Storage)
                .ToList();

            float totalReadMbps  = 0f;
            float totalWriteMbps = 0f;

            foreach (var storage in storageList)
            {
                foreach (var sensor in storage.Sensors)
                {
                    if (sensor.SensorType == SensorType.Throughput)
                    {
                        if (sensor.Name.Contains("Read",  StringComparison.OrdinalIgnoreCase))
                            totalReadMbps  += (sensor.Value ?? 0f) / 1024f; // KB/s → MB/s
                        else if (sensor.Name.Contains("Write", StringComparison.OrdinalIgnoreCase))
                            totalWriteMbps += (sensor.Value ?? 0f) / 1024f;
                    }
                    else if (sensor.SensorType == SensorType.Data)
                    {
                        // Some drives report in MB/s under Data type
                        if (sensor.Name.Contains("Read",  StringComparison.OrdinalIgnoreCase) && disk.ReadMbps  == 0)
                            totalReadMbps  += sensor.Value ?? 0f;
                        else if (sensor.Name.Contains("Write", StringComparison.OrdinalIgnoreCase) && disk.WriteMbps == 0)
                            totalWriteMbps += sensor.Value ?? 0f;
                    }
                }
            }

            if (totalReadMbps  > 0) disk.ReadMbps  = totalReadMbps;
            if (totalWriteMbps > 0) disk.WriteMbps = totalWriteMbps;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read disk I/O speeds");
        }

        return disk;
    }

    // ─── Network ──────────────────────────────────────────────────────────────

    private NetworkMetrics GetNetworkMetrics()
    {
        var net = new NetworkMetrics();

        try
        {
            var now     = DateTime.UtcNow;
            var elapsed = (now - _prevNetworkCheck).TotalSeconds;

            var interfaces = NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up
                         && n.NetworkInterfaceType != NetworkInterfaceType.Loopback
                         && n.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .OrderByDescending(n => n.Speed)   // prefer fastest adapter
                .ToList();

            if (!interfaces.Any()) return net;

            var primary = interfaces.First();
            var stats   = primary.GetIPv4Statistics();

            if (elapsed > 0 && _prevBytesReceived > 0)
            {
                var deltaRx = Math.Max(0, stats.BytesReceived - _prevBytesReceived);
                var deltaTx = Math.Max(0, stats.BytesSent     - _prevBytesSent);
                // bytes/sec → Mbps  (1 Mbps = 131072 bytes/sec)
                net.DownloadMbps = (float)(deltaRx / elapsed / 131072.0);
                net.UploadMbps   = (float)(deltaTx / elapsed / 131072.0);
            }

            net.AdapterName       = primary.Name;
            _prevBytesReceived    = stats.BytesReceived;
            _prevBytesSent        = stats.BytesSent;
            _prevNetworkCheck     = now;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read network throughput");
        }

        // Measure latency (ping 8.8.8.8, 1 attempt, 1s timeout)
        try
        {
            using var ping   = new Ping();
            var reply        = ping.Send("8.8.8.8", 1000);
            net.LatencyMs    = reply?.Status == IPStatus.Success ? (float)reply.RoundtripTime : 999f;
        }
        catch
        {
            net.LatencyMs = 999f; // treat unreachable as very high latency
        }

        return net;
    }

    // ─── Temperatures ─────────────────────────────────────────────────────────

    private TemperatureMetrics GetTemperatures()
    {
        var temps = new TemperatureMetrics();

        // CPU temperature — take the max across all temp sensors
        var cpuHardware = _computer!.Hardware
            .FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);

        if (cpuHardware != null)
        {
            var maxTemp = cpuHardware.Sensors
                .Where(s => s.SensorType == SensorType.Temperature && s.Value.HasValue)
                .MaxBy(s => s.Value!.Value);

            temps.Cpu = maxTemp?.Value ?? 0f;
        }

        // GPU temperature — GPU Core sensor
        var gpuList = _computer!.Hardware
            .Where(h => h.HardwareType == HardwareType.GpuNvidia
                     || h.HardwareType == HardwareType.GpuAmd
                     || h.HardwareType == HardwareType.GpuIntel)
            .ToList();

        var gpuHardware = gpuList.FirstOrDefault(h => h.HardwareType == HardwareType.GpuNvidia)
                       ?? gpuList.FirstOrDefault(h => h.HardwareType == HardwareType.GpuAmd)
                       ?? gpuList.FirstOrDefault();

        if (gpuHardware != null)
        {
            var gpuTemp = gpuHardware.Sensors
                .FirstOrDefault(s => s.SensorType == SensorType.Temperature
                                  && s.Name.Contains("GPU Core", StringComparison.OrdinalIgnoreCase));

            // Fallback: any GPU temp sensor
            gpuTemp ??= gpuHardware.Sensors
                .FirstOrDefault(s => s.SensorType == SensorType.Temperature);

            temps.Gpu = gpuTemp?.Value ?? 0f;
        }

        return temps;
    }

    // ─── Fallback (no LibreHardwareMonitor) ───────────────────────────────────

    private HardwareSnapshot GetFallbackSnapshot()
    {
        var snap = new HardwareSnapshot
        {
            Cpu          = new CpuMetrics { Name = Environment.MachineName },
            Ram          = GetFallbackRam(),
            Gpu          = new GpuMetrics(),
            Disk         = GetFallbackDisk(),
            Network      = new NetworkMetrics { LatencyMs = 999f },
            Temperatures = new TemperatureMetrics()
        };
        _lastSnapshot = snap;
        return snap;
    }

    private static RamMetrics GetFallbackRam()
    {
        var info = GC.GetGCMemoryInfo();
        float total = (float)(info.TotalAvailableMemoryBytes / 1_073_741_824.0);
        float used  = (float)(info.MemoryLoadBytes / 1_073_741_824.0);
        return new RamMetrics
        {
            Total        = total,
            Used         = used,
            Available    = total - used,
            UsedPercent  = total > 0 ? (used / total) * 100f : 0f
        };
    }

    private static DiskMetrics GetFallbackDisk()
    {
        try
        {
            var drive = DriveInfo.GetDrives().FirstOrDefault(d => d.IsReady && d.DriveType == DriveType.Fixed);
            if (drive == null) return new DiskMetrics();
            float total = (float)(drive.TotalSize / 1_073_741_824.0);
            float used  = (float)((drive.TotalSize - drive.AvailableFreeSpace) / 1_073_741_824.0);
            return new DiskMetrics { DriveName = drive.Name, Total = total, Used = used, UsedPercent = total > 0 ? (used / total) * 100f : 0f };
        }
        catch { return new DiskMetrics(); }
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    public void Close()
    {
        _computer?.Close();
    }

    public void Dispose()
    {
        Close();
        GC.SuppressFinalize(this);
    }
}

// ─── Update Visitor ───────────────────────────────────────────────────────────

internal class UpdateVisitor : IVisitor
{
    public void VisitComputer(IComputer computer) => computer.Traverse(this);
    public void VisitHardware(IHardware hardware)
    {
        hardware.Update();
        foreach (IHardware sub in hardware.SubHardware)
            sub.Accept(this);
    }
    public void VisitSensor(ISensor sensor) { }
    public void VisitParameter(IParameter parameter) { }
}
