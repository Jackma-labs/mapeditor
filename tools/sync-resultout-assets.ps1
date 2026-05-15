param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,
  [string]$DestinationRoot = "\\192.168.110.2\mapeditor-capture",
  [int]$MinAgeMinutes = 10,
  [string]$LogFile = "",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (![string]::IsNullOrWhiteSpace($LogFile)) {
  $logDir = Split-Path -Parent $LogFile
  if (![string]::IsNullOrWhiteSpace($logDir)) {
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  }
  Start-Transcript -Path $LogFile -Append | Out-Null
}

function Write-Info($Message) {
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$stamp] $Message"
}

function ConvertTo-SafeName([string]$Name) {
  $invalid = [Regex]::Escape((-join [IO.Path]::GetInvalidFileNameChars()))
  $safe = [Regex]::Replace($Name.Trim(), "[$invalid]", "_")
  $safe = [Regex]::Replace($safe, "\s+", "_")
  $safe = $safe.Trim("._ ")
  if ([string]::IsNullOrWhiteSpace($safe)) {
    return "package"
  }
  if ($safe.Length -gt 150) {
    return $safe.Substring(0, 150).Trim("._ ")
  }
  return $safe
}

function Get-ResultOutDirectory($PackageDir) {
  $direct = Join-Path $PackageDir.FullName "ResultOut"
  if (Test-Path -LiteralPath $direct -PathType Container) {
    return (Get-Item -LiteralPath $direct)
  }
  return Get-ChildItem -LiteralPath $PackageDir.FullName -Directory -Recurse -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ieq "ResultOut" } |
    Select-Object -First 1
}

function Get-LasSnapshot($ResultOutDir) {
  $files = Get-ChildItem -LiteralPath $ResultOutDir.FullName -Filter "*.las" -File -ErrorAction SilentlyContinue |
    Sort-Object FullName
  $totalBytes = 0L
  $newest = [datetime]"1970-01-01T00:00:00Z"
  foreach ($file in $files) {
    $totalBytes += $file.Length
    if ($file.LastWriteTimeUtc -gt $newest) {
      $newest = $file.LastWriteTimeUtc
    }
  }
  [pscustomobject]@{
    Files = $files
    Count = $files.Count
    TotalBytes = $totalBytes
    NewestLastWriteUtc = $newest
  }
}

function Save-Json($Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

if (!(Test-Path -LiteralPath $SourceRoot -PathType Container)) {
  throw "SourceRoot does not exist: $SourceRoot"
}
if (!(Test-Path -LiteralPath $DestinationRoot -PathType Container)) {
  throw "DestinationRoot does not exist: $DestinationRoot"
}

$packages = Get-ChildItem -LiteralPath $SourceRoot -Directory | Sort-Object Name
$synced = 0
$skipped = 0
$failed = 0

foreach ($packageDir in $packages) {
  $resultOut = Get-ResultOutDirectory $packageDir
  if ($null -eq $resultOut) {
    Write-Info "SKIP $($packageDir.Name): ResultOut not found"
    $skipped++
    continue
  }

  $snapshot = Get-LasSnapshot $resultOut
  if ($snapshot.Count -eq 0) {
    Write-Info "SKIP $($packageDir.Name): no LAS files in ResultOut"
    $skipped++
    continue
  }

  $ageMinutes = ((Get-Date).ToUniversalTime() - $snapshot.NewestLastWriteUtc).TotalMinutes
  if ($ageMinutes -lt $MinAgeMinutes) {
    Write-Info ("SKIP {0}: newest LAS is {1:N1} minutes old, waiting for stable files" -f $packageDir.Name, $ageMinutes)
    $skipped++
    continue
  }

  Start-Sleep -Seconds 2
  $snapshot2 = Get-LasSnapshot $resultOut
  if ($snapshot.Count -ne $snapshot2.Count -or $snapshot.TotalBytes -ne $snapshot2.TotalBytes) {
    Write-Info "SKIP $($packageDir.Name): file set is still changing"
    $skipped++
    continue
  }

  $safeName = ConvertTo-SafeName $packageDir.Name
  $packageId = "sync-$safeName"
  $targetPackage = Join-Path $DestinationRoot $packageId
  $targetUploads = Join-Path $targetPackage "uploads"
  $metadataPath = Join-Path $targetPackage "package_metadata.json"
  $manifestPath = Join-Path $targetPackage "source_manifest.json"
  $analysisPath = Join-Path $targetPackage "analysis.json"

  Write-Info ("SYNC {0}: {1} LAS, {2:N2} GB" -f $packageDir.Name, $snapshot.Count, ($snapshot.TotalBytes / 1GB))

  if ($DryRun) {
    Write-Info "DRYRUN target: $targetPackage"
    continue
  }

  New-Item -ItemType Directory -Force -Path $targetUploads | Out-Null
  $robocopyArgs = @(
    $resultOut.FullName,
    $targetUploads,
    "*.las",
    "/E",
    "/Z",
    "/R:2",
    "/W:5",
    "/MT:16",
    "/FFT",
    "/NP"
  )
  & robocopy @robocopyArgs | Out-Host
  $robocopyCode = $LASTEXITCODE
  if ($robocopyCode -ge 8) {
    Write-Info "FAIL $($packageDir.Name): robocopy exit code $robocopyCode"
    $failed++
    continue
  }

  $destSnapshot = Get-LasSnapshot (Get-Item -LiteralPath $targetUploads)
  if ($destSnapshot.Count -lt $snapshot.Count -or $destSnapshot.TotalBytes -lt $snapshot.TotalBytes) {
    Write-Info "FAIL $($packageDir.Name): destination self-check failed"
    $failed++
    continue
  }

  $now = (Get-Date).ToUniversalTime().ToString("o")
  $createdAt = $now
  if (Test-Path -LiteralPath $metadataPath -PathType Leaf) {
    try {
      $existing = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
      if ($existing.createdAt) {
        $createdAt = [string]$existing.createdAt
      }
    } catch {
      $createdAt = $now
    }
  }

  $metadata = [ordered]@{
    packageId = $packageId
    displayName = $packageDir.Name
    createdAt = $createdAt
    updatedAt = $now
    source = [ordered]@{
      type = "resultout-sync"
      sourceRoot = $SourceRoot
      sourcePackage = $packageDir.FullName
      sourceResultOut = $resultOut.FullName
    }
  }
  Save-Json $metadataPath $metadata

  $manifest = [ordered]@{
    packageId = $packageId
    displayName = $packageDir.Name
    syncedAt = $now
    sourceRoot = $SourceRoot
    sourcePackage = $packageDir.FullName
    sourceResultOut = $resultOut.FullName
    fileCount = $snapshot.Count
    totalBytes = $snapshot.TotalBytes
    newestLastWriteUtc = $snapshot.NewestLastWriteUtc.ToString("o")
    files = @($snapshot.Files | ForEach-Object {
      [ordered]@{
        name = $_.Name
        sizeBytes = $_.Length
        lastWriteUtc = $_.LastWriteTimeUtc.ToString("o")
      }
    })
  }
  Save-Json $manifestPath $manifest

  if (Test-Path -LiteralPath $analysisPath -PathType Leaf) {
    Remove-Item -LiteralPath $analysisPath -Force
  }

  Write-Info "OK $($packageDir.Name) -> $packageId"
  $synced++
}

Write-Info "DONE synced=$synced skipped=$skipped failed=$failed"
if (![string]::IsNullOrWhiteSpace($LogFile)) {
  Stop-Transcript | Out-Null
}
if ($failed -gt 0) {
  exit 1
}
