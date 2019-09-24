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
    constructor(address _proxyAddress)
        public
        MaiProtocol(_proxyAddress)
    {
    }

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

    function getMatchPlanPublic(
        OrderParam memory takerOrderParam,
        OrderParam[] memory makerOrderParams,
        uint256[] memory posFilledAmounts,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
        returns (MatchResult[] memory results)
    {
        return getMatchPlan(
            takerOrderParam,
            makerOrderParams,
            posFilledAmounts,
            orderAddressSet,
            orderContext);
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
        OrderParam memory makerOrderParam,
        OrderContext memory orderContext
    )
        public
        view
    {
        validatePrice(takerOrderParam, makerOrderParam, orderContext);
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

    function calculateTotalFeePublic(MatchResult memory result)
        public
        pure
        returns (uint256)
    {
        return calculateTotalFee(result);
    }

    function settleResultsPublic(
        MatchResult[] memory results,
        OrderParam memory takerOrderParam,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
    {
        return settleResults(results, takerOrderParam, orderAddressSet, orderContext);
    }

    function doSellPublic(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
        returns (uint256)
    {
        return doSell(result, orderAddressSet, orderContext);
    }

    function doRedeemPublic(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
        returns (uint256)
    {
        return doRedeem(result, orderAddressSet, orderContext);
    }

    function doBuyPublic(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
        returns (uint256)
    {
        return doBuy(result, orderAddressSet, orderContext);
    }

    function doMintPublic(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        public
        returns (uint256)
    {
        return doMint(result, orderAddressSet, orderContext);
    }

    function transferPublic(address token, address to, uint256 value)
        public
    {
        transfer(token, to, value);
    }

    function transferFromPublic(address token, address from, address to, uint256 value)
        public
    {
        transferFrom(token, from, to, value);
    }

    function mintPositionTokensPublic(address contractAddress, uint256 value)
        public
    {
        mintPositionTokens(contractAddress, value);
    }

    function redeemPositionTokensPublic(address contractAddress, uint256 value)
        public
    {
        redeemPositionTokens(contractAddress, value);
    }
}