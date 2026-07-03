namespace ClusterOSAgent;

public class AgentConfig
{
    public string FirebaseProjectId { get; set; } = "cluster300809";
    public string FirebaseDatabaseUrl { get; set; } = "https://cluster300809-default-rtdb.firebaseio.com";
    public string FirebaseApiKey { get; set; } = "AIzaSyCztIY9eLPlUZ9c0YOlnd3vGEayMASBfT8";
    public string ServiceAccountPath { get; set; } = "serviceAccount.json";
    public int MetricsIntervalSeconds { get; set; } = 5;
    public int CommandPollIntervalSeconds { get; set; } = 2;
    public string DeviceConfigPath { get; set; } = "device.json";
}
