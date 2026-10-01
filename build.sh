#!/bin/bash
set -e

# Git Bash on Windows rewrites Unix-looking arguments such as "/work" into
# Windows paths ("C:/Program Files/Git/work"); turn that off, and give Docker
# the Windows form of the current directory instead ("pwd -W", Git Bash only)
export MSYS_NO_PATHCONV=1
HOST_DIR="$(pwd -W 2>/dev/null || pwd)"

git submodule update --init --recursive
docker build -t gifcap-encoder -f encoder/Dockerfile .
docker run --rm -v "$HOST_DIR:/work" -w /work gifcap-encoder
