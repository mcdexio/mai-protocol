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

import "./lib/LibExchangeErrors.sol";
import "./lib/LibMath.sol";
import "./lib/LibOrder.sol";
import "./lib/LibOwnable.sol";
import "./lib/LibRelayer.sol";
import "./lib/LibSignature.sol";

import "./interfaces/IMarketContract.sol";
import "./interfaces/IMarketCollateralPool.sol";
import "./interfaces/IMarketContractRegistry.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract MaiProtocol is LibMath, LibOrder, LibRelayer, LibExchangeErrors, LibOwnable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public constant MAX_MATCHES = 3;
    uint256 public constant LONG = 0;
    uint256 public constant SHORT = 1;
    uint256 public constant FEE_RATE_BASE = 100000;

    /* Supported version */
    uint256 public constant SUPPORTED_ORDER_VERSION = 1;

    /**
     * Address of the market contract registry for whitelist check;
     */
    address public marketRegistryAddress;

    /**
     * Address of the minting pool contract, which is designed to saving fees from minting calls.
     */
    address public mintingPoolAddress;

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
        uint256 gasTokenAmount;
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
        uint256[2] margins;     // [0] = long position token, [1] = short position token
        uint256[2] balances;    // [0] = long position balance, [1] = short position balance
    }

    struct OrderAddressSet {
        address marketContractAddress;
        address relayer;
    }

    struct OrderContext {
        IMarketContract marketContract;             // market contract
        IMarketCollateralPool marketCollateralPool; // market contract pool
        IERC20 collateral;                          // collateral token
        IERC20[2] positions;                        // [0] = long position, [1] = short position
        uint256 takerSide;                          // 0 = buy/long, 1 = sell/short
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
    event Cancel(bytes32 indexed orderHash);
    event Withdraw(address indexed tokenAddress, address indexed to, uint256 amount);
    event Approval(address indexed tokenAddress, address indexed spender, uint256 amount);

    /**
     * Set market registry address, enable market contract addresss check.
     * If enabled, only market contract on whitelist of registry can be used as the trading asset.
     *
     * @param _marketRegistryAddress Address of MARKET Protocol registry contract.
     */
    function setMarketRegistryAddress(address _marketRegistryAddress)
        external
        onlyOwner
    {
        marketRegistryAddress = _marketRegistryAddress;
    }


    function setMintingPool(address _mintingPoolAddress)
        external
        onlyOwner
    {
        mintingPoolAddress = _mintingPoolAddress;
    }

    function approveERC20(address token, address spender, uint256 amount)
        external
        onlyOwner
    {
        IERC20(token).safeApprove(spender, amount);
        emit Approval(token, spender, amount);
    }

    function withdrawERC20(address token, uint256 amount)
        external
        onlyOwner
    {
        require(amount > 0, INVALID_AMOUNT);
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdraw(token, msg.sender, amount);
    }


    /**
     * Do match for MARKET Protocol contract.
     * The match function will generate plans before exchanging to check all requirements are met,
     * then call settleResults to handle all matching results.
     *
     * The result could be one of mint, redeem, buy and sell, which are called fill actions.
     * At most 3 actions could happen between one trading pair, and a taker may be matched with
     * more than one maker before the asked amount full filled.
     *
     * Trading tokens is specified by caller (backend of dex), and is verified by contract.
     *
     * @param takerOrderParam A OrderParam object representing the order from the taker.
     * @param makerOrderParams An array of OrderParam objects representing orders
     *                         from a list of makers.
     * @param posFilledAmounts An array of uint256 representing filled amount for each pair.
     * @param orderAddressSet An object containing addresses common across each order.
     */
    function matchMarketContractOrders(
        OrderParam memory takerOrderParam,
        OrderParam[] memory makerOrderParams,
        uint256[] memory posFilledAmounts,
        OrderAddressSet memory orderAddressSet
    )
        public
    {
        require(posFilledAmounts.length == makerOrderParams.length, INVALID_PARAMETERS);
        require(canMatchMarketContractOrdersFrom(orderAddressSet.relayer), INVALID_SENDER);
        require(!isMakerOnly(takerOrderParam.data), MAKER_ONLY_ORDER_CANNOT_BE_TAKER);

        validateMarketContract(orderAddressSet.marketContractAddress);
        OrderContext memory orderContext = getOrderContext(orderAddressSet, takerOrderParam);
        matchAndSettle(
            takerOrderParam,
            makerOrderParams,
            posFilledAmounts,
            orderAddressSet,
            orderContext
        );
    }

    /**
     * Get order context from given orderParam on taker's side.
     * An order context contains all information about MARKET Protocol contract
     * for further use.
     *
     * @param orderAddressSet An object containing addresses common across each order.
     * @param takerOrderParam A OrderParam object representing the order from the taker.
     # @return A OrderContext object contains information abount MARKET Protocol contract.
     */
    function getOrderContext(
        OrderAddressSet memory orderAddressSet,
        OrderParam memory takerOrderParam
    )
        internal
        view
        returns (OrderContext memory orderContext)
    {
        orderContext.marketContract = IMarketContract(orderAddressSet.marketContractAddress);
        orderContext.marketCollateralPool = IMarketCollateralPool(
            orderContext.marketContract.COLLATERAL_POOL_ADDRESS()
        );
        orderContext.collateral = IERC20(orderContext.marketContract.COLLATERAL_TOKEN_ADDRESS());
        orderContext.positions[LONG] = IERC20(orderContext.marketContract.LONG_POSITION_TOKEN());
        orderContext.positions[SHORT] = IERC20(orderContext.marketContract.SHORT_POSITION_TOKEN());
        orderContext.takerSide = isSell(takerOrderParam.data) ? SHORT : LONG;

        return orderContext;
    }

    /**
     * Generate matching plans.
     *
     * @param takerOrderParam A OrderParam object representing the order from the taker.
     * @param makerOrderParams An array of OrderParam objects representing orders
     *                         from a list of makers.
     * @param posFilledAmounts An array of uint256 representing filled amount for each pair.
     * @param orderAddressSet An object containing addresses common across each order.
     * @param orderContext A OrderContext object contains information abount
     *                     MARKET Protocol contract.
     * @return A array of MatchResult object contains matching results.
     */
    function matchAndSettle(
        OrderParam memory takerOrderParam,
        OrderParam[] memory makerOrderParams,
        uint256[] memory posFilledAmounts,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
    {
        OrderInfo memory takerOrderInfo = getOrderInfo(
            takerOrderParam,
            orderAddressSet,
            orderContext
        );
        for (uint256 i = 0; i < makerOrderParams.length; i++) {
            require(!isMarketOrder(makerOrderParams[i].data), MAKER_ORDER_CAN_NOT_BE_MARKET_ORDER);
            require(isSell(takerOrderParam.data) != isSell(makerOrderParams[i].data), INVALID_SIDE);
            require(
                takerOrderParam.trader != makerOrderParams[i].trader,
                MAKER_CAN_NOT_BE_SAME_WITH_TAKER
            );
            OrderInfo memory makerOrderInfo = getOrderInfo(
                makerOrderParams[i],
                orderAddressSet,
                orderContext
            );
            validatePrice(
                takerOrderParam,
                makerOrderParams[i]
            );
            uint256 toFillAmount = posFilledAmounts[i];
            for (uint256 j = 0; j < MAX_MATCHES && toFillAmount > 0; j++) {
                MatchResult memory result = getMatchResult(
                    takerOrderParam,
                    takerOrderInfo,
                    makerOrderParams[i],
                    makerOrderInfo,
                    orderContext,
                    toFillAmount
                );
                toFillAmount = toFillAmount.sub(result.posFilledAmount);
                settleResult(result, orderAddressSet, orderContext);
            }
            // must be full filled for a maker, if not, that means the exchange progress
            // is not expected.
            require(toFillAmount == 0, UNMATCHED_FILL);
            filled[makerOrderInfo.orderHash] = makerOrderInfo.filledAmount;
        }
        filled[takerOrderInfo.orderHash] = takerOrderInfo.filledAmount;
    }

    /**
     * Check wether the given contract address is on the whitelist of market contract registry.
     * Only enabled when marketRegistryAddress variable is properly set.
     * If marketRegistryAddress is set to 0x0, the check is disable.
     *
     * @param marketContractAddress Address of MARKET Protocol contract.
     */
    function validateMarketContract(address marketContractAddress) internal view {
        if (marketRegistryAddress == address(0x0)) {
            return;
        }
        IMarketContractRegistry registry = IMarketContractRegistry(marketRegistryAddress);
        require(
            registry.isAddressWhiteListed(marketContractAddress),
            INVALID_MARKET_CONTRACT
        );
    }

    /**
     * Calculate per-unit middle price in collateral.
     * The basic formula is (CAP + FLOOR) / 2.
     * The QTY_MULTIPLIER is to fix the decimals diff between price and collateral.
     *
     * @param orderContext A OrderContext object contains information abount
     *                     MARKET Protocol contract.
     * @return The per-unit middle price in collateral.
     */
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

    /**
     * Calculate long side margin in collateral, convert price to margin.
     * Long side margin = PRICE - FLOOR.
     *
     * @param orderContext A OrderContext object contains information abount
     *                     MARKET Protocol contract.
     * @param orderParam A OrderParam object representing the order.
     # @return Long side margin in collateral.
     */
    function calculateLongMargin(OrderContext memory orderContext, OrderParam memory orderParam)
        internal
        view
        returns (uint256)
    {
        return orderParam.price
            .sub(orderContext.marketContract.PRICE_FLOOR())
            .mul(orderContext.marketContract.QTY_MULTIPLIER());
    }

    /**
     * Calculate short side margin in collateral, convert price to margin.
     * Short side margin = CAP - PRICE.
     *
     * @param orderContext A OrderContext object contains information abount
     *                     MARKET Protocol contract.
     * @param orderParam A OrderParam object representing the order.
     # @return Short side margin in collateral.
     */
    function calculateShortMargin(OrderContext memory orderContext, OrderParam memory orderParam)
        internal
        view
        returns (uint256)
    {
        return orderContext.marketContract.PRICE_CAP()
            .sub(orderParam.price)
            .mul(orderContext.marketContract.QTY_MULTIPLIER());
    }

    /**
     * Check if price asked by maker and price bid by taker are met.
     * Currently, to maker sure the `MINT` action always work, we assume that the trading fee
     * can always cover mint fee.
     *
     * @param takerOrderParam A OrderParam object representing the order from taker.
     * @param makerOrderParam A OrderParam object representing the order from maker.
     */
    function validatePrice(
        OrderParam memory takerOrderParam,
        OrderParam memory makerOrderParam
    )
        internal
        pure
    {
        if (isMarketOrder(takerOrderParam.data)) {
            return;
        }
        if (isSell(takerOrderParam.data)) {
            require(takerOrderParam.price <= makerOrderParam.price, INVALID_MATCH);
        } else {
            require(takerOrderParam.price >= makerOrderParam.price, INVALID_MATCH);
        }
    }

    /**
     * Check if price asked by maker and price bid by taker are met.
     * Currently, to maker sure the `MINT` action always work, we assume that the trading fee
     * can always cover mint fee.
     *
     * @param takerOrderParam A OrderParam object representing the order from taker.
     * @param takerOrderInfo The OrderInfo object representing the current taker order state
     * @param makerOrderParam A OrderParam object representing the order from maker.
     * @param makerOrderInfo The OrderInfo object representing the current maker order state
     * @param orderContext A OrderContext object contains information abount
     *                     MARKET Protocol contract.
     * @param posFilledAmount A integer representing how much position tokens should be filled.
     * @return A MatchResult object and filled amount.
     */
    function getMatchResult(
        OrderParam memory takerOrderParam,
        OrderInfo memory takerOrderInfo,
        OrderParam memory makerOrderParam,
        OrderInfo memory makerOrderInfo,
        OrderContext memory orderContext,
        uint256 posFilledAmount
    )
        internal
        view
        returns (MatchResult memory result)
    {
        require(makerOrderInfo.filledAmount <= makerOrderParam.amount, MAKER_ORDER_OVER_MATCH);
        require(takerOrderInfo.filledAmount <= takerOrderParam.amount, TAKER_ORDER_OVER_MATCH);
        // Each order only pays gas once, so only pay gas when nothing has been filled yet.
        if (takerOrderInfo.filledAmount == 0) {
            result.takerGasFee = takerOrderParam.gasTokenAmount;
        }
        if (makerOrderInfo.filledAmount == 0) {
            result.makerGasFee = makerOrderParam.gasTokenAmount;
        }
        // calculate posFilledAmount && ctkFilledAmount, update balances
        fillMatchResult(
            result,
            takerOrderParam,
            takerOrderInfo,
            makerOrderParam,
            makerOrderInfo,
            orderContext,
            posFilledAmount
        );
        // calculate fee
        result.makerFee = result.posFilledAmount.mul(getMakerFeeBase(orderContext, makerOrderParam));
        result.takerFee = result.posFilledAmount.mul(getTakerFeeBase(orderContext, takerOrderParam));
        result.taker = takerOrderParam.trader;
        result.maker = makerOrderParam.trader;
    }

    /**
     * Calculate per-unit fee for maker in collateral.
     *
     * @param orderContext A OrderContext object contains information abount
     *                     MARKET Protocol contract.
     * @param orderParam A OrderParam object representing the order.
     * @return Per-unit maker fee in collateral.
     */
    function getMakerFeeBase(
        OrderContext memory orderContext,
        OrderParam memory orderParam
    )
        internal
        view
        returns (uint256)
    {
        uint256 middleCollateralPerUnit = calculateMiddleCollateralPerUnit(orderContext);
        return middleCollateralPerUnit
            .mul(getAsMakerFeeRateFromOrderData(orderParam.data))
            .div(FEE_RATE_BASE);
    }

    /**
     * Calculate per-unit fee for taker in collateral.
     *
     * @param orderContext A OrderContext object contains information abount
     *                     MARKET Protocol contract.
     * @param orderParam A OrderParam object representing the order.
     * @return Per-unit taker fee in collateral.
     */
    function getTakerFeeBase(
        OrderContext memory orderContext,
        OrderParam memory orderParam
    )
        internal
        view
        returns (uint256)
    {
        uint256 middleCollateralPerUnit = calculateMiddleCollateralPerUnit(orderContext);
        return middleCollateralPerUnit
            .mul(getAsTakerFeeRateFromOrderData(orderParam.data))
            .div(FEE_RATE_BASE);
    }

    /**
     * According to the matching result, calculate and update trading infomations.
     *
     * @param result A MatchResult object indicating that how the order be filled.
     * @param takerOrderParam A OrderParam object representing the order from taker.
     * @param takerOrderInfo The OrderInfo object representing the current taker order state
     * @param makerOrderParam A OrderParam object representing the order from maker.
     * @param makerOrderInfo The OrderInfo object representing the current maker order state
     * @param orderContext A OrderContext object contains information abount
     *                     MARKET Protocol contract.
     * @param posFilledAmount A integer representing how much position tokens should be filled.
     * @return Filled amount.
     */
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
        require(msg.sender == order.trader || msg.sender == order.relayer, INVALID_TRADER);

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

        // a maker order does not contain price, so margin calculation is unavailable
        if (!isMarketOrder(orderParam.data)) {
            // a maker order is never a market order (see MAKER_ORDER_CAN_NOT_BE_MARKET_ORDER),
            // so it's safe to reach here for a maker order
            orderInfo.margins[LONG] = calculateLongMargin(orderContext, orderParam);
            orderInfo.margins[SHORT] = calculateShortMargin(orderContext, orderParam);
        }
        orderInfo.balances[LONG] = IERC20(orderContext.positions[LONG]).balanceOf(orderParam.trader);
        orderInfo.balances[SHORT] = IERC20(orderContext.positions[SHORT]).balanceOf(orderParam.trader);

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
        order.marketContractAddress = orderAddressSet.marketContractAddress;
        order.amount = orderParam.amount;
        order.price = orderParam.price;
        order.gasTokenAmount = orderParam.gasTokenAmount;
        order.data = orderParam.data;
    }

    /**
     * Take a matche result and settle them with the taker order, transferring tokens all tokens
     * and paying all fees necessary to complete the transaction.
     *
     * @param result MatchResult object representing each individual trade to settle.
     * @param orderAddressSet An object containing addresses common across each order.
     * @param orderContext An object containing order related information.
     */
    function settleResult(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
    {
        if (result.fillAction == FillAction.REDEEM) {
            doRedeem(result, orderAddressSet, orderContext);
        } else if (result.fillAction == FillAction.SELL) {
            doSell(result, orderAddressSet, orderContext);
        } else if (result.fillAction == FillAction.BUY) {
            doBuy(result, orderAddressSet, orderContext);
        } else if (result.fillAction == FillAction.MINT) {
            doMint(result, orderAddressSet, orderContext);
        } else {
            revert("UNEXPECTED_FILLACTION");
        }
        emit Match(orderAddressSet, result);
    }

    function doSell(
        MatchResult memory result,
        OrderAddressSet memory orderAddressSet,
        OrderContext memory orderContext
    )
        internal
    {
        uint256 takerTotalFee = result.takerFee.add(result.takerGasFee);
        uint256 makerTotalFee = result.makerFee.add(result.makerGasFee);
        // taker -> maker
        orderContext.positions[oppositeSide(orderContext.takerSide)]
            .safeTransferFrom(
                result.taker,
                result.maker,
                result.posFilledAmount
            );
        // if you want alter solution, replacing starts here
        // maker -> relayer
        orderContext.collateral.safeTransferFrom(
            result.maker,
            orderAddressSet.relayer,
            result.ctkFilledAmount.add(makerTotalFee)
        );
        if (result.ctkFilledAmount > takerTotalFee) {
            // taker to relayer
            orderContext.collateral.safeTransferFrom(
                orderAddressSet.relayer,
                result.taker,
                result.ctkFilledAmount.sub(takerTotalFee)
            );
        } else if (result.ctkFilledAmount < takerTotalFee) {
            // taker to relayer
            orderContext.collateral.safeTransferFrom(
                result.taker,
                orderAddressSet.relayer,
                takerTotalFee.sub(result.ctkFilledAmount)
            );
        }

        // // alter solution: side effect is that taker has to approve ctk,
        // // that may be difficult to test on frontend
        // // maker -> taker
        // orderContext.collateral.safeTransferFrom(
        //     result.maker,
        //     result.taker,
        //     result.ctkFilledAmount.add(makerTotalFee)
        // );
        // orderContext.collateral.safeTransferFrom(
        //     result.taker,
        //     orderAddressSet.relayer,
        //     takerTotalFee.add(makerTotalFee)
        // );
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
    {
        uint256 makerTotalFee = result.makerFee.add(result.makerGasFee);
        uint256 takerTotalFee = result.takerFee.add(result.takerGasFee);
        // maker -> taker
        orderContext.positions[orderContext.takerSide]
            .safeTransferFrom(
                result.maker,
                result.taker,
                result.posFilledAmount
            );
        // if you want alter solution, replacing starts here
        if (result.ctkFilledAmount > makerTotalFee) {
            // taker -> maker
            orderContext.collateral.safeTransferFrom(
                result.taker,
                result.maker,
                result.ctkFilledAmount.sub(makerTotalFee)
            );
        } else if (result.ctkFilledAmount < makerTotalFee) {
            // maker -> taker
            orderContext.collateral.safeTransferFrom(
                result.maker,
                result.taker,
                makerTotalFee.sub(result.ctkFilledAmount)
            );
        }
        // taker -> relayer
        orderContext.collateral.safeTransferFrom(
            result.taker,
            orderAddressSet.relayer,
            takerTotalFee.add(makerTotalFee)
        );

        // // alter solution: side effect is that maker has to approve ctk,
        // // that may be difficult to test on frontend
        // // taker -> maker
        // orderContext.collateral.safeTransferFrom(
        //     result.taker,
        //     result.maker,
        //     result.ctkFilledAmount.add(takerTotalFee)
        // );
        // // maker -> relayer
        // orderContext.collateral.safeTransferFrom(
        //     result.maker,
        //     orderAddressSet.relayer,
        //     takerTotalFee.add(makerTotalFee)
        // );
    }

    function oppositeSide(uint256 side) internal pure returns (uint256) {
        return side == LONG ? SHORT : LONG;
    }

    /**
     * Redeem position tokens which is specified by market protocol contract. Exchange collects
     * long and short tokens from both taker and makers, then calls mint method of market protocol
     * contract pool. The amount of tokens collected from maker and taker must be equal.
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
    {
        uint256 makerTotalFee = result.makerFee.add(result.makerGasFee);
        uint256 takerTotalFee = result.takerFee.add(result.takerGasFee);
        uint256 collateralToTaker = orderContext.marketContract.COLLATERAL_PER_UNIT()
            .mul(result.posFilledAmount)
            .sub(result.ctkFilledAmount);

        // 1. collect positions
        // taker -> mai
        orderContext.positions[oppositeSide(orderContext.takerSide)]
            .safeTransferFrom(
                result.taker,
                address(this),
                result.posFilledAmount
            );
        // maker -> mai
        orderContext.positions[orderContext.takerSide]
            .safeTransferFrom(
                result.maker,
                address(this),
                result.posFilledAmount
            );
        // 2. do redeem
        redeemPositionTokens(orderContext, result.posFilledAmount);
        // 3. send collateral back to user
        // to maker
        if (result.ctkFilledAmount > makerTotalFee) {
            // mai -> maker
            orderContext.collateral.safeTransfer(
                result.maker,
                result.ctkFilledAmount.sub(makerTotalFee)
            );
        } else if (result.ctkFilledAmount < makerTotalFee) {
            // maker -> mai: insufficent fees
            orderContext.collateral.safeTransferFrom(
                result.maker,
                address(this),
                makerTotalFee.sub(result.ctkFilledAmount)
            );
        }
        // to taker
        if (collateralToTaker > takerTotalFee) {
            // mai -> taker
            orderContext.collateral.safeTransfer(
                result.taker,
                collateralToTaker.sub(takerTotalFee)
            );
        } else if (collateralToTaker < takerTotalFee) {
            // takker -> mai: insufficent fees
            orderContext.collateral.safeTransferFrom(
                result.taker,
                address(this),
                takerTotalFee.sub(collateralToTaker)
            );
        }
        // to relayer
        orderContext.collateral.safeTransfer(
            orderAddressSet.relayer,
            makerTotalFee.add(takerTotalFee)
        );
    }

    /**
     * Mint position tokens which is specified by market protocol contract. Exchange collects
     * collaterals from both taker and makers, then calls mint method of market protocol contract
     * pool.
     *
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
    {
        // posFilledAmount
        uint256 neededCollateral = result.posFilledAmount
            .mul(orderContext.marketContract.COLLATERAL_PER_UNIT());
        uint256 neededCollateralTokenFee = result.posFilledAmount
            .mul(orderContext.marketContract.COLLATERAL_TOKEN_FEE_PER_UNIT());
        uint256 mintFee = result.takerFee.add(result.makerFee);
        uint256 feeToRelayer = result.takerGasFee.add(result.makerGasFee);
        // if fees from user is not enough for minting, the rest will be payed by relayer
        if (neededCollateralTokenFee > mintFee) {
            orderContext.collateral.safeTransferFrom(
                orderAddressSet.relayer,
                address(this),
                neededCollateralTokenFee.sub(mintFee)
            );
        } else if (neededCollateralTokenFee < mintFee) {
            feeToRelayer = feeToRelayer.add(mintFee).sub(neededCollateralTokenFee);
        }
        // 1. collect collateral
        // maker -> mai
        orderContext.collateral.safeTransferFrom(
            result.maker,
            address(this),
            result.ctkFilledAmount
                .add(result.makerFee)
                .add(result.makerGasFee)
        );
        // taker -> mai
        orderContext.collateral.safeTransferFrom(
            result.taker,
            address(this),
            neededCollateral
                .sub(result.ctkFilledAmount)
                .add(result.takerFee)
                .add(result.takerGasFee)
        );
        // 2. do mint
        mintPositionTokens(orderContext, result.posFilledAmount);
        // 3. send positions to user
        // mai -> taker
        orderContext.positions[orderContext.takerSide]
            .safeTransfer(
                result.taker,
                result.posFilledAmount
            );
        // mai -> maker
        orderContext.positions[oppositeSide(orderContext.takerSide)]
            .safeTransfer(
                result.maker,
                result.posFilledAmount
            );
        // mai -> relayer
        orderContext.collateral.safeTransfer(
            orderAddressSet.relayer,
            feeToRelayer
        );
    }

    /// @dev Invoking mintPositionTokens.
    /// @param orderContext Order context contains required market contract info.
    /// @param qtyToMint Quantity to mint in position token.
    function mintPositionTokens(OrderContext memory orderContext, uint256 qtyToMint)
        internal
    {
        IMarketCollateralPool collateralPool;
        if (mintingPoolAddress != address(0x0)) {
            collateralPool = IMarketCollateralPool(mintingPoolAddress);
        } else {
            collateralPool = orderContext.marketCollateralPool;
        }
        collateralPool.mintPositionTokens(address(orderContext.marketContract), qtyToMint, false);
    }

    /// @dev Invoking redeemPositionTokens.
    /// @param orderContext Order context contains required market contract info.
    /// @param qtyToRedeem Quantity to redeem in position token.
    function redeemPositionTokens(OrderContext memory orderContext, uint256 qtyToRedeem)
        internal
    {
        IMarketCollateralPool collateralPool;
        if (mintingPoolAddress != address(0x0)) {
            collateralPool = IMarketCollateralPool(mintingPoolAddress);
        } else {
            collateralPool = orderContext.marketCollateralPool;
        }
        collateralPool.redeemPositionTokens(address(orderContext.marketContract), qtyToRedeem);
    }
}