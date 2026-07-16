using ClusterOSAgent.Models;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using System.Net.Http.Headers;
using System.Text;

namespace ClusterOSAgent.Firebase;

/// <summary>
/// Communicates with Firebase Realtime Database via REST API.
/// The agent writes metrics, processes, reads pending commands, and streams job output.
/// </summary>
public class RealtimeDbClient
{
    private readonly ILogger<RealtimeDbClient> _logger;
    private readonly HttpClient _http;
    private string _databaseUrl = "";
    private string _apiKey = "";
    private string? _idToken;

    public RealtimeDbClient(ILogger<RealtimeDbClient> logger)
    {
        _logger = logger;
        _http = new HttpClient();
        _http.Timeout = TimeSpan.FromSeconds(15);
    }

    public Task InitializeAsync(string databaseUrl, string apiKey)
    {
        _databaseUrl = databaseUrl.TrimEnd('/');
        _apiKey = apiKey;
        _logger.LogInformation("RTDB client initialized for {Url}", _databaseUrl);
        return Task.CompletedTask;
    }

    public void SetAuthToken(string idToken)
    {
        _idToken = idToken;
    }

    public async Task PublishMetricsAsync(string deviceId, SystemSnapshot snapshot)
    {
        var json = JsonConvert.SerializeObject(snapshot, new JsonSerializerSettings
        {
            ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver()
        });
        await PutAsync($"/devices/{deviceId}/metrics.json", json);
    }

    public async Task PublishProcessesAsync(string deviceId, List<ProcessInfo> processes)
    {
        var json = JsonConvert.SerializeObject(processes, new JsonSerializerSettings
        {
            ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver()
        });
        await PutAsync($"/devices/{deviceId}/processes.json", json);
    }

    public async Task SetDeviceOnlineAsync(string deviceId, bool online)
    {
        var payload = JsonConvert.SerializeObject(new
        {
            status = online ? "online" : "offline",
            lastSeen = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await PatchAsync($"/devices/{deviceId}/metrics.json", payload);
    }

    public async Task<List<CommandModel>> GetPendingCommandsAsync(string deviceId)
    {
        var response = await GetAsync($"/devices/{deviceId}/pendingCommands.json");
        if (string.IsNullOrWhiteSpace(response) || response == "null")
            return new List<CommandModel>();

        try
        {
            var dict = JsonConvert.DeserializeObject<Dictionary<string, CommandModel>>(response);
            if (dict == null) return new List<CommandModel>();

            return dict.Select(kvp =>
            {
                kvp.Value.CommandId = kvp.Key;
                return kvp.Value;
            }).ToList();
        }
        catch
        {
            return new List<CommandModel>();
        }
    }

    public async Task AcknowledgeCommandAsync(string deviceId, string commandId, string status, string output = "")
    {
        // Remove from pendingCommands
        await DeleteAsync($"/devices/{deviceId}/pendingCommands/{commandId}.json");

        // Update result
        var result = JsonConvert.SerializeObject(new
        {
            status,
            output,
            completedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await PatchAsync($"/devices/{deviceId}/commandResults/{commandId}.json", result);
    }

    public async Task UpdateCommandStatusAsync(string deviceId, string commandId, string status)
    {
        var payload = JsonConvert.SerializeObject(new
        {
            status = status
        });
        await PatchAsync($"/devices/{deviceId}/commandResults/{commandId}.json", payload);
    }

    /// <summary>
    /// Stream a single output line to RTDB for real-time display on the dashboard.
    /// Stored at: devices/{deviceId}/jobOutput/{commandId}/{lineIndex}
    /// </summary>
    public async Task AppendJobOutputLineAsync(string deviceId, string commandId, int lineIndex, string text)
    {
        var payload = JsonConvert.SerializeObject(new
        {
            text = text.Length > 2000 ? text[..2000] : text, // cap line length
            ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        // Use PUT with numeric index as key so ordering is deterministic
        await PutAsync($"/devices/{deviceId}/jobOutput/{commandId}/{lineIndex}.json", payload);
    }

    /// <summary>
    /// Clear job output after completion (optional cleanup).
    /// </summary>
    public async Task ClearJobOutputAsync(string deviceId, string commandId)
    {
        await DeleteAsync($"/devices/{deviceId}/jobOutput/{commandId}.json");
    }

    public async Task PublishJobArtifactsAsync(string deviceId, string commandId, List<Dictionary<string, object>> artifacts)
    {
        var json = JsonConvert.SerializeObject(artifacts, new JsonSerializerSettings
        {
            ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver()
        });
        await PutAsync($"/devices/{deviceId}/jobArtifacts/{commandId}.json", json);
    }

    public async Task RegisterPairCodeAsync(string deviceId, string pairCode, string machineName)
    {
        var payload = JsonConvert.SerializeObject(new
        {
            deviceId,
            pairCode,
            machineName,
            status = "waiting",
            createdAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        });
        await PutAsync($"/pairCodes/{pairCode}.json", payload);
    }

    public async Task<bool> CheckPairCodeExistsAsync(string pairCode)
    {
        try
        {
            var response = await GetAsync($"/pairCodes/{pairCode}.json");
            if (string.IsNullOrWhiteSpace(response) || response.Trim() == "null")
                return false;
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to check if pair code exists in RTDB");
            return false;
        }
    }

    public async Task SetDevicePairedAsync(string deviceId, bool paired)
    {
        var payload = JsonConvert.SerializeObject(new
        {
            paired = paired
        });
        await PatchAsync($"/devices/{deviceId}.json", payload);
    }

    public async Task<bool> CheckDevicePairedAsync(string deviceId)
    {
        try
        {
            var response = await GetAsync($"/devices/{deviceId}/paired.json");
            if (string.IsNullOrWhiteSpace(response) || response.Trim() == "null")
                return false;
            return response.Trim().ToLower() == "true";
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to check if device is paired in RTDB");
            return false;
        }
    }

    public async Task<ActiveRentalSession?> GetActiveRentalSessionAsync(string deviceId)
    {
        try
        {
            var response = await GetAsync($"/devices/{deviceId}/activeRentalSession.json");
            if (string.IsNullOrWhiteSpace(response) || response.Trim() == "null")
                return null;
            return JsonConvert.DeserializeObject<ActiveRentalSession>(response);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get active rental session from RTDB");
            return null;
        }
    }

    public async Task UpdateActiveRentalSessionAsync(string deviceId, ActiveRentalSession session)
    {
        var json = JsonConvert.SerializeObject(session, new JsonSerializerSettings
        {
            ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver()
        });
        await PutAsync($"/devices/{deviceId}/activeRentalSession.json", json);
    }

    public async Task UpdateGlobalRentalSessionAsync(string sessionId, ActiveRentalSession session)
    {
        var json = JsonConvert.SerializeObject(session, new JsonSerializerSettings
        {
            ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver()
        });
        await PutAsync($"/rentals/{sessionId}.json", json);
    }

    public async Task DeleteActiveRentalSessionAsync(string deviceId)
    {
        await DeleteAsync($"/devices/{deviceId}/activeRentalSession.json");
    }

    // ─── Private HTTP helpers ────────────────────────────────────────────────

    private async Task<string> GetAsync(string path)
    {
        var url = BuildUrl(path);
        var response = await _http.GetAsync(url);
        return await response.Content.ReadAsStringAsync();
    }

    private async Task PutAsync(string path, string json)
    {
        var url = BuildUrl(path);
        var content = new StringContent(json, Encoding.UTF8, "application/json");
        var response = await _http.PutAsync(url, content);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            _logger.LogWarning("RTDB PUT failed {Status}: {Body}", response.StatusCode, body);
        }
    }

    private async Task PatchAsync(string path, string json)
    {
        var url = BuildUrl(path);
        var request = new HttpRequestMessage(new HttpMethod("PATCH"), url)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
        var response = await _http.SendAsync(request);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync();
            _logger.LogWarning("RTDB PATCH failed {Status}: {Body}", response.StatusCode, body);
        }
    }

    private async Task DeleteAsync(string path)
    {
        var url = BuildUrl(path);
        await _http.DeleteAsync(url);
    }

    private string BuildUrl(string path)
    {
        var url = $"{_databaseUrl}{path}";
        if (!string.IsNullOrEmpty(_idToken))
            url += $"?auth={_idToken}";
        return url;
    }
}
