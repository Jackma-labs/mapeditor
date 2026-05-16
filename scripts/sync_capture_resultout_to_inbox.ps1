param(
  [string]$SourceRoot = $env:MAPEDITOR_CAPTURE_SOURCE_ROOT_WINDOWS,
  [string]$InboxRoot = $env:MAPEDITOR_CAPTURE_INBOX_ROOT_WINDOWS,
  [int]$Limit = 50,
  [switch]$Overwrite
)

$ErrorActionPreference = "Stop"
$resultDirNames = @("ResultOut", "Resultout", "resultout", "Result", "result")
$invalidNameChars = [IO.Path]::GetInvalidFileNameChars()

function Convert-ToPackageName {
  param([string]$Name)
  $clean = $Name.Trim()
  foreach ($char in $invalidNameChars) {
    $clean = $clean.Replace([string]$char, "_")
  }
  $clean = ($clean -replace "\s+", "_").Trim("_")
  if ([string]::IsNullOrWhiteSpace($clean)) {
    return "package"
  }
  if ($clean.Length -gt 64) {
    return $clean.Substring(0, 64)
  }
  return $clean
}

function Find-ResultDir {
  param([string]$PackagePath)
  foreach ($name in $resultDirNames) {
    $candidate = Join-Path $PackagePath $name
    if (Test-Path -LiteralPath $candidate -PathType Container) {
      return $candidate
    }
  }
  $dirs = Get-ChildItem -LiteralPath $PackagePath -Directory -ErrorAction SilentlyContinue
  foreach ($name in $resultDirNames) {
    $matched = $dirs | Where-Object { $_.Name.ToLowerInvariant() -eq $name.ToLowerInvariant() } | Select-Object -First 1
    if ($matched) {
      return $matched.FullName
    }
  }
  return $null
}

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
  throw "SourceRoot is required. Pass -SourceRoot or set MAPEDITOR_CAPTURE_SOURCE_ROOT_WINDOWS."
}
if ([string]::IsNullOrWhiteSpace($InboxRoot)) {
  throw "InboxRoot is required. Pass -InboxRoot or set MAPEDITOR_CAPTURE_INBOX_ROOT_WINDOWS."
}
if (-not (Test-Path -LiteralPath $SourceRoot -PathType Container)) {
  throw "Source root not found: $SourceRoot"
}
if (-not (Test-Path -LiteralPath $InboxRoot -PathType Container)) {
  throw "Inbox root not found: $InboxRoot"
}

$packages = Get-ChildItem -LiteralPath $SourceRoot -Directory |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First $Limit

$copied = 0
$skipped = 0

foreach ($package in $packages) {
  $resultDir = Find-ResultDir -PackagePath $package.FullName
  if (-not $resultDir) {
    $skipped += 1
    Write-Host "SKIP no ResultOut: $($package.Name)"
    continue
  }

  $lasFiles = Get-ChildItem -LiteralPath $resultDir -Recurse -File -Filter *.las -ErrorAction SilentlyContinue
  if (-not $lasFiles) {
    $skipped += 1
    Write-Host "SKIP no LAS: $($package.Name)"
    continue
  }

  $packageName = "sync-$(Convert-ToPackageName -Name $package.Name)"
  $targetDir = Join-Path $InboxRoot $packageName
  $targetUploads = Join-Path $targetDir "uploads"
  $tmpDir = Join-Path $InboxRoot ".incoming-$packageName"
  $tmpUploads = Join-Path $tmpDir "uploads"

  if ((Test-Path -LiteralPath $targetDir -PathType Container) -and -not $Overwrite) {
    $skipped += 1
    Write-Host "SKIP exists: $packageName"
    continue
  }

  if (Test-Path -LiteralPath $tmpDir) {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $tmpUploads -Force | Out-Null

  $fileIndex = 0
  foreach ($file in $lasFiles) {
    $safeName = "{0}-{1}" -f $fileIndex, $file.Name
    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $tmpUploads $safeName) -Force
    $fileIndex += 1
  }

  $metadata = [ordered]@{
    packageId = $packageName
    displayName = (Convert-ToPackageName -Name $package.Name)
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    source = "windows-sync"
    sourcePath = $package.FullName
    resultDir = $resultDir
    fileCount = $lasFiles.Count
  }
  $metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $tmpDir "package_metadata.json") -Encoding UTF8

  if ($Overwrite -and (Test-Path -LiteralPath $targetDir)) {
    Remove-Item -LiteralPath $targetDir -Recurse -Force
  }
  Move-Item -LiteralPath $tmpDir -Destination $targetDir
  $copied += 1
  Write-Host "COPIED $packageName files=$($lasFiles.Count)"
}

Write-Host "DONE copied=$copied skipped=$skipped"
