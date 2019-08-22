pragma solidity ^0.4.24;

interface IMarketContract {
    // constants
    function CONTRACT_NAME()
        public
        view
        returns (string memory);
    function COLLATERAL_TOKEN_ADDRESS()
        public
        view
        returns (address);
    function COLLATERAL_POOL_ADDRESS()
        public
        view
        returns (address);
    function PRICE_CAP()
        public
        view
        returns (uint);
    function PRICE_FLOOR()
        public
        view
        returns (uint);
    function PRICE_DECIMAL_PLACES()
        public
        view
        returns (uint);
    function QTY_MULTIPLIER()
        public
        view
        returns (uint);
    function COLLATERAL_PER_UNIT()
        public
        view
        returns (uint);
    function COLLATERAL_TOKEN_FEE_PER_UNIT()
        public
        view
        returns (uint);
    function MKT_TOKEN_FEE_PER_UNIT()
        public
        view
        returns (uint);
    function EXPIRATION()
        public
        view
        returns (uint);
    function SETTLEMENT_DELAY()
        public
        view
        returns (uint);
    function LONG_POSITION_TOKEN()
        public
        view
        returns (address);
    function SHORT_POSITION_TOKEN()
        public
        view
        returns (address);

    // state variable
    function lastPrice()
        public
        view
        returns (uint);
    function settlementPrice()
        public
        view
        returns (uint); 
    function settlementTimeStamp()
        public
        view
        returns (uint);
    function isSettled()
        public
        view
        returns (bool); 

    // methods
    function isPostSettlementDelay()
        public
        view
        returns (bool);
}
