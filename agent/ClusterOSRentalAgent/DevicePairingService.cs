using ClusterOSAgent.Models;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

namespace ClusterOSAgent;

public class DevicePairingService
{
    private readonly ILogger<DevicePairingService> _logger;
    private const string DeviceConfigFile = "rental_device.json";
    private DeviceIdentity? _cachedIdentity;

    public DevicePairingService(ILogger<DevicePairingService> logger)
    {
        _logger = logger;
    }

    public DeviceIdentity? CurrentIdentity => _cachedIdentity;

    public async Task<DeviceIdentity> GetOrCreateIdentityAsync()
    {
        if (_cachedIdentity != null) return _cachedIdentity;

        // Try to load existing identity
        if (File.Exists(DeviceConfigFile))
        {
            try
            {
                var json = await File.ReadAllTextAsync(DeviceConfigFile);
                var identity = JsonConvert.DeserializeObject<DeviceIdentity>(json);
                if (identity != null)
                {
                    _logger.LogInformation("Loaded existing device identity: {DeviceId}", identity.DeviceId);
                    _cachedIdentity = identity;
                    return identity;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to read device config, generating new identity");
            }
        }

        // Generate new identity
        var newIdentity = GenerateIdentity();
        await SaveIdentityAsync(newIdentity);
        _logger.LogInformation("Generated new device identity: {DeviceId} / {PairCode}",
            newIdentity.DeviceId, newIdentity.PairCode);

        // Print pair code to console for user visibility
        Console.WriteLine();
        Console.WriteLine("═══════════════════════════════════════");
        Console.WriteLine("  ClusterOS Rental Agent - First Launch ");
        Console.WriteLine("═══════════════════════════════════════");
        Console.WriteLine($"  Device ID:  {newIdentity.DeviceId}");
        Console.WriteLine($"  Pair Code:  {newIdentity.PairCode}");
        Console.WriteLine("═══════════════════════════════════════");
        Console.WriteLine("  Enter this pair code in the dashboard");
        Console.WriteLine("  to link this device to your account. ");
        Console.WriteLine("═══════════════════════════════════════");
        Console.WriteLine();

        _cachedIdentity = newIdentity;
        return newIdentity;
    }

    private DeviceIdentity GenerateIdentity()
    {
        var machineName = Environment.MachineName;
        var deviceId = $"PC-RNT-{GenerateShortId()}";
        var pairCode = GeneratePairCode();

        return new DeviceIdentity
        {
            DeviceId = deviceId,
            PairCode = pairCode,
            MachineName = machineName,
            CreatedAt = DateTime.UtcNow,
            IsPaired = false,
            IsRegistered = false
        };
    }

    private async Task SaveIdentityAsync(DeviceIdentity identity)
    {
        var json = JsonConvert.SerializeObject(identity, Formatting.Indented);
        await File.WriteAllTextAsync(DeviceConfigFile, json);
    }

    public async Task MarkAsRegisteredAsync()
    {
        if (!File.Exists(DeviceConfigFile)) return;

        try
        {
            var json = await File.ReadAllTextAsync(DeviceConfigFile);
            var identity = JsonConvert.DeserializeObject<DeviceIdentity>(json);
            if (identity == null) return;

            identity.IsRegistered = true;
            _cachedIdentity = identity;
            await SaveIdentityAsync(identity);
            _logger.LogInformation("Device pair code marked as registered locally.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to mark device as registered locally");
        }
    }

    public async Task MarkAsPairedAsync(string deviceId, string ownerUserId)
    {
        if (!File.Exists(DeviceConfigFile)) return;

        try
        {
            var json = await File.ReadAllTextAsync(DeviceConfigFile);
            var identity = JsonConvert.DeserializeObject<DeviceIdentity>(json);
            if (identity == null) return;

            identity.IsPaired = true;
            identity.IsRegistered = true;
            identity.OwnerUserId = ownerUserId;
            _cachedIdentity = identity;
            await SaveIdentityAsync(identity);
            _logger.LogInformation("Device successfully paired. Saved state locally.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save paired state locally");
        }
    }

    public async Task UnpairAsync()
    {
        if (!File.Exists(DeviceConfigFile)) return;

        try
        {
            var json = await File.ReadAllTextAsync(DeviceConfigFile);
            var identity = JsonConvert.DeserializeObject<DeviceIdentity>(json);
            if (identity == null) return;

            identity.IsPaired = false;
            identity.IsRegistered = false;
            identity.OwnerUserId = null;
            identity.PairCode = GeneratePairCode();

            _cachedIdentity = identity;
            await SaveIdentityAsync(identity);
            _logger.LogInformation("Device successfully unpaired locally. New pair code: {PairCode}", identity.PairCode);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to unpair device locally");
        }
    }

    private static string GenerateShortId()
    {
        return Guid.NewGuid().ToString("N")[..6].ToUpper();
    }

    private static string GeneratePairCode()
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Remove ambiguous chars
        var random = new Random();
        return new string(Enumerable.Range(0, 6)
            .Select(_ => chars[random.Next(chars.Length)])
            .ToArray());
    }
}
