using ClusterOSAgent.Firebase;
using ClusterOSAgent.Hardware;
using ClusterOSAgent.Models;
using Microsoft.Extensions.Logging;

namespace ClusterOSAgent.Commands;

public class CommandHandler
{
    private readonly ILogger<CommandHandler> _logger;
    private readonly RealtimeDbClient _rtdbClient;
    private readonly CommandExecutor _executor;
    private readonly SemaphoreSlim _lock = new(1, 1);

    /// <summary>
    /// Fired when a job starts on this device.
    /// Args: (commandId, commandType)
    /// </summary>
    public event Action<string, string>? JobStarted;

    /// <summary>
    /// Fired when a job finishes (success or failure).
    /// </summary>
    public event Action<string, bool>? JobFinished;

    public CommandHandler(
        ILogger<CommandHandler> logger,
        RealtimeDbClient rtdbClient,
        CommandExecutor executor)
    {
        _logger = logger;
        _rtdbClient = rtdbClient;
        _executor = executor;
    }

    public async Task PollAndExecuteAsync(string deviceId, CancellationToken ct)
    {
        if (ct.IsCancellationRequested) return;

        // Prevent concurrent executions
        if (!await _lock.WaitAsync(0)) return;

        try
        {
            var commands = await _rtdbClient.GetPendingCommandsAsync(deviceId);

            foreach (var command in commands)
            {
                if (ct.IsCancellationRequested) break;

                _logger.LogInformation("Executing command: {Type} (ID: {Id})", command.Type, command.CommandId);

                // Notify UI that a job is starting
                if (command.Type is "run_script" or "run_exe" or "run_cmd")
                {
                    JobStarted?.Invoke(command.CommandId, command.Type);
                }

                try
                {
                    var (success, output) = await _executor.ExecuteAsync(deviceId, command, ct);
                    var status = success ? "success" : "failed";

                    await _rtdbClient.AcknowledgeCommandAsync(deviceId, command.CommandId, status, output);
                    _logger.LogInformation("Command {Id} completed with status: {Status}", command.CommandId, status);

                    // Notify UI that job finished
                    if (command.Type is "run_script" or "run_exe" or "run_cmd")
                    {
                        JobFinished?.Invoke(command.CommandId, success);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Command {Id} threw an exception", command.CommandId);
                    await _rtdbClient.AcknowledgeCommandAsync(deviceId, command.CommandId, "failed", ex.Message);
                    JobFinished?.Invoke(command.CommandId, false);
                }
            }
        }
        finally
        {
            _lock.Release();
        }
    }
}
