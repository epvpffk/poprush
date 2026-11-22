[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = 'POP RUSH 부하 테스트 v12'
$form.ClientSize = New-Object System.Drawing.Size(620, 420)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('맑은 고딕', 10)

function Add-Label($text, $x, $y, $width) {
    $label = New-Object System.Windows.Forms.Label
    $label.Text = $text
    $label.Location = New-Object System.Drawing.Point($x, $y)
    $label.Size = New-Object System.Drawing.Size($width, 28)
    $form.Controls.Add($label)
    return $label
}
$title = Add-Label 'POP RUSH v12 · 참가자와 방 개수' 20 15 580
$title.Font = New-Object System.Drawing.Font('맑은 고딕', 12, [System.Drawing.FontStyle]::Bold)
$null = Add-Label '게임 주소' 20 61 120
$urlBox = New-Object System.Windows.Forms.TextBox
$urlBox.Location = New-Object System.Drawing.Point(150, 58)
$urlBox.Size = New-Object System.Drawing.Size(440, 28)
$urlBox.Text = 'http://poprush.xyz'
$form.Controls.Add($urlBox)

function Add-Number($label, $y, $min, $max, $value) {
    $null = Add-Label $label 20 $y 120
    $n = New-Object System.Windows.Forms.NumericUpDown
    $n.Location = New-Object System.Drawing.Point(150, $y)
    $n.Size = New-Object System.Drawing.Size(135, 28)
    $n.Minimum = $min
    $n.Maximum = $max
    $n.Value = $value
    $form.Controls.Add($n)
    return $n
}
$userBox = Add-Number '총 참가자 수' 102 2 9007199254740991 10
$roomBox = Add-Number '방 개수' 145 1 9007199254740991 5
$secondsBox = Add-Number '측정 시간(초)' 188 0 9007199254740991 120
$null = Add-Label '0초 = 직접 중단할 때까지 실행' 305 188 290
$stopBox = New-Object System.Windows.Forms.CheckBox
$stopBox.Text = '오류율 5% 초과 시 자동 중단'
$stopBox.Checked = $false
$stopBox.Location = New-Object System.Drawing.Point(20, 224)
$stopBox.Size = New-Object System.Drawing.Size(570, 28)
$form.Controls.Add($stopBox)
$hint = Add-Label '' 305 145 290
$note = Add-Label '가상 게스트 사용 · 실제 랭킹 미기록 · AI 없음' 20 258 580
$note.Font = New-Object System.Drawing.Font('맑은 고딕', 9)
$state = Add-Label '실행 후 별도 창에서 진행 상황과 결과를 확인합니다.' 20 291 580
$state.Font = New-Object System.Drawing.Font('맑은 고딕', 9)
$run = New-Object System.Windows.Forms.Button
$run.Text = '테스트 시작'
$run.Location = New-Object System.Drawing.Point(20, 345)
$run.Size = New-Object System.Drawing.Size(280, 48)
$form.Controls.Add($run)
$logs = New-Object System.Windows.Forms.Button
$logs.Text = '결과 폴더 열기'
$logs.Location = New-Object System.Drawing.Point(315, 345)
$logs.Size = New-Object System.Drawing.Size(275, 48)
$form.Controls.Add($logs)
$script:currentProcess = $null
$script:updating = $false
function Update-Rooms {
    if ($script:updating) { return }
    $script:updating = $true
    try {
        $users = [long]$userBox.Value
        $minimum = [long][Math]::Ceiling($users / 8.0)
        $maximum = [long][Math]::Floor($users / 2.0)
        $roomBox.Minimum = 1
        $roomBox.Maximum = 9007199254740991
        $roomBox.Minimum = $minimum
        $roomBox.Maximum = $maximum
        $rooms = [long]$roomBox.Value
        $low = [int][Math]::Floor($users / [double]$rooms)
        $high = [int][Math]::Ceiling($users / [double]$rooms)
        $hint.Text = if ($low -eq $high) { "방당 $low 명 · 총 $rooms 개 방" } else { "방당 $low ~ $high 명 균등 배치" }
    } finally { $script:updating = $false }
}
$userBox.Add_ValueChanged({ Update-Rooms })
$roomBox.Add_ValueChanged({ Update-Rooms })
Update-Rooms
$logPath = Join-Path $PSScriptRoot 'logs'
$logs.Add_Click({
    New-Item -ItemType Directory -Path $logPath -Force | Out-Null
    Start-Process explorer.exe -ArgumentList ('"' + $logPath + '"')
})
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
    if ($script:currentProcess -and $script:currentProcess.HasExited) {
        $timer.Stop()
        $run.Enabled = $true
        $state.Text = '종료되었습니다. 결과 폴더에서 로그를 확인하세요.'
        $script:currentProcess.Dispose()
        $script:currentProcess = $null
    }
})
$run.Add_Click({
    try {
        $node = Get-Command node -ErrorAction SilentlyContinue
        if (-not $node) { throw 'Node.js 24를 설치한 후 이 창을 다시 열어 주세요.' }
        $nodeVersion = & $node.Source --version
        if ($nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw '이 도구는 Node.js 24 이상이 필요합니다.' }
        $target = $null
        if (-not [Uri]::TryCreate($urlBox.Text.Trim(), [UriKind]::Absolute, [ref]$target)) { throw '올바른 게임 주소를 입력하세요.' }
        if ($target.Scheme -notin @('http', 'https') -or $urlBox.Text.Contains('"')) { throw 'http:// 또는 https:// 주소를 입력하세요.' }
        $runner = Join-Path $PSScriptRoot 'Run_LoadTest.ps1'
        $shell = Join-Path $PSHOME 'powershell.exe'
        if (-not (Test-Path -LiteralPath $shell)) { $shell = Join-Path $PSHOME 'pwsh.exe' }
        $params = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -TargetUrl "{1}" -Users {2} -Rooms {3} -Seconds {4}' -f $runner, $target.AbsoluteUri, [long]$userBox.Value, [long]$roomBox.Value, [long]$secondsBox.Value
        if ($stopBox.Checked) { $params += ' -StopOnErrors' }
        $script:currentProcess = Start-Process -FilePath $shell -ArgumentList $params -WorkingDirectory $PSScriptRoot -PassThru
        $run.Enabled = $false
        $state.Text = '실행 중입니다. 중단은 결과 창에서 Ctrl+C를 누르세요.'
        $timer.Start()
    } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, '실행 확인') | Out-Null }
})
$form.Add_FormClosed({ $timer.Stop(); $timer.Dispose() })
[void]$form.ShowDialog()
