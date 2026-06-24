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

function Get-ProcessTreeIds {
  param(
    [int[]]$RootIds,
    [object[]]$Processes
  )

  $childrenByParent = @{}
  foreach ($process in $Processes) {
    $parentId = [int]$process.ParentProcessId
    if (-not $childrenByParent.ContainsKey($parentId)) {
      $childrenByParent[$parentId] = New-Object System.Collections.Generic.List[int]
    }
    $childrenByParent[$parentId].Add([int]$process.ProcessId)
  }

  $seen = @{}
  $queue = New-Object System.Collections.Generic.Queue[int]
  foreach ($id in $RootIds) {
    if ($id -gt 0 -and -not $seen.ContainsKey($id)) {
      $seen[$id] = $true
      $queue.Enqueue($id)
    }
  }

  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($childrenByParent.ContainsKey($current)) {
      foreach ($child in $childrenByParent[$current]) {
        if (-not $seen.ContainsKey($child)) {
          $seen[$child] = $true
          $queue.Enqueue($child)
        }
      }
    }
  }

  return @($seen.Keys | ForEach-Object { [int]$_ })
}

function Stop-VectorForgeProcessGroup {
  param(
    [string]$Label,
    [int[]]$RootIds,
    [object[]]$AllProcesses
  )

  $rootSet = @{}
  foreach ($id in $RootIds) {
    if ($id -gt 0) {
      $rootSet[$id] = $true
    }
  }

  $treeIds = Get-ProcessTreeIds -RootIds $RootIds -Processes $AllProcesses
  $targets = @(
    $AllProcesses |
      Where-Object { $treeIds -contains [int]$_.ProcessId } |
      Where-Object {
        $rootSet.ContainsKey([int]$_.ProcessId) -or
        $_.CommandLine -match 'node|npm|next|tsx|powershell|cmd'
      }
  )

  if ($targets.Count -eq 0) {
    Write-Info "$Label not running."
    return $false
  }

  Write-Info "Stopping $Label..."

  $targets = @($targets | Sort-Object ProcessId -Descending)
  foreach ($target in $targets) {
    try {
      $process = Get-Process -Id $target.ProcessId -ErrorAction SilentlyContinue
      if (-not $process) {
        continue
      }

      if ($process.MainWindowHandle -ne 0) {
        [void]$process.CloseMainWindow()
      }
    } catch {
      Write-Warn "Could not request graceful stop for process $($target.ProcessId)."
    }
  }

  Start-Sleep -Seconds 2

  foreach ($target in $targets) {
    try {
      $process = Get-Process -Id $target.ProcessId -ErrorAction SilentlyContinue
      if ($process) {
        Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Write-Warn "Could not stop process $($target.ProcessId)."
    }
  }

  return $true
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$statePath = Join-Path $env:TEMP 'vectorforge-launch-state.json'
$state = $null

if (Test-Path $statePath) {
  try {
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    if ($state.projectRoot -ne $projectRoot) {
      $state = $null
    }
  } catch {
    $state = $null
  }
}

Write-Info "Stopping VectorForge..."

$allProcesses = @(Get-CimInstance Win32_Process)
$escapedProjectRoot = [regex]::Escape($projectRoot)

$serverRootIds = @()
$workerRootIds = @()
if ($state) {
  if ($state.serverPowerShellPid) {
    $serverRootIds += [int]$state.serverPowerShellPid
  }
  if ($state.workerPowerShellPid) {
    $workerRootIds += [int]$state.workerPowerShellPid
  }
}

$serverRootIds += @(
  $allProcesses |
    Where-Object {
      $_.CommandLine -match $escapedProjectRoot -and
      $_.CommandLine -match 'npm run dev|next dev|--hostname localhost'
    } |
    ForEach-Object { [int]$_.ProcessId }
)

$workerRootIds += @(
  $allProcesses |
    Where-Object {
      $_.CommandLine -match $escapedProjectRoot -and
      $_.CommandLine -match 'npm run worker:dev|processing-worker-bootstrap|tsx watch'
    } |
    ForEach-Object { [int]$_.ProcessId }
)

$serverRootIds = @(
  $allProcesses |
    Where-Object {
      $serverRootIds -contains [int]$_.ProcessId -and
      $_.CommandLine -match $escapedProjectRoot
    } |
    ForEach-Object { [int]$_.ProcessId } |
    Select-Object -Unique
)

$workerRootIds = @(
  $allProcesses |
    Where-Object {
      $workerRootIds -contains [int]$_.ProcessId -and
      $_.CommandLine -match $escapedProjectRoot
    } |
    ForEach-Object { [int]$_.ProcessId } |
    Select-Object -Unique
)

$stoppedServer = Stop-VectorForgeProcessGroup -Label 'VectorForge dev server' -RootIds $serverRootIds -AllProcesses $allProcesses
$stoppedWorker = Stop-VectorForgeProcessGroup -Label 'Worker' -RootIds $workerRootIds -AllProcesses $allProcesses

if ($statePath -and (Test-Path $statePath)) {
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

$port = if ($state -and $state.port) { [int]$state.port } else { 3000 }
if (Test-TcpPort -HostName 'localhost' -Port $port) {
  Write-Warn "localhost:$port is still responding. Another process may be using that port."
}

if ($stoppedServer -or $stoppedWorker) {
  Write-Info "VectorForge stopped."
} else {
  Write-Info "VectorForge not running."
}

Write-Info "Memurai/Redis was not stopped."
