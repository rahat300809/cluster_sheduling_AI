using FirebaseAdmin;
using FirebaseAdmin.Auth;
using Google.Apis.Auth.OAuth2;
using Microsoft.Extensions.Logging;
using System.Net.Http;
using System.Text;
using Newtonsoft.Json;

namespace ClusterOSAgent.Firebase;

public class FirebaseClient
{
    private readonly ILogger<FirebaseClient> _logger;
    private bool _initialized;

    public FirebaseClient(ILogger<FirebaseClient> logger)
    {
        _logger = logger;
    }

    public Task InitializeAsync(string serviceAccountPath, string projectId)
    {
        if (_initialized) return Task.CompletedTask;

        try
        {
            if (File.Exists(serviceAccountPath))
            {
                if (FirebaseApp.DefaultInstance == null)
                {
                    FirebaseApp.Create(new AppOptions
                    {
                        Credential = GoogleCredential.FromFile(serviceAccountPath),
                        ProjectId = projectId
                    });
                }
                _logger.LogInformation("Firebase Admin initialized with service account");
            }
            else
            {
                _logger.LogWarning("Service account file not found at {Path}. " +
                    "Running in anonymous mode (RTDB access may be limited).", serviceAccountPath);
            }

            _initialized = true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize Firebase Admin");
        }

        return Task.CompletedTask;
    }
}
