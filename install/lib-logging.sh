#!/usr/bin/env bash
# install/lib-logging.sh — colors and info/ok/warn/err helpers.
# Sourced by install.sh.

# Idempotent guard: re-sourcing is a no-op
[ -n "${LIB_AGENTS_LOGGING_LOADED:-}" ] && return 0
LIB_AGENTS_LOGGING_LOADED=1

# Colors. Global assignments; consumed across all lib-*.sh modules
# (status/update/install/profiles/manifest) which source this file once.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
# shellcheck disable=SC2034  # CYAN consumed by lib-status.sh, lib-update.sh
CYAN='\033[0;36m'
# shellcheck disable=SC2034  # BOLD consumed by lib-status.sh, lib-update.sh
BOLD='\033[1m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }
