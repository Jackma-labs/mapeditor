param(
  [string]$LayerDir = ""
)

if (-not $LayerDir) {
  $LayerDir = Join-Path $PSScriptRoot "..\..\..\_image_layers"
}
$resolved = Resolve-Path $LayerDir -ErrorAction Stop
$patterns = @(
  "modules/private_tools/map_tool/editor_map_cli_main.cc",
  "modules/private_tools/tile_map_images_creator/main.cc",
  "modules/private_tools/tile_map_images_creator/common/image_creator_flags.cc",
  "modules/private_tools/tile_map_images_creator/common/utils.cc",
  "modules/private_tools/tile_map_images_creator/images_creator/images_creator.cc",
  "modules/private_tools/tile_map_images_creator/matrix_generator/matrix_generator.cc",
  "modules/private_tools/tile_map_images_creator/tiles_creator/tiles_creator.cc"
)

Get-ChildItem -Path $resolved -Filter "*.tar.gz" | Sort-Object Name | ForEach-Object {
  Write-Host "== $($_.Name) =="
  $found = $false
  $listing = tar -tvzf $_.FullName
  foreach ($pattern in $patterns) {
    $matches = $listing | Select-String -SimpleMatch $pattern
    foreach ($match in $matches) {
      $found = $true
      Write-Host $match.Line
    }
  }
  if (-not $found) {
    Write-Host "no private source entries"
  }
}
