/*

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

pragma solidity ^0.4.24;
pragma experimental ABIEncoderV2;


import "./lib/SafeMath.sol";
import "./lib/LibOrder.sol";
import "./lib/LibMath.sol";
import "./lib/LibSignature.sol";
import "./lib/LibRelayer.sol";
import "./lib/LibExchangeErrors.sol";
import "./interfaces/IMarketContractPool.sol";
import "./interfaces/IMarketContract.sol";
import "./interfaces/IERC20.sol";
import "./lib/MathLib.sol";

contract HybridExchange is LibMath, LibOrder, LibRelayer, LibExchangeErrors {
    using SafeMath for uint256;

    uint256 public constant FEE_RATE_BASE = 100000;

    /* Order v2 data is uncompatible with v1. This contract can only handle v2 order. */
    uint256 public constant SUPPORTED_ORDER_VERSION = 2;

    /**
     * Address of the proxy responsible for asset transfer.
     */
    address public proxyAddress;

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
    event Print(string message, uint256 value);

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
        IERC20[2] pos;                          // [0] = long position token, [1] = short position token
        uint takerSide;                         // 0 = buy, 1 = short
    }

    struct MatchResult {
        address maker;
        address taker;
        uint256 makerFee;                   // makerFee in order data
        uint256 takerFee;                   // takerFee in order data
        uint256 makerGasFee;
        uint256 takerGasFee;
        uint256 posFilledAmount;
        uint256 ctkFilledAmount;
        FillAction fillAction;
    }

    event Match(
        OrderAddressSet addressSet,
        MatchResult result
    );

    constructor(address _proxyAddress) public {
        proxyAddress = _proxyAddress;
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
        orderContext.marketContractPool = IMarketContractPool(orderContext.marketContract.COLLATERAL_POOL_ADDRESS());
        orderContext.ctk = IERC20(orderContext.marketContract.COLLATERAL_TOKEN_ADDRESS());
        orderContext.pos[0] = IERC20(orderContext.marketContract.LONG_POSITION_TOKEN());
        orderContext.pos[1] = IERC20(orderContext.marketContract.SHORT_POSITION_TOKEN());
        orderContext.takerSide = isSell(takerOrderParam.data) ? 1 : 0;

        require (block.timestamp < orderContext.marketContract.EXPIRATION(), "MarketProtocolContract expired");

        return orderContext;
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

        OrderContext memory orderContext = getOrderContext(orderAddressSet, takerOrderParam);
        uint256 takerFeeRate = getTakerFeeRate(takerOrderParam);
        OrderInfo memory takerOrderInfo = getOrderInfo(
            takerOrderParam,
            orderAddressSet,
            orderContext
        );

        uint256 resultIndex;
        // Each matched pair will produce two results at most (exchange + mint, exchange + redeem).
        MatchResult[] memory results = new MatchResult[](makerOrderParams.length * 2);
        for (uint256 i = 0; i < makerOrderParams.length; i++) {
            require(
                !isMarketOrder(makerOrderParams[i].data),
                MAKER_ORDER_CAN_NOT_BE_MARKET_ORDER
            );
            require(
                isSell(takerOrderParam.data) != isSell(makerOrderParams[i].data),
                INVALID_SIDE
            );

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

        settleResults(results, takerOrderParam, orderAddressSet, orderContext);
    }


    function calcuteLongMargin(OrderContext memory orderContext, OrderParam memory orderParam)
        internal
        view
        returns (uint256)
    {
        return orderParam.price.sub(orderContext.marketContract.PRICE_FLOOR());
    }

    function calcuteShortMargin(OrderContext memory orderContext, OrderParam memory orderParam)
        internal
        view
        returns (uint256)
    {
        return orderContext.marketContract.PRICE_CAP().sub(orderParam.price);
    }

    /**
     * Construct a MatchResult from matching taker and maker order data, which will be used when
     * settling the orders and transferring token.
     *
     * @param takerOrderParam The OrderParam object representing the taker's order data
     * @param takerOrderInfo The OrderInfo object representing the current taker order state
     * @param makerOrderParam The OrderParam object representing the maker's order data
     * @param makerOrderInfo The OrderInfo object representing the current maker order state
     * @param takerFeeRate The rate used to calculate the fee charged to the taker
     * @return MatchResult object containing data that will be used during order settlement.
     */
     /*
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
        pure
        returns (MatchResult memory result, uint256 filledAmount)
    {
        // Each order only pays gas once, so only pay gas when nothing has been filled yet.
        if (takerOrderInfo.filledAmount == 0) {
            result.takerGasFee = takerOrderParam.gasAmount;
        }
        if (makerOrderInfo.filledAmount == 0) {
            result.makerGasFee = makerOrderParam.gasAmount;
        }

        if (isSell(takerOrderParam.data)) {
            // SHORT:
            // if taker is short, then maker must be long
            //      condition A: taker has long token;
            //      condition B: taker has no long token;
            //
            // A: taker has long token, sell or redeem;
            //      condition 1: maker has short token, then redeem;
            //      condition 2: maker has no short token, then exchange;
            //
            // B: taker has no long token, buy or mint;
            //      condition 1: maker has short token, then exchange;
            //      condition 2: maker has no short token, then mint;
            if (takerPosBalance.longPos > 0) {
                if (makerPosBalance.shortPos > 0) {
                    // do redeem
                    filledAmount = min(
                        min(
                            takerPosBalance.longPos,
                            posFilledAmount
                        ),
                        min(
                            makerPosBalance.shortPos,
                            posFilledAmount
                        )
                    );
                    takerOrderInfo.filledAmount = takerOrderInfo.filledAmount.add(filledAmount);
                    makerOrderInfo.filledAmount = makerOrderInfo.filledAmount.add(filledAmount);
                    takerPosBalance.longPos =
                        takerPosBalance.longPos.sub(filledAmount);
                    makerPosBalance.shortPos =
                        makerPosBalance.shortPos.sub(filledAmount);

                    result.fillAction = FillAction.REDEEM;
                } else {
                    // do exchange
                    filledAmount = min(
                        takerPosBalance.longPos,
                        posFilledAmount
                    );

                    takerPosBalance.longPos =
                        takerPosBalance.longPos.sub(filledAmount);
                    makerPosBalance.longPos =
                        makerPosBalance.longPos.add(filledAmount);

                    result.fillAction = FillAction.EXCHANGE;
                    require(takerUnitMargin <= makerUnitMargin, INVALID_MATCH);
                }
            } else {
                if (makerPosBalance.shortPos > 0) {
                    // do exchange
                    filledAmount = min(
                        makerPosBalance.shortPos,
                        posFilledAmount
                    );

                    makerPosBalance.shortPos =
                        makerPosBalance.shortPos.sub(filledAmount);
                    takerPosBalance.shortPos =
                        takerPosBalance.shortPos.add(filledAmount);

                    result.fillAction = FillAction.EXCHANGE;
                    require(makerUnitMargin <= takerUnitMargin, INVALID_MATCH);
                } else {
                    // do mint
                    filledAmount = posFilledAmount;
                    takerOrderInfo.filledAmount = takerOrderInfo.filledAmount.add(filledAmount);
                    makerOrderInfo.filledAmount = makerOrderInfo.filledAmount.add(filledAmount);
                    takerPosBalance.longPos =
                        takerPosBalance.longPos.add(filledAmount);
                    makerPosBalance.shortPos =
                        makerPosBalance.shortPos.add(filledAmount);

                    result.fillAction = FillAction.MINT;
                }
            }
        } else {
            // if taker is long, then maker must be short
            //      condition A: taker has short token;
            //      condition B: taker has no short token;
            //
            // A: taker has short token, sell or redeem;
            //      condition 1: maker has long token, then redeem;
            //      condition 2: maker has no long token, then exchange;
            //
            // B: taker has no short token, buy or mint;
            //      condition 1: maker has long token, then exchange;
            //      condition 2: maker has no long token, then mint;
            if (takerPosBalance.shortPos > 0) {
                if (makerPosBalance.longPos > 0) {
                    // do redeem
                    filledAmount = min(
                        min(
                            takerPosBalance.shortPos,
                            posFilledAmount
                        ),
                        min(
                            makerPosBalance.longPos,
                            posFilledAmount
                        )
                    );
                    takerOrderInfo.filledAmount = takerOrderInfo.filledAmount.add(filledAmount);
                    makerOrderInfo.filledAmount = makerOrderInfo.filledAmount.add(filledAmount);
                    takerPosBalance.shortPos = takerPosBalance.shortPos.sub(filledAmount);
                    makerPosBalance.longPos = makerPosBalance.longPos.sub(filledAmount);

                    result.fillAction = FillAction.REDEEM;
                } else {
                    // do exchange
                    filledAmount = min(
                        takerPosBalance.shortPos,
                        posFilledAmount
                    );

                    takerPosBalance.shortPos = takerPosBalance.shortPos.sub(filledAmount);
                    makerPosBalance.shortPos = makerPosBalance.shortPos.add(filledAmount);

                    result.fillAction = FillAction.EXCHANGE;
                    require(takerUnitMargin <= makerUnitMargin, INVALID_MATCH);
                }
            } else {
                if (makerPosBalance.longPos > 0) {
                    // do exchange
                    filledAmount = min(
                        makerPosBalance.longPos,
                        posFilledAmount
                    );

                    makerPosBalance.longPos = makerPosBalance.longPos.sub(filledAmount);
                    takerPosBalance.longPos = takerPosBalance.longPos.add(filledAmount);

                    result.fillAction = FillAction.EXCHANGE;
                    require(makerUnitMargin <= takerUnitMargin, INVALID_MATCH);
                } else {
                    // do mint
                    filledAmount = posFilledAmount;
                    takerOrderInfo.filledAmount = takerOrderInfo.filledAmount.add(filledAmount);
                    makerOrderInfo.filledAmount = makerOrderInfo.filledAmount.add(filledAmount);
                    takerPosBalance.shortPos = takerPosBalance.shortPos.add(filledAmount);
                    makerPosBalance.longPos = makerPosBalance.longPos.add(filledAmount);

                    result.fillAction = FillAction.MINT;
                }
            }
        }
        result.posFilledAmount = filledAmount;

        require(takerOrderInfo.filledAmount <= takerOrderParam.amount, TAKER_ORDER_OVER_MATCH);
        require(makerOrderInfo.filledAmount <= makerOrderParam.amount, TAKER_ORDER_OVER_MATCH);


        result.maker = makerOrderParam.trader;
        result.taker = takerOrderParam.trader;

        uint256 makerRawFeeRate = getAsMakerFeeRateFromOrderData(makerOrderParam.data);
        result.makerFee = result.posFilledAmount.
            mul(orderContext.middleCollateralPerUnit).
            mul(makerRawFeeRate).
            div(FEE_RATE_BASE);
        result.takerFee = result.posFilledAmount.
            mul(orderContext.middleCollateralPerUnit).
            mul(takerFeeRate).
            div(FEE_RATE_BASE);


        if (result.fillAction == FillAction.REDEEM) {
            uint256 collateralReturned = orderContext.collateralPerUnit.mul(filledAmount);
            uint256 collateralAsked = makerUnitMargin.add(takerUnitMargin).mul(filledAmount);
            require(collateralReturned >= collateralAsked, INVALID_MATCH);
        } else if (result.fillAction == FillAction.MINT) {
            uint256 collateralRequired = orderContext.collateralPerUnit.
                add(orderContext.collateralTokenFeePerUnit).
                mul(filledAmount);
            uint256 collateralBid = makerUnitMargin.
                add(takerUnitMargin).
                mul(filledAmount).
                add(result.makerFee).
                add(result.takerFee);
            require(collateralRequired <= collateralBid, INVALID_MATCH);
        }

        return (result, filledAmount);
    }
    */

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
        result = makeMatchResult(
            takerOrderParam,
            takerOrderInfo,
            makerOrderParam,
            makerOrderInfo,
            orderContext,
            posFilledAmount,
            takerFeeRate
        );

        filledAmount = updateMatchResult(
            result,
            takerOrderParam,
            takerOrderInfo,
            makerOrderParam,
            makerOrderInfo,
            orderContext,
            posFilledAmount
        );
        return (result, filledAmount);
    }

    function makeMatchResult(
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
        returns (MatchResult memory result)
    {
        // Each order only pays gas once, so only pay gas when nothing has been filled yet.
        if (takerOrderInfo.filledAmount == 0) {
            result.takerGasFee = takerOrderParam.gasAmount;
        }
        if (makerOrderInfo.filledAmount == 0) {
            result.makerGasFee = makerOrderParam.gasAmount;
        }
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

        return result;
    }

    function updateMatchResult(
        MatchResult memory result,
        OrderParam memory takerOrderParam,
        OrderInfo memory takerOrderInfo,
        OrderParam memory makerOrderParam,
        OrderInfo memory makerOrderInfo,
        OrderContext memory orderContext,
        uint256 posFilledAmount
    )
        internal
        returns (uint256 filledAmount)
    {
        uint side = orderContext.takerSide;
        uint oppsite = side == 1 ? 0 : 1;

        if (takerOrderInfo.balances[oppsite] > 0 && makerOrderInfo.balances[side] > 0) {
            // do redeem
            validateRedeemPrice(
                result,
                takerOrderParam,
                takerOrderInfo,
                makerOrderParam,
                makerOrderInfo,
                orderContext
            );
            filledAmount = min(
                min(takerOrderInfo.balances[oppsite], posFilledAmount),
                makerOrderInfo.balances[side]
            );
            // update balances
            takerOrderInfo.balances[oppsite] = takerOrderInfo.balances[oppsite].sub(filledAmount);
            makerOrderInfo.balances[side] = makerOrderInfo.balances[side].sub(filledAmount);
            result.fillAction = FillAction.REDEEM;

       } else if (takerOrderInfo.balances[oppsite] > 0 && makerOrderInfo.balances[side] == 0) {
            // do exchange, taker sell to maker
            require(takerOrderInfo.margins[side] <= makerOrderInfo.margins[oppsite], "");

            filledAmount = min(takerOrderInfo.balances[oppsite], posFilledAmount);
            takerOrderInfo.balances[oppsite] = takerOrderInfo.balances[oppsite].sub(filledAmount);
            makerOrderInfo.balances[oppsite] = makerOrderInfo.balances[oppsite].add(filledAmount);
            result.fillAction = FillAction.SELL;

       } else if (takerOrderInfo.balances[oppsite] == 0 && makerOrderInfo.balances[side] > 0) {
            // do exchange, taker buy from maker
            require(takerOrderInfo.margins[side] >= makerOrderInfo.margins[oppsite], "");

            filledAmount = min(makerOrderInfo.balances[side], posFilledAmount);
            takerOrderInfo.balances[side] = takerOrderInfo.balances[side].add(filledAmount);
            makerOrderInfo.balances[side] = makerOrderInfo.balances[side].sub(filledAmount);
            result.fillAction = FillAction.BUY;

       } else if (takerOrderInfo.balances[oppsite] == 0 && makerOrderInfo.balances[side] == 0) {
            // do mint
            validateMintPrice(
                result,
                takerOrderParam,
                takerOrderInfo,
                makerOrderParam,
                makerOrderInfo,
                orderContext
            );
            filledAmount = posFilledAmount;
            // update balances
            takerOrderInfo.balances[side] = takerOrderInfo.balances[side].add(filledAmount);
            makerOrderInfo.balances[oppsite] = makerOrderInfo.balances[oppsite].add(filledAmount);
            result.fillAction = FillAction.MINT;

        } else {
           revert("UNEXPECTED_MATCH");
        }

        // update filledAmount
        takerOrderInfo.filledAmount = takerOrderInfo.filledAmount.add(filledAmount);
        makerOrderInfo.filledAmount = makerOrderInfo.filledAmount.add(filledAmount);
        result.ctkFilledAmount = filledAmount;
        return filledAmount;
    }

    function validateRedeemPrice(
        MatchResult memory,
        OrderParam memory takerOrderParam,
        OrderInfo memory takerOrderInfo,
        OrderParam memory makerOrderParam,
        OrderInfo memory makerOrderInfo,
        OrderContext memory orderContext
    )
        internal
        view
    {
        uint side = orderContext.takerSide;
        uint oppsite = side == 1 ? 0 : 1;
        uint256 left = takerOrderInfo.margins[side];
        uint256 right = makerOrderInfo.margins[oppsite];
        require(
            left.add(right) <= orderContext.marketContract.COLLATERAL_PER_UNIT(),
            "REDEEM_PRICE_NOT_MET"
        );
    }

    function validateMintPrice(
        MatchResult memory matchResult,
        OrderParam memory takerOrderParam,
        OrderInfo memory takerOrderInfo,
        OrderParam memory makerOrderParam,
        OrderInfo memory makerOrderInfo,
        OrderContext memory orderContext
    )
        internal
        view
    {
        uint side = orderContext.takerSide;
        uint oppsite = side == 1 ? 0 : 1;
        uint256 left = takerOrderInfo.margins[side];
        uint256 right = makerOrderInfo.margins[oppsite];
        uint256 total = left.add(right).add(matchResult.makerFee).add(matchResult.takerFee);
        uint256 required = orderContext.marketContract.COLLATERAL_PER_UNIT()
            .add(orderContext.marketContract.COLLATERAL_TOKEN_FEE_PER_UNIT());
        require(total >= required, "MINT_PRICE_NOT_MET");
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

        Order memory order = getOrderFromOrderParam(orderParam, orderAddressSet, orderContext);
        orderInfo.orderHash = getOrderHash(order);
        orderInfo.filledAmount = filled[orderInfo.orderHash];
        uint8 status = uint8(OrderStatus.FILLABLE);

        // TODO: review isMarketBuy(order.data)
        // see https://github.com/HydroProtocol/protocol/blob/v1.1/contracts/HybridExchange.sol#L205
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

        orderInfo.margins[0] = calcuteLongMargin(orderContext, orderParam);
        orderInfo.margins[1] = calcuteShortMargin(orderContext, orderParam);
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
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
        pure
        returns (Order memory order)
    {
        order.trader = orderParam.trader;
        order.relayer = orderAddressSet.relayer;
        order.marketContractAddress = orderAddressSet.marketContract;
        order.amount = orderParam.amount;
        order.price = orderParam.price;
        order.gasTokenAmount = orderParam.gasAmount;
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

    // /**
    //  * Take an amount and convert it from base token units to quote token units based on the price
    //  * in the order param.
    //  *
    //  * @param orderParam The OrderParam object containing the Order data.
    //  * @param amount An amount of base token.
    //  * @return The converted amount in quote token units.
    //  */
    // function convertCollateralToPosition(OrderParam memory orderParam, uint256 amount)
    //     internal
    //     pure
    //     returns (uint256)
    // {
    //     return getPartialAmountFloor(
    //         orderParam.quoteTokenAmount,
    //         orderParam.baseTokenAmount,
    //         amount
    //     );
    // }

    // /**
    //  * Take an amount and convert it from quote token units to base token units based on the price
    //  * in the order param.
    //  *
    //  * @param orderParam The OrderParam object containing the Order data.
    //  * @param amount An amount of quote token.
    //  * @return The converted amount in base token units.
    //  */
    // function convertQuoteToBase(OrderParam memory orderParam, uint256 amount)
    //     internal
    //     pure
    //     returns (uint256)
    // {
    //     return getPartialAmountFloor(
    //         orderParam.baseTokenAmount,
    //         orderParam.quoteTokenAmount,
    //         amount
    //     );
    // }

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
        // sell / redeem
        settleTakerSell(results, orderAddressSet, orderContext);

        // buy / mint
        settleTakerBuy(results, orderAddressSet, orderContext);
    }

    /**
     * Settles a sell order given a list of MatchResult objects. A naive approach would be to take
     * each result, have the taker and maker transfer the appropriate tokens, and then have them
     * each send the appropriate fees to the relayer, meaning that for n makers there would be 4n
     * transactions. Additionally the taker would have to have an allowance set for the quote token
     * in order to pay the fees to the relayer.
     *
     * Instead we do the following:
     *  - Taker transfers the required base token to each maker
     *  - Each maker sends an amount of quote token to the relayer equal to:
     *    [Amount owed to taker] + [Maker fee] + [Maker gas cost] - [Maker rebate amount]
     *  - The relayer will then take all of this quote token and in a single batch transaction
     *    send the appropriate amount to the taker, equal to:
     *    [Total amount owed to taker] - [All taker fees] - [All taker gas costs]
     *
     * Thus in the end the taker will have the full amount of quote token, sans the fee and cost of
     * their share of gas. Each maker will have their share of base token, sans the fee and cost of
     * their share of gas, and will keep their rebate in quote token. The relayer will end up with
     * the fees from the taker and each maker (sans rebate), and the gas costs will pay for the
     * transactions. In this scenario, with n makers there will be 2n + 1 transactions, which will
     * be a significant gas savings over the original method.
     *
     * @param results A list of MatchResult objects representing each individual trade to settle.
     * @param orderAddressSet An object containing addresses common across each order.
     * @param orderContext An object containing order related information.
     */
    function settleTakerSell(
        MatchResult[] memory results,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
    {
        // total amount of exchanged
        uint256 totalTakerQuoteTokenFilledAmount = 0;
        // total amount of redeemed
        uint256 totalTakerQuoteTokenRedeemedAmount = 0;
        uint256 totalTakerQuoteTokenFeeAmount = 0;
        uint side = orderContext.takerSide;
        //uint oppsite = side == 1 ? 0 : 1;
        for (uint256 i = 0; i < results.length; i++) {
            if (results[i].fillAction == FillAction.SELL) {
                /**  for FillAction.EXCHANGE
                 *
                 *   taker      -- posFilledAmount                            --> maker
                 *   maker      -- ctkFilledAmount + makerFee + makerGasFee  --> relayer
                 *   relayer    -- ctkFilledAmount - takerFee - takerGasFee  --> taker
                 *
                 *   taker get:     ctkFilledAmount  (-takerFee -takerGasFee)
                 *   maker get:     posFilledAmount   (-makerFee -makerGasFee)
                 *   relayer get:   makerFee + makerGasFee + takerFee + takerGasFee
                 *
                 **/
                // taker -> maker
                transferFrom(
                    orderContext.pos[side],
                    results[i].taker,
                    results[i].maker,
                    results[i].posFilledAmount
                );
                // maker -> relayer
                transferFrom(
                    orderContext.ctk,
                    results[i].maker,
                    orderAddressSet.relayer,
                    results[i].ctkFilledAmount.
                        add(results[i].makerFee).
                        add(results[i].makerGasFee)
                );
                // relayer -> taker
                totalTakerQuoteTokenFilledAmount = totalTakerQuoteTokenFilledAmount.add(
                    results[i].ctkFilledAmount.sub(results[i].takerFee)
                );
            } else if (results[i].fillAction == FillAction.REDEEM) {
                totalTakerQuoteTokenRedeemedAmount = totalTakerQuoteTokenRedeemedAmount.add(
                    doRedeem(results[i], orderAddressSet, orderContext)
                );
                totalTakerQuoteTokenFeeAmount = totalTakerQuoteTokenFeeAmount.add(
                    results[i].takerFee.add(results[i].makerFee).add(results[i].makerGasFee)
                );
            } else {
                continue;
            }
            emitMatchEvent(results[i], orderAddressSet);
        }
        // transfer accumulative exchanged collateral to taker
        if (totalTakerQuoteTokenFilledAmount > 0) {
            transferFrom(
                orderContext.ctk,
                orderAddressSet.relayer,
                results[0].taker,
                totalTakerQuoteTokenFilledAmount.sub(results[0].takerGasFee)
            );
        }
        // transfer accumulative redeemed collateral to taker
        if (totalTakerQuoteTokenRedeemedAmount > 0) {
            // if totalTakerQuoteTokenFilledAmount not handle gasFee
            if (totalTakerQuoteTokenFilledAmount == 0) {
                totalTakerQuoteTokenRedeemedAmount = totalTakerQuoteTokenRedeemedAmount.
                    sub(results[0].takerGasFee);
                totalTakerQuoteTokenFeeAmount = totalTakerQuoteTokenFeeAmount.
                    add(results[0].takerGasFee);
            }
            transfer(
                orderContext.ctk,
                results[0].taker,
                totalTakerQuoteTokenRedeemedAmount
            );
            // transfer all fees to relayer
            transfer(
                orderContext.ctk,
                orderAddressSet.relayer,
                totalTakerQuoteTokenFeeAmount
            );
        }
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
        uint side = orderContext.takerSide;
        uint oppsite = side == 1 ? 0 : 1;

        // taker -> proxy
        transferFrom(
            orderContext.pos[side],
            result.taker,
            proxyAddress,
            result.posFilledAmount
        );
        // maker -> proxy
        transferFrom(
            orderContext.pos[oppsite],
            result.maker,
            proxyAddress,
            result.posFilledAmount
        );
        // proxy <- at least ctkFilledAmount
        redeemPositionTokens(orderAddressSet.marketContract, result.posFilledAmount);
        // replayer -> maker
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
        return collateralToReturn.
            sub(result.ctkFilledAmount).
            sub(result.takerFee);
    }


    /**
     * Settles a buy order given a list of MatchResult objects. A naive approach would be to take
     * each result, have the taker and maker transfer the appropriate tokens, and then have them
     * each send the appropriate fees to the relayer, meaning that for n makers there would be 4n
     * transactions. Additionally each maker would have to have an allowance set for the quote token
     * in order to pay the fees to the relayer.
     *
     * Instead we do the following:
     *  - Each maker transfers base tokens to the taker
     *  - The taker sends an amount of quote tokens to each maker equal to:
     *    [Amount owed to maker] + [Maker rebate amount] - [Maker fee] - [Maker gas cost]
     *  - Since the taker saved all the maker fees and gas costs, it can then send them as a single
     *    batch transaction to the relayer, equal to:
     *    [All maker and taker fees] + [All maker and taker gas costs] - [All maker rebates]
     *
     * Thus in the end the taker will have the full amount of base token, sans the fee and cost of
     * their share of gas. Each maker will have their share of quote token, including their rebate,
     * but sans the fee and cost of their share of gas. The relayer will end up with the fees from
     * the taker and each maker (sans rebates), and the gas costs will pay for the transactions. In
     * this scenario, with n makers there will be 2n + 1 transactions, which will be a significant
     * gas savings over the original method.
     *
     * @param results A list of MatchResult objects representing each individual trade to settle.
     * @param orderAddressSet An object containing addresses common across each order.
     * @param orderContext An object containing order related information.
     */
    function settleTakerBuy(
        MatchResult[] memory results,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
    {
        uint256 totalFee = 0;
        uint256 remainingMintFee = 0;
        uint side = orderContext.takerSide;
        //uint oppsite = side == 1 ? 0 : 1;

        for (uint256 i = 0; i < results.length; i++) {
            if (results[i].fillAction == FillAction.BUY) {
                /**  for FillAction.EXCHANGE
                 *
                 *   maker      -- ctkFilledAmount                           --> taker
                 *   taker      -- posFilledAmount - makerFee - makerGasFee   --> maker
                 *   taker      -- takerFee + takerGasFee + makerFee + makerGasFee  --> relayer
                 *
                 *   taker get:     ctkFilledAmount  (-takerFee -takerGasFee)
                 *   maker get:     posFilledAmount   (-makerFee -makerGasFee)
                 *   relayer get:   makerFee + makerGasFee + takerFee + takerGasFee
                 *
                 **/
                // maker -> taker
                transferFrom(
                    orderContext.pos[side],
                    results[i].maker,
                    results[i].taker,
                    results[i].posFilledAmount
                );

                // taker -> maker
                transferFrom(
                    orderContext.ctk,
                    results[i].taker,
                    results[i].maker,
                    results[i].ctkFilledAmount.
                        sub(results[i].makerFee).
                        sub(results[i].makerGasFee)
                );
                totalFee = totalFee.
                    add(results[i].takerFee).
                    add(results[i].makerFee).
                    add(results[i].makerGasFee).
                    add(results[i].takerGasFee);

            } else if (results[i].fillAction == FillAction.MINT) {
                remainingMintFee = remainingMintFee.add(
                    doMint(results[i], orderAddressSet, orderContext)
                );
            } else {
                continue;
            }
            emitMatchEvent(results[i], orderAddressSet);
        }
        if (totalFee > 0) {
            transferFrom(
                orderContext.ctk,
                results[0].taker,
                orderAddressSet.relayer,
                totalFee
            );
        }
        if (remainingMintFee > 0) {
            transfer(
                orderContext.ctk,
                orderAddressSet.relayer,
                remainingMintFee
            );
        }
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
        uint side = orderContext.takerSide;
        uint oppsite = side == 1 ? 0 : 1;

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
        require(totalFee >= neededCollateralTokenFee, "INSUFFICIENT_MINT_FEE");

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
        // proxy -> maker
        transfer(
            orderContext.pos[oppsite],
            result.maker,
            result.posFilledAmount
        );
        transfer(
            orderContext.pos[side],
            result.taker,
            result.posFilledAmount
        );
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

    function emitMatchEvent(MatchResult memory result, OrderAddressSet memory orderAddressSet)
        internal
    {
        emit Match(
            orderAddressSet, result
        );
    }
}