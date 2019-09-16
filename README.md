# Mai Protocol

[![CircleCI](https://circleci.com/gh/mcdexio/mai-protocol/tree/master.svg?style=svg)](https://circleci.com/gh/mcdexio/mai-protocol/tree/master)
[![codecov](https://codecov.io/gh/mcdexio/mai-protocol/branch/master/graph/badge.svg)](https://codecov.io/gh/mcdexio/mai-protocol)


Mai Protocol is an open-source framework for building decentralized derivatives exchanges on Ethereum.

Mai Protocol's goal is to make trading decentralized derivatives easy and efficient.

See the [document](https://github.com/mcdexio/documents/blob/master/en/mai.md) for more details about Mai Protocol.

## Features

Mai 1.0 contains a contract called `MaiProtocol.sol` with the following attributes:

* Trading Market Protocol contracts
  * Encapsulates the minting, exchange and redeeming operations
  * A minting pool to reduce redundant minting and redeeming
* No order collision
* No possibility of front-running
* Accurate market orders
* Ability to collect fees as a percentage of the traded assets
* Allows asymmetrical maker/taker fee structure, rebates, discounts
* Highly optimized gas usage

## Installation

```bash
npm install
```
To build json ABI files:

```bash
npm run compile
```

## Tests

```bash
npm run coverage
```

## Acknowledgments

Mai is inspired by the [0x project](https://github.com/0xProject) and [Hydro](https://github.com/HydroProtocol)

## Contributing

1. Fork it (<https://github.com/mcdexio/mai-protocol/fork>)
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request

## License

This project is licensed under the Apache-2.0 License - see the [LICENSE.txt](LICENSE.txt) file for details
