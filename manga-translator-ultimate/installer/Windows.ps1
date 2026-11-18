param(
    [Parameter(Mandatory)][ValidateSet('Setup','Start','Stop','Pair','Model')][string]$Action,
    [ValidateSet('Small','Quality')][string]$Profile = 'Quality'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Engine = Join-Path $Root 'local-ai-engine'
$State = Join-Path $env:LOCALAPPDATA 'MangaTranslatorUltimate'
$Python = Join-Path $State 'venv\Scripts\python.exe'
$EngineUrl = 'http://127.0.0.1:18787'
$OllamaUrl = 'http://127.0.0.1:11434'
$ModelName = if ($Profile -eq 'Quality') { 'qwen3:4b-instruct-2507-q4_K_M' } else { 'qwen2.5:1.5b-instruct-q4_K_M' }
$env:MANGA_STATE_DIR = $State
$env:OLLAMA_HOST = '127.0.0.1:11434'
$env:OLLAMA_NO_CLOUD = '1'
$env:OLLAMA_NUM_PARALLEL = '1'
$env:OLLAMA_MAX_LOADED_MODELS = '1'
$env:OLLAMA_MAX_QUEUE = '8'
$env:NO_PROXY = 'localhost,127.0.0.1'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Path $State -Force | Out-Null

function Find-Exe([string]$Name, [string[]]$Paths) {
    $Found = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Found) { return $Found.Source }
    foreach ($Path in $Paths) { if ($Path -and (Test-Path -LiteralPath $Path)) { return $Path } }
    return $null
}

function Invoke-Checked([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$([IO.Path]::GetFileName($Exe)) exited with $LASTEXITCODE." }
}

function Find-Ollama {
    Find-Exe 'ollama.exe' @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
        (Join-Path $env:ProgramFiles 'Ollama\ollama.exe'))
}
function Find-Tesseract {
    Find-Exe 'tesseract.exe' @(
        (Join-Path $env:ProgramFiles 'Tesseract-OCR\tesseract.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Tesseract-OCR\tesseract.exe'))
}

function Install-Package([string]$Id) {
    $Winget = Find-Exe 'winget.exe' @()
    if (!$Winget) { throw "Install App Installer for Windows, or install $Id manually and run Setup again." }
    Invoke-Checked $Winget @('install','--exact','--id',$Id,'--source','winget','--accept-package-agreements','--accept-source-agreements','--disable-interactivity')
    $env:Path = @([Environment]::GetEnvironmentVariable('Path','Machine'), [Environment]::GetEnvironmentVariable('Path','User'), $env:Path) -join ';'
}

function Get-LocalJson([string]$Url, [hashtable]$Headers = @{}) {
    try { return Invoke-RestMethod -Uri $Url -Headers $Headers -TimeoutSec 2 -MaximumRedirection 0 }
    catch { return $null }
}

function Start-Owned([string]$Name, [string]$Exe, [string[]]$Arguments, [string]$Working) {
    $Process = Start-Process -FilePath $Exe -ArgumentList $Arguments -WorkingDirectory $Working -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $State "$Name.out.log") -RedirectStandardError (Join-Path $State "$Name.err.log")
    $Process.Refresh()
    if ($Process.HasExited) { throw "$Name failed to start. See $State\$Name.err.log." }
    @{id = $Process.Id; started = $Process.StartTime.ToUniversalTime().Ticks} | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $State "$Name.pid.json") -Encoding ASCII
}

function Wait-Json([string]$Url, [hashtable]$Headers, [string]$Name) {
    for ($Index=0; $Index -lt 30; $Index++) {
        $Result = Get-LocalJson $Url $Headers
        if ($Result) { return $Result }
        Start-Sleep -Milliseconds 650
    }
    throw "$Name did not respond. See $State\$Name.err.log."
}

function Start-Ollama {
    $Ollama = Find-Ollama
    if (!$Ollama) { throw 'Ollama executable not found. Run Setup.cmd.' }
    if (!(Get-LocalJson "$OllamaUrl/api/version")) {
        Start-Owned 'ollama' $Ollama @('serve') $State
        Wait-Json "$OllamaUrl/api/version" @{} 'ollama' | Out-Null
    }
    return $Ollama
}

function Pair-Headers {
    $File = Join-Path $State 'pairing-token.txt'
    if (!(Test-Path -LiteralPath $File)) { return @{} }
    return @{Authorization = 'Bearer ' + (Get-Content -LiteralPath $File -Raw).Trim()}
}

function Start-Engine {
    if (!(Test-Path -LiteralPath $Python)) { throw 'Python environment not found. Run Setup.cmd.' }
    $env:MANGA_TESSERACT = Find-Tesseract
    if (!$env:MANGA_TESSERACT) { throw 'Tesseract executable not found. Run Setup.cmd.' }
    Start-Ollama | Out-Null
    if (!(Get-LocalJson "$EngineUrl/health" (Pair-Headers))) {
        Start-Owned 'engine' $Python @('-m','manga_engine') $Engine
    }
    for ($Index=0; $Index -lt 30; $Index++) {
        $Result = Get-LocalJson "$EngineUrl/health" (Pair-Headers)
        if ($Result -and $Result.engine) {
            $Result | ConvertTo-Json -Depth 5
            Write-Host 'Local Engine is running. Close this setup window when ready.'
            return
        }
        Start-Sleep -Milliseconds 650
    }
    throw "Local Engine did not respond. See $State\engine.err.log."
}

function Read-Models {
    $Ollama = Start-Ollama
    $Tags = Get-LocalJson "$OllamaUrl/api/tags"
    $HaveModel = $Tags -and (@($Tags.models | Where-Object { $_.name -eq $ModelName }).Count -gt 0)
    if (!$HaveModel) { Invoke-Checked $Ollama @('pull',$ModelName) }
    $Models = Join-Path $Root 'models'
    New-Item -ItemType Directory -Path $Models -Force | Out-Null
    $Source = 'https://huggingface.co/ogkalu/manga-ocr-onnx/resolve/c68e56437a2e0b13a7b1f4efa0ffce76efd0478d'
    $Files = @{
        'encoder_model_int8.onnx'='0eaf2b867292a44700ce38ef028b90639a2e36fc4c18c2bcdd1de7409488adb3'
        'decoder_model_int8.onnx'='3ff0d4c34c4a66613d98ff93e0b17f22a7b09dfbeec195c3e4d6f595af3a6b6c'
        'vocab.txt'='5cb5c5586d98a2f331d9f8828e4586479b0611bfba5d8c3b6dadffc84d6a36a3'
    }
    foreach ($Name in $Files.Keys) {
        $Path = Join-Path $Models $Name
        if ((Test-Path -LiteralPath $Path) -and ((Get-FileHash -LiteralPath $Path).Hash -eq $Files[$Name])) { continue }
        $Temp = "$Path.part"
        Write-Host "Downloading $Name"
        try {
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -UseBasicParsing -Uri "$Source/$Name" -OutFile $Temp
            if ((Get-FileHash -LiteralPath $Temp).Hash -ne $Files[$Name]) { throw "SHA-256 mismatch for $Name." }
            Move-Item -LiteralPath $Temp -Destination $Path -Force
        } finally {
            if (Test-Path -LiteralPath $Temp) { Remove-Item -LiteralPath $Temp }
        }
    }
    Write-Host "Local models ready. Model tag: $ModelName"
}

switch ($Action) {
    'Setup' {
        $Lock = [Threading.Mutex]::new($false, 'Local\MangaTranslatorUltimateSetup')
        if (!$Lock.WaitOne(0)) { throw 'Setup is already running.' }
        try {
            if (!(Test-Path -LiteralPath $Python)) {
                $Launcher = Find-Exe 'py.exe' @((Join-Path $env:LOCALAPPDATA 'Programs\Python\Launcher\py.exe'))
                $Native = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
                if ($Launcher) { & $Launcher -3.12 -c 'import sys' 2>$null }
                if (!(Test-Path -LiteralPath $Native) -and (!$Launcher -or $LASTEXITCODE -ne 0)) {
                    Install-Package 'Python.Python.3.12'
                    $Launcher = Find-Exe 'py.exe' @((Join-Path $env:LOCALAPPDATA 'Programs\Python\Launcher\py.exe'))
                }
                if (Test-Path -LiteralPath $Native) { Invoke-Checked $Native @('-m','venv',(Join-Path $State 'venv')) }
                elseif ($Launcher) { Invoke-Checked $Launcher @('-3.12','-m','venv',(Join-Path $State 'venv')) }
                else { throw 'Python 3.12 not found. Reopen Setup or install Python 3.12 from python.org.' }
            }
            if (!(Find-Tesseract)) { Install-Package 'UB-Mannheim.TesseractOCR' }
            if (!(Find-Ollama)) { Install-Package 'Ollama.Ollama' }
            Invoke-Checked $Python @('-m','pip','install','--disable-pip-version-check','--requirement',(Join-Path $Engine 'requirements.txt'))
            $Tesseract = Find-Tesseract
            if (!$Tesseract) { throw 'Tesseract install was not found.' }
            $Languages = & $Tesseract --list-langs 2>&1
            if ($LASTEXITCODE -ne 0 -or $Languages -notcontains 'eng') { throw 'Tesseract English data (eng) is missing.' }
            Read-Models
            Start-Engine
            Set-Clipboard -Value ((Pair-Headers).Authorization.Substring(7))
            Write-Host 'Pairing code copied. Load extension\dist at chrome://extensions, then paste into Settings.'
        } finally { $Lock.ReleaseMutex(); $Lock.Dispose() }
    }
    'Start' { Start-Engine }
    'Model' { Read-Models }
    'Pair' {
        $Headers = Pair-Headers
        if (!$Headers.ContainsKey('Authorization')) { throw 'Run Setup or Start Engine first.' }
        Set-Clipboard -Value $Headers.Authorization.Substring(7)
        Write-Host 'Pairing code copied.'
    }
    'Stop' {
        foreach ($Name in @('engine','ollama')) {
            $Path = Join-Path $State "$Name.pid.json"
            if (!(Test-Path -LiteralPath $Path)) { continue }
            $Data = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
            $Process = Get-Process -Id $Data.id -ErrorAction SilentlyContinue
            if ($Process -and $Process.StartTime.ToUniversalTime().Ticks -eq $Data.started) { Stop-Process -Id $Data.id }
            Remove-Item -LiteralPath $Path
        }
        Write-Host 'Managed engine processes stopped.'
    }
}
