#!/usr/bin/env bash
set -euo pipefail

# Restarts the Happy daemon from a detached subprocess so the caller can exit
# before the active daemon is stopped.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CLI_ENTRY="${CLI_ROOT}/dist/index.mjs"

if [[ ! -f "${CLI_ENTRY}" ]]; then
    echo "CLI entry not found: ${CLI_ENTRY}" >&2
    echo "Build happy-cli first (corepack yarn workspace happy-coder build)." >&2
    exit 1
fi

DELAY_SECONDS="${1:-3}"
if ! [[ "${DELAY_SECONDS}" =~ ^[0-9]+$ ]]; then
    echo "Delay must be an integer number of seconds." >&2
    exit 1
fi

LOG_DIR="${HOME}/.happy/logs"
mkdir -p "${LOG_DIR}"
RUN_ID="$(date +%Y-%m-%d-%H-%M-%S)"
LOG_FILE="${LOG_DIR}/${RUN_ID}-daemon-restart-safe.log"

nohup bash -c '
set -euo pipefail

CLI_ENTRY="$1"
DELAY_SECONDS="$2"
LOG_FILE="$3"

{
    echo "[restart] started at $(date -Is)"
    echo "[restart] waiting ${DELAY_SECONDS}s before stop"
    sleep "${DELAY_SECONDS}"

    echo "[restart] stopping daemon"
    node "${CLI_ENTRY}" daemon stop || true

    # Give socket cleanup a moment before starting again.
    sleep 2

    echo "[restart] starting daemon (with retries)"
    STARTED=0
    for attempt in $(seq 1 5); do
        if node "${CLI_ENTRY}" daemon start; then
            :
        else
            echo "[restart] daemon start command returned non-zero on attempt ${attempt}"
        fi

        STATUS_OUTPUT="$(node "${CLI_ENTRY}" daemon status 2>&1 || true)"
        if grep -qi "daemon is running" <<< "${STATUS_OUTPUT}"; then
            STARTED=1
            echo "[restart] daemon start succeeded on attempt ${attempt}"
            break
        fi

        echo "[restart] daemon start failed on attempt ${attempt}, retrying..."
        sleep 2
    done
    if [[ "${STARTED}" -ne 1 ]]; then
        echo "[restart] daemon failed to start after retries"
        exit 1
    fi

    echo "[restart] finished at $(date -Is)"
} >> "${LOG_FILE}" 2>&1
' _ "${CLI_ENTRY}" "${DELAY_SECONDS}" "${LOG_FILE}" </dev/null >/dev/null 2>&1 &

RUNNER_PID="$!"
echo "Scheduled detached daemon restart."
echo "  Runner PID: ${RUNNER_PID}"
echo "  Delay: ${DELAY_SECONDS}s"
echo "  Log: ${LOG_FILE}"
