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

pragma solidity 0.5.2;
pragma experimental ABIEncoderV2; // to enable structure-type parameter

import "./EIP712.sol";
import "./LibSignature.sol";
import "./LibMath.sol";

contract LibOrder is EIP712, LibSignature, LibMath {

    uint256 public constant REBATE_RATE_BASE = 100;

    struct Order {
        address trader;
        address relayer;
        address marketContractAddress;
        uint256 amount;
        uint256 price;
        uint256 gasTokenAmount;

        /**
         * Data contains the following values packed into 32 bytes
         * ╔════════════════════╤═══════════════════════════════════════════════════════════╗
         * ║                    │ length(bytes)   desc                                      ║
         * ╟────────────────────┼───────────────────────────────────────────────────────────╢
         * ║ version            │ 1               order version                             ║
         * ║ side               │ 1               0: buy (long), 1: sell (short)            ║
         * ║ isMarketOrder      │ 1               0: limitOrder, 1: marketOrder             ║
         * ║ expiredAt          │ 5               order expiration time in seconds          ║
         * ║ asMakerFeeRate     │ 2               maker fee rate (base 100,000)             ║
         * ║ asTakerFeeRate     │ 2               taker fee rate (base 100,000)             ║
         * ║ makerRebateRate    │ 2               rebate rate for maker (base 100)          ║
         * ║ salt               │ 8               salt                                      ║
         * ║ isMakerOnly        │ 1               is maker only                             ║
         * ║                    │ 9               reserved                                  ║
         * ╚════════════════════╧═══════════════════════════════════════════════════════════╝
         */
        bytes32 data;
    }

    enum OrderStatus {
        EXPIRED,
        CANCELLED,
        FILLABLE,
        FULLY_FILLED
    }

    enum FillAction {
        INVALID,
        BUY,
        SELL,
        MINT,
        REDEEM
    }

    /* Hash of EIP712_ORDER_TYPE
     *   0xcb2a59222442273286b1c23ca81a51fa5a00f847bd229bc464a68250c2bb7905 ==
     *   abi.encodePacked("Order(address trader,address relayer,address marketContractAddress,uint256 amount,uint256 price,uint256 gasTokenAmount,bytes32 data)")
     */
    bytes32 public constant EIP712_ORDER_TYPE = 0xcb2a59222442273286b1c23ca81a51fa5a00f847bd229bc464a68250c2bb7905;

    /**
     * Calculates the Keccak-256 EIP712 hash of the order using the Mai Protocol domain.
     *
     * @param order The order data struct.
     * @return Fully qualified EIP712 hash of the order in the Mai Protocol domain.
     */
    function getOrderHash(Order memory order) internal pure returns (bytes32 orderHash) {
        orderHash = hashEIP712Message(hashOrder(order));
    }

    /**
     * Calculates the EIP712 hash of the order.
     *
     * @param order The order data struct.
     * @return Hash of the order.
     */
    function hashOrder(Order memory order) internal pure returns (bytes32 result) {
        /**
         * Calculate the following hash in solidity assembly to save gas.
         *
         * keccak256(
         *     abi.encodePacked(
         *         EIP712_ORDER_TYPE,
         *         bytes32(order.trader),
         *         bytes32(order.relayer),
         *         bytes32(order.marketContractAddress),
         *         order.amount,
         *         order.price,
         *         order.gasTokenAmount,
         *         order.data
         *     )
         * );
         */
        bytes32 orderType = EIP712_ORDER_TYPE;

        assembly {
            let start := sub(order, 32)
            let tmp := mload(start)

            // 256 = (1 + 7) * 32
            //
            // [0...32)   bytes: EIP712_ORDER_TYPE
            // [32...256) bytes: order
            mstore(start, orderType)
            result := keccak256(start, 256)

            mstore(start, tmp)
        }

        return result;
    }

    /* Functions to extract info from data bytes in Order struct */

    function getOrderVersion(bytes32 data) internal pure returns (uint256) {
        return uint256(uint8(byte(data)));
    }

    function getExpiredAtFromOrderData(bytes32 data) internal pure returns (uint256) {
        return uint256(uint40(bytes5(data << (8*3))));
    }

    function isSell(bytes32 data) internal pure returns (bool) {
        return uint8(data[1]) == 1;
    }

    function isMarketOrder(bytes32 data) internal pure returns (bool) {
        return uint8(data[2]) == 1;
    }

    function isMakerOnly(bytes32 data) internal pure returns (bool) {
        return uint8(data[22]) == 1;
    }

    function isMarketBuy(bytes32 data) internal pure returns (bool) {
        return !isSell(data) && isMarketOrder(data);
    }

    function getAsMakerFeeRateFromOrderData(bytes32 data) internal pure returns (uint256) {
        return uint256(uint16(bytes2(data << (8*8))));
    }

    function getAsTakerFeeRateFromOrderData(bytes32 data) internal pure returns (uint256) {
        return uint256(uint16(bytes2(data << (8*10))));
    }

    function getMakerRebateRateFromOrderData(bytes32 data) internal pure returns (uint256) {
        uint256 makerRebate = uint256(uint16(bytes2(data << (8*12))));

        // make sure makerRebate will never be larger than REBATE_RATE_BASE, which is 100
        return min(makerRebate, REBATE_RATE_BASE);
    }
}
