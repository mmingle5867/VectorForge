param()

$ErrorActionPreference = 'Stop'

function Write-Info {
  param([string]$Message)
  Write-Host "[VectorForge] $Message"
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[VectorForge] WARNING: $Message" -ForegroundColor Yellow
}

function Write-ErrorLine {
  param([string]$Message)
  Write-Host "[VectorForge] ERROR: $Message" -ForegroundColor Red
}

function Test-TcpPort {
  param(
    [string]$HostName = 'localhost',
    [int]$Port,
    [int]$TimeoutMs = 200
  )

  try {
    $addresses = [System.Net.Dns]::GetHostAddresses($HostName)
  } catch {
    return $false
  }

  foreach ($address in $addresses) {
    $client = $null
    try {
      $client = [System.Net.Sockets.TcpClient]::new($address.AddressFamily)
      $iar = $client.BeginConnect($address, $Port, $null, $null)
      if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) {
        continue
      }

      $client.EndConnect($iar)
      return $true
    } catch {
      continue
    } finally {
      if ($client) {
        $client.Close()
      }
    }
  }

  return $false
}

function Get-AvailablePort {
  param(
    [string]$HostName,
    [int[]]$Candidates
  )

  foreach ($port in $Candidates) {
    if (-not (Test-TcpPort -HostName $HostName -Port $port)) {
      return $port
    }
  }

  throw "No available port found in the candidate range."
}

function Get-RedisService {
  $patterns = @('Memurai', 'MemuraiDB', 'Redis', 'RedisStack')
  $services = Get-Service -ErrorAction SilentlyContinue
  foreach ($service in $services) {
    foreach ($pattern in $patterns) {
      if ($service.Name -match $pattern -or $service.DisplayName -match $pattern) {
        return $service
      }
    }
  }

  return $null
}

function Start-ChildPowerShellWindow {
  param(
    [string]$Command,
    [string]$WorkingDirectory
  )

  Start-Process powershell.exe -PassThru -WindowStyle Normal -ArgumentList @(
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-NoExit',
    '-Command',
    $Command
  ) -WorkingDirectory $WorkingDirectory
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $projectRoot
$devHost = 'localhost'
$statePath = Join-Path $env:TEMP 'vectorforge-launch-state.json'

if (-not $env:DATABASE_URL) {
  $env:DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/vectorforge?schema=public'
  Write-Info "DATABASE_URL not set. Using local PostgreSQL default."
}

foreach ($localDir in @('uploads', 'output', 'base-assets', 'logs')) {
  $localPath = Join-Path $projectRoot $localDir
  if (-not (Test-Path $localPath)) {
    New-Item -ItemType Directory -Path $localPath | Out-Null
  }
}

Write-Info "Project root: $projectRoot"

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
  Write-ErrorLine "Node.js and npm must be installed and available on PATH."
  exit 1
}

if (-not (Test-Path (Join-Path $projectRoot 'node_modules'))) {
  Write-Info "node_modules not found. Running npm install..."
  npm install
  if ($LASTEXITCODE -ne 0) {
    Write-ErrorLine "npm install failed."
    exit $LASTEXITCODE
  }
}

$redisReady = $false
$redisService = Get-RedisService
if ($redisService) {
  Write-Info "Redis service found: $($redisService.DisplayName) ($($redisService.Name))"
  try {
    if ($redisService.Status -ne 'Running') {
      Write-Info "Starting Redis service..."
      Start-Service -Name $redisService.Name
      Start-Sleep -Seconds 2
      $redisService = Get-Service -Name $redisService.Name
    }

    if ($redisService.Status -eq 'Running') {
      $redisReady = $true
      Write-Info "Redis service status: Running"
    } else {
      Write-Warn "Redis service is installed but not running."
    }
  } catch {
    Write-Warn "Redis service could not be started. Run as Administrator or start it from Services."
    Write-Warn $_.Exception.Message
  }
} else {
  Write-Warn "No Memurai/Redis service found. Queue/worker features will remain unavailable until Redis is started."
}

$selectedPort = Get-AvailablePort -HostName $devHost -Candidates (3000..3010)
if ($selectedPort -ne 3000) {
  Write-Warn "Port 3000 is busy. VectorForge will start on port $selectedPort."
}

if ($redisReady) {
  $workerCommand = @"
Set-Location '$projectRoot'
npm run worker:dev
"@
  Write-Info "Starting worker in a separate PowerShell window..."
  $workerProcess = Start-ChildPowerShellWindow -Command $workerCommand -WorkingDirectory $projectRoot
} else {
  Write-Warn "Worker not started because Redis is unavailable."
}

$serverCommand = @"
Set-Location '$projectRoot'
`$env:PORT = '$selectedPort'
`$env:LOCAL_AUTH_ENABLED = 'true'
npm run dev -- --hostname $devHost --port $selectedPort
"@
Write-Info "Starting VectorForge dev server..."
$serverProcess = Start-ChildPowerShellWindow -Command $serverCommand -WorkingDirectory $projectRoot

@{
  projectRoot = $projectRoot
  host = $devHost
  port = $selectedPort
  serverPowerShellPid = $serverProcess.Id
  workerPowerShellPid = if ($workerProcess) { $workerProcess.Id } else { $null }
  launchedAt = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content $statePath

Write-Info "Waiting for the dev server to become available..."
$url = $null
for ($i = 0; $i -lt 360; $i++) {
  if (Test-TcpPort -HostName $devHost -Port $selectedPort) {
    $url = "http://localhost:$selectedPort"
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $url) {
  Write-Warn "Server did not respond within the startup timeout."
} else {
  $browserStamp = Join-Path $env:TEMP 'vectorforge-browser-launch.json'
  $shouldOpen = $true
  if (Test-Path $browserStamp) {
    try {
      $stamp = Get-Content $browserStamp -Raw | ConvertFrom-Json
      $age = (Get-Date) - [datetime]$stamp.launchedAt
      if ($stamp.port -eq $selectedPort -and $age.TotalMinutes -lt 2) {
        $shouldOpen = $false
      }
    } catch {
      $shouldOpen = $true
    }
  }

  if ($shouldOpen) {
    Write-Info "Opening browser: $url"
    try {
      Start-Process $url | Out-Null
      @{ port = $selectedPort; launchedAt = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content $browserStamp
    } catch {
      Write-Warn "Could not open the browser automatically."
      Write-Warn $_.Exception.Message
    }
  } else {
    Write-Info "Browser was opened recently for port $selectedPort; skipping duplicate launch."
  }
}

Write-Info "VectorForge launcher finished. Leave this window open to keep this status visible."
