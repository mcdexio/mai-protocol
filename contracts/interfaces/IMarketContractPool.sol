pragma solidity ^0.4.24;

contract IMarketContractPool {
    function mintPositionTokens(
        address marketContractAddress,
        uint qtyToMint,
        bool isAttemptToPayInMKT
    ) external;
    function redeemPositionTokens(
        address marketContractAddress,
        uint qtyToRedeem
    ) external;
    function settleAndClose(
        address marketContractAddress,
        uint longQtyToRedeem,
        uint shortQtyToRedeem
    ) external;
    function mktToken() external view returns (address);
}