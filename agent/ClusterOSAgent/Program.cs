using System;
using System.Windows.Forms;
using ClusterOSAgent;
using ClusterOSAgent.Commands;
using ClusterOSAgent.Firebase;
using ClusterOSAgent.Hardware;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace ClusterOSAgent;

public static class Program
{
    [STAThread]
    public static void Main(string[] args)
    {
        Directory.SetCurrentDirectory(AppContext.BaseDirectory);
        ApplicationConfiguration.Initialize();

        var builder = Host.CreateDefaultBuilder(args)
            .ConfigureServices((hostContext, services) =>
            {
                services.Configure<AgentConfig>(
                    hostContext.Configuration.GetSection("Agent"));

                services.AddSingleton<DevicePairingService>();
                services.AddSingleton<FirebaseClient>();
                services.AddSingleton<RealtimeDbClient>();
                services.AddSingleton<HardwareMonitor>();
                services.AddSingleton<ProcessMonitor>();
                services.AddSingleton<CommandExecutor>();
                services.AddSingleton<CommandHandler>();
                services.AddHostedService<AgentService>();
            });

        var host = builder.Build();

        // Start host in a background thread (non-blocking)
        host.StartAsync().GetAwaiter().GetResult();

        // Run the graphical MainForm on the UI thread
        Application.Run(new MainForm(host.Services));

        // Cleanly stop the background host when Form exits
        host.StopAsync().GetAwaiter().GetResult();
        host.Dispose();
    }
}
