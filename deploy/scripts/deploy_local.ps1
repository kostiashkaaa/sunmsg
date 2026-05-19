# Local deploy script (bypass GitHub Actions)
# Usage: .\deploy\scripts\deploy_local.ps1 -SshHost "your.server.ip" -SshUser "sunmessenger" -KeyFile "C:\path\to\key.pem"

param(
    [Parameter(Mandatory)][Alias("Host")][string]$SshHost,
    [Parameter(Mandatory)][Alias("User")][string]$SshUser,
    [string]$KeyFile = "",
    [string]$SshPort = "22",
    [ValidateSet("staging", "production")]
    [string]$Env = "staging"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$sha = (& git -C $repoRoot rev-parse HEAD).Trim()
$archive = Join-Path ([System.IO.Path]::GetTempPath()) "release_$sha.tar.gz"
$remotePath = "/srv/sunmessenger/artifacts/$sha"
$remoteDeployScript = "/srv/sunmessenger/shared/deploy_release.sh"

$sshArgs = @("-p", $SshPort, "-o", "StrictHostKeyChecking=yes")
$scpArgs = @("-P", $SshPort, "-o", "StrictHostKeyChecking=yes")
if ($KeyFile) {
    $sshArgs += @("-i", $KeyFile)
    $scpArgs += @("-i", $KeyFile)
}

try {
    Write-Host "SHA: $sha"
    Write-Host "Building archive..."

    # Build archive via WSL tar so Windows metadata is not included.
    $wslRepoRoot = (& wsl wslpath -a -u $repoRoot).Trim()
    $wslArchive = (& wsl wslpath -a -u $archive).Trim()
    & wsl tar -czf $wslArchive `
        -C $wslRepoRoot `
        "--exclude=.git" `
        "--exclude=.github" `
        "--exclude=.venv" `
        "--exclude=.pytest_cache" `
        "--exclude=.ruff_cache" `
        "--exclude=.runtime" `
        "--exclude=.tmp_*" `
        "--exclude=storage/backups" `
        "--exclude=storage/chat_media" `
        "--exclude=release.tar.gz" `
        .

    Write-Host "Creating remote directories..."
    & ssh @sshArgs "$SshUser@$SshHost" "mkdir -p $remotePath /srv/sunmessenger/shared"

    Write-Host "Uploading archive..."
    & scp @scpArgs $archive "${SshUser}@${SshHost}:${remotePath}/release.tar.gz"

    Write-Host "Uploading deploy script..."
    & scp @scpArgs (Join-Path $repoRoot "deploy\scripts\deploy_release.sh") "${SshUser}@${SshHost}:${remoteDeployScript}"

    Write-Host "Running deploy on server..."
    & ssh @sshArgs "$SshUser@$SshHost" "chmod +x $remoteDeployScript && $remoteDeployScript $sha $Env"

    Write-Host "Done."
}
finally {
    Remove-Item $archive -ErrorAction SilentlyContinue
}
