#!/usr/bin/env bash
# TURN relay anomaly detection.
#
# Cron this every 5 minutes. Reads turnserver.log, counts bytes per
# allocation in the last window, and alerts when:
#   - a single credential proxies > MAX_BYTES_PER_CRED bytes (proxy abuse), OR
#   - total throughput jumped > AGGREGATE_BYTES (DDoS amplification).
#
# Alerts go to stderr. Wire to your alerting (Slack, PagerDuty) by piping:
#   monitor_turn_usage.sh | curl -X POST $SLACK_WEBHOOK ...
#
# Tested with coturn 4.5.x on Ubuntu 22.04.

set -euo pipefail

LOG_FILE="${TURN_LOG_FILE:-/var/log/coturn/turnserver.log}"
WINDOW_MINUTES="${TURN_WINDOW_MINUTES:-5}"
MAX_BYTES_PER_CRED="${TURN_MAX_BYTES_PER_CRED:-1073741824}"     # 1 GiB / window
AGGREGATE_BYTES="${TURN_AGGREGATE_BYTES:-21474836480}"           # 20 GiB / window

if [[ ! -r "$LOG_FILE" ]]; then
  echo "ERROR: cannot read $LOG_FILE" >&2
  exit 1
fi

since_epoch=$(( $(date +%s) - WINDOW_MINUTES * 60 ))

# coturn log lines for traffic counters look like:
#   1234567890: session 0x...: usage: rcvp=NN, rcvb=NN, sentp=NN, sentb=NN, ...
# We sum rcvb+sentb per username (HMAC credential) inside the window.
awk -v cutoff="$since_epoch" -v max_cred="$MAX_BYTES_PER_CRED" -v agg_limit="$AGGREGATE_BYTES" '
  /usage:/ {
    # Extract leading epoch timestamp (coturn uses unix seconds at line start
    # when started with --syslog=no --simple-log).
    ts = $1 + 0
    if (ts < cutoff) next

    # Try to find the username= token; coturn includes it in usage lines.
    user = "unknown"
    for (i = 1; i <= NF; i++) {
      if ($i ~ /^username=/) { user = substr($i, 10); gsub(/[",]/, "", user) }
      if ($i ~ /^rcvb=/)    { rcvb = substr($i, 6); gsub(/,/, "", rcvb); per[user] += rcvb; total += rcvb }
      if ($i ~ /^sentb=/)   { sentb = substr($i, 7); gsub(/,/, "", sentb); per[user] += sentb; total += sentb }
    }
  }
  END {
    flagged = 0
    for (u in per) {
      if (per[u] > max_cred) {
        printf "ALERT: credential %s used %d bytes in last window (limit %d)\n", u, per[u], max_cred > "/dev/stderr"
        flagged = 1
      }
    }
    if (total > agg_limit) {
      printf "ALERT: aggregate TURN traffic %d bytes in last window (limit %d)\n", total, agg_limit > "/dev/stderr"
      flagged = 1
    }
    printf "{\"window_minutes\":%d,\"total_bytes\":%d,\"top_credentials\":[", '"$WINDOW_MINUTES"', total
    first = 1
    n = 0
    for (u in per) {
      n++
      if (n > 5) break
      if (!first) printf ","
      first = 0
      printf "{\"user\":\"%s\",\"bytes\":%d}", u, per[u]
    }
    printf "]}\n"
    exit flagged
  }
' "$LOG_FILE"
