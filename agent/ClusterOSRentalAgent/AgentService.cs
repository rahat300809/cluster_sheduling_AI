using ClusterOSAgent.Firebase;
using ClusterOSAgent.Hardware;
using ClusterOSAgent.Commands;
using ClusterOSAgent.Models;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ClusterOSAgent;

public class AgentService : BackgroundService
{
    private readonly ILogger<AgentService> _logger;
    private readonly AgentConfig _config;
    private readonly DevicePairingService _pairingService;
    private readonly FirebaseClient _firebaseClient;
    private readonly RealtimeDbClient _rtdbClient;
    private readonly HardwareMonitor _hardwareMonitor;
    private readonly ProcessMonitor _processMonitor;
    private readonly CommandHandler _commandHandler;

    private DeviceIdentity? _identity;
    public DeviceIdentity? Identity => _identity;
    private System.Threading.Timer? _metricsTimer;
    private System.Threading.Timer? _commandTimer;
    private System.Threading.Timer? _rentalTimer;

    // Rental fields
    private ActiveRentalSession? _activeSession;
    public ActiveRentalSession? ActiveSession => _activeSession;
    private int _sessionElapsedSeconds = 0;
    private double _sessionEarnedBalance = 0;

    public event Action<ActiveRentalSession?>? RentalSessionChanged;

    public AgentService(
        ILogger<AgentService> logger,
        IOptions<AgentConfig> config,
        DevicePairingService pairingService,
        FirebaseClient firebaseClient,
        RealtimeDbClient rtdbClient,
        HardwareMonitor hardwareMonitor,
        ProcessMonitor processMonitor,
        CommandHandler commandHandler)
    {
        _logger = logger;
        _config = config.Value;
        _pairingService = pairingService;
        _firebaseClient = firebaseClient;
        _rtdbClient = rtdbClient;
        _hardwareMonitor = hardwareMonitor;
        _processMonitor = processMonitor;
        _commandHandler = commandHandler;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ClusterOS Rental Agent starting...");

        // Step 1: Initialize device identity (generate or load)
        _identity = await _pairingService.GetOrCreateIdentityAsync();
        _logger.LogInformation("Device ID: {DeviceId}, Pair Code: {PairCode}",
            _identity.DeviceId, _identity.PairCode);

        // Step 2: Initialize Firebase
        await _firebaseClient.InitializeAsync(_config.ServiceAccountPath, _config.FirebaseProjectId);
        await _rtdbClient.InitializeAsync(_config.FirebaseDatabaseUrl, _config.FirebaseApiKey);

        // Handle pairing initialization
        if (!_identity.IsPaired)
        {
            try
            {
                bool isAlreadyPaired = await _rtdbClient.CheckDevicePairedAsync(_identity.DeviceId);
                if (isAlreadyPaired)
                {
                    _logger.LogInformation("Device is already marked as paired in RTDB. Syncing state locally.");
                    await _pairingService.MarkAsPairedAsync(_identity.DeviceId, "dashboard_user");
                    _identity = _pairingService.CurrentIdentity;
                }
                else
                {
                    bool codeExists = await _rtdbClient.CheckPairCodeExistsAsync(_identity.PairCode);
                    if (!codeExists)
                    {
                        if (!_identity.IsRegistered)
                        {
                            _logger.LogInformation("Registering pair code {PairCode} for device {DeviceId} in RTDB", _identity.PairCode, _identity.DeviceId);
                            await _rtdbClient.RegisterPairCodeAsync(_identity.DeviceId, _identity.PairCode, _identity.MachineName);
                            await _pairingService.MarkAsRegisteredAsync();
                        }
                        else
                        {
                            // It was registered, but it is not in the database anymore.
                            // This means the dashboard consumed/deleted it, meaning the device has been successfully paired!
                            _logger.LogInformation("Pair code not found in RTDB but marked as registered locally. Transitioning to paired state.");
                            await _pairingService.MarkAsPairedAsync(_identity.DeviceId, "dashboard_user");
                            _identity = _pairingService.CurrentIdentity; // reload local reference
                        }
                    }
                    else if (!_identity.IsRegistered)
                    {
                        // If it exists in RTDB but locally we didn't save it as registered, sync local status.
                        await _pairingService.MarkAsRegisteredAsync();
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to initialize pair code status");
            }
        }

        // Step 3: Initialize hardware monitor
        _hardwareMonitor.Initialize();

        // Step 4: Register device in RTDB (mark as online)
        try
        {
            if (_identity != null)
                await _rtdbClient.SetDeviceOnlineAsync(_identity.DeviceId, true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to register device online in RTDB");
        }

        // Step 5: Start metrics collection loop
        _metricsTimer = new System.Threading.Timer(
            async _ => await CollectAndPublishMetricsAsync(stoppingToken),
            null,
            TimeSpan.Zero,
            TimeSpan.FromSeconds(_config.MetricsIntervalSeconds));

        // Step 6: Start command polling loop
        _commandTimer = new System.Threading.Timer(
            async _ => { if (_identity != null) await _commandHandler.PollAndExecuteAsync(_identity.DeviceId, stoppingToken); },
            null,
            TimeSpan.FromSeconds(2),
            TimeSpan.FromSeconds(_config.CommandPollIntervalSeconds));

        // Step 7: Start rental polling loop (every 2s)
        _rentalTimer = new System.Threading.Timer(
            async _ => { if (_identity != null) await PollRentalSessionAsync(stoppingToken); },
            null,
            TimeSpan.FromSeconds(2),
            TimeSpan.FromSeconds(2));

        // Keep running until cancellation
        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("ClusterOS Rental Agent stopping...");
        }
        finally
        {
            _metricsTimer?.Dispose();
            _commandTimer?.Dispose();
            _rentalTimer?.Dispose();
            _hardwareMonitor.Close();

            // On shutdown: if a fixed session was running and not finished, mark it as cancelled/violated
            if (_identity != null && _activeSession != null && _activeSession.Status == "running")
            {
                try
                {
                    if (_activeSession.Mode == "fixed" && _activeSession.ElapsedSeconds < _activeSession.DurationMinutes * 60)
                    {
                        _activeSession.Status = "cancelled"; // early close = penalty (no pay)
                        await _rtdbClient.UpdateActiveRentalSessionAsync(_identity.DeviceId, _activeSession);
                        await _rtdbClient.UpdateGlobalRentalSessionAsync(_activeSession.SessionId, _activeSession);
                    }
                    else if (_activeSession.Mode == "pay_as_you_go")
                    {
                        _activeSession.Status = "stopped"; // pay as you go can be stopped anytime cleanly
                        await _rtdbClient.UpdateActiveRentalSessionAsync(_identity.DeviceId, _activeSession);
                        await _rtdbClient.UpdateGlobalRentalSessionAsync(_activeSession.SessionId, _activeSession);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to update rental status on exit");
                }
            }

            // Mark device as offline
            if (_identity != null)
                await _rtdbClient.SetDeviceOnlineAsync(_identity.DeviceId, false);
        }
    }

    private async Task CollectAndPublishMetricsAsync(CancellationToken ct)
    {
        if (_identity == null || ct.IsCancellationRequested) return;

        // Check pairing status dynamically
        try
        {
            bool isPairedInDb = await _rtdbClient.CheckDevicePairedAsync(_identity.DeviceId);
            
            if (isPairedInDb)
            {
                if (!_identity.IsPaired)
                {
                    _logger.LogInformation("Device is now paired in RTDB!");
                    await _pairingService.MarkAsPairedAsync(_identity.DeviceId, "dashboard_user");
                    _identity = _pairingService.CurrentIdentity; // reload local reference
                }
            }
            else
            {
                if (_identity.IsPaired)
                {
                    _logger.LogInformation("Device was unpaired from dashboard. Reverting to unpaired state.");
                    await _pairingService.UnpairAsync();
                    _identity = _pairingService.CurrentIdentity; // reload local reference
                    if (_identity == null) return;
                    
                    // Register the new pair code
                    _logger.LogInformation("Re-registering pair code {PairCode} in RTDB", _identity.PairCode);
                    await _rtdbClient.RegisterPairCodeAsync(_identity.DeviceId, _identity.PairCode, _identity.MachineName);
                    await _pairingService.MarkAsRegisteredAsync();
                    _identity = _pairingService.CurrentIdentity; // reload local reference
                }
                else
                {
                    bool codeExists = await _rtdbClient.CheckPairCodeExistsAsync(_identity.PairCode);
                    if (!codeExists && _identity.IsRegistered)
                    {
                        _logger.LogInformation("Pair code consumed. Device is now paired!");
                        await _pairingService.MarkAsPairedAsync(_identity.DeviceId, "dashboard_user");
                        _identity = _pairingService.CurrentIdentity; // reload local reference
                        if (_identity == null) return;
                        await _rtdbClient.SetDevicePairedAsync(_identity.DeviceId, true);
                    }
                    else if (!codeExists && !_identity.IsRegistered)
                    {
                        _logger.LogInformation("Registering pair code {PairCode} for device {DeviceId} in RTDB", _identity.PairCode, _identity.DeviceId);
                        await _rtdbClient.RegisterPairCodeAsync(_identity.DeviceId, _identity.PairCode, _identity.MachineName);
                        await _pairingService.MarkAsRegisteredAsync();
                        _identity = _pairingService.CurrentIdentity; // reload local reference
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to poll pairing/unpairing status from RTDB");
        }

        try
        {
            var metrics  = _hardwareMonitor.GetSnapshot();
            var processes = _processMonitor.GetTopProcesses(20);
            var now      = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            // ── Uptime ─────────────────────────────────────────────────────
            long uptimeSec = Environment.TickCount64 / 1000L;

            // ── Running tasks: count non-idle processes on the node ─────────
            int runningTasks = processes.Count(p => p.CpuPercent > 0.5f);

            // ── Compute health status ───────────────────────────────────────
            string health = "healthy";
            if (metrics.Temperatures.Cpu > 90f || metrics.Temperatures.Gpu > 90f
                || metrics.Ram.UsedPercent > 95f || metrics.Disk.UsedPercent > 95f)
                health = "critical";
            else if (metrics.Temperatures.Cpu > 75f || metrics.Temperatures.Gpu > 75f
                || metrics.Ram.UsedPercent > 85f || metrics.Disk.UsedPercent > 90f
                || metrics.Cpu.Total > 90f)
                health = "degraded";

            var snapshot = new SystemSnapshot
            {
                Timestamp      = now,
                HeartbeatAt    = now,
                UptimeSeconds  = uptimeSec,
                RunningTasks   = runningTasks,
                WaitingTasks   = 0,     // reserved for future queue tracking
                PowerPluggedIn = true,   // desktops are always plugged in
                HealthStatus   = health,
                Cpu            = metrics.Cpu,
                Ram            = metrics.Ram,
                Gpu            = metrics.Gpu,
                Disk           = metrics.Disk,
                Network        = metrics.Network,
                Temperatures   = metrics.Temperatures,
                Status         = "online"
            };

            if (_identity == null) return;
            await _rtdbClient.PublishMetricsAsync(_identity.DeviceId, snapshot);
            await _rtdbClient.PublishProcessesAsync(_identity.DeviceId, processes);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to collect/publish metrics");
        }
    }

    private async Task PollRentalSessionAsync(CancellationToken ct)
    {
        if (_identity == null || ct.IsCancellationRequested) return;

        try
        {
            var rtdbSession = await _rtdbClient.GetActiveRentalSessionAsync(_identity.DeviceId);
            
            if (rtdbSession == null)
            {
                if (_activeSession != null)
                {
                    _activeSession = null;
                    RentalSessionChanged?.Invoke(null);
                }
                return;
            }

            if (_activeSession == null || _activeSession.SessionId != rtdbSession.SessionId)
            {
                // New rental session started!
                _activeSession = rtdbSession;
                _sessionElapsedSeconds = rtdbSession.ElapsedSeconds;
                _sessionEarnedBalance = rtdbSession.EarnedBalance;

                _logger.LogInformation("Rental session {SessionId} started. Mode: {Mode}, Rate: {Rate}", 
                    rtdbSession.SessionId, rtdbSession.Mode, rtdbSession.HourlyRate);

                RentalSessionChanged?.Invoke(_activeSession);
            }
            else
            {
                // Check if session status updated in DB (e.g. cancelled/stopped by renter)
                if (rtdbSession.Status != "running")
                {
                    _logger.LogInformation("Rental session {SessionId} stopped from dashboard. Status: {Status}", 
                        rtdbSession.SessionId, rtdbSession.Status);
                    _activeSession = null;
                    RentalSessionChanged?.Invoke(null);
                    return;
                }

                // Increment elapsed time (polling runs every 2s)
                _sessionElapsedSeconds += 2;
                _activeSession.ElapsedSeconds = _sessionElapsedSeconds;
                
                // Calculate balance: (seconds / 3600) * hourlyRate
                _sessionEarnedBalance = (_sessionElapsedSeconds / 3600.0) * _activeSession.HourlyRate;
                _activeSession.EarnedBalance = Math.Round(_sessionEarnedBalance, 2);

                // Check if fixed session timer completed
                if (_activeSession.Mode == "fixed" && _sessionElapsedSeconds >= _activeSession.DurationMinutes * 60)
                {
                    _activeSession.Status = "completed";
                    _logger.LogInformation("Rental session {SessionId} completed successfully!", _activeSession.SessionId);
                }

                // Sync back to database (both device level and global rentals collection)
                await _rtdbClient.UpdateActiveRentalSessionAsync(_identity.DeviceId, _activeSession);
                await _rtdbClient.UpdateGlobalRentalSessionAsync(_activeSession.SessionId, _activeSession);

                RentalSessionChanged?.Invoke(_activeSession);

                if (_activeSession.Status == "completed")
                {
                    _activeSession = null;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in rental session polling");
        }
    }
}
