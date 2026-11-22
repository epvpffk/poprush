param(
    [Parameter(Mandatory=$true)][string]$TargetUrl,
    [Parameter(Mandatory=$true)][long]$Users,
    [Parameter(Mandatory=$true)][long]$Rooms,
    [Parameter(Mandatory=$true)][long]$Seconds,
    [switch]$StopOnErrors
)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
Set-Location -LiteralPath $PSScriptRoot
$dir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$file = Join-Path $dir ('loadtest_{0}users_{1}rooms_{2}.txt' -f $Users, $Rooms, (Get-Date -Format 'yyyyMMdd_HHmmss'))
Write-Host "대상: $TargetUrl"
Write-Host "총 $Users 명 / $Rooms 개 방 / $Seconds 초"
Write-Host "결과 파일: $file"
Write-Host '중단: Ctrl+C · 측정 시간 0초는 무제한'
Write-Host ('오류율 자동 중단: ' + $(if ($StopOnErrors) { '켜짐(5%)' } else { '꺼짐' }))
$logWriter = New-Object System.IO.StreamWriter($file, $false, (New-Object System.Text.UTF8Encoding($true)))
$logWriter.AutoFlush = $true
try {
    $nodeArgs = @((Join-Path $PSScriptRoot 'loadtest.mjs'), '--url', $TargetUrl, '--users', $Users, '--rooms', $Rooms, '--seconds', $Seconds, '--mode', 'battle', '--require-trace')
    if ($StopOnErrors) { $nodeArgs += '--stop-on-errors' }
    & node @nodeArgs 2>&1 | ForEach-Object {
        $line = $_.ToString()
        Write-Host $line
        $logWriter.WriteLine($line)
    }
    Write-Host "종료 코드: $LASTEXITCODE"
} catch { Write-Host $_.Exception.Message; $logWriter.WriteLine($_.Exception.Message) }
finally { $logWriter.Dispose() }
Write-Host '결과를 확인한 후 이 창을 닫으세요.'
Read-Host 'Enter'
