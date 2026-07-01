; ClusterOS Agent - Inno Setup Installer Script
; https://jrsoftware.org/isinfo.php

#define MyAppName "ClusterOS Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "ClusterOS"
#define MyAppURL "https://cluster300809.web.app"
#define MyAppExeName "ClusterOSAgent.exe"
#define MyAppDescription "Distributed PC Monitoring Agent"

[Setup]
AppId={{A1B2C3D4-E5F6-7890-ABCD-EF1234567890}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\ClusterOS
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
LicenseFile=LICENSE.txt
OutputDir=output
OutputBaseFilename=ClusterOS-Agent-Setup-v{#MyAppVersion}
SetupIconFile=assets\icon.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
MinVersion=10.0.17763
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64

; Windows Service flags
CloseApplications=yes
RestartApplications=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "installservice"; Description: "Install as Windows Service (runs on startup)"; GroupDescription: "Service Options:"; Flags: checked
Name: "startservice"; Description: "Start service immediately after installation"; GroupDescription: "Service Options:"; Flags: checked
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked

[Files]
; Main executable and config
Source: "publish\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "publish\appsettings.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "publish\appsettings.Production.json"; DestDir: "{app}"; Flags: ignoreversion onlyifdoesntexist

; Additional runtime files
Source: "publish\*.dll"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

; Assets
Source: "assets\*"; DestDir: "{app}\assets"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\{#MyAppName} Dashboard"; Filename: "{#MyAppURL}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Install Windows Service
Filename: "sc.exe"; Parameters: "create ""ClusterOS Agent"" binPath= ""{app}\{#MyAppExeName}"" start= auto DisplayName= ""ClusterOS Agent"""; Flags: runhidden; Tasks: installservice; StatusMsg: "Installing Windows Service..."
Filename: "sc.exe"; Parameters: "description ""ClusterOS Agent"" ""Distributed PC monitoring agent for ClusterOS"""; Flags: runhidden; Tasks: installservice

; Start service
Filename: "sc.exe"; Parameters: "start ""ClusterOS Agent"""; Flags: runhidden; Tasks: startservice; StatusMsg: "Starting ClusterOS Agent service..."

; Open dashboard in browser
Filename: "{#MyAppURL}"; Description: "Open ClusterOS Dashboard"; Flags: postinstall shellexec unchecked

[UninstallRun]
; Stop and remove service on uninstall
Filename: "sc.exe"; Parameters: "stop ""ClusterOS Agent"""; Flags: runhidden
Filename: "sc.exe"; Parameters: "delete ""ClusterOS Agent"""; Flags: runhidden

[UninstallDelete]
Type: files; Name: "{app}\device.json"
Type: files; Name: "{app}\*.log"

[Messages]
WelcomeLabel1=Welcome to [name] Setup
WelcomeLabel2=This will install {#MyAppName} {#MyAppVersion} on your computer.%n%nThe agent will collect system metrics and send them to your ClusterOS dashboard in real time.%n%nClick Next to continue.
FinishedLabel=Setup has finished installing [name] on your computer.%n%nThe agent will automatically start monitoring your PC.%n%nOpen the ClusterOS Dashboard to pair this device with your account.

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    // Display pair code from device.json if it exists
    if FileExists(ExpandConstant('{app}\device.json')) then
    begin
      MsgBox('ClusterOS Agent installed successfully!' + #13#10 + #13#10 +
             'Check the ClusterOS Agent console or log file for your Pair Code,' + #13#10 +
             'then go to your ClusterOS Dashboard → Devices → Add Device.', 
             mbInformation, MB_OK);
    end;
  end;
end;
