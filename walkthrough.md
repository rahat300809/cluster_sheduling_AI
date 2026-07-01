# ClusterOS — Deployment & Build Walkthrough ✅

A complete production-grade distributed monitoring system is now fully deployed and built!

---

## 1. Web Dashboard (Next.js 16)
- **Status:** ✅ Built & Deployed Live
- **Hosting URL:** [https://cluster300809.web.app](https://cluster300809.web.app)
- **Deployment Details:** Deployed using Firebase Hosting. The route structure is fully compatible with static exports (`trailingSlash: true` and `/device/?id=` static route for device details).

### Pages Map
- **Login** (`/login`): Firebase Auth, custom theme & animations.
- **Command Center** (`/`): Cluster overview, resource utilization gauges, load alerts.
- **Devices** (`/devices`): Devices grid, status indicator, pairing dialog.
- **Device Detail** (`/device/?id=...`): Real-time metrics charts, process listing, command dispatch.
- **Processes** (`/processes`): Multi-device process manager.
- **Commands** (`/commands`): Remote CMD/Python script execution builder.
- **Clusters** (`/clusters`): Logic grouping of devices.
- **AI Workload Studio** (`/jobs`): **[NEW]** A real-time cloud IDE featuring:
  - **Monaco Code Editor**: Full Python syntax highlighting, vscode-dark theme, and JetBrains Mono fonts.
  - **Intelligent Load Balancing**: Automatically detects the most idle online PC in the cluster to route the Python script to.
  - **Live Console Streaming**: Real-time console logs stream output (including pip installer progress) directly from the executing PC.
  - **Job History**: Reload past scripts, inspect completion states, and review training console logs.
- **Analytics** (`/analytics`): System usage reporting.
- **Settings** (`/settings`): Account and profile setup.

---

## 2. Windows Agent (C# .NET 9)
- **Status:** ✅ Compiled & Published successfully
- **Binary Directory:** [f:/cluster/dist/agent/](file:///f:/cluster/dist/agent/)
- **Executable File:** [ClusterOSAgent.exe](file:///f:/cluster/dist/agent/ClusterOSAgent.exe) (106 MB, self-contained single-file publish containing runtime)
- **Config File:** [appsettings.json](file:///f:/cluster/dist/agent/appsettings.json)

### Executable Files Created:
1. `ClusterOSAgent.exe` — The main background worker/service executable.
2. `appsettings.json` — Agent configuration file (Firebase endpoints, intervals).
3. `MonoPosixHelper.dll` & `libMonoPosixHelper.dll` — Core native runtime dependencies.
4. `ClusterOSAgent.pdb` — Debug symbols.

---

## 3. Realtime Database Security Rules
- **Status:** ✅ Configured and Deployed
- **Rule Changes:** Updated to allow the Windows agent to write to its metrics path `/devices/$deviceId/metrics`, processes path `/devices/$deviceId/processes`, and pairing codes path `/pairCodes/$pairCode` anonymously. The dashboard still requires authentication (`auth != null`) to read the metrics.

---

## How to Run the Software

### 1. Run the Agent on Windows
1. Open PowerShell/CMD as **Administrator** (necessary for LibreHardwareMonitor sensor readings).
2. Go to the binary directory:
   ```powershell
   cd f:\cluster\dist\agent
   ```
3. Run the executable:
   ```powershell
   .\ClusterOSAgent.exe
   ```
4. On first run, it will print your unique **Device ID** and **Pair Code**:
   ```
   ═══════════════════════════════════════
       ClusterOS Agent - First Launch      
   ═══════════════════════════════════════
     Device ID:  PC-A1B2C3
     Pair Code:  XK7M9P
   ═══════════════════════════════════════
   ```

### 2. Pair and Monitor on the Dashboard
1. Go to the live hosted site: [https://cluster300809.web.app](https://cluster300809.web.app)
2. Sign in or sign up for a new account.
3. Navigate to **Devices** → Click **Add Device**.
4. Enter the **Pair Code** shown in the Agent console.
5. Within 5 seconds, real-time metrics (CPU, RAM, GPU, Disk, Network, Process List) will begin streaming!
