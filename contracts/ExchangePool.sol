pragma solidity ^0.4.24;

import "./lib/SafeMath.sol";
import "./lib/LibOwnable.sol";
import "./lib/LibWhitelist.sol";
import "./lib/MathLib.sol";
import "./interfaces/IMarketContractPool.sol";
import "./interfaces/IMarketContract.sol";
import "./interfaces/IERC20.sol";

contract ExchangePool is LibOwnable, LibWhitelist {
    using SafeMath for uint256;

    uint256 public constant INFINITY = 999999999999999999999999999999999999999999;

    address public marketTokenAddress;

    mapping(address => uint256) public minted;
    mapping(address => uint256) public redeemed;
    mapping(address => uint256) public sent;
    mapping(address => uint256) public received;

    event Mint(address indexed contractAddress, address indexed to, uint256 value);
    event Redeem(address indexed contractAddress, address indexed to, uint256 value);
    event Withdraw(address indexed tokenAddress, address indexed to, uint256 amount);

    constructor(address mktAddress) public {
        marketTokenAddress = mktAddress;
    }

    function withdrawCollateral(
        address marketContractAddress,
        uint256 amount
    )
        public
        onlyOwner
    {
        IMarketContract marketContract = IMarketContract(marketContractAddress);
        IERC20 marketToken = IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS());
        marketToken.transfer(msg.sender, amount);

        emit Withdraw(marketContract.COLLATERAL_TOKEN_ADDRESS(), msg.sender, amount);
    }

    function withdrawMKT(uint256 amount)
        public
        onlyOwner
    {
        IERC20 marketToken = IERC20(marketTokenAddress);
        marketToken.transfer(msg.sender, amount);

        emit Withdraw(marketTokenAddress, msg.sender, amount);
    }

    function approveMarketContractPool(address contractAddress)
        public
        onlyOwner
    {
        IMarketContract marketContract = IMarketContract(contractAddress);

        IERC20 collateralToken = IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS());
        collateralToken.approve(marketContract.COLLATERAL_POOL_ADDRESS(), INFINITY);

        IERC20 marketToken = IERC20(marketTokenAddress);
        marketToken.approve(marketContract.COLLATERAL_POOL_ADDRESS(), INFINITY);
    }

    /**
     * Mint position tokens with collateral within contract for further usage.
     * Called by administrator periodly to adjust the ratio of collateral to position tokens.
     * Not like in mintPositionTokens, payInMKT will force using mkt to pay fee.
     *
     * @param marketContractAddress Address of market contract.
     * @param qtyToMint Quantity of position tokens to mint.
     * @param payInMKT Try to use mkt as mint fee, only when pool has enough mkt tokens.
     */
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

    /**
     * Send asked position Tokens msg.sender. Tokens will be directly transfer to sender when pool
     * has enough position tokens in it, otherwise tokens will be minted from market contract pool.
     * Position tokens are always tranferred in pairs (long == short).
     * isAttemptToPayInMKT is not a promising but an attempt. It works only when the amount of mkt
     * tokens in pool could fully cover the mint fee of position tokens, or the fee would still be
     * paid in collateral token.
     *
     * @param marketContractAddress Address of market contract.
     * @param qtyToMint Quantity of position tokens to mint.
     * @param isAttemptToPayInMKT Try to use mkt as mint fee, only when pool has enough mkt tokens.
     */
    function mintPositionTokens(
        address marketContractAddress,
        uint qtyToMint,
        bool isAttemptToPayInMKT
    )
        external
        onlyAddressInWhitelist
    {
        require(qtyToMint > 0, "INVALID_AMOUNT");

        IMarketContract marketContract = IMarketContract(marketContractAddress);
        IERC20 collateralToken = IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS());
        IERC20 longPositionToken = IERC20(marketContract.LONG_POSITION_TOKEN());
        IERC20 shortPositionToken = IERC20(marketContract.SHORT_POSITION_TOKEN());

        uint256 neededCollateral = MathLib.multiply(
            qtyToMint,
            marketContract.COLLATERAL_PER_UNIT()
        );

        if (longPositionToken.balanceOf(address(this)) < qtyToMint ||
            shortPositionToken.balanceOf(address(this)) < qtyToMint) {
            // mint from mpx
            IERC20 marketToken = IERC20(marketTokenAddress);
            IMarketContractPool marketContractPool = IMarketContractPool(
                marketContract.COLLATERAL_POOL_ADDRESS()
            );

            uint256 neededMakretToken = MathLib.multiply(
                qtyToMint,
                marketContract.MKT_TOKEN_FEE_PER_UNIT()
            );
            if (isAttemptToPayInMKT && marketToken.balanceOf(address(this)) >= neededMakretToken) {
                // pay mkt +qtyToMint -neededCollateral -mkt
                collateralToken.transferFrom(msg.sender, address(this), neededCollateral);
                marketContractPool.mintPositionTokens(marketContractAddress, qtyToMint, true);
            } else {
                uint256 neededCollateralTokenFee = MathLib.multiply(
                    qtyToMint,
                    marketContract.COLLATERAL_TOKEN_FEE_PER_UNIT()
                );
                // pay collateral +qtyToMint -neededCollateral -neededCollateralTokenFee
                collateralToken.transferFrom(
                    msg.sender,
                    address(this),
                    neededCollateral.add(neededCollateralTokenFee)
                );
                marketContractPool.mintPositionTokens(marketContractAddress, qtyToMint, false);
            }
            minted[marketContractAddress] = minted[marketContractAddress].add(qtyToMint);
        } else {
            collateralToken.transferFrom(
                msg.sender,
                address(this),
                neededCollateral
            );
            sent[marketContractAddress] = sent[marketContractAddress].add(qtyToMint);
        }
        longPositionToken.transfer(msg.sender, qtyToMint);
        shortPositionToken.transfer(msg.sender, qtyToMint);

        emit Mint(marketContractAddress, msg.sender, qtyToMint);
    }

    function redeemPositionTokens(
        address marketContractAddress,
        uint qtyToRedeem
    )
        external
        onlyAddressInWhitelist
    {
        require(qtyToRedeem > 0, "INVALID_AMOUNT");

        IMarketContract marketContract = IMarketContract(marketContractAddress);
        IERC20 collateralToken = IERC20(marketContract.COLLATERAL_TOKEN_ADDRESS());
        IERC20 longPositionToken = IERC20(marketContract.LONG_POSITION_TOKEN());
        IERC20 shortPositionToken = IERC20(marketContract.SHORT_POSITION_TOKEN());

        longPositionToken.transferFrom(msg.sender, address(this), qtyToRedeem);
        shortPositionToken.transferFrom(msg.sender, address(this), qtyToRedeem);

        uint256 collateralToReturn = MathLib.multiply(
            qtyToRedeem,
            marketContract.COLLATERAL_PER_UNIT()
        );
        if (collateralToken.balanceOf(address(this)) < collateralToReturn) {
            IMarketContractPool marketContractPool = IMarketContractPool(
                marketContract.COLLATERAL_POOL_ADDRESS()
            );
            marketContractPool.redeemPositionTokens(marketContractAddress, qtyToRedeem);

            redeemed[marketContractAddress] = redeemed[marketContractAddress].add(qtyToRedeem);
        } else {
            received[marketContractAddress] = received[marketContractAddress].add(qtyToRedeem);
        }
        collateralToken.transfer(msg.sender, collateralToReturn);

        emit Redeem(marketContractAddress, msg.sender, qtyToRedeem);
    }
}