pragma solidity ^0.5.2;

interface IMarketContract {
    // constants
    function CONTRACT_NAME()
        external
        view
        returns (string memory);
    function COLLATERAL_TOKEN_ADDRESS()
        external
        view
        returns (address);
    function COLLATERAL_POOL_ADDRESS()
        external
        view
        returns (address);
    function PRICE_CAP()
        external
        view
        returns (uint);
    function PRICE_FLOOR()
        external
        view
        returns (uint);
    function PRICE_DECIMAL_PLACES()
        external
        view
        returns (uint);
    function QTY_MULTIPLIER()
        external
        view
        returns (uint);
    function COLLATERAL_PER_UNIT()
        external
        view
        returns (uint);
    function COLLATERAL_TOKEN_FEE_PER_UNIT()
        external
        view
        returns (uint);
    function MKT_TOKEN_FEE_PER_UNIT()
        external
        view
        returns (uint);
    function EXPIRATION()
        external
        view
        returns (uint);
    function SETTLEMENT_DELAY()
        external
        view
        returns (uint);
    function LONG_POSITION_TOKEN()
        external
        view
        returns (address);
    function SHORT_POSITION_TOKEN()
        external
        view
        returns (address);

    // state variable
    function lastPrice()
        external
        view
        returns (uint);
    function settlementPrice()
        external
        view
        returns (uint);
    function settlementTimeStamp()
        external
        view
        returns (uint);
    function isSettled()
        external
        view
        returns (bool);

    // methods
    function isPostSettlementDelay()
        external
        view
        returns (bool);
}
