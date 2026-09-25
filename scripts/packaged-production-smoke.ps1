param([Parameter(Mandatory=$true)][string]$Executable, [switch]$Editor)
$ErrorActionPreference = 'Stop'
$resolvedExe = (Resolve-Path -LiteralPath $Executable).Path
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('afd-production-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
$previousData = $env:AI_FILM_DATA_DIR
$previousGpu = $env:AIFD_DISABLE_GPU
$env:AI_FILM_DATA_DIR = $testRoot
$env:AIFD_DISABLE_GPU = '1'
$started = Get-Date
$proc = $null
try {
  $proc = Start-Process -FilePath $resolvedExe -ArgumentList '--disable-gpu' -PassThru -WindowStyle Hidden
  $logPath = Join-Path ([IO.Path]::GetTempPath()) 'ai-film-director-startup.log'
  $deadline = (Get-Date).AddSeconds(40)
  $base = $null
  do {
    Start-Sleep -Milliseconds 300
    if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).LastWriteTime -ge $started) {
      $logText = Get-Content -LiteralPath $logPath -Raw
      $portMatch = [regex]::Match($logText, 'backend listening on 127\.0\.0\.1:(\d+)')
      if ($portMatch.Success -and $logText.Contains('ready-to-show -> show')) {
        $candidate = 'http://127.0.0.1:' + $portMatch.Groups[1].Value
        try { if ((Invoke-RestMethod "$candidate/api/health" -TimeoutSec 2).ok) { $base = $candidate } } catch {}
      }
    }
  } while (-not $base -and (Get-Date) -lt $deadline)
  if (-not $base) { throw 'Packaged app did not become ready' }
  $created = Invoke-RestMethod -Method Post -Uri "$base/api/sessions" -ContentType 'application/json' -Body '{}'
  $payload = @{ sessionId = $created.id; message = '制作一个30秒短片，一个人在荒废城市看日出' } | ConvertTo-Json -Compress
  $stream = (Invoke-WebRequest -Method Post -Uri "$base/api/chat" -ContentType 'application/json' -Body $payload -TimeoutSec 180).Content
  $saved = Invoke-RestMethod "$base/api/sessions/$($created.id)"
  if ($saved.pendingSkills.Count -ne 0) { throw 'Completed pipeline retained pending stages' }
  if (-not $saved.productionChecks.ok) { throw ('30 second demo timeline did not pass checks: ' + ($saved.productionChecks | ConvertTo-Json -Compress -Depth 8)) }
  if ($saved.generationMode -ne 'demo') { throw 'Demo mode not disclosed' }
  $updated = Invoke-RestMethod -Method Patch -Uri "$base/api/sessions/$($created.id)/constraints" -ContentType 'application/json' -Body '{"duration":60}'
  if ($updated.pendingSkills -notcontains 'storyboard') { throw 'Duration change failed to invalidate storyboard' }
  if ($updated.productionChecks.ok) { throw 'Duration mismatch was incorrectly accepted' }
  $export = (Invoke-WebRequest "$base/api/sessions/$($created.id)/export").Content
  if (-not $export.Contains('尚未完成更新') -or -not $export.Contains('演示模板')) { throw 'Export omitted warnings' }
  $html = (Invoke-WebRequest $base).Content
  $asset = [regex]::Match($html, 'src="(\./assets/[^"]+\.js)"').Groups[1].Value
  if (-not $asset) { throw 'Missing frontend bundle' }
  $bundle = (Invoke-WebRequest ($base + '/' + $asset)).Content
  if (-not $bundle.Contains('制作约束待处理')) { throw 'Packaged frontend missing new feature' }
  $stages = [regex]::Matches($stream, '(?m)^event: stage_done\r?$').Count
  if ($stages -ne 12) { throw "Expected 12 stages, got $stages" }
  if ($Editor) {
    $editPayload = @{ action='apply'; no=1; version=$updated.editVersion; patch=@{ action='打包验收：握紧旧表' } } | ConvertTo-Json -Depth 6 -Compress
    $edited = Invoke-RestMethod -Method Post -Uri "$base/api/sessions/$($created.id)/editor" -ContentType 'application/json' -Body $editPayload
    if ($edited.shots[0].action -ne '打包验收：握紧旧表' -or $edited.versions.Count -lt 1) { throw 'Packaged editor failed to save and checkpoint' }
    $restoreId = $edited.versions[-1].id
    $lockPayload = @{ action='lock'; no=1; version=$edited.editVersion; locked=$true } | ConvertTo-Json -Compress
    $locked = Invoke-RestMethod -Method Post -Uri "$base/api/sessions/$($created.id)/editor" -ContentType 'application/json' -Body $lockPayload
    if (-not $locked.shots[0].locked) { throw 'Packaged lock failed' }
    $restorePayload = @{ action='restore'; version=$locked.editVersion; versionId=$restoreId } | ConvertTo-Json -Compress
    $restored = Invoke-RestMethod -Method Post -Uri "$base/api/sessions/$($created.id)/editor" -ContentType 'application/json' -Body $restorePayload
    if ($restored.shots[0].action -ne $updated.shots[0].action -or $restored.shots[0].locked) { throw 'Packaged restore failed' }
    if (-not $bundle.Contains('确认应用')) { throw 'Packaged editor UI missing' }
    Write-Output 'PASS packaged editor: save, history, lock, restore, served UI'
  }
  [pscustomobject]@{ Ready=$true; Stages=$stages; InitialChecksPassed=$saved.productionChecks.ok; ChangedDurationRejected=(-not $updated.productionChecks.ok); ExportWarnings=$true; ServedFrontendVerified=$true } | ConvertTo-Json -Compress
} finally {
  if ($proc -and -not $proc.HasExited) {
    $null = $proc.CloseMainWindow()
    if (-not $proc.WaitForExit(5000)) { Stop-Process -Id $proc.Id -Force }
  }
  $env:AI_FILM_DATA_DIR = $previousData
  $env:AIFD_DISABLE_GPU = $previousGpu
  # Exact mktemp-style directory created by this script; contains no user projects.
  $resolvedTest = [IO.Path]::GetFullPath($testRoot)
  $tempPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if ($resolvedTest.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTest -Leaf) -match '^afd-production-smoke-[a-f0-9]{32}$') {
    Remove-Item -LiteralPath $resolvedTest -Recurse -Force
  }
}
