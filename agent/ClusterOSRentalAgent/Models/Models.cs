namespace ClusterOSAgent.Models;

public class DeviceIdentity
{
    public string DeviceId { get; set; } = "";
    public string PairCode { get; set; } = "";
    public string MachineName { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public bool IsPaired { get; set; }
    public bool IsRegistered { get; set; }
    public string? OwnerUserId { get; set; }
}

public class SystemSnapshot
{
    public long Timestamp { get; set; }
    public CpuMetrics Cpu { get; set; } = new();
    public RamMetrics Ram { get; set; } = new();
    public GpuMetrics Gpu { get; set; } = new();
    public DiskMetrics Disk { get; set; } = new();
    public NetworkMetrics Network { get; set; } = new();
    public TemperatureMetrics Temperatures { get; set; } = new();
    public string Status { get; set; } = "online";

    // ── Enhanced fields for intelligent scheduler ──────────────────────────
    /// <summary>Seconds since OS boot.</summary>
    public long UptimeSeconds { get; set; }

    /// <summary>Unix ms timestamp of this heartbeat (same as Timestamp).</summary>
    public long HeartbeatAt { get; set; }

    /// <summary>Number of currently running scheduler tasks on this node.</summary>
    public int RunningTasks { get; set; }

    /// <summary>Number of tasks waiting in queue on this node.</summary>
    public int WaitingTasks { get; set; }

    /// <summary>Historical job success rate 0-100. Written by dashboard, mirrored back.</summary>
    public float SuccessRate { get; set; } = 80f;

    /// <summary>Battery percent. Null if desktop (plugged, no battery).</summary>
    public float? BatteryPercent { get; set; }

    /// <summary>True if AC power connected (always true for desktops).</summary>
    public bool PowerPluggedIn { get; set; } = true;

    /// <summary>Computed node health: healthy / degraded / critical.</summary>
    public string HealthStatus { get; set; } = "healthy";
}

public class CpuMetrics
{
    public float Total { get; set; }
    public List<float> Cores { get; set; } = new();
    public string Name { get; set; } = "";

    // ── Rolling load averages (computed by agent) ──────────────────────────
    /// <summary>1-minute rolling average CPU load %.</summary>
    public float Load1 { get; set; }

    /// <summary>5-minute rolling average CPU load %.</summary>
    public float Load5 { get; set; }

    /// <summary>15-minute rolling average CPU load %.</summary>
    public float Load15 { get; set; }
}

public class RamMetrics
{
    public float UsedPercent { get; set; }
    public float Used { get; set; }       // GB
    public float Total { get; set; }      // GB
    public float Available { get; set; }  // GB
}

public class GpuMetrics
{
    public float UsagePercent { get; set; }
    public float MemUsedPercent { get; set; }
    public float MemUsed { get; set; }    // MB
    public float MemTotal { get; set; }   // MB
    public string Name { get; set; } = "";
}

public class DiskMetrics
{
    public float UsedPercent { get; set; }
    public float Used { get; set; }       // GB
    public float Total { get; set; }      // GB
    public string DriveName { get; set; } = "C:";

    // ── I/O throughput ─────────────────────────────────────────────────────
    /// <summary>Disk read speed in MB/s (from LibreHardwareMonitor or perfcounter).</summary>
    public float ReadMbps { get; set; }

    /// <summary>Disk write speed in MB/s.</summary>
    public float WriteMbps { get; set; }
}

public class NetworkMetrics
{
    public float UploadMbps { get; set; }
    public float DownloadMbps { get; set; }
    public string AdapterName { get; set; } = "";

    /// <summary>Round-trip latency in milliseconds (ping to 8.8.8.8).</summary>
    public float LatencyMs { get; set; }
}

public class TemperatureMetrics
{
    public float Cpu { get; set; }
    public float Gpu { get; set; }
}

public class ProcessInfo
{
    public int Pid { get; set; }
    public string Name { get; set; } = "";
    public float CpuPercent { get; set; }
    public long RamMB { get; set; }
    public string Status { get; set; } = "running";
}

public class CommandModel
{
    public string CommandId { get; set; } = "";
    public string Type { get; set; } = "";
    public Dictionary<string, object> Payload { get; set; } = new();
    public long IssuedAt { get; set; }
    public string Status { get; set; } = "pending";
}

public class HardwareSnapshot
{
    public CpuMetrics Cpu { get; set; } = new();
    public RamMetrics Ram { get; set; } = new();
    public GpuMetrics Gpu { get; set; } = new();
    public DiskMetrics Disk { get; set; } = new();
    public NetworkMetrics Network { get; set; } = new();
    public TemperatureMetrics Temperatures { get; set; } = new();
}

public class ActiveRentalSession
{
    public string SessionId { get; set; } = "";
    public string Status { get; set; } = ""; // "pending", "running", "completed", "cancelled", "failed"
    public string Mode { get; set; } = ""; // "fixed", "pay_as_you_go"
    public double HourlyRate { get; set; } = 100.0;
    public double DurationHours { get; set; } = 1.0;
    public double DurationMinutes { get; set; } = 60.0;
    public long StartTime { get; set; } // ms timestamp
    public int ElapsedSeconds { get; set; }
    public double EarnedBalance { get; set; }
}
