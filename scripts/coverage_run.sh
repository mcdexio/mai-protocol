#!/usr/bin/env bash

npx solidity-coverage

if [ "$CONTINUOUS_INTEGRATION" = true ]; then
  cat coverage/lcov.info | node_modules/.bin/coveralls --verbose
fi
