$ErrorActionPreference = "Stop"

Write-Host "JARVIS Cloud Telegram webhook setup"
Write-Host "IMPORTANT: use the NEW Cloud Phase 2 bot token, not your local Windows/Ollama bot token."
$tokenSecure = Read-Host "Paste the NEW Cloud Phase 2 Telegram bot token (input is hidden)" -AsSecureString
$tokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($tokenSecure)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPtr)
    $workerUrl = (Read-Host "Enter your deployed Worker URL, ending in /telegram").Trim()
    $secret = Read-Host "Enter the TELEGRAM_WEBHOOK_SECRET you saved in Cloudflare (hidden)" -AsSecureString
    $secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $secretText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
        if ($workerUrl -notmatch '^https://[^\s]+/telegram$') {
            throw "Worker URL must be HTTPS and end in /telegram."
        }
        if ($secretText -notmatch '^[A-Za-z0-9_-]{1,256}$') {
            throw "Webhook secret must contain only letters, numbers, underscores, or hyphens (1-256 characters)."
        }
        $body = @{
            url = $workerUrl
            secret_token = $secretText
            allowed_updates = @("message")
            drop_pending_updates = $false
        } | ConvertTo-Json -Depth 4
        $response = Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType "application/json" -Body $body
        if ($response.ok) {
            Write-Host "Webhook registered successfully. Telegram can now reach JARVIS Cloud."
        } else {
            throw "Telegram did not confirm webhook registration."
        }
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
    }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPtr)
    $token = $null
}
