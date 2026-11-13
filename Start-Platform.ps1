$ErrorActionPreference = 'Stop'
$project = $PSScriptRoot
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($null -eq $node) {
    $nodeCandidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe')
    )
    foreach ($candidate in $nodeCandidates) {
        if (Test-Path -LiteralPath $candidate) {
            $node = Get-Item -LiteralPath $candidate
            break
        }
    }
}
if ($null -eq $node) {
    Write-Host 'Node.js not found. Starting compatibility static server.' -ForegroundColor Yellow
}
$nodePath = $null
if ($null -ne $node) {
    $nodePath = if ($node.PSObject.Properties.Name -contains 'Source') { $node.Source } else { $node.FullName }
}
$builder = Join-Path $project 'scripts\build-weld-status.mjs'
$server = Join-Path $project 'server.mjs'
if (-not (Test-Path -LiteralPath $server)) {
    Write-Host 'server.mjs was not found.' -ForegroundColor Red
    exit 1
}
if ($null -ne $node -and (Test-Path -LiteralPath $builder)) {
    & $nodePath $builder
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Weld index build failed.' -ForegroundColor Red
        exit 1
    }
}

$port = 4173
$nodePath = $null
if ($null -ne $node) { $nodePath = if ($node.PSObject.Properties.Name -contains 'Source') { $node.Source } else { $node.FullName } }
$staticOnly = ($null -eq $node)
$port = 4173
$reusePort = -1
while ($port -lt 4184) {
    $uri = 'http://127.0.0.1:' + $port + '/api/weld-status?check=1'
    try {
        $reply = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 1
        if ($reply.StatusCode -eq 200) {
            $reusePort = $port
            break
        }
    }
    catch {
        $reply = $null
    }
    $port = $port + 1
}
if ($reusePort -ge 0) {
    Start-Process ('http://127.0.0.1:' + $reusePort + '/')
    exit 0
}

$port = 4173
$freePort = -1
while ($port -lt 4184) {
    $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
    try {
        $listener.Start()
        $listener.Stop()
        $freePort = $port
        break
    }
    catch {
        $listener.Stop()
    }
    $port = $port + 1
}
if ($freePort -lt 0) {
    Write-Host 'No free port. Close old platform windows and retry.' -ForegroundColor Red
    exit 1
}

if ($staticOnly) {
    $webRoot = [IO.Path]::GetFullPath((Join-Path $project 'public'))
    $listener = [Net.HttpListener]::new()
    $listener.Prefixes.Add('http://127.0.0.1:' + $freePort + '/')
    $listener.Start()
    $url = 'http://127.0.0.1:' + $freePort + '/'
    Write-Host ('Platform started in compatibility mode: ' + $url) -ForegroundColor Yellow
    Start-Process $url
    $mime = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.json'='application/json; charset=utf-8'; '.b3dm'='application/octet-stream'; '.bin'='application/octet-stream'; '.wasm'='application/wasm'; '.svg'='image/svg+xml' }
    try {
        while ($listener.IsListening) {
            $context = $listener.GetContext()
            $response = $context.Response
            try {
                $relative = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath.TrimStart('/'))
                if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
                $file = [IO.Path]::GetFullPath((Join-Path $webRoot $relative))
                if (-not $file.StartsWith($webRoot, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) { $response.StatusCode = 404; continue }
                $bytes = [IO.File]::ReadAllBytes($file)
                $response.ContentType = $mime[[IO.Path]::GetExtension($file).ToLowerInvariant()]
                $response.ContentLength64 = $bytes.Length
                if ($context.Request.HttpMethod -eq 'GET') { $response.OutputStream.Write($bytes, 0, $bytes.Length) }
            } finally { $response.Close() }
        }
    } finally { $listener.Stop(); $listener.Close() }
    exit 0
}

$env:PORT = [string]$freePort
$url = 'http://127.0.0.1:' + $freePort + '/'
Write-Host ('Platform started: ' + $url) -ForegroundColor Green
Start-Process $url
& $nodePath $server
