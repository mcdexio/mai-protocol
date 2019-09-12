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

pragma solidity ^0.4.24;
pragma experimental ABIEncoderV2;


import "./lib/SafeMath.sol";
import "./lib/LibOrder.sol";
import "./lib/LibOwnable.sol";
import "./lib/LibMath.sol";
import "./lib/LibSignature.sol";
import "./lib/LibRelayer.sol";
import "./lib/LibExchangeErrors.sol";
import "./interfaces/IMarketContractPool.sol";
import "./interfaces/IMarketContract.sol";
import "./interfaces/IMarketContractRegistry.sol";
import "./interfaces/IERC20.sol";
import "./lib/MathLib.sol";

contract MaiProtocol is LibMath, LibOrder, LibRelayer, LibExchangeErrors, LibOwnable {
    using SafeMath for uint256;

    uint256 public constant LONG = 0;
    uint256 public constant SHORT = 1;
    uint256 public constant FEE_RATE_BASE = 100000;

    /* Supported version */
    uint256 public constant SUPPORTED_ORDER_VERSION = 2;

    /**
     * Address of the proxy responsible for asset transfer.
     */
    address public proxyAddress;

    /**
     * Address of the market contract registry for whitelist check;
     */
    address public marketRegistryAddress;

    /**
     * Mapping of orderHash => amount
     * Generally the amount will be specified in base token units, however in the case of a market
     * buy order the amount is specified in quote token units.
     */
    mapping (bytes32 => uint256) public filled;
    /**
     * Mapping of orderHash => whether order has been cancelled.
     */
    mapping (bytes32 => bool) public cancelled;

    event Cancel(bytes32 indexed orderHash);

    /**
     * When orders are being matched, they will always contain the exact same base token,
     * quote token, and relayer. Since excessive call data is very expensive, we choose
     * to create a stripped down OrderParam struct containing only data that may vary between
     * Order objects, and separate out the common elements into a set of addresses that will
     * be shared among all of the OrderParam items. This is meant to eliminate redundancy in
     * the call data, reducing it's size, and hence saving gas.
     */
    struct OrderParam {
        address trader;
        uint256 amount;
        uint256 price;
        uint256 gasAmount;
        bytes32 data;
        OrderSignature signature;
    }

    /**
     * Calculated data about an order object.
     * Generally the filledAmount is specified in base token units, however in the case of a market
     * buy order the filledAmount is specified in quote token units.
     */
    struct OrderInfo {
        bytes32 orderHash;
        uint256 filledAmount;

        // [0] = long position token, [1] = short position token
        uint256[2] margins;
        uint256[2] balances;
    }

    struct OrderAddressSet {
        address marketContract;
        address relayer;
    }

    struct OrderContext {
        IMarketContract marketContract;         // market contract
        IMarketContractPool marketContractPool; // market contract pool
        IERC20 ctk;                             // collateral token
        IERC20[2] pos;                          // [0] = long position token
                                                // [1] = short position token
        uint256 takerSide;                      // 0 = buy, 1 = short
    }

    struct MatchResult {
        address maker;
        address taker;
        uint256 makerFee;                   // makerFee in order data
        uint256 takerFee;                   // takerFee in order data
        uint256 makerGasFee;
        uint256 takerGasFee;
        uint256 posFilledAmount;            // position token is always the same between maker and taker
        uint256 ctkFilledAmount;            // how much ctk that maker should pay/get
        FillAction fillAction;
    }

    event Match(
        OrderAddressSet addressSet,
        MatchResult result
    );

    constructor(address _proxyAddress) public {
        proxyAddress = _proxyAddress;
    }

    function setMarketRegistryAddress(address _marketRegistryAddress)
        external
        onlyOwner
    {
        marketRegistryAddress = _marketRegistryAddress;
    }

    function getOrderContext(
        OrderAddressSet memory orderAddressSet,
        OrderParam memory takerOrderParam
    )
        internal
        view
        returns (OrderContext memory orderContext)
    {
        orderContext.marketContract = IMarketContract(orderAddressSet.marketContract);

        require (
            // solium-disable-next-line security/no-block-members
            block.timestamp < orderContext.marketContract.EXPIRATION(),
            MP_EXPIRED
        );
        orderContext.marketContractPool = IMarketContractPool(
            orderContext.marketContract.COLLATERAL_POOL_ADDRESS()
        );
        orderContext.ctk = IERC20(orderContext.marketContract.COLLATERAL_TOKEN_ADDRESS());
        orderContext.pos[LONG] = IERC20(orderContext.marketContract.LONG_POSITION_TOKEN());
        orderContext.pos[SHORT] = IERC20(orderContext.marketContract.SHORT_POSITION_TOKEN());
        orderContext.takerSide = isSell(takerOrderParam.data) ? SHORT : LONG;

        return orderContext;
    }

    function getMatchPlan(
        OrderParam memory takerOrderParam,
        OrderParam[] memory makerOrderParams,
        uint256[] memory posFilledAmounts,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
        returns (MatchResult[] memory results)
    {
        uint256 takerFeeRate = getTakerFeeRate(takerOrderParam);
        OrderInfo memory takerOrderInfo = getOrderInfo(
            takerOrderParam,
            orderAddressSet,
            orderContext
        );

        uint256 resultIndex;
        // Each matched pair will produce two results at most (exchange + mint, exchange + redeem).
        results = new MatchResult[](makerOrderParams.length * 2);
        for (uint256 i = 0; i < makerOrderParams.length; i++) {
            require(
                !isMarketOrder(makerOrderParams[i].data),
                MAKER_ORDER_CAN_NOT_BE_MARKET_ORDER
            );
            require(
                isSell(takerOrderParam.data) != isSell(makerOrderParams[i].data),
                INVALID_SIDE
            );
            validatePrice(takerOrderParam, makerOrderParams[i]);

            OrderInfo memory makerOrderInfo = getOrderInfo(
                makerOrderParams[i],
                orderAddressSet,
                orderContext
            );
            uint256 toFillAmount = posFilledAmounts[i];
            while (toFillAmount > 0) {
                MatchResult memory result;
                uint256 filledAmount;
                (result, filledAmount) = getMatchResult(
                    takerOrderParam,
                    takerOrderInfo,
                    makerOrderParams[i],
                    makerOrderInfo,
                    orderContext,
                    toFillAmount,
                    takerFeeRate
                );
                toFillAmount = toFillAmount.sub(filledAmount);
                results[resultIndex] = result;
                resultIndex++;
            }
            filled[makerOrderInfo.orderHash] = makerOrderInfo.filledAmount;
        }
        filled[takerOrderInfo.orderHash] = takerOrderInfo.filledAmount;

        return results;
    }

    function matchOrders(
        OrderParam memory takerOrderParam,
        OrderParam[] memory makerOrderParams,
        uint256[] memory posFilledAmounts,
        OrderAddressSet memory orderAddressSet
    )
        public
    {
        require(canMatchOrdersFrom(orderAddressSet.relayer), INVALID_SENDER);
        require(!isMakerOnly(takerOrderParam.data), MAKER_ONLY_ORDER_CANNOT_BE_TAKER);

        validateMarketContract(orderAddressSet.marketContract);

        OrderContext memory orderContext = getOrderContext(orderAddressSet, takerOrderParam);
        MatchResult[] memory results = getMatchPlan(
            takerOrderParam,
            makerOrderParams,
            posFilledAmounts,
            orderAddressSet,
            orderContext
        );
        settleResults(results, takerOrderParam, orderAddressSet, orderContext);
    }

    function validateMarketContract(address marketContractAddress) internal view {
        if (registry == address(0x0)) {
            return;
        }
        IMarketContractRegistry registry = IMarketContractRegistry(marketRegistryAddress);
        require(
            registry.isAddressWhiteListed(registry),
            INVALID_MARKET_CONTRACT
        );
    }

    function calculateMiddleCollateralPerUnit(OrderContext memory orderContext)
        internal
        view
        returns (uint256)
    {
        return orderContext.marketContract.PRICE_CAP()
            .add(orderContext.marketContract.PRICE_FLOOR())
            .mul(orderContext.marketContract.QTY_MULTIPLIER())
            .div(2);
    }

    function calculateLongMargin(OrderContext memory orderContext, OrderParam memory orderParam)
        internal
        view
        returns (uint256)
    {
        return orderParam.price
            .sub(orderContext.marketContract.PRICE_FLOOR())
            .mul(orderContext.marketContract.QTY_MULTIPLIER());
    }

    function calculateShortMargin(OrderContext memory orderContext, OrderParam memory orderParam)
        internal
        view
        returns (uint256)
    {
        return orderContext.marketContract.PRICE_CAP()
            .sub(orderParam.price)
            .mul(orderContext.marketContract.QTY_MULTIPLIER());
    }

    function validatePrice(OrderParam memory takerOrderParam, OrderParam memory makerOrderParam)
        internal
        pure
    {
        if (isSell(takerOrderParam.data)) {
            require(takerOrderParam.price <= makerOrderParam.price, INVALID_MATCH);
        } else {
            require(takerOrderParam.price >= makerOrderParam.price, INVALID_MATCH);
        }
    }

    function validateMatchPrice(
        MatchResult memory result,
        OrderInfo memory takerOrderInfo,
        OrderInfo memory makerOrderInfo,
        OrderContext memory orderContext
    )
        internal
        view
    {
        if (result.fillAction == FillAction.REDEEM || result.fillAction == FillAction.MINT) {
            uint256 side = orderContext.takerSide;
            uint256 opposite = oppositeSide(side);
            uint256 left;
            uint256 right;
            uint256 required;
            if (result.fillAction == FillAction.REDEEM) {
                left = takerOrderInfo.margins[opposite];
                right = makerOrderInfo.margins[side];
                required = orderContext.marketContract.COLLATERAL_PER_UNIT();

                require(left.add(right) <= required, REDEEM_PRICE_NOT_MET);

            } else if (result.fillAction == FillAction.MINT) {

                left = takerOrderInfo.margins[side].mul(result.posFilledAmount);
                right = makerOrderInfo.margins[opposite].mul(result.posFilledAmount);
                uint256 extra = result.makerFee.add(result.takerFee);
                required = orderContext.marketContract.COLLATERAL_PER_UNIT()
                    .add(orderContext.marketContract.COLLATERAL_TOKEN_FEE_PER_UNIT())
                    .mul(result.posFilledAmount);

                require(left.add(right).add(extra) >= required, MINT_PRICE_NOT_MET);
            }
        }
    }

    function getMatchResult(
        OrderParam memory takerOrderParam,
        OrderInfo memory takerOrderInfo,
        OrderParam memory makerOrderParam,
        OrderInfo memory makerOrderInfo,
        OrderContext memory orderContext,
        uint256 posFilledAmount,
        uint256 takerFeeRate
    )
        internal
        view
        returns (MatchResult memory result, uint256 filledAmount)
    {
        require(makerOrderInfo.filledAmount <= makerOrderParam.amount, MAKER_ORDER_OVER_MATCH);
        require(takerOrderInfo.filledAmount <= takerOrderParam.amount, TAKER_ORDER_OVER_MATCH);

        // Each order only pays gas once, so only pay gas when nothing has been filled yet.
        if (takerOrderInfo.filledAmount == 0) {
            result.takerGasFee = takerOrderParam.gasAmount;
        }
        if (makerOrderInfo.filledAmount == 0) {
            result.makerGasFee = makerOrderParam.gasAmount;
        }

        // calculate posFilledAmount && ctkFilledAmount, update balances
        filledAmount = fillMatchResult(
            result,
            takerOrderParam,
            takerOrderInfo,
            makerOrderParam,
            makerOrderInfo,
            orderContext,
            posFilledAmount
        );
        result.posFilledAmount = filledAmount;

        // calculate fee
        uint256 makerRawFeeRate = getAsMakerFeeRateFromOrderData(makerOrderParam.data);
        uint256 middleCollateralPerUnit = calculateMiddleCollateralPerUnit(orderContext);
        result.makerFee = result.posFilledAmount.
            mul(middleCollateralPerUnit).
            mul(makerRawFeeRate).
            div(FEE_RATE_BASE);
        result.takerFee = result.posFilledAmount.
            mul(middleCollateralPerUnit).
            mul(takerFeeRate).
            div(FEE_RATE_BASE);

        validateMatchPrice(
            result,
            takerOrderInfo,
            makerOrderInfo,
            orderContext
        );

        result.taker = takerOrderParam.trader;
        result.maker = makerOrderParam.trader;

        return (result, filledAmount);
    }

    function fillMatchResult(
        MatchResult memory result,
        OrderParam memory takerOrderParam,
        OrderInfo memory takerOrderInfo,
        OrderParam memory makerOrderParam,
        OrderInfo memory makerOrderInfo,
        OrderContext memory orderContext,
        uint256 posFilledAmount
    )
        internal
        pure
        returns (uint256 filledAmount)
    {
        uint256 side = orderContext.takerSide;
        uint256 opposite = oppositeSide(side);

        if (takerOrderInfo.balances[opposite] > 0 && makerOrderInfo.balances[side] > 0) {
            // do redeem
            filledAmount = min(
                min(takerOrderInfo.balances[opposite], posFilledAmount),
                makerOrderInfo.balances[side]
            );
            // update balances
            takerOrderInfo.balances[opposite] = takerOrderInfo.balances[opposite]
                .sub(filledAmount);
            makerOrderInfo.balances[side] = makerOrderInfo.balances[side].sub(filledAmount);

            result.fillAction = FillAction.REDEEM;
            result.ctkFilledAmount = makerOrderInfo.margins[side].mul(filledAmount);

       } else if (takerOrderInfo.balances[opposite] > 0 && makerOrderInfo.balances[side] == 0) {
            // do exchange, taker sell to maker
            filledAmount = min(takerOrderInfo.balances[opposite], posFilledAmount);
            takerOrderInfo.balances[opposite] = takerOrderInfo.balances[opposite]
                .sub(filledAmount);
            makerOrderInfo.balances[opposite] = makerOrderInfo.balances[opposite]
                .add(filledAmount);

            result.fillAction = FillAction.SELL;
            result.ctkFilledAmount = makerOrderInfo.margins[opposite].mul(filledAmount);

       } else if (takerOrderInfo.balances[opposite] == 0 && makerOrderInfo.balances[side] > 0) {
            // do exchange, taker buy from maker
            filledAmount = min(makerOrderInfo.balances[side], posFilledAmount);
            takerOrderInfo.balances[side] = takerOrderInfo.balances[side].add(filledAmount);
            makerOrderInfo.balances[side] = makerOrderInfo.balances[side].sub(filledAmount);

            result.fillAction = FillAction.BUY;
            result.ctkFilledAmount = makerOrderInfo.margins[side].mul(filledAmount);

       } else if (takerOrderInfo.balances[opposite] == 0 && makerOrderInfo.balances[side] == 0) {
            // do mint
            filledAmount = posFilledAmount;
            // update balances
            takerOrderInfo.balances[side] = takerOrderInfo.balances[side].add(filledAmount);
            makerOrderInfo.balances[opposite] = makerOrderInfo.balances[opposite].add(filledAmount);

            result.fillAction = FillAction.MINT;
            result.ctkFilledAmount = makerOrderInfo.margins[opposite].mul(filledAmount);

        } else {
           revert(UNEXPECTED_MATCH);
        }

        // update filledAmount
        takerOrderInfo.filledAmount = takerOrderInfo.filledAmount.add(filledAmount);
        makerOrderInfo.filledAmount = makerOrderInfo.filledAmount.add(filledAmount);

        require(takerOrderInfo.filledAmount <= takerOrderParam.amount, TAKER_ORDER_OVER_MATCH);
        require(makerOrderInfo.filledAmount <= makerOrderParam.amount, MAKER_ORDER_OVER_MATCH);

        result.posFilledAmount = filledAmount;

        return filledAmount;
    }

    /**
     * Cancels an order, preventing it from being matched. In practice, matching mode relayers will
     * generally handle cancellation off chain by removing the order from their system, however if
     * the trader wants to ensure the order never goes through, or they no longer trust the relayer,
     * this function may be called to block it from ever matching at the contract level.
     *
     * Emits a Cancel event on success.
     *
     * @param order The order to be cancelled.
     */
    function cancelOrder(Order memory order) public {
        require(order.trader == msg.sender, INVALID_TRADER);

        bytes32 orderHash = getOrderHash(order);
        cancelled[orderHash] = true;

        emit Cancel(orderHash);
    }

    /**
     * Calculates current state of the order. Will revert transaction if this order is not
     * fillable for any reason, or if the order signature is invalid.
     *
     * @param orderParam The OrderParam object containing Order data.
     * @param orderAddressSet An object containing addresses common across each order.
     * @return An OrderInfo object containing the hash and current amount filled
     */
    function getOrderInfo(
        OrderParam memory orderParam,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
        view
        returns (OrderInfo memory orderInfo)
    {
        require(
            getOrderVersion(orderParam.data) == SUPPORTED_ORDER_VERSION,
            ORDER_VERSION_NOT_SUPPORTED
        );

        Order memory order = getOrderFromOrderParam(orderParam, orderAddressSet);
        orderInfo.orderHash = getOrderHash(order);
        orderInfo.filledAmount = filled[orderInfo.orderHash];
        uint8 status = uint8(OrderStatus.FILLABLE);

        // TODO: isMarketBuy(order.data) is not implemented

        if (orderInfo.filledAmount >= order.amount) {
            status = uint8(OrderStatus.FULLY_FILLED);
        } else if (block.timestamp >= getExpiredAtFromOrderData(order.data)) {
            status = uint8(OrderStatus.EXPIRED);
        } else if (cancelled[orderInfo.orderHash]) {
            status = uint8(OrderStatus.CANCELLED);
        }

        require(status == uint8(OrderStatus.FILLABLE), ORDER_IS_NOT_FILLABLE);
        require(
            isValidSignature(orderInfo.orderHash, orderParam.trader, orderParam.signature),
            INVALID_ORDER_SIGNATURE
        );

        orderInfo.margins[0] = calculateLongMargin(orderContext, orderParam);
        orderInfo.margins[1] = calculateShortMargin(orderContext, orderParam);
        orderInfo.balances[0] = orderContext.pos[0].balanceOf(orderParam.trader);
        orderInfo.balances[1] = orderContext.pos[1].balanceOf(orderParam.trader);

        return orderInfo;
    }

    /**
     * Reconstruct an Order object from the given OrderParam and OrderAddressSet objects.
     *
     * @param orderParam The OrderParam object containing the Order data.
     * @param orderAddressSet An object containing addresses common across each order.
     * @return The reconstructed Order object.
     */
    function getOrderFromOrderParam(
        OrderParam memory orderParam,
        OrderAddressSet memory orderAddressSet
    )
        internal
        pure
        returns (Order memory order)
    {
        order.trader = orderParam.trader;
        order.relayer = orderAddressSet.relayer;
        order.marketContract = orderAddressSet.marketContract;
        order.amount = orderParam.amount;
        order.price = orderParam.price;
        order.gasAmount = orderParam.gasAmount;
        order.data = orderParam.data;
    }

    /**
     * Get the rate used to calculate the taker fee.
     *
     * @param orderParam The OrderParam object representing the taker order data.
     * @return The final potentially discounted rate to use for the taker fee.
     */
    function getTakerFeeRate(OrderParam memory orderParam)
        internal
        pure
        returns(uint256)
    {
        return getAsTakerFeeRateFromOrderData(orderParam.data);
    }


    function calculateTotalFee(MatchResult memory result)
        internal
        pure
        returns (uint256)
    {
        return result.takerFee
            .add(result.takerGasFee)
            .add(result.makerFee)
            .add(result.makerGasFee);
    }

    /**
     * Take a list of matches and settle them with the taker order, transferring tokens all tokens
     * and paying all fees necessary to complete the transaction.
     *
     * @param results List of MatchResult objects representing each individual trade to settle.
     * @param takerOrderParam The OrderParam object representing the taker order data.
     * @param orderAddressSet An object containing addresses common across each order.
     * @param orderContext An object containing order related information.
     */
    function settleResults(
        MatchResult[] memory results,
        OrderParam memory takerOrderParam,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
    {
        uint256 ctkFromProxyToTaker;
        uint256 ctkFromProxyToRelayer;
        uint256 ctkFromRelayerToTaker;
        uint256 ctkFromTakerToRelayer;

        for (uint256 i = 0; i < results.length; i++) {
            if (results[i].fillAction == FillAction.REDEEM) {
                /**
                 *  ============= doRedeem =============
                 *  - taker   ->    proxy   : pos
                 *  - maker   ->    proxy   : pos-opposite
                 *  - proxy   ->    mpx     : redeem
                 *  - proxy   ->    maker   : ctk - makerFee
                 *  ====================================
                 *  - proxy   ->    taker   : ctk - makerFee
                 *  - proxy   ->    relayer : ctk + makerFee + takerFee
                 */
                ctkFromProxyToTaker = ctkFromProxyToTaker
                    .add(doRedeem(results[i], orderAddressSet, orderContext));
                ctkFromProxyToRelayer = ctkFromProxyToRelayer
                    .add(calculateTotalFee(results[i]));
            } else if (results[i].fillAction == FillAction.SELL) {
                /**
                 *  ============== doSell ==============
                 *  - taker   ->    maker   : pos
                 *  - maker   ->    relayer : ctk + makerFee
                 *  ====================================
                 *  - relayer ->    taker   : ctk - takerFee
                 */
                ctkFromRelayerToTaker = ctkFromRelayerToTaker
                    .add(doSell(results[i], orderAddressSet, orderContext));
            } else if (results[i].fillAction == FillAction.BUY) {
                /**
                 *  ============== doBuy ==============
                 *  - maker   ->    taker   : pos
                 *  - taker   ->    maker   : ctk - makerFee - takerFee
                 *  ====================================
                 *  - taker   ->    relayer : ctk + makerFee + takerFee
                 */
                ctkFromTakerToRelayer = ctkFromTakerToRelayer
                    .add(doBuy(results[i], orderAddressSet, orderContext));
            } else if (results[i].fillAction == FillAction.MINT) {
                /**
                 *  ============== doMint ==============
                 *  - taker   ->    proxy   : ctk + takerFee
                 *  - maker   ->    proxy   : ctk + makerFee
                 *  - proxy   ->    mpx     : mint
                 *  - proxy   ->    maker   : pos
                 *  - proxy   ->    taker   : pos-opposite
                 *  ====================================
                 *  - proxy   ->    relayer : makerFee + takerFee - mintFee
                 */
                ctkFromProxyToRelayer = ctkFromProxyToRelayer
                    .add(doMint(results[i], orderAddressSet, orderContext));
            }
            emit Match(orderAddressSet, results[i]);
        }

        if (ctkFromProxyToTaker > 0) {
            transfer(
                orderContext.ctk,
                takerOrderParam.trader,
                ctkFromProxyToTaker
            );
        }
        if (ctkFromProxyToRelayer > 0) {
            transfer(
                orderContext.ctk,
                orderAddressSet.relayer,
                ctkFromProxyToRelayer
            );
        }
        if (ctkFromRelayerToTaker > ctkFromTakerToRelayer) {
            transferFrom(
                orderContext.ctk,
                orderAddressSet.relayer,
                takerOrderParam.trader,
                ctkFromRelayerToTaker.sub(ctkFromTakerToRelayer)
            );
        } else if (ctkFromRelayerToTaker < ctkFromTakerToRelayer) {
            transferFrom(
                orderContext.ctk,
                takerOrderParam.trader,
                orderAddressSet.relayer,
                ctkFromTakerToRelayer.sub(ctkFromRelayerToTaker)
            );
        }
    }

    function doSell(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
        returns (uint256)
    {
        // taker -> maker
        transferFrom(
            orderContext.pos[oppositeSide(orderContext.takerSide)],
            result.taker,
            result.maker,
            result.posFilledAmount
        );
        // maker -> relayer
        transferFrom(
            orderContext.ctk,
            result.maker,
            orderAddressSet.relayer,
            result.ctkFilledAmount.
                add(result.makerFee).
                add(result.makerGasFee)
        );
        // relayer to taker
        return result.ctkFilledAmount
            .sub(result.takerFee)
            .sub(result.takerGasFee);
    }

    function oppositeSide(uint256 side) internal pure returns (uint256) {
        return side == LONG ? SHORT : LONG;
    }

    /**
     * Redeem position tokens which is specified by market protocol contract. Exchange collects
     * long and short tokens from both taker and makers, then calls mint method of market protocol
     * contract pool. The amount of tokens collected from maker and taker must be equal.
     *
     *  for FillAction.MINT
     *
     *   taker -- takerPosToken --> maker
     *   maker -- makerPositionToken --> relayer
     *   proxy -- quoteToken - takerFee - takerGasFee - makerFee - makerGasFee --> taker
     *
     *   taker get: ctkFilledAmount  (-takerFee -takerGasFee)
     *   maker get: ctkFilledAmount  (-makerFee -makerGasFee)
     *   proxy get: makerFee + makerGasFee + takerFee + takerGasFee - mintFee
     *
     * @param result A MatchResult object representing an individual trade to settle.
     * @param orderAddressSet An object containing addresses common across each order.
     * @param orderContext An object containing order related information.
     */
    function doRedeem(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
        returns (uint256)
    {
        // taker -> proxy
        transferFrom(
            orderContext.pos[oppositeSide(orderContext.takerSide)],
            result.taker,
            proxyAddress,
            result.posFilledAmount
        );
        // maker -> proxy
        transferFrom(
            orderContext.pos[orderContext.takerSide],
            result.maker,
            proxyAddress,
            result.posFilledAmount
        );
        // proxy -> mpx
        redeemPositionTokens(orderAddressSet.marketContract, result.posFilledAmount);
        // proxy -> maker
        transfer(
            orderContext.ctk,
            result.maker,
            result.ctkFilledAmount.
                sub(result.makerFee).
                sub(result.makerGasFee)
        );
        uint256 collateralToReturn = MathLib.multiply(
            result.posFilledAmount,
            orderContext.marketContract.COLLATERAL_PER_UNIT());
        // proxy -> taker
        return collateralToReturn
            .sub(result.ctkFilledAmount)
            .sub(result.takerFee)
            .sub(result.takerGasFee);
    }

    /**
     * doBuy: taker buy position token from maker.
     *         taker -> maker: position
     *         maker -> taker: collateral
     *         taker -> relayer: fee
     */
    function doBuy(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
        returns (uint256)
    {
        // maker -> taker
        transferFrom(
            orderContext.pos[orderContext.takerSide],
            result.maker,
            result.taker,
            result.posFilledAmount
        );
        // taker -> maker
        transferFrom(
            orderContext.ctk,
            result.taker,
            result.maker,
            result.ctkFilledAmount
                .sub(result.makerFee)
                .sub(result.makerGasFee)
        );
        // taker -> relayer
        return result.takerFee
            .add(result.takerGasFee)
            .add(result.makerFee)
            .add(result.makerGasFee);
    }

    /**
     * Mint position tokens which is specified by market protocol contract. Exchange collects
     * collaterals from both taker and makers, then calls mint method of market protocol contract
     * pool.
     *
     *  for FillAction.MINT
     *
     *   maker      -- ctkFilledAmount + makerFee + makerGasFee   --> proxy
     *   taker      -- ctkFilledAmount + takerFee + takerGasFee   --> proxy
     *   proxy      -- posFilledAmount                             --> maker
     *   proxy      -- posFilledAmount                             --> taker
     *
     *   taker get:     ctkFilledAmount  (-takerFee -takerGasFee)
     *   maker get:     posFilledAmount   (-makerFee -makerGasFee)
     *   relayer get:   makerFee + makerGasFee + takerFee + takerGasFee
     *
     * @param result MatchResult object representing an individual trade to settle.
     * @param orderAddressSet An object containing addresses common across each order.
     * @param orderContext An object containing order related information.
     */
    function doMint(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
        returns (uint256)
    {
        // posFilledAmount
        uint256 neededCollateral = MathLib.multiply(
            result.posFilledAmount,
            orderContext.marketContract.COLLATERAL_PER_UNIT()
        );
        uint256 neededCollateralTokenFee = MathLib.multiply(
            result.posFilledAmount,
            orderContext.marketContract.COLLATERAL_TOKEN_FEE_PER_UNIT()
        );
        uint256 totalFee = result.makerFee.add(result.takerFee);

        // fail on a very low fee, if any
        require(totalFee >= neededCollateralTokenFee, INSUFFICIENT_FEE);

        // maker -> proxy
        transferFrom(
            orderContext.ctk,
            result.maker,
            proxyAddress,
            result.ctkFilledAmount.
                add(result.makerFee).
                add(result.makerGasFee)
        );
        // taker -> proxy
        transferFrom(
            orderContext.ctk,
            result.taker,
            proxyAddress,
            neededCollateral.
                sub(result.ctkFilledAmount).
                add(result.takerFee).
                add(result.takerGasFee)
        );
        // proxy <- long/short position tokens
        mintPositionTokens(orderAddressSet.marketContract, result.posFilledAmount);
        // proxy -> taker
        transfer(
            orderContext.pos[orderContext.takerSide],
            result.taker,
            result.posFilledAmount
        );
        // proxy -> maker
        transfer(
            orderContext.pos[oppositeSide(orderContext.takerSide)],
            result.maker,
            result.posFilledAmount
        );

        // proxy -> taker
        return totalFee.
            add(result.takerGasFee).
            add(result.makerGasFee).
            sub(neededCollateralTokenFee);
    }

    /**
     * A helper function to call the transfer function in Proxy.sol with solidity assembly.
     * Copying the data in order to make an external call can be expensive, but performing the
     * operations in assembly seems to reduce gas cost.
     *
     * The function will revert the transaction if the transfer fails.
     *
     * @param token The address of the ERC20 token we will be transferring, 0 for ETH.
     * @param to The address we will be transferring to.
     * @param value The amount of token we will be transferring.
     */
    function transfer(address token, address to, uint256 value) internal {
        if (value == 0) {
            return;
        }

        address proxy = proxyAddress;
        uint256 result;

        /**
         * We construct calldata for the `Proxy.transferFrom` ABI.
         * The layout of this calldata is in the table below.
         *
         * ╔════════╤════════╤════════╤═══════════════════╗
         * ║ Area   │ Offset │ Length │ Contents          ║
         * ╟────────┼────────┼────────┼───────────────────╢
         * ║ Header │ 0      │ 4      │ function selector ║
         * ║ Params │ 4      │ 32     │ token address     ║
         * ║        │ 36     │ 32     │ from address      ║
         * ║        │ 68     │ 32     │ to address        ║
         * ║        │ 100    │ 32     │ amount of token   ║
         * ╚════════╧════════╧════════╧═══════════════════╝
         */
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            // Keep these so we can restore stack memory upon completion
            let tmp1 := mload(0)
            let tmp2 := mload(4)
            let tmp3 := mload(36)
            let tmp4 := mload(68)

            // keccak256('transfer(address,address,uint256)') bitmasked to 4 bytes
            mstore(0, 0xbeabacc800000000000000000000000000000000000000000000000000000000)
            mstore(4, token)
            mstore(36, to)
            mstore(68, value)

            // Call Proxy contract transferFrom function using constructed calldata
            result := call(
                gas,   // Forward all gas
                proxy, // Proxy.sol deployment address
                0,     // Don't send any ETH
                0,     // Pointer to start of calldata
                100,   // Length of calldata
                0,     // Output location
                0      // We don't expect any output
            )

            // Restore stack memory
            mstore(0, tmp1)
            mstore(4, tmp2)
            mstore(36, tmp3)
            mstore(68, tmp4)
        }

        if (result == 0) {
            revert(TRANSFER_FAILED);
        }
    }

    /**
     * A helper function to call the transferFrom function in Proxy.sol with solidity assembly.
     * Copying the data in order to make an external call can be expensive, but performing the
     * operations in assembly seems to reduce gas cost.
     *
     * The function will revert the transaction if the transfer fails.
     *
     * @param token The address of the ERC20 token we will be transferring, 0 for ETH.
     * @param from The address we will be transferring from.
     * @param to The address we will be transferring to.
     * @param value The amount of token we will be transferring.
     */
    function transferFrom(address token, address from, address to, uint256 value) internal {
        if (value == 0) {
            return;
        }

        address proxy = proxyAddress;
        uint256 result;

        /**
         * We construct calldata for the `Proxy.transferFrom` ABI.
         * The layout of this calldata is in the table below.
         *
         * ╔════════╤════════╤════════╤═══════════════════╗
         * ║ Area   │ Offset │ Length │ Contents          ║
         * ╟────────┼────────┼────────┼───────────────────╢
         * ║ Header │ 0      │ 4      │ function selector ║
         * ║ Params │ 4      │ 32     │ token address     ║
         * ║        │ 36     │ 32     │ from address      ║
         * ║        │ 68     │ 32     │ to address        ║
         * ║        │ 100    │ 32     │ amount of token   ║
         * ╚════════╧════════╧════════╧═══════════════════╝
         */
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            // Keep these so we can restore stack memory upon completion
            let tmp1 := mload(0)
            let tmp2 := mload(4)
            let tmp3 := mload(36)
            let tmp4 := mload(68)
            let tmp5 := mload(100)

            // keccak256('transferFrom(address,address,address,uint256)') bitmasked to 4 bytes
            mstore(0, 0x15dacbea00000000000000000000000000000000000000000000000000000000)
            mstore(4, token)
            mstore(36, from)
            mstore(68, to)
            mstore(100, value)

            // Call Proxy contract transferFrom function using constructed calldata
            result := call(
                gas,   // Forward all gas
                proxy, // Proxy.sol deployment address
                0,     // Don't send any ETH
                0,     // Pointer to start of calldata
                132,   // Length of calldata
                0,     // Output location
                0      // We don't expect any output
            )

            // Restore stack memory
            mstore(0, tmp1)
            mstore(4, tmp2)
            mstore(36, tmp3)
            mstore(68, tmp4)
            mstore(100, tmp5)
        }

        if (result == 0) {
            revert(TRANSFER_FROM_FAILED);
        }
    }

    function mintPositionTokens(address contractAddress, uint256 value) internal {
        if (value == 0) {
            return;
        }

        address proxy = proxyAddress;
        uint256 result;

        /**
         * We construct calldata for the `Proxy.transferFrom` ABI.
         * The layout of this calldata is in the table below.
         *
         * ╔════════╤════════╤════════╤═══════════════════╗
         * ║ Area   │ Offset │ Length │ Contents          ║
         * ╟────────┼────────┼────────┼───────────────────╢
         * ║ Header │ 0      │ 4      │ function selector ║
         * ║ Params │ 4      │ 32     │ contract address  ║
         * ║        │ 36     │ 32     │ amount of token    ║
         * ╚════════╧════════╧════════╧═══════════════════╝
         */
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            // Keep these so we can restore stack memory upon completion
            let tmp1 := mload(0)
            let tmp2 := mload(4)
            let tmp3 := mload(36)

            // keccak256('mintPositionTokens(address,uint256)') bitmasked to 4 bytes
            mstore(0, 0x2bb0d30f00000000000000000000000000000000000000000000000000000000)
            mstore(4, contractAddress)
            mstore(36, value)

            // Call Proxy contract transferFrom function using constructed calldata
            result := call(
                gas,   // Forward all gas
                proxy, // Proxy.sol deployment address
                0,     // Don't send any ETH
                0,     // Pointer to start of calldata
                68,   // Length of calldata
                0,     // Output location
                0      // We don't expect any output
            )

            // Restore stack memory
            mstore(0, tmp1)
            mstore(4, tmp2)
            mstore(36, tmp3)
        }

        if (result == 0) {
            revert(MINT_POSITION_TOKENS_FAILED);
        }
    }

    function redeemPositionTokens(address contractAddress, uint256 value) internal {
        if (value == 0) {
            return;
        }

        address proxy = proxyAddress;
        uint256 result;

        /**
         * We construct calldata for the `Proxy.transferFrom` ABI.
         * The layout of this calldata is in the table below.
         *
         * ╔════════╤════════╤════════╤═══════════════════╗
         * ║ Area   │ Offset │ Length │ Contents          ║
         * ╟────────┼────────┼────────┼───────────────────╢
         * ║ Header │ 0      │ 4      │ function selector ║
         * ║ Params │ 4      │ 32     │ contract address  ║
         * ║        │ 36     │ 32     │ amount of token    ║
         * ╚════════╧════════╧════════╧═══════════════════╝
         */
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            // Keep these so we can restore stack memory upon completion
            let tmp1 := mload(0)
            let tmp2 := mload(4)
            let tmp3 := mload(36)

            // keccak256('redeemPositionTokens(address,uint256)') bitmasked to 4 bytes
            mstore(0, 0xc1b2141100000000000000000000000000000000000000000000000000000000)
            mstore(4, contractAddress)
            mstore(36, value)

            // Call Proxy contract transferFrom function using constructed calldata
            result := call(
                gas,   // Forward all gas
                proxy, // Proxy.sol deployment address
                0,     // Don't send any ETH
                0,     // Pointer to start of calldata
                68,   // Length of calldata
                0,     // Output location
                0      // We don't expect any output
            )

            // Restore stack memory
            mstore(0, tmp1)
            mstore(4, tmp2)
            mstore(36, tmp3)
        }

        if (result == 0) {
            revert(REDEEM_POSITION_TOKENS_FAILED);
        }
    }
}