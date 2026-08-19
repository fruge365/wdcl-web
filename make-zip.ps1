param(
  [Parameter(Mandatory = $true)] [string] $SourceDir,
  [Parameter(Mandatory = $true)] [string] $DestinationPath
)

$ErrorActionPreference = "Stop"
if (Test-Path -LiteralPath $DestinationPath) {
  Remove-Item -LiteralPath $DestinationPath -Force
}
Compress-Archive -Path (Join-Path $SourceDir "*") -DestinationPath $DestinationPath -CompressionLevel Optimal
