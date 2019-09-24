#!/usr/bin/env bash

# Exit script as soon as a command fails.
set -o errexit

start_testrpc() {
    docker run -d -p 7545:7545 trufflesuite/ganache-cli:latest -p 7545 -l 8000000
}

echo "Starting our own testrpc instance"
start_testrpc

