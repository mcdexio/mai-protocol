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
pragma experimental ABIEncoderV2; // to enable structure-type parameter

import "../MaiProtocol.sol";

contract TestMaiProtocol is MaiProtocol {

    function setFilled(
        OrderParam memory orderParam,
        OrderAddressSet memory orderAddressSet,
        uint256 amount
    )
        public
    {
        Order memory order = getOrderFromOrderParam(orderParam, orderAddressSet);
        bytes32 orderHash = getOrderHash(order);
        filled[orderHash] = amount;
    }

    function getOrderContextPublic(
        OrderAddressSet memory orderAddressSet,
        OrderParam memory takerOrderParam
    )
        public
        view
        returns (OrderContext memory orderContext)
    {
        return getOrderContext(orderAddressSet, takerOrderParam);
    }

    function validateMarketContractPublic(address marketContractAddress)
        public
        view
    {
        validateMarketContract(marketContractAddress);
    }

    function calculateMiddleCollateralPerUnitPublic(OrderContext memory orderContext)
        public
        view
        returns (uint256)
    {
        return calculateMiddleCollateralPerUnit(orderContext);
    }

    function calculateLongMarginPublic(
        OrderContext memory orderContext,
        OrderParam memory orderParam
    )
        public
        view
        returns (uint256)
    {
        return calculateLongMargin(orderContext, orderParam);
    }

    function calculateShortMarginPublic(
        OrderContext memory orderContext,
        OrderParam memory orderParam
    )
        public
        view
        returns (uint256)
    {
        return calculateShortMargin(orderContext, orderParam);
    }

    function validatePricePublic(
        OrderParam memory takerOrderParam,
        OrderParam memory makerOrderParam
    )
        public
        pure
    {
        validatePrice(takerOrderParam, makerOrderParam);
    }

    function getMatchResultPublic(
        OrderParam memory takerOrderParam,
        OrderInfo memory takerOrderInfo,
        OrderParam memory makerOrderParam,
        OrderInfo memory makerOrderInfo,
        OrderContext memory orderContext,
        uint256 posFilledAmount
    )
        public
        view
        returns (
            MatchResult memory result,
            uint256 filledAmount,
            OrderInfo memory retTakerOrderInfo,
            OrderInfo memory retMakerOrderInfo
        )
    {
        (result, filledAmount) = getMatchResult(
            takerOrderParam,
            takerOrderInfo,
            makerOrderParam,
            makerOrderInfo,
            orderContext,
            posFilledAmount
        );
        return (result, filledAmount, takerOrderInfo, makerOrderInfo);
    }

    function fillMatchResultPublic(
        MatchResult memory result,
        OrderParam memory takerOrderParam,
        OrderInfo memory takerOrderInfo,
        OrderParam memory makerOrderParam,
        OrderInfo memory makerOrderInfo,
        OrderContext memory orderContext,
        uint256 posFilledAmount
    )
        public
        pure
        returns (
            uint256 filledAmount,
            MatchResult memory retResult,
            OrderInfo memory retTakerOrderInfo,
            OrderInfo memory retMakerOrderInfo
        )
    {
        filledAmount = fillMatchResult(
            result, takerOrderParam, takerOrderInfo,
            makerOrderParam, makerOrderInfo,
            orderContext, posFilledAmount
        );
        return (filledAmount, result, takerOrderInfo, makerOrderInfo);
    }

    function getOrderInfoPublic(
        OrderParam memory orderParam,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
        view
        returns (OrderInfo memory orderInfo)
    {
        return getOrderInfo(orderParam, orderAddressSet, orderContext);
    }

    function getOrderFromOrderParamPublic(
        OrderParam memory orderParam,
        OrderAddressSet memory orderAddressSet
    )
        public
        pure
        returns (Order memory order)
    {
        return getOrderFromOrderParam(orderParam, orderAddressSet);
    }

    function settleResultPublic(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
    {
        return settleResult(result, orderAddressSet, orderContext);
    }

    function doSellPublic(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
    {
        doSell(result, orderAddressSet, orderContext);
    }

    function doRedeemPublic(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
    {
        doRedeem(result, orderAddressSet, orderContext);
    }

    function doBuyPublic(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
    {
        doBuy(result, orderAddressSet, orderContext);
    }

    function doMintPublic(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
    {
        doMint(result, orderAddressSet, orderContext);
    }

    function mintPositionTokensPublic(OrderContext memory orderContext, uint256 value)
        public
    {
        mintPositionTokens(orderContext, value);
    }

    function redeemPositionTokensPublic(OrderContext memory orderContext, uint256 value)
        public
    {
        redeemPositionTokens(orderContext, value);
    }
}