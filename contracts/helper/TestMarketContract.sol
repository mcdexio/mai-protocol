pragma solidity ^0.4.24;

import "../lib/SafeMath.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IMintable.sol";

contract TestMarketContract {
    using SafeMath for uint256;

    string public CONTRACT_NAME = "mock";

    uint public PRICE_CAP;
    uint public PRICE_FLOOR;
    uint public PRICE_DECIMAL_PLACES;   // how to convert the pricing from decimal format (if valid) to integer
    uint public QTY_MULTIPLIER;         // multiplier corresponding to the value of 1 increment in price to token base units
    uint public COLLATERAL_PER_UNIT;    // required collateral amount for the full range of outcome tokens
    uint public COLLATERAL_TOKEN_FEE_PER_UNIT;
    uint public MKT_TOKEN_FEE_PER_UNIT;
    uint public EXPIRATION = 30 days;
    uint public SETTLEMENT_DELAY = 1 days;
    uint public lastPrice;
    uint public settlementPrice;
    uint public settlementTimeStamp;
    bool public isSettled = false;

    address public COLLATERAL_TOKEN_ADDRESS;
    address public COLLATERAL_POOL_ADDRESS;
    address public LONG_POSITION_TOKEN;
    address public SHORT_POSITION_TOKEN;
    address public MARKET_TOKEN_ADDRESS;

    event Mint(address indexed to, uint value);
    event Redeem(address indexed to, uint value);

    constructor(
        address collateralToken,
        address longPositionToken,
        address shortPositionToken,
        address marketToken,
        uint cap,
        uint floor,
        uint multiplier,
        uint feeRate
    )
        public
    {
        COLLATERAL_POOL_ADDRESS = address(this);
        COLLATERAL_TOKEN_ADDRESS = collateralToken;
        LONG_POSITION_TOKEN = longPositionToken;
        SHORT_POSITION_TOKEN = shortPositionToken;
        MARKET_TOKEN_ADDRESS = marketToken;

        PRICE_CAP = cap;
        PRICE_FLOOR = floor;
        QTY_MULTIPLIER = multiplier;
        COLLATERAL_PER_UNIT = cap.
            sub(floor).
            mul(multiplier);
        COLLATERAL_TOKEN_FEE_PER_UNIT = cap.
            add(floor).
            div(2).
            mul(multiplier).
            mul(feeRate).
            div(100000);

        MKT_TOKEN_FEE_PER_UNIT = COLLATERAL_TOKEN_FEE_PER_UNIT.
            div(2);
    }

    function isPostSettlementDelay()
        public
        view
        returns (bool)
    {
        return isSettled && (now >= (settlementTimeStamp + SETTLEMENT_DELAY));
    }

    function mintPositionTokens(
        address,
        uint qtyToMint,
        bool isAttemptToPayInMKT
    )
        external
    {
        IERC20 collateral = IERC20(COLLATERAL_TOKEN_ADDRESS);
        uint collateralRequired = COLLATERAL_PER_UNIT.mul(qtyToMint);
        if (isAttemptToPayInMKT) {
            IERC20 mtk = IERC20(MARKET_TOKEN_ADDRESS);
            uint mktFeeRequired = MKT_TOKEN_FEE_PER_UNIT.mul(qtyToMint);

            collateral.transferFrom(
                msg.sender,
                address(this),
                collateralRequired);
            mtk.transferFrom(
                msg.sender,
                address(this),
                mktFeeRequired
            );

        } else {
            uint collateralFeeRequired = COLLATERAL_TOKEN_FEE_PER_UNIT.mul(qtyToMint);
            collateral.transferFrom(
                msg.sender,
                address(this),
                collateralRequired.add(collateralFeeRequired)
            );
        }

        IMintable long = IMintable(LONG_POSITION_TOKEN);
        IMintable short = IMintable(SHORT_POSITION_TOKEN);
        long.mint(msg.sender, qtyToMint);
        short.mint(msg.sender, qtyToMint);
    }

    function redeemPositionTokens(
        address,
        uint qtyToRedeem
    )
        external
    {
        IMintable long = IMintable(LONG_POSITION_TOKEN);
        IMintable short = IMintable(SHORT_POSITION_TOKEN);

        long.burn(msg.sender, qtyToRedeem);
        short.burn(msg.sender, qtyToRedeem);

        IMintable collateral = IMintable(COLLATERAL_TOKEN_ADDRESS);
        uint collateralToReturn = COLLATERAL_PER_UNIT.mul(qtyToRedeem);
        collateral.mint(msg.sender, collateralToReturn);
    }

    function settleAndClose(
        address,
        uint,
        uint
    ) external {
        revert("NOT_IMPLEMENTED");
    }
}