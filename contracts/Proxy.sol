/*
    Copyright 2019 mcdexio

    Copyright 2018 The Hydro Protocol Foundation

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

*/

pragma solidity ^0.5.2;

import "./lib/LibOwnable.sol";
import "./lib/LibWhitelist.sol";
import "./interfaces/IMarketContractPool.sol";
import "./interfaces/IMarketContract.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract Proxy is LibOwnable, LibWhitelist {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /// Address of token pool, 0x0 indicates using contract collateral pool
    address public collateralPoolAddress;

    event Withdraw(address indexed contractAddress, address indexed to, uint256 amount);
    event Transfer(address indexed from, address indexed to, uint256 value);

    /// @param _collateralPoolAddress Address of token pool.
    function setCollateralPoolAddress(address _collateralPoolAddress) public onlyOwner {
        collateralPoolAddress = _collateralPoolAddress;
    }

    /// @dev Approve transfer from proxy for mint or redeem. This method must be called immediately
    /// after every trading pair added to dex system.
    /// @param contractAddress Address of market contract.
    function approveCollateralPool(address contractAddress, address spender, uint256 amount)
        public
        onlyOwner
    {
        IMarketContract marketContract = IMarketContract(contractAddress);
        // to make token that compiled with old version solidity compatible
        IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS()).safeApprove(spender, amount);
        IERC20(marketContract.LONG_POSITION_TOKEN()).safeApprove(spender, amount);
        IERC20(marketContract.SHORT_POSITION_TOKEN()).safeApprove(spender, amount);
    }

    function withdrawCollateral(address contractAddress, uint256 amount)
        public
        onlyOwner
    {
        IMarketContract marketContract = IMarketContract(contractAddress);
        IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS()).safeTransfer(msg.sender, amount);

        emit Withdraw(contractAddress, msg.sender, amount);
    }

    /// @dev Invoking transfer.
    /// @param token Address of token to transfer.
    /// @param to Address to transfer token to.
    /// @param value Amount of token to transfer.
    function transfer(address token, address to, uint256 value)
        external
        onlyAddressInWhitelist
    {
        IERC20(token).safeTransfer(to, value);
    }

    /// @dev Invoking transferFrom.
    /// @param token Address of token to transfer.
    /// @param from Address to transfer token from.
    /// @param to Address to transfer token to.
    /// @param value Amount of token to transfer.
    function transferFrom(address token, address from, address to, uint256 value)
        external
        onlyAddressInWhitelist
    {
        IERC20(token).safeTransferFrom(from, to, value);
    }

    /// @dev Invoking mintPositionTokens.
    /// @param contractAddress Address of MARKET Protocol contract.
    /// @param qtyToMint Quantity to mint in position token.
    function mintPositionTokens(
        address contractAddress,
        uint256 qtyToMint
    )
        external
        onlyAddressInWhitelist
    {
        IMarketContractPool marketContractPool;
        bool isAttemptToPayInMKT;
        if (collateralPoolAddress != address(0x0)) {
            marketContractPool = IMarketContractPool(collateralPoolAddress);
            isAttemptToPayInMKT = true;
        } else {
            IMarketContract marketContract = IMarketContract(contractAddress);
            marketContractPool = IMarketContractPool(marketContract.COLLATERAL_POOL_ADDRESS());
            isAttemptToPayInMKT = false;
        }
        marketContractPool.mintPositionTokens(contractAddress, qtyToMint, isAttemptToPayInMKT);
    }

    /// @dev Invoking redeemPositionTokens.
    /// @param contractAddress Address of MARKET Protocol contract.
    /// @param qtyToRedeem Quantity to redeem in position token.
    function redeemPositionTokens(
        address contractAddress,
        uint256 qtyToRedeem
    )
        external
        onlyAddressInWhitelist
    {
        IMarketContractPool marketContractPool;
        if (collateralPoolAddress != address(0x0)) {
            marketContractPool = IMarketContractPool(collateralPoolAddress);
        } else {
            IMarketContract marketContract = IMarketContract(contractAddress);
            marketContractPool = IMarketContractPool(marketContract.COLLATERAL_POOL_ADDRESS());
        }
        marketContractPool.redeemPositionTokens(contractAddress, qtyToRedeem);
    }
}