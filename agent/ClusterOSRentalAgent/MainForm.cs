using System;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using ClusterOSAgent.Hardware;
using ClusterOSAgent.Firebase;
using ClusterOSAgent.Models;

namespace ClusterOSAgent;

public class MainForm : Form
{
    private readonly IServiceProvider _services;
    private readonly DevicePairingService _pairingService;
    private readonly HardwareMonitor _hardwareMonitor;
    private readonly RealtimeDbClient _rtdbClient;
    private readonly ClusterOSAgent.Commands.CommandHandler _commandHandler;
    private readonly AgentService _agentService;
    private ClusterRunningPopup? _activePopup;

    // Controls
    private Panel _titleBar = null!;
    private Label _lblTitle = null!;
    private Button _btnMinimize = null!;
    private Button _btnClose = null!;

    private Panel _cardPairing = null!;
    private Label _lblDeviceIdTitle = null!;
    private Label _lblDeviceId = null!;
    private Label _lblPairCodeTitle = null!;
    private Label _lblPairCode = null!;
    private Button _btnCopyCode = null!;

    private Panel _cardStats = null!;
    private Label _lblCpu = null!;
    private Panel _barCpuBg = null!;
    private Panel _barCpuFill = null!;
    
    private Label _lblRam = null!;
    private Panel _barRamBg = null!;
    private Panel _barRamFill = null!;

    private Label _lblGpu = null!;
    private Panel _barGpuBg = null!;
    private Panel _barGpuFill = null!;

    private Label _lblTemps = null!;

    // Rental Card & Controls
    private Panel _cardRental = null!;
    private Label _lblRentalTimeTitle = null!;
    private Label _lblRentalTimer = null!;
    private Label _lblRentalEarnedTitle = null!;
    private Label _lblRentalEarned = null!;
    private Label _lblRentalRate = null!;
    private Label _lblRentalWarning = null!;

    private Panel _statusBar = null!;
    private Panel _statusDot = null!;
    private Label _lblStatusText = null!;

    private System.Windows.Forms.Timer _updateTimer = null!;
    private NotifyIcon _notifyIcon = null!;
    private ContextMenuStrip _trayMenu = null!;

    // Dragging support
    private bool _dragging;
    private Point _dragStartPoint = new Point(0, 0);

    public MainForm(IServiceProvider services)
    {
        _services = services;
        _pairingService = services.GetRequiredService<DevicePairingService>();
        _hardwareMonitor = services.GetRequiredService<HardwareMonitor>();
        _rtdbClient = services.GetRequiredService<RealtimeDbClient>();
        _commandHandler = services.GetRequiredService<ClusterOSAgent.Commands.CommandHandler>();
        _agentService = services.GetRequiredService<AgentService>();

        // Subscribe to job notifications
        _commandHandler.JobStarted += OnJobStarted;
        _commandHandler.JobFinished += OnJobFinished;

        // Subscribe to rental updates
        _agentService.RentalSessionChanged += OnRentalSessionChanged;

        InitializeComponent();
        LoadDeviceIdentity();
    }

    private void OnJobStarted(string commandId, string type)
    {
        // Show notification and popup on UI thread
        this.Invoke(() =>
        {
            if (_activePopup == null || _activePopup.IsDisposed)
            {
                _activePopup = new ClusterRunningPopup();
                _activePopup.Show();
            }

            _notifyIcon.ShowBalloonTip(
                10_000,
                "⚡ ClusterOS — Task Running",
                $"A remote workload is now executing on this PC.\n\n⚠ Please do NOT power off or restart during execution!",
                ToolTipIcon.Warning);

            // Also update status bar text
            _lblStatusText.Text = "⚡ Running remote job — Do NOT power off!";
            _lblStatusText.ForeColor = Color.FromArgb(251, 191, 36); // Amber
            _statusDot.BackColor = Color.FromArgb(245, 158, 11);
        });
    }

    private void OnJobFinished(string commandId, bool success)
    {
        this.Invoke(() =>
        {
            if (_activePopup != null && !_activePopup.IsDisposed)
            {
                _activePopup.Close();
                _activePopup = null;
            }

            _notifyIcon.ShowBalloonTip(
                5_000,
                success ? "✅ ClusterOS — Task Complete" : "❌ ClusterOS — Task Failed",
                success
                    ? "Remote workload finished successfully. Safe to power off."
                    : "Remote workload encountered an error. Check the dashboard for details.",
                success ? ToolTipIcon.Info : ToolTipIcon.Error);

            // Restore normal status
            _lblStatusText.Text = "Connected to Firebase RTDB • Streaming metrics";
            _lblStatusText.ForeColor = Color.FromArgb(187, 247, 208);
        });
    }

    private void InitializeComponent()
    {
        // Form properties
        this.Size = new Size(380, 480);
        this.FormBorderStyle = FormBorderStyle.None;
        this.BackColor = Color.FromArgb(10, 14, 26); // Deep slate-dark
        this.Text = "ClusterOS Agent";
        this.StartPosition = FormStartPosition.CenterScreen;
        this.DoubleBuffered = true;

        // Custom Title Bar
        _titleBar = new Panel
        {
            Size = new Size(this.Width, 40),
            Location = new Point(0, 0),
            BackColor = Color.FromArgb(17, 24, 39) // Slate-800
        };
        _titleBar.MouseDown += TitleBar_MouseDown;
        _titleBar.MouseMove += TitleBar_MouseMove;
        _titleBar.MouseUp += TitleBar_MouseUp;

        _lblTitle = new Label
        {
            Text = "ClusterOS Agent",
            ForeColor = Color.FromArgb(243, 244, 246),
            Font = new Font("Segoe UI", 10F, FontStyle.Bold),
            Location = new Point(12, 10),
            AutoSize = true
        };
        _lblTitle.MouseDown += TitleBar_MouseDown;
        _lblTitle.MouseMove += TitleBar_MouseMove;
        _lblTitle.MouseUp += TitleBar_MouseUp;

        _btnClose = new Button
        {
            Text = "✕",
            Size = new Size(30, 30),
            Location = new Point(this.Width - 36, 5),
            FlatStyle = FlatStyle.Flat,
            ForeColor = Color.FromArgb(156, 163, 175),
            Font = new Font("Segoe UI", 9F, FontStyle.Bold),
            Cursor = Cursors.Hand
        };
        _btnClose.FlatAppearance.BorderSize = 0;
        _btnClose.FlatAppearance.MouseOverBackColor = Color.FromArgb(239, 68, 68); // Red hover
        _btnClose.FlatAppearance.MouseDownBackColor = Color.FromArgb(185, 28, 28);
        _btnClose.Click += (s, e) => this.Close();

        _btnMinimize = new Button
        {
            Text = "—",
            Size = new Size(30, 30),
            Location = new Point(this.Width - 70, 5),
            FlatStyle = FlatStyle.Flat,
            ForeColor = Color.FromArgb(156, 163, 175),
            Font = new Font("Segoe UI", 8F, FontStyle.Bold),
            Cursor = Cursors.Hand
        };
        _btnMinimize.FlatAppearance.BorderSize = 0;
        _btnMinimize.FlatAppearance.MouseOverBackColor = Color.FromArgb(55, 65, 81);
        _btnMinimize.Click += (s, e) => this.WindowState = FormWindowState.Minimized;

        _titleBar.Controls.Add(_lblTitle);
        _titleBar.Controls.Add(_btnMinimize);
        _titleBar.Controls.Add(_btnClose);
        this.Controls.Add(_titleBar);

        // 1. Pairing Card (Glassmorphism Dark Look)
        _cardPairing = new Panel
        {
            Size = new Size(this.Width - 32, 160),
            Location = new Point(16, 56),
            BackColor = Color.FromArgb(22, 28, 45) // Card dark color
        };

        _lblDeviceIdTitle = new Label
        {
            Text = "DEVICE IDENTITY ID",
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8F, FontStyle.Bold),
            Location = new Point(16, 16),
            AutoSize = true
        };

        _lblDeviceId = new Label
        {
            Text = "PC-XXXXXX",
            ForeColor = Color.White,
            Font = new Font("Consolas", 12F, FontStyle.Bold),
            Location = new Point(16, 34),
            AutoSize = true
        };

        _lblPairCodeTitle = new Label
        {
            Text = "ENTER PAIR CODE ON DASHBOARD",
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8F, FontStyle.Bold),
            Location = new Point(16, 68),
            AutoSize = true
        };

        _lblPairCode = new Label
        {
            Text = "------",
            ForeColor = Color.FromArgb(34, 197, 94), // Green accent
            Font = new Font("Consolas", 26F, FontStyle.Bold),
            Location = new Point(12, 86),
            AutoSize = true
        };

        _btnCopyCode = new Button
        {
            Text = "Copy Code",
            Size = new Size(90, 32),
            Location = new Point(_cardPairing.Width - 106, 96),
            FlatStyle = FlatStyle.Flat,
            ForeColor = Color.FromArgb(243, 244, 246),
            Font = new Font("Segoe UI", 9F, FontStyle.Bold),
            Cursor = Cursors.Hand,
            BackColor = Color.FromArgb(37, 99, 235) // Blue-600
        };
        _btnCopyCode.FlatAppearance.BorderSize = 0;
        _btnCopyCode.FlatAppearance.MouseOverBackColor = Color.FromArgb(29, 78, 216);
        _btnCopyCode.Click += BtnCopyCode_Click;

        _cardPairing.Controls.Add(_lblDeviceIdTitle);
        _cardPairing.Controls.Add(_lblDeviceId);
        _cardPairing.Controls.Add(_lblPairCodeTitle);
        _cardPairing.Controls.Add(_lblPairCode);
        _cardPairing.Controls.Add(_btnCopyCode);
        this.Controls.Add(_cardPairing);

        // 2. Local Stats Card
        _cardStats = new Panel
        {
            Size = new Size(this.Width - 32, 200),
            Location = new Point(16, 232),
            BackColor = Color.FromArgb(22, 28, 45)
        };

        // CPU
        _lblCpu = new Label
        {
            Text = "CPU Usage: 0.0%",
            ForeColor = Color.FromArgb(243, 244, 246),
            Font = new Font("Segoe UI", 8.5F, FontStyle.Regular),
            Location = new Point(16, 12),
            AutoSize = true
        };

        _barCpuBg = new Panel
        {
            Size = new Size(_cardStats.Width - 32, 8),
            Location = new Point(16, 32),
            BackColor = Color.FromArgb(30, 41, 59)
        };
        _barCpuFill = new Panel
        {
            Size = new Size(0, 8),
            Location = new Point(0, 0),
            BackColor = Color.FromArgb(59, 130, 246) // Blue
        };
        _barCpuBg.Controls.Add(_barCpuFill);

        // RAM
        _lblRam = new Label
        {
            Text = "RAM Usage: 0.0%",
            ForeColor = Color.FromArgb(243, 244, 246),
            Font = new Font("Segoe UI", 8.5F, FontStyle.Regular),
            Location = new Point(16, 52),
            AutoSize = true
        };

        _barRamBg = new Panel
        {
            Size = new Size(_cardStats.Width - 32, 8),
            Location = new Point(16, 72),
            BackColor = Color.FromArgb(30, 41, 59)
        };
        _barRamFill = new Panel
        {
            Size = new Size(0, 8),
            Location = new Point(0, 0),
            BackColor = Color.FromArgb(139, 92, 246) // Purple
        };
        _barRamBg.Controls.Add(_barRamFill);

        // GPU
        _lblGpu = new Label
        {
            Text = "GPU Usage: 0.0%",
            ForeColor = Color.FromArgb(243, 244, 246),
            Font = new Font("Segoe UI", 8.5F, FontStyle.Regular),
            Location = new Point(16, 92),
            AutoSize = true
        };

        _barGpuBg = new Panel
        {
            Size = new Size(_cardStats.Width - 32, 8),
            Location = new Point(16, 112),
            BackColor = Color.FromArgb(30, 41, 59)
        };
        _barGpuFill = new Panel
        {
            Size = new Size(0, 8),
            Location = new Point(0, 0),
            BackColor = Color.FromArgb(245, 158, 11) // Amber
        };
        _barGpuBg.Controls.Add(_barGpuFill);

        // Temperatures
        _lblTemps = new Label
        {
            Text = "CPU Temp: --°C   |   GPU Temp: --°C",
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 9F, FontStyle.Bold),
            Location = new Point(16, 148),
            Size = new Size(_cardStats.Width - 32, 30),
            TextAlign = ContentAlignment.MiddleCenter
        };

        _cardStats.Controls.Add(_lblCpu);
        _cardStats.Controls.Add(_barCpuBg);
        _cardStats.Controls.Add(_lblRam);
        _cardStats.Controls.Add(_barRamBg);
        _cardStats.Controls.Add(_lblGpu);
        _cardStats.Controls.Add(_barGpuBg);
        _cardStats.Controls.Add(_lblTemps);
        this.Controls.Add(_cardStats);

        // Rental Card Panel
        _cardRental = new Panel
        {
            Size = new Size(this.Width - 32, 200),
            Location = new Point(16, 232),
            BackColor = Color.FromArgb(22, 28, 45),
            Visible = false
        };

        _lblRentalTimeTitle = new Label
        {
            Text = "REMAINING TIME",
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8F, FontStyle.Bold),
            Location = new Point(16, 12),
            AutoSize = true
        };

        _lblRentalTimer = new Label
        {
            Text = "00:00:00",
            ForeColor = Color.FromArgb(245, 158, 11),
            Font = new Font("Consolas", 24F, FontStyle.Bold),
            Location = new Point(12, 30),
            AutoSize = true
        };

        _lblRentalEarnedTitle = new Label
        {
            Text = "ESTIMATED SESSION EARNINGS",
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8F, FontStyle.Bold),
            Location = new Point(16, 76),
            AutoSize = true
        };

        _lblRentalEarned = new Label
        {
            Text = "৳ 0.00 Tk",
            ForeColor = Color.FromArgb(34, 197, 94),
            Font = new Font("Segoe UI", 20F, FontStyle.Bold),
            Location = new Point(14, 94),
            AutoSize = true
        };

        _lblRentalRate = new Label
        {
            Text = "Rate: ৳100 / hr  |  Mode: Fixed",
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8.5F, FontStyle.Regular),
            Location = new Point(16, 142),
            AutoSize = true
        };

        _lblRentalWarning = new Label
        {
            Text = "⚠️ Do not close agent or turn off PC!",
            ForeColor = Color.FromArgb(239, 68, 68),
            Font = new Font("Segoe UI", 7.5F, FontStyle.Bold),
            Location = new Point(16, 168),
            Size = new Size(_cardRental.Width - 32, 20),
            TextAlign = ContentAlignment.MiddleLeft
        };

        _cardRental.Controls.Add(_lblRentalTimeTitle);
        _cardRental.Controls.Add(_lblRentalTimer);
        _cardRental.Controls.Add(_lblRentalEarnedTitle);
        _cardRental.Controls.Add(_lblRentalEarned);
        _cardRental.Controls.Add(_lblRentalRate);
        _cardRental.Controls.Add(_lblRentalWarning);
        this.Controls.Add(_cardRental);

        // 3. Status Bar
        _statusBar = new Panel
        {
            Size = new Size(this.Width, 36),
            Location = new Point(0, this.Height - 36),
            BackColor = Color.FromArgb(17, 24, 39)
        };

        _statusDot = new Panel
        {
            Size = new Size(10, 10),
            Location = new Point(16, 13),
            BackColor = Color.FromArgb(156, 163, 175) // Muted gray initially
        };
        // Quick method to draw circle status dot
        _statusDot.Paint += (s, e) =>
        {
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var brush = new SolidBrush(_statusDot.BackColor);
            e.Graphics.FillEllipse(brush, 0, 0, _statusDot.Width - 1, _statusDot.Height - 1);
        };

        _lblStatusText = new Label
        {
            Text = "Connecting to Firebase...",
            ForeColor = Color.FromArgb(156, 163, 175),
            Font = new Font("Segoe UI", 8F),
            Location = new Point(32, 10),
            AutoSize = true
        };

        _statusBar.Controls.Add(_statusDot);
        _statusBar.Controls.Add(_lblStatusText);
        this.Controls.Add(_statusBar);

        // Setup System Tray Integration
        _trayMenu = new ContextMenuStrip();
        _trayMenu.Items.Add("Show Dashboard Control Panel", null, (s, e) => RestoreFromTray());
        _trayMenu.Items.Add("Exit Agent Software", null, (s, e) => {
            _notifyIcon.Visible = false;
            Application.Exit();
        });

        _notifyIcon = new NotifyIcon
        {
            Text = "ClusterOS Agent",
            Icon = SystemIcons.Application,
            ContextMenuStrip = _trayMenu,
            Visible = true
        };
        _notifyIcon.DoubleClick += (s, e) => RestoreFromTray();

        // Custom timer for updating status and stats
        _updateTimer = new System.Windows.Forms.Timer
        {
            Interval = 1000 // Update every second
        };
        _updateTimer.Tick += UpdateTimer_Tick;
        _updateTimer.Start();
    }

    private async void LoadDeviceIdentity()
    {
        try
        {
            var identity = await _pairingService.GetOrCreateIdentityAsync();
            _lblDeviceId.Text = identity.DeviceId;
            if (identity.IsPaired)
            {
                _lblPairCode.Text = "PAIRED";
                _lblPairCode.ForeColor = Color.FromArgb(59, 130, 246); // Nice blue/cyan for paired
                _lblPairCodeTitle.Text = "DEVICE PAIRED & ACTIVE";
                _btnCopyCode.Visible = false;
            }
            else
            {
                _lblPairCode.Text = identity.PairCode;
                _lblPairCodeTitle.Text = "ENTER PAIR CODE ON DASHBOARD";
                _btnCopyCode.Visible = true;
            }
        }
        catch (Exception ex)
        {
            _lblPairCode.Text = "ERROR";
            _lblStatusText.Text = $"Failed to get device info: {ex.Message}";
        }
    }

    private void UpdateTimer_Tick(object? sender, EventArgs e)
    {
        // Update pairing GUI dynamically if status changes
        var identity = _pairingService.CurrentIdentity;
        if (identity != null)
        {
            if (identity.IsPaired)
            {
                if (_lblPairCode.Text != "PAIRED")
                {
                    _lblPairCode.Text = "PAIRED";
                    _lblPairCode.ForeColor = Color.FromArgb(59, 130, 246); // Nice blue/cyan for paired
                    _lblPairCodeTitle.Text = "DEVICE PAIRED & ACTIVE";
                    _btnCopyCode.Visible = false;
                }
            }
            else
            {
                if (_lblPairCode.Text != identity.PairCode)
                {
                    _lblPairCode.Text = identity.PairCode;
                    _lblPairCodeTitle.Text = "ENTER PAIR CODE ON DASHBOARD";
                    _btnCopyCode.Visible = true;
                }
            }
        }

        // Update System Status
        var snapshot = _hardwareMonitor.LastSnapshot;

        if (snapshot != null)
        {
            // Set status to Connected & Monitoring
            _statusDot.BackColor = Color.FromArgb(34, 197, 94); // Active green
            _statusDot.Invalidate();
            _lblStatusText.Text = "Connected to Firebase RTDB • Streaming metrics";
            _lblStatusText.ForeColor = Color.FromArgb(187, 247, 208);

            // Update CPU
            var cpuVal = snapshot.Cpu.Total;
            _lblCpu.Text = $"CPU Usage: {cpuVal:F1}%";
            _barCpuFill.Width = (int)((cpuVal / 100f) * _barCpuBg.Width);

            // Update RAM
            var ramVal = snapshot.Ram.UsedPercent;
            _lblRam.Text = $"RAM Usage: {ramVal:F1}%";
            _barRamFill.Width = (int)((ramVal / 100f) * _barRamBg.Width);

            // Update GPU
            var gpuVal = snapshot.Gpu.UsagePercent;
            _lblGpu.Text = $"GPU Usage: {gpuVal:F1}%";
            _barGpuFill.Width = (int)((gpuVal / 100f) * _barGpuBg.Width);

            // Update Temps
            _lblTemps.Text = $"CPU Temp: {snapshot.Temperatures.Cpu:F0}°C   |   GPU Temp: {snapshot.Temperatures.Gpu:F0}°C";
        }
        else
        {
            // Initializing/No snapshot yet
            _statusDot.BackColor = Color.FromArgb(245, 158, 11); // Amber
            _statusDot.Invalidate();
            _lblStatusText.Text = "Initializing hardware monitoring sensors...";
        }
    }

    private void BtnCopyCode_Click(object? sender, EventArgs e)
    {
        if (_lblPairCode.Text != "------" && _lblPairCode.Text != "ERROR")
        {
            Clipboard.SetText(_lblPairCode.Text);
            MessageBox.Show("Pair Code copied to clipboard!", "Copied", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
    }

    private void TitleBar_MouseDown(object? sender, MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            _dragging = true;
            _dragStartPoint = new Point(e.X, e.Y);
        }
    }

    private void TitleBar_MouseMove(object? sender, MouseEventArgs e)
    {
        if (_dragging)
        {
            Point p = PointToScreen(e.Location);
            this.Location = new Point(p.X - _dragStartPoint.X, p.Y - _dragStartPoint.Y);
        }
    }

    private void TitleBar_MouseUp(object? sender, MouseEventArgs e)
    {
        _dragging = false;
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (this.WindowState == FormWindowState.Minimized)
        {
            this.Hide();
            _notifyIcon.ShowBalloonTip(2000, "ClusterOS Agent Running", "The agent has minimized to the system tray and is actively monitoring in the background.", ToolTipIcon.Info);
        }
    }

    private void RestoreFromTray()
    {
        this.Show();
        this.WindowState = FormWindowState.Normal;
        this.Activate();
    }

    private void OnRentalSessionChanged(ActiveRentalSession? session)
    {
        if (this.IsDisposed) return;
        
        try
        {
            this.Invoke(() =>
            {
                if (session == null)
                {
                    _cardStats.Visible = true;
                    _cardRental.Visible = false;
                    _lblStatusText.Text = "Connected to Firebase RTDB • Waiting for renter";
                    _lblStatusText.ForeColor = Color.FromArgb(148, 163, 184);
                    _statusDot.BackColor = Color.FromArgb(156, 163, 175);
                }
                else
                {
                    _cardStats.Visible = false;
                    _cardRental.Visible = true;

                    _lblRentalRate.Text = $"Rate: ৳{session.HourlyRate} / hr  |  Mode: {(session.Mode == "fixed" ? "Fixed Time" : "Pay As You Go")}";
                    _lblRentalEarned.Text = $"৳ {session.EarnedBalance:F2} Tk";

                    if (session.Mode == "fixed")
                    {
                        _lblRentalTimeTitle.Text = "REMAINING TIME";
                        int totalSeconds = (int)(session.DurationMinutes * 60);
                        int remainingSeconds = Math.Max(0, totalSeconds - session.ElapsedSeconds);
                        var t = TimeSpan.FromSeconds(remainingSeconds);
                        _lblRentalTimer.Text = $"{((int)t.TotalHours):D2}:{t.Minutes:D2}:{t.Seconds:D2}";
                        _lblRentalTimer.ForeColor = Color.FromArgb(245, 158, 11);
                        _lblRentalWarning.Text = "⚠️ Keep agent open to earn fixed session Tk.";
                        _lblRentalWarning.ForeColor = Color.FromArgb(239, 68, 68);
                    }
                    else
                    {
                        _lblRentalTimeTitle.Text = "ELAPSED TIME";
                        var t = TimeSpan.FromSeconds(session.ElapsedSeconds);
                        _lblRentalTimer.Text = $"{((int)t.TotalHours):D2}:{t.Minutes:D2}:{t.Seconds:D2}";
                        _lblRentalTimer.ForeColor = Color.FromArgb(34, 197, 94);
                        _lblRentalWarning.Text = "✓ Pay as you go active. Earnings saved in real time.";
                        _lblRentalWarning.ForeColor = Color.FromArgb(110, 231, 183);
                    }

                    _lblStatusText.Text = "⚡ PC RENTED — Workload active!";
                    _lblStatusText.ForeColor = Color.FromArgb(34, 197, 94);
                    _statusDot.BackColor = Color.FromArgb(34, 197, 94);
                }
            });
        }
        catch { }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _updateTimer?.Dispose();
            _notifyIcon?.Dispose();
            _trayMenu?.Dispose();
        }
        base.Dispose(disposing);
    }
}

public class ClusterRunningPopup : Form
{
    private System.Windows.Forms.Timer _blinkTimer = null!;
    private Label _lblWarning = null!;
    private bool _blinkState = false;

    public ClusterRunningPopup()
    {
        this.FormBorderStyle = FormBorderStyle.None;
        this.Size = new Size(320, 100);
        this.BackColor = Color.FromArgb(22, 28, 45); // matching deep dark theme
        this.ShowInTaskbar = false;
        this.TopMost = true;
        this.StartPosition = FormStartPosition.Manual;

        // Custom borders
        this.Paint += (s, e) =>
        {
            using var pen = new Pen(Color.FromArgb(239, 68, 68), 3); // Orange/Red border
            e.Graphics.DrawRectangle(pen, 1, 1, this.Width - 2, this.Height - 2);
        };

        _lblWarning = new Label
        {
            Text = "⚠️ WARNING: CLUSTER JOB ACTIVE",
            ForeColor = Color.FromArgb(239, 68, 68), // Red
            Font = new Font("Segoe UI", 10F, FontStyle.Bold),
            Location = new Point(16, 16),
            AutoSize = true
        };

        var lblDesc = new Label
        {
            Text = "This PC is actively running a cluster workload.\nDO NOT POWER OFF OR RESTART!",
            ForeColor = Color.FromArgb(243, 244, 246),
            Font = new Font("Segoe UI", 9F, FontStyle.Regular),
            Location = new Point(16, 44),
            Size = new Size(288, 40)
        };

        this.Controls.Add(_lblWarning);
        this.Controls.Add(lblDesc);

        // Position bottom-right of screen
        var screen = Screen.PrimaryScreen;
        var area = screen != null ? screen.WorkingArea : new Rectangle(0, 0, 1024, 768);
        this.Location = new Point(area.Right - this.Width - 20, area.Bottom - this.Height - 20);

        // Blinking timer for the header text
        _blinkTimer = new System.Windows.Forms.Timer { Interval = 750 };
        _blinkTimer.Tick += (s, e) =>
        {
            _blinkState = !_blinkState;
            _lblWarning.ForeColor = _blinkState ? Color.FromArgb(239, 68, 68) : Color.FromArgb(245, 158, 11); // toggle Red / Amber
        };
        _blinkTimer.Start();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _blinkTimer?.Dispose();
        }
        base.Dispose(disposing);
    }
}
