# CloudWatch alarms — SQS age + DLQ depth (ADR-0003 Fase 6)
#   .\scripts\setup-sqs-alarms.ps1
# Optional: -AlarmEmail ops@example.com (cria SNS topic + subscription se nao existir)

param(
    [string]$Profile = "renthus",
    [string]$Region = "sa-east-1",
    [string]$AlarmEmail = "",
    [int]$AgeSeconds = 120
)

$ErrorActionPreference = "Stop"
$AccountId = "696457893414"

Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue

function Invoke-AwsRaw {
    param([string[]]$CommandArgs)
    $cli = @("--profile", $Profile, "--region", $Region) + $CommandArgs
    & aws @cli
    if ($LASTEXITCODE -ne 0) {
        throw "aws failed (exit $LASTEXITCODE): $($CommandArgs -join ' ')"
    }
}

function Invoke-AwsText {
    param([string[]]$CommandArgs)
    $out = Invoke-AwsRaw ($CommandArgs + @("--output", "text"))
    return ($out | Out-String).Trim()
}

$queues = @(
    @{ Name = "renthus-inbound.fifo"; Alarm = "renthus-inbound-age"; Metric = "ApproximateAgeOfOldestMessage"; Threshold = $AgeSeconds },
    @{ Name = "renthus-outbound.fifo"; Alarm = "renthus-outbound-age"; Metric = "ApproximateAgeOfOldestMessage"; Threshold = $AgeSeconds },
    @{ Name = "renthus-inbound-dlq.fifo"; Alarm = "renthus-inbound-dlq-depth"; Metric = "ApproximateNumberOfMessagesVisible"; Threshold = 0 },
    @{ Name = "renthus-outbound-dlq.fifo"; Alarm = "renthus-outbound-dlq-depth"; Metric = "ApproximateNumberOfMessagesVisible"; Threshold = 0 }
)

$snsArn = ""
if ($AlarmEmail) {
    $topicName = "renthus-sqs-ops"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $existing = aws --profile $Profile --region $Region sns list-topics --output json 2>$null | ConvertFrom-Json
    $ErrorActionPreference = $prev
    $found = $existing.Topics | Where-Object { $_.TopicArn -like "*:$topicName" } | Select-Object -First 1
    if ($found) {
        $snsArn = $found.TopicArn
        Write-Host "SNS topic exists: $snsArn" -ForegroundColor Yellow
    } else {
        Write-Host "Creating SNS topic $topicName" -ForegroundColor Cyan
        $snsArn = Invoke-AwsText @("sns", "create-topic", "--name", $topicName, "--query", "TopicArn")
        Invoke-AwsRaw @("sns", "subscribe", "--topic-arn", $snsArn, "--protocol", "email", "--notification-endpoint", $AlarmEmail)
        Write-Host "Confirm the SNS subscription email sent to $AlarmEmail" -ForegroundColor Yellow
    }
}

foreach ($q in $queues) {
    $url = Invoke-AwsText @("sqs", "get-queue-url", "--queue-name", $q.Name, "--query", "QueueUrl")
    $qNameDim = $q.Name

    $comparison = if ($q.Metric -eq "ApproximateAgeOfOldestMessage") { "GreaterThanThreshold" } else { "GreaterThanThreshold" }
    # DLQ: alarm when depth > 0
    $threshold = if ($q.Metric -eq "ApproximateNumberOfMessagesVisible") { 0 } else { $q.Threshold }

    Write-Host "Upsert alarm $($q.Alarm) on $qNameDim $($q.Metric) > $threshold" -ForegroundColor Cyan

    $args = @(
        "cloudwatch", "put-metric-alarm",
        "--alarm-name", $q.Alarm,
        "--alarm-description", ("ADR-0003 " + $q.Name + " " + $q.Metric),
        "--namespace", "AWS/SQS",
        "--metric-name", $q.Metric,
        "--dimensions", ("Name=QueueName,Value=" + $qNameDim),
        "--statistic", "Maximum",
        "--period", "60",
        "--evaluation-periods", "2",
        "--threshold", "$threshold",
        "--comparison-operator", $comparison,
        "--treat-missing-data", "notBreaching"
    )
    if ($snsArn) {
        $args += @("--alarm-actions", $snsArn, "--ok-actions", $snsArn)
    }
    Invoke-AwsRaw $args
}

Write-Host ""
Write-Host "Alarms OK" -ForegroundColor Green
Write-Host "  inbound/outbound age > ${AgeSeconds}s (2x60s)"
Write-Host "  inbound/outbound DLQ depth > 0"
if (-not $snsArn) {
    Write-Host "  Tip: re-run with -AlarmEmail you@domain.com to attach SNS notifications"
}
