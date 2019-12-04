/*
    Copyright 2019 mcdexio

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

contract MintingPool is LibOwnable, LibWhitelist {

    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /**
     * Statistic record. MPX Contract => Amounts
     */
    mapping(address => uint256) public minted;
    mapping(address => uint256) public redeemed;
    mapping(address => uint256) public sent;
    mapping(address => uint256) public received;

    event Mint(address indexed contractAddress, address indexed to, uint256 value);
    event Redeem(address indexed contractAddress, address indexed to, uint256 value);
    event Withdraw(address indexed tokenAddress, address indexed to, uint256 amount);
    event Approval(address indexed tokenAddress, address indexed spender, uint256 amount);

    /// @dev Withdraw erc20 token from pool, owner only.
    /// @param token Address of erc20 token.
    /// @param amount Amount of collater to withdraw.
    function withdrawERC20(address token, uint256 amount)
        external
        onlyOwner
    {
        require(amount > 0, "INVALID_AMOUNT");

        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdraw(token, msg.sender, amount);
    }


    /// @dev Approve erc20 token, mainly allow market contract transfer these tokens.
    /// Function `mintPositionTokens` requires collateral/mkt allowance to work properly.
    /// @param token Address of erc20 token.
    /// @param spender Spender of erc20 token, allowed to transfer up to amount erc20 token from pool.
    /// @param amount Amount to approve for speicified market contarct.
    function approveERC20(address token, address spender, uint256 amount)
        public
        onlyOwner
    {
        IERC20(token).safeApprove(spender, amount);

        emit Approval(token, msg.sender, amount);
    }


    /// @dev Mint position tokens with collateral within contract for further exchange.
    /// Called by administrator periodly to adjust the ratio of collateral to position tokens.
    /// Not like in mintPositionTokens, payInMKT will force using mkt to pay fee.
    /// @param marketContractAddress Address of market contract.
    /// @param qtyToMint Quantity of position tokens to mint.
    /// @param payInMKT Try to use mkt as mint fee, only when pool has enough mkt tokens.
    function internalMintPositionTokens(
        address marketContractAddress,
        uint qtyToMint,
        bool payInMKT
    )
        external
        onlyOwner
    {
        IMarketContract marketContract = IMarketContract(marketContractAddress);
        IMarketContractPool marketContractPool = IMarketContractPool(
            marketContract.COLLATERAL_POOL_ADDRESS()
        );
        marketContractPool.mintPositionTokens(
            marketContractAddress,
            qtyToMint,
            payInMKT
        );

        emit Mint(marketContractAddress, address(this), qtyToMint);
    }


    /// @dev Redeem collateral with position tokens within contract for further exchange.
    /// Called by administrator periodly to adjust the ratio of collateral to position tokens.
    /// The return amount of the collateral is decided by specified market protocol.
    /// @param marketContractAddress Address of market contract.
    /// @param qtyToRedeem Quantity of position tokens to redeem.
    function internalRedeemPositionTokens(
        address marketContractAddress,
        uint qtyToRedeem
    )
        external
        onlyOwner
    {
        IMarketContract marketContract = IMarketContract(marketContractAddress);
        IMarketContractPool marketContractPool = IMarketContractPool(
            marketContract.COLLATERAL_POOL_ADDRESS()
        );
        marketContractPool.redeemPositionTokens(marketContractAddress, qtyToRedeem);

        emit Redeem(marketContractAddress, address(this), qtyToRedeem);
    }


    /// @dev Mint position Tokens and send them to msg.sender.
    /// Tokens will be directly transfer to sender when pool
    /// has enough position tokens in it, otherwise tokens will be minted from market contract pool.
    /// Position tokens are always tranferred in pairs (long == short).
    /// isAttemptToPayInMKT is not a promising but an attempt. It works only when the amount of mkt
    /// tokens in pool could fully cover the mint fee of position tokens, or the fee would still be
    /// paid in collateral token.
    /// @param marketContractAddress Address of market contract.
    /// @param qtyToMint Quantity of position tokens to mint.
    function mintPositionTokens(
        address marketContractAddress,
        uint qtyToMint,
        bool
    )
        external
        onlyAddressInWhitelist
    {
        require(qtyToMint > 0, "INVALID_AMOUNT");

        IMarketContract marketContract = IMarketContract(marketContractAddress);

        uint256 neededCollateral = calculateTotalCollateral(marketContract, qtyToMint);

        IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS()).safeTransferFrom(
            msg.sender,
            address(this),
            neededCollateral
        );

        if (hasEnoughPositionBalance(marketContractAddress, qtyToMint)) {
            sent[marketContractAddress] = sent[marketContractAddress].add(qtyToMint);
        } else {
            uint256 neededMakretToken = calculateMarketTokenFee(marketContract, qtyToMint);

            IMarketContractPool marketContractPool = IMarketContractPool(
                marketContract.COLLATERAL_POOL_ADDRESS()
            );
            bool useMarketToken = hasEnoughBalance(
                marketContractPool.mktToken(),
                neededMakretToken
            );
            marketContractPool.mintPositionTokens(marketContractAddress, qtyToMint, useMarketToken);

            minted[marketContractAddress] = minted[marketContractAddress].add(qtyToMint);
        }

        IERC20(marketContract.LONG_POSITION_TOKEN()).safeTransfer(msg.sender, qtyToMint);
        IERC20(marketContract.SHORT_POSITION_TOKEN()).safeTransfer(msg.sender, qtyToMint);

        emit Mint(marketContractAddress, msg.sender, qtyToMint);
    }

    /// @dev Redeem position Tokens owned by msg.sender, get collateral back.
    /// Tokens will be directly transfer to sender when pool has enough position tokens in it,
    /// otherwise tokens will be minted from market contract pool.
    /// Position tokens are always tranferred in pairs (long == short).
    /// @param marketContractAddress Address of market contract.
    /// @param qtyToRedeem Quantity of position tokens to redeem.
    function redeemPositionTokens(
        address marketContractAddress,
        uint qtyToRedeem
    )
        external
        onlyAddressInWhitelist
    {
        require(qtyToRedeem > 0, "INVALID_AMOUNT");

        IMarketContract marketContract = IMarketContract(marketContractAddress);

        IERC20(marketContract.LONG_POSITION_TOKEN()).safeTransferFrom(
            msg.sender,
            address(this),
            qtyToRedeem
        );
        IERC20(marketContract.SHORT_POSITION_TOKEN()).safeTransferFrom(
            msg.sender,
            address(this),
            qtyToRedeem
        );

        uint256 collateralToReturn = calculateCollateralToReturn(marketContract, qtyToRedeem);

        if (hasEnoughBalance(marketContract.COLLATERAL_TOKEN_ADDRESS(), collateralToReturn)) {
            received[marketContractAddress] = received[marketContractAddress].add(qtyToRedeem);
        } else {
            IMarketContractPool marketContractPool = IMarketContractPool(
                marketContract.COLLATERAL_POOL_ADDRESS()
            );
            marketContractPool.redeemPositionTokens(marketContractAddress, qtyToRedeem);

            redeemed[marketContractAddress] = redeemed[marketContractAddress].add(qtyToRedeem);
        }
        IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS()).safeTransfer(
            msg.sender,
            collateralToReturn
        );

        emit Redeem(marketContractAddress, msg.sender, qtyToRedeem);
    }

    /// @dev Helper function to detect balance of the pool for given token is greater than
    /// the threshold.
    /// @param tokenAddress Address of an ERC20 token.
    /// @param amount Amount threshold.
    function hasEnoughBalance(address tokenAddress, uint256 amount)
        internal
        view
        returns (bool)
    {
        return IERC20(tokenAddress).balanceOf(address(this)) >= amount;
    }

    /// @dev Helper function to detect position balance of the pool for given token is greater than
    /// the threshold.
    /// @param marketContractAddress Address of MARKET Protocol contract
    /// @param amount Amount threshold.
    function hasEnoughPositionBalance(address marketContractAddress, uint256 amount)
        internal
        view
        returns (bool)
    {
        IMarketContract marketContract = IMarketContract(marketContractAddress);
        return hasEnoughBalance(marketContract.LONG_POSITION_TOKEN(), amount)
            && hasEnoughBalance(marketContract.SHORT_POSITION_TOKEN(), amount);
    }

    /// @dev Helper to calculate total required collateral for minting.
    /// @param marketContract A IMarketContract interface.
    /// @param qtyToMint Amount to mint.
    /// @return Total collateral required for minting
    function calculateTotalCollateral(IMarketContract marketContract, uint256 qtyToMint)
        internal
        view
        returns (uint256)
    {
        return marketContract.COLLATERAL_PER_UNIT()
            .add(marketContract.COLLATERAL_TOKEN_FEE_PER_UNIT())
            .mul(qtyToMint);
    }

    /// @dev Helper to calculate total required market token for minting.
    /// @param marketContract A IMarketContract interface.
    /// @param qtyToMint Amount to mint.
    /// @return Total market token required for minting
    function calculateMarketTokenFee(IMarketContract marketContract, uint256 qtyToMint)
        internal
        view
        returns (uint256)
    {
        return marketContract.MKT_TOKEN_FEE_PER_UNIT().mul(qtyToMint);
    }

    /// @dev Helper to calculate total required collateral for redeeming.
    /// @param marketContract A IMarketContract interface.
    /// @param qtyToRedeem Amount to redeem.
    /// @return Total collateral required for redeeming
    function calculateCollateralToReturn(IMarketContract marketContract, uint256 qtyToRedeem)
        internal
        view
        returns (uint256)
    {
        return marketContract.COLLATERAL_PER_UNIT().mul(qtyToRedeem);
    }
}