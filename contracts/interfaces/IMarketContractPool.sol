pragma solidity 0.5.2;

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
    function mktToken() external view returns (address);
}