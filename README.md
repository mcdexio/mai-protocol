# <img src="https://raw.github.com/mcdexio/mai-protocol/master/images/logo.png" height="26px" title="Mai Protocol" />

[![Build Status](https://travis-ci.org/mcdexio/mai-protocol.svg?branch=master)](https://travis-ci.org/mcdexio/mai-protocol)
[![Coverage Status](https://coveralls.io/repos/github/mcdexio/mai-protocol/badge.svg?branch=master)](https://coveralls.io/github/mcdexio/mai-protocol?branch=master)

Mai Protocol is an open-source framework for building decentralized derivatives exchanges on Ethereum.

Mai Protocol's goal is to make trading decentralized derivatives easy and efficient.

See the [document](https://github.com/mcdexio/documents/blob/master/en/mai.md) for more details about Mai Protocol.

## Features

Mai Protocol smart contract v1.0 has the following attributes:

* Trading Market Protocol contracts
  * Encapsulates the minting, exchange and redeeming operations
  * A minting pool to reduce redundant minting and redeeming
* No order collision
* No possibility of front-running
* Accurate market orders
* Ability to collect fees as a percentage of the collateral token
* Allows asymmetrical maker/taker fee structure
* Highly optimized gas usage

## Interfaces

Mai Protocol:
```
structs:
  OrderParam                   parameters for building a taker/maker order
    - trader                   address of trader
    - amount                   the amount of position to buy/sell, decimals = 5
    - price                    the price of position, decimals = 10
    - gasTokenAmount           the gas fee for order matching, in collateral token. 
    - data                     a 32 bytes long data containing order details
        - version              mai protocol version, should match mai protocol contract on chain
        - side                 side of order, should be 0(buy) or 1(sell)
        - isMarketOrder        type of order, should be 0(limit order) or 1(market order)
        - expiredAt            order expiration time in seconds
        - asMakerFeeRate       trading fee rate as a maker (rate = asMakerFeeRate / 100,000)
        - asTakerFeeRate       trading fee rate as a taker (rate = asTakerFeeRate / 100,000)
        - makerRebateRate      reserved
        - salt                 a random nonce
        - isMakerOnly          to indicate the order should only be a maker
	
  OrderAddressSet              containing addresses common across each order
    - marketContractAddress    address of market protocol contract
    - relayer                  user acturally sending matching transaction and collecting trading fees during matching.
	
  Order                        containing necessary information of an order, built by OrderParam and OrderAddressSet

actions:
  matchMarketContractOrders        match orders from taker and makers to mint/redeem/exchange tokens published by Market Protocol contracts.
    - takerOrderParam              taker of the matching
    - makerOrderParams             makers of the matching, could be one or more
    - posFilledAmounts             an array representing how much positions should match for each take-maker pair. should have the same length with makerOrderParams
    - orderAddressSet              addresses sharing among taker and makers

  cancelOrder                      cancel an order, the canceled order can no longer match or be matched.
  
  setMarketRegistryAddress  owner  set a non-0x address market register to enable market contract is in the official publishing list.
  
  setMintingPool            owner  set collateral pool for proxy, see documents for details abount collateral pool 
  
  approveERC20              owner  approve a spender to transfer erc20 token from mai-protocol
  
  withdrawERC20             owner  withdraw erc20 token from mai-protocol. note that the mai-protocol itself should NEVER hold any token
  
```

MintingPool:
```
actions:
  approveERC20                  owner  approve a spender to transfer erc20 token from minting pool
  
  withdrawERC20                 owner  withdraw erc20 token from minting pool, usually the collateral token and the market token for minting market contract positions
  
  internalMintPositionTokens    owner        converting collateral in pool to position tokens for further minting requests
  internalRedeemPositionTokens  owner        converting position tokens in pool to collateral tokens for further redeeming requests

  mintPositionTokens            whitelisted  mint position tokens from collateral pool, then send minted tokens to caller
  redeemPositionTokens          whitelisted  redeem position tokens from collateral pool, then send redeemed tokens to caller
```

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

## License

This project is licensed under the Apache-2.0 License - see the [LICENSE.txt](LICENSE.txt) file for details
