#!/usr/bin/env bash
set -euo pipefail

need_cmd(){ command -v "$1" >/dev/null 2>&1; }
log(){ echo "[dechat] $*"; }

ensure_packages(){
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl git jq >/dev/null 2>&1 || true
}

install_docker(){
  if need_cmd docker; then
    log "docker already installed"
  else
    log "installing docker..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER" || true
  fi

  # Enforce Docker Compose v2 (no legacy python compose)
  if docker compose version >/dev/null 2>&1; then
    log "docker compose v2 available"
  else
    log "installing docker compose v2 plugin..."
    sudo apt-get update -y
    sudo apt-get install -y docker-compose-plugin
  fi
}

repo_sync(){
  local repo_url="$1"
  local install_dir="$2"
  sudo mkdir -p "$install_dir"
  sudo chown -R "$USER":"$USER" "$install_dir"
  if [[ -d "$install_dir/.git" ]]; then
    log "repo exists; pulling latest..."
    git -C "$install_dir" pull --rebase
  else
    log "cloning repo..."
    git clone "$repo_url" "$install_dir"
  fi
}

rand_hex(){
  openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

detect_public_ip(){
  curl -fsSL https://api.ipify.org 2>/dev/null || curl -fsSL https://ifconfig.me 2>/dev/null || echo ""
}

compose_up(){
  docker compose -f "$1" up -d --build
}
